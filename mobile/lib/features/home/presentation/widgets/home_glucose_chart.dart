import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/providers/preferences_provider.dart';
import '../../../glucose/domain/glucose_trends.dart';

/// The general adult target band, 70–180 mg/dL.
///
/// `GET /glucose/trends` does not publish a per-patient band, so this is drawn
/// purely as a visual reference and labelled as such on the chart. The
/// authoritative judgement on any single reading is still the server's
/// `flag`, which is what every status word on this screen is derived from —
/// the shading never decides whether a reading was in range.
const double kTargetLowMgdl = 70;
const double kTargetHighMgdl = 180;

/// A stretch of the line: readings close enough together that joining them
/// says something true.
class GlucoseRun {
  const GlucoseRun(this.mean, this.low, this.high);

  final List<FlSpot> mean;
  final List<FlSpot> low;
  final List<FlSpot> high;
}

/// Splits [mean] (and its spread, when bucketed) wherever two neighbours sit
/// further apart than [maxStep] milliseconds.
///
/// A straight line from Monday's reading to Friday's claims the four days
/// between went that way. Nobody measured them. So the line breaks there, and
/// the break is bridged with a faint dashed stroke — visibly not data — rather
/// than dropped to the floor, which would draw "no readings" as a reading of
/// zero.
List<GlucoseRun> splitRuns(
  List<FlSpot> mean, {
  List<FlSpot> low = const [],
  List<FlSpot> high = const [],
  required double maxStep,
}) {
  final runs = <GlucoseRun>[];
  var start = 0;
  for (var i = 1; i <= mean.length; i++) {
    final atEnd = i == mean.length;
    if (atEnd || mean[i].x - mean[i - 1].x > maxStep) {
      runs.add(
        GlucoseRun(
          mean.sublist(start, i),
          low.isEmpty ? const [] : low.sublist(start, i),
          high.isEmpty ? const [] : high.sublist(start, i),
        ),
      );
      start = i;
    }
  }
  return runs;
}

/// How far apart two readings may be and still be joined by a solid line.
///
/// Relative to how this patient actually logs: somebody who checks every third
/// day, as the app asks, gets a solid line at that rhythm, and a week without a
/// reading shows as the gap it is. Never less than three days, so an ordinary
/// weekend off does not turn a daily logger's chart into dashes.
double maxJoinStep(List<FlSpot> spots) {
  const day = 86400000.0;
  if (spots.length < 3) return 3 * day;
  final steps = [
    for (var i = 1; i < spots.length; i++) spots[i].x - spots[i - 1].x,
  ]..sort();
  final median = steps[steps.length ~/ 2];
  final step = median * 2.5;
  return step < 3 * day ? 3 * day : step;
}

/// The patient's trend, drawn to be read at a glance rather than studied.
///
/// Things this chart deliberately does:
///
///  * Labels only the gridlines it computed. fl_chart draws a tick at the axis
///    minimum and maximum as well as at the interval, so "450" and "400" landed
///    a few pixels apart; anything off the grid is dropped.
///  * Draws the dates as a row under the plot rather than as the chart's own
///    labels, so the first and last sit inside the edges by construction.
///  * Snaps the y scale to a round step, so the gridlines read 100 / 200 / 300.
///  * Breaks the line across a stretch with no readings, and says so in the
///    key. It used to join every reading to the next with the same stroke, so
///    four days with nothing logged looked exactly like four days of data.
///  * Marks only the readings worth looking at: those outside the band, and
///    the latest.
class HomeGlucoseChart extends StatelessWidget {
  const HomeGlucoseChart({super.key, required this.points, required this.unit});

  final List<GlucoseTrendPoint> points;
  final GlucoseUnit unit;

  /// A step the eye can count in. Chosen so the axis lands on 4 or 5 lines.
  static double _niceStep(double range) {
    const candidates = <double>[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
    for (final c in candidates) {
      if (range / c <= 4.5) return c;
    }
    return 1000;
  }

  String _tick(double v) =>
      unit == GlucoseUnit.mgdl ? v.round().toString() : v.toStringAsFixed(1);

  /// At most this many points are ever drawn. Beyond it the line stops being
  /// a trend and becomes texture.
  static const int _maxPoints = 60;

  /// Buckets [dated] by whole days when there are too many readings to draw,
  /// returning the mean line plus the low/high of each bucket, and the bucket
  /// width (zero when nothing was bucketed).
  ({List<FlSpot> mean, List<FlSpot> low, List<FlSpot> high, int days}) _bucket(
    List<GlucoseTrendPoint> dated,
  ) {
    double y(GlucoseTrendPoint p) => unit.fromMgdl(p.value);
    double x(GlucoseTrendPoint p) => p.at!.millisecondsSinceEpoch.toDouble();

    if (dated.length <= _maxPoints) {
      return (
        mean: [for (final p in dated) FlSpot(x(p), y(p))],
        low: const [],
        high: const [],
        days: 0,
      );
    }

    const day = 86400000.0;
    final span = x(dated.last) - x(dated.first);
    final days = (span / _maxPoints / day).ceil().clamp(1, 30);
    final width = days * day;
    final origin = x(dated.first);

    final groups = <int, List<GlucoseTrendPoint>>{};
    for (final p in dated) {
      groups.putIfAbsent(((x(p) - origin) / width).floor(), () => []).add(p);
    }

    final keys = groups.keys.toList()..sort();
    final mean = <FlSpot>[];
    final low = <FlSpot>[];
    final high = <FlSpot>[];
    for (final k in keys) {
      final values = groups[k]!.map(y).toList();
      final at = origin + (k + 0.5) * width;
      mean.add(FlSpot(at, values.reduce((a, b) => a + b) / values.length));
      low.add(FlSpot(at, values.reduce((a, b) => a < b ? a : b)));
      high.add(FlSpot(at, values.reduce((a, b) => a > b ? a : b)));
    }
    return (mean: mean, low: low, high: high, days: days);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();

    // Only points with a timestamp can be placed on a time axis. A reading
    // with no `at` is real data, but it has no position — dropping it is
    // honest; inventing one would not be.
    final dated =
        points.where((p) => p.at != null).toList()
          ..sort((a, b) => a.at!.compareTo(b.at!));
    if (dated.length < 2) return const SizedBox.shrink();

    final agg = _bucket(dated);
    final spots = agg.mean;
    final firstX = spots.first.x;
    final lastX = spots.last.x;
    // Several readings inside one minute collapse the domain to an instant,
    // and dividing by that drew a path with no bounds. There is no trend in a
    // zero-length window to draw anyway.
    if (lastX <= firstX) return const SizedBox.shrink();

    const day = 86400000.0;
    final runs = splitRuns(
      spots,
      low: agg.low,
      high: agg.high,
      maxStep: agg.days > 0 ? agg.days * day * 1.5 : maxJoinStep(spots),
    );
    final hasGap = runs.length > 1;

    // Marks are coloured by the server's own flag for that reading. Re-deriving
    // "how high is too high" here would be a second copy of a clinical
    // threshold, and the one that goes stale silently.
    final flagAt = <double, String?>{
      for (final p in dated) p.at!.millisecondsSinceEpoch.toDouble(): p.flag,
    };
    bool critical(String? f) =>
        f == 'critical_high' ||
        f == 'severe_high' ||
        f == 'very_high' ||
        f == 'severe_low';

    final lowT = unit.fromMgdl(kTargetLowMgdl);
    final highT = unit.fromMgdl(kTargetHighMgdl);

    bool marked(FlSpot s) =>
        s.x == lastX ||
        // Once the line is an average the shaded spread already carries where
        // the readings went, so a dot per bucket would be decoration.
        (agg.days == 0 && spots.length <= 40 && (s.y < lowT || s.y > highT));
    final anyOut = spots.any((s) => marked(s) && (s.y < lowT || s.y > highT));
    final anyCritical = dated.any((p) => critical(p.flag)) && agg.days == 0;

    // The band stays fully visible even when every reading sits above it: a
    // target you cannot see is not a reference.
    final ys = [
      ...spots.map((s) => s.y),
      ...agg.high.map((s) => s.y),
      ...agg.low.map((s) => s.y),
    ];
    final dataLo = [...ys, lowT].reduce((a, b) => a < b ? a : b);
    final dataHi = [...ys, highT].reduce((a, b) => a > b ? a : b);
    final base = unit == GlucoseUnit.mgdl ? 50.0 : 2.0;
    var lo = (dataLo / base).floorToDouble() * base;
    var hi = (dataHi / base).ceilToDouble() * base;
    if (lo < 0) lo = 0;
    if (hi <= lo) hi = lo + base * 4;

    var step = _niceStep(hi - lo);
    for (var guard = 0; guard < 6; guard++) {
      final count = (hi / step).floorToDouble() - (lo / step).ceilToDouble() + 1;
      if (count >= 3 || step < 1) break;
      step /= 2;
    }

    // A dot centred on the axis end is half outside it; a little room at each
    // end keeps the newest reading whole.
    final pad = (lastX - firstX) * 0.03;

    final axisStyle = T.label.copyWith(
      fontWeight: FontWeight.w500,
      letterSpacing: 0,
      color: T.inkMuted,
    );
    final gutter = MediaQuery.textScalerOf(context).scale(T.s8 + T.s1);

    final ticks = [
      for (var i = 0; i < 5; i++)
        DateTime.fromMillisecondsSinceEpoch(
          (firstX + (lastX - firstX) * i / 4).round(),
        ),
    ];
    final spanDays = (lastX - firstX) / day;
    var dates = <String>[];
    for (final pattern in [if (spanDays > 150) 'MMM', 'd MMM', 'd MMM, ha', 'h:mm a']) {
      dates = [for (final t in ticks) DateFormat(pattern, locale).format(t)];
      if (dates.toSet().length == dates.length) break;
    }

    // Order matters for the spread fill: every run's high and low come first,
    // in pairs, so BetweenBarsData can address them by index.
    final spread = <LineChartBarData>[];
    final between = <BetweenBarsData>[];
    for (final run in runs) {
      if (run.high.isEmpty) continue;
      between.add(
        BetweenBarsData(
          fromIndex: spread.length,
          toIndex: spread.length + 1,
          color: T.primary.withValues(alpha: 0.12),
        ),
      );
      spread
        ..add(_invisible(run.high))
        ..add(_invisible(run.low));
    }
    final meanBars = [
      for (final run in runs)
        LineChartBarData(
          spots: run.mean,
          // Straight segments. A spline through 200 → 438 → 300 invents a
          // curve nobody measured.
          isCurved: false,
          color: T.primary,
          barWidth: 2.5,
          dotData: FlDotData(
            show: true,
            checkToShowDot: (s, _) => marked(s),
            getDotPainter: (s, _, _, _) {
              final out = s.y < lowT || s.y > highT;
              final tone =
                  critical(flagAt[s.x])
                      ? T.danger
                      : out
                      ? T.warning
                      : T.primary;
              return FlDotCirclePainter(
                radius: 4.5,
                color: out ? tone : Colors.white,
                strokeWidth: 2,
                strokeColor: out ? Colors.white : tone,
              );
            },
          ),
        ),
    ];
    final bridges = [
      for (var i = 1; i < runs.length; i++)
        LineChartBarData(
          spots: [runs[i - 1].mean.last, runs[i].mean.first],
          isCurved: false,
          color: T.inkFaint,
          barWidth: 1.5,
          dashArray: const [4, 5],
          dotData: const FlDotData(show: false),
        ),
    ];
    final meanStart = spread.length;
    final meanEnd = meanStart + meanBars.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          agg.days == 0
              ? unit.label
              : '${unit.label} · ${l10n.ptChartDailyAverage(agg.days)}',
          style: axisStyle,
        ),
        const SizedBox(height: T.s2),
        SizedBox(
          height: 180,
          child: LineChart(
            LineChartData(
              minX: firstX - pad,
              maxX: lastX + pad,
              minY: lo,
              maxY: hi,
              clipData: const FlClipData.all(),
              gridData: FlGridData(
                drawVerticalLine: false,
                horizontalInterval: step,
                getDrawingHorizontalLine:
                    (_) => const FlLine(color: T.line, strokeWidth: 1),
              ),
              rangeAnnotations: RangeAnnotations(
                horizontalRangeAnnotations: [
                  HorizontalRangeAnnotation(
                    y1: lowT,
                    y2: highT,
                    color: T.success.withValues(alpha: 0.08),
                  ),
                ],
              ),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(),
                rightTitles: const AxisTitles(),
                bottomTitles: const AxisTitles(),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: gutter,
                    interval: step,
                    getTitlesWidget: (v, _) {
                      final k = v / step;
                      if ((k - k.roundToDouble()).abs() > 0.01) {
                        return const SizedBox.shrink();
                      }
                      return Padding(
                        padding: const EdgeInsets.only(right: T.s2),
                        child: Text(
                          _tick(v),
                          textAlign: TextAlign.right,
                          style: axisStyle,
                        ),
                      );
                    },
                  ),
                ),
              ),
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipColor: (_) => T.ink,
                  tooltipRoundedRadius: T.rControl,
                  getTooltipItems:
                      (touched) => [
                        for (final t in touched)
                          t.barIndex >= meanStart && t.barIndex < meanEnd
                              ? LineTooltipItem(
                                '${_tick(t.y)} ${unit.label}\n'
                                '${DateFormat('d MMM, h:mm a', locale).format(DateTime.fromMillisecondsSinceEpoch(t.x.round()))}',
                                T.label.copyWith(color: Colors.white),
                              )
                              : null,
                      ],
                ),
              ),
              betweenBarsData: between,
              lineBarsData: [...spread, ...meanBars, ...bridges],
            ),
          ),
        ),
        const SizedBox(height: T.s2),
        Padding(
          padding: EdgeInsets.only(left: gutter),
          // As many of the five dates as fit side by side: all five, or the
          // ends and the middle, or only the ends. "20 Aug" is short; its
          // Bengali is not, and five of those ran off the card.
          child: LayoutBuilder(
            builder: (context, box) {
              final scaler = MediaQuery.textScalerOf(context);
              double widthOf(String label) {
                final painter = TextPainter(
                  text: TextSpan(text: label, style: axisStyle),
                  textDirection: Directionality.of(context),
                  textScaler: scaler,
                )..layout();
                final width = painter.width;
                painter.dispose();
                return width;
              }

              double widest(List<String> labels) =>
                  labels.map(widthOf).reduce((a, b) => a > b ? a : b);
              var shown = dates;
              for (final pick in [
                dates,
                [dates[0], dates[2], dates[4]],
                [dates[0], dates[4]],
              ]) {
                shown = pick;
                if (widest(pick) * pick.length + T.s3 * (pick.length - 1) <=
                    box.maxWidth) {
                  break;
                }
              }
              return Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [for (final d in shown) Text(d, style: axisStyle)],
              );
            },
          ),
        ),
        const SizedBox(height: T.s3),
        // A key with words, and only the entries this chart actually draws.
        Wrap(
          spacing: T.s4,
          runSpacing: T.s2,
          children: [
            _Key.band(label: l10n.ptChartTargetBand(_tick(lowT), _tick(highT))),
            if (anyOut) _Key.dot(color: T.warning, label: l10n.ptChartOutsideTarget),
            if (anyCritical)
              _Key.dot(color: T.danger, label: l10n.ptReadingNeedsAttention),
            if (hasGap) _Key.gap(label: l10n.ptChartNoReadings),
          ],
        ),
      ],
    );
  }

  static LineChartBarData _invisible(List<FlSpot> spots) => LineChartBarData(
    spots: spots,
    isCurved: false,
    barWidth: 0,
    color: Colors.transparent,
    dotData: const FlDotData(show: false),
  );
}

/// One legend entry: a swatch and the word for it.
class _Key extends StatelessWidget {
  const _Key._({required this.label, required this.swatch});

  factory _Key.band({required String label}) => _Key._(
    label: label,
    swatch: Container(
      width: T.s4,
      height: T.s3,
      decoration: BoxDecoration(
        color: T.success.withValues(alpha: 0.14),
        border: Border.all(color: T.success.withValues(alpha: 0.4)),
        borderRadius: T.rFull,
      ),
    ),
  );

  factory _Key.dot({required Color color, required String label}) => _Key._(
    label: label,
    swatch: Container(
      width: T.s3,
      height: T.s3,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    ),
  );

  factory _Key.gap({required String label}) => _Key._(
    label: label,
    swatch: const SizedBox(
      width: T.s4,
      height: T.s3,
      child: CustomPaint(painter: _DashPainter()),
    ),
  );

  final String label;
  final Widget swatch;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      swatch,
      const SizedBox(width: T.s1),
      Text(
        label,
        style: T.label.copyWith(
          fontWeight: FontWeight.w500,
          letterSpacing: 0,
          color: T.inkMuted,
        ),
      ),
    ],
  );
}

class _DashPainter extends CustomPainter {
  const _DashPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint =
        Paint()
          ..color = T.inkFaint
          ..strokeWidth = 1.5;
    final y = size.height / 2;
    for (var x = 0.0; x < size.width; x += 7) {
      canvas.drawLine(Offset(x, y), Offset((x + 4).clamp(0, size.width), y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
