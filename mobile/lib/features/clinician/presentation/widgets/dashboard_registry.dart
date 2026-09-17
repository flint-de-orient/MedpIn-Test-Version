import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/capabilities/capabilities.dart';
import '../../../../shared/models/paged.dart';
import '../../domain/clinician_models.dart';
import '../../domain/lab_overview.dart';

import 'caseload_panels.dart';
import 'chat_summary_card.dart';
import 'dashboard_sections.dart';
import 'lab_panels.dart';
import 'todays_clinic.dart';
import 'triage_queue.dart';

/// Every component the server may put on a clinician's home screen.
///
/// ---- The app's half of the contract -------------------------------------
///
/// The server sends identifiers from `services/uiConfig.js` — never layout,
/// never styling, never data. What a component looks like, what it fetches and
/// how it behaves are decided here; whether it appears at all is decided
/// there. A response carrying the other half would be a backend able to draw
/// anything it liked on a clinician's phone, which is not a thing a server
/// should be able to do however well it is behaving today.
///
/// ---- A name this app does not know is dropped, not an error --------------
///
/// The two ends version independently. A phone a release behind will meet a
/// component that did not exist when it shipped, and the right answer is a
/// slightly shorter dashboard — not a red screen in front of a patient, and
/// not a grey box saying `CRITICAL_LAB_RESULTS`.
///
/// ---- Adding one ----------------------------------------------------------
///
/// A new identifier is added to `uiConfig.js` and to this map in the same
/// change. One without the other is a component the server offers and the app
/// silently drops, which looks from the console exactly like a configuration
/// that took effect. `appCallsRoutes.test.js` fails when the two disagree.
typedef WidgetBuilderFn = Widget? Function(DashboardData data);

/// What every dashboard component is built from.
///
/// ---- Requests, not values ------------------------------------------------
///
/// This carried `ClinicOverview?` and a list defaulted to empty, so a panel
/// could not tell "nobody needs attention" from "the request failed" — and
/// said the first either way. Each field is now the request's whole state, and
/// [HomePanel] turns it into loading, failed, refused, unavailable, answered or
/// out of date.
///
/// Passed in rather than read inside each builder for the requests the home
/// polls together, so one screen's poll drives them all.
class DashboardData {
  const DashboardData({
    required this.caps,
    required this.widgets,
    required this.actions,
    required this.overview,
    required this.attention,
    required this.analytics,
    required this.alerts,
    required this.labs,
    required this.days,
    required this.onDaysChanged,
    required this.onRetry,
  });

  final Capabilities caps;

  /// The components on this home, so one can defer to another — the alerts
  /// action steps aside when the triage card already links the alerts.
  final List<String> widgets;

  /// The actions the server allowed, in its order.
  final List<String> actions;

  final AsyncValue<ClinicOverview> overview;

  /// Null when nothing on this home needs it, and it is not fetched.
  final AsyncValue<List<PatientListItem>>? attention;
  final AsyncValue<ClinicAnalytics>? analytics;
  final AsyncValue<Paged<ClinicalAlert>>? alerts;
  final AsyncValue<LabOverview>? labs;

  final int days;
  final ValueChanged<int> onDaysChanged;

  /// Ask again for everything the home polls.
  final VoidCallback onRetry;

  /// True once the overview has answered that this practice has no patients.
  ///
  /// Null-safe in the direction that matters: while the overview is loading or
  /// has failed this is false, and every panel shows its own state rather than
  /// all of them vanishing behind a claim nobody has checked.
  bool get practiceEmpty => overview.valueOrNull?.patientCount == 0;

  /// Whether anything answers in this practice's nutrition conversations, and
  /// this person may read them.
  bool get nutritionStream =>
      caps.can(Perm.chatRead) && (caps.has(Cap.aiAssistant) || caps.hasDietician);
}

/// The registry. Keys mirror `WIDGETS` in `services/uiConfig.js`.
final Map<String, WidgetBuilderFn> dashboardWidgets = {
  // ---- the clinical day ---------------------------------------------------
  'TODAYS_CLINIC': (d) => TodaysClinic(
    actions: d.actions,
    practiceEmpty: d.practiceEmpty,
    alertsOnScreen: d.widgets.contains('TRIAGE_QUEUE'),
  ),

  // A new practice has nobody to triage; the card that says so, once, stands
  // in for the caseload.
  'TRIAGE_QUEUE': (d) => d.practiceEmpty
      ? const EmptyPracticeCard()
      : d.attention == null
      ? null
      : TriageQueue(
          patients: d.attention!,
          openAlerts: d.overview.valueOrNull?.totalOpenAlerts,
        ),

  'ACTION_QUEUE': (d) {
    final o = d.overview.valueOrNull;
    // Noise when empty, so hidden once answered with nothing waiting — but a
    // failure or the first load still shows, so it cannot vanish silently.
    if (o != null &&
        WaitingOnYouCard.rows(o, d.analytics?.valueOrNull, nutritionStream: d.nutritionStream).isEmpty) {
      return null;
    }
    return WaitingOnYouCard(
      overview: d.overview,
      analytics: d.analytics?.valueOrNull,
      nutritionStream: d.nutritionStream,
      onRetry: d.onRetry,
    );
  },

  'NUTRITION_REVIEWS': (d) => !d.nutritionStream || d.practiceEmpty
      ? null
      : NutritionCard(overview: d.overview, onRetry: d.onRetry),

  'OPEN_ALERTS': (d) => d.alerts == null
      ? null
      : OpenAlertsCard(alerts: d.alerts!, onRetry: d.onRetry),

  'LIVE_ACTIVITY': (d) {
    final events = LiveActivity.from(
      patients: d.attention?.valueOrNull ?? const [],
      reviews: d.overview.valueOrNull?.nutritionReviews ?? const [],
    );
    // Hidden when there is nothing, unlike the panels above. No recent
    // activity is the absence of a log, not a clinical fact.
    return events.isEmpty ? null : LiveActivity(events: events);
  },

  // Its own request rather than the shared poll — see ChatSummaryCard.
  'CHAT_SUMMARIES': (d) => d.practiceEmpty ? null : const ChatSummaryCard(),

  // ---- the caseload: routes/panels.js ---------------------------------------
  // Their own requests, on the slower rhythm. See caseload_panels.dart. A
  // practice with no patients shows EmptyPracticeCard instead of each of these
  // saying so in turn.
  'GLUCOSE_FLAGS': (d) => d.practiceEmpty
      ? null
      : GlucoseFlagsCard(showInRange: !d.widgets.contains('ANALYTICS_SUMMARY')),
  'HBA1C_CONTROL': (d) => d.practiceEmpty ? null : const Hba1cControlCard(),
  'BP_CONTROL': (d) => d.practiceEmpty ? null : const BpControlCard(),
  'FOLLOW_UPS_DUE': (d) => d.practiceEmpty ? null : const FollowUpsDueCard(),
  'CONDITION_REGISTRY': (d) => d.practiceEmpty ? null : const ConditionRegisterCard(),
  'HEART_RATE_FLAGS': (d) => d.practiceEmpty ? null : const HeartRateFlagsCard(),
  'RECENT_ECGS': (d) => d.practiceEmpty ? null : const RecentEcgsCard(),
  'LIPID_CONTROL': (d) => d.practiceEmpty ? null : const LipidControlCard(),

  // ---- what the practice has bought ---------------------------------------
  'ANALYTICS_SUMMARY': (d) => d.analytics == null || d.practiceEmpty
      ? null
      : GlucoseInRangeCard(
          analytics: d.analytics!,
          days: d.days,
          onDaysChanged: d.onDaysChanged,
          onRetry: d.onRetry,
        ),

  // ---- labs ---------------------------------------------------------------
  'CRITICAL_LAB_RESULTS': (d) => d.labs == null
      ? null
      : CriticalLabResults(overview: d.labs!, onRetry: d.onRetry),
  'RECENT_LAB_REPORTS': (d) => d.labs == null
      ? null
      : RecentLabReports(overview: d.labs!, onRetry: d.onRetry),
  'LAB_FLAG_SUMMARY': (d) => d.labs == null
      ? null
      : LabFlagSummary(overview: d.labs!, onRetry: d.onRetry),
};

/// Whether anything on this dashboard needs the lab overview fetched.
///
/// So a clinic that shows no lab panel makes no lab request.
bool needsLabOverview(List<String> widgets) =>
    widgets.any((id) => id.contains('LAB'));

/// Every action the server may offer, and where each one goes.
///
/// An action whose destination does not exist is a button that goes nowhere,
/// which is worse than an absent one because somebody presses it in front of a
/// patient. Each of these opens a route that is registered in `app_router`.
typedef ActionSpec = ({String label, IconData icon, String route});

/// Keys mirror `QUICK_ACTIONS` in `services/uiConfig.js`.
///
/// Named for what pressing it does, in the words the rest of the app uses for
/// the same place — "People", "Export data", as on the More screen. Three of
/// these open the patient list; [HomeActions] draws only the first of any
/// actions that share a destination.
final Map<String, ActionSpec> dashboardActions = {
  'START_CONSULTATION': (
    label: 'Start consultation',
    icon: Icons.medical_services_outlined,
    route: '/clinician/patients',
  ),
  'ADD_PATIENT': (
    label: 'Add patient',
    icon: Icons.person_add_alt_1_outlined,
    route: '/clinician/patients/new',
  ),
  'RECORD_VITALS': (
    label: 'Record vitals',
    icon: Icons.monitor_heart_outlined,
    route: '/clinician/patients',
  ),
  'WRITE_PRESCRIPTION': (
    label: 'Write prescription',
    icon: Icons.receipt_long_outlined,
    route: '/clinician/patients',
  ),
  'VIEW_ALERTS': (
    label: 'Clinical alerts',
    icon: Icons.notification_important_outlined,
    route: '/clinician/alerts',
  ),
  'VIEW_LAB_REPORTS': (
    label: 'Find a patient’s reports',
    icon: Icons.science_outlined,
    route: '/clinician/patients',
  ),
  'EXPORT_REPORT': (
    label: 'Export data',
    icon: Icons.ios_share_rounded,
    route: '/clinician/export',
  ),
  'MANAGE_TEAM': (
    label: 'People',
    icon: Icons.groups_outlined,
    route: '/clinician/team',
  ),
  'MANAGE_DEPARTMENTS': (
    label: 'Departments',
    icon: Icons.account_tree_outlined,
    route: '/clinician/departments',
  ),
};
