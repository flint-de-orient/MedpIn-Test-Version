import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The version check must never lock somebody out by accident, and must never
/// claim to know something it does not.
///
/// It exists because /scan changed shape: an older client photographs a
/// prescription, gets a preview it cannot read, and shows the patient nothing
/// at all — no error and no clue. Being told to update is better than a feature
/// that silently does nothing.
///
/// But a gate is a lock, and a lock on a patient's own medicines has to be
/// harder to close by accident than to leave open. These assert that directly
/// rather than trusting nobody will tighten a comparison later.
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
      // Baked in with --dart-define at build time; absent, it is 0. A forgotten
      // flag switches the gate off rather than guessing, because a forgotten
      // flag must never become a locked door.
      expect(gate.contains('if (build <= 0) return _allClear;'), isTrue);
      expect(gate.contains("int.fromEnvironment('APP_BUILD')"), isTrue);
    });

    test('the build number is not read from the APK versionCode', () {
      // PackageInfo.buildNumber is the versionCode, and --split-per-abi adds an
      // ABI offset: build 8103 reports 10103 on arm64 and 9103 on armeabi-v7a.
      // Comparing either against a floor from pubspec is meaningless — the same
      // build answers differently per handset, so the gate would never fire, or
      // would lock out every 32-bit phone.
      //
      // Checked against the code, not the prose: the comment above the constant
      // names PackageInfo precisely to explain why it is not used.
      final code = gate
          .split('\n')
          .where((l) => !l.trimLeft().startsWith('//'))
          .join('\n');
      expect(code.contains('PackageInfo'), isFalse);
      expect(code.contains('package_info_plus'), isFalse);
    });

    test('an unconfigured server blocks nobody', () {
      // minBuild defaults to 0 on the server; the client must read 0 as "no
      // floor set" rather than "everything is below the floor".
      expect(gate.contains('minBuild > 0 && build < minBuild'), isTrue);
    });

    test('being exactly at the floor is allowed', () {
      // The floor is the oldest build that still works, not the oldest that is
      // unwelcome. `<=` would lock out the very build just shipped.
      expect(gate.contains('build < minBuild'), isTrue);
      expect(gate.contains('build <= minBuild'), isFalse);
    });

    test('a slow or failed check shows the app, not the wall', () {
      // valueOrNull, so loading and error both mean carry on. A wall appearing
      // on every cold start while the network answers would be worse than the
      // bug it guards against.
      expect(app.contains('ref.watch(versionStatusProvider).valueOrNull'), isTrue);
      expect(app.contains('if (status == null || !status.mustUpdate)'), isTrue);
    });
  });

  group('being told about an update, without being interrupted by it', () {
    final section =
        File('lib/core/update/app_section.dart').readAsStringSync();
    final prompt = File('lib/core/update/update_prompt.dart').readAsStringSync();
    final shell =
        File('lib/features/shell/presentation/app_shell.dart').readAsStringSync();

    test('only mustUpdate reaches the wall', () {
      // Collapsing the two states would make every release a forced one.
      expect(app.contains('status.mustUpdate'), isTrue);
    });

    test('canUpdate is rendered, not computed and dropped', () {
      // It was exactly that once: the field existed, was calculated correctly,
      // and nothing on screen ever read it — so "a newer version is available"
      // was a promise the app had no way to keep. Three surfaces read it now.
      expect(section.contains('canUpdate'), isTrue);
      expect(prompt.contains('canUpdate'), isTrue);
      expect(app.contains('status.canUpdate'), isTrue);
    });

    test('the dialog asks once per version and never again', () {
      // A dialog on every launch is one people learn to dismiss without
      // reading, and the next one might be the one that mattered.
      expect(
        prompt.contains('promptedBuildProvider) >= status.latestBuild'),
        isTrue,
      );
      expect(prompt.contains('markShown(status.latestBuild)'), isTrue);
    });

    test('the ask is recorded before the dialog opens, not after', () {
      // Killed with the dialog up, the reader has still been asked. Being asked
      // twice about one version is the thing this prevents.
      final marked = prompt.indexOf('markShown(status.latestBuild)');
      final shown = prompt.indexOf('showDialog');
      expect(marked, greaterThan(-1));
      expect(shown, greaterThan(-1));
      expect(marked, lessThan(shown));
    });

    test('the tab mark is derived, never stored', () {
      // "Later" postpones being asked; it does not pretend the update went
      // away. The dot clears when the app is genuinely updated and not before,
      // so it cannot be dismissed into silence — which is the whole difference
      // between it and the dialog.
      expect(shell.contains('showDot: updateAvailable'), isTrue);
      // Against the code, not the prose — the comment beside it says the word
      // "dismissed" precisely to explain that nothing here does that, and a
      // test unable to tell an explanation from a call fails on its own
      // documentation. That has now caught me twice.
      final shellCode = shell
          .split('\n')
          .where((l) => !l.trimLeft().startsWith('//'))
          .join('\n');
      expect(
        shellCode.contains('dismiss'),
        isFalse,
        reason: 'nothing may switch the mark off except installing the update',
      );
      expect(
        shellCode.contains('canUpdate'),
        isTrue,
        reason: 'the mark is read from the live answer, not from storage',
      );
    });

    test('the section never claims you are current on a check that failed', () {
      // Offline, a server mid-restart, or a clinic that never set the numbers —
      // none of those are evidence that this build is the newest, and saying so
      // would be a reassurance the app has not earned.
      expect(section.contains('latestBuild > 0'), isTrue);
    });
  });
}
