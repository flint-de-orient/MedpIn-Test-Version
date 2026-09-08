import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/update/version_gate.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';
import 'clinician_tabs.dart';

/// Bottom-navigation scaffold for the clinician (doctor + staff) app:
/// Home · Care · Nutrition · Profile — minus whatever this practice has not
/// got.
///
/// Home is the dashboard — the clinic's pulse at a glance. Care lists the
/// doctor↔patient conversations, each row leading into that thread. Nutrition
/// lists the dietician↔patient conversations so the doctor can watch and step
/// in to guide. Clinical tools live in the Profile hub.
///
/// The bar is the same floating frosted one the patient and dietician apps
/// use. Three panels that navigate differently read as three products; this is
/// one.
///
/// ---- The tabs are not fixed -------------------------------------------
///
/// Which ones appear comes from the server's answer about this practice, not
/// from a build. A practice that gains a capability sees the tab on its next
/// load rather than on its next app-store update, and one that never had it is
/// not looking at a screen with nothing in it.
///
/// The bar's indices and the router's branch indices are therefore different
/// numbers, and [visibleBranches] is the only place that knows how they map.
/// Doing it inline would put the arithmetic in two places, and the failure —
/// tapping Profile and landing on Nutrition — reads as a routing bug rather
/// than as an off-by-one.
class ClinicianShell extends ConsumerWidget {
  const ClinicianShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Whether a newer build exists. valueOrNull, so a check still in
    // flight or one that failed marks nothing — the same promise the rest
    // of the update path makes: what cannot be seen is not asserted.
    final updateAvailable =
        ref.watch(versionStatusProvider).valueOrNull?.canUpdate ?? false;

    final visible = visibleBranches(ref.watch(capabilitySetProvider));
    final current = barIndexFor(visible, navigationShell.currentIndex);

    /*
     * Standing on a branch that is no longer shown.
     *
     * It happens on the load after a plan changes, or when the first
     * capability answer arrives and narrows what the permissive default let
     * through. Passing null to the bar and leaving them there would show a
     * screen with no tab selected and no way back to it; moving them silently
     * is the smaller surprise.
     *
     * After the frame, because navigating during a build throws.
     */
    if (current == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        navigationShell.goBranch(visible.first);
      });
    }

    /// The bar item for a branch, or nothing when it is hidden.
    GlassNavItem? itemFor(int branch) => switch (branch) {
      0 => const GlassNavItem(
        icon: Icons.dashboard_outlined,
        selectedIcon: Icons.dashboard_rounded,
        label: 'Home',
      ),
      // 'Care' rather than 'Patients': it pairs with the Nutrition tab as the
      // clinic's two conversation streams, which is also how the threads are
      // modelled server-side.
      1 => const GlassNavItem(
        icon: Icons.groups_outlined,
        selectedIcon: Icons.groups_rounded,
        label: 'Care',
      ),
      2 => const GlassNavItem(
        icon: Icons.restaurant_menu_outlined,
        selectedIcon: Icons.restaurant_menu_rounded,
        label: 'Nutrition',
      ),
      3 => GlassNavItem(
        icon: Icons.person_outline_rounded,
        selectedIcon: Icons.person_rounded,
        label: 'Profile',
        // Marked while a newer build exists, and unmarked the moment one is
        // installed — derived, never stored, so it cannot be dismissed into
        // silence. The dialog can be waved away with "later"; this is what
        // keeps the offer findable afterwards, and Profile is where the detail
        // waits.
        showDot: updateAvailable,
      ),
      _ => null,
    };
    // The ground wraps the Scaffold rather than sitting inside the body, so
    // it runs behind the navigation bar as well. The bar's surround is only
    // padding — it was always transparent; what was covering the ground was
    // the Scaffold's own background underneath it.
    return GlassGround(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: navigationShell,
        bottomNavigationBar: GlassNavBar(
          // Zero while the shell is moving them off a hidden branch. One frame,
          // and the alternative is a bar with nothing selected.
          currentIndex: current ?? 0,
          onSelected: (index) {
            // The bar's index, translated. These are different numbers the
            // moment a tab is hidden.
            final branch = visible[index];
            navigationShell.goBranch(
              branch,
              initialLocation: branch == navigationShell.currentIndex,
            );
          },
          // Labels kept to single short words so none wrap on a narrow phone.
          items: [for (final b in visible) itemFor(b)!],
        ),
      ),
    );
  }
}
