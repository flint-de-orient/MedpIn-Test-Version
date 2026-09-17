import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/consult_screen.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'preview_harness.dart';

/// The consultation, one step at a time.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'consult';

  Future<void> open(
    WidgetTester tester, {
    List<PrescriptionSummary> prescriptions = const [],
    double textScale = 1,
    double height = 2400,
  }) async {
    setPhone(tester, height: height);
    final base = await baseOverrides();
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        ground: false,
        overrides: [
          ...base,
          patientPrescriptionsProvider.overrideWith(
            (ref, _) async => prescriptions,
          ),
        ],
        home: const ConsultScreen(
          patientId: 'p-sunita',
          patientName: 'Sunita Chakraborty',
        ),
      ),
    );
    await settle(tester);
    expect(tester.takeException(), isNull);
  }

  Future<void> next(WidgetTester tester) async {
    await tester.tap(find.text('Next'));
    await settle(tester);
  }

  testWidgets('each step', (tester) async {
    await open(tester, prescriptions: diabetologyPrescriptions());
    await capturePreview(tester, area, 'step1_vitals');
    await next(tester);
    await capturePreview(tester, area, 'step2_diagnosis');
    await next(tester);
    await capturePreview(tester, area, 'step3_advice');
    expect(tester.takeException(), isNull);
    await leave(tester);
  });

  testWidgets('a first consultation, text scale 1.3', (tester) async {
    await open(tester, textScale: 1.3);
    await capturePreview(tester, area, 'step1_vitals_text_scale_1_3');
    await leave(tester);
  });
}
