import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/push/chat_push_signal.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/chat_repository.dart';
import '../domain/chat_message.dart';
import 'chat_controller.dart';
import 'chat_screen.dart';
import 'widgets/emergency_card.dart';
import 'widgets/thread_picker.dart';

/// What the Chat tab shows: a conversation, or a list of them.
///
/// ---- It is a no-op for most patients, deliberately ----------------------
///
/// A patient with one practice and one thread has exactly one conversation, so
/// this resolves straight to [ChatScreen] and nothing about their tab changes.
/// That is the whole test of whether the rework is right rather than merely
/// finished: the screen a patient opens every day should be untouched until
/// they actually see a second doctor.
///
/// The list appears the first time there is a choice — a second practice, or a
/// second department at the same one.
///
/// ---- Why the decision lives here and not in ChatScreen ------------------
///
/// [ChatScreen] is the most complex screen in the app: streaming replies,
/// scroll anchoring, voice notes, attachments. Threading a "which conversation"
/// question through it would mean touching all of that for a choice that is
/// made once. A wrapper decides, and the screen goes on doing one job.
class ChatTab extends ConsumerStatefulWidget {
  const ChatTab({super.key});

  @override
  ConsumerState<ChatTab> createState() => _ChatTabState();
}

class _ChatTabState extends ConsumerState<ChatTab> with WidgetsBindingObserver {
  /// Null means "whichever conversation the server resolves", which is what a
  /// single-thread patient always gets.
  String? _openThreadId;

  /// Who the open conversation is with, for its title, and whether anything
  /// but the clinic answers there. Set when it is opened from the list.
  String? _openTitle;
  bool _openClinicRepliesOnly = false;

  /// Keeps the list current while it is the thing on screen: a reply lands as
  /// a new last message and a number beside it, as in any messaging app.
  Timer? _refresh;
  StreamSubscription<ChatThreadKind>? _pushSignal;
  static const _refreshInterval = Duration(seconds: 15);

  bool get _listInFront =>
      mounted &&
      _openThreadId == null &&
      TickerMode.valuesOf(context).enabled &&
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh = Timer.periodic(_refreshInterval, (_) {
      if (_listInFront) ref.invalidate(threadListProvider);
    });
    // The server pushes on every clinician reply; the list can show it at once
    // rather than on the next tick.
    _pushSignal = ChatPushSignal.instance.stream.listen((_) {
      if (_listInFront) ref.invalidate(threadListProvider);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _listInFront) {
      ref.invalidate(threadListProvider);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refresh?.cancel();
    _pushSignal?.cancel();
    super.dispose();
  }

  /// Back from a conversation to the list.
  ///
  /// Whatever was on the screen has been read, whether or not the screen got
  /// round to saying so before it closed. The list is re-read after that, so
  /// it comes back with the last message the patient just sent and no number
  /// beside the conversation they just read.
  void _backToList() {
    final chat = ref.read(chatControllerProvider);
    final sessionId = chat.sessionId;
    final newest = newestDeliveredAt(chat.messages);
    setState(() {
      _openThreadId = null;
      _openTitle = null;
      _openClinicRepliesOnly = false;
    });
    unawaited(() async {
      if (sessionId != null && newest != null) {
        try {
          await ref.read(chatRepositoryProvider).markThreadRead(sessionId, upTo: newest);
        } catch (_) {
          // The number stays until the conversation is next opened.
        }
      }
      if (mounted) ref.invalidate(threadListProvider);
    }());
  }

  /// The server asked which practice a message is for.
  ///
  /// It happens where the screen opened with no conversation to write into:
  /// the list failed to load and fell through to it, or a second practice
  /// enrolled the patient since the list was last read. Either way the list is
  /// re-read, and the message waits in the controller for the patient's choice.
  void _askWhichPractice() {
    setState(() {
      _openThreadId = null;
      _openTitle = null;
      _openClinicRepliesOnly = false;
    });
    ref.invalidate(threadListProvider);
  }

  @override
  Widget build(BuildContext context) {
    final threads = ref.watch(threadListProvider);
    final holding = ref.watch(chatControllerProvider.select((s) => s.held != null));
    final instructions = ref.watch(chatControllerProvider.select((s) => s.held?.emergencyInstructions));

    ref.listen<bool>(chatControllerProvider.select((s) => s.held != null), (was, now) {
      if (now && was != true) _askWhichPractice();
    });

    // What to do now, above everything else while the patient chooses. The
    // clinic was alerted when the server asked; this must not wait either.
    final emergency = instructions == null
        ? null
        : Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, 0),
            child: EmergencyCard(content: instructions),
          );

    return threads.when(
      // A skeleton would flash for a patient who has one thread and is about to
      // be sent straight into it. The screen underneath has its own loading
      // state, so this stays out of the way.
      loading: () => emergency ?? const SizedBox.shrink(),

      // The thread list failing must not cost a patient their conversation.
      // With one practice the answer is the same whether the grouping loaded or
      // not, so fall through to the screen — unless the server has already said
      // there is more than one, when the list is the only way to answer it.
      error: (_, _) => holding
          ? ListView(
              children: [
                if (emergency != null) emergency,
                ThreadListFailed(onRetry: () => ref.invalidate(threadListProvider)),
              ],
            )
          : const ChatScreen(),

      data: (list) {
        if (_openThreadId != null && list.needsList) {
          return ChatScreen(
            title: _openTitle,
            onBack: _backToList,
            clinicRepliesOnly: _openClinicRepliesOnly,
          );
        }
        if (!list.needsList) {
          // One conversation, opened straight into as it always was.
          return ChatScreen(clinicRepliesOnly: list.only?.hasAssistant == false);
        }

        return Scaffold(
          backgroundColor: Colors.transparent,
          appBar: AppBar(
            automaticallyImplyLeading: false,
            title: const Text('Your conversations'),
          ),
          body: Column(
            children: [
              if (emergency != null) emergency,
              if (holding)
                _WhichPractice(
                  // An emergency is not withdrawn with a tap: it is already on
                  // the clinic's alert list, and the conversation it belongs in
                  // is the one thing still missing.
                  onCancel: instructions != null
                      ? null
                      : () => ref.read(chatControllerProvider.notifier).discardHeld(),
                ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async => ref.invalidate(threadListProvider),
                  child: ThreadPicker(
                    threads: list,
                    onOpen: (thread, group) async {
                      // The controller already knows how to move to a named
                      // session, so opening one is a call rather than a rebuild
                      // of the screen around a new key.
                      final chat = ref.read(chatControllerProvider.notifier);
                      await chat.openSession(thread.id);
                      if (!mounted) return;
                      setState(() {
                        _openThreadId = thread.id;
                        _openTitle = thread.nameWithin(group);
                        _openClinicRepliesOnly = !thread.hasAssistant;
                      });
                      // Into the conversation just chosen, if the patient was
                      // asked where a message goes.
                      unawaited(chat.sendHeld());
                    },
                    onStart: (group) {
                      // A practice the patient has not written to yet. The first
                      // message opens the conversation, so the screen starts
                      // empty with the practice named for that send.
                      final chat = ref.read(chatControllerProvider.notifier);
                      chat.startConversation(group.practiceId!);
                      setState(() {
                        _openThreadId = 'new:${group.practiceId}';
                        _openTitle = group.doctorName ?? group.practiceName;
                        _openClinicRepliesOnly = group.newConversationHasAssistant == false;
                      });
                      unawaited(chat.sendHeld());
                    },
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Above the list while a message waits for the patient to say where it goes.
///
/// Says what happened to it — it has not gone, and it has not been sent — so
/// the list reads as a question rather than as the screen having thrown them
/// out of the conversation they were typing in.
class _WhichPractice extends StatelessWidget {
  const _WhichPractice({required this.onCancel});

  /// Null when the message may not be withdrawn, and no Cancel is offered.
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, 0),
      child: SectionCard(
        padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s2, T.s3),
        child: Row(
          children: [
            const Icon(Icons.forum_outlined, color: T.primary),
            const SizedBox(width: T.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Who is this message for?', style: T.bodyStrong.copyWith(color: T.ink)),
                  const SizedBox(height: T.s1),
                  Text(
                    'You see more than one doctor. Choose a conversation and your message will be sent there.',
                    style: T.label.copyWith(color: T.inkMuted),
                  ),
                ],
              ),
            ),
            if (onCancel != null) TextButton(onPressed: onCancel, child: const Text('Cancel')),
          ],
        ),
      ),
    );
  }
}

/// The failure state, kept for the case where a patient genuinely has several
/// conversations and the list is the only way to reach any of them.
///
/// Shown once the server has asked which practice a message is for. Falling
/// through to [ChatScreen] gives the right answer for a patient with one
/// practice, and for one with several it would only be asked again.
class ThreadListFailed extends StatelessWidget {
  const ThreadListFailed({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(T.s4),
      child: LoadFailed(what: 'your conversations', onRetry: onRetry),
    );
  }
}
