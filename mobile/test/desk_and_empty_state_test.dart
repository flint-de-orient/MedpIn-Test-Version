import 'package:medpin/features/chat/presentation/widgets/chat_empty_state.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/widgets/notification_list_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _harness(Widget child) => ProviderScope(
  child: MaterialApp(
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: child),
  ),
);

PanelNotification _n(String id, String kind, String name) => PanelNotification(
  id: id,
  kind: kind,
  patientId: 'p$id',
  patientName: name,
  text: 'something happened',
  at: DateTime(2026, 8, 30, 9, 0),
  unread: true,
);

void main() {
  group('the assistant first-run screen fits the screen it is given', () {
    /// The reported bug: on a short handset the four suggestion cards ran past
    /// the bottom and the fourth was cut in half, so a new patient's first
    /// sight of the app was a clipped list. The sizes are now derived from the
    /// space available, and these are the sizes that space actually is once the
    /// disclaimer banner, the composer and the bottom bar have taken theirs.
    for (final height in const [360.0, 400.0, 440.0, 470.0, 520.0, 640.0]) {
      testWidgets('nothing to scroll at ${height.toInt()}px', (tester) async {
        tester.view.physicalSize = Size(392 * 3, height * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);

        await tester.pumpWidget(
          _harness(
            SizedBox(
              height: height,
              width: 392,
              child: ChatEmptyState(onSuggestionTap: (_) {}),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final scrollable = tester.widget<Scrollable>(find.byType(Scrollable));
        final position = scrollable.controller?.position;
        expect(
          position?.maxScrollExtent ?? 0,
          0,
          reason: 'the first-run screen should not need scrolling at ${height}px',
        );
      });
    }

    testWidgets('all four suggestions are laid out, none dropped', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(392 * 3, 380 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          SizedBox(
            height: 380,
            width: 392,
            child: ChatEmptyState(onSuggestionTap: (_) {}),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The fourth card is the one that used to be clipped.
      expect(find.byType(InkWell), findsNWidgets(4));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a tap still sends the question', (tester) async {
      String? sent;
      await tester.pumpWidget(
        _harness(
          SizedBox(
            height: 640,
            width: 392,
            child: ChatEmptyState(onSuggestionTap: (v) => sent = v),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(InkWell).first);
      expect(sent, isNotNull);
      expect(sent, isNotEmpty);
    });
  });

  group('the desk notification list is triaged, not just listed', () {
    final groups = [
      const NotificationGroup(
        title: 'Urgent',
        kinds: {'urgent', 'alert'},
        priority: NotificationPriority.urgent,
      ),
      const NotificationGroup(
        title: 'Appointments',
        kinds: {'request'},
        priority: NotificationPriority.actionNeeded,
      ),
      const NotificationGroup(
        title: 'Messages',
        kinds: {'message', 'nutrition'},
        priority: NotificationPriority.informational,
      ),
    ];

    Widget sheet(List<PanelNotification> items, List<NotificationGroup> g) =>
        _harness(
          NotificationListSheet(
            items: items,
            groups: g,
            unread: items.length,
            loading: false,
            failed: false,
            onRefresh: () {},
            onOpen: (_) {},
          ),
        );

    testWidgets('headings appear for the groups that have rows', (
      tester,
    ) async {
      await tester.pumpWidget(
        sheet([
          _n('1', 'urgent', 'Raj Dhara'),
          _n('2', 'request', 'Ayesha Rahman'),
          _n('3', 'message', 'Sunita Sharma'),
        ], groups),
      );
      await tester.pumpAndSettle();

      expect(find.text('Urgent'), findsOneWidget);
      expect(find.text('Appointments'), findsOneWidget);
      expect(find.text('Messages'), findsOneWidget);
      expect(find.text('Raj Dhara'), findsOneWidget);
    });

    testWidgets('an empty group draws no heading', (tester) async {
      // A standing "Urgent" heading over nothing is a heading people stop
      // reading, which is the one thing this list cannot afford.
      await tester.pumpWidget(
        sheet([_n('2', 'request', 'Ayesha Rahman')], groups),
      );
      await tester.pumpAndSettle();

      expect(find.text('Urgent'), findsNothing);
      expect(find.text('Messages'), findsNothing);
      expect(find.text('Appointments'), findsOneWidget);
    });

    testWidgets('a kind no group claims is still shown', (tester) async {
      // If the server starts sending something new, it must not vanish. Losing
      // a notification silently is worse than showing it in the wrong place.
      await tester.pumpWidget(
        sheet([
          _n('1', 'urgent', 'Raj Dhara'),
          _n('9', 'something_new', 'Rahul Das'),
        ], groups),
      );
      await tester.pumpAndSettle();

      expect(find.text('Rahul Das'), findsOneWidget);
    });

    testWidgets('no groups means the old flat list, unchanged', (tester) async {
      await tester.pumpWidget(
        sheet([
          _n('1', 'urgent', 'Raj Dhara'),
          _n('3', 'message', 'Sunita Sharma'),
        ], const []),
      );
      await tester.pumpAndSettle();

      expect(find.text('Urgent'), findsNothing);
      expect(find.text('Raj Dhara'), findsOneWidget);
      expect(find.text('Sunita Sharma'), findsOneWidget);
    });
  });
}
