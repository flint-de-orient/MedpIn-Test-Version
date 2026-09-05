import 'package:flutter/foundation.dart';

/// The conversations one patient has, grouped by the practice each belongs to.
///
/// ---- One practice must render as it always has --------------------------
///
/// A patient with one practice and one thread gets a single group holding a
/// single thread, and the screen opens straight into it — no list, no chooser.
/// That is what they have today and nothing about their care changed.
///
/// A patient with three practices gets a list, like any messaging app. Same
/// data, different number of rows; only the screen counts.
@immutable
class ThreadGroup {
  const ThreadGroup({
    required this.practiceName,
    required this.enrollmentId,
    required this.threads,
  });

  /// Null before the migration, when there is nothing to group by. The screen
  /// shows the threads unlabelled, which is precisely today's behaviour.
  final String? practiceName;
  final String? enrollmentId;

  final List<ChatThread> threads;

  factory ThreadGroup.fromJson(Map<String, dynamic> j) {
    final practice = j['practice'] as Map<String, dynamic>?;
    return ThreadGroup(
      practiceName: practice?['name']?.toString(),
      enrollmentId: j['enrollment']?.toString(),
      threads:
          (j['threads'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ChatThread.fromJson)
              .toList() ??
          const [],
    );
  }
}

/// One conversation, in one department of one practice.
@immutable
class ChatThread {
  const ChatThread({
    required this.id,
    this.departmentName,
    this.hasAssistant = true,
    this.lastMessageAt,
    this.highestUrgency = 'routine',
    this.messageCount = 0,
  });

  final String id;

  /// Null is the practice's general thread, which is what a single-specialty
  /// clinic has and what every conversation written before departments is.
  /// The screen falls back to the practice's own name.
  final String? departmentName;

  /// False when this department has no assistant scope written. The composer
  /// says so rather than accepting a message nothing will answer — an
  /// assistant improvising outside its specialty is worse than none, because
  /// it is fluent and the patient cannot tell.
  final bool hasAssistant;

  final DateTime? lastMessageAt;
  final String highestUrgency;
  final int messageCount;

  /// What to put at the top of the row: the department when there is one, the
  /// practice when there is not.
  String labelWithin(String? practiceName) =>
      departmentName ?? practiceName ?? 'Your care team';

  factory ChatThread.fromJson(Map<String, dynamic> j) {
    final dept = j['department'] as Map<String, dynamic>?;
    return ChatThread(
      id: j['id']?.toString() ?? '',
      departmentName: dept?['name']?.toString(),
      hasAssistant: j['hasAssistant'] as bool? ?? true,
      lastMessageAt: DateTime.tryParse(j['lastMessageAt']?.toString() ?? '')?.toLocal(),
      highestUrgency: j['highestUrgency']?.toString() ?? 'routine',
      messageCount: (j['messageCount'] as num?)?.toInt() ?? 0,
    );
  }
}

/// The whole answer, and the two questions the screen asks of it.
@immutable
class ThreadList {
  const ThreadList({required this.groups});

  final List<ThreadGroup> groups;

  /// Every thread across every practice.
  List<ChatThread> get all => groups.expand((g) => g.threads).toList();

  /// True only when there is genuinely a choice to make.
  ///
  /// One thread means the screen opens into it. Anything else — two practices,
  /// or one practice with a second department — means a list. Decided here so
  /// no screen has to count, and so the answer is the same everywhere.
  bool get needsList => all.length > 1;

  /// The one thread, when there is exactly one. Null otherwise.
  ChatThread? get only => all.length == 1 ? all.first : null;

  factory ThreadList.fromJson(Map<String, dynamic> j) => ThreadList(
    groups:
        (j['groups'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(ThreadGroup.fromJson)
            .toList() ??
        const [],
  );
}
