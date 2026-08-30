import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The version gate must never lock somebody out by accident.
///
/// It exists for a real problem: the prescription scan changed shape, so a
/// client from before that change photographs a prescription, reads an empty
/// list and shows the patient nothing at all — no error, no clue. Being told to
/// update beats a feature that silently does nothing.
///
/// But a gate is a lock, and this one sits in front of somebody's medicines. It
/// has to be much harder to close by accident than to leave open, so the
/// properties below are asserted against the source rather than left to
/// custom. Each one is a way the gate could do more harm than the bug it
/// catches.
void main() {
  final gate = File('lib/core/update/version_gate.dart').readAsStringSync();
  final app = File('lib/app.dart').readAsStringSync();

  group('the version gate fails open', () {
    test('every failure path returns all clear', () {
      // A patient on a train with no signal, a server mid-restart, a malformed
      // response. None of those are reasons to block anyone.
      final catches = RegExp(r'catch \(_\) \{\s*return _allClear;').allMatches(gate);
      expect(
        catches.length,
        greaterThanOrEqualTo(2),
        reason: 'both the package-info read and the network call must fail open',
      );
    });

    test('an unreadable build number blocks nobody', () {
      // A build number we could not parse is a comparison we cannot trust, and
      // an untrustworthy comparison must not be the thing that locks a door.
      expect(gate.contains('if (build <= 0) return _allClear;'), isTrue);
    });

    test('an unconfigured server blocks nobody', () {
      // minBuild defaults to 0 on the server; the client must treat 0 as "no
      // floor set" rather than as "everything is below the floor".
      expect(gate.contains('minBuild > 0 && build < minBuild'), isTrue);
    });

    test('being exactly at the floor is allowed', () {
      // The floor is the oldest build that still works, not the oldest that is
      // unwelcome. `<=` here would lock out the very build just shipped.
      expect(gate.contains('build < minBuild'), isTrue);
      expect(gate.contains('build <= minBuild'), isFalse);
    });

    test('a slow or failed check shows the app, not the wall', () {
      // valueOrNull, so loading and error both mean carry on. A wall that
      // appears on every cold start while the network answers would be worse
      // than the bug it guards against.
      expect(app.contains('ref.watch(versionStatusProvider).valueOrNull'), isTrue);
      expect(
        app.contains('if (status == null || !status.mustUpdate) return child;'),
        isTrue,
      );
    });
  });

  group('the two states stay separate', () {
    test('"could update" never blocks', () {
      // canUpdate is a suggestion. Only mustUpdate reaches the wall, and
      // collapsing the two would make every release a forced one.
      expect(app.contains('status.mustUpdate'), isTrue);
      expect(app.contains('status.canUpdate'), isFalse);
    });
  });
}
