import 'package:medpin/features/clinician/domain/knowledge_chunk.dart';
import 'package:medpin/features/clinician/presentation/knowledge_edit_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A shared knowledge entry opens read-only.
///
/// ---- Why ----------------------------------------------------------------
///
/// A passage with no practice is served to every practice's assistant. Any
/// doctor on the platform could edit, approve or retire one, which meant
/// rewriting what every other practice's patients were told. The server now
/// refuses.
///
/// The screen has to agree. Save on an entry the server will refuse is a
/// control that can only fail, and the doctor learns that the app is broken
/// rather than that the content is not theirs to change.

KnowledgeChunk _entry({required Object? isShared}) => KnowledgeChunk.fromJson({
  'id': 'k1',
  'docId': 'hypo-night',
  'title': 'Low sugar at night',
  'content':
      'If your sugar is below 70 at night, take fifteen grams of fast sugar.',
  'language': 'en',
  'category': 'hypoglycaemia',
  'status': 'approved',
  'version': 2,
  'hasEmbedding': true,
  if (isShared != null) 'isShared': isShared,
});

Future<void> _open(WidgetTester tester, KnowledgeChunk chunk) async {
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp(home: KnowledgeEditScreen(chunk: chunk))),
  );
  await tester.pump();
}

void main() {
  group('isShared', () {
    test('is read from the server', () {
      expect(_entry(isShared: true).isShared, isTrue);
      expect(_entry(isShared: false).isShared, isFalse);
    });

    test('absent means editable — an older server refused nothing', () {
      expect(_entry(isShared: null).isShared, isFalse);
    });
  });

  testWidgets('a shared entry offers nothing the server would refuse', (
    tester,
  ) async {
    await _open(tester, _entry(isShared: true));

    expect(find.text('Shared with every practice'), findsOneWidget);
    expect(find.text('Save'), findsNothing);
    expect(find.text('Save as draft'), findsNothing);
    expect(find.text('Approve'), findsNothing);
    expect(
      find.byType(PopupMenuButton<String>),
      findsNothing,
      reason: 'retiring a shared entry is offered',
    );

    final fields = tester.widgetList<TextField>(find.byType(TextField));
    expect(fields, isNotEmpty);
    expect(
      fields.every((f) => f.readOnly),
      isTrue,
      reason: 'a field on a shared entry can be typed into',
    );
  });

  testWidgets('a practice’s own entry can still be changed', (tester) async {
    await _open(tester, _entry(isShared: false));

    expect(find.text('Shared with every practice'), findsNothing);
    // Already approved, so saving is the one action at the bottom.
    expect(find.text('Save'), findsOneWidget);
    expect(find.byType(PopupMenuButton<String>), findsOneWidget);

    final fields = tester.widgetList<TextField>(find.byType(TextField));
    expect(fields, isNotEmpty);
    expect(fields.any((f) => f.readOnly), isFalse);
  });
}
