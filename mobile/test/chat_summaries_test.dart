import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/chat_summary.dart';
import 'package:medpin/features/clinician/presentation/chat_summaries_screen.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/widgets/chat_summary_card.dart';

/// The day's patient conversations, as the doctor they did not interrupt sees
/// them.
///
/// A doctor is pushed emergencies and high-risk alerts and nothing else, so the
/// card on their home screen and the screen behind it are where every other
/// message of the day reaches them. The promises worth pinning:
///
///   - the count is of patients still waiting on this doctor, and the ones
///     named are those;
///   - nothing is said before the answer arrives, and a failed load is not
///     "nobody wrote";
///   - a status is a word, and a summary says whether the assistant wrote it;
///   - "yesterday" is the day before the clinic's today, whatever the phone's
///     clock says.
void main() {
  Map<String, dynamic> summary(
    String name, {
    String urgency = 'routine',
    List<String> reasons = const [],
    bool reviewed = false,
    String source = 'rules',
    String day = '2026-03-01',
  }) => {
    'id': 'id-$name',
    'patient': {'id': 'patient-$name', 'name': name},
    'day': day,
    'highestUrgency': urgency,
    'needsDoctor': reasons.isNotEmpty,
    'reasons': reasons,
    'overview': '1 message from the patient; no reply from the clinic yet.',
    'points': [
      {
        'kind': 'symptom',
        'text': 'Feels dizzy after lunch',
        'messageIds': ['m1'],
      },
    ],
    'source': source,
    'reviewed': reviewed,
  };

  ChatSummaryDay listed(
    List<Map<String, dynamic>> items, {
    String day = '2026-03-01',
  }) => ChatSummaryDay.fromJson({
    'day': day,
    'scope': 'mine',
    'kind': 'care',
    'counts': {
      'patients': items.length,
      'needsDoctor': items.where((i) => i['needsDoctor'] == true).length,
      'reviewed': items.where((i) => i['reviewed'] == true).length,
    },
    'items': items,
  });

  Future<void> pump(
    WidgetTester tester,
    Widget child,
    List<Override> overrides, {
    bool settle = true,
  }) async {
    // A phone's width, and tall enough that every tile is built.
    tester.view.physicalSize = const Size(360 * 3, 2400 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(overrides: overrides, child: MaterialApp(home: child)),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
    }
  }

  Widget card() =>
      const Scaffold(body: SingleChildScrollView(child: ChatSummaryCard()));

  group('the card on the doctor’s home screen', () {
    testWidgets(
      'counts the patients still waiting, and names them with a word for why',
      (tester) async {
        await pump(tester, card(), [
          chatSummariesProvider(ChatSummaryCard.query).overrideWith(
            (ref) async => listed([
              summary(
                'Dizzy Patient',
                urgency: 'urgent',
                reasons: ['Urgent by triage: very high sugar'],
              ),
              summary(
                'Booking Patient',
                reasons: ['Asked to be seen'],
                reviewed: true,
              ),
              summary('Thankful Patient'),
            ]),
          ),
        ]);

        expect(find.text('3 patients wrote today. 1 needs you.'), findsOneWidget);
        expect(find.text('Dizzy Patient'), findsOneWidget);
        expect(find.text('Urgent by triage: very high sugar'), findsOneWidget);
        expect(
          find.text('Urgent'),
          findsOneWidget,
          reason: 'the status was carried by colour alone',
        );
        expect(
          find.text('Booking Patient'),
          findsNothing,
          reason: 'a day the doctor already read was listed as waiting',
        );
        expect(
          find.text('Thankful Patient'),
          findsNothing,
          reason: 'a patient who needed nobody was listed as waiting',
        );
      },
    );

    testWidgets('more waiting than fit are counted, not dropped', (
      tester,
    ) async {
      await pump(tester, card(), [
        chatSummariesProvider(ChatSummaryCard.query).overrideWith(
          (ref) async => listed([
            for (var i = 1; i <= 5; i++)
              summary('Patient $i', reasons: ['1 message with no reply']),
          ]),
        ),
      ]);

      expect(find.text('5 patients wrote today. 5 need you.'), findsOneWidget);
      expect(find.text('Patient 3'), findsOneWidget);
      expect(find.text('Patient 4'), findsNothing);
      expect(find.text('+2 more waiting'), findsOneWidget);
    });

    testWidgets('a quiet day is said, once', (tester) async {
      await pump(tester, card(), [
        chatSummariesProvider(
          ChatSummaryCard.query,
        ).overrideWith((ref) async => listed(const [])),
      ]);

      expect(find.text('None of your patients wrote today.'), findsOneWidget);
    });

    testWidgets('says nothing about the day before the answer arrives', (
      tester,
    ) async {
      final never = Completer<ChatSummaryDay>();
      await pump(tester, card(), [
        chatSummariesProvider(
          ChatSummaryCard.query,
        ).overrideWith((ref) => never.future),
      ], settle: false);

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.textContaining('wrote today'), findsNothing);
    });

    testWidgets('a list that did not load is not a day nobody wrote', (
      tester,
    ) async {
      await pump(tester, card(), [
        chatSummariesProvider(
          ChatSummaryCard.query,
        ).overrideWith((ref) async => throw Exception('offline')),
      ]);

      expect(
        find.textContaining('Could not load today’s conversations'),
        findsOneWidget,
      );
      expect(find.textContaining('wrote today'), findsNothing);
    });
  });

  group('the day’s conversations, in full', () {
    test('yesterday is worked out from the clinic’s date, not a clock', () {
      expect(previousClinicDay('2026-03-01'), '2026-02-28');
      expect(previousClinicDay('2024-03-01'), '2024-02-29');
      expect(previousClinicDay('2026-01-01'), '2025-12-31');
      expect(previousClinicDay(''), isNull);
      expect(previousClinicDay('yesterday'), isNull);
    });

    testWidgets(
      '“Yesterday” asks for the day before the one the server called today',
      (tester) async {
        await pump(tester, const ChatSummariesScreen(), [
          chatSummariesProvider(ChatSummaryCard.query).overrideWith(
            (ref) async => listed([summary('Today Patient')]),
          ),
          chatSummariesProvider((
            day: '2026-02-28',
            scope: 'mine',
            kind: 'care',
          )).overrideWith(
            (ref) async => listed([
              summary('Yesterday Patient', day: '2026-02-28'),
            ], day: '2026-02-28'),
          ),
        ]);
        expect(find.text('Today Patient'), findsOneWidget);

        await tester.tap(find.text('Yesterday'));
        await tester.pumpAndSettle();

        expect(find.text('Yesterday Patient'), findsOneWidget);
        expect(
          find.text('1 patient wrote yesterday. None needs you.'),
          findsOneWidget,
        );
      },
    );

    testWidgets('the whole practice is its own question', (tester) async {
      await pump(tester, const ChatSummariesScreen(), [
        chatSummariesProvider(
          ChatSummaryCard.query,
        ).overrideWith((ref) async => listed([summary('My Patient')])),
        chatSummariesProvider((
          day: null,
          scope: 'practice',
          kind: 'care',
        )).overrideWith(
          (ref) async => listed([
            summary('My Patient'),
            summary('Colleague Patient', reasons: ['Asked to be seen']),
          ]),
        ),
      ]);
      expect(find.text('Colleague Patient'), findsNothing);

      await tester.tap(find.text('Whole practice'));
      await tester.pumpAndSettle();

      expect(find.text('Colleague Patient'), findsOneWidget);
      expect(
        find.text('2 patients wrote today. 1 needs a clinician.'),
        findsOneWidget,
      );
    });

    testWidgets(
      'each summary says who wrote it, and a day already read offers no second mark',
      (tester) async {
        await pump(tester, const ChatSummariesScreen(), [
          chatSummariesProvider(ChatSummaryCard.query).overrideWith(
            (ref) async => listed([
              summary(
                'Assisted Patient',
                source: 'ai',
                reasons: ['Stopped metformin'],
              ),
              summary('Read Patient', reviewed: true),
            ]),
          ),
        ]);

        expect(
          find.text('Summarised by the assistant from the day’s messages'),
          findsOneWidget,
        );
        expect(find.text('Put together from the day’s messages'), findsOneWidget);
        expect(find.text('Waiting'), findsOneWidget);
        expect(find.text('Read'), findsOneWidget);
        expect(
          find.text('Mark as read'),
          findsOneWidget,
          reason: 'only the unread day offers the mark',
        );
        expect(find.text('You marked this day read'), findsOneWidget);
      },
    );
  });
}
