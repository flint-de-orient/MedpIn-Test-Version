import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patient_preview_harness.dart';

/// Profile and the screens under it, plus the two screens a patient meets
/// before signing in.
void main() {
  setUpAll(loadPreviewFonts);

  testWidgets('profile', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile',
      overrides: patientOverrides(),
      size: const Size(360, 2000),
    );
    await capture(tester, 'profile');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('profile — in Bengali', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile',
      overrides: patientOverrides(),
      locale: const Locale('bn'),
      size: const Size(360, 2000),
    );
    await capture(tester, 'profile_bengali');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('notifications', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile/notifications',
      overrides: patientOverrides(),
    );
    await capture(tester, 'notifications');
    expect(tester.takeException(), isNull);
    await unmount(tester);
  });

  testWidgets('health details', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/profile/health',
      overrides: patientOverrides(),
      size: const Size(360, 1500),
    );
    await capture(tester, 'health_details');
    await unmount(tester);
  });

  testWidgets('dietician conversation', (tester) async {
    await pumpPatientApp(
      tester,
      location: '/food-log',
      overrides: patientOverrides(),
    );
    await capture(tester, 'dietician_thread');
    await unmount(tester);
  });
}
