import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
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
/// The server drops what it does not recognise for the same reason, so an
/// operator's typo and a stale app fail the same way: quietly, and only in the
/// one panel.
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
/// Passed in rather than read from providers inside each builder, so that one
/// screen's poll drives every panel on it. A component reaching for its own
/// provider would refresh on its own schedule, and a dashboard whose panels
/// disagree about what time it is has no business calling any of them live.
class DashboardData {
  const DashboardData({
    required this.overview,
    required this.analytics,
    required this.attention,
    required this.alerts,
    required this.labs,
    required this.updatedAt,
    required this.days,
    required this.onDaysChanged,
  });

  final ClinicOverview? overview;
  final ClinicAnalytics? analytics;
  final List<PatientListItem> attention;
  final List<ClinicalAlert> alerts;

  /// Null until a laboratory component asks for it. Most practices never do,
  /// and a request on every dashboard load for a panel nobody is showing is a
  /// query per doctor per twenty seconds for nothing.
  final LabOverviewData? labs;

  /// When the data on screen was pulled. Anything calling itself live owes the
  /// reader the time it was true.
  final DateTime updatedAt;

  final int days;
  final ValueChanged<int> onDaysChanged;
}

/// The lab overview and its loading state, kept together.
///
/// A panel that cannot tell "no critical results" from "the request has not
/// come back" will say the reassuring one, and be wrong at exactly the moment
/// it matters most.
typedef LabOverviewData = ({LabOverview? value, bool loading});

/// The registry. Keys mirror `WIDGETS` in `services/uiConfig.js`.
final Map<String, WidgetBuilderFn> dashboardWidgets = {
  // ---- the clinical day ---------------------------------------------------
  'TRIAGE_QUEUE': (d) =>
      TriageQueue(patients: d.attention, updatedAt: d.updatedAt),

  'TODAYS_CLINIC': (d) => const TodaysClinic(),

  // Null rather than an empty card until both halves have arrived: this panel
  // is counts over a window, and half of it is a different number.
  'ACTION_QUEUE': (d) => d.overview == null || d.analytics == null
      ? null
      : ActionQueue(overview: d.overview!, analytics: d.analytics!),

  'NUTRITION_REVIEWS': (d) => d.overview == null
      ? null
      : NutritionReviewQueue(reviews: d.overview!.nutritionReviews),

  'OPEN_ALERTS': (d) => AlertDigest(alerts: d.alerts),

  'LIVE_ACTIVITY': (d) {
    final events = LiveActivity.from(
      patients: d.attention,
      reviews: d.overview?.nutritionReviews ?? const [],
    );
    // Hidden when there is nothing, unlike the alert digest above. The
    // difference is what the emptiness means: no alerts is a clinical fact
    // worth stating, and no recent activity is the absence of a log.
    return events.isEmpty ? null : LiveActivity(events: events);
  },

  // Its own request rather than the shared poll — see ChatSummaryCard.
  'CHAT_SUMMARIES': (d) => const ChatSummaryCard(),

  // ---- the caseload: routes/panels.js ---------------------------------------
  // Their own requests, like the conversations above. See caseload_panels.dart.
  'BP_CONTROL': (d) => const BpControlCard(),
  'FOLLOW_UPS_DUE': (d) => const FollowUpsDueCard(),
  'CONDITION_REGISTRY': (d) => const ConditionRegisterCard(),
  'HEART_RATE_FLAGS': (d) => const HeartRateFlagsCard(),
  'RECENT_ECGS': (d) => const RecentEcgsCard(),
  'LIPID_CONTROL': (d) => const LipidControlCard(),

  // ---- what the practice has bought ---------------------------------------
  'ANALYTICS_SUMMARY': (d) => d.analytics == null
      ? null
      : ClinicSnapshot(
          analytics: d.analytics!,
          days: d.days,
          onDaysChanged: d.onDaysChanged,
        ),

  // ---- labs ---------------------------------------------------------------
  'CRITICAL_LAB_RESULTS': (d) => _lab(d, (o) => CriticalLabResults(overview: o)),
  'RECENT_LAB_REPORTS': (d) => _lab(d, (o) => RecentLabReports(overview: o)),
  'LAB_FLAG_SUMMARY': (d) => _lab(d, (o) => LabFlagSummary(overview: o)),
};

/// A lab panel, or nothing while the answer is still in flight.
///
/// Deliberately not the empty state during loading. "No result has come back
/// critical" is a reassuring sentence, and saying it before the request has
/// returned is saying it without knowing — the same failure as a freshness
/// badge that cannot detect staleness.
Widget? _lab(DashboardData d, Widget Function(LabOverview overview) build) {
  final labs = d.labs;
  if (labs == null || labs.loading || labs.value == null) return null;
  return build(labs.value!);
}

/// Whether anything on this dashboard needs the lab overview fetched.
///
/// So a clinic that shows no lab panel makes no lab request. The alternative
/// is fetching it always and throwing most of it away, which is a query per
/// doctor per refresh for a panel nobody is looking at.
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
/// Named for what pressing it does, in one voice: the app once had "See all",
/// "View all", "View full plan" and "+ Add" for the same gesture. A reader
/// learns one affordance and should not re-learn it per card.
final Map<String, ActionSpec> dashboardActions = {
  'START_CONSULTATION': (
    label: 'Start consultation',
    icon: Icons.medical_services_outlined,
    route: '/clinician/patients',
  ),
  'ADD_PATIENT': (
    label: 'Add patient',
    icon: Icons.person_add_outlined,
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
    label: 'Alerts',
    icon: Icons.warning_amber_outlined,
    route: '/clinician/alerts',
  ),
  'VIEW_LAB_REPORTS': (
    label: 'Lab reports',
    icon: Icons.science_outlined,
    route: '/clinician/patients',
  ),
  'EXPORT_REPORT': (
    label: 'Export',
    icon: Icons.download_outlined,
    route: '/clinician/export',
  ),
  'MANAGE_TEAM': (
    label: 'Team',
    icon: Icons.groups_outlined,
    route: '/clinician/team',
  ),
  'MANAGE_DEPARTMENTS': (
    label: 'Departments',
    icon: Icons.account_tree_outlined,
    route: '/clinician/departments',
  ),
};

/// The row of actions a dashboard offers.
///
/// A Wrap, not a scroller. This is a bounded, known set — a scroller always
/// cuts whatever lands at the edge, and an action somebody cannot see is an
/// action they do not use. Fading the edge only makes the cut prettier.
class QuickActionBar extends ConsumerWidget {
  const QuickActionBar({super.key, required this.actions});

  final List<String> actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final specs = actions
        .map((id) => dashboardActions[id])
        .whereType<ActionSpec>()
        .toList(growable: false);

    if (specs.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: T.s2,
      runSpacing: T.s2,
      children: [
        for (final spec in specs)
          _ActionButton(spec: spec, onTap: () => context.push(spec.route)),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.spec, required this.onTap});

  final ActionSpec spec;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // The text scaler, not a constant. "Needs review" fitted at 1.0 and
    // truncated mid-word one notch above it, on the one caption that had to be
    // unambiguous.
    final scale = MediaQuery.textScalerOf(context);

    return Semantics(
      button: true,
      label: spec.label,
      child: Material(
        color: T.primaryTint,
        borderRadius: BorderRadius.circular(T.rControl),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(T.rControl),
          child: Container(
            // 48 is the tap floor, and it grows with the text rather than
            // clipping it.
            constraints: BoxConstraints(minHeight: scale.scale(T.tap)),
            padding: const EdgeInsets.symmetric(
              horizontal: T.s4,
              vertical: T.s2,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(spec.icon, size: 20, color: T.primary),
                const SizedBox(width: T.s2),
                Text(
                  spec.label,
                  style: T.bodyStrong.copyWith(color: T.primary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
