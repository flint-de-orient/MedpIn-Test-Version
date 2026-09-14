import 'package:flutter/foundation.dart';

/// One thing the patient said or asked, and the messages it came from.
///
/// The server drops any point it cannot tie to a message, so every point here
/// can be opened in the conversation.
@immutable
class ChatSummaryPoint {
  const ChatSummaryPoint({
    required this.kind,
    required this.text,
    this.messageIds = const [],
  });

  /// `symptom` | `concern` | `question` | `medication` | `diet` | `reading` |
  /// `appointment` | `assistant_answer` | `follow_up`.
  final String kind;
  final String text;
  final List<String> messageIds;

  factory ChatSummaryPoint.fromJson(Map<String, dynamic> j) => ChatSummaryPoint(
    kind: j['kind']?.toString() ?? 'concern',
    text: j['text']?.toString() ?? '',
    messageIds:
        (j['messageIds'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
  );
}

/// One patient's day of conversation with this practice, for the clinicians
/// it did not interrupt (`GET /chat-summaries`).
@immutable
class ChatSummary {
  const ChatSummary({
    required this.id,
    required this.patientId,
    required this.patientName,
    required this.day,
    this.avatarUrl,
    this.sessionId,
    this.kind = 'care',
    this.highestUrgency = 'routine',
    this.needsDoctor = false,
    this.reasons = const [],
    this.overview = '',
    this.points = const [],
    this.messageCount = 0,
    this.patientMessageCount = 0,
    this.unansweredCount = 0,
    this.lastMessageAt,
    this.source = 'rules',
    this.reviewed = false,
    this.reviewedAt,
  });

  final String id;
  final String patientId;
  final String patientName;
  final String? avatarUrl;
  final String? sessionId;
  final String kind;

  /// The clinic's calendar day, `YYYY-MM-DD`.
  final String day;
  final String highestUrgency; // routine | advice | urgent | emergency
  final bool needsDoctor;

  /// Why it needs a clinician, in a few words each. Empty when nothing does.
  final List<String> reasons;
  final String overview;
  final List<ChatSummaryPoint> points;
  final int messageCount;
  final int patientMessageCount;
  final int unansweredCount;
  final DateTime? lastMessageAt;

  /// `ai` when the assistant wrote it, `rules` when it was assembled without a
  /// model. Said on screen, because the two are not the same kind of text.
  final String source;

  /// Whether the person reading has marked this day read. Per person.
  final bool reviewed;
  final DateTime? reviewedAt;

  bool get isUrgent => highestUrgency == 'urgent' || highestUrgency == 'emergency';
  bool get writtenByAssistant => source == 'ai';

  ChatSummary markedReviewed() => ChatSummary(
    id: id,
    patientId: patientId,
    patientName: patientName,
    day: day,
    avatarUrl: avatarUrl,
    sessionId: sessionId,
    kind: kind,
    highestUrgency: highestUrgency,
    needsDoctor: needsDoctor,
    reasons: reasons,
    overview: overview,
    points: points,
    messageCount: messageCount,
    patientMessageCount: patientMessageCount,
    unansweredCount: unansweredCount,
    lastMessageAt: lastMessageAt,
    source: source,
    reviewed: true,
    reviewedAt: DateTime.now(),
  );

  factory ChatSummary.fromJson(Map<String, dynamic> j) {
    final patient = j['patient'] as Map<String, dynamic>?;
    return ChatSummary(
      id: j['id']?.toString() ?? '',
      patientId: patient?['id']?.toString() ?? '',
      patientName: patient?['name']?.toString() ?? 'Patient',
      avatarUrl: patient?['avatarUrl']?.toString(),
      sessionId: j['sessionId']?.toString(),
      kind: j['kind']?.toString() ?? 'care',
      day: j['day']?.toString() ?? '',
      highestUrgency: j['highestUrgency']?.toString() ?? 'routine',
      needsDoctor: j['needsDoctor'] == true,
      reasons:
          (j['reasons'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      overview: j['overview']?.toString() ?? '',
      points:
          (j['points'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ChatSummaryPoint.fromJson)
              .toList() ??
          const [],
      messageCount: (j['messageCount'] as num?)?.toInt() ?? 0,
      patientMessageCount: (j['patientMessageCount'] as num?)?.toInt() ?? 0,
      unansweredCount: (j['unansweredCount'] as num?)?.toInt() ?? 0,
      lastMessageAt:
          DateTime.tryParse(j['lastMessageAt']?.toString() ?? '')?.toLocal(),
      source: j['source']?.toString() ?? 'rules',
      reviewed: j['reviewed'] == true,
      reviewedAt:
          DateTime.tryParse(j['reviewedAt']?.toString() ?? '')?.toLocal(),
    );
  }
}

/// A day's list, with the counts the heading states.
@immutable
class ChatSummaryDay {
  const ChatSummaryDay({
    required this.day,
    required this.scope,
    required this.items,
    this.kind = 'care',
    this.patients = 0,
    this.needsDoctor = 0,
    this.reviewed = 0,
  });

  final String day;

  /// `mine` or `practice`.
  final String scope;
  final String kind;
  final int patients;
  final int needsDoctor;
  final int reviewed;
  final List<ChatSummary> items;

  /// The patients still waiting on the reader: something needs a clinician
  /// and this person has not marked the day read. In the server's order, worst
  /// first, and counted from the rows so a heading cannot disagree with them.
  List<ChatSummary> get waiting =>
      items.where((i) => i.needsDoctor && !i.reviewed).toList(growable: false);

  factory ChatSummaryDay.fromJson(Map<String, dynamic> j) {
    final counts = j['counts'] as Map<String, dynamic>? ?? const {};
    return ChatSummaryDay(
      day: j['day']?.toString() ?? '',
      scope: j['scope']?.toString() ?? 'mine',
      kind: j['kind']?.toString() ?? 'care',
      patients: (counts['patients'] as num?)?.toInt() ?? 0,
      needsDoctor: (counts['needsDoctor'] as num?)?.toInt() ?? 0,
      reviewed: (counts['reviewed'] as num?)?.toInt() ?? 0,
      items:
          (j['items'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ChatSummary.fromJson)
              .toList() ??
          const [],
    );
  }
}
