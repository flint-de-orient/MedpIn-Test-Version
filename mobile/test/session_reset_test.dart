import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/session/session_reset.dart';

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

  test('a kept provider actually survives — and the rest do not', () {
    // The failure this exists for. The first keep-list matched on
    // `provider.name`, which is null unless a provider is explicitly named and
    // none of this app's are. So it matched nothing, every sign-in invalidated
    // the auth controller with everything else, the session reset to "unknown",
    // and the app sat on the splash screen spinning — with no error anywhere,
    // because nothing had failed except that the answer kept being discarded.
    //
    // The old tests all passed through that, because they only ever checked
    // that things WERE cleared.
    var keptBuilds = 0;
    var otherBuilds = 0;
    final kept = Provider<int>((ref) => ++keptBuilds);
    final other = Provider<int>((ref) => ++otherBuilds);

    final container = ProviderContainer();
    addTearDown(container.dispose);
    registerSessionContainer(container, keep: {kept});

    container.read(kept);
    container.read(other);
    expect(keptBuilds, 1);
    expect(otherBuilds, 1);

    resetSessionState();

    container.read(kept);
    container.read(other);
    expect(
      keptBuilds,
      1,
      reason:
          'the keep-list did not protect it — this is the splash-screen hang',
    );
    expect(otherBuilds, 2, reason: 'everything else must still be cleared');
  });

  test('an empty keep-list clears everything', () {
    // The default. Nothing is implicitly protected: a provider is kept because
    // main() named it, never because it happened to look infrastructural.
    var builds = 0;
    final p = Provider<int>((ref) => ++builds);

    final container = ProviderContainer();
    addTearDown(container.dispose);
    registerSessionContainer(container);

    container.read(p);
    resetSessionState();
    container.read(p);
    expect(builds, 2);
  });

  test('keeping a provider is useless unless its dependencies are kept', () {
    // The bug this exists for, and the one the earlier tests could not see
    // because none of them had a provider that WATCHED another.
    //
    // authControllerProvider was on the keep-list; authRepositoryProvider,
    // which it watches, was not. Invalidating the repository rebuilt the
    // controller anyway — from inside the sign-in that had called the reset —
    // so the controller was disposed mid-flight and the state went back to
    // "unknown". The app sat on its splash screen with nothing in the logs.
    var depBuilds = 0;
    var dependentBuilds = 0;
    final dependency = Provider<int>((ref) => ++depBuilds);
    final dependent = Provider<int>((ref) {
      ref.watch(dependency);
      return ++dependentBuilds;
    });

    final container = ProviderContainer();
    addTearDown(container.dispose);
    // Only the dependent is kept — the mistake, reproduced.
    registerSessionContainer(container, keep: {dependent});

    container.read(dependent);
    expect(dependentBuilds, 1);

    resetSessionState();
    container.read(dependent);

    expect(
      dependentBuilds,
      2,
      reason:
          'the dependent rebuilt even though it was kept — its dependency was '
          'invalidated, which is exactly the splash-screen loop',
    );
  });

  test('the app keeps the whole auth chain, not just the controller', () {
    // Read as source. The closure is the property that matters and it is not
    // visible from any one line: main() must keep the auth controller AND the
    // repository it watches AND the client and store beneath that.
    final src = File('lib/main.dart').readAsStringSync();
    final keep = src.substring(
      src.indexOf('keep: {'),
      src.indexOf('},', src.indexOf('keep: {')),
    );
    for (final p in [
      'authControllerProvider',
      'authRepositoryProvider',
      'apiClientProvider',
      'secureStoreProvider',
      'sharedPreferencesProvider',
    ]) {
      expect(
        keep.contains(p),
        isTrue,
        reason: '$p is missing — the chain above it will rebuild mid-sign-in',
      );
    }
  });
}
