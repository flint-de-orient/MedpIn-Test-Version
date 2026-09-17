import 'dart:async';

import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/domain/ecg_report.dart';
import 'package:medpin/features/clinician/domain/patient_summary.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/patient_profile_screen.dart';
import 'package:medpin/features/medications/domain/medication.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'record_preview_harness.dart';

/// The patient record, drawn for each specialty and each state it can be in.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'patient_record';

  Future<void> show(
    WidgetTester tester,
    String name, {
    required String id,
    required FutureOr<PatientSummary> Function(int read) summary,
    FutureOr<List<Medication>> Function()? medicines,
    FutureOr<List<PrescriptionSummary>> Function()? prescriptions,
    FutureOr<List<EcgReport>> Function()? ecgs,
    Capabilities? capabilities,
    bool desk = false,
    double textScale = 1,
    double width = 360,
    double height = 5200,
    Future<void> Function(WidgetTester tester)? before,
  }) async {
    setPhone(tester, width: width, height: height);
    final base = await baseOverrides(
      user: desk ? previewDesk() : previewDoctor(),
      capabilities: capabilities,
    );
    var reads = 0;
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        ground: false,
        overrides: [
          ...base,
          patientSummaryProvider.overrideWith(
            (ref, _) async => summary(reads++),
          ),
          patientMedicationsProvider.overrideWith(
            (ref, _) async => medicines == null ? <Medication>[] : medicines(),
          ),
          patientPrescriptionsProvider.overrideWith(
            (ref, _) async =>
                prescriptions == null
                    ? <PrescriptionSummary>[]
                    : prescriptions(),
          ),
          patientEcgsProvider.overrideWith(
            (ref, _) async => ecgs == null ? <EcgReport>[] : ecgs(),
          ),
        ],
        home: PatientProfileScreen(patientId: id),
      ),
    );
    await settle(tester);
    if (before != null) await before(tester);
    expect(tester.takeException(), isNull);
    await capturePreview(tester, area, name);
    await leave(tester);
  }

  PatientSummary richDiabetes(int _) => diabetologyPatient(
    riskReasons: const [
      'HbA1c 8.4% — above target',
      '1 unresolved urgent alert',
      'Medication adherence at 69%',
    ],
  );

  testWidgets('diabetology, rich record', (tester) async {
    await show(
      tester,
      'diabetology_rich',
      id: 'p-sunita',
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: richDiabetes,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('cardiology', (tester) async {
    await show(
      tester,
      'cardiology',
      id: 'p-arjun',
      capabilities: previewCapabilities(department: 'cardiology'),
      summary: (_) => cardiologyPatient(),
      ecgs: cardiologyEcgs,
      prescriptions: () => const [],
    );
  });

  testWidgets('general physician', (tester) async {
    await show(
      tester,
      'general_physician',
      id: 'p-sunita',
      capabilities: previewCapabilities(department: 'general_physician'),
      summary: (_) => diabetologyPatient(),
      medicines: diabetologyMedicines,
      prescriptions: () => [longPrescription(), ...diabetologyPrescriptions()],
    );
  });

  testWidgets('new patient, nothing recorded', (tester) async {
    await show(
      tester,
      'new_patient',
      id: 'p-priya',
      height: 2400,
      summary: (_) => newPatient(),
    );
  });

  testWidgets('loading', (tester) async {
    await show(
      tester,
      'loading',
      id: 'p-x',
      height: 780,
      summary: (_) => Completer<PatientSummary>().future,
    );
  });

  testWidgets('failed, no connection', (tester) async {
    await show(
      tester,
      'failed_offline',
      id: 'p-x',
      height: 780,
      summary: (_) => Future.error(offline),
    );
  });

  testWidgets('refused, not enrolled here', (tester) async {
    await show(
      tester,
      'refused_not_enrolled',
      id: 'p-x',
      height: 780,
      summary: (_) => Future.error(refusedNotEnrolled),
    );
  });

  testWidgets('refused, not connected to a practice', (tester) async {
    await show(
      tester,
      'refused_not_connected',
      id: 'p-x',
      height: 780,
      summary: (_) => Future.error(refusedNotConnected),
    );
  });

  testWidgets('practice required', (tester) async {
    await show(
      tester,
      'practice_required',
      id: 'p-x',
      height: 780,
      summary: (_) => Future.error(practiceRequired),
    );
  });

  testWidgets('a refresh that failed keeps the record', (tester) async {
    await show(
      tester,
      'stale',
      id: 'p-sunita',
      height: 1400,
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: (read) => read == 0 ? richDiabetes(0) : Future.error(offline),
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
      before: (tester) async {
        // Past the record's own refresh, which re-reads and fails.
        await tester.pump(const Duration(seconds: 16));
        await settle(tester);
      },
    );
  });

  testWidgets('medicines failed to load', (tester) async {
    await show(
      tester,
      'medicines_failed',
      id: 'p-sunita',
      height: 2600,
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: richDiabetes,
      medicines: () => Future.error(offline),
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('text scale 1.3', (tester) async {
    await show(
      tester,
      'text_scale_1_3',
      id: 'p-sunita',
      textScale: 1.3,
      height: 7200,
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: richDiabetes,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('small phone, 320 wide', (tester) async {
    await show(
      tester,
      'small_320',
      id: 'p-arjun',
      width: 320,
      height: 3600,
      capabilities: previewCapabilities(department: 'cardiology'),
      summary: (_) => cardiologyPatient(),
      ecgs: cardiologyEcgs,
    );
  });

  testWidgets('large phone, 412 wide', (tester) async {
    await show(
      tester,
      'large_412',
      id: 'p-sunita',
      width: 412,
      height: 4800,
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: richDiabetes,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('front desk', (tester) async {
    await show(
      tester,
      'desk',
      id: 'p-sunita',
      desk: true,
      summary: richDiabetes,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });
}
