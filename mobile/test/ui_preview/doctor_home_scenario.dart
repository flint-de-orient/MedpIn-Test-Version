import 'dart:async';

import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/auth/domain/user.dart';
import 'package:medpin/features/clinician/data/practice_repository.dart';
import 'package:medpin/features/clinician/domain/appointment.dart';
import 'package:medpin/features/clinician/domain/caseload_panels.dart';
import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/domain/practice.dart';
import 'package:medpin/features/clinician/presentation/clinician_dashboard_screen.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/clinician_shell.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'doctor_home_fixtures.dart';
import 'preview_harness.dart';

/// How one request behind the home answers.
enum Answer {
  /// The fixture's data.
  data,

  /// Never answers.
  loading,

  /// The network failed.
  failed,

  /// The server refused: 403.
  denied,

  /// Answers once, then fails every refresh after it.
  stale,
}

/// One situation the doctor's home can be in, as fake answers to each request.
///
/// Every request is named, so a test can fail exactly one of them — the
/// blood pressure panel refused while everything else loads — and see that
/// only that panel says so.
class HomeScenario {
  HomeScenario({
    required this.caps,
    this.user = doctorUser,
    this.practiceName = 'Dr Dey’s Diabetes, Obesity & Metabolic Clinic',
    this.empty = false,
    this.all = Answer.data,
    Map<String, Answer>? only,
    this.appointments,
    this.followUps,
    this.glucose,
    this.analytics,
    this.attention,
  }) : only = only ?? const {};

  final Capabilities caps;
  final AppUser user;
  final String? practiceName;

  /// A practice with no patients: the overview says so and every list is
  /// empty.
  final bool empty;

  /// The default answer for every request.
  final Answer all;

  /// Per-request answers: overview, attention, appointments, analytics, alerts,
  /// labs, conversations, glucose, hba1c, bp, followUps, conditions,
  /// heartRate, ecg, lipids, practice.
  final Map<String, Answer> only;

  final List<Appointment> Function()? appointments;
  final FollowUps Function()? followUps;
  final GlucoseFlags Function()? glucose;
  final ClinicAnalytics Function(int days)? analytics;
  final List<PatientListItem> Function()? attention;

  final _calls = <String, int>{};

  Future<T> _answer<T>(String key, T Function() value) async {
    switch (only[key] ?? all) {
      case Answer.data:
        return value();
      case Answer.loading:
        return Completer<T>().future;
      case Answer.failed:
        throw const ApiException(
          code: 'NETWORK_ERROR',
          message: 'Could not reach the server',
        );
      case Answer.denied:
        throw const ApiException(
          code: 'FORBIDDEN',
          message: 'You do not have access to this resource',
          statusCode: 403,
        );
      case Answer.stale:
        final n = _calls[key] = (_calls[key] ?? 0) + 1;
        if (n > 1) {
          throw const ApiException(
            code: 'NETWORK_ERROR',
            message: 'Could not reach the server',
          );
        }
        return value();
    }
  }

  List<Override> overrides() => [
    secureStoreProvider.overrideWithValue(SignedInStore()),
    authRepositoryProvider.overrideWithValue(SignedInRepository(user)),
    imageAuthHeaderProvider.overrideWith((ref) async => const {}),
    capabilitiesProvider.overrideWith((ref) async => caps),
    practiceOverviewProvider.overrideWith(
      (ref) => _answer('practice', () {
        final name = practiceName;
        if (name == null) return null;
        return PracticeOverview.fromJson({
          'practice': {'id': 'pr1', 'name': name, 'verification': 'verified'},
        });
      }),
    ),
    overviewProvider.overrideWith(
      (ref) => _answer('overview', () => empty ? emptyOverview() : busyOverview()),
    ),
    attentionPatientsProvider.overrideWith(
      (ref) => _answer(
        'attention',
        () => empty ? const <PatientListItem>[] : (attention?.call() ?? attentionBusy()),
      ),
    ),
    appointmentsTodayProvider.overrideWith(
      (ref) => _answer(
        'appointments',
        () => empty ? const <Appointment>[] : (appointments?.call() ?? busyDay()),
      ),
    ),
    clinicAnalyticsProvider.overrideWith(
      (ref, days) => _answer(
        'analytics',
        () => empty ? emptyAnalytics() : (analytics?.call(days) ?? busyAnalytics(days)),
      ),
    ),
    alertsProvider.overrideWith(
      (ref, q) => _answer(
        'alerts',
        () => Paged(
          items: empty ? const <ClinicalAlert>[] : openAlerts(),
          page: 1,
          limit: 100,
          total: empty ? 0 : 4,
          hasMore: false,
        ),
      ),
    ),
    labOverviewProvider.overrideWith((ref, days) => _answer('labs', busyLabs)),
    chatSummariesProvider.overrideWith(
      (ref, q) => _answer('conversations', () => empty ? quietConversations() : busyConversations()),
    ),
    glucoseFlagsProvider.overrideWith((ref, d) => _answer('glucose', glucose ?? busyGlucose)),
    hba1cControlProvider.overrideWith((ref, d) => _answer('hba1c', busyHba1c)),
    bpControlProvider.overrideWith((ref, d) => _answer('bp', busyBp)),
    followUpsProvider.overrideWith((ref, d) => _answer('followUps', followUps ?? busyFollowUps)),
    conditionRegisterProvider.overrideWith((ref, l) => _answer('conditions', busyConditions)),
    heartRateFlagsProvider.overrideWith((ref, d) => _answer('heartRate', busyHeartRate)),
    ecgPanelProvider.overrideWith((ref, d) => _answer('ecg', busyEcg)),
    lipidControlProvider.overrideWith((ref, d) => _answer('lipids', busyLipids)),
  ];
}

/// The widget ids each preset sends, as `services/uiConfig.js` composes them.
const diabetologyWidgets = [
  'TODAYS_CLINIC',
  'TRIAGE_QUEUE',
  'GLUCOSE_FLAGS',
  'HBA1C_CONTROL',
  'FOLLOW_UPS_DUE',
  'ANALYTICS_SUMMARY',
  'NUTRITION_REVIEWS',
  'CHAT_SUMMARIES',
];
const physicianWidgets = [
  'TODAYS_CLINIC',
  'TRIAGE_QUEUE',
  'FOLLOW_UPS_DUE',
  'BP_CONTROL',
  'CONDITION_REGISTRY',
  'RECENT_LAB_REPORTS',
  'CHAT_SUMMARIES',
  'NUTRITION_REVIEWS',
];
const cardiologyWidgets = [
  'TODAYS_CLINIC',
  'TRIAGE_QUEUE',
  'BP_CONTROL',
  'HEART_RATE_FLAGS',
  'RECENT_ECGS',
  'LIPID_CONTROL',
  'FOLLOW_UPS_DUE',
  'RECENT_LAB_REPORTS',
  'CHAT_SUMMARIES',
  'NUTRITION_REVIEWS',
];

/// The doctor's home inside the real shell, on a phone.
///
/// The other tabs are placeholders: the home is what is being looked at, and
/// the shell only builds a branch when it is opened.
Future<void> pumpDoctorHome(
  WidgetTester tester,
  HomeScenario scenario, {
  GlobalKey? boundary,
  double textScale = 1,
  int frames = 12,
}) async {
  final router = GoRouter(
    initialLocation: '/clinician/dashboard',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => ClinicianShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/clinician/dashboard',
                builder: (_, _) => const ClinicianDashboardScreen(),
              ),
            ],
          ),
          for (final p in ['appointments', 'patients', 'more'])
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/clinician/$p',
                  builder: (_, _) => Scaffold(body: Center(child: Text('$p tab'))),
                ),
              ],
            ),
        ],
      ),
      for (final p in [
        '/clinician/alerts',
        '/clinician/nutrition',
        '/clinician/patients/new',
        '/clinician/patients/:id',
        '/clinician/patients/:id/consult',
        '/clinician/chat-summaries',
      ])
        GoRoute(
          path: p,
          builder: (_, state) => Scaffold(body: Center(child: Text('opened ${state.uri}'))),
        ),
    ],
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: scenario.overrides(),
      child: MaterialApp.router(
        theme: AppTheme.light(),
        debugShowCheckedModeBanner: false,
        routerConfig: router,
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) {
          final scaled = MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!,
          );
          return boundary == null ? scaled : RepaintBoundary(key: boundary, child: scaled);
        },
      ),
    ),
  );
  await settleFrames(tester, frames: frames);
}

/// Takes the home down, so its twenty-second poll and the bell's timer end
/// with the test.
Future<void> leaveHome(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
}

/// Asks every request on the home again, the way the poll and a pull do.
Future<void> refreshHome(WidgetTester tester) async {
  final container = ProviderScope.containerOf(
    tester.element(find.byType(ClinicianDashboardScreen)),
  );
  for (final p in <ProviderOrFamily>[
    overviewProvider,
    attentionPatientsProvider,
    appointmentsTodayProvider,
    clinicAnalyticsProvider,
    alertsProvider,
    labOverviewProvider,
    chatSummariesProvider,
    glucoseFlagsProvider,
    hba1cControlProvider,
    bpControlProvider,
    followUpsProvider,
    conditionRegisterProvider,
    heartRateFlagsProvider,
    ecgPanelProvider,
    lipidControlProvider,
  ]) {
    container.invalidate(p);
  }
  await settleFrames(tester, frames: 8);
}
