import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
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

/// The patient's trend, drawn to be read at a glance rather than studied.
///
/// Three things were wrong with the first version and all three were the same
/// mistake — letting the chart library decide what to label.
///
///  * fl_chart draws a tick at the axis minimum and maximum *as well as* the
///    ticks at your interval, so "450" and "400" ended up a few pixels apart
///    on the left and "17 Aug" landed under "21 Aug" on the right. Both axes
///    are now filtered to the positions this widget computed; anything else
///    is dropped.
///  * The dates are an ordinary Row underneath the plot rather than the
///    chart's own labels, because a label centred on the last tick always
///    half-overhangs the widget and gets clipped. Spaced along a row, the
///    first and last sit inside the edges by construction.
///  * The y scale snaps to a round step — 25, 50, 100 — so the gridlines read
///    50 / 150 / 250 rather than whatever four equal slices of the data
///    happened to come to.
///
/// A dot per reading was also too much ink over a month. Only the readings
/// outside the band are marked now, plus the most recent one, so a mark means
/// "look at this" rather than "here is a data point".
class HomeGlucoseChart extends StatelessWidget {
  const HomeGlucoseChart({super.key, required this.points, required this.unit});

  final List<GlucoseTrendPoint> points;
  final GlucoseUnit unit;

  /// Width of the y-axis gutter. Shared by the chart and by the date row
  /// below it, so the dates line up with the plot and not with the card.
  static const double _gutter = 38;

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

  /// Buckets [dated] by time when there are too many readings to draw, and
  /// returns the mean line plus the low/high envelope of each bucket.
  _Series _bucket(List<GlucoseTrendPoint> dated) {
    double y(GlucoseTrendPoint p) => unit.fromMgdl(p.value);
    double x(GlucoseTrendPoint p) => p.at!.millisecondsSinceEpoch.toDouble();

    if (dated.length <= _maxPoints) {
      return _Series(
        mean: [for (final p in dated) FlSpot(x(p), y(p))],
        low: const [],
        high: const [],
        label: null,
      );
    }

    const day = 86400000.0;
    final span = x(dated.last) - x(dated.first);
    // Whole days, never a fraction: a bucket that straddles midnight is a
    // bucket a patient cannot reason about.
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
      final g = groups[k]!;
      final at = origin + (k + 0.5) * width;
      final vs = g.map(y).toList();
      mean.add(FlSpot(at, vs.reduce((a, b) => a + b) / vs.length));
      low.add(FlSpot(at, vs.reduce((a, b) => a < b ? a : b)));
      high.add(FlSpot(at, vs.reduce((a, b) => a > b ? a : b)));
    }

    return _Series(
      mean: mean,
      low: low,
      high: high,
      label: days == 1 ? 'Daily average' : '$days-day average',
    );
  }

  @override
  Widget build(BuildContext context) {
    // Only points with a timestamp can be placed on a time axis. A reading
    // with no `at` is real data, but it has no position — dropping it is
    // honest; inventing one would not be.
    final dated =
        points.where((p) => p.at != null).toList()
          ..sort((a, b) => a.at!.compareTo(b.at!));
    if (dated.length < 2) return const SizedBox.shrink();

    // Six months of raw readings is several hundred points: the line becomes
    // a solid zigzag and every out-of-range dot lands on top of its
    // neighbours. Past a threshold the readings are bucketed by time and the
    // chart draws the average with the day's spread shaded behind it — which
    // is more informative than the zigzag was, not less, and is labelled so
    // nobody reads an average as a reading.
    final agg = _bucket(dated);
    final spots = agg.mean;

    // Marks are coloured by the server's own flag for that reading, keyed by
    // its timestamp. Re-deriving "how high is too high" in the client would be
    // a second copy of a clinical threshold, and the one that goes stale
    // silently when the clinic changes its bands.
    final flagAt = <double, String?>{
      for (final p in dated) p.at!.millisecondsSinceEpoch.toDouble(): p.flag,
    };
    bool critical(String? f) =>
        f == 'critical_high' ||
        f == 'severe_high' ||
        f == 'very_high' ||
        f == 'severe_low';
    final anyCritical = dated.any((p) => critical(p.flag));

    final lowT = unit.fromMgdl(kTargetLowMgdl);
    final highT = unit.fromMgdl(kTargetHighMgdl);

    // The band stays fully visible even when every reading sits above it: a
    // target you cannot see is not a reference.
    final ys = spots.map((s) => s.y).toList();
    final dataLo = [...ys, lowT].reduce((a, b) => a < b ? a : b);
    final dataHi = [...ys, highT].reduce((a, b) => a > b ? a : b);

    // Snapped to a fine granularity, not to the label step. Rounding a floor
    // of 70 out to the nearest 100 gave the plot an empty 0–70 strip along the
    // bottom — a seventh of the height spent on values nobody recorded.
    final base = unit == GlucoseUnit.mgdl ? 50.0 : 2.0;
    var lo = (dataLo / base).floorToDouble() * base;
    var hi = (dataHi / base).ceilToDouble() * base;
    if (lo < 0) lo = 0;
    if (hi <= lo) hi = lo + base * 4;

    // Gridlines are multiples of the step counted from zero — 100, 200, 300 —
    // not from the axis floor. fl_chart generates its ticks that way, and the
    // filter below has to agree with it or every label is discarded, which is
    // exactly what happened: the axis came out bare except for its floor.
    var step = _niceStep(hi - lo);
    var guard = 0;
    while (guard++ < 6) {
      final count =
          (hi / step).floorToDouble() - (lo / step).ceilToDouble() + 1;
      if (count >= 3) break;
      step /= 2;
      if (step < 1) break;
    }

    // A dot centred exactly on the axis end is half outside it, and
    // FlClipData cuts the half that matters — the newest reading. A little
    // breathing room at each end keeps both end dots whole.
    final firstX = spots.first.x;
    final lastX = spots.last.x;
    final pad = (lastX - firstX) * 0.03;
    final minX = firstX - pad;
    final maxX = lastX + pad;
    // Several readings logged inside the same minute collapse the domain to a
    // single instant. Dividing by that produced NaN intervals, and fl_chart
    // handed NaN draws a path with no bounds at all. There is no trend in a
    // zero-length window to draw anyway.
    if (lastX <= firstX) return const SizedBox.shrink();

    final axisStyle = T.label.copyWith(
      fontSize: 11,
      letterSpacing: 0,
      fontWeight: FontWeight.w500,
      color: T.inkFaint,
    );

    // Five dates across the plot. Over half a year the day of the month is
    // noise, so it drops to the month alone.
    // Five ticks across the plot, formatted by whatever actually
    // distinguishes them. A fixed 'd MMM' printed "21 Aug" five times on a
    // 7-day window where every reading landed on one day — an axis that
    // repeats itself is worse than no axis — so the format steps finer until
    // the five labels differ.
    final ticks = [
      for (var i = 0; i < 5; i++)
        DateTime.fromMillisecondsSinceEpoch(
          (firstX + (lastX - firstX) * i / 4).round(),
        ),
    ];
    final spanDays = (lastX - firstX) / 86400000;
    final patterns = [
      if (spanDays > 150) 'MMM',
      'd MMM',
      'd MMM, h a',
      'h:mm a',
    ];
    var dates = <String>[];
    for (final pattern in patterns) {
      dates = [for (final t in ticks) DateFormat(pattern).format(t)];
      if (dates.toSet().length == dates.length) break;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              agg.label == null ? unit.label : '${unit.label}  ·  ${agg.label}',
              style: axisStyle,
            ),
            const Spacer(),
            // A legend. The chart carries a blue line, a green band and
            // coloured dots, and nothing said which was which — an orange dot
            // could as easily have meant "post-meal".
            const _Key(color: Color(0x1A0B8A4E), label: 'Target', bar: true),
            const SizedBox(width: T.s3),
            _Key(
              color: T.warning,
              label: anyCritical ? 'High' : 'Out of range',
            ),
            // The red key appears only when there is something red to explain.
            // A permanent "critical" legend on a chart with no critical
            // readings is a warning about nothing, and it is the kind of thing
            // a patient learns to stop reading.
            if (anyCritical) ...[
              const SizedBox(width: T.s3),
              _Key(color: T.danger, label: 'Needs attention'),
            ],
          ],
        ),
        const SizedBox(height: T.s2),
        SizedBox(
          height: 172,
          child: Stack(
            children: [
              LineChart(
                LineChartData(
                  minX: minX,
                  maxX: maxX,
                  minY: lo,
                  maxY: hi,
                  clipData: const FlClipData.all(),
                  gridData: FlGridData(
                    drawVerticalLine: false,
                    horizontalInterval: step,
                    getDrawingHorizontalLine:
                        (_) => const FlLine(
                          color: Color(0xFFEDF1F7),
                          strokeWidth: 1,
                        ),
                  ),
                  rangeAnnotations: RangeAnnotations(
                    horizontalRangeAnnotations: [
                      HorizontalRangeAnnotation(
                        y1: lowT,
                        y2: highT,
                        color: T.success.withValues(alpha: 0.10),
                      ),
                    ],
                  ),
                  borderData: FlBorderData(show: false),
                  titlesData: FlTitlesData(
                    topTitles: const AxisTitles(),
                    rightTitles: const AxisTitles(),
                    // Drawn as a Row below instead — see the class comment.
                    bottomTitles: const AxisTitles(),
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: _gutter,
                        interval: step,
                        getTitlesWidget: (v, _) {
                          // Drop anything not on the grid. This is what stops
                          // the library's own min/max ticks colliding with the
                          // stepped ones.
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
                              LineTooltipItem(
                                '${_tick(t.y)} ${unit.label}\n'
                                '${DateFormat('d MMM, h:mm a').format(DateTime.fromMillisecondsSinceEpoch(t.x.round()))}',
                                const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  height: 1.4,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                          ],
                    ),
                  ),
                  betweenBarsData: [
                    if (agg.low.isNotEmpty)
                      BetweenBarsData(
                        fromIndex: 0,
                        toIndex: 1,
                        color: T.primary.withValues(alpha: 0.13),
                      ),
                  ],
                  lineBarsData: [
                    // The spread of each bucket, as an invisible pair with the
                    // fill between them. Averaging a 438 away would be a lie by
                    // omission on a glucose chart; the band keeps the extremes
                    // on the page while the mean stays readable.
                    if (agg.low.isNotEmpty) ...[
                      LineChartBarData(
                        spots: agg.high,
                        isCurved: false,
                        barWidth: 0,
                        color: Colors.transparent,
                        dotData: const FlDotData(show: false),
                      ),
                      LineChartBarData(
                        spots: agg.low,
                        isCurved: false,
                        barWidth: 0,
                        color: Colors.transparent,
                        dotData: const FlDotData(show: false),
                      ),
                    ],
                    LineChartBarData(
                      spots: spots,
                      // Straight segments. A spline through 200 → 438 → 300
                      // invents a curve nobody measured, and on a glucose
                      // chart the shape between two readings is exactly the
                      // thing not to editorialise.
                      isCurved: false,
                      color: T.primary,
                      barWidth: 2.2,
                      dotData: FlDotData(
                        // Only what is worth looking at: readings outside the
                        // band, and the latest one.
                        // Marks earn their place. Over a long window every
                        // second reading is out of band, and a dot on each
                        // packed into a solid stripe that hid the line beneath
                        // it — so past 40 points only the newest is marked and
                        // the shaded band carries the rest.
                        checkToShowDot:
                            (spot, _) =>
                                spot.x == spots.last.x ||
                                // Once the line is an average the shaded band
                                // already carries where the readings went, so
                                // a dot per bucket is decoration — forty of
                                // them buried the line underneath.
                                (agg.label == null &&
                                    spots.length <= 40 &&
                                    (spot.y < lowT || spot.y > highT)),
                        getDotPainter: (spot, _, _, _) {
                          final flag = flagAt[spot.x];
                          final out = spot.y < lowT || spot.y > highT;
                          // Two tones, not one. A single colour for everything
                          // outside the band either cries wolf at a reading of
                          // 190 or shrugs at one of 438 — and over a bad month
                          // a chart of solid red stops being information and
                          // becomes something to avoid looking at. Amber for
                          // out of target, red kept for the readings the
                          // clinic itself flagged as needing attention.
                          final tone =
                              critical(flag)
                                  ? T.danger
                                  : out
                                  ? T.warning
                                  : T.primary;
                          return FlDotCirclePainter(
                            radius: out ? 4 : 4.5,
                            color: out ? tone : Colors.white,
                            strokeWidth: 2,
                            strokeColor: out ? Colors.white : tone,
                          );
                        },
                      ),
                      belowBarData: BarAreaData(
                        show: true,
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            T.primary.withValues(alpha: 0.13),
                            T.primary.withValues(alpha: 0),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: T.s2),
        Padding(
          // Aligned to the plot, not to the card, so the dates sit under the
          // line rather than under the axis numbers.
          padding: const EdgeInsets.only(left: _gutter),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [for (final d in dates) Text(d, style: axisStyle)],
          ),
        ),
      ],
    );
  }
}

/// What the chart draws: a mean line, and — when the readings were bucketed —
/// the low and high of each bucket to shade between.
class _Series {
  const _Series({
    required this.mean,
    required this.low,
    required this.high,
    required this.label,
  });

  final List<FlSpot> mean;
  final List<FlSpot> low;
  final List<FlSpot> high;

  /// "Daily average", "3-day average", or null when nothing was aggregated and
  /// every point on the line is a real reading.
  final String? label;
}

/// One legend entry: a swatch and a word.
class _Key extends StatelessWidget {
  const _Key({required this.color, required this.label, this.bar = false});

  final Color color;
  final String label;

  /// A bar for a shaded region, a dot for a marked reading.
  final bool bar;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: bar ? 12 : 7,
        height: 7,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(bar ? 2 : 4),
          border:
              bar ? Border.all(color: T.success.withValues(alpha: 0.35)) : null,
        ),
      ),
      const SizedBox(width: 4),
      Text(
        label,
        style: T.label.copyWith(
          fontSize: 10,
          letterSpacing: 0,
          fontWeight: FontWeight.w500,
          color: T.inkFaint,
        ),
      ),
    ],
  );
}
