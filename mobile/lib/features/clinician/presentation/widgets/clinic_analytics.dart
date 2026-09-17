import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';
import 'health_trend_chart.dart';
import 'sparkline.dart';

/// The population charts for the doctor's home — clinic-wide aggregates, never
/// 100 patient lines. Three cards: how the whole clinic's control is trending,
/// how risk is distributed, and who to look at first.

// ---------------------------------------------------------------------------
// Shared card chrome
// ---------------------------------------------------------------------------

class _Card extends StatelessWidget {
  const _Card({
    required this.icon,
    required this.title,
    this.subtitle,
    required this.child,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, size: 18, color: accent),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 0),
                        child: Text(
                          subtitle!,
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}

Widget _emptyHint(BuildContext context, String text) {
  final scheme = Theme.of(context).colorScheme;
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
    child: Row(
      children: [
        Icon(Icons.insights_rounded, size: 20, color: scheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 14,
              height: 1.35,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    ),
  );
}

// ---------------------------------------------------------------------------
// 1. Clinic glucose-control trend (100% stacked area: low / in-range / high)
// ---------------------------------------------------------------------------

class ClinicControlTrendCard extends StatelessWidget {
  const ClinicControlTrendCard({super.key, required this.analytics});

  final ClinicAnalytics analytics;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final subtitle =
        analytics.totalReadings == 0
            ? null
            : '${analytics.totalReadings} readings · last ${analytics.controlTrend.length} days';

    // The same AGP-style monitoring chart the patient record uses — here it's
    // the clinic-wide average glucose over the target band. The spread band is
    // off: a min/max across every patient would span the full range every day.
    return HealthTrendChart(
      daily: analytics.glucoseDailyOrApprox,
      title: 'Clinic glucose control',
      subtitle: subtitle,
      showSpreadBand: false,
      emptyHint:
          'Not enough readings yet — the clinic trend fills in as patients check in.',
      footer:
          analytics.engagement.length < 2
              ? null
              : Row(
                children: [
                  Icon(
                    Icons.how_to_reg_rounded,
                    size: 16,
                    color: scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Patients checking in / day',
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Sparkline(
                    values: [
                      for (final e in analytics.engagement)
                        e.patients.toDouble(),
                    ],
                    color: AppColors.accentOn(context),
                    width: 84,
                    height: 22,
                    showBand: false,
                  ),
                ],
              ),
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Risk distribution donut
// ---------------------------------------------------------------------------

class RiskDonutCard extends StatelessWidget {
  const RiskDonutCard({super.key, required this.overview});

  final ClinicOverview overview;

  @override
  Widget build(BuildContext context) {
    final low = AppColors.successOn(context);
    final moderate = AppColors.warningOn(context);
    final high = const Color(0xFFF97316); // orange, between warning and danger
    final critical = AppColors.dangerOn(context);

    final segments = <(String, int, Color)>[
      ('Low', overview.riskLow, low),
      ('Moderate', overview.riskModerate, moderate),
      ('High', overview.riskHigh, high),
      ('Critical', overview.riskCritical, critical),
    ];
    final total = segments.fold(0, (s, e) => s + e.$2);

    return _Card(
      icon: Icons.donut_large_rounded,
      title: 'Risk distribution',
      subtitle: total > 0 ? '$total patients' : null,
      child:
          total == 0
              ? _emptyHint(context, 'No risk data yet.')
              : Row(
                children: [
                  SizedBox(
                    width: 118,
                    height: 118,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        PieChart(
                          PieChartData(
                            sectionsSpace: 2,
                            centerSpaceRadius: 34,
                            startDegreeOffset: -90,
                            sections: [
                              for (final s in segments)
                                if (s.$2 > 0)
                                  PieChartSectionData(
                                    value: s.$2.toDouble(),
                                    color: s.$3,
                                    radius: 22,
                                    showTitle: false,
                                  ),
                            ],
                          ),
                        ),
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '$total',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                height: 1,
                              ),
                            ),
                            Text(
                              'patients',
                              style: TextStyle(
                                fontSize: 12,
                                color:
                                    Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final s in segments)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                _dot(s.$3),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    s.$1,
                                    style: const TextStyle(fontSize: 14),
                                  ),
                                ),
                                Text(
                                  '${s.$2}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
    );
  }

  Widget _dot(Color c) => Container(
    width: 10,
    height: 10,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle),
  );
}

// ---------------------------------------------------------------------------
// 3. Top-N "needs attention" with sparklines
// ---------------------------------------------------------------------------

class AttentionListCard extends StatelessWidget {
  const AttentionListCard({super.key, required this.patients, this.max = 6});

  final List<PatientListItem> patients;
  final int max;

  @override
  Widget build(BuildContext context) {
    // Rank: open alerts first, then risk score, then most overdue.
    final ranked = [...patients]..sort((a, b) {
      final alert = b.openAlertCount.compareTo(a.openAlertCount);
      if (alert != 0) return alert;
      final risk = b.riskScore.compareTo(a.riskScore);
      if (risk != 0) return risk;
      return (b.checkInOverdue ? 1 : 0).compareTo(a.checkInOverdue ? 1 : 0);
    });
    final top = ranked.take(max).toList();

    return _Card(
      icon: Icons.priority_high_rounded,
      title: 'Needs Attention',
      subtitle: top.isEmpty ? null : 'Patients ranked by real-time risk score.',
      child:
          top.isEmpty
              ? _emptyHint(context, 'No patients flagged right now.')
              : Column(
                children: [
                  for (var i = 0; i < top.length; i++) ...[
                    if (i > 0)
                      Divider(
                        height: 1,
                        color: Theme.of(
                          context,
                        ).colorScheme.outlineVariant.withValues(alpha: 0.4),
                      ),
                    _AttentionRow(patient: top[i]),
                  ],
                ],
              ),
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({required this.patient});

  final PatientListItem patient;

  String _ago(DateTime at) {
    final d = DateTime.now().difference(at).inDays;
    if (d <= 0) return 'today';
    if (d == 1) return '1d';
    if (d < 21) return '${d}d';
    return '${(d / 7).round()}w';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final riskColor = switch (patient.riskBand) {
      'critical' => AppColors.dangerOn(context),
      'high' => const Color(0xFFF97316),
      'moderate' => AppColors.warningOn(context),
      _ => AppColors.successOn(context),
    };

    return InkWell(
      onTap: () => context.push('/clinician/patients/${patient.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            UserAvatar(
              name: patient.name,
              avatarUrl: patient.avatarUrl,
              accent: riskColor,
              size: 38,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    patient.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  // Wrap, not Row: the risk chip + alerts + recency must never
                  // clip on a narrow phone; they flow to a second line instead.
                  Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 0,
                        ),
                        decoration: BoxDecoration(
                          color: riskColor.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          patient.riskBand,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: riskColor,
                          ),
                        ),
                      ),
                      if (patient.openAlertCount > 0)
                        Text(
                          '${patient.openAlertCount} alert${patient.openAlertCount == 1 ? '' : 's'}',
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.dangerOn(context),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      if (patient.lastReadingAt != null)
                        Text(
                          '· ${_ago(patient.lastReadingAt!)}',
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // HbA1c is the doctor's anchor — show it (value + mini-trend) when
            // available, falling back to the recent glucose sparkline otherwise.
            if (patient.hba1c != null)
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  // Glucose trend (its 70-180 band is meaningful), with HbA1c as
                  // the headline — HbA1c is too infrequent to be the line itself.
                  // See the Patients-tab row for the full reasoning.
                  if (patient.spark.length >= 2)
                    Sparkline(
                      values: patient.spark,
                      color: _hba1cTone(patient.hba1c!, context),
                      width: 56,
                      height: 20,
                    ),
                  Text(
                    '${patient.hba1c!.toStringAsFixed(1)}%',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: _hba1cTone(patient.hba1c!, context),
                    ),
                  ),
                ],
              )
            else if (patient.spark.length >= 2)
              Sparkline(
                values: patient.spark,
                color: AppColors.accentOn(context),
                width: 56,
                height: 22,
              ),
          ],
        ),
      ),
    );
  }
}

Color _hba1cTone(num v, BuildContext c) =>
    v >= 9
        ? AppColors.dangerOn(c)
        : (v >= 7 ? AppColors.warningOn(c) : AppColors.successOn(c));
