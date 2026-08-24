import 'package:flutter/material.dart';
// intl exports its own TextDirection, which shadows the dart:ui one that
// TextPainter wants.
import 'package:intl/intl.dart' hide TextDirection;

import '../../../../core/theme/tokens.dart';

/// The fourteen-day in-target line on the dietician's header card.
///
/// One painter owns the whole plot — gridlines, both axes, the line and the
/// marks. The first version drew the gridlines here and the percentage labels
/// as a separate Column beside it, spaced with `spaceBetween`; two independent
/// layouts cannot agree about where a line sits, and visibly did not.
/// Everything that has to line up is now computed from one number.
///
/// Deliberately not fl_chart. This is fourteen points in a small box with no
/// touch and no legend; a chart engine would cost a layout pass and a pile of
/// configuration to draw a handful of segments.
class NutritionSparkline extends StatelessWidget {
  const NutritionSparkline({
    super.key,
    required this.series,
    this.height = 118,
  });

  /// One entry per day, oldest first. Null is a day nobody tested.
  final List<int?> series;
  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: CustomPaint(painter: _SparkPainter(series)),
  );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.series);

  final List<int?> series;

  /// The scale runs the full nought to a hundred.
  ///
  /// It used to start at 30, and that was not a cosmetic choice — a day on
  /// which nothing was in range clamped to 30 and was *drawn* at 30. The chart
  /// showed a third of readings on target on a day when none were. An axis
  /// that cannot reach zero has no business plotting a percentage.
  static const double _min = 0;
  static const double _max = 100;

  /// Room for the labels, and for a mark sitting exactly on 0 or 100 without
  /// half of it clipped by the edge of the box.
  static const double _gutter = 34;
  static const double _padTop = 7;
  static const double _padBottom = 18;

  static const _rules = [0, 50, 100];

  static const _axisStyle = TextStyle(
    fontSize: 9,
    height: 1,
    fontWeight: FontWeight.w500,
    color: T.inkFaint,
  );

  @override
  void paint(Canvas canvas, Size size) {
    const plotLeft = _gutter;
    final plotWidth = size.width - _gutter;
    const plotTop = _padTop;
    final plotHeight = size.height - _padTop - _padBottom;
    if (plotWidth <= 0 || plotHeight <= 0 || series.isEmpty) return;

    double yFor(num v) =>
        plotTop +
        plotHeight * (1 - (v.clamp(_min, _max) - _min) / (_max - _min));
    double xFor(int i) =>
        series.length > 1
            ? plotLeft + plotWidth * (i / (series.length - 1))
            : plotLeft + plotWidth / 2;

    final label = TextPainter(textDirection: TextDirection.ltr);
    void draw(String s, double x, double y, {bool rightAlign = false}) {
      label.text = TextSpan(text: s, style: _axisStyle);
      label.layout();
      label.paint(canvas, Offset(rightAlign ? x - label.width : x, y));
    }

    // ---- gridlines and their labels, off the same number -------------------
    final grid =
        Paint()
          ..color = const Color(0xFFEDF1F7)
          ..strokeWidth = 1;
    for (final pct in _rules) {
      final y = yFor(pct);
      canvas.drawLine(Offset(plotLeft, y), Offset(size.width, y), grid);
      draw('$pct%', plotLeft - 6, y - 4.5, rightAlign: true);
    }

    // ---- the points we actually have ---------------------------------------
    final points = <int, Offset>{};
    for (var i = 0; i < series.length; i++) {
      final v = series[i];
      if (v != null) points[i] = Offset(xFor(i), yFor(v));
    }
    if (points.isEmpty) return;
    final indices = points.keys.toList()..sort();

    final solid =
        Paint()
          ..color = T.primary
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke;
    // A gap is bridged, but visibly. The previous version drew nothing across
    // one, so a fortnight with readings on four scattered days came out as four
    // unconnected dots and no trend at all. A faint dashed link says "nobody
    // tested here" while still letting the eye follow the shape.
    final bridge =
        Paint()
          ..color = T.primary.withValues(alpha: 0.32)
          ..strokeWidth = 1.4
          ..strokeCap = StrokeCap.round
          ..style = PaintingStyle.stroke;

    for (var k = 1; k < indices.length; k++) {
      final a = points[indices[k - 1]]!;
      final b = points[indices[k]]!;
      if (indices[k] - indices[k - 1] == 1) {
        canvas.drawLine(a, b, solid);
      } else {
        _dash(canvas, a, b, bridge);
      }
    }

    // ---- the wash beneath ---------------------------------------------------
    if (indices.length > 1) {
      final base = plotTop + plotHeight;
      final fill = Path()..moveTo(points[indices.first]!.dx, base);
      for (final i in indices) {
        fill.lineTo(points[i]!.dx, points[i]!.dy);
      }
      fill
        ..lineTo(points[indices.last]!.dx, base)
        ..close();
      canvas.drawPath(
        fill,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              T.primary.withValues(alpha: 0.14),
              T.primary.withValues(alpha: 0),
            ],
          ).createShader(
            Rect.fromLTWH(plotLeft, plotTop, plotWidth, plotHeight),
          ),
      );
    }

    // ---- the marks ----------------------------------------------------------
    final dot = Paint()..color = T.primary;
    final ring =
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5;
    for (final i in indices) {
      canvas.drawCircle(points[i]!, 3, dot);
      canvas.drawCircle(points[i]!, 3, ring);
    }

    // ---- the dates, at the x the marks actually use -------------------------
    final today = DateTime.now();
    final n = series.length;
    final slots = n >= 8 ? 4 : 2;
    for (var k = 0; k < slots; k++) {
      final i = ((n - 1) * k / (slots - 1)).round();
      final day = today.subtract(Duration(days: n - 1 - i));
      label.text = TextSpan(
        text: DateFormat('d MMM').format(day),
        style: _axisStyle,
      );
      label.layout();
      // Nudged inward at the ends, so neither the first nor the last date
      // half-hangs off the tile.
      var dx = xFor(i) - label.width / 2;
      if (dx < plotLeft) dx = plotLeft;
      if (dx + label.width > size.width) dx = size.width - label.width;
      label.paint(canvas, Offset(dx, size.height - _padBottom + 6));
    }
  }

  static void _dash(Canvas canvas, Offset a, Offset b, Paint paint) {
    const dash = 3.0;
    const gap = 3.0;
    final total = (b - a).distance;
    if (total == 0) return;
    final step = (b - a) / total;
    var travelled = 0.0;
    while (travelled < total) {
      final end = (travelled + dash).clamp(0.0, total);
      canvas.drawLine(a + step * travelled, a + step * end, paint);
      travelled = end + gap;
    }
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.series != series;
}

/// Seven days of "did this patient log anything", as a seven-point line.
///
/// Sits at the end of an attention row and is decoration with a job: it says
/// whether the gap is a blip or a pattern, which the one-line summary beside
/// it cannot.
class AdherenceSpark extends StatelessWidget {
  const AdherenceSpark({super.key, required this.days, required this.tone});

  /// 1 for a day with at least one log, 0 for a day without. Oldest first.
  final List<int> days;
  final Color tone;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 76,
    height: 26,
    child: CustomPaint(painter: _AdherencePainter(days, tone)),
  );
}

class _AdherencePainter extends CustomPainter {
  _AdherencePainter(this.days, this.tone);

  final List<int> days;
  final Color tone;

  @override
  void paint(Canvas canvas, Size size) {
    if (days.length < 2) return;
    final step = size.width / (days.length - 1);
    // Inset so the dots at either end are not clipped in half by the box.
    const pad = 3.0;
    final points = [
      for (var i = 0; i < days.length; i++)
        Offset(i * step, days[i] == 1 ? pad : size.height - pad),
    ];

    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final p in points.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = tone
        ..strokeWidth = 1.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke,
    );
    final dot = Paint()..color = tone;
    for (final p in points) {
      canvas.drawCircle(p, 2, dot);
    }
  }

  @override
  bool shouldRepaint(_AdherencePainter old) =>
      old.days != days || old.tone != tone;
}
