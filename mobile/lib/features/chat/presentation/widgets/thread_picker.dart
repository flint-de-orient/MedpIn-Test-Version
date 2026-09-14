import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/thread_group.dart';

/// The list a patient sees when they have more than one conversation.
///
/// ---- It is absent far more often than it is present ---------------------
///
/// A patient with one practice and one thread never sees this. The screen asks
/// [ThreadList.needsList] and opens straight into the conversation, which is
/// what they have today and what nothing about the rework should change.
///
/// This appears the first time somebody sees a second doctor, or a second
/// department at the same practice — and it looks like any messaging app,
/// because that is the thing a patient already knows how to read.
///
/// ---- A practice with no conversation yet is still a row ----------------
///
/// A patient the desk enrolled at a second practice has nothing to open there
/// until somebody writes. Without a row for it they had no way to write first,
/// and a message sent without naming a practice is refused rather than guessed
/// at — so [onStart] opens an empty conversation with that practice named.
class ThreadPicker extends StatelessWidget {
  const ThreadPicker({
    super.key,
    required this.threads,
    required this.onOpen,
    this.onStart,
  });

  final ThreadList threads;
  final ValueChanged<ChatThread> onOpen;

  /// Starts a first conversation with a practice that has none. Rows for such
  /// practices are drawn only when this is given.
  final ValueChanged<ThreadGroup>? onStart;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
      children: [
        for (final group in threads.groups) ...[
          // The practice heading is dropped when there is only one, because a
          // heading over a list of one group labels nothing.
          if (threads.groups.length > 1 && group.practiceName != null) ...[
            Padding(
              padding: const EdgeInsets.only(left: T.s1, bottom: T.s2),
              child: Text(
                group.practiceName!,
                style: T.label.copyWith(color: T.inkMuted),
              ),
            ),
          ],
          for (final thread in group.threads) ...[
            _ThreadRow(
              thread: thread,
              practiceName: group.practiceName,
              onTap: () => onOpen(thread),
            ),
            const SizedBox(height: T.s3),
          ],
          if (group.threads.isEmpty && group.practiceId != null && onStart != null) ...[
            _StartRow(
              practiceName: group.practiceName,
              onTap: () => onStart!(group),
            ),
            const SizedBox(height: T.s3),
          ],
          const SizedBox(height: T.s4),
        ],
      ],
    );
  }
}

class _ThreadRow extends StatelessWidget {
  const _ThreadRow({required this.thread, required this.practiceName, required this.onTap});

  final ChatThread thread;
  final String? practiceName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final urgent = thread.highestUrgency == 'urgent' || thread.highestUrgency == 'emergency';

    return InnerTile(
      onTap: onTap,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  thread.labelWithin(practiceName),
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                Text(_subtitle(thread), style: T.label.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          // Urgency is a shape as well as a colour, because a red dot alone is
          // invisible to a patient who cannot distinguish it from grey.
          if (urgent) ...[
            const Icon(Icons.priority_high_rounded, size: 18, color: T.danger),
            const SizedBox(width: T.s1),
          ],
          const Icon(Icons.chevron_right_rounded, size: 20, color: T.inkFaint),
        ],
      ),
    );
  }

  static String _subtitle(ChatThread t) {
    if (t.messageCount == 0) return 'No messages yet';
    // Said plainly rather than shown as a disabled composer the patient pokes
    // at. A department nobody has written a scope for answers nothing, and
    // finding that out by being ignored is worse than being told.
    if (!t.hasAssistant) return 'Replies from the clinic only';
    return '${t.messageCount} message${t.messageCount == 1 ? '' : 's'}';
  }
}

/// A practice the patient has not written to yet.
///
/// Named for what tapping it does. "No messages yet" under a practice's name
/// read as a thread that had failed to load.
class _StartRow extends StatelessWidget {
  const _StartRow({required this.practiceName, required this.onTap});

  final String? practiceName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      onTap: onTap,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  practiceName ?? 'Your care team',
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                Text('Start a conversation', style: T.label.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, size: 20, color: T.inkFaint),
        ],
      ),
    );
  }
}
