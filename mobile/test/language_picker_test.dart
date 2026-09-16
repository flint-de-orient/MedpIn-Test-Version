import 'package:medpin/features/onboarding/presentation/language_picker_screen.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The picker runs before a language has been chosen, so its copy cannot come
/// from the app locale — it has to preview whichever option is highlighted.
/// These tests pin that behaviour: tapping an option must retranslate the
/// heading, subtitle and button, not just move the tick.
void main() {
  Widget harness() => ProviderScope(
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: const LanguagePickerScreen(),
    ),
  );

  testWidgets('opens in English with a single-language heading', (
    tester,
  ) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    expect(find.text('Choose your language'), findsOneWidget);
    expect(
      find.text('You can change this anytime from your profile.'),
      findsOneWidget,
    );
    expect(find.text('Continue'), findsOneWidget);

    // The old bug: all three languages concatenated into one static heading.
    expect(
      find.textContaining('Choose your language / '),
      findsNothing,
      reason:
          'heading must be a single localized string, not a tri-lingual concatenation',
    );
  });

  testWidgets('tapping বাংলা retranslates heading, subtitle and button', (
    tester,
  ) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    await tester.tap(find.text('বাংলায় চালিয়ে যান'));
    await tester.pumpAndSettle();

    expect(find.text('আপনার ভাষা বেছে নিন'), findsOneWidget);
    expect(
      find.text('প্রোফাইল থেকে আপনি যেকোনো সময় ভাষা বদলাতে পারবেন।'),
      findsOneWidget,
    );
    expect(find.text('এগিয়ে যান'), findsOneWidget);

    // English copy must be gone — this is what was broken before.
    expect(find.text('Choose your language'), findsNothing);
    expect(
      find.text('You can change this anytime from your profile.'),
      findsNothing,
    );
  });

  testWidgets('tapping हिन्दी retranslates heading, subtitle and button', (
    tester,
  ) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    await tester.tap(find.text('हिन्दी में जारी रखें'));
    await tester.pumpAndSettle();

    expect(find.text('अपनी भाषा चुनें'), findsOneWidget);
    expect(find.text('आगे बढ़ें'), findsOneWidget);
    expect(find.text('Choose your language'), findsNothing);
  });

  testWidgets('option tiles always render in their own script', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    // A Hindi speaker must be able to find "हिन्दी" while the screen is still
    // in English, so these labels are deliberately never translated.
    for (final label in ['English', 'বাংলা', 'हिन्दी']) {
      expect(find.text(label), findsOneWidget);
    }

    await tester.tap(find.text('বাংলায় চালিয়ে যান'));
    await tester.pumpAndSettle();

    for (final label in ['English', 'বাংলা', 'हिन्दी']) {
      expect(
        find.text(label),
        findsOneWidget,
        reason: '$label must survive a locale switch',
      );
    }
  });
}
