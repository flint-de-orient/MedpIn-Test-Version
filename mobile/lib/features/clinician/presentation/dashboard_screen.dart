import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/load_failed.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../appointments/presentation/widgets/appointment_visuals.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_visuals.dart';

/// The clinician home: headline numbers, today's diary, and the open clinical
/// alerts that need attention — all refreshing live.
class ClinicianDashboardScreen extends ConsumerWidget {
  const ClinicianDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final overview = ref.watch(overviewProvider);
    final bounds = todayBounds();
    // Upcoming (today onward) rather than today-only, so a just-booked future
    // appointment shows here immediately.
    final AppointmentQuery upcomingQuery = (
      from: bounds.from,
      to: null,
      status: null,
      clinicId: null,
    );
    final todays = ref.watch(appointmentDiaryProvider(upcomingQuery));
    final openAlerts = ref.watch(
      alertsProvider((status: 'open', severity: null)),
    );

    final hour = DateTime.now().hour;
    final greeting =
        hour < 12
            ? 'Good morning'
            : (hour < 17 ? 'Good afternoon' : 'Good evening');
    final roleLabel = user?.role == 'doctor' ? 'Doctor' : 'Clinic staff';

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: AppSpacing.md,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '$greeting,',
              style: TextStyle(
                fontSize: 14,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            Text(
              user?.name ?? roleLabel,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: Chip(
              label: Text(roleLabel),
              visualDensity: VisualDensity.compact,
              side: BorderSide.none,
            ),
          ),
        ],
      ),
      body: AutoRefresh(
        onTick: (r) {
          r.invalidate(overviewProvider);
          r.invalidate(appointmentDiaryProvider(upcomingQuery));
          r.invalidate(alertsProvider((status: 'open', severity: null)));
        },
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(overviewProvider);
            ref.invalidate(appointmentDiaryProvider(upcomingQuery));
            ref.invalidate(alertsProvider((status: 'open', severity: null)));
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              AppSpacing.xl,
            ),
            children: [
              overview.when(
                loading: () => const _StatsSkeleton(),
                error:
                    (_, _) => LoadFailed(
                      what: 'the overview',
                      onRetry: () => ref.invalidate(overviewProvider),
                    ),
                data: (o) => _OverviewSection(overview: o),
              ),
              const SizedBox(height: AppSpacing.lg),
              _SectionHeader(
                title: 'Upcoming appointments',
                actionLabel: 'View all',
                onAction: () => context.go('/clinician/appointments'),
              ),
              const SizedBox(height: AppSpacing.sm),
              todays.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.all(AppSpacing.lg),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => LoadFailed(
                      what: "today's appointments",
                      onRetry:
                          () => ref.invalidate(
                            appointmentDiaryProvider(upcomingQuery),
                          ),
                    ),
                data: (paged) {
                  final items =
                      paged.items.where((a) => !a.isCancelled).toList()
                        ..sort((a, b) => a.sortKey.compareTo(b.sortKey));
                  if (items.isEmpty) {
                    return const _EmptyCard(
                      icon: Icons.event_available_outlined,
                      text: 'No upcoming appointments',
                    );
                  }
                  return Column(
                    children: [
                      for (final a in items.take(4))
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: AppointmentCard(
                            appointment: a,
                            clinicianView: true,
                          ),
                        ),
                      if (items.length > 4)
                        TextButton(
                          onPressed:
                              () => context.go('/clinician/appointments'),
                          child: Text('+${items.length - 4} more'),
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: AppSpacing.md),
              _SectionHeader(
                title: 'Open alerts',
                actionLabel: 'Manage',
                onAction: () => context.push('/clinician/alerts'),
              ),
              const SizedBox(height: AppSpacing.sm),
              openAlerts.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.all(AppSpacing.lg),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => LoadFailed(
                      what: 'the alerts',
                      onRetry:
                          () => ref.invalidate(
                            alertsProvider((status: 'open', severity: null)),
                          ),
                    ),
                data: (paged) {
                  if (paged.items.isEmpty) {
                    return const _EmptyCard(
                      icon: Icons.verified_outlined,
                      text: 'No open alerts — all clear',
                    );
                  }
                  return Column(
                    children: [
                      for (final a in paged.items.take(4))
                        _AlertRow(
                          alert: a,
                          onTap: () => context.push('/clinician/alerts'),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OverviewSection extends StatelessWidget {
  const _OverviewSection({required this.overview});
  final ClinicOverview overview;

  @override
  Widget build(BuildContext context) {
    final o = overview;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _StatTile(
                icon: Icons.groups_rounded,
                color: AppColors.accentOn(context),
                value: '${o.patientCount}',
                label: 'Patients',
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: _StatTile(
                icon: Icons.today_rounded,
                color: AppColors.successOn(context),
                value: '${o.appointmentsToday}',
                label: 'Appts today',
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(
              child: _StatTile(
                icon: Icons.monitor_heart_rounded,
                color: const Color(0xFF7C3AED),
                value: '${o.activeToday}',
                label: 'Active today',
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: _StatTile(
                icon: Icons.warning_amber_rounded,
                color:
                    o.totalOpenAlerts > 0
                        ? AppColors.danger
                        : AppColors.success,
                value: '${o.totalOpenAlerts}',
                label: 'Open alerts',
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        _RiskDistribution(overview: o),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.color,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color color;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
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

class _RiskDistribution extends StatelessWidget {
  const _RiskDistribution({required this.overview});
  final ClinicOverview overview;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final o = overview;
    final total = (o.riskLow + o.riskModerate + o.riskHigh + o.riskCritical)
        .clamp(1, 1 << 30);
    final segments = [
      ('Low', o.riskLow, riskBandColor('low')),
      ('Moderate', o.riskModerate, riskBandColor('moderate')),
      ('High', o.riskHigh, riskBandColor('high')),
      ('Critical', o.riskCritical, riskBandColor('critical')),
    ];

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Risk distribution',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Row(
              children: [
                for (final s in segments)
                  if (s.$2 > 0)
                    Expanded(
                      flex: s.$2,
                      child: Container(height: 10, color: s.$3),
                    ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: 4,
            children: [
              for (final s in segments)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: s.$3,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${s.$1} ${s.$2}',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ],
                ),
            ],
          ),
          Text(
            'of $total patients',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  const _AlertRow({required this.alert, required this.onTap});
  final ClinicalAlert alert;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = alertSeverityColor(alert.severity);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
            border: Border(left: BorderSide(color: color, width: 4)),
          ),
          child: Row(
            children: [
              Icon(
                Icons.notification_important_rounded,
                color: color,
                size: 20,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      alert.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    if (alert.patientName != null)
                      Text(
                        alert.patientName!,
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
              MiniPill(label: alert.severity.toUpperCase(), color: color),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.actionLabel, this.onAction});
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        const Spacer(),
        if (actionLabel != null)
          TextButton(onPressed: onAction, child: Text(actionLabel!)),
      ],
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          Icon(icon, color: scheme.onSurfaceVariant),
          const SizedBox(width: AppSpacing.sm),
          Text(text, style: TextStyle(color: scheme.onSurfaceVariant)),
        ],
      ),
    );
  }
}

class _StatsSkeleton extends StatelessWidget {
  const _StatsSkeleton();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 120,
      child: Center(child: CircularProgressIndicator()),
    );
  }
}
