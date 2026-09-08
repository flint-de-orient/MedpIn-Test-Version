import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_spacing.dart';

/// Material 3 theme for MedPin.
///
/// Inter throughout. Both are
/// bundled in assets/fonts rather than fetched at runtime.
///
/// CAVEAT, and it is a real one: neither family ships Bengali or Devanagari
/// glyphs. Android falls back to Noto per-glyph, so bn/hi text still renders —
/// but it renders in a different face from the English around it, and that
/// fallback is the platform's promise, not ours. The clinician screens are
/// English-only so this is safe today; before the patient panel is restyled,
/// check a Bengali and a Hindi build on a real device rather than assuming.
class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    var colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: brightness,
      error: AppColors.danger,
    );

    // ---- The seed is not the colour ----------------------------------------
    //
    // `fromSeed` builds a tonal palette from #003399 and then picks a *tone*
    // from it, which in light mode is a desaturated slate — not the brand blue
    // it was seeded with. Everything reading `colorScheme.primary` came out
    // muted, and the way that showed up was a bottom sheet whose "Add to the
    // practice" button was visibly weaker than the "Send code" step above it.
    //
    // Both are FilledButtons. Send code sets `backgroundColor:
    // AppColors.primary` by hand and 76 other places do the same, which is how
    // this survived: the override is so common that the 41 bare buttons look
    // like the exception rather than the bug.
    //
    // The dark branch below already pins its own primary. This does the same
    // for light, so a bare FilledButton is the brand colour and the overrides
    // become redundant rather than load-bearing.
    if (brightness == Brightness.light) {
      colorScheme = colorScheme.copyWith(
        primary: AppColors.primary,
        onPrimary: Colors.white,
      );
    }

    // Material 3 derives every surface from the seed, so a saturated blue
    // primary washes the whole light theme faintly blue. Fine for a brand app,
    // wrong for a clinical one — the surfaces are pulled back to near-neutral
    // so the blue reads as deliberate accent rather than a tint over
    // everything.
    if (!isDark) {
      colorScheme = colorScheme.copyWith(
        surface: const Color(0xFFFBFCFD),
        surfaceContainerLowest: Colors.white,
        surfaceContainerLow: const Color(0xFFF7F9FB),
        surfaceContainer: const Color(0xFFF2F5F8),
        surfaceContainerHigh: const Color(0xFFEDF1F5),
        surfaceContainerHighest: const Color(0xFFE8EDF2),
        outlineVariant: const Color(0xFFDDE3EA),
        // Secondary text. fromSeed derives a blue-grey here, which reads
        // as a faded version of the brand rather than as neutral prose.
        // Matches T.inkMuted. Was #6B7280, which cleared AA on white by a
        // hair and not at all on the tinted surfaces it mostly sits on.
        onSurfaceVariant: const Color(0xFF545E72),
        onSurface: const Color(0xFF111827),
      );
    } else {
      // Dark mode used to be left entirely to fromSeed. From a seed this dark
      // M3 derives washed surfaces that do not match the scaffold colour set
      // below — which is why the app bar went dark while the chat thread
      // behind it stayed pale, and why cards on dark read as grey smudges
      // rather than as cards.
      //
      // The same neutral ladder as light mode, inverted: one step per level,
      // neutral rather than tinted, so the brand accent is the only colour on the
      // screen that is actually coloured.
      colorScheme = colorScheme.copyWith(
        primary: AppColors.primaryDark,
        onPrimary: const Color(0xFF001B3D),
        secondary: AppColors.accent,
        surface: AppColors.surfaceDark,
        onSurface: const Color(0xFFE6EDF3),
        surfaceContainerLowest: const Color(0xFF121A23),
        surfaceContainerLow: const Color(0xFF16202B),
        surfaceContainer: const Color(0xFF1B2631),
        surfaceContainerHigh: const Color(0xFF212D39),
        surfaceContainerHighest: const Color(0xFF283643),
        onSurfaceVariant: const Color(0xFFA3B2C0),
        outline: const Color(0xFF43525F),
        outlineVariant: const Color(0xFF2C3945),
      );
    }

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor:
          isDark ? AppColors.surfaceDark : AppColors.surfaceLight,
    );

    // One family, Inter, at every size. Two faces meant a heading and the
    // sentence under it were drawn by different hands, which on a phone-sized
    // card reads as inconsistency rather than as hierarchy — weight and size
    // do that job here, and do it without a second font file in the bundle.
    final inter = base.textTheme.apply(fontFamily: 'Inter');

    // Minimum body text 16sp, headings 20-28sp, high contrast.
    final textTheme = inter
        .copyWith(
          displayLarge: inter.displayLarge,
          displayMedium: inter.displayMedium,
          displaySmall: inter.displaySmall,
          headlineLarge: inter.headlineLarge?.copyWith(
            fontSize: 32,
            fontWeight: FontWeight.w700,
            height: 1.25,
          ),
          headlineMedium: inter.headlineMedium?.copyWith(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            height: 1.25,
          ),
          headlineSmall: inter.headlineSmall?.copyWith(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            height: 1.3,
          ),
          titleLarge: inter.titleLarge?.copyWith(
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
          titleMedium: inter.titleMedium?.copyWith(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
          titleSmall: inter.titleSmall?.copyWith(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
          // These four resize from `inter`, not from `base`, or they arrive
          // with no family at all and Android draws them in Roboto. It is a
          // quiet way to lose: a bare Text() resolves to bodyMedium and a
          // button label to labelLarge, so those two alone are most of the
          // words on screen — the headings would be Inter and the sentences
          // under them would not.
          bodyLarge: inter.bodyLarge?.copyWith(fontSize: 16, height: 1.4),
          bodyMedium: inter.bodyMedium?.copyWith(fontSize: 16, height: 1.4),
          bodySmall: inter.bodySmall?.copyWith(fontSize: 14, height: 1.35),
          labelLarge: inter.labelLarge?.copyWith(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        )
        .apply(
          bodyColor: colorScheme.onSurface,
          displayColor: colorScheme.onSurface,
        );

    return base.copyWith(
      textTheme: textTheme,

      // Selection you can see across the room.
      //
      // Material's default selected chip is a faint secondaryContainer tint,
      // which on a busy form is a change a hurried reader misses — and nine
      // screens here use a bare ChoiceChip, so every one of them inherited it.
      // Filled accent with white text instead, set once so a chip added
      // tomorrow is right without anyone remembering to style it.
      chipTheme: ChipThemeData(
        backgroundColor: colorScheme.surfaceContainerHighest.withValues(
          alpha: 0.5,
        ),
        selectedColor: colorScheme.primary,
        checkmarkColor: Colors.white,
        labelStyle: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: colorScheme.onSurface,
        ),
        secondaryLabelStyle: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
        side: BorderSide(
          color: colorScheme.outlineVariant.withValues(alpha: 0.6),
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor:
            isDark ? AppColors.surfaceDark : AppColors.surfaceLight,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        // Material 3 tints the bar as content scrolls under it, which shows as
        // a creeping blue wash on an otherwise white header. Held flat.
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: colorScheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        ),
        margin: EdgeInsets.zero,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          // Flat. A raised primary button under a Material 3 tint picks up a
          // grey wash on press that reads as a rendering fault.
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w600,
          ),
          side: BorderSide(color: colorScheme.outlineVariant, width: 1.4),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(
            AppSpacing.minTapTarget,
            AppSpacing.minTapTarget,
          ),
          textStyle: textTheme.labelLarge,
        ),
      ),
      // Selection was unthemed, so the handles took the raw seed colour and the
      // highlight was nearly the same shade as the text behind it — hard to see
      // what was selected, and harder to aim at a handle sitting on the field's
      // border. Brand-coloured handles over a light wash keep both readable.
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: AppColors.primary,
        selectionColor: AppColors.primary.withValues(alpha: 0.25),
        selectionHandleColor: AppColors.primary,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? colorScheme.surfaceContainerHigh : Colors.white,
        // Roomier fields — the old height read as cramped/narrow on the auth
        // screens. Taller with a touch more side padding.
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: BorderSide(color: colorScheme.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: BorderSide(color: colorScheme.error, width: 1.5),
        ),
        labelStyle: textTheme.bodyMedium,
        hintStyle: textTheme.bodyMedium?.copyWith(
          color: colorScheme.onSurfaceVariant,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        backgroundColor: isDark ? AppColors.surfaceDark : Colors.white,
        // A solid brand pill, as the design sheet draws it — not the tonal
        // primaryContainer, which under a deep-blue seed comes out muddy
        // against white. The icon inside inverts to white.
        indicatorColor:
            isDark
                ? AppColors.primaryDark.withValues(alpha: 0.24)
                : AppColors.primary,
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
        ),
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return textTheme.bodySmall?.copyWith(
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color:
                selected
                    ? (isDark ? AppColors.primaryDark : AppColors.primary)
                    : colorScheme.onSurfaceVariant,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 24,
            // White on the filled pill in light mode; on dark the pill is only
            // a wash, so the icon keeps the brand blue and stays legible.
            color:
                selected
                    ? (isDark ? AppColors.primaryDark : Colors.white)
                    : colorScheme.onSurfaceVariant,
          );
        }),
      ),
      // Sheets rise with a proper radius rather than square corners — the
      // attach picker and every confirm dialog inherit this.
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? AppColors.surfaceDark : Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: isDark ? AppColors.surfaceDark : Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      // Hairline rather than a visible rule: on a light clinical surface a
      // heavy divider reads as a seam between unrelated things.
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant.withValues(alpha: 0.8),
        space: 1,
        thickness: 1,
      ),
    );
  }
}
