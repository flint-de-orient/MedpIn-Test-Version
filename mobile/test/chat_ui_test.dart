import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/citation.dart';
import 'package:medpin/features/chat/presentation/widgets/chat_composer.dart';
import 'package:medpin/features/chat/presentation/widgets/chat_empty_state.dart';
import 'package:medpin/features/chat/presentation/widgets/chat_message_bubble.dart';
import 'package:medpin/features/chat/presentation/widgets/emergency_card.dart';
import 'package:medpin/features/chat/presentation/widgets/generating_bubble.dart';
import 'package:medpin/features/chat/presentation/widgets/urgent_card.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // ChatComposer is a ConsumerWidget — it reads the upload repository when a
  // photo is attached — so everything is wrapped in a scope.
  //
  // The emergency and urgent cards read the patient's own practice number from
  // the server. Supplied here as a practice that has one; the tests about a
  // practice without one say so.
  const withNumber = CareContact(
    practiceName: 'Salt Lake Diabetes Care',
    phone: '+913324001234',
  );

  Widget harness(
    Widget child, {
    Locale locale = const Locale('en'),
    CareContact contact = withNumber,
  }) => ProviderScope(
    overrides: [careContactProvider.overrideWith((ref) async => contact)],
    child: MaterialApp(
      locale: locale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Disable animations so the composer's ever-repeating gradient border
      // doesn't hang pumpAndSettle; the border honours this and paints static.
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: Scaffold(body: child),
      ),
    ),
  );

  ChatMessage msg({
    required String role,
    required String content,
    String urgency = 'routine',
    List<Citation>? citations,
    DateTime? at,
  }) => ChatMessage(
    id: 'm1',
    seq: 1,
    role: role,
    content: content,
    language: 'en',
    urgency: urgency,
    createdAt: at,
    citations: citations,
  );

  group('Safety routing — must never regress', () {
    testWidgets('emergency urgency renders the card, never a bubble', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(
              role: 'assistant',
              content: 'Chest pain needs review.',
              urgency: 'emergency',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(EmergencyCard), findsOneWidget);
      expect(
        find.text('Go to the nearest hospital immediately'),
        findsOneWidget,
      );
      expect(find.text('Call clinic'), findsOneWidget);
    });

    testWidgets('urgent urgency renders the amber card', (tester) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(
              role: 'assistant',
              content: 'Please check soon.',
              urgency: 'urgent',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(UrgentCard), findsOneWidget);
      expect(find.text('Call clinic'), findsOneWidget);
    });

    testWidgets(
      'an emergency is still an emergency when the practice has no number',
      (tester) async {
        // No number is a real answer. The card must keep saying the one thing
        // that is always right, and must not offer a button that dials nothing
        // — it used to dial a placeholder compiled into the app.
        await tester.pumpWidget(
          harness(
            ChatMessageBubble(
              message: msg(
                role: 'assistant',
                content: 'Chest pain needs review.',
                urgency: 'emergency',
              ),
            ),
            contact: const CareContact(practiceName: null, phone: null),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byType(EmergencyCard), findsOneWidget);
        expect(
          find.text('Go to the nearest hospital immediately'),
          findsOneWidget,
        );
        expect(find.text('Call clinic'), findsNothing);
      },
    );

    testWidgets(
      'and an urgent card offers no number the practice has not given',
      (tester) async {
        await tester.pumpWidget(
          harness(
            ChatMessageBubble(
              message: msg(
                role: 'assistant',
                content: 'Please check soon.',
                urgency: 'urgent',
              ),
            ),
            contact: const CareContact(practiceName: null, phone: null),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byType(UrgentCard), findsOneWidget);
        expect(find.text('Call clinic'), findsNothing);
      },
    );

    testWidgets('a routine reply is a plain bubble with the disclaimer', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(role: 'assistant', content: 'Keep logging.'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(EmergencyCard), findsNothing);
      expect(find.byType(UrgentCard), findsNothing);

      // The caveat is still carried by the bubble itself — that is the part
      // that must never regress, because it is what survives a screenshot or
      // a reply read months later out of order. It is a chip now, with the
      // sentence on its tooltip and repeated in a banner above the thread, so
      // assert both halves: the badge is visible, and the words are on it.
      final chip = find.widgetWithText(Tooltip, 'AI');
      expect(chip, findsOneWidget);
      expect(
        tester.widget<Tooltip>(chip).message,
        'AI-assisted guidance, not a diagnosis',
      );
    });

    testWidgets('emergency card survives a Bengali locale', (tester) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(
              role: 'assistant',
              content: 'বুকে ব্যথা',
              urgency: 'emergency',
            ),
          ),
          locale: const Locale('bn'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(EmergencyCard), findsOneWidget);
    });
  });

  group('Message bubble', () {
    testWidgets('shows a 12-hour timestamp when createdAt is present', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(
              role: 'user',
              content: 'my sugar is 210',
              at: DateTime(2026, 7, 23, 12, 45),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('12:45 PM'), findsOneWidget);
    });

    testWidgets('renders citation chips by title', (tester) async {
      await tester.pumpWidget(
        harness(
          ChatMessageBubble(
            message: msg(
              role: 'assistant',
              content: 'Your reading is high.',
              citations: const [
                Citation(id: '1', title: 'ADA 2025 §6', source: 'ADA'),
                Citation(id: '2', title: 'IDF Guidelines', source: 'IDF'),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('ADA 2025 §6'), findsOneWidget);
      expect(find.text('IDF Guidelines'), findsOneWidget);
    });
  });

  group('Generating bubble', () {
    testWidgets('paints the sweep on the border, not as a centred indicator', (
      tester,
    ) async {
      await tester.pumpWidget(harness(const GeneratingBubble()));
      await tester.pump();

      // The sweep is a CustomPaint stroke on the bubble's rounded-rect
      // outline. A CircularProgressIndicator or any centred spinner here
      // would mean the animation moved back inside the bubble.
      expect(find.byType(CustomPaint), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      // Matched on the phrase rather than the whole string: the product
      // name has changed once already and broke this assertion silently.
      expect(find.textContaining('is analyzing data'), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 600));
      expect(tester.takeException(), isNull);
    });

    testWidgets('holds still when the OS asks for reduced motion', (
      tester,
    ) async {
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: harness(const GeneratingBubble()),
        ),
      );
      // pumpAndSettle would hang forever on a repeating animation, so
      // completing here is itself the assertion that nothing is looping.
      await tester.pumpAndSettle();
      expect(find.byType(GeneratingBubble), findsOneWidget);
    });
  });

  group('Composer', () {
    testWidgets('shows the mic and send together; send fires only with text', (
      tester,
    ) async {
      var sent = 0;
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) => sent++,
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Gemini-style: the dictation mic sits inside the pill and the send
      // button sits beside it — both are always present.
      expect(find.byIcon(Icons.mic_none_rounded), findsOneWidget);
      expect(find.byIcon(Icons.send_rounded), findsOneWidget);

      // Empty: tapping send does nothing.
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(sent, 0);

      // With text: send fires.
      await tester.enterText(find.byType(TextField), 'my sugar is 210');
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(sent, 1);
    });

    testWidgets('draws no inner border inside the pill', (tester) async {
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) {},
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Regression guard. The app theme sets `enabledBorder` and
      // `focusedBorder` explicitly, and those beat `border` — so nulling only
      // `border` left the TextField drawing a second outlined box inside the
      // composer pill, teal and 2px wide once focused. Every state must be
      // none, and the field must not paint its own fill.
      final field = tester.widget<TextField>(find.byType(TextField));
      final d = field.decoration!;
      expect(d.border, InputBorder.none);
      expect(d.enabledBorder, InputBorder.none);
      expect(d.focusedBorder, InputBorder.none);
      expect(d.errorBorder, InputBorder.none);
      expect(d.focusedErrorBorder, InputBorder.none);
      expect(d.disabledBorder, InputBorder.none);
      expect(d.filled, isFalse);

      // Focusing must not introduce one either.
      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();
      final focused = tester.widget<TextField>(find.byType(TextField));
      expect(focused.decoration!.focusedBorder, InputBorder.none);
    });

    testWidgets('whitespace alone does not arm the send button', (
      tester,
    ) async {
      var sent = 0;
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) => sent++,
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(sent, 0);
    });

    testWidgets('sends trimmed text and clears the field', (tester) async {
      String? sent;
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (t, _) => sent = t,
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '  my sugar is 210  ');
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();

      expect(sent, 'my sugar is 210');
      expect(find.text('  my sugar is 210  '), findsNothing);
    });

    testWidgets('the attach button is live, and disabled only while sending', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) {},
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      final attach = tester.widget<IconButton>(
        find.ancestor(
          of: find.byIcon(Icons.attach_file_rounded),
          matching: find.byType(IconButton),
        ),
      );
      expect(
        attach.onPressed,
        isNotNull,
        reason: 'attach must be wired, not a dead icon',
      );

      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) {},
            onSendVoiceNote: (_) {},
            isSending: true,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pump();

      final whileSending = tester.widget<IconButton>(
        find.ancestor(
          of: find.byIcon(Icons.attach_file_rounded),
          matching: find.byType(IconButton),
        ),
      );
      expect(whileSending.onPressed, isNull);
    });

    testWidgets('sends an empty attachment list when nothing is attached', (
      tester,
    ) async {
      List<String>? ids;
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, a) => ids = a,
            onSendVoiceNote: (_) {},
            isSending: false,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'my sugar is 210');
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();

      expect(ids, isEmpty);
    });

    testWidgets('while sending, shows a spinner and blocks re-send', (
      tester,
    ) async {
      var sent = 0;
      await tester.pumpWidget(
        harness(
          ChatComposer(
            onSend: (_, _) => sent++,
            onSendVoiceNote: (_) {},
            isSending: true,
            languageCode: 'en',
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.tap(
        find.byType(CircularProgressIndicator),
        warnIfMissed: false,
      );
      expect(sent, 0);
    });
  });

  group('Empty state', () {
    testWidgets('offers four suggestions and sends the tapped one verbatim', (
      tester,
    ) async {
      String? sent;
      await tester.pumpWidget(
        harness(ChatEmptyState(onSuggestionTap: (t) => sent = t)),
      );
      await tester.pumpAndSettle();

      expect(find.text('How can I help today?'), findsOneWidget);
      for (final s in [
        'My blood sugar is high today — what should I do?',
        'What are some healthy breakfast ideas?',
        'My feet feel numb and tingly. Should I worry?',
        'Help me understand my eye report',
      ]) {
        expect(find.text(s), findsOneWidget, reason: s);
      }

      await tester.tap(
        find.text('My feet feel numb and tingly. Should I worry?'),
      );
      await tester.pumpAndSettle();
      expect(sent, 'My feet feel numb and tingly. Should I worry?');
    });

    testWidgets('localizes into Hindi', (tester) async {
      await tester.pumpWidget(
        harness(
          ChatEmptyState(onSuggestionTap: (_) {}),
          locale: const Locale('hi'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('आज मैं कैसे मदद कर सकता हूँ?'), findsOneWidget);
    });
  });
}
