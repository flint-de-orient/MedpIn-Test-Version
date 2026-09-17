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
    this.practiceId,
    this.practiceLogoUrl,
    this.doctorName,
    this.doctorAvatarUrl,
    this.newConversationHasAssistant,
  });

  /// For a practice with no conversation yet: whether its assistant would
  /// answer a first message. Null where there are threads, which say so each.
  final bool? newConversationHasAssistant;

  /// Null before the migration, when there is nothing to group by. The screen
  /// shows the threads unlabelled, which is precisely today's behaviour.
  final String? practiceName;
  final String? enrollmentId;

  /// Which practice this is, so a patient who has not written to it yet can
  /// start a conversation there. Null before the migration, with the name.
  final String? practiceId;

  /// The practice's logo, a relative `/api/v1/uploads/:id/raw` path.
  final String? practiceLogoUrl;

  /// The doctor the patient is under at this practice, while that doctor still
  /// works there. Null when the practice names nobody — the list then shows
  /// the practice.
  final String? doctorName;
  final String? doctorAvatarUrl;

  final List<ChatThread> threads;

  factory ThreadGroup.fromJson(Map<String, dynamic> j) {
    final practice = j['practice'] as Map<String, dynamic>?;
    final doctor = j['doctor'] as Map<String, dynamic>?;
    return ThreadGroup(
      practiceName: practice?['name']?.toString(),
      practiceId: practice?['id']?.toString(),
      practiceLogoUrl: practice?['logoUrl']?.toString(),
      doctorName: doctor?['name']?.toString(),
      doctorAvatarUrl: doctor?['avatarUrl']?.toString(),
      newConversationHasAssistant: j['newConversationHasAssistant'] as bool?,
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
    this.lastMessage,
    this.unreadCount = 0,
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

  /// The newest message the patient can see here. Null when there is none, or
  /// from a server that does not send it yet.
  final ThreadPreview? lastMessage;

  /// Messages from the clinic's side since the patient last had this
  /// conversation on screen.
  final int unreadCount;

  /// What to put at the top of the row: the department when there is one, the
  /// practice when there is not.
  String labelWithin(String? practiceName) =>
      departmentName ?? practiceName ?? 'Your care team';

  /// Who the conversation is with, the way a messaging app names a contact:
  /// the department when it is one, otherwise the patient's own doctor there,
  /// otherwise the practice.
  String nameWithin(ThreadGroup? group) =>
      departmentName ?? group?.doctorName ?? group?.practiceName ?? 'Your care team';

  factory ChatThread.fromJson(Map<String, dynamic> j) {
    final dept = j['department'] as Map<String, dynamic>?;
    final last = j['lastMessage'];
    return ChatThread(
      id: j['id']?.toString() ?? '',
      departmentName: dept?['name']?.toString(),
      hasAssistant: j['hasAssistant'] as bool? ?? true,
      lastMessageAt: DateTime.tryParse(j['lastMessageAt']?.toString() ?? '')?.toLocal(),
      highestUrgency: j['highestUrgency']?.toString() ?? 'routine',
      messageCount: (j['messageCount'] as num?)?.toInt() ?? 0,
      lastMessage: last is Map<String, dynamic> ? ThreadPreview.fromJson(last) : null,
      unreadCount: (j['unreadCount'] as num?)?.toInt() ?? 0,
    );
  }
}

/// The last message in a conversation, as its row in the list shows it.
@immutable
class ThreadPreview {
  const ThreadPreview({
    required this.role,
    this.senderName,
    this.deleted = false,
    this.text = '',
    this.attachment,
    this.at,
  });

  /// `user` is the patient; `assistant`, `clinician` or `dietician` the other side.
  final String role;

  /// The clinician's or dietician's name. Null for the patient and the assistant.
  final String? senderName;

  /// Deleted for everyone: the row says so and shows nothing of what it said.
  final bool deleted;

  final String text;

  /// `photo`, `voice` or `document` when the message carries one, else null.
  final String? attachment;

  final DateTime? at;

  bool get isMine => role == 'user';

  factory ThreadPreview.fromJson(Map<String, dynamic> j) => ThreadPreview(
    role: j['role']?.toString() ?? 'user',
    senderName: j['senderName']?.toString(),
    deleted: j['deleted'] == true,
    text: j['text']?.toString() ?? '',
    attachment: j['attachment']?.toString(),
    at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
  );
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
  /// or one practice with a second department — means a list. So does a second
  /// practice the patient has not written to yet: opening straight into the
  /// one conversation they do have left no way to reach the other, and a
  /// message sent without choosing is refused rather than guessed at.
  bool get needsList => groups.length > 1 || all.length > 1;

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
