import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/paged.dart';
import '../data/clinician_repository.dart';
import '../domain/appointment.dart';
import '../../medications/domain/medication.dart';
import '../domain/chat_review.dart';
import '../domain/department.dart';
import '../domain/clinician_models.dart';
import '../domain/knowledge_chunk.dart';
import '../domain/patient_summary.dart';
import '../../../shared/widgets/notification_list_sheet.dart';

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

typedef PatientsQuery = ({String? riskBand, String? search, String sort});

final patientsProvider = FutureProvider.autoDispose
    .family<Paged<PatientListItem>, PatientsQuery>((ref, q) {
      return ref
          .watch(clinicianRepositoryProvider)
          .patients(
            riskBand: q.riskBand,
            search: q.search,
            sort: q.sort,
            limit: 100,
          );
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

/// The clinic's dieticians — used by the patient profile to decide whether the
/// "Restrict" action is even meaningful (it needs 2+ dieticians; restricting the
/// only one would cut them off from every other patient).
final clinicDieticiansProvider =
    FutureProvider.autoDispose<List<({String id, String name})>>((ref) {
      return ref.watch(clinicianRepositoryProvider).dieticians();
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
