import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/theme/tokens.dart';
import 'package:akd_care/core/theme/app_colors.dart';

/// Contrast, measured rather than eyeballed.
///
/// This exists because the palette shipped with `inkFaint` at 2.41:1 against
/// the surface it sits on. That fails AA for body text (4.5) and fails the
/// large-text bar (3.0) as well — in an app whose type scale is pinned to a
/// 16px floor precisely because its readers are elderly and many of them have
/// diabetic retinopathy. The size rule was written down and honoured; the
/// colour rule was neither.
///
/// A colour is easy to nudge back to something prettier and slightly too pale.
/// These numbers make that fail here instead of in a waiting room.

/// WCAG 2.1 relative luminance.
double _luminance(Color c) {
  double channel(double v) =>
      v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double contrast(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  final hi = math.max(la, lb);
  final lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  group('body text clears AA on the surfaces it actually sits on', () {
    // Both grounds, because the page is #F7F9FC and the cards on it are white.
    // A colour checked only against white passes and then fails in situ.
    final grounds = {'page #F7F9FC': T.surface, 'card #FFFFFF': T.surfaceRaised};

    for (final entry in grounds.entries) {
      test('ink on ${entry.key}', () {
        expect(contrast(T.ink, entry.value), greaterThanOrEqualTo(4.5));
      });

      test('inkMuted on ${entry.key}', () {
        // The second tier. If this fails, "de-emphasised" has quietly become
        // "unreadable" and the hierarchy stops working.
        expect(contrast(T.inkMuted, entry.value), greaterThanOrEqualTo(4.5));
      });

      test('inkFaint on ${entry.key}', () {
        // The one that shipped broken at 2.41:1.
        expect(contrast(T.inkFaint, entry.value), greaterThanOrEqualTo(4.5));
      });
    }
  });

  group('semantic colours are legible on their own tints', () {
    // Each of these is drawn as text on its matching tint — a warning chip, an
    // error note, a success line. Amber was the worst offender at 2.97:1,
    // which is the one colour in the system whose entire job is to be noticed.
    test('danger on dangerTint', () {
      expect(contrast(T.danger, T.dangerTint), greaterThanOrEqualTo(4.5));
    });

    test('warning on warningTint', () {
      expect(contrast(T.warning, T.warningTint), greaterThanOrEqualTo(4.5));
    });

    test('success on successTint', () {
      expect(contrast(T.success, T.successTint), greaterThanOrEqualTo(4.5));
    });
  });

  group('the accent works where it is used', () {
    test('primary on white', () {
      expect(contrast(T.primary, T.surfaceRaised), greaterThanOrEqualTo(4.5));
    });

    test('white on primary — the filled button', () {
      expect(contrast(Colors.white, T.primary), greaterThanOrEqualTo(4.5));
    });

    test('primary on its own tint', () {
      expect(contrast(T.primary, T.primaryTint), greaterThanOrEqualTo(4.5));
    });
  });

  group('the two palettes agree', () {
    // `AppColors` is the older system and still the one most screens import.
    // While both exist they must carry the same semantics, or a warning is one
    // amber in the doctor's panel and a different amber in the patient's.
    test('semantic colours match between AppColors and T', () {
      expect(AppColors.danger, T.danger);
      expect(AppColors.warning, T.warning);
      expect(AppColors.success, T.success);
    });
  });
}
