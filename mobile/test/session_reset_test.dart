import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/session/session_reset.dart';

/// One patient's data must not survive into another patient's session.
///
/// Signing out and signing in as somebody else left the doctor thread showing
/// the previous patient's conversation and the Medicines tab showing their
/// doses. Neither login nor logout invalidated anything, and `autoDispose` did
/// not save it: the shells are indexedStack, every visited tab stays mounted,
/// and a provider inside a mounted tab is still watched — so it never disposes
/// and simply holds what it last fetched.
///
/// These test the mechanism directly rather than through a signed-in app,
/// because what has to hold is a property of the container, not of any one
/// screen: *everything* goes except a named few.
void main() {
  // Build counters, because "was it cleared?" is not readable from the value.
  // Riverpod deliberately retains the previous value while a provider reloads
  // so the UI does not flash — so hasValue stays true either way. What proves
  // the leak is closed is that the provider RECOMPUTES: the next answer is
  // fetched for the new session rather than served from the old one.
  var builds = 0;
  var keyedBuilds = 0;

  final patientData = FutureProvider<String>((ref) async {
    builds += 1;
    return 'patient data $builds';
  });
  final keyedData = FutureProvider.family<String, String>((ref, id) async {
    keyedBuilds += 1;
    return 'data for $id';
  });

  test('cached patient data is refetched after a session change', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    registerSessionContainer(container);
    builds = 0;

    await container.read(patientData.future);
    expect(builds, 1);
    // Read again: served from cache, which is exactly the behaviour that
    // handed the next patient the previous one's data.
    await container.read(patientData.future);
    expect(builds, 1, reason: 'a second read should be cached');

    resetSessionState();

    await container.read(patientData.future);
    expect(
      builds,
      2,
      reason: 'the answer from the previous session was served again',
    );
  });

  test('a keyed provider is cleared for every key, not just one', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    registerSessionContainer(container);
    keyedBuilds = 0;

    // A family keyed by patient id is the exact shape of the leak: the stale
    // key IS the previous patient.
    await container.read(keyedData('patient-A').future);
    await container.read(keyedData('patient-B').future);
    expect(keyedBuilds, 2);

    resetSessionState();

    await container.read(keyedData('patient-A').future);
    await container.read(keyedData('patient-B').future);
    expect(
      keyedBuilds,
      4,
      reason: 'invalidating the family must clear every key',
    );
  });

  test('it does nothing when no container has been registered', () {
    // A test binding, or an early call during startup. Silence beats a throw:
    // there is nothing cached to leak yet.
    registerSessionContainer(ProviderContainer()..dispose());
    expect(resetSessionState, returnsNormally);
  });

  test('no provider holding patient data is on the keep-list', () {
    // The keep-list is the one way this fix can be defeated: add a provider to
    // it and that provider holds a patient's data across a sign-out, silently,
    // with every other guard still green. So the list is checked for the shape
    // of a data provider rather than trusted to stay short.
    final src = File('lib/core/session/session_reset.dart').readAsStringSync();
    final block = src.substring(
      src.indexOf('const _keep'),
      src.indexOf('};', src.indexOf('const _keep')),
    );
    // Only the quoted entries. The comments around them legitimately say
    // "patient" — they explain what must not be kept.
    final keep = RegExp(
      "'([A-Za-z]+)'",
    ).allMatches(block).map((m) => m.group(1)!.toLowerCase()).join(' ');

    for (final clinical in [
      'careSummary',
      'medication',
      'chat',
      'patient',
      'dose',
      'appointment',
      'prescription',
      'alert',
      'diet',
      'overview',
    ]) {
      expect(
        keep.contains(clinical),
        isFalse,
        reason:
            '"$clinical" is on the keep-list — it would survive a sign-out '
            'and be shown to the next person to use this handset',
      );
    }
  });
}
