import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/router/area.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/chat_background.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/widgets/surfaces.dart' show Status;
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
import 'widgets/inbox_states.dart';

/// One conversation, opened from the review queue or the nutrition inbox — the
/// real chat: the doctor can reply with photos and voice, pin, reply to and
/// delete messages. The safety audit trail (triage verdict, grounding, speed)
/// stays under every assistant reply, because judging those answers is why this
/// screen exists.
///
/// ---- What changed, and why -------------------------------------------------
///
/// The app bar held the photo, the name, a record button and a "Reviewed"
/// button, and the name was cut to "Kalyani Bandyopa…". "Reviewed" also read
/// as a state rather than an action. The name has the bar to itself now, the
/// photo and name lead to the record, and a flagged conversation says so in a
/// strip under the bar with "Mark reviewed" beside it.
///
/// The audit trail was a row of grey capsules — URGENT, rule-driven, fallback,
/// 2.4s. It is a sentence now, and the urgency is a word with its colour.
///
/// A message deleted by the patient left its tombstone on the right, the
/// doctor's side, because it still followed an old convention. It stays on the
/// side of whoever wrote it.
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
  final _loadedAt = LoadedAt();

  /// The message being quoted in the next reply.
  ChatReviewMessage? _replyingTo;
  bool _sending = false;

  /// So the one-time jump to the flagged message runs only on the first load,
  /// not on every refetch under the doctor's scrolling.
  bool _didAutoScroll = false;

  /// Whether the newest message has scrolled out of view.
  bool _showJump = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  /// Newest last, so "away from latest" means a screenful or more below.
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
      // Both lists: the flagged queue it leaves, and "All" where it now reads
      // Reviewed.
      ref.invalidate(chatReviewProvider);
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

  /// Brings the flagged turn into view once the thread has laid out — the
  /// doctor opened this row to read that message. Falls back to the newest.
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
    final caps = ref.watch(capabilitySetProvider);

    if (!mayReadConversations(caps)) {
      return Scaffold(
        backgroundColor: T.surface,
        appBar: AppBar(title: const Text('Conversation')),
        body: ListView(
          padding: const EdgeInsets.all(T.s4),
          children: const [NotYourRole(what: 'patients’ conversations')],
        ),
      );
    }

    final async = ref.watch(chatReviewDetailProvider(widget.sessionId));
    _loadedAt.note(widget.sessionId, async);
    final detail = async.valueOrNull;
    final mayReply = mayReplyInConversations(caps);

    // The bar grows with the text size, so a two-line name is never cut.
    final barHeight = MediaQuery.textScalerOf(
      context,
    ).scale(T.s12 + T.s4).clamp(kToolbarHeight, T.s12 * 2);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(
        toolbarHeight: barHeight,
        titleSpacing: 0,
        title:
            detail == null
                ? const Text('Conversation')
                : _ChatHeader(session: detail.session),
        actions: [
          if (detail != null) _CallAction(session: detail.session),
          const SizedBox(width: T.s1),
        ],
      ),
      resizeToAvoidBottomInset: true,
      // A live conversation: a message that arrives while the doctor is
      // reading appears without leaving the screen.
      body: AutoRefresh(
        onTick:
            (ref) => ref.invalidate(chatReviewDetailProvider(widget.sessionId)),
        child: _body(async, detail, mayReply),
      ),
    );
  }

  Widget _body(
    AsyncValue<ChatReviewDetail> async,
    ChatReviewDetail? detail,
    bool mayReply,
  ) {
    if (detail == null) {
      if (async.hasError) {
        return ListView(
          padding: const EdgeInsets.all(T.s4),
          children: [
            if (refusedForRole(async.error))
              const NotYourRole(what: 'patients’ conversations')
            else
              LoadFailed(what: 'the conversation', onRetry: _refresh),
          ],
        );
      }
      return const Center(child: CircularProgressIndicator());
    }

    _autoScroll(detail.messages);
    final pinned =
        detail.messages
            .where((m) => m.pinned && !m.deletedForEveryone)
            .toList();
    final nutrition = detail.session.kind == 'nutrition';
    final dietician =
        detail.messages
            .where(
              (x) => x.role == 'dietician' && (x.senderName ?? '').isNotEmpty,
            )
            .lastOrNull
            ?.senderName;

    return Column(
      children: [
        if (detail.session.flaggedForReview)
          _ReviewStrip(onMarkReviewed: _markReviewed),
        if (async.hasError)
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, 0),
            child: StaleNotice.english(
              context: context,
              what: 'the conversation',
              loadedAt: _loadedAt[widget.sessionId],
              onRetry: _refresh,
            ),
          ),
        if (pinned.isNotEmpty) _PinnedBanner(messages: pinned),
        Expanded(
          child: ChatBackground(
            child: Stack(
              children: [
                ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(T.s4),
                  itemCount: detail.messages.length,
                  itemBuilder: (context, i) {
                    final m = detail.messages[i];
                    return _MessageBubble(
                      message: m,
                      isNutrition: nutrition,
                      dieticianName: nutrition ? dietician : null,
                      repliedTo:
                          m.replyToId == null
                              ? null
                              : detail.messages
                                  .where((x) => x.id == m.replyToId)
                                  .firstOrNull,
                      onReply:
                          mayReply
                              ? () => setState(() => _replyingTo = m)
                              : null,
                      onTogglePin: () => _togglePin(m),
                      onHide: () => _hide(m),
                      // Only the clinic's own turns may be deleted for
                      // everyone; the server enforces the same rule.
                      onDeleteForEveryone:
                          m.isClinician ? () => _deleteForEveryone(m) : null,
                    );
                  },
                ),
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: JumpToLatest(visible: _showJump, onTap: _toLatest),
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
        if (mayReply)
          // The real chat box — text, photos, documents and voice — posting as
          // the clinic into the patient's own thread, by session id, so it
          // works for a nutrition thread the doctor is guiding too.
          CareComposer(
            controller: _controller,
            hint: 'Reply to this patient…',
            sending: _sending,
            onSend: _send,
            onSendAttachment: _sendAttachment,
          )
        else
          const _ReadOnlyNote(),
      ],
    );
  }
}

/// A flagged conversation, said under the bar, with the one thing to do about
/// it.
class _ReviewStrip extends StatelessWidget {
  const _ReviewStrip({required this.onMarkReviewed});

  final VoidCallback onMarkReviewed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s2, T.s2),
      decoration: const BoxDecoration(
        color: T.warningTint,
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Row(
        children: [
          const Icon(Icons.flag_outlined, color: T.warning),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Flagged for review',
                  style: T.small.copyWith(
                    color: T.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  'Read it, then mark it reviewed to take it off the list.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onMarkReviewed,
            child: const Text('Mark reviewed'),
          ),
        ],
      ),
    );
  }
}

/// Where the composer would be, for a role that may read but not answer.
class _ReadOnlyNote extends StatelessWidget {
  const _ReadOnlyNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: T.surfaceRaised,
        border: Border(top: BorderSide(color: T.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(T.s4),
          child: Text(
            'Your role can read this conversation but not reply to it.',
            style: T.small.copyWith(color: T.inkMuted),
          ),
        ),
      ),
    );
  }
}

/// The quoted-turn strip shown above the composer while the doctor replies.
class _ReplyBar extends StatelessWidget {
  const _ReplyBar({required this.message, required this.onCancel});

  final ChatReviewMessage message;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final who =
        message.isUser
            ? 'the patient'
            : message.isClinician
            ? (message.senderName ?? 'the clinic')
            : (message.senderName ?? 'the assistant');
    final preview =
        message.content.trim().isNotEmpty
            ? message.content.trim()
            : (message.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      decoration: const BoxDecoration(
        color: T.surfaceRaised,
        border: Border(top: BorderSide(color: T.line)),
      ),
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s1, T.s2),
      child: Row(
        children: [
          Container(width: T.s1, height: T.s8, color: T.primary),
          const SizedBox(width: T.s2),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Replying to $who',
                  style: T.label.copyWith(color: T.primary),
                ),
                Text(
                  preview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel reply',
            icon: const Icon(Icons.close_rounded),
            onPressed: onCancel,
          ),
        ],
      ),
    );
  }
}

/// The pinned messages, kept at the top of the thread.
class _PinnedBanner extends StatelessWidget {
  const _PinnedBanner({required this.messages});

  final List<ChatReviewMessage> messages;

  @override
  Widget build(BuildContext context) {
    final m = messages.first;
    final text =
        m.content.trim().isNotEmpty
            ? m.content.trim()
            : (m.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s2),
      decoration: const BoxDecoration(
        color: T.surfaceRaised,
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Row(
        children: [
          const Icon(Icons.push_pin_outlined, size: T.s4, color: T.primary),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(
              messages.length > 1 ? '${messages.length} pinned · $text' : text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ),
        ],
      ),
    );
  }
}

/// Who this is — photo and name leading to their record — and which thread.
class _ChatHeader extends ConsumerWidget {
  const _ChatHeader({required this.session});

  final ChatReviewSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = session.patientId;
    final name = session.patientName ?? 'Patient';
    final summary =
        id == null ? null : ref.watch(patientSummaryProvider(id)).valueOrNull;

    final content = Row(
      children: [
        UserAvatar(
          name: nameForInitial(name),
          avatarUrl: summary?.avatarUrl,
          accent: T.primary,
          size: T.s8 + T.s1,
        ),
        const SizedBox(width: T.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.bodyStrong.copyWith(color: T.ink, height: 1.25),
              ),
              Text(
                [
                  session.kind == 'nutrition' ? 'Nutrition chat' : 'Care chat',
                  if (id != null) 'View record',
                ].join(' · '),
                style: T.label.copyWith(color: T.primary, letterSpacing: 0),
              ),
            ],
          ),
        ),
      ],
    );

    if (id == null) return content;
    return Semantics(
      button: true,
      label: 'Open $name’s record',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(T.rControl),
        onTap: () => context.push('${areaPrefix(ref)}/patients/$id'),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          child: content,
        ),
      ),
    );
  }
}

/// Ring the patient, when the record has a number.
class _CallAction extends ConsumerWidget {
  const _CallAction({required this.session});

  final ChatReviewSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = session.patientId;
    final phone =
        id == null
            ? null
            : ref.watch(patientSummaryProvider(id)).valueOrNull?.phone;
    if (phone == null || phone.isEmpty) return const SizedBox.shrink();
    return IconButton(
      tooltip: 'Call ${session.patientName ?? 'the patient'}',
      onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
      icon: const Icon(Icons.call_outlined, color: T.primary),
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
  /// delete-for-everyone.
  Future<void> _showActions(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
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
                    subtitle: Text(
                      'Stays in the record; only removed from your view',
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                    onTap: () {
                      Navigator.pop(sheet);
                      onHide!();
                    },
                  ),
                if (onDeleteForEveryone != null)
                  ListTile(
                    leading: const Icon(
                      Icons.delete_outline_rounded,
                      color: T.danger,
                    ),
                    title: Text(
                      'Delete for everyone',
                      style: T.body.copyWith(color: T.danger),
                    ),
                    onTap: () async {
                      Navigator.pop(sheet);
                      if (!context.mounted) return;
                      final ok = await showDialog<bool>(
                        context: context,
                        builder:
                            (dialog) => AlertDialog(
                              title: const Text('Delete for everyone?'),
                              content: const Text(
                                'This message will be removed for everyone in '
                                'the chat. This cannot be undone.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, false),
                                  child: const Text('Cancel'),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, true),
                                  style: TextButton.styleFrom(
                                    foregroundColor: T.danger,
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
    final m = message;
    final isUser = m.isUser;
    final isClinician = m.isClinician;
    // Without this a dietician's message fell through to the assistant branch
    // and was labelled "Assistant" — a colleague's words read as machine
    // output.
    final isDietician = m.role == 'dietician';
    final isAssistant = !isUser && !isClinician && !isDietician;

    // Sides follow whose screen this is: the clinic's replies on the right,
    // the patient, the assistant and the dietician together on the left.
    final isMine = isClinician;
    final maxWidth = MediaQuery.sizeOf(context).width * 0.82;

    // Deleted for everyone: a muted tombstone on its author's side.
    if (m.deletedForEveryone) {
      return Padding(
        padding: const EdgeInsets.only(bottom: T.s4),
        child: Align(
          alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: T.s3,
              vertical: T.s2,
            ),
            decoration: BoxDecoration(
              color: T.surfaceRaised,
              borderRadius: BorderRadius.circular(T.rControl),
              border: Border.all(color: T.line),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.block_rounded, size: T.s4, color: T.inkMuted),
                const SizedBox(width: T.s2),
                Text(
                  'This message was deleted',
                  style: T.small.copyWith(
                    fontStyle: FontStyle.italic,
                    color: T.inkMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final who =
        isUser
            ? 'Patient'
            : isDietician
            ? '${m.senderName ?? 'Dietician'} · Dietician'
            : isClinician
            ? (m.senderName ?? 'Clinic')
            // Named for whose protocols it is quoting. In a nutrition thread
            // that is the dietician's plan, so their name goes on it.
            : (isNutrition
                ? '${dieticianName ?? 'Dietician'}’s assistant'
                : 'Assistant');

    final (Color fill, Color? border, Color ink) =
        isMine
            ? (T.primary, null, T.surfaceRaised)
            : isAssistant
            ? (T.primaryTint, null, T.ink)
            : (T.surfaceRaised, T.line, T.ink);

    final textStyle = T.body.copyWith(color: ink);

    return Padding(
      padding: const EdgeInsets.only(bottom: T.s4),
      child: Column(
        crossAxisAlignment:
            isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isDietician) ...[
                UserAvatar(
                  name: nameForInitial(m.senderName ?? ''),
                  avatarUrl: m.senderAvatarUrl,
                  accent: T.primary,
                  size: T.s6,
                ),
                const SizedBox(width: T.s1),
              ] else if (isAssistant) ...[
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: T.s4,
                  color: T.primary,
                ),
                const SizedBox(width: T.s1),
              ],
              Flexible(
                child: Text(
                  who,
                  style: T.label.copyWith(
                    color: isUser ? T.inkMuted : T.primary,
                    letterSpacing: 0,
                  ),
                ),
              ),
              if (m.flaggedByPatient) ...[
                const SizedBox(width: T.s2),
                TonePill(
                  label: 'Reported by the patient',
                  status: Status.watch,
                  icon: Icons.flag_outlined,
                ),
              ],
            ],
          ),
          const SizedBox(height: T.s1),
          // The quoted turn this message answers.
          if (repliedTo != null || m.replyPreviewContent != null)
            Container(
              margin: const EdgeInsets.only(bottom: T.s1),
              padding: const EdgeInsets.all(T.s2),
              constraints: BoxConstraints(maxWidth: maxWidth),
              decoration: BoxDecoration(
                color: T.surfaceRaised,
                borderRadius: BorderRadius.circular(T.rControl),
                border: const Border(
                  left: BorderSide(color: T.primary, width: 3),
                ),
              ),
              child: Text(
                repliedTo?.content ?? m.replyPreviewContent!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.small.copyWith(color: T.inkMuted),
              ),
            ),
          GestureDetector(
            onLongPress: () => _showActions(context),
            child: Container(
              constraints: BoxConstraints(maxWidth: maxWidth),
              padding: const EdgeInsets.all(T.s3),
              decoration: BoxDecoration(
                color: fill,
                borderRadius: BorderRadius.circular(T.rControl),
                border: border == null ? null : Border.all(color: border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // A photo is often the whole message.
                  if (m.imagePaths.isNotEmpty)
                    ChatAttachmentThumbs(paths: m.imagePaths),
                  for (final note in m.voiceNotes)
                    VoiceNotePlayer(note: note, onDark: isMine),
                  for (final doc in m.documents)
                    Padding(
                      padding: const EdgeInsets.only(bottom: T.s1),
                      child: ChatDocumentCard(doc: doc, onDark: isMine),
                    ),
                  if (m.content.trim().isNotEmpty)
                    isUser || isClinician
                        ? Text(m.content, style: textStyle)
                        : MarkdownText(
                          data: m.content,
                          selectable: true,
                          style: textStyle,
                        ),
                ],
              ),
            ),
          ),
          // The audit trail describes an assistant answer — a human reply has
          // no triage verdict, grounding or speed to account for.
          if (isAssistant) ...[
            const SizedBox(height: T.s1),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: _AuditLine(message: m),
            ),
          ],
        ],
      ),
    );
  }
}

/// What the doctor needs to judge an assistant answer, as one sentence.
class _AuditLine extends StatelessWidget {
  const _AuditLine({required this.message});

  final ChatReviewMessage message;

  @override
  Widget build(BuildContext context) {
    final m = message;
    final muted = T.small.copyWith(color: T.inkMuted);
    final urgency = switch (m.urgency) {
      'emergency' => ('Triage: emergency', T.danger),
      'urgent' => ('Triage: urgent', T.danger),
      'advice' => ('Triage: advice given', T.inkMuted),
      _ => null,
    };

    final parts = <InlineSpan>[
      if (urgency != null)
        TextSpan(
          text: urgency.$1,
          style: muted.copyWith(color: urgency.$2, fontWeight: FontWeight.w600),
        ),
      if (m.ruleDriven) const TextSpan(text: 'Answered by a safety rule'),
      if (m.isFallback)
        TextSpan(
          text: 'Fallback reply',
          style: muted.copyWith(color: T.warning, fontWeight: FontWeight.w600),
        ),
      // Non-breaking spaces bind each figure to its unit: "2" at the end of
      // one line and "sources" at the start of the next reads as two facts.
      if (m.citations.isNotEmpty)
        TextSpan(
          text:
              '${m.citations.length} ${m.citations.length == 1 ? 'source' : 'sources'}',
        ),
      if (m.latencyMs != null)
        TextSpan(text: '${(m.latencyMs! / 1000).toStringAsFixed(1)} s'),
    ];
    if (parts.isEmpty) return const SizedBox.shrink();

    final joined = <InlineSpan>[
      for (var i = 0; i < parts.length; i++) ...[
        if (i > 0) const TextSpan(text: ' · '),
        parts[i],
      ],
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(TextSpan(children: joined), style: muted),
        if (m.citations.isNotEmpty)
          Text('Sources: ${m.citations.join(', ')}', style: muted),
      ],
    );
  }
}
