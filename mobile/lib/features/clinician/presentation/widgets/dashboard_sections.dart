import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';

// ---- Clinic snapshot -------------------------------------------------------

/// How the clinic is doing, and which way it is going.
///
/// The one passive block on this screen, and it sits above the queues because
/// it is read once on opening and then ignored — not because it is the most
/// important thing. Everything below it is work.
class ClinicSnapshot extends StatelessWidget {
  const ClinicSnapshot({super.key, required this.analytics});

  final ClinicAnalytics analytics;

  /// Percentage of readings in range across the window, and the change against
  /// the previous window of the same length.
  static (int pct, int? delta) _control(List<ControlPoint> t) {
    if (t.isEmpty) return (0, null);
    int pctOf(Iterable<ControlPoint> xs) {
      final total = xs.fold<int>(0, (a, p) => a + p.total);
      if (total == 0) return 0;
      final inRange = xs.fold<int>(0, (a, p) => a + p.inRange);
      return ((inRange / total) * 100).round();
    }

    final half = t.length ~/ 2;
    final now = pctOf(t.skip(half));
    if (half == 0) return (now, null);
    final before = pctOf(t.take(half));
    return (now, before == 0 ? null : now - before);
  }

  @override
  Widget build(BuildContext context) {
    final (pct, delta) = _control(analytics.controlTrend);
    final rising = (delta ?? 0) >= 0;
    final days = analytics.controlTrend.length;

    return Container(
      padding: const EdgeInsets.all(T.s5),
      decoration: BoxDecoration(
        color: T.primaryTint,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      DateFormat('EEEE, d MMMM').format(DateTime.now()),
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                    const SizedBox(height: 2),
                    Text('Clinic health snapshot', style: T.title.copyWith(color: T.ink)),
                  ],
                ),
              ),
              // The window the figures describe. "86%" means nothing without it.
              if (days > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: 6),
                  decoration: BoxDecoration(
                    color: T.surfaceRaised,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: T.line),
                  ),
                  child: Text(
                    'Last $days days',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                ),
            ],
          ),
          const SizedBox(height: T.s4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 4,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Flexible(
                          child: Text(
                            '$pct%',
                            maxLines: 1,
                            style: T.display.copyWith(color: T.primary, fontSize: 44),
                          ),
                        ),
                        if (delta != null && delta != 0) ...[
                          const SizedBox(width: T.s2),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: rising ? const Color(0xFFE8F5EE) : T.dangerTint,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  rising ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                                  size: 12,
                                  color: rising ? T.success : T.danger,
                                ),
                                const SizedBox(width: 2),
                                Text(
                                  '${delta.abs()}%',
                                  style: T.label.copyWith(
                                    fontSize: 12,
                                    color: rising ? T.success : T.danger,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Readings in target range',
                      style: T.small.copyWith(color: T.ink),
                    ),
                    if (delta != null)
                      Text(
                        'vs previous $days days',
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: T.s3),
              Expanded(
                flex: 5,
                child: SizedBox(
                  height: 92,
                  // Not decoration: the same series the percentage is computed
                  // from, so the figure and the shape cannot disagree.
                  child: _TrendChart(points: analytics.controlTrend),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TrendChart extends StatelessWidget {
  const _TrendChart({required this.points});

  final List<ControlPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) {
      return Center(
        child: Text(
          'Not enough readings yet',
          textAlign: TextAlign.center,
          style: T.small.copyWith(color: T.inkFaint),
        ),
      );
    }
    return CustomPaint(painter: _TrendPainter(points), size: Size.infinite);
  }
}

class _TrendPainter extends CustomPainter {
  const _TrendPainter(this.points);

  final List<ControlPoint> points;

  @override
  void paint(Canvas canvas, Size size) {
    final pcts = [
      for (final p in points)
        p.total == 0 ? 0.0 : (p.inRange / p.total) * 100,
    ];
    // A fixed 40–100 window rather than min–max: an axis that rescales to the
    // data makes every fortnight look equally dramatic, which is the opposite
    // of what a trend chart is for.
    const lo = 40.0;
    const hi = 100.0;
    double yOf(double v) =>
        size.height - ((v.clamp(lo, hi) - lo) / (hi - lo)) * size.height;

    final line = Path();
    for (var i = 0; i < pcts.length; i++) {
      final x = size.width * (i / (pcts.length - 1));
      i == 0 ? line.moveTo(x, yOf(pcts[i])) : line.lineTo(x, yOf(pcts[i]));
    }

    final fill = Path.from(line)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x33003399), Color(0x00003399)],
        ).createShader(Offset.zero & size),
    );

    canvas.drawPath(
      line,
      Paint()
        ..color = T.primary
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );

    // The newest point, marked — which end is today is otherwise a guess.
    canvas.drawCircle(
      Offset(size.width, yOf(pcts.last)),
      3,
      Paint()..color = T.primary,
    );
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.points != points;
}

// ---- Action queue ----------------------------------------------------------

/// The operational queue, kept apart from the clinical one.
///
/// Unread messages and overdue check-ins are work; a raised HbA1c is a patient.
/// Mixing them into one grid of equal cards was what made the old dashboard
/// read as a pile of metrics — every number the same size, none of them saying
/// what to do next.
class ActionQueue extends StatelessWidget {
  const ActionQueue({
    super.key,
    required this.overview,
    required this.analytics,
  });

  final ClinicOverview overview;
  final ClinicAnalytics analytics;

  @override
  Widget build(BuildContext context) {
    final careUnread = math.max(0, overview.unreadMessages - overview.unreadNutrition);

    return Container(
      decoration: BoxDecoration(
        color: T.surfaceRaised,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: T.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s3),
            child: Text('Action Queue', style: T.title.copyWith(color: T.ink)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: T.s4),
            child: Column(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: _ActionTile(
                        icon: Icons.chat_bubble_rounded,
                        tone: T.primary,
                        count: careUnread,
                        label: 'Unread messages',
                        // The split matters: a backlog of thank-yous is not the
                        // same workload as two people waiting on an answer.
                        note: overview.urgentAlerts > 0
                            ? '${overview.urgentAlerts} urgent'
                            : null,
                        noteTone: T.danger,
                        onTap: () => context.go('/clinician/patients'),
                      ),
                    ),
                    const SizedBox(width: T.s3),
                    Expanded(
                      child: _ActionTile(
                        icon: Icons.schedule_rounded,
                        tone: T.warning,
                        count: analytics.overdueCheckIns,
                        label: 'Check-ins overdue',
                        note: analytics.overdueCheckIns > 0 ? '7+ days' : null,
                        noteTone: T.warning,
                        onTap: () => context.go('/clinician/patients'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: T.s3),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: _ActionTile(
                        icon: Icons.flag_rounded,
                        tone: const Color(0xFF7C3AED),
                        count: overview.pendingReviews,
                        label: 'Flagged chats',
                        note: overview.pendingReviews > 0 ? 'Pending review' : null,
                        noteTone: const Color(0xFF7C3AED),
                        onTap: () => context.push('/clinician/chat-review'),
                      ),
                    ),
                    const SizedBox(width: T.s3),
                    Expanded(
                      child: _ActionTile(
                        icon: Icons.restaurant_rounded,
                        tone: T.success,
                        count: overview.nutritionReviews.length,
                        label: 'Nutrition reviews',
                        note: overview.nutritionReviews.isEmpty ? null : 'Due for review',
                        noteTone: T.success,
                        onTap: () => context.go('/clinician/nutrition'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: T.s3),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.tone,
    required this.count,
    required this.label,
    required this.onTap,
    this.note,
    this.noteTone,
  });

  final IconData icon;
  final Color tone;
  final int count;
  final String label;
  final String? note;
  final Color? noteTone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Nothing waiting is drawn quiet rather than coloured. A tile that looks
    // the same at zero as at nine trains the reader to stop reading it.
    final idle = count == 0;
    return Material(
      color: T.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(T.s3),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: T.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(icon, size: 18, color: idle ? T.inkFaint : tone),
                  const SizedBox(width: T.s2),
                  Text(
                    '$count',
                    style: T.metric.copyWith(
                      color: idle ? T.inkFaint : T.ink,
                      fontSize: 22,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: T.s2),
              Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.small.copyWith(color: T.ink),
              ),
              if (note != null)
                Text(
                  note!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.small.copyWith(
                    color: idle ? T.inkFaint : (noteTone ?? T.inkMuted),
                    fontSize: 12,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- Nutrition review ------------------------------------------------------

/// Food logs waiting to be read, as a queue rather than a count.
///
/// It was a tile reading "Nutrition Msgs 2", which named the wrong thing: the
/// work is a review, not a message, and the doctor needs to know whose and by
/// when before deciding to start.
class NutritionReviewQueue extends StatelessWidget {
  const NutritionReviewQueue({super.key, required this.reviews});

  final List<NutritionReview> reviews;

  @override
  Widget build(BuildContext context) {
    final due = reviews.where((r) => r.day >= r.intervalDays - 1).toList();
    final shown = (due.isEmpty ? reviews : due).take(3).toList();

    return Container(
      decoration: BoxDecoration(
        color: T.surfaceRaised,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: T.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s2, T.s2),
            child: Row(
              children: [
                Expanded(
                  child: Text('Nutrition Review', style: T.title.copyWith(color: T.ink)),
                ),
                TextButton(
                  onPressed: () => context.go('/clinician/nutrition'),
                  style: TextButton.styleFrom(
                    foregroundColor: T.primary,
                    visualDensity: VisualDensity.compact,
                  ),
                  child: const Text('View all'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s3),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                due.isEmpty
                    ? 'Nothing due for review'
                    : '${due.length} ${due.length == 1 ? 'review' : 'reviews'} due',
                style: T.small.copyWith(
                  color: due.isEmpty ? T.inkMuted : T.success,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          for (final r in shown) ...[
            Divider(height: 1, color: T.line),
            _ReviewRow(review: r),
          ],
          if (shown.isNotEmpty) ...[
            Divider(height: 1, color: T.line),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: T.s1),
              child: TextButton(
                onPressed: () => context.go('/clinician/nutrition'),
                style: TextButton.styleFrom(foregroundColor: T.primary),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Go to nutrition centre'),
                    const SizedBox(width: T.s2),
                    const Icon(Icons.arrow_forward_rounded, size: 16),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.review});

  final NutritionReview review;

  @override
  Widget build(BuildContext context) {
    final left = review.intervalDays - review.day;
    // When, in words. "Day 14/30" is a progress bar's language, not a doctor's.
    final (dueLabel, dueTone) = switch (left) {
      <= 0 => ('Due today', T.danger),
      1 => ('Due tomorrow', T.warning),
      _ => ('Due in $left days', T.inkMuted),
    };

    return InkWell(
      onTap: () => context.push('/clinician/patients/${review.patientId}', extra: review.name),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        child: Row(
          children: [
            UserAvatar(name: review.name, avatarUrl: null, accent: T.primary, size: 36),
            const SizedBox(width: T.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    review.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.bodyStrong.copyWith(color: T.ink),
                  ),
                  Text(
                    'Food log review · ${review.mealsThisWeek} logged this week',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                  Text(
                    dueLabel,
                    style: T.small.copyWith(
                      color: dueTone,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: T.inkFaint),
          ],
        ),
      ),
    );
  }
}
