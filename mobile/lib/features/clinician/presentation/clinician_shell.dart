import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/update/version_gate.dart';
import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';
import 'clinician_tabs.dart';

/// Bottom-navigation scaffold for the practice's clinical app — the doctor,
/// their assistant, the bench and the practice manager: Home · Today · Patients
/// · More, minus what this person's work does not include.
///
/// Home is what needs the doctor, composed for their specialty. Today is the
/// day's appointments and queue. Patients is the practice's roll, with the
/// conversations. More holds the person, the practice and the clinic's tools.
///
/// The bar is the same floating one the patient and dietician apps use. Three
/// panels that navigate differently read as three products; this is one.
///
/// ---- The tabs are not fixed -------------------------------------------
///
/// Which ones appear comes from the server's answer about this person, not
/// from a build — see [visibleBranches], the only place that knows how bar
/// indices map to branch indices.
class ClinicianShell extends ConsumerWidget {
  const ClinicianShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Whether a newer build exists. valueOrNull, so a check still in flight or
    // one that failed marks nothing: what cannot be seen is not asserted.
    final updateAvailable =
        ref.watch(versionStatusProvider).valueOrNull?.canUpdate ?? false;

    final visible = visibleBranches(ref.watch(capabilitySetProvider));
    final current = barIndexFor(visible, navigationShell.currentIndex);

    /*
     * Standing on a branch that is no longer shown — on the load after what
     * this person's home is made of changes, or when the first answer narrows
     * what the permissive default let through. Moving them is the smaller
     * surprise than a screen with no tab lit. After the frame, because
     * navigating during a build throws.
     */
    if (current == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        navigationShell.goBranch(visible.first);
      });
    }

    GlassNavItem? itemFor(int branch) => switch (branch) {
      homeBranch => const GlassNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home_rounded,
        label: 'Home',
      ),
      todayBranch => const GlassNavItem(
        icon: Icons.today_outlined,
        selectedIcon: Icons.today_rounded,
        label: 'Today',
      ),
      patientsBranch => const GlassNavItem(
        icon: Icons.groups_outlined,
        selectedIcon: Icons.groups_rounded,
        label: 'Patients',
      ),
      moreBranch => GlassNavItem(
        icon: Icons.more_horiz_rounded,
        selectedIcon: Icons.more_horiz_rounded,
        label: 'More',
        // Marked while a newer build exists and unmarked once it is installed
        // — derived, never stored, so it cannot be dismissed into silence.
        showDot: updateAvailable,
      ),
      _ => null,
    };

    // The ground wraps the Scaffold rather than sitting inside the body, so it
    // runs behind the navigation bar as well.
    return GlassGround(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: navigationShell,
        bottomNavigationBar: GlassNavBar(
          // Zero while the shell is moving them off a hidden branch: one frame,
          // and the alternative is a bar with nothing selected.
          currentIndex: current ?? 0,
          onSelected: (index) {
            final branch = visible[index];
            navigationShell.goBranch(
              branch,
              initialLocation: branch == navigationShell.currentIndex,
            );
          },
          items: [for (final b in visible) itemFor(b)!],
        ),
      ),
    );
  }
}
