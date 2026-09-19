import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/chat/presentation/widgets/emergency_card.dart';
import 'package:medpin/features/profile/presentation/widgets/theme_selector.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:medpin/shared/providers/theme_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The point of the theme control is that it changes the *whole* app, not the
/// screen it lives on. These pump a MaterialApp wired exactly as `app.dart`
/// wires it and assert an unrelated screen follows.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<ProviderContainer> container([
    Map<String, Object> initial = const {},
  ]) async {
    SharedPreferences.setMockInitialValues(initial);
    final prefs = await SharedPreferences.getInstance();
    final c = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        // The emergency card reads the patient's own practice number; a
        // practice with one, so the whole card is on screen in both themes.
        careContactProvider.overrideWith(
          (ref) async => const CareContact(
            practiceName: 'Salt Lake Diabetes Care',
            phone: '+913324001234',
          ),
        ),
      ],
    );
    addTearDown(c.dispose);
    return c;
  }

  /// Mirrors app.dart: both themes supplied, themeMode driven by the provider.
  Widget app(Widget home) => Consumer(
    builder:
        (context, ref, _) => MaterialApp(
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: ref.watch(themeControllerProvider),
          locale: const Locale('en'),
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: home),
        ),
  );

  Brightness brightnessOf(WidgetTester tester, Type screenType) {
    final ctx = tester.element(find.byType(screenType));
    return Theme.of(ctx).brightness;
  }

  testWidgets('switching the theme repaints a screen elsewhere in the app', (
    tester,
  ) async {
    final c = await container();
    // EmergencyCard stands in for "any other screen" — it lives in Chat and
    // knows nothing about the Profile control.
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: app(const EmergencyCard(content: 'Chest pain needs review.')),
      ),
    );
    await tester.pumpAndSettle();

    await c.read(themeControllerProvider.notifier).setMode(ThemeMode.dark);
    await tester.pumpAndSettle();
    expect(brightnessOf(tester, EmergencyCard), Brightness.dark);

    await c.read(themeControllerProvider.notifier).setMode(ThemeMode.light);
    await tester.pumpAndSettle();
    expect(brightnessOf(tester, EmergencyCard), Brightness.light);
  });

  testWidgets('the emergency card still renders in both themes', (
    tester,
  ) async {
    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      final c = await container();
      await c.read(themeControllerProvider.notifier).setMode(mode);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: app(const EmergencyCard(content: 'Chest pain needs review.')),
        ),
      );
      await tester.pumpAndSettle();

      // Safety-critical: the loudest element on the screen must survive a
      // theme it was not originally designed against.
      expect(
        find.text('Emergency'),
        findsOneWidget,
      );
      expect(find.text('Call clinic'), findsOneWidget);
      expect(tester.takeException(), isNull, reason: '$mode');
    }
  });

  testWidgets('tapping a segment changes the mode and the app follows', (
    tester,
  ) async {
    final c = await container();
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: app(const ThemeSelector()),
      ),
    );
    await tester.pumpAndSettle();
    expect(c.read(themeControllerProvider), ThemeMode.light);

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(c.read(themeControllerProvider), ThemeMode.dark);
    expect(brightnessOf(tester, ThemeSelector), Brightness.dark);

    await tester.tap(find.text('Light'));
    await tester.pumpAndSettle();
    expect(c.read(themeControllerProvider), ThemeMode.light);
    expect(brightnessOf(tester, ThemeSelector), Brightness.light);
  });

  testWidgets('all three segments are offered, not a binary toggle', (
    tester,
  ) async {
    final c = await container();
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: app(const ThemeSelector()),
      ),
    );
    await tester.pumpAndSettle();

    for (final label in ['Light', 'Dark', 'System']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
  });

  testWidgets('the appearance card matches the section cards, not a grey box', (
    tester,
  ) async {
    final c = await container();
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: app(const ThemeSelector()),
      ),
    );
    await tester.pumpAndSettle();

    // Regression guard: `surfaceContainerHighest` is a heavy mid-grey in
    // Material 3's light scheme and made this read as a muddy box against the
    // near-white page. It must use the same `surface` as the cards below it.
    final ctx = tester.element(find.byType(ThemeSelector));
    final scheme = Theme.of(ctx).colorScheme;
    final box = tester.widget<Container>(
      find
          .descendant(
            of: find.byType(ThemeSelector),
            matching: find.byType(Container),
          )
          .first,
    );
    expect((box.decoration! as BoxDecoration).color, scheme.surface);
  });

  testWidgets('the three segments share the width evenly', (tester) async {
    final c = await container();
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: app(const ThemeSelector()),
      ),
    );
    await tester.pumpAndSettle();

    // Measure the Expanded flex cells, not the pills: the pills differ by the
    // deliberate 3px inter-segment gap (the last has none), but the flex split
    // must be even.
    final widths =
        ['Light', 'Dark', 'System']
            .map(
              (l) =>
                  tester
                      .getSize(
                        find.ancestor(
                          of: find.text(l),
                          matching: find.byType(Expanded),
                        ),
                      )
                      .width,
            )
            .toList();
    for (final w in widths) {
      expect(
        (w - widths.first).abs() < 1.0,
        isTrue,
        reason: 'segments: $widths',
      );
    }
  });
}
