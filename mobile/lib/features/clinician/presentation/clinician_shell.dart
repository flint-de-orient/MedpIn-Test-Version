import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/update/version_gate.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';

/// Bottom-navigation scaffold for the clinician (doctor + staff) app:
/// Home · Care · Nutrition · Profile.
///
/// Home is the dashboard — the clinic's pulse at a glance. Care lists the
/// doctor↔patient conversations, each row leading into that thread. Nutrition
/// lists the dietician↔patient conversations so the doctor can watch and step
/// in to guide. Clinical tools live in the Profile hub.
///
/// The bar is the same floating frosted one the patient and dietician apps
/// use. Three panels that navigate differently read as three products; this is
/// one.
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
    // The ground wraps the Scaffold rather than sitting inside the body, so
    // it runs behind the navigation bar as well. The bar's surround is only
    // padding — it was always transparent; what was covering the ground was
    // the Scaffold's own background underneath it.
    return GlassGround(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: navigationShell,
        bottomNavigationBar: GlassNavBar(
          currentIndex: navigationShell.currentIndex,
          onSelected:
              (index) => navigationShell.goBranch(
                index,
                initialLocation: index == navigationShell.currentIndex,
              ),
          // Labels kept to single short words so none wrap on a narrow phone.
          // No longer const: the Profile item carries a mark that depends on
          // whether an update exists, which is not knowable at compile time.
          items: [
            GlassNavItem(
              icon: Icons.dashboard_outlined,
              selectedIcon: Icons.dashboard_rounded,
              label: 'Home',
            ),
            GlassNavItem(
              icon: Icons.groups_outlined,
              selectedIcon: Icons.groups_rounded,
              // 'Care' rather than 'Patients': it pairs with the Nutrition tab
              // as the clinic's two conversation streams (care vs nutrition),
              // which is also how the threads are modelled server-side.
              label: 'Care',
            ),
            GlassNavItem(
              icon: Icons.restaurant_menu_outlined,
              selectedIcon: Icons.restaurant_menu_rounded,
              label: 'Nutrition',
            ),
            GlassNavItem(
              icon: Icons.person_outline_rounded,
              selectedIcon: Icons.person_rounded,
              label: 'Profile',
              // Marked while a newer build exists, and unmarked the moment
              // one is installed — derived, never stored, so it cannot be
              // dismissed into silence. The dialog can be waved away with
              // "later"; this is what keeps the offer findable afterwards,
              // and Profile is where the detail waits.
              showDot: updateAvailable,
            ),
          ],
        ),
      ),
    );
  }
}
