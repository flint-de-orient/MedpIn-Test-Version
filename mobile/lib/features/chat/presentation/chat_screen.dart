import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/loading_view.dart';
import '../../../shared/widgets/markdown_text.dart';
import '../../../shared/data/care_contact.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/chat_repository.dart';
import '../domain/chat_message.dart';
import 'chat_controller.dart';
import 'widgets/chat_composer.dart';
import 'widgets/chat_empty_state.dart';
import 'widgets/chat_message_bubble.dart';
import '../../../shared/widgets/chat_background.dart';
import 'widgets/assistant_disclaimer_banner.dart';
import 'widgets/generating_bubble.dart';
import 'widgets/edit_message_sheet.dart';
import '../../../core/push/chat_push_signal.dart';
import '../../appointments/presentation/request_appointment_sheet.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({
    super.key,
    this.title,
    this.onBack,
    this.clinicRepliesOnly = false,
  });

  /// Who the conversation is with, when the patient opened it from their list
  /// of conversations. Null keeps the tab's own title.
  final String? title;

  /// Back to the list of conversations — the arrow in the bar and the phone's
  /// back button both. Null when there is no list: a patient with one
  /// conversation opens straight into it, and back leaves the tab as before.
  final VoidCallback? onBack;

  /// No assistant answers in this conversation, so the banner says the clinic
  /// replies rather than promising AI guidance.
  final bool clinicRepliesOnly;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen>
    with WidgetsBindingObserver {
  // A positioned list (not a plain ListView) so a tap on the pinned banner or a
  // reply quote can jump to that exact message even when it is off-screen.
  final ItemScrollController _itemScrollController = ItemScrollController();
  final ItemPositionsListener _itemPositions = ItemPositionsListener.create();

  /// The rows currently rendered (messages + date separators) and their count,
  /// kept so [_scrollToMessage] can resolve a message id to a list index.
  List<_Entry> _entries = const [];
  int _itemCount = 0;

  /// Polls for messages the patient did not send — a reply from the clinic.
  ///
  /// There is no socket or push channel, so the conversation is kept live by
  /// re-reading it. Three seconds is short enough that a doctor's reply lands
  /// while the patient is still looking at the screen, and the request is
  /// cheap: one indexed query, and state is only touched when something new
  /// actually arrived.
  /// Two seconds in every thread, patient and clinician alike.
  ///
  /// The nutrition threads sat at eight, which is what "messages arrive late"
  /// actually was: a reply could be on the server for the better part of ten
  /// seconds before either side saw it, and leaving the screen and coming back
  /// fetched it immediately — which is precisely how it was reported.
  static const _pollInterval = Duration(seconds: 2);
  Timer? _poll;

  /// Cancelled with the timer. A push arriving after this screen is gone must
  /// not touch a disposed controller.
  StreamSubscription<ChatThreadKind>? _pushSignal;

  /// The message being answered, shown above the composer until sent or
  /// dismissed. Null when writing a fresh message.
  ChatMessage? _replyingTo;

  /// Which pinned message the top banner is showing. Tapping the banner cycles
  /// through them, WhatsApp-style, when more than one is pinned.
  int _pinnedIndex = 0;

  /// Whether the list is scrolled far enough from the bottom to warrant the
  /// jump-to-latest button. Reversed lists put "latest" at offset 0, but this
  /// list is bottom-anchored, so "away from latest" means below maxScrollExtent.
  bool _showJumpToLatest = false;

  @override
  void initState() {
    super.initState();
    _itemPositions.itemPositions.addListener(_onScroll);
    WidgetsBinding.instance.addObserver(this);
    // Resume the patient's ongoing conversation rather than opening blank.
    // Deferred past the first frame because it mutates a provider.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(chatControllerProvider.notifier).resumeLatest();
    });
    _poll = Timer.periodic(_pollInterval, (_) {
      if (mounted) ref.read(chatControllerProvider.notifier).pollForUpdates();
    });

    // The timer is the backstop. This is the mechanism.
    //
    // The server pushes on every clinician reply, so the moment one is written
    // the phone already knows — it was raising a banner and telling the open
    // thread nothing. Reading it here is what makes a reply land while the
    // patient is looking at the screen, and it keeps working when the poll
    // does not.
    _pushSignal = ChatPushSignal.instance.stream.listen((kind) {
      if (kind == ChatThreadKind.care && mounted) {
        ref.read(chatControllerProvider.notifier).pollForUpdates();
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Returning from the background is when the conversation is most likely to
    // have moved on, so check at once instead of waiting out the timer.
    if (state == AppLifecycleState.resumed && mounted) {
      ref.read(chatControllerProvider.notifier).pollForUpdates();
      _reportRead();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Depended on here so switching back to this tab calls in again: what
    // arrived while another tab was in front is read the moment it is shown.
    if (TickerMode.valuesOf(context).enabled) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _reportRead());
    }
  }

  /// The newest message already reported as read, so a poll that brings
  /// nothing new sends nothing.
  DateTime? _reportedReadUpTo;

  /// Tells the server the patient has seen this conversation up to its newest
  /// message — which clears the number beside it in their list.
  ///
  /// Only while it is actually in front of them. The poll keeps re-reading the
  /// thread from behind other tabs and from the background, and a message
  /// fetched there has not been read.
  void _reportRead() {
    if (!mounted || !TickerMode.valuesOf(context).enabled) return;
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) return;
    final chat = ref.read(chatControllerProvider);
    final sessionId = chat.sessionId;
    if (sessionId == null) return;
    final newest = newestDeliveredAt(chat.messages);
    if (newest == null) return;
    final reported = _reportedReadUpTo;
    if (reported != null && !newest.isAfter(reported)) return;
    _reportedReadUpTo = newest;
    ref
        .read(chatRepositoryProvider)
        .markThreadRead(sessionId, upTo: newest)
        // Nothing to tell the patient: the list shows a number a little longer,
        // and the next message on screen reports again.
        .catchError((Object _) {
          if (_reportedReadUpTo == newest) _reportedReadUpTo = reported;
        });
  }

  /// The jump-to-latest button appears once the newest row scrolls out of view.
  void _onScroll() {
    final positions = _itemPositions.itemPositions.value;
    if (positions.isEmpty || _itemCount == 0) return;
    final lastVisible = positions
        .map((p) => p.index)
        .reduce((a, b) => a > b ? a : b);
    final away = lastVisible < _itemCount - 2;
    if (away != _showJumpToLatest) setState(() => _showJumpToLatest = away);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _pushSignal?.cancel();
    _itemPositions.itemPositions.removeListener(_onScroll);
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_itemScrollController.isAttached || _itemCount == 0) return;
      _itemScrollController.scrollTo(
        index: _itemCount - 1,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  /// Jumps to a specific message (from a pinned banner or a reply quote),
  /// leaving it a third of the way down so it reads as "here it is".
  void _scrollToMessage(String messageId) {
    final index = _entries.indexWhere((e) => e.message?.id == messageId);
    if (index < 0 || !_itemScrollController.isAttached) return;
    _itemScrollController.scrollTo(
      index: index,
      alignment: 0.3,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeInOut,
    );
  }

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

  /// Hides a message from this patient's view.
  ///
  /// The server refuses on anything carrying an emergency verdict, and its
  /// reason is shown rather than a generic failure — "this is part of an
  /// emergency record" explains itself; "could not hide" does not.
  Future<void> _hide(ChatMessage message) async {
    final messenger = ScaffoldMessenger.of(context);
    final error = await ref
        .read(chatControllerProvider.notifier)
        .hideMessage(message.id);
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }

  Future<void> _deleteForEveryone(ChatMessage message) async {
    final messenger = ScaffoldMessenger.of(context);
    final error = await ref
        .read(chatControllerProvider.notifier)
        .deleteForEveryone(message.id);
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }

  /// Dials the clinic through the phone's own dialer.
  ///
  /// Deliberately not an in-app call: a patient who has stopped typing to ring
  /// the clinic is usually worried, and a normal phone call is the path that
  /// works with no data, no permissions and nothing to go wrong in between.
  /// Ask the clinic for a time, and say plainly that it was asked for.
  ///
  /// The confirmation matters as much as the send. A request that vanishes
  /// with no acknowledgement reads as one that failed, and the patient sends
  /// another — which the server folds into the first, so they hear nothing
  /// again.
  Future<void> _requestAppointment() async {
    final messenger = ScaffoldMessenger.of(context);
    final sent = await showRequestAppointmentSheet(context);
    if (!sent || !mounted) return;
    messenger.showSnackBar(
      const SnackBar(
        content: Text(
          'Request sent. The clinic will confirm a time and let you know.',
        ),
        duration: Duration(seconds: 4),
      ),
    );
  }

  /// Rings the patient's own practice. The header offers this only when there
  /// is a number to ring.
  Future<void> _callClinic(String phone) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    final uri = Uri(scheme: 'tel', path: phone);
    if (!await launchUrl(uri)) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.commonSomethingWentWrong)),
      );
    }
  }

  /// Hands the recording to the controller, which shows it as a playable bubble
  /// immediately (from the local file) and only then uploads + sends it. The
  /// upload still returns the transcript, which becomes the message text
  /// server-side, so the deterministic triage engine reads a spoken "chest pain"
  /// the same as a typed one rather than routing a spoken emergency past the
  /// rules.
  Future<void> _sendVoiceNote(String path) async {
    await ref
        .read(chatControllerProvider.notifier)
        .sendVoiceNote(localPath: path, language: _replyLanguage);
    _scrollToBottom();
  }

  Future<void> _send(String text, [List<String> attachments = const []]) async {
    final replyTo = _replyingTo;
    if (replyTo != null) setState(() => _replyingTo = null);

    await ref
        .read(chatControllerProvider.notifier)
        .send(
          text: text,
          language: _replyLanguage,
          attachments: attachments,
          replyToId: replyTo?.id,
        );
    _scrollToBottom();
  }

  /// Rewrite one of our own turns, then reload so the thread shows the new
  /// words and the "edited" mark. The sheet reports its own failures.
  Future<void> _editMessage(ChatMessage message) async {
    final saved = await showEditMessageSheet(context, ref, message);
    if (saved && mounted)
      ref.read(chatControllerProvider.notifier).pollForUpdates();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final chatState = ref.watch(chatControllerProvider);
    // Watched, not read, so switching language in Profile immediately
    // re-points the speech recogniser at the new locale.
    ref.watch(localeControllerProvider);
    final language = _replyLanguage;

    ref.listen(chatControllerProvider, (previous, next) {
      final lengthChanged = previous?.messages.length != next.messages.length;
      // Also follow a streaming reply, whose length is fixed but whose last
      // message's content grows token by token.
      final contentGrew =
          previous != null &&
          previous.messages.isNotEmpty &&
          next.messages.isNotEmpty &&
          previous.messages.last.content.length !=
              next.messages.last.content.length;
      if (lengthChanged || contentGrew) _scrollToBottom();
      if (lengthChanged) _reportRead();
      // Let the error banner clear itself after a few seconds instead of
      // sitting there until the next message.
      if (previous?.error == null && next.error != null) {
        Future.delayed(const Duration(seconds: 4), () {
          if (mounted) ref.read(chatControllerProvider.notifier).dismissError();
        });
      }
    });

    // The assistant's bubble is created when the `meta` event lands, which is
    // before the first token of its reply. Drawing it in that window rendered
    // an empty bubble for a moment, so hold it back until it has text.
    final messages = chatState.messages;
    final pinnedMsgs = messages.where((m) => m.pinned).toList();
    final pinnedShown =
        pinnedMsgs.isEmpty
            ? null
            : pinnedMsgs[_pinnedIndex.clamp(0, pinnedMsgs.length - 1)];
    final awaitingFirstToken =
        messages.isNotEmpty &&
        !messages.last.isUser &&
        messages.last.content.isEmpty;

    final entries = _withDateSeparators(
      awaitingFirstToken ? messages.sublist(0, messages.length - 1) : messages,
    );

    // The "analysing" bubble covers the whole wait — from send until there is
    // actual text — so the two never swap to a blank gap in between. Once the
    // reply starts streaming it would be a duplicate, so it goes.
    final showGenerating =
        chatState.isSending &&
        (messages.isEmpty || messages.last.isUser || awaitingFirstToken);

    // Kept so a banner/quote tap can resolve a message id to its list index.
    _entries = entries;
    _itemCount = entries.length + (showGenerating ? 1 : 0);

    final onBack = widget.onBack;
    final screen = Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        centerTitle: true,
        // Opened from the list of conversations: the way back to it. The
        // screen replaces the list inside the tab rather than being pushed
        // over it, so there is no route for the bar to imply an arrow from.
        leading:
            onBack == null
                ? null
                : IconButton(
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  icon: const Icon(Icons.arrow_back_rounded),
                  onPressed: onBack,
                ),
        title: Text(
          widget.title ?? l10n.chatTitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.accentOn(context),
            fontWeight: FontWeight.w700,
          ),
        ),
        // No "new chat" action: the patient has one continuous conversation
        // with the assistant, which the doctor reviews as a single thread.
        //
        // Calling the clinic sits here instead. It dials through the phone
        // rather than in-app: when someone is frightened enough to stop typing
        // and call, a normal phone call is the thing that always works —
        // no data, no permissions, no app in the middle.
        actions: [
          // Asking for a time, from the screen the thought occurs on.
          //
          // The booking screen exists, shows a real timetable, and most
          // patients never open it. This is the shorter path — name a day, and
          // the desk answers — and it belongs here because this is where a
          // patient is already talking to the clinic.
          IconButton(
            tooltip: 'Request an appointment',
            icon: const Icon(Icons.event_available_rounded),
            onPressed: _requestAppointment,
          ),
          // The patient's own practice's number, and no button without one.
          // It dialled a placeholder compiled into the app whenever the real
          // number had not loaded.
          if (ref.watch(careContactProvider).valueOrNull?.phone
              case final String phone)
            IconButton(
              tooltip: l10n.chatCallClinic,
              icon: const Icon(Icons.call_rounded),
              onPressed: () => _callClinic(phone),
            ),
        ],
      ),
      // The Scaffold does not resize for the keyboard; instead the content is
      // padded by the keyboard inset below. This keeps the dotted background a
      // fixed, full-screen layer that never repaints as the keyboard animates —
      // which was a real source of the input/attach lag.
      resizeToAvoidBottomInset: false,
      body: ChatBackground(
        child: _KeyboardInset(
          child: Column(
            children: [
              AssistantDisclaimerBanner(clinicRepliesOnly: widget.clinicRepliesOnly),
              if (chatState.error != null)
                Container(
                  width: double.infinity,
                  color: AppColors.dangerBgOn(context),
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  child: Text(
                    _errorMessage(context, chatState.error!.code),
                    style: TextStyle(color: AppColors.dangerOn(context)),
                  ),
                ),
              // Pinned message pinned to the top of the thread, WhatsApp-style.
              if (pinnedShown != null)
                _PinnedBanner(
                  message: pinnedShown,
                  count: pinnedMsgs.length,
                  // Tap scrolls to the pinned message; with several pinned, it
                  // also advances to the next so repeated taps cycle through them.
                  onTap: () {
                    _scrollToMessage(pinnedShown.id);
                    if (pinnedMsgs.length > 1) {
                      setState(
                        () =>
                            _pinnedIndex =
                                (_pinnedIndex + 1) % pinnedMsgs.length,
                      );
                    }
                  },
                  onUnpin: () {
                    ref
                        .read(chatControllerProvider.notifier)
                        .setPinned(pinnedShown.id, false);
                    setState(() => _pinnedIndex = 0);
                  },
                ),
              Expanded(
                child: Stack(
                  children: [
                    chatState.isLoadingHistory
                        ? const LoadingView()
                        : chatState.messages.isEmpty
                        ? ChatEmptyState(onSuggestionTap: _send)
                        : ScrollablePositionedList.builder(
                          itemScrollController: _itemScrollController,
                          itemPositionsListener: _itemPositions,
                          // Bottom clearance for the floating jump-to-latest
                          // button, which would otherwise sit on the message it is
                          // offering to scroll you to.
                          padding: const EdgeInsets.fromLTRB(
                            AppSpacing.md,
                            AppSpacing.md,
                            AppSpacing.md,
                            AppSpacing.md + 48,
                          ),
                          itemCount: entries.length + (showGenerating ? 1 : 0),
                          itemBuilder: (context, index) {
                            if (index == entries.length)
                              return const GeneratingBubble();

                            final entry = entries[index];
                            if (entry.separatorLabel != null) {
                              return _DateSeparator(
                                label: entry.separatorLabel!,
                              );
                            }

                            final message = entry.message!;
                            // Each bubble is its own repaint layer, so a keyboard
                            // resize or a new message repaints one row, not the
                            // whole transcript.
                            return RepaintBoundary(
                              child: ChatMessageBubble(
                                message: message,
                                // Tapping a source pill asks the assistant about
                                // that topic — the citation becomes a question.
                                onCitationTap: (c) => _send(c.title),
                                repliedTo:
                                    message.replyToId == null
                                        ? null
                                        : chatState.messages
                                            .where(
                                              (m) => m.id == message.replyToId,
                                            )
                                            .firstOrNull,
                                // Tapping the reply quote jumps to the message it
                                // answers, when that message is still in the thread.
                                onQuoteTap:
                                    message.replyToId == null
                                        ? null
                                        : () => _scrollToMessage(
                                          message.replyToId!,
                                        ),
                                onReply:
                                    () => setState(() => _replyingTo = message),
                                onTogglePin:
                                    () => ref
                                        .read(chatControllerProvider.notifier)
                                        .setPinned(message.id, !message.pinned),
                                onHide: () => _hide(message),
                                // Delete for everyone only on the patient's own
                                // turns — the server enforces the same rule.
                                onDeleteForEveryone:
                                    message.isUser
                                        ? () => _deleteForEveryone(message)
                                        : null,
                                onEdit:
                                    message.isUser
                                        ? () => _editMessage(message)
                                        : null,
                                onRetry:
                                    message.isUser
                                        ? null
                                        : () => ref
                                            .read(
                                              chatControllerProvider.notifier,
                                            )
                                            .retryLast(language: language),
                                onFlag:
                                    message.isUser
                                        ? null
                                        : () async {
                                          final ok = await ref
                                              .read(
                                                chatControllerProvider.notifier,
                                              )
                                              .flagMessage(message.id);
                                          if (ok && context.mounted) {
                                            ScaffoldMessenger.of(
                                              context,
                                            ).showSnackBar(
                                              SnackBar(
                                                content: Text(
                                                  l10n.chatFlagSent,
                                                ),
                                              ),
                                            );
                                          }
                                        },
                              ),
                            );
                          },
                        ),
                    if (_showJumpToLatest)
                      Positioned(
                        right: AppSpacing.md,
                        bottom: AppSpacing.md,
                        child: _JumpToLatestButton(
                          label: l10n.chatScrollToLatest,
                          onTap: _scrollToBottom,
                        ),
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
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: Row(
                    children: [
                      Container(
                        width: 3,
                        height: 34,
                        color: AppColors.accentOn(context),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              l10n.chatReplyingTo,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.accentOn(context),
                              ),
                            ),
                            Text(
                              _replyingTo!.content,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                color:
                                    Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close_rounded, size: 20),
                        onPressed: () => setState(() => _replyingTo = null),
                      ),
                    ],
                  ),
                ),
              ChatComposer(
                onSend: _send,
                onSendVoiceNote: _sendVoiceNote,
                isSending: chatState.isSending,
                languageCode: language,
              ),
            ],
          ),
        ),
      ),
    );

    if (onBack == null) return screen;
    // The phone's back button goes where the arrow does, instead of closing
    // the app with the list never shown again.
    //
    // Not a PopScope in the app. This screen is the first page of its tab, and
    // the router's back handling only asks a tab's navigator when that
    // navigator has something to pop — so a PopScope here is never consulted
    // and back leaves the app. The router's own dispatcher asks this first.
    if (Router.maybeOf(context)?.backButtonDispatcher != null) {
      return BackButtonListener(onBackButtonPressed: _systemBack, child: screen);
    }
    // Outside a router there is only a navigator to ask.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) onBack();
      },
      child: screen,
    );
  }

  /// Back to the list — unless something else should take this press first.
  Future<bool> _systemBack() async {
    final onBack = widget.onBack;
    if (!mounted || onBack == null) return false;
    // Another tab is in front: its back is its own.
    if (!TickerMode.valuesOf(context).enabled) return false;
    // A sheet or page over the conversation in this tab, or a dialog over the
    // whole app: back closes that.
    if (!(ModalRoute.of(context)?.isCurrent ?? true)) return false;
    if (Navigator.of(context, rootNavigator: true).canPop()) return false;
    onBack();
    return true;
  }

  /// Interleaves "Today" / "Yesterday" / date markers between messages.
  ///
  /// Messages loaded from history carry `createdAt`; a session spanning more
  /// than one day is otherwise an undifferentiated wall of bubbles.
  List<_Entry> _withDateSeparators(List<ChatMessage> messages) {
    final l10n = AppLocalizations.of(context);
    final now = DateTime.now();
    final entries = <_Entry>[];
    DateTime? lastDay;

    for (final m in messages) {
      final at = m.createdAt?.toLocal();
      if (at != null) {
        final day = DateTime(at.year, at.month, at.day);
        if (lastDay == null || day != lastDay) {
          entries.add(_Entry.separator(_labelFor(day, now, l10n)));
          lastDay = day;
        }
      }
      entries.add(_Entry.message(m));
    }
    return entries;
  }

  String _labelFor(DateTime day, DateTime now, AppLocalizations l10n) {
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(day).inDays;
    if (diff == 0) return l10n.chatDateToday;
    if (diff == 1) return l10n.chatDateYesterday;
    return '${day.day.toString().padLeft(2, '0')}/'
        '${day.month.toString().padLeft(2, '0')}/${day.year}';
  }

  String _errorMessage(BuildContext context, String code) {
    final l10n = AppLocalizations.of(context);
    if (code == 'AI_UNAVAILABLE') return l10n.errorAiUnavailable;
    if (code == 'NETWORK_ERROR' || code == 'TIMEOUT')
      return l10n.commonNoInternet;
    return l10n.commonSomethingWentWrong;
  }
}

/// Lifts the conversation above the keyboard, without rebuilding it.
///
/// The Scaffold has `resizeToAvoidBottomInset: false` so the dotted background
/// stays a fixed layer, and the keyboard inset is applied here instead. Reading
/// the inset in [_ChatScreenState.build] subscribed the whole screen to
/// MediaQuery, so every frame of the keyboard's open animation rebuilt the
/// transcript, the date separators and the composer — which is what made
/// tapping the field and the attach button feel slow.
///
/// Reading it here confines that per-frame rebuild to this one widget: [child]
/// arrives already built, so Flutter sees an identical widget instance and
/// skips the subtree entirely. Only the padding value changes.
class _KeyboardInset extends StatelessWidget {
  const _KeyboardInset({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    // viewInsetsOf, not MediaQuery.of: subscribes to the insets alone rather
    // than to every MediaQuery change (text scale, orientation, padding…).
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: child,
    );
  }
}

/// Floating pill that returns the patient to the newest message after they
/// have scrolled up to re-read the conversation.
class _JumpToLatestButton extends StatelessWidget {
  const _JumpToLatestButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    // Just the arrow — a compact circular button, no label.
    return Material(
      color: isDark ? AppColors.primaryDark : AppColors.primary,
      shape: const CircleBorder(),
      elevation: 3,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Tooltip(
          message: label,
          child: const SizedBox(
            width: 40,
            height: 44,
            child: Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 26,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

/// The pinned message shown pinned to the top of the thread. When more than one
/// is pinned, tapping cycles through them (like WhatsApp's pinned bar).
class _PinnedBanner extends StatelessWidget {
  const _PinnedBanner({
    required this.message,
    required this.count,
    required this.onTap,
    required this.onUnpin,
  });

  final ChatMessage message;
  final int count;
  final VoidCallback? onTap;
  final VoidCallback onUnpin;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final preview = MarkdownText.toPlainText(message.content);

    return Material(
      color: scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(AppSpacing.md, 8, 4, 8),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(color: AppColors.accentOn(context), width: 3),
              bottom: BorderSide(color: scheme.outlineVariant),
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.push_pin_rounded,
                size: 16,
                color: AppColors.accentOn(context),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Text(
                          l10n.chatPinned,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.accentOn(context),
                          ),
                        ),
                        if (count > 1) ...[
                          const SizedBox(width: 4),
                          Text(
                            '$count',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
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
                icon: const Icon(Icons.close_rounded, size: 18),
                tooltip: l10n.chatUnpin,
                onPressed: onUnpin,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A list row: either a message or a date separator.
class _Entry {
  const _Entry.message(this.message) : separatorLabel = null;
  const _Entry.separator(this.separatorLabel) : message = null;

  final ChatMessage? message;
  final String? separatorLabel;
}

class _DateSeparator extends StatelessWidget {
  const _DateSeparator({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 4,
        ),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          label,
          style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
        ),
      ),
    );
  }
}
