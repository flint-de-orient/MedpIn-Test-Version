import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/clinician/data/clinician_repository.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/alerts_screen.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'doctor_home_fixtures.dart';
import 'doctor_home_scenario.dart';
import 'preview_harness.dart';

/// The doctor's home and the alerts screen, rendered to
/// `build/ui_previews/doctor_home/` for looking at.
///
///   flutter test test/ui_preview/doctor_home_preview_test.dart
///
/// Each state a doctor can meet: a busy diabetology day, a general physician,
/// a cardiologist, a practice with nobody in it, a day with far more
/// appointments than fit, no readings, a network failure, figures that stopped
/// refreshing, the first load, a panel this person may not see, and text at
/// 1.3. The assertions here only prove the render happened; the guarantees are
/// in doctor_home_states_test.dart.
const _area = 'doctor_home/after';

void main() {
  setUpAll(loadPreviewFonts);

  Future<void> render(
    WidgetTester tester,
    String name,
    HomeScenario scenario, {
    double textScale = 1,
    int shots = 12,
    Future<void> Function()? before,
  }) async {
    usePhone(tester);
    final key = GlobalKey();
    await pumpDoctorHome(tester, scenario, boundary: key, textScale: textScale);
    if (before != null) await before();
    await captureScrolling(tester, key, area: _area, name: name, maxShots: shots);
    expect(tester.takeException(), isNull);
    await leaveHome(tester);
  }

  final diabetology = doctorCaps(widgets: diabetologyWidgets, specialty: 'diabetology');

  testWidgets('diabetology, a busy day', (tester) async {
    await render(tester, 'diabetology_busy', HomeScenario(caps: diabetology));
  });

  testWidgets('general physician', (tester) async {
    await render(
      tester,
      'physician',
      HomeScenario(
        caps: doctorCaps(widgets: physicianWidgets, specialty: 'general_physician'),
        user: doctorUser.copyWithName('Dr. Sabyasachi Roy', specialty: null),
        practiceName: 'Salt Lake Family Health Clinic',
      ),
    );
  });

  testWidgets('cardiology', (tester) async {
    await render(
      tester,
      'cardiology',
      HomeScenario(
        caps: doctorCaps(widgets: cardiologyWidgets, specialty: 'cardiology'),
        user: doctorUser.copyWithName('Dr. Ritu Sen', specialty: 'Consultant Cardiologist'),
        practiceName: 'Behala Heart Care',
      ),
    );
  });

  testWidgets('a brand-new practice', (tester) async {
    await render(tester, 'new_practice', HomeScenario(caps: diabetology, empty: true), shots: 3);
  });

  testWidgets('a packed day', (tester) async {
    await render(
      tester,
      'packed_day',
      HomeScenario(caps: diabetology, appointments: () => packedDay()),
      shots: 2,
    );
  });

  testWidgets('no readings in the window', (tester) async {
    await render(
      tester,
      'no_readings',
      HomeScenario(
        caps: diabetology,
        glucose: noReadingsGlucose,
        analytics: (_) => emptyAnalytics(),
        followUps: quietFollowUps,
        attention: attentionCalm,
      ),
      shots: 5,
    );
  });

  testWidgets('nothing loads', (tester) async {
    await render(tester, 'failed', HomeScenario(caps: diabetology, all: Answer.failed), shots: 4);
  });

  testWidgets('figures that stopped refreshing', (tester) async {
    await render(
      tester,
      'stale',
      HomeScenario(caps: diabetology, all: Answer.stale),
      shots: 3,
      before: () => refreshHome(tester),
    );
  });

  testWidgets('the first load', (tester) async {
    await render(tester, 'loading', HomeScenario(caps: diabetology, all: Answer.loading), shots: 2);
  });

  testWidgets('a panel this person may not see', (tester) async {
    await render(
      tester,
      'denied',
      HomeScenario(
        caps: doctorCaps(widgets: physicianWidgets, specialty: 'general_physician'),
        only: const {'bp': Answer.denied, 'conditions': Answer.denied},
      ),
      shots: 5,
    );
  });

  testWidgets('text at 1.3', (tester) async {
    await render(tester, 'text_1_3', HomeScenario(caps: diabetology), textScale: 1.3, shots: 4);
  });

  testWidgets('a practice manager', (tester) async {
    await render(
      tester,
      'practice_manager',
      HomeScenario(
        caps: doctorCaps(
          widgets: const ['ANALYTICS_SUMMARY'],
          actions: const ['MANAGE_TEAM', 'MANAGE_DEPARTMENTS', 'EXPORT_REPORT'],
          role: 'practice_manager',
          permissions: const {Perm.manageStaff, Perm.manageDepartment, Perm.viewAudit},
        ),
        user: doctorUser.copyWithName('Paresh Roy', specialty: null),
      ),
      shots: 2,
    );
  });

  testWidgets('the bench', (tester) async {
    await render(
      tester,
      'lab_technician',
      HomeScenario(
        caps: doctorCaps(
          widgets: const ['CRITICAL_LAB_RESULTS', 'LAB_FLAG_SUMMARY', 'RECENT_LAB_REPORTS'],
          actions: const ['VIEW_LAB_REPORTS', 'EXPORT_REPORT'],
          role: 'lab_technician',
          permissions: const {Perm.viewPatient, Perm.editRecord},
        ),
        user: doctorUser.copyWithName('Bina Sen', specialty: null),
      ),
      shots: 3,
    );
  });

  group('the alerts screen', () {
    Future<void> alerts(WidgetTester tester, String name, List<ClinicalAlert> items) async {
      usePhone(tester);
      final key = GlobalKey();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            secureStoreProvider.overrideWithValue(SignedInStore()),
            imageAuthHeaderProvider.overrideWith((ref) async => const {}),
            clinicianRepositoryProvider.overrideWithValue(_NoRepository()),
            alertsProvider.overrideWith(
              (ref, q) async => Paged(
                items: [
                  for (final a in items)
                    if (q.status == null || a.status == q.status) a,
                ],
                page: 1,
                limit: 100,
                total: items.length,
                hasMore: false,
              ),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            debugShowCheckedModeBanner: false,
            builder: (context, child) => RepaintBoundary(key: key, child: child!),
            home: const AlertsScreen(),
          ),
        ),
      );
      await settleFrames(tester);
      await captureScrolling(tester, key, area: _area, name: name, maxShots: 4);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    }

    testWidgets('with alerts', (tester) async {
      await alerts(tester, 'alerts', openAlerts());
    });

    testWidgets('with none open', (tester) async {
      await alerts(tester, 'alerts_empty', const []);
    });
  });
}

class _NoRepository implements ClinicianRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
