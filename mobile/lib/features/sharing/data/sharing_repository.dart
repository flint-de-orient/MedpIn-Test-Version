import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/active_patient.dart';
import '../../../shared/providers/core_providers.dart';

/// Who can see a patient's record, and the patient deciding.
///
/// ---- The categories are the server's, word for word ---------------------
///
/// A grant names categories of record, and the patient agreed to exactly the
/// words they were shown. So the list below mirrors `SHARE_CATEGORY` in
/// backend/src/models/ShareGrant.js and `sharing_models_test.dart` holds the two
/// together: a category the app cannot name is one a patient would be asked
/// to share without being told what it is.
abstract final class ShareCategory {
  static const prescriptions = 'prescriptions';
  static const labResults = 'lab_results';
  static const readings = 'readings';
  static const eye = 'eye';
  static const foot = 'foot';
  static const ecg = 'ecg';
  static const foodLogs = 'food_logs';
  static const documents = 'documents';
  static const notes = 'notes';

  /// In the order they are offered.
  static const all = [
    prescriptions,
    labResults,
    readings,
    eye,
    foot,
    ecg,
    foodLogs,
    documents,
    notes,
  ];

  /// What the patient writes themselves — "my own health logs".
  static const ownLogs = [readings, foodLogs, documents];

  /// What clinics recorded — "my earlier history".
  static const history = [prescriptions, labResults, eye, foot, ecg, notes];

  static String label(String category) => switch (category) {
    prescriptions => 'Prescriptions',
    labResults => 'Lab results and reports',
    readings => 'Vitals and readings',
    eye => 'Eye examinations',
    foot => 'Foot examinations',
    ecg => 'ECGs',
    foodLogs => 'Food and activity logs',
    documents => 'Documents and photos',
    notes => 'Clinical notes',
    _ => category,
  };

  /// "Prescriptions, ECGs and Clinical notes" — for a sentence, not a list.
  static String sentence(Iterable<String> categories) {
    final words = categories.map(label).toList();
    if (words.isEmpty) return '';
    if (words.length == 1) return words.first;
    return '${words.sublist(0, words.length - 1).join(', ')} and ${words.last}';
  }
}

DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
List<String> _strings(Object? v) => ((v as List?) ?? const []).map((e) => e.toString()).toList();
String? _name(Object? v) => (v as Map?)?['name']?.toString();

/// One grant, or one practice's request, as the patient is shown it.
class ShareGrantView {
  const ShareGrantView({
    required this.id,
    required this.practiceName,
    required this.doctorName,
    required this.categories,
    required this.status,
    required this.origin,
    required this.requestNote,
    required this.requestedBy,
    required this.grantedAt,
    required this.expiresAt,
    required this.endedAt,
    required this.endedWithRegistration,
  });

  final String id;
  final String? practiceName;

  /// Null when anybody at the practice who may open the patient benefits.
  final String? doctorName;
  final List<String> categories;

  /// active, requested, declined, revoked, or expired.
  final String status;
  final String origin;
  final String? requestNote;
  final String? requestedBy;
  final DateTime? grantedAt;

  /// Null means until the patient takes it back.
  final DateTime? expiresAt;
  final DateTime? endedAt;
  final bool endedWithRegistration;

  bool get isActive => status == 'active';
  bool get isRequest => status == 'requested';

  factory ShareGrantView.fromJson(Map<String, dynamic> json) => ShareGrantView(
    id: json['id']?.toString() ?? '',
    practiceName: _name(json['practice']),
    doctorName: _name(json['doctor']),
    categories: _strings(json['categories']),
    status: json['status']?.toString() ?? 'active',
    origin: json['origin']?.toString() ?? '',
    requestNote: json['requestNote']?.toString(),
    requestedBy: json['requestedBy']?.toString(),
    grantedAt: _date(json['grantedAt']),
    expiresAt: _date(json['expiresAt']),
    endedAt: _date(json['revokedAt'] ?? json['declinedAt']),
    endedWithRegistration: json['revokeReason'] == 'enrolment_ended',
  );
}

/// A practice that can read the record, and why.
class ConnectedPractice {
  const ConnectedPractice({
    required this.enrollmentId,
    required this.practiceId,
    required this.practiceName,
    required this.since,
    required this.consentedOn,
    required this.reconsented,
    required this.shared,
    required this.requests,
  });

  final String enrollmentId;
  final String practiceId;
  final String? practiceName;

  /// The date its enrolment reads from — kept from the first time for a
  /// patient who came back.
  final DateTime? since;
  final DateTime? consentedOn;
  final bool reconsented;
  final List<ShareGrantView> shared;
  final List<ShareGrantView> requests;

  factory ConnectedPractice.fromJson(Map<String, dynamic> json) => ConnectedPractice(
    enrollmentId: json['enrollmentId']?.toString() ?? '',
    practiceId: (json['practice'] as Map?)?['id']?.toString() ?? '',
    practiceName: _name(json['practice']),
    since: _date(json['since']),
    consentedOn: _date(json['consentedOn']),
    reconsented: json['reconsented'] == true,
    shared: ((json['shared'] as List?) ?? const [])
        .map((e) => ShareGrantView.fromJson(e as Map<String, dynamic>))
        .toList(),
    requests: ((json['requests'] as List?) ?? const [])
        .map((e) => ShareGrantView.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// "Who can see my records?"
class SharingOverview {
  const SharingOverview({
    required this.patientName,
    required this.connected,
    required this.waiting,
    required this.ended,
    required this.past,
  });

  final String? patientName;
  final List<ConnectedPractice> connected;

  /// Practices that asked at a desk and are waiting on the patient's code.
  final List<({String enrollmentId, String? practiceName, DateTime? askedOn})> waiting;

  /// Practices whose access ended.
  final List<({String enrollmentId, String? practiceName, DateTime? endedOn})> ended;

  /// Grants that ended, expired or were declined.
  final List<ShareGrantView> past;

  factory SharingOverview.fromJson(Map<String, dynamic> json) => SharingOverview(
    patientName: _name(json['patient']),
    connected: ((json['connected'] as List?) ?? const [])
        .map((e) => ConnectedPractice.fromJson(e as Map<String, dynamic>))
        .toList(),
    waiting: ((json['waiting'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((e) => (
              enrollmentId: e['enrollmentId']?.toString() ?? '',
              practiceName: _name(e['practice']),
              askedOn: _date(e['askedOn']),
            ))
        .toList(),
    ended: ((json['ended'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((e) => (
              enrollmentId: e['enrollmentId']?.toString() ?? '',
              practiceName: _name(e['practice']),
              endedOn: _date(e['endedOn']),
            ))
        .toList(),
    past: ((json['past'] as List?) ?? const [])
        .map((e) => ShareGrantView.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// The questions asked once when a practice is connected.
class SharingQuestion {
  const SharingQuestion({
    required this.enrollmentId,
    required this.practiceName,
    required this.patientName,
    required this.since,
    required this.asksOwnLogs,
    required this.asksHistory,
  });

  final String enrollmentId;
  final String? practiceName;
  final String? patientName;
  final DateTime? since;
  final bool asksOwnLogs;

  /// False for an account the practice made itself: there is no earlier
  /// history anywhere to share.
  final bool asksHistory;

  factory SharingQuestion.fromJson(Map<String, dynamic> json) {
    final asks = (json['asks'] as Map?) ?? const {};
    return SharingQuestion(
      enrollmentId: json['enrollmentId']?.toString() ?? '',
      practiceName: _name(json['practice']),
      patientName: _name(json['patient']),
      since: _date(json['since']),
      asksOwnLogs: asks['ownLogs'] != false,
      asksHistory: asks['history'] == true,
    );
  }
}

/// One line of the sharing history.
class SharingHistoryItem {
  const SharingHistoryItem({
    required this.at,
    required this.kind,
    required this.practiceName,
    required this.by,
    required this.categories,
  });

  final DateTime? at;
  final String kind;
  final String? practiceName;
  final String? by;
  final List<String> categories;

  factory SharingHistoryItem.fromJson(Map<String, dynamic> json) => SharingHistoryItem(
    at: _date(json['at']),
    kind: json['kind']?.toString() ?? '',
    practiceName: _name(json['practice']),
    by: json['by']?.toString(),
    categories: _strings(json['categories']),
  );

  /// The sentence the history shows. Says who acted where it knows, and never
  /// more than the row records.
  String get sentence {
    final where = practiceName ?? 'A clinic';
    final what = categories.isEmpty ? '' : ShareCategory.sentence(categories);
    return switch (kind) {
      'connection_requested' => '$where asked to connect to your record',
      'connected' => '$where was connected to your record',
      'reconnected' => '$where was connected again, with your consent',
      'disconnected' => '$where’s access ended',
      'sharing_given' => 'You shared ${what.isEmpty ? 'records' : what} with $where',
      'sharing_declined' => 'You chose not to share anything more with $where',
      'shared' => 'You shared $what with $where',
      'share_requested' => '$where asked to see $what',
      'request_declined' => 'You declined $where’s request to see $what',
      'share_revoked' => 'You stopped sharing $what with $where',
      'share_ended_with_registration' => 'Sharing $what with $where ended with their access',
      'share_expired' => 'Sharing $what with $where reached its end date',
      'viewed' => '${by ?? 'Someone'} at $where viewed $what you shared',
      _ => kind,
    };
  }
}

/// What one practice has been given for a patient, as that practice sees it.
class PracticeSharing {
  const PracticeSharing({
    required this.since,
    required this.shared,
    required this.request,
    required this.notShared,
    required this.ownLogsShared,
    required this.historyShared,
  });

  final DateTime? since;
  final List<ShareGrantView> shared;
  final ShareGrantView? request;

  /// Every category this caller has no grant for — what they are not seeing.
  final List<String> notShared;
  final bool ownLogsShared;
  final bool historyShared;

  factory PracticeSharing.fromJson(Map<String, dynamic> json) => PracticeSharing(
    since: _date(json['since']),
    shared: ((json['shared'] as List?) ?? const [])
        .map((e) => ShareGrantView.fromJson(e as Map<String, dynamic>))
        .toList(),
    request: json['request'] is Map<String, dynamic>
        ? ShareGrantView.fromJson(json['request'] as Map<String, dynamic>)
        : null,
    notShared: _strings(json['notShared']),
    ownLogsShared: json['ownLogsShared'] == true,
    historyShared: json['historyShared'] == true,
  );
}

class SharingRepository {
  SharingRepository(this._client);

  final ApiClient _client;

  Map<String, dynamic>? _for(String? patientId) => patientId == null ? null : {'patientId': patientId};

  Future<SharingOverview> overview({String? patientId}) async =>
      SharingOverview.fromJson(await _client.getJson('/sharing', query: _for(patientId)));

  Future<List<SharingHistoryItem>> history({String? patientId}) async {
    final json = await _client.getJson('/sharing/history', query: _for(patientId));
    return ((json['items'] as List?) ?? const [])
        .map((e) => SharingHistoryItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<SharingQuestion>> questions() async {
    final json = await _client.getJson('/sharing/prompts');
    return ((json['items'] as List?) ?? const [])
        .map((e) => SharingQuestion.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> answer({required String enrollmentId, required bool ownLogs, required bool history}) async {
    await _client.postJson(
      '/sharing/prompts/$enrollmentId',
      body: {'ownLogs': ownLogs, 'history': history},
    );
  }

  Future<List<({String id, String name})>> doctorsAt(String practiceId, {String? patientId}) async {
    final json = await _client.getJson('/sharing/practices/$practiceId/doctors', query: _for(patientId));
    return ((json['items'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((e) => (id: e['id']?.toString() ?? '', name: e['name']?.toString() ?? ''))
        .toList();
  }

  Future<void> share({
    required String practiceId,
    required List<String> categories,
    String? doctorId,
    DateTime? expiresAt,
    String? patientId,
    Map<String, String>? headers,
  }) async {
    await _client.postJson(
      '/sharing/grants',
      body: {
        'practiceId': practiceId,
        'categories': categories,
        if (doctorId != null) 'doctorId': doctorId,
        if (expiresAt != null) 'expiresAt': expiresAt.toUtc().toIso8601String(),
        if (patientId != null) 'patientId': patientId,
      },
      headers: headers,
    );
  }

  Future<void> stopSharing(String grantId) async {
    await _client.postJson('/sharing/grants/$grantId/revoke', body: const {});
  }

  Future<void> approve(String requestId, {List<String>? categories}) async {
    await _client.postJson(
      '/sharing/requests/$requestId/approve',
      body: {if (categories != null) 'categories': categories},
    );
  }

  Future<void> decline(String requestId) async {
    await _client.postJson('/sharing/requests/$requestId/decline', body: const {});
  }

  /// Ends a practice's access to the record. Deletes nothing it already holds.
  Future<void> endAccess(String enrollmentId) async {
    await _client.postJson('/enrolments/$enrollmentId/revoke', body: const {});
  }

  /// A clinician: what this practice was given for one patient.
  Future<PracticeSharing> forPractice(String patientId) async =>
      PracticeSharing.fromJson(await _client.getJson('/sharing/patients/$patientId'));

  /// A clinician holding SHARE_RECORDS: ask the patient.
  Future<void> ask({required String patientId, required List<String> categories, String? note}) async {
    await _client.postJson(
      '/sharing/patients/$patientId/requests',
      body: {
        'categories': categories,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
  }
}

final sharingRepositoryProvider = Provider<SharingRepository>(
  (ref) => SharingRepository(ref.watch(apiClientProvider)),
);

/// The person whose sharing the patient app is showing: the account holder, or
/// the household member Home is switched to.
final sharingOverviewProvider = FutureProvider.autoDispose<SharingOverview>((ref) {
  final patientId = ref.watch(activePatientProvider);
  return ref.watch(sharingRepositoryProvider).overview(patientId: patientId);
});

final sharingHistoryProvider = FutureProvider.autoDispose<List<SharingHistoryItem>>((ref) {
  final patientId = ref.watch(activePatientProvider);
  return ref.watch(sharingRepositoryProvider).history(patientId: patientId);
});

/// Across the household: a question about a child is the parent's to answer.
final sharingQuestionsProvider = FutureProvider.autoDispose<List<SharingQuestion>>(
  (ref) => ref.watch(sharingRepositoryProvider).questions(),
);

final practiceSharingProvider = FutureProvider.autoDispose.family<PracticeSharing, String>(
  (ref, patientId) => ref.watch(sharingRepositoryProvider).forPractice(patientId),
);
