import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';

/// The fourteen-day in-target line on the dietician's header card.
///
/// Deliberately not fl_chart. This is 14 points in a 90px box with no axes, no
/// touch and no legend — a chart engine here would cost a layout pass and a
/// pile of configuration to draw four line segments.
///
/// A null entry is a day nobody tested. The line breaks across it rather than
/// dropping to the floor: a gap says "no data", a zero says "nothing was in
/// range", and those are opposite claims about a patient's week.
class NutritionSparkline extends StatelessWidget {
  const NutritionSparkline({super.key, required this.series, this.height = 90});

  final List<int?> series;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: CustomPaint(painter: _SparkPainter(series), size: Size.infinite),
    );
  }
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.series);

  final List<int?> series;

  /// The band the line is drawn against. Fixed rather than fitted to the data:
  /// an auto-scaled axis makes 62% and 64% look like a cliff, and this figure
  /// is read for its level, not its wiggle.
  static const double _min = 30;
  static const double _max = 100;

  @override
  void paint(Canvas canvas, Size size) {
    if (series.isEmpty) return;

    final grid =
        Paint()
          ..color = const Color(0xFFEDF1F7)
          ..strokeWidth = 1;
    // Four rules at 40/60/80/100 — the labels the card prints beside them.
    for (final pct in const [40, 60, 80, 100]) {
      final y = size.height * (1 - (pct - _min) / (_max - _min));
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }

    final step =
        series.length > 1 ? size.width / (series.length - 1) : size.width;
    Offset? at(int i) {
      final v = series[i];
      if (v == null) return null;
      final clamped = v.toDouble().clamp(_min, _max);
      return Offset(
        i * step,
        size.height * (1 - (clamped - _min) / (_max - _min)),
      );
    }

    // Split into unbroken runs, so a missing day interrupts the line instead
    // of being bridged by a segment that implies readings nobody took.
    final runs = <List<Offset>>[];
    var run = <Offset>[];
    for (var i = 0; i < series.length; i++) {
      final p = at(i);
      if (p == null) {
        if (run.length > 1) runs.add(run);
        run = <Offset>[];
      } else {
        run.add(p);
      }
    }
    if (run.length > 1) runs.add(run);

    final line =
        Paint()
          ..color = T.primary
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke;

    for (final r in runs) {
      final path = Path()..moveTo(r.first.dx, r.first.dy);
      for (final p in r.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }

      // The wash under each run, closed down to the baseline.
      final fill =
          Path.from(path)
            ..lineTo(r.last.dx, size.height)
            ..lineTo(r.first.dx, size.height)
            ..close();
      canvas.drawPath(
        fill,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              T.primary.withValues(alpha: 0.16),
              T.primary.withValues(alpha: 0),
            ],
          ).createShader(Rect.fromLTWH(0, 0, size.width, size.height)),
      );
      canvas.drawPath(path, line);
    }

    final dot = Paint()..color = T.primary;
    for (var i = 0; i < series.length; i++) {
      final p = at(i);
      if (p != null) canvas.drawCircle(p, 2.5, dot);
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
