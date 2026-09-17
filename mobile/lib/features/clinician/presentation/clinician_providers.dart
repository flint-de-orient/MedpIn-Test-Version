import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/paged.dart';
import '../data/clinician_repository.dart';
import '../domain/appointment.dart';
import '../../medications/domain/medication.dart';
import '../domain/chat_review.dart';
import '../domain/chat_summary.dart';
import '../domain/caseload_panels.dart';
import '../domain/ecg_report.dart';
import '../domain/department.dart';
import '../domain/patient_registration.dart';
import '../domain/team_member.dart';
import '../domain/clinician_models.dart';
import '../domain/lab_overview.dart';
import '../domain/knowledge_chunk.dart';
import '../domain/patient_summary.dart';
import '../../../shared/widgets/notification_list_sheet.dart';

/// Everyone at this practice, with their role, department, location and status.
///
/// One request behind the People screen and the Practice screen's headcount.
/// Not `autoDispose` for the same reason as [departmentsProvider]: two screens
/// read it and tapping between them should not refetch.
final teamProvider = FutureProvider<TeamRoster>((ref) {
  return ref.watch(clinicianRepositoryProvider).team();
});

/// The specialties this practice can use — its own and the shared ones.
///
/// Not `autoDispose`: the practice screen reads it for a count and the
/// departments screen reads it for the list, and disposing between the two
/// means a refetch every time somebody taps through.
final departmentsProvider = FutureProvider<List<Department>>((ref) {
  return ref.watch(clinicianRepositoryProvider).departments();
});

/// Dashboard headline numbers.
final overviewProvider = FutureProvider.autoDispose<ClinicOverview>((ref) {
  return ref.watch(clinicianRepositoryProvider).overview();
});

/// Clinic-wide population analytics for the dashboard charts. Cached server-side
/// (~2 min TTL), so the dashboard's poll re-fetches it cheaply.
///
/// Keyed by the window in days, so the snapshot's range control is a real
/// query rather than a label over a fixed month of data — picking "Last 7
/// days" has to change the figure, or it is decoration.
final clinicAnalyticsProvider = FutureProvider.autoDispose
    .family<ClinicAnalytics, int>((ref, days) {
      return ref.watch(clinicianRepositoryProvider).analytics(days: days);
    });

/// What came back from the lab, across the practice.
///
/// Keyed by the window in days for the same reason [clinicAnalyticsProvider]
/// is: a range control over a fixed month of data is a label, not a query.
final labOverviewProvider = FutureProvider.autoDispose.family<LabOverview, int>(
  (ref, days) {
    return ref.watch(clinicianRepositoryProvider).labOverview(days: days);
  },
);

/// The Patients tab: counts, the action queue, and the latest meals logged.
final worklistProvider = FutureProvider.autoDispose<DoctorWorklist>((ref) {
  return ref.watch(clinicianRepositoryProvider).worklist();
});

/// Today's clinic diary (kept for the appointments admin screen).
final appointmentsTodayProvider = FutureProvider.autoDispose<List<Appointment>>(
  (ref) {
    return ref.watch(clinicianRepositoryProvider).appointmentsToday();
  },
);

/// Patients for the dashboard's "Needs Attention" worklist. Pulled risk-first
/// from the directory; the dashboard ranks the ones actually needing action
/// (alerts, unread, abnormal glucose, high risk) on the client.
final attentionPatientsProvider =
    FutureProvider.autoDispose<List<PatientListItem>>((ref) async {
      final paged = await ref
          .watch(clinicianRepositoryProvider)
          .patients(sort: 'risk', limit: 100);
      return paged.items;
    });

/// One page of the roll: the most the server sends at once.
const patientsPageSize = 100;

/// `pages` is how many pages deep, counting from the first.
typedef PatientsQuery = ({
  String? riskBand,
  String? search,
  String sort,
  int pages,
});

/// The roll, `pages` pages deep, as one list.
///
/// ---- Why pages, and why every one of them on each read ------------------
///
/// This was one page of a hundred sorted by name, and the inbox put unread
/// conversations first on the phone. So an unread message from the
/// hundred-and-first patient by name was never fetched, and the screen whose
/// whole job is "who is waiting on me" could not show it. The server now puts
/// the whole list in order before paging it, and a longer list is more pages.
///
/// The pages already on screen are read again together, in parallel, because
/// the inbox polls: refreshing only the newest page would leave the ones above
/// it stale, and a conversation that moved between them would be missing from
/// both.
final patientsProvider = FutureProvider.autoDispose
    .family<Paged<PatientListItem>, PatientsQuery>((ref, q) async {
      final repo = ref.watch(clinicianRepositoryProvider);
      final pages = await Future.wait([
        for (var page = 1; page <= (q.pages < 1 ? 1 : q.pages); page++)
          repo.patients(
            riskBand: q.riskBand,
            search: q.search,
            sort: q.sort,
            page: page,
            limit: patientsPageSize,
          ),
      ]);
      return mergePages(pages, idOf: (p) => p.id);
    });

/// Who the practice is waiting on a code from.
///
/// Not `autoDispose`: the patient list reads it for the banner and the sheet
/// behind it reads it for the rows, and disposing between the two would refetch
/// on every open. Invalidated when a code is confirmed, which is the only thing
/// that changes it from this side.
final pendingEnrolmentsProvider = FutureProvider<List<PendingEnrolment>>((ref) {
  return ref.watch(clinicianRepositoryProvider).pendingEnrolments();
});

final patientSummaryProvider = FutureProvider.autoDispose
    .family<PatientSummary, String>((ref, id) {
      return ref.watch(clinicianRepositoryProvider).patientSummary(id);
    });

/// The patient's past prescriptions/consultations, for the record's history.
final patientPrescriptionsProvider = FutureProvider.autoDispose
    .family<List<PrescriptionSummary>, String>((ref, id) {
      return ref.watch(clinicianRepositoryProvider).patientPrescriptions(id);
    });

typedef AlertsQuery = ({String? status, String? severity});

final alertsProvider = FutureProvider.autoDispose
    .family<Paged<ClinicalAlert>, AlertsQuery>((ref, q) {
      return ref
          .watch(clinicianRepositoryProvider)
          .alerts(status: q.status, severity: q.severity, limit: 100);
    });

/// The patient's live medication list, for the prescribing screen.
///
/// autoDispose so reopening a patient always re-reads it — a list of what
/// someone is currently taking is the last thing that should be served from a
/// stale cache.
final patientMedicationsProvider = FutureProvider.autoDispose
    .family<List<Medication>, String>((ref, patientId) {
      return ref
          .watch(clinicianRepositoryProvider)
          .patientMedications(patientId);
    });

// ---- Chat review --------------------------------------------------------

typedef ChatReviewQuery = ({bool flagged, String? urgency, String? kind});

final chatReviewProvider = FutureProvider.autoDispose
    .family<Paged<ChatReviewSession>, ChatReviewQuery>((ref, q) {
      return ref
          .watch(clinicianRepositoryProvider)
          .chatReviewSessions(
            flagged: q.flagged,
            urgency: q.urgency,
            kind: q.kind,
            limit: 100,
          );
    });

final chatReviewDetailProvider = FutureProvider.autoDispose
    .family<ChatReviewDetail, String>((ref, sessionId) {
      return ref.watch(clinicianRepositoryProvider).chatReviewDetail(sessionId);
    });

// ---- Conversation summaries ---------------------------------------------

/// [day] null is today in the clinic's timezone; [scope] `mine` or `practice`.
typedef ChatSummaryQuery = ({String? day, String scope, String kind});

final chatSummariesProvider = FutureProvider.autoDispose
    .family<ChatSummaryDay, ChatSummaryQuery>((ref, q) {
      return ref
          .watch(clinicianRepositoryProvider)
          .chatSummaries(day: q.day, scope: q.scope, kind: q.kind);
    });

// ---- caseload panels (routes/panels.js) ------------------------------------
//
// Fetched when the dashboard opens, returns to the foreground or is pulled —
// not on the twenty-second poll. Each reads every reading or prescription in
// its window for the whole caseload, which is not a question worth asking three
// times a minute. See _refreshConversations in the dashboard screen.

/// Blood pressure bands over the last [days] days.
final bpControlProvider = FutureProvider.autoDispose.family<BpControl, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).bpControl(days: days),
);

/// Follow-ups due in the next [days] days, and those overdue.
final followUpsProvider = FutureProvider.autoDispose.family<FollowUps, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).followUps(days: days),
);

/// Diagnosed conditions across the caseload, named in [language].
final conditionRegisterProvider =
    FutureProvider.autoDispose.family<ConditionRegister, String>(
  (ref, language) =>
      ref.watch(clinicianRepositoryProvider).conditionRegister(language: language),
);

/// Latest pulses outside the triage limits over the last [days] days.
final heartRateFlagsProvider = FutureProvider.autoDispose.family<HeartRateFlags, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).heartRateFlags(days: days),
);

/// Latest ECG per patient by impression, over the last [days] days.
final ecgPanelProvider = FutureProvider.autoDispose.family<EcgPanel, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).ecgPanel(days: days),
);

/// Latest LDL per patient against the catalog's limit, over the last [days] days.
final lipidControlProvider = FutureProvider.autoDispose.family<LipidControl, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).lipidControl(days: days),
);

/// Every low and very high sugar across the caseload, over the last [days] days.
final glucoseFlagsProvider = FutureProvider.autoDispose.family<GlucoseFlags, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).glucoseFlags(days: days),
);

/// Latest HbA1c per patient against their target, and who has had none in
/// [days] days.
final hba1cControlProvider = FutureProvider.autoDispose.family<Hba1cControl, int>(
  (ref, days) => ref.watch(clinicianRepositoryProvider).hba1cControl(days: days),
);

/// The ECGs this practice may read for one patient.
final patientEcgsProvider = FutureProvider.autoDispose.family<List<EcgReport>, String>(
  (ref, patientId) => ref.watch(clinicianRepositoryProvider).ecgReports(patientId),
);

// ---- Knowledge base -----------------------------------------------------

typedef KnowledgeQuery = ({String? status, String? category, String? language});

final knowledgeProvider = FutureProvider.autoDispose
    .family<Paged<KnowledgeChunk>, KnowledgeQuery>((ref, q) {
      return ref
          .watch(clinicianRepositoryProvider)
          .knowledge(
            status: q.status,
            category: q.category,
            language: q.language,
            limit: 100,
          );
    });

/// Everything waiting for the doctor, for the bell and its sheet.
final clinicianNotificationsProvider = FutureProvider.autoDispose<
  ({
    int unread,
    int messages,
    int alerts,
    int requests,
    List<PanelNotification> items,
  })
>((ref) => ref.watch(clinicianRepositoryProvider).notifications());
