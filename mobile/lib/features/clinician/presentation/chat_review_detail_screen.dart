import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/chat_background.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../chat/data/chat_repository.dart';
import '../../chat/presentation/widgets/care_composer.dart';
import '../../chat/presentation/widgets/chat_attachment_thumbs.dart';
import '../../chat/presentation/widgets/chat_document_card.dart';
import '../../chat/presentation/widgets/jump_to_latest.dart';
import '../../chat/presentation/widgets/voice_note_player.dart';
import '../data/clinician_repository.dart';
import '../domain/chat_review.dart';
import 'clinician_providers.dart';

/// One conversation, opened from the review queue — now the real chat, not a
/// read-only audit view: the doctor can reply with photos and voice, pin, reply
/// to and delete messages, exactly as on the Patients-tab thread. The safety
/// audit trail (triage verdict, grounding, latency) stays on every AI reply,
/// because judging those answers is why this screen exists.
class ChatReviewDetailScreen extends ConsumerStatefulWidget {
  const ChatReviewDetailScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<ChatReviewDetailScreen> createState() =>
      _ChatReviewDetailScreenState();
}

class _ChatReviewDetailScreenState
    extends ConsumerState<ChatReviewDetailScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();

  /// The message being quoted in the next reply.
  ChatReviewMessage? _replyingTo;
  bool _sending = false;

  /// So the one-time jump to the flagged message runs only on the first load,
  /// not on every three-second refetch under the doctor's scrolling.
  bool _didAutoScroll = false;

  /// Whether the newest message has scrolled out of view — drives the
  /// jump-to-latest button, the same affordance the care thread has.
  bool _showJump = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  /// This list is bottom-anchored (newest last), so "away from latest" means
  /// there is still a screenful or more below the current offset.
  void _onScroll() {
    if (!_scroll.hasClients) return;
    final away = _scroll.position.maxScrollExtent - _scroll.offset > 300;
    if (away != _showJump) setState(() => _showJump = away);
  }

  void _toLatest() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _refresh() => ref.invalidate(chatReviewDetailProvider(widget.sessionId));

  Future<void> _markReviewed() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .markReviewed(widget.sessionId);
      _refresh();
      ref.invalidate(
        chatReviewProvider((flagged: true, urgency: null, kind: 'care')),
      );
      messenger.showSnackBar(
        const SnackBar(content: Text('Marked as reviewed')),
      );
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update. Please try again.')),
      );
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .replyInSession(widget.sessionId, text, replyTo: _replyingTo?.id);
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      _refresh();
      messenger.showSnackBar(
        const SnackBar(content: Text('Sent to the patient')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// An already-uploaded photo, document or voice note (CareComposer does the
  /// upload) sent into the thread, threaded to the quoted message if any.
  Future<void> _sendAttachment(String assetId) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .replyInSession(
            widget.sessionId,
            _controller.text.trim(),
            attachments: [assetId],
            replyTo: _replyingTo?.id,
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      _refresh();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _togglePin(ChatReviewMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).setPinned(m.id, !m.pinned);
      _refresh();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _hide(ChatReviewMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).hideMessage(m.id);
      _refresh();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _deleteForEveryone(ChatReviewMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).deleteForEveryone(m.id);
      _refresh();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Brings the flagged turn into view once the thread has laid out — the doctor
  /// opened this row to read that message, so land near it rather than at the
  /// top of a long history. Falls back to the bottom (newest) when nothing is
  /// specifically flagged.
  void _autoScroll(List<ChatReviewMessage> messages) {
    if (_didAutoScroll || messages.isEmpty) return;
    _didAutoScroll = true;
    final flaggedIndex = messages.indexWhere((m) => m.flaggedByPatient);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      final max = _scroll.position.maxScrollExtent;
      final target =
          flaggedIndex < 0 ? max : max * (flaggedIndex / messages.length);
      _scroll.jumpTo(target.clamp(0.0, max));
    });
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(chatReviewDetailProvider(widget.sessionId));

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: async.maybeWhen(
          data: (d) => _ChatHeader(session: d.session),
          orElse: () => const Text('Conversation'),
        ),
        actions: [
          async.maybeWhen(
            data:
                (d) =>
                    d.session.flaggedForReview
                        ? Padding(
                          padding: const EdgeInsets.only(right: AppSpacing.sm),
                          child: TextButton.icon(
                            onPressed: _markReviewed,
                            icon: const Icon(Icons.check_rounded, size: 18),
                            label: const Text('Reviewed'),
                          ),
                        )
                        : const SizedBox.shrink(),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
      resizeToAvoidBottomInset: true,
      // A live conversation. The doctor reading a flagged thread should see a
      // message that arrives while they are reading it.
      body: AutoRefresh(
        onTick:
            (ref) => ref.invalidate(chatReviewDetailProvider(widget.sessionId)),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load conversation'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      onPressed: _refresh,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          data: (detail) {
            _autoScroll(detail.messages);
            final pinned =
                detail.messages
                    .where((m) => m.pinned && !m.deletedForEveryone)
                    .toList();
            return Column(
              children: [
                // The old session banner is gone: it repeated the patient's name
                // — now in the app bar with their photo — and stamped ROUTINE on
                // a thread where almost every message is routine, which told the
                // doctor nothing and cost a strip of the conversation.
                if (pinned.isNotEmpty) _PinnedBanner(messages: pinned),
                Expanded(
                  // Same WhatsApp-style wallpaper as the Patients-tab thread.
                  child: ChatBackground(
                    child: Stack(
                      children: [
                        ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.all(AppSpacing.md),
                          itemCount: detail.messages.length,
                          itemBuilder: (context, i) {
                            final m = detail.messages[i];
                            final dietician =
                                detail.messages
                                    .lastWhere(
                                      (x) =>
                                          x.role == 'dietician' &&
                                          (x.senderName ?? '').isNotEmpty,
                                      orElse: () => m,
                                    )
                                    .senderName;
                            return _MessageBubble(
                              isNutrition: detail.session.kind == 'nutrition',
                              dieticianName:
                                  detail.session.kind == 'nutrition'
                                      ? dietician
                                      : null,
                              message: m,
                              repliedTo:
                                  m.replyToId == null
                                      ? null
                                      : detail.messages
                                          .where((x) => x.id == m.replyToId)
                                          .firstOrNull,
                              onReply: () => setState(() => _replyingTo = m),
                              onTogglePin: () => _togglePin(m),
                              onHide: () => _hide(m),
                              // Only the doctor's own clinician turns are theirs to
                              // delete for everyone; the server enforces the same rule.
                              onDeleteForEveryone:
                                  m.isClinician
                                      ? () => _deleteForEveryone(m)
                                      : null,
                            );
                          },
                        ),
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: JumpToLatest(
                            visible: _showJump,
                            onTap: _toLatest,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_replyingTo != null)
                  _ReplyBar(
                    message: _replyingTo!,
                    onCancel: () => setState(() => _replyingTo = null),
                  ),
                // The real chat box — text, photos, documents and voice — posting
                // as role:'clinician' into the patient's own thread (by session id,
                // so this works for a nutrition thread the doctor is guiding too).
                CareComposer(
                  controller: _controller,
                  hint: 'Reply to this patient…',
                  sending: _sending,
                  onSend: _send,
                  onSendAttachment: _sendAttachment,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The quoted-turn strip shown above the composer while the doctor is replying.
class _ReplyBar extends StatelessWidget {
  const _ReplyBar({required this.message, required this.onCancel});

  final ChatReviewMessage message;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final who =
        message.isUser
            ? 'Patient'
            : message.isClinician
            ? 'You'
            : (message.senderName ?? 'Assistant');
    final preview =
        message.content.trim().isNotEmpty
            ? message.content.trim()
            : (message.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      color: scheme.surfaceContainerHigh.withValues(alpha: 0.6),
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 8, AppSpacing.sm, 8),
      child: Row(
        children: [
          Container(width: 3, height: 34, color: AppColors.accentOn(context)),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Replying to $who',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.accentOn(context),
                  ),
                ),
                Text(
                  preview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel reply',
            icon: const Icon(Icons.close_rounded, size: 20),
            onPressed: onCancel,
          ),
        ],
      ),
    );
  }
}

/// The pinned messages, kept at the top of the thread — the "current pin
/// message" the doctor asked to see, tappable to unpin.
class _PinnedBanner extends StatelessWidget {
  const _PinnedBanner({required this.messages});

  final List<ChatReviewMessage> messages;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final m = messages.first;
    final text =
        m.content.trim().isNotEmpty
            ? m.content.trim()
            : (m.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: 8,
      ),
      color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
      child: Row(
        children: [
          Icon(
            Icons.push_pin_rounded,
            size: 15,
            color: AppColors.accentOn(context),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              messages.length > 1 ? '${messages.length} pinned · $text' : text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// The conversation's own header: who this is, straight through to their
/// record, and a way to phone them.
///
/// The screen used to be titled "Conversation" over an audit panel, which read
/// as a log viewer rather than a chat — the doctor could not see at a glance
/// whose words they were reading, and had to go back out to reach the record.
class _ChatHeader extends ConsumerWidget {
  const _ChatHeader({required this.session});

  final ChatReviewSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final id = session.patientId;
    final summary =
        id == null ? null : ref.watch(patientSummaryProvider(id)).valueOrNull;

    return Row(
      children: [
        GestureDetector(
          onTap:
              id == null ? null : () => context.push('/clinician/patients/$id'),
          child: UserAvatar(
            name: session.patientName ?? '',
            avatarUrl: summary?.avatarUrl,
            accent: AppColors.accentOn(context),
            size: 38,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: GestureDetector(
            onTap:
                id == null
                    ? null
                    : () => context.push('/clinician/patients/$id'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  session.patientName ?? 'Patient',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  session.kind == 'nutrition' ? 'Nutrition chat' : 'Care chat',
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        // An explicit way into the record. Tapping the name works too, but a
        // name is not obviously a link — the icon says the record is one tap
        // away without the doctor having to discover it.
        if (id != null)
          IconButton(
            tooltip: 'Open patient record',
            onPressed: () => context.push('/clinician/patients/$id'),
            icon: const Icon(Icons.account_circle_outlined),
          ),
        if (summary?.phone.isNotEmpty == true)
          IconButton(
            tooltip: 'Call patient',
            onPressed:
                () => launchUrl(Uri(scheme: 'tel', path: summary!.phone)),
            icon: const Icon(Icons.call_rounded),
          ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    this.isNutrition = false,
    this.dieticianName,
    this.repliedTo,
    this.onReply,
    this.onTogglePin,
    this.onHide,
    this.onDeleteForEveryone,
  });

  final ChatReviewMessage message;

  /// Whether this turn is in the dietician's thread, which changes what the
  /// assistant is called.
  final bool isNutrition;

  /// The dietician on this thread, so the assistant can be named after them.
  final String? dieticianName;
  final ChatReviewMessage? repliedTo;
  final VoidCallback? onReply;
  final VoidCallback? onTogglePin;
  final VoidCallback? onHide;
  final VoidCallback? onDeleteForEveryone;

  /// Long-press sheet: copy, reply, pin, delete-for-me, and (own turns only)
  /// delete-for-everyone — the same set the patient and doctor threads offer.
  Future<void> _showActions(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    await showModalBottomSheet<void>(
      context: context,
      builder:
          (sheet) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (message.content.trim().isNotEmpty)
                  ListTile(
                    leading: const Icon(Icons.copy_rounded),
                    title: const Text('Copy'),
                    onTap: () async {
                      Navigator.pop(sheet);
                      await Clipboard.setData(
                        ClipboardData(text: message.content),
                      );
                      messenger.showSnackBar(
                        const SnackBar(content: Text('Copied')),
                      );
                    },
                  ),
                if (onReply != null)
                  ListTile(
                    leading: const Icon(Icons.reply_rounded),
                    title: const Text('Reply'),
                    onTap: () {
                      Navigator.pop(sheet);
                      onReply!();
                    },
                  ),
                if (onTogglePin != null)
                  ListTile(
                    leading: Icon(
                      message.pinned ? Icons.push_pin : Icons.push_pin_outlined,
                    ),
                    title: Text(message.pinned ? 'Unpin' : 'Pin to top'),
                    onTap: () {
                      Navigator.pop(sheet);
                      onTogglePin!();
                    },
                  ),
                if (onHide != null)
                  ListTile(
                    leading: const Icon(Icons.visibility_off_outlined),
                    title: const Text('Delete for me'),
                    subtitle: const Text(
                      'Stays in the record; only removed from your view',
                      style: TextStyle(fontSize: 12),
                    ),
                    onTap: () {
                      Navigator.pop(sheet);
                      onHide!();
                    },
                  ),
                if (onDeleteForEveryone != null)
                  ListTile(
                    leading: Icon(
                      Icons.delete_outline_rounded,
                      color: AppColors.danger,
                    ),
                    title: Text(
                      'Delete for everyone',
                      style: TextStyle(color: AppColors.danger),
                    ),
                    onTap: () async {
                      Navigator.pop(sheet);
                      if (!context.mounted) return;
                      final ok = await showDialog<bool>(
                        context: context,
                        builder:
                            (dialog) => AlertDialog(
                              title: const Text('Delete for everyone'),
                              content: const Text(
                                "This message will be removed for everyone in the chat. This can't be undone.",
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, false),
                                  child: const Text('Cancel'),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, true),
                                  style: TextButton.styleFrom(
                                    foregroundColor: AppColors.danger,
                                  ),
                                  child: const Text('Delete for everyone'),
                                ),
                              ],
                            ),
                      );
                      if (ok == true) onDeleteForEveryone!();
                    },
                  ),
              ],
            ),
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final m = message;
    final isUser = m.isUser;
    final isClinician = m.isClinician;
    // Without this a dietician's message fell through to the assistant branch
    // and was labelled "Assistant" — the doctor reviewing the thread would have
    // read a human colleague's words as machine output.
    final isDietician = m.role == 'dietician';
    final isPerson = isClinician || isDietician;

    // Deleted for everyone: a muted tombstone in place of the turn.
    if (m.deletedForEveryone) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: Align(
          alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.block_rounded,
                  size: 15,
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Text(
                  'This message was deleted',
                  style: TextStyle(
                    fontSize: 14,
                    fontStyle: FontStyle.italic,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // Sides follow whose screen this is, as every messaging app does: the
    // reader's own words on the right, everyone else's on the left. This is the
    // doctor's screen, so the clinic's replies go right and the patient, the
    // assistant and the dietician all sit left together.
    //
    // It used to be the other way round — the patient's messages on the right —
    // which read as though the doctor were looking at the patient's phone.
    final isMine = isClinician;
    final align = isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    final bubbleColor =
        isMine ? AppColors.bubbleMine(context) : scheme.surfaceContainerHighest;
    final onBubble = isMine ? Colors.white : scheme.onSurface;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Column(
        crossAxisAlignment: align,
        children: [
          Row(
            mainAxisAlignment:
                isMine ? MainAxisAlignment.end : MainAxisAlignment.start,
            children: [
              // Who spoke, drawn the way the care thread draws it: a real
              // face for a real person, the app's own mark for the assistant,
              // and nothing at all for the patient — whose photo and name are
              // already in the app bar above.
              if (isDietician)
                UserAvatar(
                  name: m.senderName ?? '',
                  avatarUrl: m.senderAvatarUrl,
                  accent: AppColors.accentOn(context),
                  size: 22,
                )
              else if (isClinician)
                Icon(
                  Icons.medical_information_rounded,
                  size: 15,
                  color: AppColors.accentOn(context),
                )
              else if (!isUser)
                Container(
                  width: 22,
                  height: 22,
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: AppColors.accentSoftOn(context),
                    shape: BoxShape.circle,
                  ),
                  child: Image.asset(
                    'assets/brand/medpin_emblem.png',
                    errorBuilder:
                        (_, _, _) => Icon(
                          Icons.smart_toy_outlined,
                          size: 13,
                          color: AppColors.accentOn(context),
                        ),
                  ),
                ),
              if (!isUser) const SizedBox(width: 4),
              Flexible(
                child: Text(
                  isUser
                      ? 'Patient'
                      : isDietician
                      ? '${m.senderName ?? 'Dietician'} · Dietician'
                      : isClinician
                      ? 'You / clinic'
                      // Named for whose protocols it is quoting. In a nutrition
                      // thread that is the dietician's plan, so their name goes
                      // on it — "Assistant" alone said nothing about whose
                      // advice the doctor was reading.
                      : (isNutrition
                          ? '${dieticianName ?? 'Dietitian'} Assistant'
                          : 'Assistant'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color:
                        isPerson
                            ? AppColors.accentOn(context)
                            : scheme.onSurfaceVariant,
                  ),
                ),
              ),
              if (m.flaggedByPatient) ...[
                const SizedBox(width: 4),
                Icon(
                  Icons.flag_rounded,
                  size: 14,
                  color: AppColors.warningOn(context),
                ),
                Text(
                  ' reported',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.warningOn(context),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 4),
          // The quoted turn this message answers.
          if (repliedTo != null || m.replyPreviewContent != null)
            Container(
              margin: const EdgeInsets.only(bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.82,
              ),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
                border: Border(
                  left: BorderSide(
                    color: AppColors.accentOn(context),
                    width: 3,
                  ),
                ),
              ),
              child: Text(
                repliedTo?.content ?? m.replyPreviewContent!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
              ),
            ),
          GestureDetector(
            onLongPress: () => _showActions(context),
            child: Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.82,
              ),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: bubbleColor,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // A photo is often the whole message. Rendering only the text
                  // left an empty bubble above the assistant's reply about a
                  // meal the doctor could not see.
                  if (m.imagePaths.isNotEmpty)
                    ChatAttachmentThumbs(paths: m.imagePaths),
                  for (final note in m.voiceNotes)
                    VoiceNotePlayer(note: note, onDark: false),
                  for (final doc in m.documents)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: ChatDocumentCard(doc: doc, onDark: false),
                    ),
                  if (m.content.trim().isNotEmpty)
                    isUser || isClinician
                        ? Text(
                          m.content,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: onBubble,
                          ),
                        )
                        : MarkdownText(
                          data: m.content,
                          selectable: true,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: onBubble,
                          ),
                        ),
                ],
              ),
            ),
          ),
          // Audit chips describe an assistant answer — a human reply has no
          // triage verdict, grounding or latency to account for.
          if (!isUser && !isClinician) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                if (m.urgency != 'routine')
                  _chip(
                    m.urgency.toUpperCase(),
                    AppColors.forUrgencyOn(context, m.urgency),
                  ),
                if (m.ruleDriven) _chip('rule-driven', AppColors.primary),
                if (m.isFallback) _chip('fallback', AppColors.warning),
                if (m.citations.isNotEmpty)
                  _chip(
                    '${m.citations.length} source${m.citations.length == 1 ? '' : 's'}',
                    const Color(0xFF6B7280),
                  ),
                if (m.latencyMs != null)
                  _chip(
                    '${(m.latencyMs! / 1000).toStringAsFixed(1)}s',
                    const Color(0xFF6B7280),
                  ),
              ],
            ),
            if (m.citations.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Sources: ${m.citations.join(', ')}',
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
    ),
  );
}
