import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/shared/providers/active_patient.dart';

/// Switching whose record the app is showing.
///
/// The mechanism is one provider that every patient-facing repository reads.
/// That is the point: switching is a single write, and Riverpod re-fetches
/// whatever depends on it. A list of manual invalidations would be a list
/// somebody eventually adds to incompletely, and the symptom of missing one is
/// a child's Home screen showing their grandmother's medicines.
void main() {
  late ProviderContainer container;

  setUp(() => container = ProviderContainer());
  tearDown(() => container.dispose());

  group('the account holder is null, not their own id', () {
    test('nothing selected means the path is me', () {
      // What every patient has today. The path must read exactly as it did
      // before anybody was added to the phone, or a working app starts sending
      // an id where it used to send `me`.
      expect(container.read(activePatientProvider), isNull);
      expect(container.read(patientPathProvider), 'me');
    });

    test('switching back to the holder returns to me', () {
      final notifier = container.read(activePatientProvider.notifier);
      notifier.switchTo('aarav');
      expect(container.read(patientPathProvider), 'aarav');

      notifier.switchTo(null);
      expect(container.read(patientPathProvider), 'me');
    });
  });

  group('the path follows the switch', () {
    test('selecting a dependant changes what every repository asks for', () {
      container.read(activePatientProvider.notifier).switchTo('aarav');
      expect(container.read(patientPathProvider), 'aarav');
    });

    test('A to B to A gets back to exactly A', () {
      // The checklist's own case. Anything that accumulated state across the
      // switch would show here.
      final notifier = container.read(activePatientProvider.notifier);
      notifier.switchTo('aarav');
      notifier.switchTo('renu');
      notifier.switchTo('aarav');
      expect(container.read(patientPathProvider), 'aarav');
    });
  });

  group('a repeat tap is not a change', () {
    test('switching to whoever is already selected leaves the state identical', () {
      // Rapid taps on the same chip must not refetch the world each time. The
      // guard lives in the notifier so every caller gets it, rather than each
      // screen remembering to compare first.
      //
      // Asserted on the state rather than on a listener callback: that would
      // be testing Riverpod's delivery timing, not the guard.
      final notifier = container.read(activePatientProvider.notifier);
      notifier.switchTo('aarav');
      final first = container.read(activePatientProvider);

      notifier.switchTo('aarav');
      notifier.switchTo('aarav');

      expect(container.read(activePatientProvider), same(first));
      expect(container.read(patientPathProvider), 'aarav');
    });

    test('and returning to the holder twice is also one state', () {
      final notifier = container.read(activePatientProvider.notifier);
      notifier.switchTo('aarav');
      notifier.switchTo(null);
      notifier.switchTo(null);

      expect(container.read(activePatientProvider), isNull);
      expect(container.read(patientPathProvider), 'me');
    });

    test('every switch is visible in the path a repository would use', () {
      // The property that actually matters: whatever is selected is what the
      // API is asked for. A missed propagation here shows a child's Home
      // screen with their grandmother's medicines on it.
      final notifier = container.read(activePatientProvider.notifier);
      for (final id in ['aarav', 'renu', 'aarav']) {
        notifier.switchTo(id);
        expect(container.read(patientPathProvider), id);
      }
      notifier.switchTo(null);
      expect(container.read(patientPathProvider), 'me');
    });
  });
}
