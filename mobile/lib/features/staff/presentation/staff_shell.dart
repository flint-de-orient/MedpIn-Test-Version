import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/glass_nav_bar.dart';
import '../../../shared/widgets/glass_surface.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../clinician/presentation/clinician_providers.dart';

/// The front desk's app: Today · Patients · Messages · Profile.
///
/// Staff used to land in the doctor's panel, all four tabs of it. That was
/// wrong twice over. Their Home opened on Live Triage — HbA1c figures and
/// clinical alerts, which answer "who needs a doctor", a question the desk
/// cannot act on and should not be deciding about. And their Profile offered
/// the prescription letterhead, the professional details and the digital
/// signature, none of which belong to a receptionist.
///
/// What a desk actually does is answered by these four: who is coming in today
/// and who is waiting on an answer; register a walk-in and look somebody up;
/// reply to routine messages and escalate what is not routine; and manage the
/// clinic's own details.
///
/// Prescribing and closing a clinical alert are refused by the server for this
/// role, not merely hidden here — a screen that is absent is a convenience, and
/// a guard that is absent is a false medical record.
class StaffShell extends ConsumerWidget {
  const StaffShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GlassGround(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: navigationShell,
        bottomNavigationBar: GlassNavBar(
          currentIndex: navigationShell.currentIndex,
          onSelected: (index) {
            // A shell branch is kept alive in an IndexedStack, so coming back
            // to Today does not rebuild it and nothing it counts is re-read.
            // The desk's commonest morning is exactly that: read the messages
            // on Patients, tap Today, and find the unread tile still showing
            // the number from before they started. Its timer would catch up
            // within fifteen seconds, which is fifteen seconds of a screen
            // saying something the reader has just personally disproved.
            //
            // Invalidated here rather than inside the tab, because the tab is
            // not rebuilt — this is the only place that knows the switch
            // happened.
            if (index == 0) {
              ref.invalidate(clinicianNotificationsProvider);
              ref.invalidate(appointmentDiaryProvider);
            }
            navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            );
          },
          // Single short words, so none wrap on a narrow phone.
          items: const [
            GlassNavItem(
              icon: Icons.today_outlined,
              selectedIcon: Icons.today_rounded,
              // "Today", not "Home": the desk's screen is a day, and the word
              // says what it holds.
              label: 'Today',
            ),
            GlassNavItem(
              icon: Icons.groups_outlined,
              selectedIcon: Icons.groups_rounded,
              label: 'Patients',
            ),
            // No "Messages" tab. It and "Patients" both opened the same
            // PatientsScreen — two labels for one screen, which is worse than
            // one label, because a reader who taps both learns the app is
            // lying about what it has. That screen already lists the
            // conversations; when the desk needs an inbox of its own it can
            // have a real one.
            GlassNavItem(
              icon: Icons.person_outline_rounded,
              selectedIcon: Icons.person_rounded,
              label: 'Profile',
            ),
          ],
        ),
      ),
    );
  }
}
