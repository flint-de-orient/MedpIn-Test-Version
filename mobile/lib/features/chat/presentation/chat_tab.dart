import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/push/chat_push_signal.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../data/chat_repository.dart';
import '../domain/chat_message.dart';
import 'chat_controller.dart';
import 'chat_screen.dart';
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

  @override
  Widget build(BuildContext context) {
    final threads = ref.watch(threadListProvider);

    return threads.when(
      // A skeleton would flash for a patient who has one thread and is about to
      // be sent straight into it. The screen underneath has its own loading
      // state, so this stays out of the way.
      loading: () => const SizedBox.shrink(),

      // The thread list failing must not cost a patient their conversation.
      // With one practice the answer is the same whether the grouping loaded or
      // not, so fall through to the screen.
      error: (_, _) => const ChatScreen(),

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
          body: RefreshIndicator(
            onRefresh: () async => ref.invalidate(threadListProvider),
            child: ThreadPicker(
              threads: list,
              onOpen: (thread, group) async {
                // The controller already knows how to move to a named session,
                // so opening one is a call rather than a rebuild of the screen
                // around a new key.
                await ref.read(chatControllerProvider.notifier).openSession(thread.id);
                if (!mounted) return;
                setState(() {
                  _openThreadId = thread.id;
                  _openTitle = thread.nameWithin(group);
                  _openClinicRepliesOnly = !thread.hasAssistant;
                });
              },
              onStart: (group) {
                // A practice the patient has not written to yet. The first
                // message opens the conversation, so the screen starts empty with
                // the practice named for that send.
                ref.read(chatControllerProvider.notifier).startConversation(group.practiceId!);
                setState(() {
                  _openThreadId = 'new:${group.practiceId}';
                  _openTitle = group.doctorName ?? group.practiceName;
                  _openClinicRepliesOnly = group.newConversationHasAssistant == false;
                });
              },
            ),
          ),
        );
      },
    );
  }
}

/// The failure state, kept for the case where a patient genuinely has several
/// conversations and the list is the only way to reach any of them.
///
/// Unused while falling through to [ChatScreen] gives the same answer. It
/// becomes the right response the moment a list is load-bearing.
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
