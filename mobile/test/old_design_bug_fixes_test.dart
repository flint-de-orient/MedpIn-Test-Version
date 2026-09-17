import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/patient_summary.dart';
import 'package:medpin/features/medications/presentation/widgets/mark_dose_sheet.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/widgets/user_avatar.dart';

/// Bugs fixed inside the previous design, which the user asked to keep.
void main() {
  Widget app(Widget home) => ProviderScope(
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: home,
    ),
  );

  group('skipping a dose', () {
    Future<List<MarkDoseResult?>> openAndSkip(WidgetTester tester, String button) async {
      final results = <MarkDoseResult?>[];
      await tester.pumpWidget(
        app(
          Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async => results.add(await showMarkDoseSheet(context, 'Metformin')),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Mark skipped'));
      await tester.tap(find.text('Mark skipped'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(button));
      await tester.pumpAndSettle();
      return results;
    }

    testWidgets('Cancel on the reason records nothing', (tester) async {
      final results = await openAndSkip(tester, 'Cancel');
      // The sheet stays open and returns nothing: no skip was recorded.
      expect(results, isEmpty);
      expect(find.text('Mark skipped'), findsOneWidget);
    });

    testWidgets('Save records the skip', (tester) async {
      final results = await openAndSkip(tester, 'Save');
      expect(results.single?.status, 'skipped');
    });
  });

  group('an avatar takes the name’s initial, not the title’s', () {
    for (final (name, initial) in [('Dr. Amit Dey', 'A'), ('dr Sen', 'S'), ('Smt Roy', 'R'), ('Salman', 'S')]) {
      testWidgets(name, (tester) async {
        await tester.pumpWidget(app(Scaffold(body: UserAvatar(name: name, avatarUrl: null, accent: Colors.blue))));
        expect(find.text(initial), findsOneWidget);
      });
    }
  });

  test('a lab value the report did not give is not a zero', () {
    final missing = Analyte.fromJson({'code': 'ldl', 'label': 'LDL'});
    final given = Analyte.fromJson({'code': 'ldl', 'label': 'LDL', 'value': 0});
    expect(missing.hasValue, isFalse);
    expect(given.hasValue, isTrue, reason: 'a real 0 is still a value');
  });
}
