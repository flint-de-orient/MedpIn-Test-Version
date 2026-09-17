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

  /// Pumps the list. [patients] is asked on every read, with how many reads
  /// came before — so a test can answer the first and fail the refresh.
  Future<void> show(
    WidgetTester tester,
    String name, {
    required FutureOr<Paged<PatientListItem>> Function(int read) patients,
    double textScale = 1,
    double width = 360,
    double height = 1500,
    bool desk = false,
    Future<void> Function(WidgetTester tester)? before,
  }) async {
    setPhone(tester, width: width, height: height);
    final base = await baseOverrides(
      user: desk ? previewDesk() : previewDoctor(),
    );
    var reads = 0;
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
          patientsProvider.overrideWith((ref, q) async => patients(reads++)),
        ],
        home: const PatientsScreen(),
      ),
    );
    await settle(tester);
    if (before != null) await before(tester);
    expect(tester.takeException(), isNull);
    await capturePreview(tester, area, name);
    await leave(tester);
  }

  testWidgets('typical caseload', (tester) async {
    await show(
      tester,
      'typical',
      patients: (_) => roll(caseload(), total: 212),
    );
  });

  testWidgets('text scale 1.3', (tester) async {
    await show(
      tester,
      'text_scale_1_3',
      textScale: 1.3,
      height: 2000,
      patients: (_) => roll(caseload(), total: 212),
    );
  });

  testWidgets('text scale 2', (tester) async {
    await show(
      tester,
      'text_scale_2',
      textScale: 2,
      height: 2600,
      patients: (_) => roll(caseload(), total: 212),
    );
  });

  testWidgets('small phone, 320 wide', (tester) async {
    await show(
      tester,
      'small_320',
      width: 320,
      patients: (_) => roll(caseload(), total: 212),
    );
  });

  testWidgets('large phone, 412 wide', (tester) async {
    await show(
      tester,
      'large_412',
      width: 412,
      patients: (_) => roll(caseload(), total: 212),
    );
  });

  testWidgets('hundreds of patients', (tester) async {
    await show(
      tester,
      'many',
      height: 1500,
      patients: (_) => roll(manyPatients(100), total: 340),
    );
  });

  testWidgets('empty roll', (tester) async {
    await show(tester, 'empty', height: 780, patients: (_) => roll(const []));
  });

  testWidgets('nothing unread', (tester) async {
    await show(
      tester,
      'unread_empty',
      height: 780,
      patients:
          (_) => roll([
            for (final p in caseload())
              if (p.unreadCount == 0) p,
          ]),
      before: (tester) async {
        await tester.tap(find.text('Unread'));
        await settle(tester);
      },
    );
  });

  testWidgets('at risk', (tester) async {
    await show(
      tester,
      'at_risk',
      height: 1100,
      patients: (_) => roll(caseload(), total: 212),
      before: (tester) async {
        await tester.tap(find.text('At risk'));
        await settle(tester);
      },
    );
  });

  testWidgets('loading', (tester) async {
    await show(
      tester,
      'loading',
      height: 780,
      patients: (_) => Completer<Paged<PatientListItem>>().future,
    );
  });

  testWidgets('failed, no connection', (tester) async {
    await show(
      tester,
      'failed_offline',
      height: 780,
      patients: (_) => Future.error(offline),
    );
  });

  testWidgets('refused', (tester) async {
    await show(
      tester,
      'refused',
      height: 780,
      patients: (_) => Future.error(refusedNoAccess),
    );
  });

  testWidgets('practice required', (tester) async {
    await show(
      tester,
      'practice_required',
      height: 780,
      patients: (_) => Future.error(practiceRequired),
    );
  });

  testWidgets('a refresh that failed keeps the list', (tester) async {
    await show(
      tester,
      'stale',
      height: 1100,
      patients:
          (read) =>
              read == 0 ? roll(caseload(), total: 212) : Future.error(offline),
      before: (tester) async {
        // Past the poll, which re-reads and fails.
        await tester.pump(const Duration(seconds: 4));
        await settle(tester);
      },
    );
  });

  testWidgets('front desk', (tester) async {
    await show(
      tester,
      'desk',
      desk: true,
      patients: (_) => roll(caseload(), total: 212),
    );
  });
}
