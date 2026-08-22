import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/hero_band.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/diet_models.dart';
import 'dietician_providers.dart';
import 'widgets/dietician_bell.dart';
import 'widgets/notification_sheet.dart';

/// The dietician's day in one screen.
///
/// Ordered by what is actionable rather than what is impressive: the counts,
/// then reviews that have lapsed, then patients still waiting for a plan, then
/// what came in while they were away. Counts and lists come from one endpoint,
/// so a number never disagrees with the list under it.
class DieticianDashboardScreen extends ConsumerWidget {
  const DieticianDashboardScreen({super.key});

  static String _partOfDay() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final async = ref.watch(dietDashboardProvider);

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      // The dietician's day is made of other people's actions — a patient
      // logging a meal, a doctor prescribing, a report the server has just
      // finished reading. Waiting for a pull-to-refresh showed them a morning
      // that had already moved on.
      body: AutoRefresh(
        onTick: (ref) => ref.invalidate(dietDashboardProvider),
        interval: const Duration(seconds: 30),
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _BrandHeader(name: user?.name ?? '', avatarUrl: user?.avatarUrl),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async => ref.invalidate(dietDashboardProvider),
                  child: async.when(
                    loading:
                        () => const Center(child: CircularProgressIndicator()),
                    error:
                        (_, _) => ListView(
                          children: [
                            const SizedBox(height: 140),
                            const Center(
                              child: Text('Could not load your dashboard'),
                            ),
                            const SizedBox(height: AppSpacing.md),
                            Center(
                              child: OutlinedButton(
                                onPressed:
                                    () => ref.invalidate(dietDashboardProvider),
                                child: const Text('Retry'),
                              ),
                            ),
                          ],
                        ),
                    // Zero padding so the band reaches both edges; the rest is
                    // padded on its own. Same shape as the patient tabs.
                    data:
                        (d) => ListView(
                          padding: const EdgeInsets.only(bottom: AppSpacing.xl),
                          children: [
                            HeroBand(
                              eyebrow: _partOfDay(),
                              title: (user?.name ?? '').split(' ').first,
                              figure: HeroFigure(
                                value: '${d.reviewsDue}',
                                unit: d.reviewsDue == 1 ? 'review' : 'reviews',
                                statusLabel:
                                    d.reviewsDue == 0
                                        ? 'All caught up'
                                        : d.plansMissing > 0
                                        ? '${d.plansMissing} need a plan'
                                        : 'Waiting on you',
                                statusColor:
                                    d.reviewsDue == 0
                                        ? AppColors.success
                                        : AppColors.warning,
                                caption:
                                    'Due today across ${d.patients} '
                                    '${d.patients == 1 ? 'patient' : 'patients'}',
                              ),
                            ),
                            const SizedBox(height: AppSpacing.md),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: AppSpacing.md,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  // Two by two, and no card repeats the band
                                  // above it. Reviews Due was the hero's whole
                                  // figure and a card of its own directly
                                  // underneath — the same number twice in the
                                  // first screenful, which makes a reader
                                  // check whether they mean different things.
                                  // The hero keeps it; the grid takes the four
                                  // counts it does not say.
                                  //
                                  // Rows of Expanded rather than a GridView
                                  // with an aspect ratio: at a large text
                                  // scale a fixed ratio crops the number off
                                  // the bottom of the card.
                                  IntrinsicHeight(
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        Expanded(
                                          child: _StatCard(
                                            label: 'My Patients',
                                            value: '${d.patients}',
                                            icon: Icons.groups_outlined,
                                            onTap:
                                                () => context.go(
                                                  '/dietician/patients',
                                                ),
                                          ),
                                        ),
                                        const SizedBox(width: AppSpacing.sm),
                                        Expanded(
                                          child: _StatCard(
                                            label: 'Plans to Send',
                                            value: '${d.plansMissing}',
                                            accent:
                                                d.plansMissing > 0
                                                    ? AppColors.accentOn(
                                                      context,
                                                    )
                                                    : null,
                                            icon: Icons.send_rounded,
                                            // Straight to that worklist,
                                            // already filtered. A count that
                                            // sends you to an unfiltered list
                                            // makes you find the patients it
                                            // was talking about yourself.
                                            onTap:
                                                () => context.go(
                                                  '/dietician/patients?filter=noplan',
                                                ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  IntrinsicHeight(
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        Expanded(
                                          child: _StatCard(
                                            label: 'Unread',
                                            value: '${d.unreadMessages}',
                                            accent:
                                                d.unreadMessages > 0
                                                    ? AppColors.accentOn(
                                                      context,
                                                    )
                                                    : null,
                                            icon:
                                                Icons
                                                    .chat_bubble_outline_rounded,
                                            // The sheet, not a patient
                                            // filter: the list endpoint
                                            // carries no per-patient unread
                                            // count, and these messages are
                                            // exactly what the sheet holds.
                                            onTap:
                                                () =>
                                                    showDieticianNotifications(
                                                      context,
                                                    ),
                                          ),
                                        ),
                                        const SizedBox(width: AppSpacing.sm),
                                        Expanded(
                                          child: _StatCard(
                                            label: 'New This Week',
                                            value: '${d.newThisWeek}',
                                            icon:
                                                Icons.person_add_alt_1_outlined,
                                            onTap:
                                                () => context.go(
                                                  '/dietician/patients',
                                                ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),

                                  if (d.reviewsSorted.isNotEmpty) ...[
                                    const SizedBox(height: AppSpacing.lg),
                                    _WorkCard(
                                      title: 'Reviews Due',
                                      action: 'View All',
                                      onAction:
                                          () =>
                                              context.go('/dietician/patients'),
                                      children: [
                                        for (final p in d.reviewsSorted.take(3))
                                          _PatientRow(
                                            patient: p,
                                            subtitle: _condition(p),
                                            trailing: _AgePill(
                                              days: p.sinceDays,
                                            ),
                                            onTap:
                                                () => context.push(
                                                  '/dietician/patients/${p.id}',
                                                  extra: p.name,
                                                ),
                                          ),
                                      ],
                                    ),
                                  ],

                                  if (d.plansSorted.isNotEmpty) ...[
                                    const SizedBox(height: AppSpacing.md),
                                    _WorkCard(
                                      title: 'Waiting for Diet Plan',
                                      action: 'View All',
                                      onAction:
                                          () =>
                                              context.go('/dietician/patients'),
                                      padded: true,
                                      children: [
                                        for (final p in d.plansSorted.take(3))
                                          _PlanTile(
                                            patient: p,
                                            onOpen:
                                                () => context.push(
                                                  '/dietician/patients/${p.id}',
                                                  extra: p.name,
                                                ),
                                            onCreate:
                                                () => context.push(
                                                  '/dietician/patients/${p.id}/diet',
                                                  extra: p.name,
                                                ),
                                          ),
                                      ],
                                    ),
                                  ],

                                  if (d.reviewsSorted.isEmpty &&
                                      d.plansSorted.isEmpty) ...[
                                    const SizedBox(height: AppSpacing.lg),
                                    _AllCaught(patients: d.patients),
                                  ],

                                  if (d.recentLogs.isNotEmpty) ...[
                                    const SizedBox(height: AppSpacing.lg),
                                    _MealsCard(
                                      logs:
                                          d.recentLogsByPatient
                                              .take(4)
                                              .toList(),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ],
                        ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _condition(DietPatientBrief p) => switch (p.diabetesType) {
    'type1' => 'Type 1 Diabetes',
    'type2' => 'Type 2 Diabetes',
    'gestational' => 'Gestational Diabetes',
    'prediabetes' => 'Prediabetes',
    _ => '${p.riskBand[0].toUpperCase()}${p.riskBand.substring(1)} risk',
  };
}

// ---- Header ---------------------------------------------------------------

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.name, this.avatarUrl});

  final String name;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.sm,
        AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          // The mark, not a menu button. Every destination this panel has is
          // already on the bar at the bottom, so a drawer would have been a
          // second way to reach the same three screens.
          Image.asset(
            'assets/brand/medpin_emblem.png',
            height: 30,
            errorBuilder:
                (_, _, _) => Icon(
                  Icons.restaurant_rounded,
                  size: 26,
                  color: AppColors.accentOn(context),
                ),
          ),
          const SizedBox(width: 8),
          Text(
            'MedPin',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.accentOn(context),
            ),
          ),
          const Spacer(),
          const DieticianBell(),
          const SizedBox(width: 0),
          GestureDetector(
            onTap: () => context.go('/dietician/profile'),
            child: UserAvatar(
              name: name,
              avatarUrl: avatarUrl,
              accent: AppColors.accentOn(context),
              size: 36,
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

// ---- Counts ---------------------------------------------------------------

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    this.accent,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final VoidCallback? onTap;

  /// Set only when the number means work outstanding. A card that is always
  /// tinted stops saying anything by being tinted.
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final on = accent ?? scheme.onSurface;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color:
              accent?.withValues(alpha: 0.45) ??
              scheme.outlineVariant.withValues(alpha: 0.6),
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The rail carries the urgency, so the card itself stays white and
                // the number stays readable.
                if (accent != null) Container(width: 5, color: accent),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      14,
                      AppSpacing.md,
                      16,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                label.toUpperCase(),
                                // Two lines rather than an ellipsis: in half a
                                // phone "NEW THIS WEEK" does not fit on one,
                                // and "NEW THIS W…" is not a label.
                                maxLines: 2,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.8,
                                  height: 1.2,
                                  color: accent ?? scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Icon(
                              icon,
                              size: 19,
                              color: accent ?? scheme.onSurfaceVariant,
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          value,
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w800,
                            height: 1,
                            color: on,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---- Worklists ------------------------------------------------------------

class _WorkCard extends StatelessWidget {
  const _WorkCard({
    required this.title,
    required this.children,
    this.action,
    this.onAction,
    this.padded = false,
  });

  final String title;
  final List<Widget> children;
  final String? action;
  final VoidCallback? onAction;

  /// Rows that bring their own inset block, rather than sitting edge to edge
  /// and being separated by rules.
  final bool padded;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.sm,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (action != null)
                  TextButton(
                    onPressed: onAction,
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    child: Text(
                      action!,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.accentOn(context),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Divider(
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.5),
          ),
          if (padded)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.md,
                AppSpacing.md,
                AppSpacing.md,
              ),
              child: Column(
                children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) const SizedBox(height: AppSpacing.sm),
                    children[i],
                  ],
                ],
              ),
            )
          else
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0)
                Divider(
                  height: 1,
                  color: scheme.outlineVariant.withValues(alpha: 0.5),
                ),
              children[i],
            ],
        ],
      ),
    );
  }
}

class _PatientRow extends StatelessWidget {
  const _PatientRow({
    required this.patient,
    required this.subtitle,
    required this.trailing,
    required this.onTap,
  });

  final DietPatientBrief patient;
  final String subtitle;
  final Widget trailing;
  final VoidCallback onTap;

  static String _initials(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 12,
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.accentSoftOn(context),
                shape: BoxShape.circle,
              ),
              child: Text(
                _initials(patient.name),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.accentOn(context),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    patient.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 0),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            trailing,
            const SizedBox(width: 0),
            Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

/// A patient still waiting for their first plan.
///
/// Drawn as its own inset block with the action across the bottom, rather than
/// a row with a small button at the end: this is the one list on the screen
/// where every entry needs the same thing done to it, and a full-width button
/// says that more plainly than a chip.
class _PlanTile extends StatelessWidget {
  const _PlanTile({
    required this.patient,
    required this.onOpen,
    required this.onCreate,
  });

  final DietPatientBrief patient;
  final VoidCallback onOpen;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final waiting =
        patient.sinceDays == 0
            ? 'Joined today'
            : 'Waiting ${patient.sinceDays} ${patient.sinceDays == 1 ? 'day' : 'days'}';

    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onOpen,
            child: Row(
              children: [
                UserAvatar(
                  name: patient.name,
                  avatarUrl: patient.avatarUrl,
                  accent: AppColors.accentOn(context),
                  size: 34,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        patient.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 0),
                      Row(
                        children: [
                          Icon(
                            Icons.schedule_rounded,
                            size: 13,
                            color: _waitTone(context, patient.sinceDays).fg,
                          ),
                          const SizedBox(width: 4),
                          // "Waiting 27 days" set in the same grey as
                          // "Waiting 2 days" is the one number on this tile
                          // that should have stopped somebody, printed as
                          // though it were a caption.
                          Text(
                            waiting,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight:
                                  patient.sinceDays >= 7
                                      ? FontWeight.w700
                                      : FontWeight.w400,
                              color: _waitTone(context, patient.sinceDays).fg,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 40,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: onCreate,
              child: const Text(
                'Create Plan',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// How loud a wait should be.
///
/// Everything on these worklists was red before, from "today" to "27 days ago",
/// which is the same as nothing being red: a dietician scanning the column had
/// no way to tell the patient they saw yesterday from the one nobody has
/// answered in a month. A fortnight is the point at which a nutrition review
/// has genuinely lapsed rather than merely slipped.
({Color fg, Color bg}) _waitTone(BuildContext context, int days) {
  if (days >= 14) {
    return (fg: AppColors.dangerOn(context), bg: AppColors.dangerBgOn(context));
  }
  if (days >= 7) {
    return (
      fg: AppColors.warningOn(context),
      bg: AppColors.warningBgOn(context),
    );
  }
  final scheme = Theme.of(context).colorScheme;
  return (fg: scheme.onSurfaceVariant, bg: scheme.surfaceContainerHighest);
}

class _AgePill extends StatelessWidget {
  const _AgePill({required this.days});

  final int days;

  @override
  Widget build(BuildContext context) {
    final tone = _waitTone(context, days);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: tone.bg,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            days == 0 ? 'today' : '$days ${days == 1 ? 'day' : 'days'} ago',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: tone.fg,
            ),
          ),
        ),
      ],
    );
  }
}

class _AllCaught extends StatelessWidget {
  const _AllCaught({required this.patients});

  final int patients;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.accentSoftOn(context),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            Icons.check_circle_rounded,
            color: AppColors.accentOn(context),
            size: 30,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'All caught up',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.accentOn(context),
                  ),
                ),
                const SizedBox(height: 0),
                Text(
                  patients == 0
                      ? 'No patients on the clinic list yet.'
                      : 'Every plan is sent and no review is due.',
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Meals ----------------------------------------------------------------

/// What patients have been eating, across the whole caseload.
///
/// A grid of photographs rather than a list of cards: the dietician is
/// scanning for anything that looks wrong, and four plates side by side answer
/// that faster than four stacked rows of metadata. Tapping one opens the
/// patient it belongs to.
class _MealsCard extends StatelessWidget {
  const _MealsCard({required this.logs});

  final List<DietRecentLog> logs;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: Text(
                  'Latest Meals Logged',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 110,
                child: Text(
                  'Across all active patients',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.25,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          for (var row = 0; row < logs.length; row += 2) ...[
            if (row > 0) const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(child: _MealThumb(log: logs[row])),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child:
                      row + 1 < logs.length
                          ? _MealThumb(log: logs[row + 1])
                          : const SizedBox.shrink(),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// One plate in the grid: the photograph, with whose it was and which meal
/// written over the foot of it.
class _MealThumb extends StatelessWidget {
  const _MealThumb({required this.log});

  final DietRecentLog log;

  static String _label(String mealType) =>
      mealType.isEmpty ? '' : mealType[0].toUpperCase() + mealType.substring(1);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Material(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap:
            () => context.push(
              '/dietician/patients/${log.patientId}',
              extra: log.patientName,
            ),
        child: AspectRatio(
          aspectRatio: 1.12,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (log.photoUrl != null)
                AuthedImage(path: log.photoUrl!, fit: BoxFit.cover)
              else
                Icon(
                  Icons.restaurant_menu_rounded,
                  size: 28,
                  color: scheme.onSurfaceVariant,
                ),
              // A wash under the text, not over the whole photo: the dietician
              // is looking at the food, and dimming all of it to caption it
              // defeats the point of showing a photograph.
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(8, 14, 8, 7),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        const Color(0xFF0B1B33).withValues(alpha: 0),
                        const Color(0xFF0B1B33).withValues(alpha: 0.72),
                      ],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        log.patientName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      if (_label(log.mealType).isNotEmpty)
                        Text(
                          _label(log.mealType),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.white.withValues(alpha: 0.85),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
