import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/providers/core_providers.dart';
import '../../chat/domain/chat_message.dart';
import '../../medications/domain/medication.dart';
import '../domain/appointment.dart';
import '../domain/patient_registration.dart';
import '../domain/chat_review.dart';
import '../domain/department.dart';
import '../domain/team_member.dart';
import '../domain/clinician_models.dart';
import '../domain/lab_overview.dart';
import '../domain/knowledge_chunk.dart';
import '../domain/patient_summary.dart';
import '../../../shared/widgets/notification_list_sheet.dart';
import '../domain/prescription_scan.dart';
import '../domain/chat_summary.dart';
import '../../../core/network/submission_keys.dart';

/// Talks to `/doctor/*` — the clinician (doctor + staff) API: dashboard
/// overview, the patient directory, and clinical-alert triage.
/// The difference between "leave it alone" and "clear it".
///
/// `null` is a real value on a department — it means "not in one" — so a
/// nullable parameter cannot also carry "not supplied". This sentinel separates
/// the two; without it, clearing somebody's department would be inexpressible.
const Object _unset = Object();

class ClinicianRepository {
  /// Everything waiting: open alerts, unread patient messages across both
  /// threads, conversations flagged for review, and — for the front desk —
  /// appointment requests. What arrives depends on the role; the server
  /// decides, see `GET /doctor/notifications`.
  ///
  /// The per-kind counts come back alongside the list because the list is
  /// capped at sixty and other screens need the true totals. The desk's Today
  /// rail used to reach for a different endpoint to count unread messages,
  /// which is how a tile and a bell two inches apart came to disagree.
  Future<
    ({
      int unread,
      int messages,
      int alerts,
      int requests,
      List<PanelNotification> items,
    })
  >
  notifications() async {
    final json = await _client.getJson('/doctor/notifications');
    final counts = json['counts'] as Map<String, dynamic>? ?? const {};
    int at(String k) => (counts[k] as num?)?.toInt() ?? 0;
    return (
      unread: (json['unread'] as num?)?.toInt() ?? 0,
      messages: at('messages'),
      alerts: at('alerts'),
      requests: at('requests'),
      items:
          (json['items'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(PanelNotification.fromJson)
              .toList(),
    );
  }

  /// Marks patient messages as seen — on opening the list, so the badge clears
  /// because somebody looked. Alerts are untouched: those close when the doctor
  /// acts on them.
  Future<void> markNotificationsSeen() async {
    await _client.postJson('/doctor/notifications/seen');
  }

  ClinicianRepository(this._client);

  final ApiClient _client;

  Future<ClinicOverview> overview() async {
    final json = await _client.getJson('/doctor/overview');
    return ClinicOverview.fromJson(json);
  }

  Future<ClinicAnalytics> analytics({int days = 30}) async {
    final json = await _client.getJson('/doctor/analytics?days=$days');
    return ClinicAnalytics.fromJson(json);
  }

  /// What came back from the lab, across the practice.
  ///
  /// A bench screen, not a record screen: lab reports were readable one
  /// patient at a time, which answers "what did Anita's panel say" and not
  /// "what came back abnormal".
  Future<LabOverview> labOverview({int days = 30}) async {
    final json = await _client.getJson('/doctor/labs/overview?days=$days');
    return LabOverview.fromJson(json);
  }

  Future<DoctorWorklist> worklist() async {
    return DoctorWorklist.fromJson(await _client.getJson('/doctor/worklist'));
  }

  /// Registers a walk-in patient from the clinic side — some patients are
  /// enrolled at the desk rather than downloading the app first. Beyond
  /// name/phone the desk can capture demographics and an optional vitals
  /// snapshot; all extra fields are omitted from the payload when null.
  /// Returns what actually happened, which is not always "registered" — see
  /// [PatientRegistration].
  Future<PatientRegistration> createPatient({
    required String name,
    required String phone,

    /// Proof from `/auth/otp/verify` that a code texted to this number came
    /// back. Null when the desk registered without taking one — the record is
    /// still created, the patient just has an unproved number.
    String? phoneToken,
    int? age,
    String? gender,
    String? address,
    String? complaints,
    double? heightCm,
    double? weightKg,
    int? systolic,
    int? diastolic,
    int? pulse,
    int? spo2,
    int? glucoseMgDl,
  }) async {
    final json = await _client.postJson(
      '/doctor/patients',
      body: {
        'name': name,
        'phone': phone,
        if (phoneToken != null) 'phoneToken': phoneToken,
        if (age != null) 'age': age,
        if (gender != null) 'gender': gender,
        if (address != null && address.isNotEmpty) 'address': address,
        if (complaints != null && complaints.isNotEmpty)
          'complaints': complaints,
        if (heightCm != null) 'heightCm': heightCm,
        if (weightKg != null) 'weightKg': weightKg,
        if (systolic != null) 'systolic': systolic,
        if (diastolic != null) 'diastolic': diastolic,
        if (pulse != null) 'pulse': pulse,
        if (spo2 != null) 'spo2': spo2,
        if (glucoseMgDl != null) 'glucoseMgDl': glucoseMgDl,
      },
    );
    return PatientRegistration.fromJson(json);
  }

  /// Everybody this practice has registered who has not yet read back a code.
  ///
  /// Correctly absent from every clinical list — a pending enrolment grants
  /// nothing — and absent from everything else too until this existed, so a
  /// desk that did not get the code on the spot had a patient in limbo with no
  /// screen showing it.
  Future<List<PendingEnrolment>> pendingEnrolments() async {
    final json = await _client.getJson('/enrolments/pending');
    return ((json['items'] as List?) ?? const [])
        .map((e) => PendingEnrolment.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// The patient reads back the code texted to their own handset, and the
  /// enrolment stops being pending.
  ///
  /// Until this succeeds the practice holds a row that grants nothing and the
  /// patient appears in no list — which is the correct behaviour and was
  /// indistinguishable, from the counter, from the registration having failed.
  Future<void> confirmEnrolment({
    required String enrollmentId,
    required String code,
  }) async {
    await _client.postJson('/enrolments/$enrollmentId/confirm', body: {'code': code});
  }

  /// Today's clinic diary, earliest first. The API sorts newest-first and has no
  /// "today" filter of its own, so we pass an explicit day range and re-sort
  /// ascending for a top-to-bottom schedule.
  Future<List<Appointment>> appointmentsToday() async {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, now.day);
    final to = DateTime(now.year, now.month, now.day, 23, 59, 59, 999);
    final json = await _client.getJson(
      '/appointments',
      query: {
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
        'limit': 200,
      },
    );
    return (json['items'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Appointment.fromJson)
        .toList()
      ..sort((a, b) => a.sortKey.compareTo(b.sortKey));
  }

  /// The patient's own conversation, as the patient sees it.
  ///
  /// Reuses [ChatMessage] rather than a clinician-specific model on purpose:
  /// the doctor is reading the same thread, and a parallel type would let the
  /// two views drift apart.
  Future<
    ({
      String? patientName,
      String? patientPhone,
      String? patientAvatarUrl,
      List<ChatMessage> messages,
    })
  >
  patientThread(String patientId) async {
    final json = await _client.getJson(
      '/chat/patients/$patientId/thread',
      query: {'limit': 200},
    );
    final items =
        (json['items'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            // Sorted by createdAt, not seq: seq restarts per session, so it cannot
            // order a history that spans several.
            .map(ChatMessage.fromJson)
            .toList()
          ..sort((a, b) {
            final at = a.createdAt;
            final bt = b.createdAt;
            if (at == null || bt == null) return a.seq.compareTo(b.seq);
            return at.compareTo(bt);
          });

    final patient = json['patient'];
    return (
      patientName: patient is Map ? patient['name']?.toString() : null,
      // Carried so the clinician can call from inside the conversation.
      patientPhone: patient is Map ? patient['phone']?.toString() : null,
      patientAvatarUrl:
          patient is Map ? patient['avatarUrl']?.toString() : null,
      messages: items,
    );
  }

  /// Sends the clinician's own words into the patient's assistant thread.
  ///
  /// Not a separate inbox: the reply appears in the same conversation the
  /// patient is already reading, so the assistant's answers and the doctor's
  /// remain one exchange rather than two disconnected halves.
  Future<void> messagePatient({
    required String patientId,
    required String content,
    List<String> attachments = const [],
    String? replyTo,
  }) async {
    await _client.postJson(
      '/chat/patients/$patientId/clinician-message',
      body: {
        'content': content,
        if (attachments.isNotEmpty) 'attachments': attachments,
        if (replyTo != null) 'replyTo': replyTo,
      },
    );
  }

  /// Writes a prescription for a patient. The server mirrors each medicine into
  /// the patient's tracker (with reminder times derived from its frequency), so
  /// the patient starts getting dose reminders automatically. [items] entries
  /// are `{name, strength?, dose?, frequency?, durationDays?, relationToMeal,
  /// instructions?}`.
  Future<void> createPrescription({
    required String patientId,
    required List<Map<String, dynamic>> items,
    String? complaint,
    List<String> diagnosis = const [],
    List<String> labTestsAdvised = const [],
    String? generalAdvice,
    DateTime? followUpOn,
    SubmissionKeys? submission,
  }) async {
    final body = <String, dynamic>{
      'items': items,
      if (complaint != null && complaint.isNotEmpty) 'complaint': complaint,
      if (diagnosis.isNotEmpty) 'diagnosis': diagnosis,
      if (labTestsAdvised.isNotEmpty) 'labTestsAdvised': labTestsAdvised,
      if (generalAdvice != null && generalAdvice.isNotEmpty)
        'generalAdvice': generalAdvice,
      if (followUpOn != null) 'followUpOn': followUpOn.toIso8601String(),
    };
    await _client.postJson(
      '/patients/$patientId/prescriptions',
      body: body,
      // From the exact body sent, so a retry of this prescription is answered
      // with the one already issued and a corrected one is issued afresh.
      headers: submission == null
          ? null
          : {'Idempotency-Key': submission.keyFor('prescription', body)},
    );
  }

  /// Reads a photographed prescription without filing anything.
  ///
  /// Two calls, because the desk has to see what was read before it is
  /// written. The thing being checked is whose name is on the paper: filing
  /// one patient's slip onto another's chart is the mistake that harms
  /// somebody, and a misfiled prescription looks exactly as correct as a right
  /// one afterwards.
  Future<PrescriptionScan> readScannedPrescription({
    required String patientId,
    required String assetId,
  }) async {
    final json = await _client.postJson(
      '/patients/$patientId/prescriptions/scan/read',
      body: {'assetId': assetId},
    );
    return PrescriptionScan.fromJson(json);
  }

  /// Files a photograph or PDF of a paper prescription against a patient.
  ///
  /// Two calls on purpose. The upload puts the bytes somewhere and hands back
  /// an asset id; this then records what that asset *is*. Combining them would
  /// mean a failed save left an orphaned file and a desk with no way to retry
  /// except photographing the paper again.
  Future<void> fileScannedPrescription({
    required String patientId,
    required String assetId,
    DateTime? issuedOn,
    String? note,
    /// What [readScannedPrescription] found and the desk confirmed. All
    /// optional: an unreadable photograph still files, as an image with no
    /// detail, which beats refusing to record it.
    List<ScannedRxItem>? items,
    List<String>? diagnosis,
    List<String>? labTests,
    String? advice,
  }) async {
    await _client.postJson(
      '/patients/$patientId/prescriptions/scan',
      body: {
        'assetId': assetId,
        if (issuedOn != null) 'issuedOn': issuedOn.toIso8601String(),
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (items != null && items.isNotEmpty)
          'items': items.map((m) => m.toJson()).toList(),
        if (diagnosis != null && diagnosis.isNotEmpty) 'diagnosis': diagnosis,
        if (labTests != null && labTests.isNotEmpty)
          'labTestsAdvised': labTests,
        if (advice != null && advice.trim().isNotEmpty)
          'generalAdvice': advice.trim(),
      },
    );
  }

  /// Records a consult-time vitals snapshot (height/weight to the profile, the
  /// rest as a VitalRecord + glucose reading). All values optional — only the
  /// ones the doctor measured are sent.
  Future<void> recordConsultVitals({
    required String patientId,
    String? complaint,
    double? heightCm,
    double? weightKg,
    double? waistCm,
    int? systolic,
    int? diastolic,
    int? pulse,
    int? spo2,
    int? glucoseMgDl,
    SubmissionKeys? submission,
  }) async {
    final body = <String, dynamic>{
      if (complaint != null && complaint.isNotEmpty) 'complaint': complaint,
      if (heightCm != null) 'heightCm': heightCm,
      if (weightKg != null) 'weightKg': weightKg,
      if (waistCm != null) 'waistCm': waistCm,
      if (systolic != null) 'systolic': systolic,
      if (diastolic != null) 'diastolic': diastolic,
      if (pulse != null) 'pulse': pulse,
      if (spo2 != null) 'spo2': spo2,
      if (glucoseMgDl != null) 'glucoseMgDl': glucoseMgDl,
    };
    if (body.isEmpty) return;
    await _client.postJson(
      '/doctor/patients/$patientId/vitals',
      body: body,
      headers: submission == null
          ? null
          : {'Idempotency-Key': submission.keyFor('vitals', body)},
    );
  }

  /// Medication adherence over a window (days) — for the profile's adherence
  /// sheet week/month/year filter.
  Future<AdherenceReport> patientAdherence(
    String patientId, {
    int days = 30,
  }) async {
    final json = await _client.getJson(
      '/doctor/patients/$patientId/adherence',
      query: {'days': days},
    );
    return AdherenceReport.fromJson(json);
  }

  /// The patient's past prescriptions/consultations, latest first.
  Future<List<PrescriptionSummary>> patientPrescriptions(
    String patientId,
  ) async {
    final json = await _client.getJson(
      '/patients/$patientId/prescriptions?limit=20',
    );
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(PrescriptionSummary.fromJson)
        .toList();
  }

  // ---- the team ---------------------------------------------------------------

  /// Everyone at this practice, with every dimension the screen needs.
  ///
  /// One request rather than three: the people, the department and location
  /// pickers, whether this reader may change anything, and how close the
  /// practice is to its staff cap.
  Future<TeamRoster> team() async {
    return TeamRoster.fromJson(await _client.getJson('/team'));
  }

  /// Send a hiring code to [phone], in E.164.
  ///
  /// Not `/auth/otp/request` with purpose `register`. That refuses a number
  /// which already has an account, so a doctor or a receptionist who already
  /// used MedPin anywhere could never be added to another practice. This sends
  /// the code whether or not the number has an account; what an existing
  /// account may be hired as is the server's answer to [hire].
  Future<void> requestHireCode(String phone) async {
    await _client.postJson('/team/phone/otp', body: {'phone': phone});
  }

  /// Spend the code read back from [phone]. Returns the phone token [hire]
  /// takes as proof the number was answered.
  Future<String> verifyHireCode(String phone, String code) async {
    final json = await _client.postJson(
      '/team/phone/verify',
      body: {'phone': phone, 'code': code},
    );
    return json['phoneToken'] as String;
  }

  /// Hire somebody into any role the practice employs.
  ///
  /// One call for every role. The role is a field, not a URL: three routes is
  /// how the dietician path came to be the only one that forgot to create a
  /// membership, because nothing held them together.
  ///
  /// [phoneToken] is proof the number was answered. A regex tests the shape of
  /// a phone number and nothing about who holds it, and for a doctor the
  /// account it creates can prescribe.
  ///
  /// True when the number already had an account and this practice was added
  /// to it, rather than a new account being made. They keep their own sign-in,
  /// and [password] only ever applies to a new account.
  Future<bool> hire({
    required String role,
    required String name,
    required String phoneToken,
    String? password,
    String? departmentId,
    String? locationId,
    String? qualifications,
    String? registrationNo,
  }) async {
    final json = await _client.postJson(
      '/team',
      body: {
        'role': role,
        'name': name,
        'phoneToken': phoneToken,
        if (password != null && password.isNotEmpty) 'password': password,
        if (departmentId != null) 'departmentId': departmentId,
        if (locationId != null) 'locationId': locationId,
        if (qualifications != null && qualifications.isNotEmpty)
          'qualifications': qualifications,
        if (registrationNo != null && registrationNo.isNotEmpty)
          'registrationNo': registrationNo,
      },
    );
    return json['existing'] == true;
  }

  /// Change what somebody is here: their role, their department, their
  /// location, whether they are suspended.
  ///
  /// Not their name or number — those belong to the person and are edited from
  /// their own profile. Pass an explicit null to clear a department or a
  /// location; omitting it leaves it alone.
  Future<void> updateMember(
    String membershipId, {
    String? role,
    Object? departmentId = _unset,
    Object? locationId = _unset,
    String? status,
  }) async {
    await _client.patchJson(
      '/team/$membershipId',
      body: {
        if (role != null) 'role': role,
        if (!identical(departmentId, _unset)) 'departmentId': departmentId,
        if (!identical(locationId, _unset)) 'locationId': locationId,
        if (status != null) 'status': status,
      },
    );
  }

  // ---- departments ----------------------------------------------------------

  /// The specialties this practice can use: the shared ones and its own.
  ///
  /// The practice is never sent. It comes from the membership server-side —
  /// this router used to take it from the query string, which let any clinician
  /// read another practice's list by editing a URL.
  Future<List<Department>> departments() async {
    final json = await _client.getJson('/departments');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(Department.fromJson)
        .toList();
  }

  /// Add one this practice runs.
  ///
  /// [key] is the stable identifier and cannot be changed afterwards: the
  /// assistant scope and the seed data key off it, and renaming it would orphan
  /// both. The display name can be edited freely.
  Future<Department> createDepartment({
    required String key,
    required String name,
  }) async {
    final json = await _client.postJson(
      '/departments',
      body: {
        'key': key,
        'names': {'en': name},
      },
    );
    return Department.fromJson(json['department'] as Map<String, dynamic>);
  }

  /// Rename one, reorder it, or retire it. Its own rows only — a shared
  /// specialty is refused by the server, because one practice renaming
  /// "Cardiologist" would rename it on every other practice's letterhead.
  Future<Department> updateDepartment(
    String id, {
    String? name,
    bool? isActive,
    int? sortIndex,
  }) async {
    final json = await _client.patchJson(
      '/departments/$id',
      body: {
        if (name != null) 'names': {'en': name},
        if (isActive != null) 'isActive': isActive,
        if (sortIndex != null) 'sortIndex': sortIndex,
      },
    );
    return Department.fromJson(json['department'] as Map<String, dynamic>);
  }

  /// Dieticians the doctor can assign a patient to.
  Future<List<({String id, String name})>> dieticians() async {
    final json = await _client.getJson('/doctor/dieticians');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(
          (d) => (
            id: d['id']?.toString() ?? '',
            name: d['name']?.toString() ?? '',
          ),
        )
        .toList();
  }

  /*
   * Creating people moved to /team, and these went with it.
   *
   * `addDietician`, `staff`, `createStaff` and `removeStaff` pointed at
   * `/doctor/dieticians` (POST) and `/doctor/staff`, neither of which the
   * server has any more — the unified People screen replaced them. Nothing
   * called any of the four, so they were a 404 waiting for whoever wired one
   * up next, with no obvious cause.
   *
   * `dieticians()` above stays. It is not a duplicate of /team: it is the
   * picker for assigning a patient, and /team would fetch limits, permissions,
   * departments and locations to fill a dropdown.
   */

  /// Assign the patient's dietician and food-log review cadence. A null
  /// [dieticianId] unassigns; a null [reviewIntervalDays] clears the cadence.
  Future<void> assignDietician(
    String patientId, {
    String? dieticianId,
    int? reviewIntervalDays,
  }) async {
    await _client.patchJson(
      '/doctor/patients/$patientId/dietician',
      body: {
        'dieticianId': dieticianId,
        'reviewIntervalDays': reviewIntervalDays,
      },
    );
  }

  Future<Paged<PatientListItem>> patients({
    String? riskBand,
    String? search,
    String sort = 'risk',
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/doctor/patients',
      query: {
        'page': page,
        'limit': limit,
        'sort': sort,
        if (riskBand != null) 'riskBand': riskBand,
        if (search != null && search.isNotEmpty) 'search': search,
      },
    );
    return Paged.fromJson(json, PatientListItem.fromJson);
  }

  Future<PatientSummary> patientSummary(String id) async {
    final json = await _client.getJson('/doctor/patients/$id/summary');
    return PatientSummary.fromJson(json);
  }

  Future<Paged<ClinicalAlert>> alerts({
    String? status,
    String? severity,
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/doctor/alerts',
      query: {
        'page': page,
        'limit': limit,
        if (status != null) 'status': status,
        if (severity != null) 'severity': severity,
      },
    );
    return Paged.fromJson(json, ClinicalAlert.fromJson);
  }

  Future<ClinicalAlert> acknowledgeAlert(String id) async {
    final json = await _client.postJson('/doctor/alerts/$id/acknowledge');
    return ClinicalAlert.fromJson(json['alert'] as Map<String, dynamic>);
  }

  Future<ClinicalAlert> resolveAlert(String id, {String? notes}) async {
    final json = await _client.postJson(
      '/doctor/alerts/$id/resolve',
      body: {if (notes != null && notes.isNotEmpty) 'notes': notes},
    );
    return ClinicalAlert.fromJson(json['alert'] as Map<String, dynamic>);
  }

  // ---- The patient's current medicines ------------------------------------

  /// What this patient is already on.
  ///
  /// The prescribing form had no idea: the doctor wrote a new prescription
  /// without being shown the running list, which is how a drug gets duplicated
  /// or prescribed against something already there.
  Future<List<Medication>> patientMedications(String patientId) async {
    final json = await _client.getJson('/patients/$patientId/medications');
    final items =
        (json['items'] as List?) ?? (json['medications'] as List?) ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(Medication.fromJson)
        .toList();
  }

  /// Stops a medicine. A soft stop on the server — it keeps `isActive: false`
  /// with an end date, so past doses and the adherence figure built from them
  /// stay interpretable.
  Future<void> stopMedication(String patientId, String medicationId) async {
    await _client.delete('/patients/$patientId/medications/$medicationId');
  }

  // ---- Conversation summaries ---------------------------------------------

  /// One day of patients' conversations, summarised, the ones needing a
  /// clinician first. [day] null is today in the clinic's timezone — never the
  /// phone's. [scope] is `mine` (the patients this person answers for, and
  /// those nobody does) or `practice`.
  Future<ChatSummaryDay> chatSummaries({
    String? day,
    String scope = 'mine',
    String kind = 'care',
  }) async {
    final json = await _client.getJson(
      '/chat-summaries',
      query: {'scope': scope, 'kind': kind, if (day != null) 'day': day},
    );
    return ChatSummaryDay.fromJson(json);
  }

  /// "I have read this day." Per person; the server clears it when the patient
  /// writes again.
  Future<void> markSummaryReviewed(String id) async {
    await _client.postJson('/chat-summaries/$id/reviewed');
  }

  // ---- Chat review ------------------------------------------------------

  /// [kind] is `care` (assistant + doctor) or `nutrition` (the dietician's own
  /// thread); null returns both. Without it the Nutrition tab was the same
  /// query as All chats and simply showed everything.
  Future<Paged<ChatReviewSession>> chatReviewSessions({
    bool flagged = true,
    String? urgency,
    String? kind,
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/doctor/chat-review',
      query: {
        'page': page,
        'limit': limit,
        'flagged': flagged,
        if (urgency != null) 'urgency': urgency,
        if (kind != null) 'kind': kind,
      },
    );
    return Paged.fromJson(json, ChatReviewSession.fromJson);
  }

  Future<ChatReviewDetail> chatReviewDetail(String sessionId) async {
    final json = await _client.getJson('/doctor/chat-review/$sessionId');
    return ChatReviewDetail.fromJson(json);
  }

  Future<void> markReviewed(String sessionId) async {
    await _client.postJson('/doctor/chat-review/$sessionId/reviewed');
  }

  /// Reply into a conversation by session id — works for care AND nutrition, so
  /// the doctor can step into a dietician↔patient nutrition thread to guide it.
  Future<void> replyInSession(
    String sessionId,
    String content, {
    List<String> attachments = const [],
    String? replyTo,
  }) async {
    await _client.postJson(
      '/doctor/chat-review/$sessionId/message',
      body: {
        'content': content,
        if (attachments.isNotEmpty) 'attachments': attachments,
        if (replyTo != null) 'replyTo': replyTo,
      },
    );
  }

  // ---- Knowledge base ---------------------------------------------------

  Future<Paged<KnowledgeChunk>> knowledge({
    String? status,
    String? category,
    String? language,
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/doctor/knowledge',
      query: {
        'page': page,
        'limit': limit,
        if (status != null) 'status': status,
        if (category != null) 'category': category,
        if (language != null) 'language': language,
      },
    );
    return Paged.fromJson(json, KnowledgeChunk.fromJson);
  }

  Future<KnowledgeChunk> createKnowledge(Map<String, dynamic> body) async {
    final json = await _client.postJson('/doctor/knowledge', body: body);
    return KnowledgeChunk.fromJson(json['chunk'] as Map<String, dynamic>);
  }

  Future<KnowledgeChunk> updateKnowledge(
    String id,
    Map<String, dynamic> body,
  ) async {
    final json = await _client.patchJson('/doctor/knowledge/$id', body: body);
    return KnowledgeChunk.fromJson(json['chunk'] as Map<String, dynamic>);
  }

  Future<KnowledgeChunk> approveKnowledge(String id) async {
    final json = await _client.postJson('/doctor/knowledge/$id/approve');
    return KnowledgeChunk.fromJson(json['chunk'] as Map<String, dynamic>);
  }

  Future<KnowledgeChunk> retireKnowledge(String id) async {
    final json = await _client.postJson('/doctor/knowledge/$id/retire');
    return KnowledgeChunk.fromJson(json['chunk'] as Map<String, dynamic>);
  }
}

final Provider<ClinicianRepository> clinicianRepositoryProvider =
    Provider<ClinicianRepository>((ref) {
      return ClinicianRepository(ref.watch(apiClientProvider));
    });
