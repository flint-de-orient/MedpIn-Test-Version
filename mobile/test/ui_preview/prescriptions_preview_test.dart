import 'dart:async';

import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/prescription_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'preview_harness.dart';

/// A patient's prescriptions, in each state the list can be in.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'prescriptions';

  Future<void> show(
    WidgetTester tester,
    String name, {
    required FutureOr<List<PrescriptionSummary>> Function() prescriptions,
    double height = 2400,
    double textScale = 1,
    bool desk = false,
  }) async {
    setPhone(tester, height: height);
    final base = await baseOverrides(
      user: desk ? previewDesk() : previewDoctor(),
    );
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        ground: false,
        overrides: [
          ...base,
          patientPrescriptionsProvider.overrideWith(
            (ref, _) async => prescriptions(),
          ),
        ],
        home: const PrescriptionListScreen(
          patientId: 'p-sunita',
          patientName: 'Sunita Chakraborty',
        ),
      ),
    );
    await settle(tester);
    expect(tester.takeException(), isNull);
    await capturePreview(tester, area, name);
    await leave(tester);
  }

  testWidgets('typical', (tester) async {
    await show(tester, 'typical', prescriptions: diabetologyPrescriptions);
  });

  testWidgets('empty', (tester) async {
    await show(tester, 'empty', height: 780, prescriptions: () => const []);
  });

  testWidgets('loading', (tester) async {
    await show(
      tester,
      'loading',
      height: 780,
      prescriptions: () => Completer<List<PrescriptionSummary>>().future,
    );
  });

  testWidgets('failed', (tester) async {
    await show(
      tester,
      'failed',
      height: 780,
      prescriptions: () => Future.error(Exception('offline')),
    );
  });

  testWidgets('text scale 1.3', (tester) async {
    await show(
      tester,
      'text_scale_1_3',
      height: 3000,
      textScale: 1.3,
      prescriptions: diabetologyPrescriptions,
    );
  });
}
