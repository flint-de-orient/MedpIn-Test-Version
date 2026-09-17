import 'package:medpin/features/medications/presentation/medications_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patient_preview_harness.dart';

/// The Medicines tab in every state the brief names: populated, empty, long
/// names, loading, failed, stale, a dose that did not save, larger text, small
/// and large phones, and Hindi.
void main() {
  setUpAll(loadPreviewFonts);

  Future<void> render(
    WidgetTester tester,
    String name, {
    List<dynamic>? overrides,
    Locale locale = const Locale('en'),
    double textScale = kPhoneTextScale,
    Size size = const Size(360, 3000),
    int armedReminders = 40,
  }) async {
    await pumpPatientApp(
      tester,
      location: '/medications',
      overrides: overrides?.cast() ?? patientOverrides(),
      locale: locale,
      textScale: textScale,
      size: size,
      armedReminders: armedReminders,
    );
    await capture(tester, name);
    expect(tester.takeException(), isNull);
    await unmount(tester);
  }

  testWidgets('medicines — a typical day', (tester) async {
    await render(tester, 'medicines_typical', size: const Size(360, 2000));
  });

  testWidgets('medicines — stopped and past medicines', (tester) async {
    await render(
      tester,
      'medicines_history',
      overrides: patientOverrides(allMeds: allMedsWithHistory()),
    );
  });

  testWidgets('medicines — a new patient', (tester) async {
    await render(
      tester,
      'medicines_new_patient',
      overrides: patientOverrides(meds: const [], today: emptyToday()),
      size: const Size(360, 1000),
    );
  });

  testWidgets('medicines — long names', (tester) async {
    await render(
      tester,
      'medicines_long_names',
      overrides: patientOverrides(meds: longNameMeds(), today: longNameToday()),
      size: const Size(360, 2400),
    );
  });

  testWidgets('medicines — still loading', (tester) async {
    await render(
      tester,
      'medicines_loading',
      overrides: patientOverrides(medsLoading: true, todayLoading: true),
      size: const Size(360, 1200),
    );
  });

  testWidgets('medicines — could not load', (tester) async {
    await render(
      tester,
      'medicines_failed',
      overrides: patientOverrides(
        medsError: Exception('offline'),
        todayError: Exception('offline'),
      ),
      size: const Size(360, 1200),
    );
  });

  testWidgets('medicines — reminders are off on this phone', (tester) async {
    await render(
      tester,
      'medicines_reminders_off',
      armedReminders: 0,
      size: const Size(360, 1100),
    );
  });

  testWidgets('medicines — a refresh that failed keeps what was loaded', (
    tester,
  ) async {
    final container = await pumpPatientApp(
      tester,
      location: '/medications',
      overrides: patientOverrides(
        medsFailsOnRefresh: true,
        todayFailsOnRefresh: true,
      ),
      size: const Size(360, 1400),
    );
    container.invalidate(medicationsListProvider);
    container.invalidate(todayScheduleProvider);
    await settle(tester);
    await capture(tester, 'medicines_stale');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('medicines — a dose that did not save', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications',
      overrides: patientOverrides(
        today: dueNowToday(),
        medicationsRepository: FailingDoseRepository(),
      ),
      size: const Size(360, 1400),
    );
    await tester.tap(find.text('Record this dose'));
    await settle(tester);
    await tester.tap(find.text('Yes, I took it'));
    await settle(tester, frames: 20);
    await capture(tester, 'medicines_dose_not_saved');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('medicines — the question before a dose is recorded', (
    tester,
  ) async {
    await pumpPatientApp(
      tester,
      location: '/medications',
      overrides: patientOverrides(today: dueNowToday()),
      size: const Size(360, 780),
    );
    await tester.tap(find.text('Record this dose'));
    await settle(tester);
    await capture(tester, 'medicines_record_sheet');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('medicines — text at 1.3', (tester) async {
    await render(
      tester,
      'medicines_text_1_3',
      overrides: patientOverrides(allMeds: allMedsWithHistory()),
      textScale: kLargeTextScale,
      size: const Size(360, 4200),
    );
  });

  testWidgets('medicines — a small phone, 320 wide', (tester) async {
    await render(
      tester,
      'medicines_small_320',
      overrides: patientOverrides(allMeds: allMedsWithHistory()),
      size: const Size(320, 3400),
    );
  });

  testWidgets('medicines — a large phone, 430 wide', (tester) async {
    await render(tester, 'medicines_large_430', size: const Size(430, 932));
  });

  testWidgets('medicines — in Hindi', (tester) async {
    await render(
      tester,
      'medicines_hindi',
      overrides: patientOverrides(allMeds: allMedsWithHistory()),
      locale: const Locale('hi'),
    );
  });

  testWidgets('medicines — dose history', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/medications/history',
      overrides: patientOverrides(),
      size: const Size(360, 1600),
    );
    await capture(tester, 'medicines_dose_history');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });
}
