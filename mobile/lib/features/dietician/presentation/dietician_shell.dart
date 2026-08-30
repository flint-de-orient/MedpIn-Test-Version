import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/update/version_gate.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';

/// Bottom-navigation scaffold for the dietician: Home · Patients · Profile.
///
/// Home says what needs doing today, the patient list is everyone, and Profile
/// is where their own account lives — the same shape the doctor has, and the
/// same house mark and wording the patient's app uses, so somebody who has seen
/// one panel can read the others.
class DieticianShell extends ConsumerWidget {
  const DieticianShell({super.key, required this.navigationShell});

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
          // No longer const: the Profile item carries a mark that depends on
          // whether an update exists, which is not knowable at compile time.
          items: [
            GlassNavItem(
              icon: Icons.home_outlined,
              selectedIcon: Icons.home_rounded,
              label: 'Home',
            ),
            GlassNavItem(
              icon: Icons.groups_outlined,
              selectedIcon: Icons.groups_rounded,
              label: 'Patients',
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
