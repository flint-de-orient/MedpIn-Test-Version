/// Every tab of the dietician's patient record, rendered off a fixture on a
/// 360dp phone.
///
/// A widget test fails on a RenderFlex overflow, which is the whole point of
/// these: this screen has shipped four separate "widget sized by whatever
/// contains it" bugs, and each one was found on a device by a person rather
/// than here. A section heading that outgrows its Row, a Spacer that leaves
/// nothing for the text beside it, a chip rail wider than the phone — all of
/// them throw in here before anyone has to look at a screenshot.
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/dietician/domain/diet_models.dart';
import 'package:akd_care/features/dietician/presentation/dietician_patient_screen.dart';
import 'package:akd_care/features/dietician/presentation/dietician_providers.dart';
import 'package:akd_care/features/foodlog/domain/food_log.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final overview = DietPatientOverview(
    id: 'p1',
    name: 'Rahul Das',
    phone: '9000000000',
    riskBand: 'high',
    gender: 'male',
    heightCm: 172,
    diabetesType: 'type2',
    allergies: const ['Peanuts'],
    foodLogDaysThisWeek: 0,
    latestHba1c: 8.1,
    hba1cTestedOn: DateTime(2026, 8, 2),
    previousHba1c: 7.4,
    medications: const [
      DietMed(
        name: 'Gluconorm G1',
        strength: '500/1',
        dose: '1-0-1',
        times: [],
      ),
    ],
    vitals: DietVitals(
      weightKg: VitalReading(
        value: 82,
        at: DateTime(2026, 8, 20),
        previous: 80,
      ),
      bmi: 27.7,
      glucose: DietGlucose(
        valueMgDl: 148,
        at: DateTime(2026, 8, 21),
        context: 'fasting',
        flag: 'high',
      ),
    ),
    advice: [
      DietAdvice(
        issuedOn: DateTime(2026, 8, 2),
        diagnosis: const ['Type 2 diabetes mellitus', 'Dyslipidaemia'],
        doctorName: 'Dr Amit Kumar Dey',
        generalAdvice: 'Walk 30 minutes daily. Avoid fried food.',
      ),
    ],
    advisedTests: const [
      AdvisedTest(name: 'Lipid profile', reported: true),
      AdvisedTest(name: 'Serum creatinine', reported: false),
      AdvisedTest(name: 'Urine microalbumin', reported: false),
      AdvisedTest(name: 'Thyroid profile', reported: false),
      AdvisedTest(name: 'Vitamin D', reported: false),
    ],
    labReports: [
      LabReport(
        id: 'r2',
        testName: 'Fasting sugar report',
        note: '',
        createdAt: DateTime(2026, 8, 20),
        mimeType: 'image/jpeg',
        photoUrl: '/api/v1/uploads/r2/raw',
        analysisStatus: 'done',
        analysisSummary:
            'Fasting plasma glucose 148 mg/dL, above the reference range of 70 '
            'to 100. Post prandial not included on this report. Advise repeat '
            'after two weeks of dietary change and review with the physician.',
        analytes: const [
          Analyte(
            code: 'glucose',
            label: 'Glucose',
            value: 148,
            unit: 'mg/dL',
            flag: 'high',
          ),
        ],
      ),
      LabReport(
        id: 'r1',
        testName: 'Lipid profile',
        note: '',
        createdAt: DateTime(2026, 8, 2),
        mimeType: 'application/pdf',
        photoUrl: '/api/v1/uploads/r1/raw',
        analysisStatus: 'done',
        analysisSummary: 'Triglycerides and LDL both above range.',
        analytes: const [
          Analyte(
            code: 'triglyceride',
            label: 'Triglycerides',
            value: 218,
            unit: 'mg/dL',
            flag: 'high',
          ),
        ],
      ),
    ],
  );

  Future<void> pumpRecord(WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    tester.view.physicalSize = const Size(720, 1600);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          imageAuthHeaderProvider.overrideWith((ref) async => {}),
          dietOverviewProvider('p1').overrideWith((ref) async => overview),
          dietPlanProvider('p1').overrideWith((ref) async => null),
          dietFoodLogProvider(
            'p1',
          ).overrideWith((ref) async => <FoodLogEntry>[]),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          locale: const Locale('en'),
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: const DieticianPatientScreen(
            patientId: 'p1',
            patientName: 'Rahul Das',
          ),
        ),
      ),
    );
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  for (final (index, label) in const [
    (0, 'Overview'),
    (1, 'Food logs'),
    (2, 'Diet plan'),
    (3, 'Clinical'),
  ]) {
    testWidgets('$label lays out without overflowing', (tester) async {
      await pumpRecord(tester);
      if (index != 0) {
        // The tab, not the bottom-bar button that shares its words.
        await tester.tap(
          find.descendant(of: find.byType(TabBar), matching: find.text(label)),
        );
        for (var i = 0; i < 12; i++) {
          await tester.pump(const Duration(milliseconds: 120));
        }
      }
      // The tab is on screen and its content is real, not an error box.
      expect(
        find.descendant(of: find.byType(TabBar), matching: find.text(label)),
        findsOneWidget,
      );
      expect(find.text('Could not load this patient'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('the Clinical tab shows the record, not an empty box', (
    tester,
  ) async {
    await pumpRecord(tester);
    await tester.tap(
      find.descendant(of: find.byType(TabBar), matching: find.text('Clinical')),
    );
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
    // One assertion per section, so a card that silently stops rendering is
    // caught by name rather than by the page looking wrong.
    expect(find.text('Recent vitals'), findsOneWidget);
    expect(find.text('Current medicines'), findsOneWidget);
    expect(find.text('Gluconorm G1'), findsOneWidget);
  });

  testWidgets('nothing on this screen is cut off with an ellipsis', (
    tester,
  ) async {
    await pumpRecord(tester);
    for (final t in tester.widgetList<Text>(find.byType(Text))) {
      expect(
        t.overflow,
        isNot(TextOverflow.ellipsis),
        reason: 'ellipsised: "${t.data}"',
      );
    }
  });
}
