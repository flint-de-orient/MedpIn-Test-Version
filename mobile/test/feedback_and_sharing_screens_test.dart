import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/features/clinician/presentation/feedback_inbox_screen.dart';
import 'package:akd_care/features/feedback/data/feedback_repository.dart';
import 'package:akd_care/features/profile/presentation/feedback_screen.dart';
import 'package:akd_care/features/sharing/data/sharing_repository.dart';
import 'package:akd_care/features/sharing/presentation/sharing_screen.dart';

/// What the feedback and sharing screens put on glass.
///
/// The model tests prove the shapes. These prove the sentences a patient and a
/// clinician actually read — above all the ones that used to be false: a form
/// addressed to one named doctor for every practice, and "the clinic has
/// received this" for feedback no clinic receives.

FeedbackPractice _practice(String id, String name, {bool self = true, String? patient}) =>
    FeedbackPractice(practiceId: id, practiceName: name, patientId: 'p', patientName: patient, isSelf: self);

Future<void> _pump(WidgetTester tester, Widget child, List<Override> overrides) async {
  tester.view.physicalSize = const Size(360 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(overrides: overrides, child: MaterialApp(home: child)));
  await tester.pumpAndSettle();
}

Capabilities _caps(Set<String> permissions) => Capabilities(
  resolved: true,
  practiceType: null,
  specialty: null,
  plan: null,
  practice: const {},
  effective: const {},
  role: 'doctor',
  isOwner: false,
  permissions: permissions,
);

void main() {
  group('the patient’s feedback form', () {
    testWidgets('with no clinic, it says the MedPin team gets it — and names no doctor', (tester) async {
      await _pump(tester, const FeedbackScreen(), [
        feedbackPracticesProvider.overrideWith((ref) async => const []),
      ]);

      expect(find.textContaining('not registered with a clinic on MedPin yet'), findsOneWidget);
      expect(find.textContaining('MedPin team'), findsWidgets);
      expect(find.textContaining('Dr. Dey'), findsNothing);
      expect(find.textContaining('the clinic has received'), findsNothing);
    });

    testWidgets('with one clinic, it names that clinic', (tester) async {
      await _pump(tester, const FeedbackScreen(), [
        feedbackPracticesProvider.overrideWith((ref) async => [_practice('a', 'Salt Lake Clinic')]),
      ]);

      expect(find.text('This goes to Salt Lake Clinic.'), findsOneWidget);
    });

    testWidgets('with two, it will not send until one is chosen', (tester) async {
      await _pump(tester, const FeedbackScreen(), [
        feedbackPracticesProvider.overrideWith(
          (ref) async => [
            _practice('a', 'Salt Lake Clinic'),
            _practice('b', 'Behala Children', self: false, patient: 'Aarav'),
          ],
        ),
      ]);

      expect(find.text('Choose which clinic this is about.'), findsOneWidget);
      expect(find.text('About Aarav'), findsOneWidget);

      // The page's own list, not the text field's inner scroller.
      final page = find.byType(Scrollable).first;
      final field = find.byType(TextField);
      await tester.scrollUntilVisible(field, 200, scrollable: page);
      await tester.enterText(field, 'We waited two hours');
      await tester.pump();

      final send = find.widgetWithText(FilledButton, 'Send feedback');
      await tester.scrollUntilVisible(send, 200, scrollable: page);
      expect(tester.widget<FilledButton>(send).onPressed, isNull, reason: 'sent without saying which clinic');

      await tester.scrollUntilVisible(find.text('Behala Children'), -200, scrollable: page);
      await tester.tap(find.text('Behala Children'));
      await tester.pump();
      await tester.scrollUntilVisible(send, 200, scrollable: page);
      expect(tester.widget<FilledButton>(send).onPressed, isNotNull);
    });

    testWidgets('about the app, no clinic is named', (tester) async {
      await _pump(tester, const FeedbackScreen(), [
        feedbackPracticesProvider.overrideWith((ref) async => [_practice('a', 'Salt Lake Clinic')]),
      ]);
      await tester.tap(find.text('This app'));
      await tester.pumpAndSettle();

      expect(find.textContaining('No clinic sees it'), findsOneWidget);
      expect(find.text('This goes to Salt Lake Clinic.'), findsNothing);
    });
  });

  group('the practice’s inbox', () {
    final inbox = FeedbackInbox(
      unread: 1,
      items: [
        InboxFeedback.fromJson({
          'id': 'f1',
          'about': 'clinic',
          'message': 'Nobody called me back',
          'reviewed': false,
          'reviewedBy': [
            {'name': 'Dr Colleague', 'at': '2026-09-16T10:00:00Z'},
          ],
          'patientName': 'Anita Sengupta',
          'replies': const [],
        }),
      ],
    );

    testWidgets('says what this reader has not read, and who else has', (tester) async {
      await _pump(tester, const FeedbackInboxScreen(), [
        feedbackInboxProvider.overrideWith((ref) async => inbox),
        capabilitySetProvider.overrideWithValue(_caps({Perm.viewPatient, Perm.chatReply})),
      ]);

      expect(find.text('1 you have not read yet.'), findsOneWidget);
      expect(find.text('New to you'), findsOneWidget, reason: 'a colleague reading it cleared it for this reader');
      expect(find.text('Read by Dr Colleague'), findsOneWidget);
      expect(find.text('Mark read'), findsOneWidget);
      expect(find.text('Reply'), findsOneWidget);
    });

    testWidgets('offers no reply to somebody who may not answer patients', (tester) async {
      await _pump(tester, const FeedbackInboxScreen(), [
        feedbackInboxProvider.overrideWith((ref) async => inbox),
        capabilitySetProvider.overrideWithValue(_caps({Perm.viewPatient})),
      ]);

      expect(find.text('Reply'), findsNothing);
      expect(find.text('Mark read'), findsOneWidget);
    });
  });

  group('who can see my records', () {
    final overview = SharingOverview.fromJson({
      'patient': {'id': 'p', 'name': 'Meera'},
      'connected': [
        {
          'enrollmentId': 'e1',
          'practice': {'id': 'pr1', 'name': 'Salt Lake Clinic'},
          'since': '2026-01-10T00:00:00Z',
          'consentedOn': '2026-09-01T00:00:00Z',
          'reconsented': true,
          'shared': [
            {
              'id': 'g1',
              'categories': ['prescriptions', 'ecg'],
              'status': 'active',
              'doctor': {'id': 'd1', 'name': 'Dr Sen'},
            },
          ],
          'requests': [
            {
              'id': 'r1',
              'categories': ['lab_results'],
              'status': 'requested',
              'requestNote': 'For your review',
              'requestedBy': 'Dr Sen',
            },
          ],
        },
      ],
      'waiting': [
        {'enrollmentId': 'e2', 'practice': {'id': 'pr2', 'name': 'Behala'}, 'askedOn': '2026-09-15T00:00:00Z'},
      ],
      'ended': const [],
      'past': const [],
    });

    testWidgets('lists the clinic, why, what is shared, and what is asked', (tester) async {
      await _pump(tester, const SharingScreen(), [
        sharingOverviewProvider.overrideWith((ref) async => overview),
        sharingQuestionsProvider.overrideWith((ref) async => const []),
      ]);

      expect(find.text('Salt Lake Clinic'), findsOneWidget);
      expect(find.textContaining('Sees what is recorded from'), findsOneWidget);
      expect(find.textContaining('You agreed again on'), findsOneWidget);
      expect(find.text('Prescriptions and ECGs'), findsOneWidget);
      expect(find.textContaining('Only Dr Sen'), findsOneWidget);
      expect(find.text('Stop sharing'), findsOneWidget);
      expect(find.text('Salt Lake Clinic asks to see more'), findsOneWidget);
      expect(find.text('Nothing is shared unless you agree.'), findsOneWidget);

      await tester.scrollUntilVisible(find.text('Waiting for your code'), 200);
      expect(find.text('Waiting for your code'), findsOneWidget);
    });

    testWidgets('nothing overflows a notch up the text scaler', (tester) async {
      // This clinic's patients are largely elderly, and the longest lines here
      // are the ones about what is and is not shared.
      tester.view.physicalSize = const Size(360 * 3, 800 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharingOverviewProvider.overrideWith((ref) async => overview),
            sharingQuestionsProvider.overrideWith(
              (ref) async => [
                SharingQuestion.fromJson({
                  'enrollmentId': 'e1',
                  'practice': {'id': 'pr1', 'name': 'Salt Lake Diabetes and Endocrine Clinic'},
                  'asks': {'ownLogs': true, 'history': true},
                }),
              ],
            ),
          ],
          child: const MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(size: Size(360, 800), textScaler: TextScaler.linear(1.3)),
              child: SharingScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('a waiting question starts with nothing shared', (tester) async {
      await _pump(tester, const SharingScreen(), [
        sharingOverviewProvider.overrideWith((ref) async => overview),
        sharingQuestionsProvider.overrideWith(
          (ref) async => [
            SharingQuestion.fromJson({
              'enrollmentId': 'e1',
              'practice': {'id': 'pr1', 'name': 'Salt Lake Clinic'},
              'asks': {'ownLogs': true, 'history': true},
            }),
          ],
        ),
      ]);

      expect(find.text('Choose what Salt Lake Clinic can see'), findsOneWidget);
      expect(find.text('Your own health logs'), findsOneWidget);
      expect(find.text('Your earlier history'), findsOneWidget);
      expect(find.text('Not shared'), findsNWidgets(2), reason: 'a switch started on, deciding for the patient');
      expect(find.text('Will be shared'), findsNothing);
    });
  });
}
