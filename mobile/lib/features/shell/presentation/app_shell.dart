import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/update/version_gate.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';

/// Bottom navigation scaffold for the patient's five tabs. Wraps a
/// [StatefulNavigationShell] so each branch keeps its own navigation stack and
/// scroll position when switching tabs.
///
/// The bar looks like it floats but occupies real layout space, so nothing —
/// a composer, a floating button, the last row of a list — can end up
/// underneath it. See [GlassNavBar] for why that matters more than the frost
/// did.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Whether a newer build exists. valueOrNull, so a check still in
    // flight or one that failed marks nothing — the same promise the rest
    // of the update path makes: what cannot be seen is not asserted.
    final updateAvailable =
        ref.watch(versionStatusProvider).valueOrNull?.canUpdate ?? false;
    final l10n = AppLocalizations.of(context);
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
          items: [
            const GlassNavItem(
              icon: Icons.home_outlined,
              selectedIcon: Icons.home_rounded,
              label: 'Home',
            ),
            const GlassNavItem(
              icon: Icons.chat_bubble_outline_rounded,
              selectedIcon: Icons.chat_bubble_rounded,
              label: 'Doctor',
            ),
            const GlassNavItem(
              icon: Icons.medication_outlined,
              selectedIcon: Icons.medication_rounded,
              label: 'Medicines',
            ),
            GlassNavItem(
              icon: Icons.restaurant_menu_outlined,
              selectedIcon: Icons.restaurant_menu_rounded,
              label: 'Dietician',
            ),
            GlassNavItem(
              icon: Icons.person_outline_rounded,
              selectedIcon: Icons.person_rounded,
              label: l10n.navProfile,
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
