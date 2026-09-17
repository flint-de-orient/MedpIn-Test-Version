import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/features/clinician/presentation/clinician_tabs.dart';

/// The bar's indices and the router's branch indices are different numbers.
///
/// `StatefulShellRoute.indexedStack` addresses branches by index and hiding one
/// does not renumber the rest, so a three-item bar has to map its own 0,1,2
/// onto whichever branches those are. Getting it wrong means tapping More and
/// landing on Today — which reads as a routing bug for a day before anybody
/// suspects arithmetic.
Capabilities _caps({
  List<String>? widgets,
  Set<String> permissions = const {Perm.viewPatient, Perm.editRecord},
  String role = 'doctor',
}) => Capabilities(
  practiceType: 'clinic',
  specialty: null,
  plan: null,
  practice: const {},
  effective: const {},
  role: role,
  isOwner: false,
  resolved: true,
  permissions: permissions,
  ui: widgets == null
      ? null
      : DashboardConfig(widgets: widgets, quickActions: const []),
);

void main() {
  group('what the bar shows', () {
    test('a doctor: Home, Today, Patients, More', () {
      expect(
        visibleBranches(_caps(widgets: const ['TODAYS_CLINIC', 'TRIAGE_QUEUE'])),
        [homeBranch, todayBranch, patientsBranch, moreBranch],
      );
    });

    test('before the answer arrives, everything', () {
      // Hiding a tab and putting it back a moment later is worse than showing
      // one that turns out to be empty.
      expect(visibleBranches(Capabilities.unknown), [0, 1, 2, 3]);
    });

    test('the bench has no day on its home, so no Today tab', () {
      expect(
        visibleBranches(_caps(widgets: const ['CRITICAL_LAB_RESULTS', 'RECENT_LAB_REPORTS'], role: 'lab_technician')),
        [homeBranch, patientsBranch, moreBranch],
      );
    });

    test('a practice manager reads no patients, so no Patients tab and no Today', () {
      // The roll refused them with an error; a tab that can only fail is not a
      // tab.
      expect(
        visibleBranches(
          _caps(
            widgets: const ['ANALYTICS_SUMMARY'],
            permissions: const {Perm.manageStaff, Perm.manageDepartment},
            role: 'practice_manager',
          ),
        ),
        [homeBranch, moreBranch],
      );
    });

    test('Home and More are never hidden', () {
      for (final caps in [
        _caps(widgets: const []),
        _caps(widgets: const [], permissions: const {}),
        Capabilities.unknown,
      ]) {
        expect(visibleBranches(caps), containsAll(<int>[homeBranch, moreBranch]));
      }
    });
  });

  group('the two directions agree', () {
    test('every visible branch maps back to its own position', () {
      for (final caps in [
        _caps(widgets: const ['TODAYS_CLINIC']),
        _caps(widgets: const ['CRITICAL_LAB_RESULTS']),
        _caps(widgets: const [], permissions: const {}),
      ]) {
        final visible = visibleBranches(caps);
        for (var i = 0; i < visible.length; i++) {
          expect(barIndexFor(visible, visible[i]), i);
        }
      }
    });

    test('a hidden branch has no position, rather than position zero', () {
      final visible = visibleBranches(_caps(widgets: const ['CRITICAL_LAB_RESULTS']));
      expect(barIndexFor(visible, todayBranch), isNull);
    });

    test('More keeps its branch when Today goes', () {
      expect(barIndexFor(visibleBranches(_caps(widgets: const ['CRITICAL_LAB_RESULTS'])), moreBranch), 2);
      expect(barIndexFor(visibleBranches(_caps(widgets: const ['TODAYS_CLINIC'])), moreBranch), 3);
    });
  });

  group('the router agrees with the bar', () {
    final router = File('lib/core/router/app_router.dart').readAsStringSync();
    final shell = router.substring(router.indexOf('ClinicianShell(navigationShell'));

    test('the branches are declared in bar order', () {
      final order = [
        "path: '/clinician/dashboard'",
        "path: '/clinician/appointments'",
        "path: '/clinician/patients'",
        "path: '/clinician/more'",
      ].map(shell.indexOf).toList();
      expect(order.every((i) => i > 0), isTrue, reason: 'a tab route is missing from the shell');
      expect([...order]..sort(), order, reason: 'the branches are not in Home, Today, Patients, More order');
    });

    test('Nutrition is not a tab, and is still a route', () {
      expect(shell.contains("path: '/clinician/nutrition'"), isFalse);
      expect(router.contains("path: '/clinician/nutrition'"), isTrue);
    });
  });
}
