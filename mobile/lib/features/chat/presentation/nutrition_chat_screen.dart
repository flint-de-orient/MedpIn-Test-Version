import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/chat_background.dart';
import 'widgets/assistant_disclaimer_banner.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import '../../../shared/widgets/pinned_banner.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/chat_message.dart';
import 'widgets/care_composer.dart';
import 'widgets/jump_to_latest.dart';
import 'widgets/chat_message_bubble.dart';
import 'widgets/edit_message_sheet.dart';

/// The patient's side of the dietician conversation.
///
/// Separate from the Assistant thread so diet coaching and clinical questions
/// do not interleave — but the server runs the *same* triage on anything sent
/// here. Which inbox a patient happens to pick must never decide whether a
/// worrying symptom reaches the clinic.
final nutritionThreadProvider = FutureProvider.autoDispose<List<ChatMessage>>((
  ref,
) async {
  final json = await ref.read(apiClientProvider).getJson('/chat/nutrition');
  final items = (json['items'] as List?) ?? const [];
  return items
      .whereType<Map<String, dynamic>>()
      .map(ChatMessage.fromJson)
      .toList();
});

class NutritionChatScreen extends ConsumerStatefulWidget {
  const NutritionChatScreen({super.key});

  @override
  ConsumerState<NutritionChatScreen> createState() =>
      _NutritionChatScreenState();
}

class _NutritionChatScreenState extends ConsumerState<NutritionChatScreen>
    with WidgetsBindingObserver {
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

  /// The list is reversed, so "at the latest" is offset 0.
  bool _showJump = false;

  /// Which pinned message the banner is showing. Tapping cycles through them
  /// when more than one is pinned.
  int _pinnedIndex = 0;

  /// The message being answered, shown above the composer until sent or
  /// dismissed. The care thread has always had this; the dietician thread
  /// offered only Copy on a long press, which made a reply to "which of these
  /// two?" impossible to aim.
  ChatMessage? _replyingTo;

  /// Just-recorded voice notes shown instantly (played from the local file)
  /// while they upload + post + reload — so the patient sees their message land
  /// at once instead of after three round-trips. Cleared once the reload brings
  /// the real message back (tracked via [_lastShownCount]).
  final List<ChatMessage> _pendingVoice = [];
  int _lastShownCount = 0;

  void _addPendingVoice(String path) {
    setState(() {
      _pendingVoice.add(
        ChatMessage(
          id: '__pending_${_pendingVoice.length}_${path.hashCode}__',
          seq: 1 << 30, // sorts to the very end (newest)
          role: 'user',
          content: '',
          language: 'en',
          urgency: 'routine',
          createdAt: DateTime.now(),
          voiceNotes: [VoiceNote(url: '', localPath: path)],
        ),
      );
    });
  }

  /// The app's displayed locale wins over the account language — so the dietician
  /// assistant answers in the language the patient is actually using, exactly as
  /// the doctor assistant does. The nutrition thread used to omit this, leaving
  /// the server to fall back to the account default (usually English).
  /// The language the app is *actually rendered in*, which is the one the
  /// assistant must answer in.
  ///
  /// This used to read the stored picker choice and fall back to the language
  /// on the account. Those two disagree the moment a patient never opens the
  /// picker: the UI resolves to English through the device locale while the
  /// account still says Bengali, so the whole screen was in English and the
  /// assistant answered in Bengali. `Localizations.localeOf` cannot disagree
  /// with what is on screen, because it *is* what is on screen.
  ///
  /// The account language stays as the fallback for the impossible case where
  /// the locale is not one of the three the clinic supports.
  String get _replyLanguage => resolveReplyLanguage(
    appLocale: Localizations.localeOf(context).languageCode,
    accountLanguage: ref.read(authControllerProvider).user?.language,
  );

  /// The other side of this conversation is a person, not a form. Without a
  /// poll their reply sat on the server until the screen happened to be rebuilt
  /// — which for a thread the reader is staring at means never. The care thread
  /// has always done this; the nutrition one was the half that did not.
  Timer? _poll;

  /// Two seconds in every thread, patient and clinician alike.
  ///
  /// The nutrition threads sat at eight, which is what "messages arrive late"
  /// actually was: a reply could be on the server for the better part of ten
  /// seconds before either side saw it, and leaving the screen and coming back
  /// fetched it immediately — which is precisely how it was reported.
  static const _pollInterval = Duration(seconds: 2);

  @override
  void initState() {
    super.initState();
    _itemPositions.itemPositions.addListener(_onScroll);
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) {
      if (mounted) ref.invalidate(nutritionThreadProvider);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back is when the thread is most likely to have moved on, so check
    // at once rather than waiting out the timer.
    if (state == AppLifecycleState.resumed && mounted) {
      ref.invalidate(nutritionThreadProvider);
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
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _itemPositions.itemPositions.removeListener(_onScroll);
    _controller.dispose();
    super.dispose();
  }

  /// Posts an already-uploaded attachment. A photo sent here also becomes a
  /// food-log entry server-side, so the patient never logs the same meal twice.
  Future<void> _sendAttachment(String assetId) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(apiClientProvider)
          .postJson(
            '/chat/nutrition',
            body: {
              'content': _controller.text.trim(),
              'attachments': [assetId],
              'language': _replyLanguage,
            },
          );
      _controller.clear();
      ref.invalidate(nutritionThreadProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Pins or unpins a message so it stays at the top of the thread.
  /// The banner for whichever pinned message is showing, or nothing when none
  /// is pinned.
  List<Widget> _pinnedBanner(List<ChatMessage> messages) {
    final pinned =
        messages.where((m) => m.pinned && !m.deletedForEveryone).toList();
    if (pinned.isEmpty) return const [];
    final shown = pinned[_pinnedIndex.clamp(0, pinned.length - 1)];

    return [
      PinnedBanner(
        preview:
            shown.content.trim().isEmpty ? 'Attachment' : shown.content.trim(),
        count: pinned.length,
        // Jump to it, and with several pinned move on to the next one — the
        // same two-in-one tap the care thread has.
        onTap: () {
          _scrollToMessage(shown.id);
          if (pinned.length > 1) {
            setState(() => _pinnedIndex = (_pinnedIndex + 1) % pinned.length);
          }
        },
        onUnpin: () => _setPinned(shown, false),
      ),
    ];
  }

  Future<void> _setPinned(ChatMessage m, bool pinned) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(apiClientProvider)
          .postJson('/chat/messages/${m.id}/pin', body: {'pinned': pinned});
      ref.invalidate(nutritionThreadProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Hides a message from the patient's own view (delete-for-me). The record is
  /// kept; the server refuses on an emergency turn.
  Future<void> _hide(ChatMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).postJson('/chat/messages/${m.id}/hide');
      ref.invalidate(nutritionThreadProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Deletes the patient's own message for everyone — the dietician then sees a
  /// tombstone. The server enforces author-only + the emergency guard.
  Future<void> _deleteForEveryone(ChatMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(apiClientProvider)
          .postJson(
            '/chat/messages/${m.id}/delete',
            body: {'scope': 'everyone'},
          );
      ref.invalidate(nutritionThreadProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;

    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final res = await ref
          .read(apiClientProvider)
          .postJson(
            '/chat/nutrition',
            body: {
              'content': text,
              'language': _replyLanguage,
              if (_replyingTo != null) 'replyTo': _replyingTo!.id,
            },
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      // Refetch rather than append: the server may have added a plan-bound
      // assistant turn after the patient's, and re-reading is the only way to
      // get both in the right order without guessing at sequence numbers.
      ref.invalidate(nutritionThreadProvider);

      // The server triages this thread exactly like the care thread. If it
      // escalated, say so here rather than letting the patient assume a
      // dietician will read it in the morning.
      final urgency = (res['triage'] as Map?)?['urgency']?.toString();
      if (urgency == 'emergency' || urgency == 'urgent') {
        if (!mounted) return;
        messenger.showSnackBar(
          SnackBar(
            backgroundColor: AppColors.danger,
            duration: const Duration(seconds: 6),
            content: Text(
              urgency == 'emergency'
                  ? 'This looks urgent — the clinic has been alerted. If you feel unwell now, call them.'
                  : 'The clinic has been alerted about this message.',
              style: const TextStyle(color: Colors.white),
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Rewrite one of our own turns, then reload so the thread shows the new
  /// words and the "edited" mark. The sheet reports its own failures.
  Future<void> _editMessage(ChatMessage message) async {
    final saved = await showEditMessageSheet(context, ref, message);
    if (saved && mounted) ref.invalidate(nutritionThreadProvider);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(nutritionThreadProvider);

    // Whoever last wrote as the dietician on this thread. Read from the
    // messages rather than fetched separately: the thread is already loaded,
    // and a clinic with two dieticians should show whichever one is actually
    // answering this patient.
    final dieticianTurn =
        async.valueOrNull
            ?.where(
              (m) => m.role == 'dietician' && (m.senderName ?? '').isNotEmpty,
            )
            .lastOrNull;
    final dieticianName = dieticianTurn?.senderName;
    final dieticianAvatar = dieticianTurn?.senderAvatarUrl;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        titleSpacing: 0,
        // The dietician's own name and face, taken from the last thing they
        // wrote here. A patient talking to "Your dietician" is talking to a
        // department; talking to Romit Dey is talking to a person, and the
        // person is the reason they answer honestly about what they ate.
        title: Row(
          children: [
            // titleSpacing is 0 so the row can start at the avatar; the inset
            // has to come back here, or the photo sits clipped against the
            // screen edge.
            const SizedBox(width: AppSpacing.sm),
            UserAvatar(
              name: dieticianName ?? '',
              avatarUrl: dieticianAvatar,
              accent: AppColors.accentOn(context),
              size: 38,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    dieticianName ?? 'Your dietician',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    dieticianName == null
                        ? 'Food and nutrition'
                        : 'Your dietician · Food and nutrition',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
          // The log still exists as a list — scrolling back weeks through a
          // conversation to find one meal is not a search.
          IconButton(
            tooltip: 'Meal history',
            onPressed: () => context.push('/food-log/history'),
            icon: const _MealLogIcon(),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: ChatBackground(
        child: Column(
          children: [
            const AssistantDisclaimerBanner(),
            // The same banner the care thread carries. A message the dietician
            // pinned is one they meant the patient to keep in view, and it was
            // scrolling away with everything else.
            ..._pinnedBanner(async.valueOrNull ?? const <ChatMessage>[]),
            Expanded(
              // The button floats over the thread instead of sitting in the
              // column. Given a row of its own it both stole a strip of the
              // list and parked itself on the newest message; the list's extra
              // bottom padding keeps the bubbles clear of where it hovers.
              child: Stack(
                children: [
                  async.when(
                    // Keep the thread (and any optimistic voice bubble) on screen
                    // during a reload instead of flashing a spinner over the whole
                    // conversation on every send.
                    skipLoadingOnReload: true,
                    skipLoadingOnRefresh: true,
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
                                    () =>
                                        ref.invalidate(nutritionThreadProvider),
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                    data: (messages) {
                      var shown =
                          messages.where((m) => m.role != 'system').toList();
                      // The reload has caught up (a new message arrived), so the
                      // optimistic voice bubble(s) now have real counterparts —
                      // drop them. Deferred because we're inside build.
                      if (_pendingVoice.isNotEmpty &&
                          shown.length > _lastShownCount) {
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted && _pendingVoice.isNotEmpty) {
                            setState(() => _pendingVoice.clear());
                          }
                        });
                      }
                      _lastShownCount = shown.length;
                      if (_pendingVoice.isNotEmpty) {
                        shown = [...shown, ..._pendingVoice];
                      }
                      if (shown.isEmpty) {
                        return Center(
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.xl),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.restaurant_rounded,
                                  size: 46,
                                  color: scheme.outlineVariant,
                                ),
                                const SizedBox(height: AppSpacing.md),
                                const Text(
                                  'No messages yet',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Ask your dietician about food, portions or your plan.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
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
                          return ChatMessageBubble(
                            message: m,
                            onReply: () => setState(() => _replyingTo = m),
                            onTogglePin: () => _setPinned(m, !m.pinned),
                            onHide: () => _hide(m),
                            // Tapping the quote goes to what was answered.
                            onQuoteTap:
                                m.replyToId == null
                                    ? null
                                    : () => _scrollToMessage(m.replyToId),
                            // Delete-for-everyone only on the patient's own turns.
                            onDeleteForEveryone:
                                m.isUser ? () => _deleteForEveryone(m) : null,
                            onEdit: m.isUser ? () => _editMessage(m) : null,
                            // Resolve the quoted turn locally when it is still
                            // loaded; the bubble falls back to the server-sent
                            // preview when it is not.
                            repliedTo:
                                m.replyToId == null
                                    ? null
                                    : shown
                                        .where((x) => x.id == m.replyToId)
                                        .firstOrNull,
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
            // Shows what is being answered while the reply is written, so the
            // quote is never a surprise after sending.
            if (_replyingTo != null)
              Container(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  8,
                  AppSpacing.sm,
                  8,
                ),
                color: scheme.surfaceContainerHighest,
                child: Row(
                  children: [
                    Container(
                      width: 3,
                      height: 34,
                      color: AppColors.accentOn(context),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        _replyingTo!.content.trim().isEmpty
                            ? 'Attachment'
                            : _replyingTo!.content,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Cancel reply',
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => setState(() => _replyingTo = null),
                    ),
                  ],
                ),
              ),
            CareComposer(
              controller: _controller,
              hint: 'Message your dietician…',
              sending: _sending,
              onSend: _send,
              onSendAttachment: _sendAttachment,
              // Show the just-recorded clip immediately, before it uploads.
              onVoiceRecorded: _addPendingVoice,
            ),
          ],
        ),
      ),
    );
  }
}

/// The Meal history button: a log book badged with a fork and knife — a record
/// *of food*, which is what the screen behind it is.
///
/// It has to be a composition rather than one glyph. `restaurant_menu` is the
/// obvious food icon, but the bottom bar already spends it on the Dietician tab
/// itself, so reusing it here would read as "you are here" rather than as a way
/// through to the log. A plain photo library, which this was, says pictures and
/// says nothing about meals.
class _MealLogIcon extends StatelessWidget {
  const _MealLogIcon();

  @override
  Widget build(BuildContext context) {
    // The badge sits on a disc of the bar's own colour so the fork reads as a
    // separate mark instead of merging into the book's edge.
    final barColor =
        Theme.of(context).appBarTheme.backgroundColor ??
        Theme.of(context).colorScheme.surface;

    return SizedBox(
      width: 24,
      height: 24,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          const Positioned(
            left: 0,
            top: 0,
            child: Icon(Icons.menu_book_rounded, size: 22),
          ),
          Positioned(
            right: -2,
            bottom: -2,
            child: Container(
              padding: const EdgeInsets.all(0),
              decoration: BoxDecoration(
                color: barColor,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.restaurant_rounded, size: 11),
            ),
          ),
        ],
      ),
    );
  }
}
