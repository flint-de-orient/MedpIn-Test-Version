import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../domain/appointment.dart';
import 'dashboard_registry.dart';
import 'home_panel.dart';

/// What the doctor's home offers to do: one primary action, and the rest
/// quieter.
///
/// ---- What this replaced ----------------------------------------------------
///
/// Five tinted pills of equal weight, wrapping one-two-two: Start consultation,
/// Add patient, Record vitals, Write prescription, Alerts. Three of them opened
/// the same patient list — vitals and the prescription are steps of the
/// consultation, not separate errands — and Alerts repeated the bell beside it
/// and the triage card below it. At a larger text size they stacked one per
/// line and filled the first screen before a single patient appeared.
///
/// ---- The primary action knows the day -------------------------------------
///
/// With a patient checked in and waiting for this doctor, it names them and
/// opens their consultation. Otherwise it opens the patient list to choose one.
/// And a practice with no patients yet has nobody to consult, so its first
/// action is adding one.
/// Which of the actions to draw: the primary, the rest, or both.
///
/// The Today card puts the primary directly under the day's counts, where it
/// is on the first screen, and the quieter ones at its foot.
enum ActionsPart { all, primary, rest }

class HomeActions extends StatelessWidget {
  const HomeActions({
    super.key,
    required this.actions,
    this.waiting,
    this.practiceEmpty = false,
    this.alertsOnScreen = false,
    this.part = ActionsPart.all,
  });

  final ActionsPart part;

  /// The server's allowed actions, in its order.
  final List<String> actions;

  /// The next patient checked in and waiting for the signed-in doctor.
  final Appointment? waiting;

  final bool practiceEmpty;

  /// True when the home already links the alerts (the triage card), so an
  /// "Alerts" action would be the third way to the same screen.
  final bool alertsOnScreen;

  /// Each action once, and no two opening the same screen.
  ///
  /// Record vitals, Write prescription and the lab-reports action all open the
  /// patient list that Start consultation opens. An operator may still
  /// configure them; the home draws the first and drops the echoes.
  static List<String> distinct(List<String> ids, {bool alertsOnScreen = false}) {
    final seen = <String>{};
    final out = <String>[];
    for (final id in ids) {
      final spec = dashboardActions[id];
      if (spec == null) continue;
      if (id == 'VIEW_ALERTS' && alertsOnScreen) continue;
      if (seen.add(spec.route)) out.add(id);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final ids = distinct(actions, alertsOnScreen: alertsOnScreen);
    final canStart = ids.contains('START_CONSULTATION') && !practiceEmpty;
    final canAdd = ids.contains('ADD_PATIENT');

    final Widget? primary;
    final String? primaryId;
    if (canStart) {
      final w = waiting;
      primaryId = 'START_CONSULTATION';
      primary = _PrimaryButton(
        icon: Icons.medical_services_outlined,
        label: w == null
            ? 'Start consultation'
            : 'Start consultation with ${w.patientName}',
        onTap: w == null || w.patientId.isEmpty
            ? () => context.go('/clinician/patients')
            : () => context.push(
                '/clinician/patients/${w.patientId}/consult',
                extra: w.patientName,
              ),
      );
    } else if (canAdd && practiceEmpty) {
      primaryId = 'ADD_PATIENT';
      primary = _PrimaryButton(
        icon: Icons.person_add_alt_1_outlined,
        label: 'Add your first patient',
        onTap: () => context.push('/clinician/patients/new'),
      );
    } else {
      primaryId = null;
      primary = null;
    }

    final rest = part == ActionsPart.primary
        ? const <String>[]
        : [
            for (final id in ids)
              if (id != primaryId && !(id == 'START_CONSULTATION' && practiceEmpty)) id,
          ];
    final showPrimary = part != ActionsPart.rest ? primary : null;
    if (showPrimary == null && rest.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showPrimary != null) showPrimary,
        if (rest.isNotEmpty) ...[
          if (showPrimary != null) const SizedBox(height: T.s2),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              for (final id in rest)
                _SecondaryButton(
                  spec: dashboardActions[id]!,
                  // One quiet action beside the primary takes the width, so
                  // the pair reads as a stack rather than a button and a gap.
                  fill: rest.length == 1,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: T.primary,
        foregroundColor: T.surfaceRaised,
        // The control height, grown with the text rather than clipping a
        // patient's name at a larger size.
        minimumSize: const Size.fromHeight(T.hControl),
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
      icon: Icon(icon, size: T.s6),
      // Wraps rather than ellipsising: "Start consultation with Mohammed
      // Imran Chowdhury" cut to "…with Mohammed Im…" names the wrong person.
      // The style is on the text, not the button's `textStyle`, which would
      // replace the theme's and drop its typeface.
      label: Text(label, textAlign: TextAlign.center, style: T.bodyStrong),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  const _SecondaryButton({required this.spec, required this.fill});

  final ActionSpec spec;
  final bool fill;

  @override
  Widget build(BuildContext context) {
    final button = OutlinedButton.icon(
      onPressed: () => context.push(spec.route),
      style: OutlinedButton.styleFrom(
        foregroundColor: T.primary,
        minimumSize: const Size(T.tap, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s2),
        side: const BorderSide(color: T.line),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
      icon: Icon(spec.icon, size: T.s5),
      label: Text(spec.label, style: T.bodyStrong),
    );
    return fill ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// The actions of a home with no day on it — a practice manager's, the bench's.
///
/// Rows, not pills: "People", "Departments" and "Export data" are places to go,
/// and a list of places reads as a list.
class HomeShortcuts extends StatelessWidget {
  const HomeShortcuts({super.key, required this.actions});

  final List<String> actions;

  @override
  Widget build(BuildContext context) {
    final ids = HomeActions.distinct(actions);
    if (ids.isEmpty) return const SizedBox.shrink();
    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelHeading(icon: Icons.bolt_outlined, title: 'Shortcuts'),
          for (final id in ids)
            _ShortcutRow(spec: dashboardActions[id]!),
        ],
      ),
    );
  }
}

class _ShortcutRow extends StatelessWidget {
  const _ShortcutRow({required this.spec});

  final ActionSpec spec;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: T.s2),
      child: Semantics(
        button: true,
        label: spec.label,
        excludeSemantics: true,
        child: Material(
          color: T.surface,
          borderRadius: BorderRadius.circular(T.rControl),
          child: InkWell(
            borderRadius: BorderRadius.circular(T.rControl),
            onTap: () => context.push(spec.route),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: T.tap),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
                child: Row(
                  children: [
                    Icon(spec.icon, size: T.s6, color: T.primary),
                    const SizedBox(width: T.s3),
                    Expanded(
                      child: Text(spec.label, style: T.bodyStrong.copyWith(color: T.ink)),
                    ),
                    const Icon(Icons.chevron_right_rounded, size: T.s6, color: T.inkMuted),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
