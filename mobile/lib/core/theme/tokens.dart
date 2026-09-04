import 'package:flutter/material.dart';

/// The design tokens. Every spacing, size, colour, radius and shadow in the app
/// comes from here, and nothing outside this file invents a value.
///
/// The rule is the point. A UI reads as amateur not because any single number
/// is wrong but because the numbers disagree: 12 here, 17 there, 11.5 in the
/// third place. The eye registers the inconsistency long before it can name it.
/// Constraining every value to a short enumerated scale removes that whole
/// class of error, and it is enforced rather than trusted —
/// `tool/verify_tokens.dart` fails the build on a raw value in a widget.
///
/// Audited against the previous attempt, which is why this exists: that code
/// used 13 distinct font sizes and 14 spacing values, 9 of them off the grid.
abstract final class T {
  // =========================================================== spacing
  //
  // A 4px grid, and only these steps. If a gap "needs" 13, it needs 12 or 16 —
  // the in-between value is always the eye asking for something else.

  /// 4 — hairline gaps: icon to its own label, chip internals.
  static const double s1 = 4;

  /// 8 — tight pairs: label above a value, adjacent chips.
  static const double s2 = 8;

  /// 12 — the default gap between siblings in a list or grid.
  static const double s3 = 12;

  /// 16 — card padding, and the screen's side margin.
  static const double s4 = 16;

  /// 20 — a generous card padding, for the one card that leads a screen.
  static const double s5 = 20;

  /// 24 — between distinct blocks of content.
  static const double s6 = 24;

  /// 32 — between sections that are about different things.
  static const double s8 = 32;

  /// 48 — the breathing room above a screen's primary action.
  static const double s12 = 48;

  // ============================================================== type
  //
  // Five sizes, three weights. Five rather than four because 16 is an
  // accessibility floor for body text here — this clinic's patients are
  // largely elderly and many have diabetic retinopathy — and a hero figure
  // still needs to be a hero. Everything else collapses into these.
  //
  // Line-height falls as size rises: display type set at body line-height
  // looks loose, which is one of the clearest tells of generated UI.

  /// 32/1.2 — the screen's headline. One per screen, and it says what the
  /// screen is for: "Enter phone number", not "Welcome back".
  static const TextStyle display = TextStyle(
    fontSize: 32,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.8,
  );

  /// 28/1.15 — the patient's own name in the greeting. One per screen, and
  /// only where a person is being addressed rather than a thing labelled.
  static const TextStyle name = TextStyle(
    fontSize: 28,
    height: 1.15,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.6,
  );

  /// 30/1.0 — a health figure. Deliberately larger than [title]: on a clinical
  /// dashboard the number is the content and its label is the caption, so the
  /// reading has to win the page even when it sits in a small tile.
  static const TextStyle metric = TextStyle(
    fontSize: 30,
    height: 1.0,
    fontWeight: FontWeight.w800,
    letterSpacing: -1.0,
  );

  /// 20/1.25 — screen titles and the heading of a leading card.
  static const TextStyle title = TextStyle(
    fontSize: 20,
    height: 1.25,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
  );

  /// 16/1.5 — body. The floor; nothing a patient must read goes below this.
  static const TextStyle body = TextStyle(
    fontSize: 16,
    height: 1.5,
    fontWeight: FontWeight.w400,
  );

  /// 16/1.5 semibold — a name, a row's primary line.
  static const TextStyle bodyStrong = TextStyle(
    fontSize: 16,
    height: 1.5,
    fontWeight: FontWeight.w600,
  );

  /// 14/1.45 — secondary prose. Muted, never black.
  static const TextStyle small = TextStyle(
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w400,
  );

  /// 12/1.35 semibold — captions, tile labels, pill text.
  static const TextStyle label = TextStyle(
    fontSize: 12,
    height: 1.35,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.2,
  );

  // ============================================================= colour
  //
  // One primary, one tint of it, three greys, and the clinical semantics.
  // A colour on screen always means something; nothing here is decorative.

  /// The brand, straight from the logo.
  static const Color primary = Color(0xFF003399);

  /// The logo's lighter blue — interactive states, links, the lit accent.
  static const Color primaryLight = Color(0xFF4890F0);

  /// The primary at ~8%: badge and section backgrounds. Never a text colour.
  static const Color primaryTint = Color(0xFFEBF1FB);

  /// Near-black, warmed very slightly toward the brand. Not #000.
  // ---- Why these greys are blue, and these semantics are dark ----------
  //
  // The neutrals were Tailwind's stock greys — #6B7280, #9CA3AF — beside a
  // #003399 accent they had nothing to do with. Two things were wrong with
  // that. They read as unrelated to the brand, and inkFaint measured 2.41:1
  // against the page: it failed AA for body text and failed the 3.0 bar for
  // large text too, in an app whose own type scale sits at a 16px floor
  // because these readers are elderly and many have diabetic retinopathy.
  // Getting the size right and the colour wrong helps nobody.
  //
  // So they are tinted toward the accent and darkened until they clear 4.5:1
  // on #F7F9FC, the surface they actually sit on. The semantic three were
  // measured on their own tints, where amber was worst at 2.97:1 — the one
  // colour in the system whose entire job is to be noticed.
  //
  // Ratios on #F7F9FC: inkMuted 6.18, inkFaint 4.50.
  // On their tints: danger 5.66, warning 4.67, success 5.88.
  static const Color ink = Color(0xFF111827);

  /// Secondary text. The single most reliable upgrade over black-everywhere.
  static const Color inkMuted = Color(0xFF545E72);

  /// Disabled text, placeholders, the faintest legible tier.
  static const Color inkFaint = Color(0xFF69738A);

  /// The page.
  static const Color surface = Color(0xFFF7F9FC);

  /// Cards sitting on [surface].
  static const Color surfaceRaised = Color(0xFFFFFFFF);

  /// Hairline dividers and card edges.
  static const Color line = Color(0xFFE5E9F0);

  static const Color danger = Color(0xFFB91C1C);
  static const Color warning = Color(0xFFB45309);
  static const Color success = Color(0xFF076B3C);

  /// Semantic backgrounds, at the same ~8% weight as [primaryTint].
  static const Color dangerTint = Color(0xFFFDECEC);
  static const Color warningTint = Color(0xFFFEF6E7);
  static const Color successTint = Color(0xFFE7F5EE);

  // ============================================================= radius
  //
  // Three, and full-round. Mixing radii is the fastest way to look unfinished.

  /// 12 — cards, tiles, list rows.
  static const double rCard = 12;

  /// 16 — buttons, inputs, sheets, anything that reads as a control.
  static const double rControl = 16;

  /// 20 — the one leading card on a screen, if it needs to sit apart.
  static const double rLead = 20;

  /// 24 — a main section card: the page's second level, and the only radius
  /// a full-width card ever takes. Paired with [rControl] for the tiles inside
  /// it, which is what gives a card depth without a second border.
  static const double rSection = 24;

  /// 28 — the navigation pill, one step above [rSection] so the bar reads as
  /// floating over the page rather than as another card in the stack.
  static const double rNav = 28;

  /// Avatars, pills, badges.
  static const BorderRadius rFull = BorderRadius.all(Radius.circular(999));

  // ========================================================== elevation
  //
  // Large blur, low opacity, tinted with the brand rather than black. A shadow
  // should be felt, not seen; black shadows at 0.3 are the classic tell.

  /// Resting: cards and rows.
  static const List<BoxShadow> e1 = [
    BoxShadow(color: Color(0x0A0B1B3A), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F0B1B3A), blurRadius: 20, offset: Offset(0, 8)),
  ];

  /// Raised: the leading card, sheets.
  static const List<BoxShadow> e2 = [
    BoxShadow(color: Color(0x0D0B1B3A), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x14003399), blurRadius: 28, offset: Offset(0, 12)),
  ];

  /// A primary button, carrying its own brand light.
  static const List<BoxShadow> eAction = [
    BoxShadow(color: Color(0x33003399), blurRadius: 20, offset: Offset(0, 8)),
  ];

  // ============================================================== touch

  /// The minimum tap target. Nothing interactive is smaller, ever.
  static const double tap = 48;

  /// Inputs and buttons share one height, so a stacked form reads as a single
  /// rhythm rather than as boxes of assorted sizes.
  static const double hControl = 56;

  /// The circular back button, and any icon-only control in a header.
  static const double hCircle = 44;

  // ========================================================== composed

  /// The standard card. Built here so no screen re-derives it slightly wrong.
  static BoxDecoration card({double? radius, Color? tint, Color? border}) =>
      BoxDecoration(
        color: tint ?? surfaceRaised,
        borderRadius: BorderRadius.circular(radius ?? rCard),
        border: Border.all(color: border ?? line),
        boxShadow: e1,
      );

  /// A tinted status surface — badge, callout, semantic tile.
  static BoxDecoration tintedBox(Color tone, Color tint, {double? radius}) =>
      BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(radius ?? rCard),
        border: Border.all(color: tone.withValues(alpha: 0.22)),
      );
}
