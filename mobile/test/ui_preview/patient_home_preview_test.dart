import 'package:medpin/features/home/presentation/home_providers.dart';
import 'package:medpin/features/medications/presentation/medications_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patient_preview_harness.dart';

/// Renders the patient's Home in the states that matter, to PNGs under
/// build/ui_previews/patient/, so the screen is looked at rather than assumed.
void main() {
  setUpAll(loadPreviewFonts);

  Future<void> render(
    WidgetTester tester,
    String name, {
    List<dynamic>? overrides,
    Locale locale = const Locale('en'),
    double textScale = kPhoneTextScale,
    Size size = const Size(360, 2800),
  }) async {
    await pumpPatientApp(
      tester,
      location: '/home',
      overrides: overrides?.cast() ?? patientOverrides(),
      locale: locale,
      textScale: textScale,
      size: size,
    );
    await capture(tester, name);
    expect(tester.takeException(), isNull);
    await unmount(tester);
  }

  testWidgets('home — a typical day, first screen', (tester) async {
    await render(tester, 'home_typical', size: const Size(360, 780));
  });

  testWidgets('home — a typical day, whole page', (tester) async {
    await render(tester, 'home_typical_full');
  });

  testWidgets('home — a new patient with nothing yet', (tester) async {
    await render(
      tester,
      'home_new_patient',
      overrides: patientOverrides(
        care: newPatientCare(),
        today: emptyToday(),
        meds: const [],
        trends: emptyTrends(),
        appointments: const [],
      ),
      size: const Size(360, 1600),
    );
  });

  testWidgets('home — not enrolled at any practice', (tester) async {
    await render(
      tester,
      'home_not_enrolled',
      overrides: patientOverrides(
        enrolled: false,
        care: newPatientCare(),
        today: emptyToday(),
        meds: const [],
        trends: emptyTrends(),
        appointments: const [],
      ),
      size: const Size(360, 1600),
    );
  });

  testWidgets('home — long names', (tester) async {
    await render(
      tester,
      'home_long_names',
      overrides: patientOverrides(
        today: longNameToday(),
        appointments: longNameAppointments(),
      ),
      size: const Size(360, 1400),
    );
  });

  testWidgets('home — still loading', (tester) async {
    await render(
      tester,
      'home_loading',
      overrides: patientOverrides(careLoading: true, todayLoading: true),
      size: const Size(360, 780),
    );
  });

  testWidgets('home — could not load', (tester) async {
    await render(
      tester,
      'home_failed',
      overrides: patientOverrides(
        careError: Exception('offline'),
        todayError: Exception('offline'),
      ),
      size: const Size(360, 1000),
    );
  });

  testWidgets('home — a refresh that failed keeps what was loaded', (
    tester,
  ) async {
    final container = await pumpPatientApp(
      tester,
      location: '/home',
      overrides: patientOverrides(
        careFailsOnRefresh: true,
        todayFailsOnRefresh: true,
      ),
      size: const Size(360, 1200),
    );
    container.invalidate(careSummaryProvider);
    container.invalidate(todayScheduleProvider);
    await settle(tester);
    await capture(tester, 'home_stale');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('home — text at 1.3', (tester) async {
    await render(
      tester,
      'home_text_1_3',
      textScale: kLargeTextScale,
      size: const Size(360, 3400),
    );
  });

  testWidgets('home — a small phone, 320 wide', (tester) async {
    await render(tester, 'home_small_320', size: const Size(320, 3000));
  });

  testWidgets('home — a large phone, 430 wide', (tester) async {
    await render(tester, 'home_large_430', size: const Size(430, 932));
  });

  testWidgets('home — in Bengali', (tester) async {
    await render(tester, 'home_bengali', locale: const Locale('bn'));
  });
}
