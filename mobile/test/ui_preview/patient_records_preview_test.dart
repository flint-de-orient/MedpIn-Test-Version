import 'package:medpin/features/labtests/domain/lab_tests.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patient_preview_harness.dart';

/// The patient's records: tests and reports, prescriptions, and the meal
/// history, each with its empty and failed states.
void main() {
  setUpAll(loadPreviewFonts);

  testWidgets('tests — advised and uploaded, in every analysis state', (
    tester,
  ) async {
    await pumpPatientApp(
      tester,
      location: '/profile/tests',
      overrides: patientOverrides(),
      size: const Size(360, 1600),
    );
    await capture(tester, 'tests_typical');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('tests — nothing yet', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile/tests',
      overrides: patientOverrides(
        labTests: const LabTestsView(advised: [], results: []),
      ),
    );
    await capture(tester, 'tests_empty');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('tests — could not load', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile/tests',
      overrides: patientOverrides(labTestsError: Exception('offline')),
    );
    await capture(tester, 'tests_failed');
    await unmount(tester);
  });

  testWidgets('prescriptions — a list', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications/prescriptions',
      overrides: patientOverrides(),
    );
    await capture(tester, 'prescriptions_list');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('prescriptions — one opened', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications/prescriptions',
      overrides: patientOverrides(),
    );
    await tester.tap(find.textContaining('Dr. Amit Kumar Dey').first);
    await settle(tester);
    await capture(tester, 'prescriptions_detail');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('prescriptions — none yet', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications/prescriptions',
      overrides: patientOverrides(prescriptions: const []),
    );
    await capture(tester, 'prescriptions_empty');
    await unmount(tester);
  });

  testWidgets('prescriptions — could not load', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications/prescriptions',
      overrides: patientOverrides(prescriptionsError: Exception('offline')),
    );
    await capture(tester, 'prescriptions_failed');
    await unmount(tester);
  });

  testWidgets('meal history — a few days', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/food-log/history',
      overrides: patientOverrides(),
    );
    await capture(tester, 'meals_typical');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('meal history — nothing yet', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/food-log/history',
      overrides: patientOverrides(foodLog: const []),
    );
    await capture(tester, 'meals_empty');
    await unmount(tester);
  });

  testWidgets('meal history — could not load', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/food-log/history',
      overrides: patientOverrides(foodLogError: Exception('offline')),
    );
    await capture(tester, 'meals_failed');
    await unmount(tester);
  });
}
