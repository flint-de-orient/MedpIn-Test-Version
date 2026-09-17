import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';

/// Patient feedback, both ends of it.
///
/// ---- Where a piece of feedback goes is the server's answer ---------------
///
/// The app used to tell every patient "the clinic has received this". Feedback
/// about the app never reached a clinic, and a patient no clinic has taken on
/// has no clinic to receive anything. So the form sends, the server decides —
/// one practice, or the MedPin team — and the app repeats what it was told.
DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

/// A practice the patient may send feedback about.
class FeedbackPractice {
  const FeedbackPractice({
    required this.practiceId,
    required this.practiceName,
    required this.patientId,
    required this.patientName,
    required this.isSelf,
  });

  final String practiceId;
  final String? practiceName;

  /// Who in the household is registered there — the account holder, or a child
  /// or parent they look after.
  final String patientId;
  final String? patientName;
  final bool isSelf;

  factory FeedbackPractice.fromJson(Map<String, dynamic> json) => FeedbackPractice(
    practiceId: json['practiceId']?.toString() ?? '',
    practiceName: json['practiceName']?.toString(),
    patientId: json['patientId']?.toString() ?? '',
    patientName: json['patientName']?.toString(),
    isSelf: json['isSelf'] == true,
  );
}

/// Where a sent piece of feedback went.
class FeedbackReceipt {
  const FeedbackReceipt({required this.id, required this.routedTo, required this.practiceName});

  final String id;

  /// `practice` or `platform`.
  final String routedTo;
  final String? practiceName;

  bool get toPractice => routedTo == 'practice';

  factory FeedbackReceipt.fromJson(Map<String, dynamic> json) => FeedbackReceipt(
    id: json['id']?.toString() ?? '',
    routedTo: json['routedTo']?.toString() ?? 'platform',
    practiceName: (json['practice'] as Map?)?['name']?.toString(),
  );
}

class FeedbackReply {
  const FeedbackReply({required this.body, required this.at, required this.fromName, required this.byName});

  final String body;
  final DateTime? at;

  /// The practice's name, or "MedPin".
  final String? fromName;

  /// Who at the practice answered. Never set for MedPin.
  final String? byName;

  factory FeedbackReply.fromJson(Map<String, dynamic> json) => FeedbackReply(
    body: json['body']?.toString() ?? '',
    at: _date(json['at']),
    fromName: json['fromName']?.toString(),
    byName: json['byName']?.toString(),
  );
}

/// One piece of feedback the patient sent, with where it went and any reply.
class MyFeedback {
  const MyFeedback({
    required this.id,
    required this.about,
    required this.rating,
    required this.message,
    required this.createdAt,
    required this.routedTo,
    required this.practiceName,
    required this.seen,
    required this.replies,
  });

  final String id;
  final String about;
  final int? rating;
  final String message;
  final DateTime? createdAt;

  /// `practice`, `platform`, or `private` for what was written before feedback
  /// recorded where it went.
  final String routedTo;
  final String? practiceName;
  final bool seen;
  final List<FeedbackReply> replies;

  /// Where it went, in words the patient can read.
  String get destination => switch (routedTo) {
    'practice' => 'Sent to ${practiceName ?? 'your clinic'}',
    'platform' => 'Sent to the MedPin team',
    _ => 'Kept private — sent before feedback went to a named clinic',
  };

  factory MyFeedback.fromJson(Map<String, dynamic> json) => MyFeedback(
    id: json['id']?.toString() ?? '',
    about: json['about']?.toString() ?? 'clinic',
    rating: (json['rating'] as num?)?.toInt(),
    message: json['message']?.toString() ?? '',
    createdAt: _date(json['createdAt']),
    routedTo: json['routedTo']?.toString() ?? 'private',
    practiceName: (json['practice'] as Map?)?['name']?.toString(),
    seen: json['seen'] == true,
    replies: ((json['replies'] as List?) ?? const [])
        .map((e) => FeedbackReply.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// One piece of feedback in the practice's inbox, as this reader sees it.
class InboxFeedback {
  const InboxFeedback({
    required this.id,
    required this.about,
    required this.rating,
    required this.message,
    required this.createdAt,
    required this.reviewedByMe,
    required this.reviewedBy,
    required this.replies,
    required this.patientName,
    required this.patientAvatarUrl,
  });

  final String id;
  final String about;
  final int? rating;
  final String message;
  final DateTime? createdAt;

  /// This reader's own mark. A colleague reading it does not set it.
  final bool reviewedByMe;

  /// Who at the practice has read it.
  final List<({String? name, DateTime? at})> reviewedBy;
  final List<FeedbackReply> replies;
  final String? patientName;
  final String? patientAvatarUrl;

  factory InboxFeedback.fromJson(Map<String, dynamic> json) => InboxFeedback(
    id: json['id']?.toString() ?? '',
    about: json['about']?.toString() ?? 'clinic',
    rating: (json['rating'] as num?)?.toInt(),
    message: json['message']?.toString() ?? '',
    createdAt: _date(json['createdAt']),
    reviewedByMe: json['reviewed'] == true,
    reviewedBy: ((json['reviewedBy'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((e) => (name: e['name']?.toString(), at: _date(e['at'])))
        .toList(),
    replies: ((json['replies'] as List?) ?? const [])
        .map((e) => FeedbackReply.fromJson(e as Map<String, dynamic>))
        .toList(),
    patientName: json['patientName']?.toString(),
    patientAvatarUrl: json['patientAvatarUrl']?.toString(),
  );
}

class FeedbackInbox {
  const FeedbackInbox({required this.items, required this.unread});

  final List<InboxFeedback> items;
  final int unread;
}

class FeedbackRepository {
  FeedbackRepository(this._client);

  final ApiClient _client;

  Future<List<FeedbackPractice>> practices() async {
    final json = await _client.getJson('/feedback/practices');
    return ((json['items'] as List?) ?? const [])
        .map((e) => FeedbackPractice.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<FeedbackReceipt> send({
    required String about,
    String? practiceId,
    String? patientId,
    int? rating,
    String? message,
    Map<String, String>? headers,
  }) async {
    final json = await _client.postJson(
      '/feedback',
      body: feedbackBody(about: about, practiceId: practiceId, patientId: patientId, rating: rating, message: message),
      headers: headers,
    );
    return FeedbackReceipt.fromJson(json);
  }

  Future<List<MyFeedback>> mine() async {
    final json = await _client.getJson('/feedback/mine', query: {'limit': 100});
    return ((json['items'] as List?) ?? const [])
        .map((e) => MyFeedback.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<FeedbackInbox> inbox() async {
    final json = await _client.getJson('/feedback', query: {'limit': 100});
    return FeedbackInbox(
      items: ((json['items'] as List?) ?? const [])
          .map((e) => InboxFeedback.fromJson(e as Map<String, dynamic>))
          .toList(),
      unread: (json['unread'] as num?)?.toInt() ?? 0,
    );
  }

  Future<int> unreadCount() async =>
      ((await _client.getJson('/feedback/unread-count'))['unread'] as num?)?.toInt() ?? 0;

  Future<void> markRead(String id) async {
    await _client.postJson('/feedback/$id/reviewed');
  }

  Future<void> reply(String id, String message, {Map<String, String>? headers}) async {
    await _client.postJson('/feedback/$id/reply', body: {'message': message}, headers: headers);
  }
}

/// What the form sends. A function so a test can hold the contract without a
/// network: a clinic subject names its practice and patient, an app subject
/// names neither.
Map<String, dynamic> feedbackBody({
  required String about,
  String? practiceId,
  String? patientId,
  int? rating,
  String? message,
}) => {
  'about': about,
  if (about == 'clinic' && practiceId != null) 'practiceId': practiceId,
  if (about == 'clinic' && patientId != null) 'patientId': patientId,
  if (rating != null) 'rating': rating,
  if (message != null && message.trim().isNotEmpty) 'message': message.trim(),
};

final feedbackRepositoryProvider = Provider<FeedbackRepository>(
  (ref) => FeedbackRepository(ref.watch(apiClientProvider)),
);

final feedbackPracticesProvider = FutureProvider.autoDispose<List<FeedbackPractice>>(
  (ref) => ref.watch(feedbackRepositoryProvider).practices(),
);

final myFeedbackProvider = FutureProvider.autoDispose<List<MyFeedback>>(
  (ref) => ref.watch(feedbackRepositoryProvider).mine(),
);

final feedbackInboxProvider = FutureProvider.autoDispose<FeedbackInbox>(
  (ref) => ref.watch(feedbackRepositoryProvider).inbox(),
);

/// The badge: what this reader has not read, of what they may read.
final feedbackUnreadProvider = FutureProvider.autoDispose<int>(
  (ref) => ref.watch(feedbackRepositoryProvider).unreadCount(),
);
