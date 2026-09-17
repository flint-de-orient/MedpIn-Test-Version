import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../core/capabilities/capabilities.dart';
import '../data/practice_repository.dart';
import '../domain/practice.dart';
import 'clinician_providers.dart';
import 'widgets/food_log_review.dart';
import 'widgets/practice_details_sheet.dart';

/// The practice a head doctor runs: who it says it is, where it sits, who works
/// in it.
///
/// ---- What this screen is for --------------------------------------------
///
/// A head doctor opens it between patients to answer one question: will this
/// print a valid prescription. Everything else — the locations, the head count
/// — is reference material they scroll to afterwards.
///
/// So the screen leads with what is missing rather than with a form. The
/// obvious build is three cards labelled Brand, Locations and People, which
/// gives equal weight to a legal defect and a head count, and buries the one
/// thing worth interrupting a clinic day for.
///
/// The identity is the masthead rather than a field list, because the practice
/// brand is the one piece of content on this screen that a doctor can check by
/// looking rather than by reading. If the logo is wrong, they see it is wrong.
class PracticeScreen extends ConsumerWidget {
  const PracticeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(practiceOverviewProvider);

    return Scaffold(
      backgroundColor: T.surface,
      // Opened from More, so it needs the way back.
      appBar: AppBar(title: const Text('Practice')),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(practiceOverviewProvider.future),
        child: async.when(
          loading: () => const _Skeleton(),
          // A real error state, with the reason and a way out. The rest of this
          // app answers a failed load with an empty list, which tells a doctor
          // their practice has no locations rather than that the server is
          // unreachable.
          error: (err, _) => _LoadFailed(onRetry: () => ref.invalidate(practiceOverviewProvider)),
          data: (p) => p == null ? const _NoPracticeYet() : _Overview(practice: p),
        ),
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.practice});

  final PracticeOverview practice;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
      children: [
        _Masthead(practice: practice),
        const SizedBox(height: T.s6),
        _Readiness(practice: practice),
        const SizedBox(height: T.s8),
        _Locations(locations: practice.locations),
        const SizedBox(height: T.s8),
        _People(practice: practice),
        // Draws nothing when this practice has no departments, so the gap
        // above it would be a gap to nothing. It carries its own spacing.
        const _Departments(),
        const SizedBox(height: T.s8),
        const _Heading(title: 'Food-log review'),
        const SizedBox(height: T.s2),
        const FoodLogReviewTile(),
      ],
    );
  }
}

/// The brand as the patient meets it: mark, name, line beneath.
class _Masthead extends StatelessWidget {
  const _Masthead({required this.practice});

  final PracticeOverview practice;

  @override
  Widget build(BuildContext context) {
    final logo = practice.logoLightUrl;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (logo != null) ...[
          // Fixed box, contained artwork. A symbol-only mark and a wordmark are
          // different shapes and neither may be stretched to match the other.
          SizedBox(
            width: 56,
            height: 56,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(T.rCard),
              child: Image.network(
                logo,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          ),
          const SizedBox(width: T.s3),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(practice.name, style: T.title.copyWith(color: T.ink)),
              if (practice.tagline != null) ...[
                const SizedBox(height: T.s1),
                Text(practice.tagline!, style: T.small.copyWith(color: T.inkMuted)),
              ],
              if (practice.registrationNo != null) ...[
                const SizedBox(height: T.s2),
                Text(
                  'Reg. ${practice.registrationNo}',
                  style: T.label.copyWith(color: T.inkMuted),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// What is missing, and what it costs.
///
/// Two tiers, never one list. A missing tagline and a missing council number
/// shown in the same grey column teaches a doctor that the column is noise.
class _Readiness extends StatelessWidget {
  const _Readiness({required this.practice});

  final PracticeOverview practice;

  @override
  Widget build(BuildContext context) {
    final blocking = practice.blockingGaps;
    final minor = practice.minorGaps;

    if (practice.isComplete) {
      return Row(
        children: [
          const Icon(Icons.check_circle_outline_rounded, size: 18, color: T.success),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(
              'Complete. Prescriptions print with the full letterhead.',
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (blocking.isNotEmpty) ...[
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  blocking.length == 1
                      ? 'One thing is missing from prescriptions'
                      : '${blocking.length} things are missing from prescriptions',
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                Text(
                  'A prescription issued now would not carry everything it legally needs.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
                const SizedBox(height: T.s4),
                for (final gap in blocking) ...[
                  _GapRow(gap: gap),
                  if (gap != blocking.last) const SizedBox(height: T.s3),
                ],
                const SizedBox(height: T.s5),
                // The one primary action on the screen, and it names the work
                // rather than saying "Edit".
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => _editDetails(context, practice),
                    child: Text(
                      blocking.length == 1
                          ? 'Add ${blocking.first.label.toLowerCase()}'
                          : 'Complete the letterhead',
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (minor.isNotEmpty) const SizedBox(height: T.s4),
        ],
        if (minor.isNotEmpty)
          Text(
            'Also unset: ${minor.map((g) => g.label.toLowerCase()).join(', ')}.',
            style: T.small.copyWith(color: T.inkMuted),
          ),
      ],
    );
  }
}

/// Opens the letterhead sheet. Sheet rather than a pushed screen: the doctor is
/// three taps into an admin corner and the work is four text fields.
Future<void> _editDetails(BuildContext context, PracticeOverview practice) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => PracticeDetailsSheet(practice: practice),
  );
  if (saved == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Letterhead updated')),
    );
  }
}

class _GapRow extends StatelessWidget {
  const _GapRow({required this.gap});

  final PracticeGap gap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          margin: const EdgeInsets.only(top: T.s2),
          width: 6,
          height: 6,
          decoration: const BoxDecoration(color: T.danger, shape: BoxShape.circle),
        ),
        const SizedBox(width: T.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(gap.label, style: T.body.copyWith(color: T.ink)),
              const SizedBox(height: T.s1),
              // The server's sentence. Says what the field is for, which is the
              // difference between a nag and a reason.
              Text(gap.prints, style: T.small.copyWith(color: T.inkMuted)),
            ],
          ),
        ),
      ],
    );
  }
}

class _Locations extends StatelessWidget {
  const _Locations({required this.locations});

  final List<PracticeLocation> locations;

  @override
  Widget build(BuildContext context) {
    // Closing a clinic is a soft delete — the row stays with `isActive: false`
    // so appointments already booked there keep a valid reference. So the list
    // holds places the practice no longer opens, and the heading must not count
    // them: "2 locations" beside one that says Closed is the screen arguing
    // with itself.
    final open = locations.where((l) => l.isActive).toList();
    final closed = locations.where((l) => !l.isActive).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Heading(
          title: switch (open.length) {
            0 => 'No open locations',
            1 => 'One location',
            _ => '${open.length} locations',
          },
          actionLabel: 'Manage',
          onAction: () => context.push('/clinician/clinics'),
        ),
        const SizedBox(height: T.s3),
        if (locations.isEmpty)
          Text(
            'No locations yet. Patients cannot book until there is one.',
            style: T.small.copyWith(color: T.inkMuted),
          )
        else ...[
          for (final loc in open) ...[
            _LocationRow(location: loc),
            if (loc != open.last) const SizedBox(height: T.s3),
          ],
          // Kept visible rather than hidden. A doctor wondering why a clinic
          // vanished from the app should find it here saying Closed, instead of
          // concluding it was deleted.
          if (closed.isNotEmpty) ...[
            if (open.isNotEmpty) const SizedBox(height: T.s5),
            Text(
              closed.length == 1 ? 'Closed' : 'Closed (${closed.length})',
              style: T.label.copyWith(color: T.inkFaint),
            ),
            const SizedBox(height: T.s2),
            for (final loc in closed) ...[
              _LocationRow(location: loc),
              if (loc != closed.last) const SizedBox(height: T.s3),
            ],
          ],
        ],
      ],
    );
  }
}

class _LocationRow extends StatelessWidget {
  const _LocationRow({required this.location});

  final PracticeLocation location;

  @override
  Widget build(BuildContext context) {
    final detail = <String>[
      if (location.city != null) location.city!,
      location.weeklyHourCount == 0
          ? 'no hours set'
          : '${location.weeklyHourCount} weekly ${location.weeklyHourCount == 1 ? 'sitting' : 'sittings'}',
      if (location.overridesBrand) 'own branding',
    ].join(' · ');

    return InnerTile(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  location.name,
                  style: T.body.copyWith(color: location.isActive ? T.ink : T.inkMuted),
                ),
                const SizedBox(height: T.s1),
                Text(detail, style: T.label.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          if (!location.isActive)
            Text('Closed', style: T.label.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }
}

/// The practice's own specialties, when it has departments at all.
///
/// ---- Why this is a capability and not a plan check ---------------------
///
/// A solo clinic has no departments, and that is not a thing to sell it — it
/// is what a solo clinic is. A polyclinic has them on any plan. So the question
/// this asks is "does this practice have departments", which the server answers
/// from the practice type, the plan and this person's permissions together, and
/// this widget does not re-derive from any of the three.
///
/// Hidden rather than shown-and-disabled. A greyed section on a screen a solo
/// doctor opens every week is a permanent advertisement for something that will
/// never apply to them.
class _Departments extends ConsumerWidget {
  const _Departments();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final caps = ref.watch(capabilitySetProvider);

    /*
     * Two different silences, and only one of them should be silent.
     *
     * `has()` is false whether the practice cannot have departments at all or
     * this person simply may not manage them, and the section vanished for
     * both. For a solo clinic that is right — a greyed section advertising
     * something that will never apply is worse than nothing.
     *
     * For a doctor at a practice that *does* run departments and has not been
     * given MANAGE_DEPARTMENT, it is not: the screen shows no trace of a thing
     * their colleagues can see, which reads as the feature being broken. That
     * is what `withheld()` has always been for, and nothing used it.
     */
    if (caps.withheld(Cap.department)) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: T.s8),
          const _Heading(title: 'Departments'),
          const SizedBox(height: T.s2),
          Text(
            'This practice runs departments. Managing them needs permission '
            'from whoever runs the practice.',
            style: T.body.copyWith(color: T.inkMuted),
          ),
        ],
      );
    }

    if (!caps.has(Cap.department)) {
      return const SizedBox.shrink();
    }

    final async = ref.watch(departmentsProvider);
    final mine = async.valueOrNull?.where((d) => !d.isShared).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: T.s8),
        _Heading(
          title: 'Departments',
          // The list is worth seeing either way — a doctor should know which
          // specialties their practice runs. Managing them is the part that
          // needs the permission, and the screen behind this link now says so
          // itself, so this stays a way in rather than a promise.
          actionLabel: 'Manage',
          onAction: () => context.push('/clinician/departments'),
        ),
        const SizedBox(height: T.s2),
        Text(
          // Three states, and the empty one is informative rather than noise:
          // a practice running as a single list is the right shape for a solo
          // clinic, and saying so beats a blank line that reads as a failed
          // load.
          switch (mine) {
            null => 'Loading…',
            [] => 'None yet — the practice runs as a single list.',
            final d =>
              '${d.length} ${d.length == 1 ? 'department' : 'departments'}'
                  '${d.any((x) => !x.isActive) ? ', some retired' : ''}',
          },
          style: T.small.copyWith(color: T.inkMuted),
        ),
      ],
    );
  }
}

class _People extends StatelessWidget {
  const _People({required this.practice});

  final PracticeOverview practice;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      '${practice.doctors} ${practice.doctors == 1 ? 'doctor' : 'doctors'}',
      '${practice.staff} front desk',
      if (practice.dieticians > 0)
        '${practice.dieticians} ${practice.dieticians == 1 ? 'dietician' : 'dieticians'}',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Heading(
          title: 'People',
          actionLabel: 'Manage',
          onAction: () => context.push('/clinician/team'),
        ),
        const SizedBox(height: T.s2),
        Text(parts.join(' · '), style: T.small.copyWith(color: T.inkMuted)),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.title, this.actionLabel, this.onAction});

  final String title;

  /// Both optional and both together. A section can be a heading over content
  /// that is changed somewhere else — the food-log cadence has its own button
  /// on the row beneath it, and a second one up here would be two ways to do
  /// one thing.
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final action = onAction;
    final label = actionLabel;

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: T.bodyStrong.copyWith(color: T.ink)),
        if (action != null && label != null)
          TextButton(onPressed: action, child: Text(label)),
      ],
    );
  }
}

/// Shown while loading. A skeleton rather than a spinner: the shape of this
/// screen is known before its content arrives, so showing the shape makes the
/// wait feel like loading rather than like nothing happening.
class _Skeleton extends StatelessWidget {
  const _Skeleton();

  @override
  Widget build(BuildContext context) {
    Widget bar(double width, double height) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: T.line,
        borderRadius: BorderRadius.circular(T.rCard),
      ),
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            bar(56, 56),
            const SizedBox(width: T.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [bar(180, 20), const SizedBox(height: T.s2), bar(120, 14)],
              ),
            ),
          ],
        ),
        const SizedBox(height: T.s6),
        bar(double.infinity, 120),
        const SizedBox(height: T.s8),
        bar(140, 16),
        const SizedBox(height: T.s3),
        bar(double.infinity, 64),
      ],
    );
  }
}

/// A failed load, said plainly, with the way out.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s12, T.s4, T.s4),
      children: [
        Text('Could not load the practice', style: T.title.copyWith(color: T.ink)),
        const SizedBox(height: T.s2),
        Text(
          'The server did not answer. Your practice details are safe — this screen '
          'just could not read them.',
          style: T.body.copyWith(color: T.inkMuted),
        ),
        const SizedBox(height: T.s6),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(onPressed: onRetry, child: const Text('Try again')),
        ),
      ],
    );
  }
}

/// Every deployment that has not run the backfill. Not an error, and not a
/// blank screen — it says what is true and who can fix it.
class _NoPracticeYet extends StatelessWidget {
  const _NoPracticeYet();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s12, T.s4, T.s4),
      children: [
        Text('No practice set up yet', style: T.title.copyWith(color: T.ink)),
        const SizedBox(height: T.s2),
        Text(
          'Your clinics are working normally and nothing needs to change today. '
          'A practice groups them under one name and one letterhead, and gets '
          'created when your clinic is migrated.',
          style: T.body.copyWith(color: T.inkMuted),
        ),
        const SizedBox(height: T.s6),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            onPressed: () => context.push('/clinician/clinics'),
            child: const Text('Manage clinics'),
          ),
        ),
      ],
    );
  }
}
