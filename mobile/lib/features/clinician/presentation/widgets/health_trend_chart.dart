import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../domain/patient_summary.dart';

/// The general glucose target band (70-180 mg/dL) shaded purely as a visual
/// reference — the same band the patient's own chart uses.
const double _targetLow = 70;
const double _targetHigh = 180;

/// An AGP-style glucose monitoring graph: a daily-average line over the shaded
/// target range, optionally inside the day's low→high spread band.
///
/// Reused in two places: one PATIENT's record (with the spread band), and the
/// doctor's home tab for the whole CLINIC's average (band off — a min/max across
/// every patient would just span the full range every day). Parameterised so
/// both read identically apart from that.
class HealthTrendChart extends StatelessWidget {
  const HealthTrendChart({
    super.key,
    required this.daily,
    this.title = 'Glucose monitoring',
    this.subtitle,
    this.emptyHint,
    this.showSpreadBand = true,
    this.footer,
  });

  final List<GlucoseDailyPoint> daily;
  final String title;
  final String? subtitle;
  final String? emptyHint;

  /// The low→high band around the average. Meaningful for one patient; off for
  /// the clinic average, where it would span hypo→hyper every day.
  final bool showSpreadBand;

  /// Optional widget below the legend (e.g. the clinic's check-in engagement).
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);

    // A single day can't make a trend; keep it clean until there are at least
    // two points to draw a line between.
    if (daily.length < 2) {
      return _Frame(
        title: title,
        subtitle: subtitle,
        scheme: scheme,
        accent: accent,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
          child: Row(
            children: [
              Icon(
                Icons.show_chart_rounded,
                color: scheme.onSurfaceVariant,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  emptyHint ??
                      (daily.isEmpty
                          ? 'No glucose readings yet. The graph fills in as patients check in.'
                          : 'One reading so far — the trend appears after the next check-in.'),
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final avgs = daily.map((d) => d.average.toDouble()).toList();
    final double lowest;
    final double highest;
    if (showSpreadBand) {
      lowest = daily
          .map((d) => d.min.toDouble())
          .reduce((a, b) => a < b ? a : b);
      highest = daily
          .map((d) => d.max.toDouble())
          .reduce((a, b) => a > b ? a : b);
    } else {
      lowest = avgs.reduce((a, b) => a < b ? a : b);
      highest = avgs.reduce((a, b) => a > b ? a : b);
    }

    // Keep the target band in view even when every reading sits well inside it.
    final minY =
        ((lowest < _targetLow ? lowest : _targetLow) - 20)
            .clamp(0, double.infinity)
            .toDouble();
    final maxY = (highest > _targetHigh ? highest : _targetHigh) + 20;
    final lastIndex = daily.length - 1;
    final avgBarIndex = showSpreadBand ? 2 : 0;

    final avgBar = LineChartBarData(
      spots: [
        for (var i = 0; i < daily.length; i++)
          FlSpot(i.toDouble(), daily[i].average.toDouble()),
      ],
      isCurved: true,
      curveSmoothness: 0.2,
      color: accent,
      barWidth: 2.6,
      belowBarData: BarAreaData(
        show: !showSpreadBand,
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            accent.withValues(alpha: 0.20),
            accent.withValues(alpha: 0.0),
          ],
        ),
      ),
      dotData: FlDotData(
        // Emphasise only the latest point — where things are now.
        checkToShowDot: (spot, _) => spot.x == lastIndex.toDouble(),
        getDotPainter:
            (spot, _, __, ___) => FlDotCirclePainter(
              radius: 4.5,
              color: accent,
              strokeWidth: 2.5,
              strokeColor: scheme.surface,
            ),
      ),
    );

    return _Frame(
      title: title,
      subtitle: subtitle,
      scheme: scheme,
      accent: accent,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 196,
            child: LineChart(
              LineChartData(
                minX: 0,
                maxX: lastIndex.toDouble(),
                minY: minY,
                maxY: maxY,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: 60,
                  getDrawingHorizontalLine:
                      (v) => FlLine(
                        color: scheme.outlineVariant.withValues(alpha: 0.4),
                        strokeWidth: 0.5,
                      ),
                ),
                rangeAnnotations: RangeAnnotations(
                  horizontalRangeAnnotations: [
                    HorizontalRangeAnnotation(
                      y1: _targetLow,
                      y2: _targetHigh,
                      color: AppColors.successOn(
                        context,
                      ).withValues(alpha: 0.09),
                    ),
                  ],
                ),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 34,
                      interval: 60,
                      getTitlesWidget:
                          (value, meta) => Text(
                            value.toInt().toString(),
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                          ),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 24,
                      interval:
                          (daily.length / 4)
                              .clamp(1, double.infinity)
                              .toDouble(),
                      getTitlesWidget: (value, meta) {
                        final i = value.toInt();
                        if (i < 0 || i >= daily.length)
                          return const SizedBox.shrink();
                        return Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            DateFormat('d/M').format(daily[i].date),
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                lineTouchData: LineTouchData(
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipColor: (_) => scheme.inverseSurface,
                    getTooltipItems:
                        (spots) =>
                            spots.map((s) {
                              if (s.barIndex != avgBarIndex) return null;
                              final d = daily[s.x.toInt()];
                              return LineTooltipItem(
                                '${d.average} mg/dL\n',
                                TextStyle(
                                  color: scheme.onInverseSurface,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 14,
                                ),
                                children: [
                                  TextSpan(
                                    text:
                                        showSpreadBand
                                            ? 'range ${d.min}–${d.max} · ${DateFormat('d MMM').format(d.date)}'
                                            : DateFormat(
                                              'd MMM',
                                            ).format(d.date),
                                    style: TextStyle(
                                      color: scheme.onInverseSurface.withValues(
                                        alpha: 0.75,
                                      ),
                                      fontWeight: FontWeight.w400,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              );
                            }).toList(),
                  ),
                ),
                // With the band on, bars 0/1 are the invisible spread edges and
                // bar 2 is the average; with it off, the average is the only bar.
                betweenBarsData: [
                  if (showSpreadBand)
                    BetweenBarsData(
                      fromIndex: 0,
                      toIndex: 1,
                      color: accent.withValues(alpha: 0.11),
                    ),
                ],
                lineBarsData: [
                  if (showSpreadBand) ...[
                    _edge([
                      for (var i = 0; i < daily.length; i++)
                        FlSpot(i.toDouble(), daily[i].min.toDouble()),
                    ]),
                    _edge([
                      for (var i = 0; i < daily.length; i++)
                        FlSpot(i.toDouble(), daily[i].max.toDouble()),
                    ]),
                  ],
                  avgBar,
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            children: [
              _LegendDot(
                color: accent,
                label: showSpreadBand ? 'Daily average' : 'Average glucose',
              ),
              if (showSpreadBand)
                _LegendDot(
                  color: accent.withValues(alpha: 0.28),
                  label: 'Low–high range',
                  square: true,
                ),
              _LegendDot(
                color: AppColors.successOn(context).withValues(alpha: 0.35),
                label: 'Target 70–180',
                square: true,
              ),
            ],
          ),
          if (footer != null) ...[
            const SizedBox(height: AppSpacing.md),
            Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.4),
            ),
            const SizedBox(height: AppSpacing.sm),
            footer!,
          ],
        ],
      ),
    );
  }

  /// An invisible line whose only job is to bound the shaded spread band.
  static LineChartBarData _edge(List<FlSpot> spots) => LineChartBarData(
    spots: spots,
    isCurved: true,
    curveSmoothness: 0.2,
    barWidth: 0,
    color: Colors.transparent,
    dotData: const FlDotData(show: false),
  );
}

/// The card chrome shared by the chart and its empty state.
class _Frame extends StatelessWidget {
  const _Frame({
    required this.scheme,
    required this.accent,
    required this.child,
    required this.title,
    this.subtitle,
  });

  final ColorScheme scheme;
  final Color accent;
  final Widget child;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
      ),
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
                child: Icon(
                  Icons.monitor_heart_rounded,
                  size: 18,
                  color: accent,
                ),
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
          const SizedBox(height: AppSpacing.sm),
          child,
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({
    required this.color,
    required this.label,
    this.square = false,
  });

  final Color color;
  final String label;
  final bool square;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 11,
          height: square ? 9 : 11,
          decoration: BoxDecoration(
            color: color,
            shape: square ? BoxShape.rectangle : BoxShape.circle,
            borderRadius: square ? BorderRadius.circular(12) : null,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
