import 'dart:async';

import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/patient_registration.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/patients_screen.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'preview_harness.dart';

/// The patient list, drawn in each state it can be in.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'patients';

  Paged<PatientListItem> roll(List<PatientListItem> items, {int? total}) =>
      Paged(
        items: items,
        page: 1,
        limit: 100,
        total: total ?? items.length,
        hasMore: (total ?? items.length) > items.length,
      );

  Future<void> show(
    WidgetTester tester,
    String name, {
    required FutureOr<Paged<PatientListItem>> Function() patients,
    double textScale = 1,
    double height = 1400,
    bool desk = false,
  }) async {
    setPhone(tester, height: height);
    final base = await baseOverrides(
      user: desk ? previewDesk() : previewDoctor(),
    );
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        overrides: [
          ...base,
          overviewProvider.overrideWith(
            (ref) => Completer<ClinicOverview>().future,
          ),
          pendingEnrolmentsProvider.overrideWith(
            (ref) async => const <PendingEnrolment>[],
          ),
          patientsProvider.overrideWith((ref, q) async => patients()),
        ],
        home: const PatientsScreen(),
      ),
    );
    await settle(tester);
    expect(tester.takeException(), isNull);
    await capturePreview(tester, area, name);
    await leave(tester);
  }

  testWidgets('typical caseload', (tester) async {
    await show(tester, 'typical', patients: () => roll(caseload(), total: 212));
  });

  testWidgets('text scale 1.3', (tester) async {
    await show(
      tester,
      'text_scale_1_3',
      textScale: 1.3,
      height: 1800,
      patients: () => roll(caseload(), total: 212),
    );
  });

  testWidgets('empty roll', (tester) async {
    await show(tester, 'empty', height: 780, patients: () => roll(const []));
  });

  testWidgets('loading', (tester) async {
    await show(
      tester,
      'loading',
      height: 780,
      patients: () => Completer<Paged<PatientListItem>>().future,
    );
  });

  testWidgets('failed', (tester) async {
    await show(
      tester,
      'failed',
      height: 780,
      patients: () => Future.error(Exception('offline')),
    );
  });

  testWidgets('front desk', (tester) async {
    await show(
      tester,
      'desk',
      desk: true,
      patients: () => roll(caseload(), total: 212),
    );
  });
}
