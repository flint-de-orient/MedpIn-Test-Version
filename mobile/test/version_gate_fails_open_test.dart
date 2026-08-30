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
    test('a failed check returns all clear', () {
      // A patient on a train with no signal, a server mid-restart, a malformed
      // response. None of those are reasons to block anyone.
      expect(
        RegExp(r'catch \(_\) \{\s*return _allClear;').hasMatch(gate),
        isTrue,
        reason: 'the network call must fail open',
      );
    });

    test('a build number nobody supplied blocks nobody', () {
      // The number is baked in with --dart-define at build time; absent, it is
      // 0. A forgotten flag switches the gate off rather than guessing, because
      // a forgotten flag must never become a locked door.
      expect(gate.contains('if (build <= 0) return _allClear;'), isTrue);
      expect(gate.contains("int.fromEnvironment('APP_BUILD')"), isTrue);
    });

    test('the build number is not read from the APK versionCode', () {
      // PackageInfo.buildNumber is the versionCode, and --split-per-abi adds an
      // ABI offset to it: build 8103 reports 10103 on arm64 and 9103 on
      // armeabi-v7a. Comparing either against a floor taken from pubspec is
      // meaningless — the same build answers differently per handset, so the
      // gate would never fire, or would lock out every 32-bit phone.
      // Checked against the code, not the prose: the comment above the constant
      // names PackageInfo precisely to explain why it is not used, and a test
      // that cannot tell an explanation from a call would fail on the sentence
      // documenting the fix.
      final code = gate
          .split('\n')
          .where((l) => !l.trimLeft().startsWith('//'))
          .join('\n');
      expect(code.contains('PackageInfo'), isFalse);
      expect(code.contains('package_info_plus'), isFalse);
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
      expect(app.contains('if (status == null || !status.mustUpdate)'), isTrue);
    });
  });

  group('the two states stay separate', () {
    final banner =
        File('lib/core/update/update_available_banner.dart').readAsStringSync();

    test('only mustUpdate reaches the wall', () {
      // Collapsing the two would make every release a forced one.
      expect(app.contains('status.mustUpdate'), isTrue);
      expect(
        app.contains('status.canUpdate'),
        isFalse,
        reason: 'app.dart decides only whether to block',
      );
    });

    test('canUpdate is rendered, not computed and dropped', () {
      // It was: the field existed, was calculated correctly, and nothing on
      // screen ever read it — so "a newer version is available" was a promise
      // the app had no way to keep.
      expect(banner.contains('status.canUpdate'), isTrue);
      expect(app.contains('UpdateAvailableBanner'), isTrue);
    });

    test('the banner floats over the app, never resizes it', () {
      // It was a Column — the card, then the app below it — which took a slice
      // off every screen for as long as it was up, and left the margins around
      // itself painting through to black because nothing owned that ground. A
      // Stack with the app as its first child leaves the page exactly as it
      // was and lets the app's own background show around the card.
      expect(banner.contains('return Stack('), isTrue);
      expect(
        banner.contains('Expanded(child: child)'),
        isFalse,
        reason: 'a Column here would shrink the screen underneath it',
      );
    });

    test('the banner never nags', () {
      // A card they can close, and closing it is remembered against the
      // version it was about — so waving away one release does not silence the
      // next.
      expect(banner.contains('dismissed >= status.latestBuild'), isTrue);
      expect(banner.contains('dismiss(status.latestBuild)'), isTrue);
    });

    test('the banner is silent until the server names a newer build', () {
      // canUpdate is false whenever latestBuild is 0, so a clinic that never
      // touches these settings never sees this.
      expect(gate.contains('latestBuild > 0 && build < latestBuild'), isTrue);
    });
  });
}
