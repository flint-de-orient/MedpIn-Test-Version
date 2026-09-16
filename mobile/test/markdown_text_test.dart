import 'package:medpin/shared/widgets/markdown_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const style = TextStyle(fontSize: 17);

  Future<void> pump(WidgetTester tester, String data) => tester.pumpWidget(
    MaterialApp(home: Scaffold(body: MarkdownText(data: data, style: style))),
  );

  testWidgets('renders bold without showing the asterisks', (tester) async {
    await pump(tester, 'Your sugar of **250** is high.');
    // The literal ** must not appear anywhere on screen.
    expect(find.textContaining('**'), findsNothing);

    final rich = tester.widget<RichText>(find.byType(RichText).first);
    final bolded = <String>[];
    rich.text.visitChildren((span) {
      if (span is TextSpan && span.style?.fontWeight == FontWeight.w700) {
        bolded.add(span.text ?? '');
      }
      return true;
    });
    expect(bolded, contains('250'));
  });

  testWidgets('turns "- " lines into real bullets, not raw dashes', (
    tester,
  ) async {
    await pump(tester, 'Do this:\n- Drink water\n- Recheck in 2 hours');
    expect(find.textContaining('- Drink'), findsNothing); // no raw dash prefix
    expect(find.text('•'), findsNWidgets(2));
  });

  testWidgets('handles Bengali content with bold', (tester) async {
    await pump(tester, 'আপনার সুগার **২৫০** বেশি।');
    expect(find.textContaining('**'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  _plainTextChecks();

  testWidgets('plain text with no markdown renders unchanged', (tester) async {
    await pump(tester, 'Just a plain sentence.');
    expect(find.textContaining('Just a plain sentence.'), findsOneWidget);
  });
}

void _plainTextChecks() {
  group('MarkdownText.toPlainText — clean copy', () {
    test('strips bold and bullet marks', () {
      expect(
        MarkdownText.toPlainText(
          'Take **250** seriously.\n- Drink water\n- Rest',
        ),
        'Take 250 seriously.\n• Drink water\n• Rest',
      );
    });

    test('leaves plain text untouched', () {
      expect(MarkdownText.toPlainText('Just plain.'), 'Just plain.');
    });

    test('handles Bengali with bold', () {
      expect(MarkdownText.toPlainText('সুগার **২৫০**'), 'সুগার ২৫০');
    });
  });
}
