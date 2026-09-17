import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../../shared/widgets/user_avatar.dart';
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
/// department at the same practice — and it reads like any messaging app,
/// because that is the thing a patient already knows how to read: a face and a
/// name, the last thing said and when, and how many messages are waiting.
/// Newest conversation first, whichever practice it is with.
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
    this.now,
  });

  final ThreadList threads;

  /// Opens a conversation. The group comes too, because the conversation is
  /// titled with who it is with.
  final void Function(ChatThread thread, ThreadGroup group) onOpen;

  /// Starts a first conversation with a practice that has none. Rows for such
  /// practices are drawn only when this is given.
  final ValueChanged<ThreadGroup>? onStart;

  /// The moment the time stamps are relative to. Tests pin it; the app leaves
  /// it null for the clock.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final rows = <(ThreadGroup, ChatThread)>[
      for (final group in threads.groups)
        for (final thread in group.threads) (group, thread),
    ]..sort((a, b) {
      final at = _activityOf(a.$2);
      final bt = _activityOf(b.$2);
      if (at == null || bt == null) return at == null ? (bt == null ? 0 : 1) : -1;
      return bt.compareTo(at);
    });
    final unstarted = [
      for (final group in threads.groups)
        if (group.threads.isEmpty && group.practiceId != null && onStart != null) group,
    ];
    final clock = now ?? DateTime.now();

    final children = <Widget>[
      for (final (group, thread) in rows)
        _ThreadRow(
          thread: thread,
          group: group,
          now: clock,
          onTap: () => onOpen(thread, group),
        ),
      for (final group in unstarted)
        _StartRow(group: group, onTap: () => onStart!(group)),
    ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
      children: [
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          // The card paints over the page's Material, so a row's ripple needs
          // a surface of its own above the card's fill.
          child: Material(
            type: MaterialType.transparency,
            child: Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0)
                    // Indented past the photo, the way a messaging list rules
                    // its rows: the faces stay one unbroken column.
                    const Divider(height: 1, thickness: 1, indent: T.s4 + _avatar + T.s3, color: T.line),
                  children[i],
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  static DateTime? _activityOf(ChatThread t) => t.lastMessage?.at ?? t.lastMessageAt;
}

/// The photo size in a row: large enough to recognise a face at arm's length.
const double _avatar = T.s12;

class _ThreadRow extends StatelessWidget {
  const _ThreadRow({
    required this.thread,
    required this.group,
    required this.now,
    required this.onTap,
  });

  final ChatThread thread;
  final ThreadGroup group;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final name = thread.nameWithin(group);
    final unread = thread.unreadCount;
    final urgent = thread.highestUrgency == 'urgent' || thread.highestUrgency == 'emergency';
    final at = thread.lastMessage?.at ?? (thread.messageCount > 0 ? thread.lastMessageAt : null);
    final stamp = at == null ? null : timeStampFor(at, now, yesterday: l10n.chatDateYesterday);
    // The department's thread is the practice's, not the named doctor's, so it
    // shows the practice's mark rather than a face that is not who answers.
    final photo = thread.departmentName != null
        ? group.practiceLogoUrl
        : (group.doctorName != null ? group.doctorAvatarUrl : group.practiceLogoUrl);

    return MergeSemantics(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
          child: Row(
            children: [
              UserAvatar(name: name, avatarUrl: photo, accent: T.primary, size: _avatar),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: T.bodyStrong.copyWith(color: T.ink),
                          ),
                        ),
                        if (stamp != null) ...[
                          const SizedBox(width: T.s2),
                          Text(
                            stamp,
                            style: T.label.copyWith(
                              color: unread > 0 ? T.primary : T.inkFaint,
                              fontWeight: unread > 0 ? FontWeight.w700 : null,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: T.s1),
                    Row(
                      children: [
                        Expanded(child: _Preview(thread: thread, name: name, unread: unread > 0)),
                        // Urgency is a shape as well as a colour, because a red
                        // dot alone is invisible to a patient who cannot
                        // distinguish it from grey.
                        if (urgent) ...[
                          const SizedBox(width: T.s2),
                          Semantics(
                            label: 'Marked urgent',
                            child: const Icon(Icons.priority_high_rounded, size: 18, color: T.danger),
                          ),
                        ],
                        if (unread > 0) ...[
                          const SizedBox(width: T.s2),
                          _UnreadBadge(count: unread),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The last message, one line: who said it when that is not obvious, and what.
class _Preview extends StatelessWidget {
  const _Preview({required this.thread, required this.name, required this.unread});

  final ChatThread thread;
  final String name;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final last = thread.lastMessage;
    final style = T.label.copyWith(
      color: unread ? T.ink : T.inkMuted,
      fontWeight: unread ? FontWeight.w600 : null,
    );

    if (last == null) {
      final text = thread.messageCount == 0
          ? 'No messages yet'
          : '${thread.messageCount} message${thread.messageCount == 1 ? '' : 's'}';
      return Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: style);
    }

    if (last.deleted) {
      return Row(
        children: [
          const Icon(Icons.block_rounded, size: 16, color: T.inkFaint),
          const SizedBox(width: T.s1),
          Expanded(
            child: Text(
              l10n.chatDeletedForEveryone,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: style.copyWith(color: T.inkFaint, fontStyle: FontStyle.italic),
            ),
          ),
        ],
      );
    }

    final who = senderPrefix(last, conversationName: name);
    final (IconData? icon, String? kind) = switch (last.attachment) {
      'photo' => (Icons.photo_camera_rounded, 'Photo'),
      'voice' => (Icons.mic_rounded, 'Voice message'),
      'document' => (Icons.description_rounded, 'Document'),
      _ => (null, null),
    };
    final words = last.text.isNotEmpty ? last.text : (kind ?? '');

    // One run of text, so a long name and the message share the line and
    // ellipsise together instead of the name pushing the row off the card.
    return Text.rich(
      TextSpan(
        children: [
          if (who != null) TextSpan(text: who, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (icon != null)
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Padding(
                padding: const EdgeInsets.only(right: T.s1),
                child: Icon(icon, size: 16, color: T.inkFaint),
              ),
            ),
          TextSpan(text: words),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: style,
    );
  }
}

/// "You: ", "Assistant: " or the clinician's name — or nothing when the row is
/// already named for the person who wrote it, as a messaging app leaves a
/// contact's own messages unlabelled.
@visibleForTesting
String? senderPrefix(ThreadPreview last, {required String conversationName}) {
  if (last.isMine) return 'You: ';
  if (last.role == 'assistant') return 'Assistant: ';
  final sender = last.senderName;
  if (sender == null) return 'Clinic: ';
  return sender == conversationName ? null : '$sender: ';
}

/// When the last message was, as a messaging list says it: the time today,
/// "Yesterday", the weekday within the week, and the date before that.
@visibleForTesting
String timeStampFor(DateTime at, DateTime now, {required String yesterday}) {
  final day = DateTime(at.year, at.month, at.day);
  final today = DateTime(now.year, now.month, now.day);
  final days = (today.difference(day).inHours / 24).round();
  if (days <= 0) return DateFormat.jm().format(at);
  if (days == 1) return yesterday;
  if (days < 7) return DateFormat.E().format(at);
  return DateFormat('dd/MM/yy').format(at);
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$count unread message${count == 1 ? '' : 's'}',
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: const BoxDecoration(color: T.primary, borderRadius: T.rFull),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: T.s6),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s1),
              child: Text(
                count > 99 ? '99+' : '$count',
                textAlign: TextAlign.center,
                style: T.label.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A practice the patient has not written to yet.
///
/// Named for what tapping it does. "No messages yet" under a practice's name
/// read as a thread that had failed to load.
class _StartRow extends StatelessWidget {
  const _StartRow({required this.group, required this.onTap});

  final ThreadGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = group.doctorName ?? group.practiceName ?? 'Your care team';
    return MergeSemantics(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
          child: Row(
            children: [
              UserAvatar(
                name: name,
                avatarUrl: group.doctorName != null ? group.doctorAvatarUrl : group.practiceLogoUrl,
                accent: T.primary,
                size: _avatar,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.bodyStrong.copyWith(color: T.ink),
                    ),
                    const SizedBox(height: T.s1),
                    Text('Start a conversation', style: T.label.copyWith(color: T.primary)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, size: 20, color: T.inkFaint),
            ],
          ),
        ),
      ),
    );
  }
}
