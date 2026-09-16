import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/core/network/submission_keys.dart';
import 'package:medpin/features/clinician/data/clinician_repository.dart';
import 'package:medpin/features/clinician/domain/ecg_report.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/widgets/ecg_section.dart';

/// The ECG on a patient's record: what is shown, to whom, and what the form
/// sends.
///
/// The failures worth pinning are quiet ones. A section that says "No ECGs"
/// when it could not load. A retry that sends a new date and files a second
/// ECG. An interval nobody measured going to the server as a number.
Capabilities _caps({required bool mayFile}) => Capabilities(
      resolved: true,
      practiceType: null,
      specialty: null,
      plan: null,
      practice: const {},
      effective: const {},
      role: 'doctor',
      isOwner: false,
      permissions: mayFile ? const {Perm.viewPatient, Perm.editRecord} : const {Perm.viewPatient},
    );

class _FakeRepository extends Fake implements ClinicianRepository {
  final drafts = <Map<String, dynamic>>[];
  final submissions = <SubmissionKeys?>[];
  int failuresLeft = 0;

  @override
  Future<EcgReport> fileEcg(String patientId, EcgDraft draft, {SubmissionKeys? submission}) async {
    drafts.add(draft.toJson());
    submissions.add(submission);
    if (failuresLeft > 0) {
      failuresLeft--;
      throw Exception('the network dropped');
    }
    return EcgReport.fromJson({
      'id': 'e${drafts.length}',
      'recordedOn': draft.recordedOn.toIso8601String(),
      'rhythm': draft.rhythm,
      'impression': draft.impression.api,
    });
  }
}

void main() {
  group('what the form sends', () {
    test('only what was measured, and never a blank as a value', () {
      final json = EcgDraft(
        recordedOn: DateTime.utc(2026, 9, 15, 10),
        rhythm: 'sinus',
        impression: EcgImpression.normal,
        heartRate: 72,
        findings: '   ',
        readBy: ' Dr Sen ',
      ).toJson();

      expect(json, {
        'recordedOn': '2026-09-15T10:00:00.000Z',
        'rhythm': 'sinus',
        'impression': 'normal',
        'heartRate': 72,
        'readBy': 'Dr Sen',
      });
    });
  });

  group('the section on the record', () {
    Future<void> pump(WidgetTester tester, {required bool mayFile, required Future<List<EcgReport>> Function() items}) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            capabilitySetProvider.overrideWith((ref) => _caps(mayFile: mayFile)),
            patientEcgsProvider('p1').overrideWith((ref) => items()),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SingleChildScrollView(child: EcgSection(patientId: 'p1'))),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('somebody who cannot file sees nothing for a record with no ECGs', (tester) async {
      await pump(tester, mayFile: false, items: () async => const []);
      expect(find.text('ECGs'), findsNothing);
      expect(find.text('File ECG'), findsNothing);
    });

    testWidgets('somebody who can file sees the empty section, with the way to file one', (tester) async {
      await pump(tester, mayFile: true, items: () async => const []);
      expect(find.text('No ECGs on this record.'), findsOneWidget);
      expect(find.text('File ECG'), findsOneWidget);
    });

    testWidgets('a failed load says so, to everyone, and never that there are none', (tester) async {
      await pump(tester, mayFile: false, items: () async => throw Exception('offline'));
      expect(find.text('Could not load ECGs.'), findsOneWidget);
      expect(find.textContaining('No ECGs'), findsNothing, reason: 'a list that did not arrive was read as an empty record');
    });

    testWidgets('an abnormal ECG reads as a word, with its rhythm, what was measured and who read it', (tester) async {
      await pump(
        tester,
        mayFile: false,
        items: () async => [
          EcgReport.fromJson({
            'id': 'e1',
            'recordedOn': '2026-09-10T10:00:00Z',
            'rhythm': 'atrial_fibrillation',
            'impression': 'abnormal',
            'heartRate': 118,
            'qtcMs': 460,
            'findings': 'No P waves.',
            'readBy': 'Dr Sen',
            'files': [],
          }),
        ],
      );
      expect(find.text('Abnormal'), findsOneWidget, reason: 'the impression is only a colour');
      expect(find.text('Atrial fibrillation'), findsOneWidget);
      expect(find.text('118 bpm · QTc 460 ms'), findsOneWidget, reason: 'an interval nobody measured was shown');
      expect(find.text('No P waves.'), findsOneWidget);
      expect(find.text('Read by Dr Sen'), findsOneWidget);
    });
  });

  group('filing one', () {
    Future<void> openForm(WidgetTester tester, _FakeRepository repository) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [clinicianRepositoryProvider.overrideWithValue(repository)],
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => EcgFormSheet.show(context, 'p1'),
                  child: const Text('Open form'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open form'));
      await tester.pumpAndSettle();
    }

    Future<void> submit(WidgetTester tester) async {
      final button = find.widgetWithText(FilledButton, 'File ECG');
      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      await tester.tap(button);
      await tester.pumpAndSettle();
    }

    testWidgets('a heart rate no tracing can show is refused before anything is sent', (tester) async {
      final repository = _FakeRepository();
      await openForm(tester, repository);

      await tester.enterText(find.widgetWithText(TextFormField, 'Heart rate'), '999');
      await submit(tester);

      expect(find.text('Heart rate must be 20–300 bpm'), findsOneWidget);
      expect(repository.drafts, isEmpty);
    });

    testWidgets('a retry after a failure sends the same filing under the same key', (tester) async {
      final repository = _FakeRepository()..failuresLeft = 1;
      await openForm(tester, repository);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Abnormal'));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextFormField, 'Heart rate'), '118');

      await submit(tester);
      expect(find.byType(EcgFormSheet), findsOneWidget, reason: 'a failed filing closed the form and lost what was typed');

      await submit(tester);

      expect(repository.drafts, hasLength(2));
      expect(repository.drafts[1], repository.drafts[0], reason: 'the retry sent other values, and would file a second ECG');
      expect(identical(repository.submissions[0], repository.submissions[1]), isTrue, reason: 'the retry was sent under a new key');
      expect(repository.drafts[0]['impression'], 'abnormal');
      expect(repository.drafts[0]['heartRate'], 118);
      expect(repository.drafts[0].containsKey('prIntervalMs'), isFalse, reason: 'an interval nobody measured was sent');
      expect(find.byType(EcgFormSheet), findsNothing);
    });
  });
}
