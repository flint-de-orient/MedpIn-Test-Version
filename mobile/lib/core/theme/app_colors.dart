import 'package:flutter/material.dart';

/// Brand and clinical-status colours. Kept as a single source of truth so
/// glucose flags, alert severities, etc. always render consistently.
class AppColors {
  AppColors._();

  // "Clinical Precision". Deep institutional blue rather than the previous
  // forest green: blue is what a clinician reads as medical record software,
  // and #003399 is dark enough to carry white text on a filled button without
  // needing a second, darker tone underneath it.
  static const Color primary = Color(0xFF003399);

  /// The brand blue's counterpart on dark surfaces, where #003399 sinks into
  /// the background. Also the secondary accent in the palette.
  static const Color primaryDark = Color(0xFF4DA3FF);

  /// Secondary — the lighter blue. Selected nav, links, quiet emphasis.
  static const Color accent = Color(0xFF4DA3FF);

  /// Tertiary — the palest blue wash. Behind selected chips, badges and
  /// informational panels. Light enough to sit under dark text.
  static const Color accentSoft = Color(0xFFF0F7FF);

  /// Neutral paper. A clinical screen read all day is not a coloured wash, so
  /// the light surface stays near-white with only a trace of the brand's cool.
  static const Color surfaceLight = Color(0xFFF7F9FC);

  /// Neutral #1A1C1E from the palette — the ink, reused as the dark ground.
  static const Color surfaceDark = Color(0xFF141719);

  static const Color danger = Color(0xFFB91C1C);
  static const Color warning = Color(0xFFB45309);
  static const Color success = Color(0xFF076B3C);

  static const Color dangerBg = Color(0xFFFDE8E8);
  static const Color warningBg = Color(0xFFFEF3C7);
  static const Color successBg = Color(0xFFE3F5EC);

  /// The tinted panel behind informational rows and tags — the tertiary blue,
  /// quieter than the alert tints so a red row still reads as the exception on
  /// a screen full of cards.
  static const Color infoBg = Color(0xFFF0F7FF);

  static const Color dangerBgDark = Color(0xFF3F1414);
  static const Color warningBgDark = Color(0xFF3A2A0A);
  static const Color successBgDark = Color(0xFF0C2A1E);
  static const Color infoBgDark = Color(0xFF13203A);

  /// Status colours lightened for dark surfaces. The saturated light-mode reds
  /// and ambers sit at roughly 3:1 against a near-black card — legible as a
  /// blob of colour, not as text. These carry the same meaning at a contrast
  /// you can actually read a number in.
  static const Color dangerLight = Color(0xFFF87171);
  static const Color warningLight = Color(0xFFFBBF24);
  static const Color successLight = Color(0xFF34D399);

  /// Mint fill's dark counterpart. Not a fixed colour but a wash of the bright
  /// green, so it sits on whatever surface it lands on instead of punching a
  /// pale hole in a dark card.
  static Color get accentSoftDark => primaryDark.withValues(alpha: 0.16);

  // ---- Theme-aware accessors ---------------------------------------------
  //
  // Every tint above exists in both brightnesses, but nothing chose between
  // them: screens referenced the light constants directly, so dark mode kept
  // rendering pale pastel panels with light text on them — unreadable, and the
  // reason the app stopped looking finished the moment the phone went dark.
  //
  // Use these anywhere a colour is drawn, and the light constants only when
  // building the theme itself.

  static bool isDark(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark;

  /// The brand green, legible on whichever surface it is drawn on. The deep
  /// forest green disappears into a dark background; [primaryDark] is its
  /// counterpart, and this picks between them.
  static Color accentOn(BuildContext context) =>
      isDark(context) ? primaryDark : primary;

  static Color accentSoftOn(BuildContext context) =>
      isDark(context) ? accentSoftDark : accentSoft;

  static Color dangerOn(BuildContext context) =>
      isDark(context) ? dangerLight : danger;
  static Color warningOn(BuildContext context) =>
      isDark(context) ? warningLight : warning;
  static Color successOn(BuildContext context) =>
      isDark(context) ? successLight : success;

  static Color dangerBgOn(BuildContext context) =>
      isDark(context) ? dangerBgDark : dangerBg;
  static Color warningBgOn(BuildContext context) =>
      isDark(context) ? warningBgDark : warningBg;
  static Color successBgOn(BuildContext context) =>
      isDark(context) ? successBgDark : successBg;
  static Color infoBgOn(BuildContext context) =>
      isDark(context) ? infoBgDark : infoBg;

  /// Glucose flag and triage urgency, in the current brightness. The plain
  /// [forGlucoseFlag] / [forUrgency] stay for the theme and for places that
  /// genuinely have no context.
  static Color forGlucoseFlagOn(BuildContext context, String flag) =>
      _lighten(context, forGlucoseFlag(flag));

  static Color forUrgencyOn(BuildContext context, String urgency) =>
      _lighten(context, forUrgency(urgency));

  /// The sender's own bubble. Lifted off the deep forest green on dark: at
  /// #064E3B against a #0F1720 thread the bubble barely separates from the
  /// wallpaper, so your own messages stop reading as a column.
  static Color bubbleMine(BuildContext context) =>
      isDark(context) ? const Color(0xFF0C5C46) : primary;

  /// A clinician's reply — tinted rather than grey, so the doctor's own words
  /// carry more weight than the assistant's. The light-mode 10% wash of a
  /// near-black green is invisible on a dark surface, so dark tints with the
  /// bright green instead.
  static Color bubbleClinician(BuildContext context) =>
      isDark(context)
          ? primaryDark.withValues(alpha: 0.18)
          : primary.withValues(alpha: 0.10);

  /// Maps a light-mode brand or status colour to its dark-mode counterpart.
  ///
  /// For colours that arrive as plain constants — from a top-level `const`
  /// table, or a model field — and so cannot pick their own brightness at the
  /// point they are declared. Call it where the colour is drawn.
  static Color toneOn(BuildContext context, Color c) => _lighten(context, c);

  static Color _lighten(BuildContext context, Color c) {
    if (!isDark(context)) return c;
    if (c == danger) return dangerLight;
    if (c == warning) return warningLight;
    if (c == success) return successLight;
    if (c == primary) return primaryDark;
    // The two one-off band colours: the "needs attention" orange and the
    // "unknown band" grey, both of which sit too close to a dark card to read.
    if (c == const Color(0xFFEA580C)) return const Color(0xFFFB923C);
    if (c == const Color(0xFF6B7280)) return const Color(0xFF9CA3AF);
    return c;
  }

  /// Glucose reading flag → colour, per contract flags:
  /// severe_low, low, in_range, very_high, critical_high.
  static Color forGlucoseFlag(String flag) {
    switch (flag) {
      case 'severe_low':
      case 'critical_high':
        return danger;
      case 'low':
      case 'very_high':
        return warning;
      case 'in_range':
        return success;
      default:
        return success;
    }
  }

  /// Triage / alert urgency ladder: routine < advice < urgent < emergency.
  static Color forUrgency(String urgency) {
    switch (urgency) {
      case 'emergency':
        return danger;
      case 'urgent':
        return warning;
      case 'advice':
        return primary;
      case 'routine':
      default:
        return success;
    }
  }
}
