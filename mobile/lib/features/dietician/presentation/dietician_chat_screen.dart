import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../shared/widgets/chat_background.dart';
import '../../../shared/widgets/markdown_text.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import '../../../shared/widgets/pinned_banner.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../chat/data/chat_repository.dart';
import '../../chat/presentation/widgets/care_composer.dart';
import '../../chat/presentation/widgets/chat_attachment_thumbs.dart';
import '../../chat/presentation/widgets/chat_document_card.dart';
import '../../chat/presentation/widgets/voice_note_player.dart';
import '../../chat/presentation/widgets/jump_to_latest.dart';
import '../data/dietician_repository.dart';
import '../domain/diet_models.dart';
import 'dietician_providers.dart';
import '../../chat/presentation/widgets/edit_message_sheet.dart';
import '../../chat/domain/chat_message.dart';
import '../../chat/presentation/widgets/assistant_control.dart';

/// The dietician's side of the patient's care conversation. The dietician's
/// replies land in the same thread the patient reads (as the doctor's do), so
/// there is a single food + care conversation, never two half-conversations.
class DieticianChatScreen extends ConsumerStatefulWidget {
  const DieticianChatScreen({
    super.key,
    required this.patientId,
    this.patientName,
  });

  final String patientId;
  final String? patientName;

  @override
  ConsumerState<DieticianChatScreen> createState() =>
      _DieticianChatScreenState();
}

class _DieticianChatScreenState extends ConsumerState<DieticianChatScreen>
    with WidgetsBindingObserver {
  /// Beats while this screen is up.
  ClinicianPresence? _presence;

  final _controller = TextEditingController();

  /// A positioned list, not a plain one: scrolling to a message that has not
  /// been built is something only this can do, and both the pinned banner and a
  /// reply quote need exactly that.
  final ItemScrollController _itemScroll = ItemScrollController();
  final ItemPositionsListener _itemPositions = ItemPositionsListener.create();

  /// Ids in the order the list draws them, so a message id can be turned into
  /// an index without rebuilding the list to find out.
  List<String> _order = const [];
  bool _sending = false;

  /// The message the dietician is quoting in their next reply.
  DietMessage? _replyingTo;

  /// The list is reversed, so "at the latest" is offset 0.
  bool _showJump = false;

  /// Which pinned message the banner is showing. Tapping cycles through them
  /// when the dietician has pinned more than one.
  int _pinnedIndex = 0;

  /// The other side of this conversation is a person, not a form. Without a
  /// poll their reply sat on the server until the screen happened to be rebuilt
  /// — which for a thread the reader is staring at means never. The care thread
  /// has always done this; the nutrition one was the half that did not.
  Timer? _poll;
  static const _pollInterval = Duration(seconds: 8);

  @override
  void initState() {
    super.initState();
    // Hold the assistant back for as long as this screen is up. The beat
    // stops in dispose, and lapses by itself if the app never gets there.
    _presence = ClinicianPresence(
      ref,
      patientId: widget.patientId,
      kind: ThreadKind.nutrition,
    )..start();
    _itemPositions.itemPositions.addListener(_onScroll);
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) {
      if (mounted) ref.invalidate(dietThreadProvider(widget.patientId));
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      ref.invalidate(dietThreadProvider(widget.patientId));
    }
  }

  void _onScroll() {
    final positions = _itemPositions.itemPositions.value;
    if (positions.isEmpty) return;
    // Reversed list: index 0 is the newest message. Off screen means the reader
    // has scrolled back through the thread.
    final away = !positions.any((p) => p.index == 0);
    if (away != _showJump) setState(() => _showJump = away);
  }

  void _toLatest() {
    if (!_itemScroll.isAttached) return;
    _itemScroll.scrollTo(
      index: 0,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  /// Scrolls to a message by id — from the pinned banner or a reply quote.
  ///
  /// Does nothing when the id is not in the loaded thread: a quote can outlive
  /// the window of messages the screen holds, and jumping somewhere arbitrary
  /// would be worse than not moving.
  void _scrollToMessage(String? messageId) {
    if (messageId == null || !_itemScroll.isAttached) return;
    final index = _order.indexOf(messageId);
    if (index < 0) return;
    _itemScroll.scrollTo(
      index: index,
      alignment: 0.3,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeInOut,
    );
  }

  @override
  void dispose() {
    _presence?.stop();
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _itemPositions.itemPositions.removeListener(_onScroll);
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    final replyTo = _replyingTo?.id;
    try {
      await ref
          .read(dieticianRepositoryProvider)
          .sendMessage(widget.patientId, content: text, replyTo: replyTo);
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      ref.invalidate(dietThreadProvider(widget.patientId));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Posts an already-uploaded photo, document or voice note.
  Future<void> _sendAttachment(String assetId) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(dieticianRepositoryProvider)
          .sendMessage(
            widget.patientId,
            content: _controller.text.trim(),
            attachments: [assetId],
            replyTo: _replyingTo?.id,
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      ref.invalidate(dietThreadProvider(widget.patientId));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Pin / unpin, delete-for-me (hide) and delete-for-everyone all act on the
  /// shared `/chat/messages/:id/*` endpoints — the same ones the patient and
  /// doctor threads use — so the state stays consistent across all three panels.
  Future<void> _togglePin(DietMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).setPinned(m.id, !m.pinned);
      ref.invalidate(dietThreadProvider(widget.patientId));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _hide(DietMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).hideMessage(m.id);
      ref.invalidate(dietThreadProvider(widget.patientId));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _deleteForEveryone(DietMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).deleteForEveryone(m.id);
      ref.invalidate(dietThreadProvider(widget.patientId));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// The banner for whichever message is currently being shown, or null when
  /// nothing is pinned.
  List<Widget> _pinnedBanner(List<DietMessage> messages) {
    final pinned =
        messages.where((m) => m.pinned && !m.deletedForEveryone).toList();
    if (pinned.isEmpty) return const [];
    final shown = pinned[_pinnedIndex.clamp(0, pinned.length - 1)];

    return [
      PinnedBanner(
        preview:
            shown.content.trim().isEmpty ? 'Attachment' : shown.content.trim(),
        count: pinned.length,
        // Jump to it, and with several pinned move on to the next one.
        onTap: () {
          _scrollToMessage(shown.id);
          if (pinned.length > 1) {
            setState(() => _pinnedIndex = (_pinnedIndex + 1) % pinned.length);
          }
        },
        onUnpin: () => _togglePin(shown),
      ),
    ];
  }

  /// Rewrite one of our own turns, then reload so the thread shows the new
  /// words and the "edited" mark. The sheet reports its own failures.
  Future<void> _editMessage(DietMessage message) async {
    final saved = await showEditMessageSheet(
      context,
      ref,
      ChatMessage(
        id: message.id,
        seq: 0,
        role: message.role,
        content: message.content,
        language: 'en',
        urgency: 'routine',
        createdAt: message.createdAt,
      ),
    );
    if (saved && mounted) ref.invalidate(dietThreadProvider(widget.patientId));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(dietThreadProvider(widget.patientId));
    final overview =
        ref.watch(dietOverviewProvider(widget.patientId)).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            UserAvatar(
              name: overview?.name ?? widget.patientName ?? '',
              avatarUrl: overview?.avatarUrl,
              accent: AppColors.accentOn(context),
              size: 38,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    overview?.name ?? widget.patientName ?? 'Patient',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    'Nutrition chat',
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          AssistantToggle(
            patientId: widget.patientId,
            kind: ThreadKind.nutrition,
          ),
          if (overview?.phone.isNotEmpty == true)
            IconButton(
              tooltip: 'Call patient',
              onPressed:
                  () => launchUrl(Uri(scheme: 'tel', path: overview!.phone)),
              icon: const Icon(Icons.call_rounded),
            ),
          const SizedBox(width: 4),
        ],
      ),
      // The same wallpaper the patient and the doctor see. A different backdrop
      // per panel would read as three products showing three different threads.
      body: ChatBackground(
        child: Column(
          children: [
            // Held at the top, the way the care thread holds it. A pin is worth
            // nothing if you have to find the message again to read it.
            ..._pinnedBanner(async.valueOrNull ?? const <DietMessage>[]),
            Expanded(
              // Floats over the thread rather than taking a row of its own — in
              // the column it covered the newest message instead of hovering
              // above it. See the patient's side of this thread.
              child: Stack(
                children: [
                  async.when(
                    loading:
                        () => const Center(child: CircularProgressIndicator()),
                    error:
                        (_, _) => Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text('Could not load the conversation'),
                              const SizedBox(height: AppSpacing.sm),
                              OutlinedButton(
                                onPressed:
                                    () => ref.invalidate(
                                      dietThreadProvider(widget.patientId),
                                    ),
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                    data: (messages) {
                      final shown =
                          messages.where((m) => m.role != 'system').toList();
                      if (shown.isEmpty) {
                        return Center(
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.xl),
                            child: Text(
                              'Say hello and share your first food guidance.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: scheme.onSurfaceVariant),
                            ),
                          ),
                        );
                      }
                      // Ids in draw order, for _scrollToMessage. Set here
                      // rather than in build so it always matches the list that
                      // was actually rendered.
                      _order = [
                        for (var i = 0; i < shown.length; i++)
                          shown[shown.length - 1 - i].id,
                      ];
                      return ScrollablePositionedList.builder(
                        itemScrollController: _itemScroll,
                        itemPositionsListener: _itemPositions,
                        reverse: true,
                        padding: const EdgeInsets.fromLTRB(
                          AppSpacing.md,
                          AppSpacing.md,
                          AppSpacing.md,
                          AppSpacing.md + 48,
                        ),
                        itemCount: shown.length,
                        itemBuilder: (context, i) {
                          final m = shown[shown.length - 1 - i];
                          return _Bubble(
                            message: m,
                            repliedTo:
                                m.replyToId == null
                                    ? null
                                    : shown
                                        .where((x) => x.id == m.replyToId)
                                        .firstOrNull,
                            onQuoteTap:
                                m.replyToId == null
                                    ? null
                                    : () => _scrollToMessage(m.replyToId),
                            onReply: () => setState(() => _replyingTo = m),
                            onEdit:
                                m.role == 'dietician' || m.role == 'clinician'
                                    ? () => _editMessage(m)
                                    : null,
                            onTogglePin: () => _togglePin(m),
                            onHide: () => _hide(m),
                            // Only the dietician's own turns are theirs to delete
                            // for everyone; the server enforces the same rule.
                            onDeleteForEveryone:
                                m.fromDietician
                                    ? () => _deleteForEveryone(m)
                                    : null,
                          );
                        },
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
            if (_replyingTo != null)
              _DietReplyBar(
                message: _replyingTo!,
                onCancel: () => setState(() => _replyingTo = null),
              ),
            CareComposer(
              controller: _controller,
              hint: 'Recommend a meal or reply…',
              sending: _sending,
              onSend: _send,
              onSendAttachment: _sendAttachment,
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    this.repliedTo,
    this.onQuoteTap,
    this.onReply,
    this.onTogglePin,
    this.onEdit,
    this.onHide,
    this.onDeleteForEveryone,
  });

  final DietMessage message;
  final DietMessage? repliedTo;

  /// Goes to the message being quoted. Null when it is no longer loaded.
  final VoidCallback? onQuoteTap;
  final VoidCallback? onReply;
  final VoidCallback? onTogglePin;

  /// Rewrite this turn. Offered only on the dietician's own, still-editable
  /// message — the caller decides, as it does for pinning.
  final VoidCallback? onEdit;
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
                if (onEdit != null && message.canStillEdit)
                  ListTile(
                    leading: const Icon(Icons.edit_outlined),
                    title: const Text('Edit'),
                    subtitle: const Text(
                      'Within 15 minutes. The patient sees it was edited.',
                      style: TextStyle(fontSize: 12),
                    ),
                    onTap: () {
                      Navigator.pop(sheet);
                      onEdit!();
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
    final mine = message.fromDietician;

    // Deleted for everyone: a muted tombstone in place of the turn.
    if (message.deletedForEveryone) {
      return Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.only(bottom: AppSpacing.md),
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
      );
    }

    // Matches the patient's and doctor's bubbles: a badge and a name on every
    // received turn, so a thread carrying an AI, a doctor and a dietician never
    // leaves the reader guessing which of them said something.
    final (icon, label) = switch (message.role) {
      // The patient gets a label but no picture. Their photo and name are
      // already in this screen's header, so a second copy beside every message
      // only repeats it — but with a doctor, a dietician and an assistant all
      // writing into the same thread, an unlabelled turn is the one thing a
      // reader has to work out for themselves.
      'user' => (Icons.person_rounded, 'Patient'),
      'clinician' => (
        Icons.medical_information_rounded,
        message.senderName ?? 'Doctor',
      ),
      // Named for what it is and whose it is. "AI Assistant" alone could be any
      // of a dozen things a phone runs; this one answers from the clinic's own
      // nutrition protocols, and a dietician reading the thread needs to know
      // that a machine wrote it before they act on it.
      'assistant' => (
        Icons.smart_toy_rounded,
        'MedPin AI · nutrition assistant',
      ),
      _ => (Icons.restaurant_rounded, message.senderName ?? 'Dietician'),
    };

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        child: Column(
          crossAxisAlignment:
              mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            if (mine)
              Padding(
                padding: const EdgeInsets.only(right: 4, bottom: 4),
                child: Text(
                  'You',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(left: 0, bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // The patient's turns carry the label alone — their photo is
                    // already in the app bar, and repeating it down the thread
                    // said nothing the header had not said, and said it worse.
                    if (message.role != 'user')
                      Container(
                        width: 24,
                        height: 24,
                        padding:
                            message.role == 'assistant'
                                ? const EdgeInsets.all(4)
                                : null,
                        decoration: BoxDecoration(
                          color: AppColors.accentSoftOn(context),
                          shape: BoxShape.circle,
                        ),
                        // The assistant carries the app's own mark, the way it
                        // does in the patient's threads. A generic robot icon read
                        // as decoration; the emblem says which system is speaking,
                        // which is the whole point of marking these turns at all.
                        child:
                            message.role == 'assistant'
                                ? Image.asset(
                                  'assets/brand/medpin_emblem.png',
                                  errorBuilder:
                                      (_, _, _) => Icon(
                                        icon,
                                        size: 14,
                                        color: AppColors.accentOn(context),
                                      ),
                                )
                                : Icon(
                                  icon,
                                  size: 14,
                                  color: AppColors.accentOn(context),
                                ),
                      ),
                    if (message.role != 'user') const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color:
                              message.role == 'clinician'
                                  ? AppColors.accentOn(context)
                                  : scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    // A mark, not just a name. Written out, an assistant's turn
                    // and a dietician's differ only by the words in them —
                    // which is exactly the distinction a reader should not have
                    // to read for.
                    if (message.role == 'assistant') ...[
                      const SizedBox(width: 6),
                      const _SenderBadge(
                        label: 'AI',
                        icon: Icons.auto_awesome_rounded,
                        tone: Color(0xFF7C3AED),
                      ),
                    ] else if (message.role == 'dietician' ||
                        message.role == 'clinician') ...[
                      const SizedBox(width: 6),
                      _SenderBadge(
                        label:
                            message.role == 'clinician'
                                ? 'Doctor'
                                : 'Dietician',
                        icon: Icons.verified_rounded,
                        tone: AppColors.accentOn(context),
                      ),
                    ],
                  ],
                ),
              ),
            if (message.pinned)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.push_pin_rounded,
                      size: 13,
                      color: scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Pinned',
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            if (repliedTo != null || message.replyPreviewContent != null)
              GestureDetector(
                onTap: onQuoteTap,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 8,
                  ),
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
                    repliedTo?.content ?? message.replyPreviewContent!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            GestureDetector(
              onLongPress: () => _showActions(context),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color:
                      mine
                          ? AppColors.bubbleMine(context)
                          : scheme.surfaceContainerLow,
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(20),
                    topRight: const Radius.circular(20),
                    bottomLeft: Radius.circular(mine ? 20 : 6),
                    bottomRight: Radius.circular(mine ? 6 : 20),
                  ),
                  border:
                      mine
                          ? null
                          : Border.all(
                            color: scheme.outlineVariant.withValues(
                              alpha: 0.20,
                            ),
                          ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Rendered, not printed. The assistant answers in markdown
                    // and the dietician writes lists of foods; as plain text
                    // both arrived with their asterisks and dashes showing.
                    if (message.content.isNotEmpty)
                      MarkdownText(
                        data: message.content,
                        style: TextStyle(
                          fontSize: 16,
                          height: 1.5,
                          color: mine ? Colors.white : scheme.onSurface,
                        ),
                        bulletColor:
                            mine ? Colors.white : AppColors.accentOn(context),
                      ),
                    // The meal itself, not a count of it. This is the thread the
                    // patient photographs their food into, so "1 attachment" was
                    // the dietician being told a picture existed somewhere.
                    if (message.hasAttachments) ...[
                      if (message.content.isNotEmpty) const SizedBox(height: 8),
                      if (message.imagePaths.isNotEmpty)
                        ChatAttachmentThumbs(paths: message.imagePaths),
                      for (final note in message.voiceNotes)
                        VoiceNotePlayer(note: note, onDark: mine),
                      for (final doc in message.documents)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: ChatDocumentCard(doc: doc, onDark: mine),
                        ),
                    ],
                    if (message.createdAt != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        DateFormat('h:mm a').format(message.createdAt!),
                        style: TextStyle(
                          fontSize: 12,
                          color:
                              mine ? Colors.white70 : scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The quoted-turn strip above the composer while the dietician replies to a
/// specific message.
class _DietReplyBar extends StatelessWidget {
  const _DietReplyBar({required this.message, required this.onCancel});

  final DietMessage message;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final who =
        message.fromDietician
            ? 'yourself'
            : message.role == 'user'
            ? (message.senderName ?? 'Patient')
            : (message.senderName ?? 'the clinic');
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

/// Who wrote this turn, as a mark rather than a sentence.
///
/// Purple for the assistant and the brand blue with a verified tick for a
/// person: two different kinds of authority, and a dietician acting on a
/// dosing suggestion should be able to tell them apart at a glance rather than
/// by reading a byline.
class _SenderBadge extends StatelessWidget {
  const _SenderBadge({
    required this.label,
    required this.icon,
    required this.tone,
  });

  final String label;
  final IconData icon;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: tone),
          const SizedBox(width: 3),
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.3,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}
