import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/features/clinician/presentation/clinician_tabs.dart';

/// The bar's indices and the router's branch indices are different numbers.
///
/// `StatefulShellRoute.indexedStack` addresses branches by index and hiding one
/// does not renumber the rest, so a three-item bar has to map its own 0,1,2 onto
/// whichever branches those are. Getting it wrong means tapping Profile and
/// landing on Nutrition — which reads as a routing bug for a day before anybody
/// suspects arithmetic.
///
/// So the mapping is a pure function, and this is why it is one.
Capabilities _caps(
  Set<String> effective, {
  bool hasDietician = false,
  String? practiceType,
}) => Capabilities(
  practiceType: practiceType,
  specialty: null,
  plan: null,
  practice: effective,
  effective: effective,
  role: 'doctor',
  isOwner: false,
  resolved: true,
  hasDietician: hasDietician,
);

void main() {
  group('what the bar shows', () {
    test('everything, when the practice has everything', () {
      final visible = visibleBranches(_caps({Cap.aiAssistant}));
      expect(visible, [0, 1, 2, 3]);
    });

    test('no Nutrition when nothing can answer in it', () {
      final visible = visibleBranches(_caps({}));
      expect(visible, [0, 1, 3]);
    });

    // Two things can answer in a nutrition conversation and either is enough.
    // Gating on the capability alone hid the tab from a practice that had hired
    // somebody to work in it.
    test('an assistant and no dietician shows it', () {
      expect(visibleBranches(_caps({Cap.aiAssistant})), contains(2));
    });

    test('a dietician and no assistant shows it', () {
      expect(
        visibleBranches(_caps({}, hasDietician: true)),
        contains(2),
      );
    });

    test('neither hides it', () {
      expect(visibleBranches(_caps({}, hasDietician: false)), isNot(contains(2)));
    });

    test('a diagnostic centre with a dietician shows it', () {
      // The case that made this wrong. A diagnostic centre has no AI_ASSISTANT
      // by type, and /team lets it hire a dietician anyway — so it had a
      // nutrition stream with no way to look at it.
      expect(
        visibleBranches(
          _caps({}, hasDietician: true, practiceType: 'diagnostic_centre'),
        ),
        contains(2),
      );
    });

    test('and one without keeps it hidden', () {
      expect(
        visibleBranches(_caps({}, practiceType: 'diagnostic_centre')),
        isNot(contains(2)),
      );
    });

    test('Home, Care and Profile are never hidden', () {
      // Whatever else goes, these three are the app. A bar that can empty
      // itself is a bar somebody can be stranded in.
      for (final caps in [_caps({}), _caps({Cap.aiAssistant})]) {
        final visible = visibleBranches(caps);
        expect(visible, containsAll(<int>[0, 1, 3]));
        expect(visible, isNotEmpty);
      }
    });

    test('and the unknown default shows everything', () {
      // Before the first answer arrives. Hiding a tab and putting it back a
      // moment later is worse than showing one that turns out to be empty.
      expect(visibleBranches(Capabilities.unknown), [0, 1, 2, 3]);
    });
  });

  group('the two directions agree', () {
    test('every visible branch maps back to its own position', () {
      for (final caps in [
        _caps({}),
        _caps({Cap.aiAssistant}),
        _caps({}, hasDietician: true),
      ]) {
        final visible = visibleBranches(caps);
        for (var i = 0; i < visible.length; i++) {
          // Tapping bar item i goes to visible[i]; that branch must report
          // itself as item i, or the selection lands somewhere else.
          expect(barIndexFor(visible, visible[i]), i);
        }
      }
    });

    test('a hidden branch has no position, rather than position zero', () {
      // The failure this prevents: -1 range-checked into 0 by the bar, so
      // somebody standing on Nutrition sees Home with Nutrition highlighted.
      final visible = visibleBranches(_caps({}));
      expect(barIndexFor(visible, 2), isNull);
    });

    test('Profile keeps its position when Nutrition goes', () {
      // The whole reason for the mapping. Branch 3 is still branch 3; it is
      // item 2 in a three-item bar and item 3 in a four-item one.
      expect(barIndexFor(visibleBranches(_caps({})), 3), 2);
      expect(barIndexFor(visibleBranches(_caps({Cap.aiAssistant})), 3), 3);
    });
  });
}
