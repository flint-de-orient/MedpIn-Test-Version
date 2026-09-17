import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/update/version_gate.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';
import 'care_access.dart';

/// Bottom navigation scaffold for the patient's tabs. Wraps a
/// [StatefulNavigationShell] so each branch keeps its own navigation stack and
/// scroll position when switching tabs.
///
/// The bar looks like it floats but occupies real layout space, so nothing —
/// a composer, a floating button, the last row of a list — can end up
/// underneath it. See [GlassNavBar] for why that matters more than the frost
/// did.
///
/// ---- Which tabs ----------------------------------------------------------
///
/// The router always has five branches; the bar shows the ones that belong to
/// this patient. The Doctor and Dietician tabs are conversations with a
/// clinic's people, so they appear only while the patient is enrolled at a
/// practice (see [clinicCareProvider]). Without one, the conversation tab is
/// the assistant, named as such, and there is no dietician to write to.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  /// Branch indices, as declared in app_router.dart's patient block.
  static const int homeBranch = 0;
  static const int chatBranch = 1;
  static const int medicinesBranch = 2;
  static const int dieticianBranch = 3;
  static const int profileBranch = 4;

  /// The branches the bar offers, in order.
  static List<int> visibleBranches(ClinicCare care) => [
    homeBranch,
    chatBranch,
    medicinesBranch,
    if (care == ClinicCare.enrolled) dieticianBranch,
    profileBranch,
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Whether a newer build exists. valueOrNull, so a check still in
    // flight or one that failed marks nothing — the same promise the rest
    // of the update path makes: what cannot be seen is not asserted.
    final updateAvailable =
        ref.watch(versionStatusProvider).valueOrNull?.canUpdate ?? false;
    final l10n = AppLocalizations.of(context);
    final care = ref.watch(clinicCareProvider);
    final branches = visibleBranches(care);

    GlassNavItem item(int branch) => switch (branch) {
      homeBranch => GlassNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home_rounded,
        label: l10n.navHome,
      ),
      chatBranch =>
        care == ClinicCare.enrolled
            ? GlassNavItem(
              icon: Icons.chat_bubble_outline_rounded,
              selectedIcon: Icons.chat_bubble_rounded,
              label: l10n.ptTabDoctor,
            )
            : GlassNavItem(
              icon: Icons.auto_awesome_outlined,
              selectedIcon: Icons.auto_awesome_rounded,
              label: l10n.ptTabAssistant,
            ),
      medicinesBranch => GlassNavItem(
        icon: Icons.medication_outlined,
        selectedIcon: Icons.medication_rounded,
        label: l10n.ptTabMedicines,
      ),
      dieticianBranch => GlassNavItem(
        icon: Icons.restaurant_menu_outlined,
        selectedIcon: Icons.restaurant_menu_rounded,
        label: l10n.ptTabDietician,
      ),
      _ => GlassNavItem(
        icon: Icons.person_outline_rounded,
        selectedIcon: Icons.person_rounded,
        label: l10n.navProfile,
        // Marked while a newer build exists, and unmarked the moment one is
        // installed — derived, never stored, so it cannot be dismissed into
        // silence.
        showDot: updateAvailable,
      ),
    };

    // A branch the bar no longer offers (a Dietician tab left open when an
    // enrolment ended) lights nothing rather than lighting the wrong tab.
    final selected = branches.indexOf(navigationShell.currentIndex);

    // The ground wraps the Scaffold rather than sitting inside the body, so
    // it runs behind the navigation bar as well.
    return GlassGround(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: navigationShell,
        bottomNavigationBar: GlassNavBar(
          currentIndex: selected,
          onSelected: (i) {
            final branch = branches[i];
            navigationShell.goBranch(
              branch,
              initialLocation: branch == navigationShell.currentIndex,
            );
          },
          items: [for (final b in branches) item(b)],
        ),
      ),
    );
  }
}
