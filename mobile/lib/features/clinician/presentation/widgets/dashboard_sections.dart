import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';
import '../../../../shared/widgets/authed_image.dart';

// ---- Clinic snapshot -------------------------------------------------------

/// How the clinic is doing, and which way it is going.
///
/// The one passive block on this screen, and it sits above the queues because
/// it is read once on opening and then ignored — not because it is the most
/// important thing. Everything below it is work.
class ClinicSnapshot extends StatelessWidget {
  const ClinicSnapshot({
    super.key,
    required this.analytics,
    required this.days,
    required this.onDaysChanged,
  });

  final ClinicAnalytics analytics;

  /// The window on screen, and the way to change it. A range control that does
  /// not re-query is a label pretending to be a filter.
  final int days;
  final ValueChanged<int> onDaysChanged;

  static const _ranges = <int>[7, 14, 30, 90];

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

    return Container(
      padding: const EdgeInsets.all(T.s5),
      decoration: BoxDecoration(
        // White, not a blue wash. The card is the ground the figures stand on;
        // tinting it made the whole first screenful read as one blue block
        // before any of it had been read.
        color: T.surfaceRaised,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: T.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                // The date used to sit above this. It is in the page header
                // now — one screen, one statement of what day it is.
                child: Text(
                  'Clinic snapshot',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              _RangePicker(
                days: days,
                ranges: _ranges,
                onChanged: onDaysChanged,
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
                    // Scaled down rather than clipped. A 44pt number beside a
                    // delta pill is the widest thing on this card, and in the
                    // left four-ninths of a 360dp phone it does not fit — at a
                    // larger text scale it misses by more. FittedBox shrinks
                    // the pair to whatever room there is instead of painting
                    // past the edge.
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Text(
                            '$pct%',
                            maxLines: 1,
                            style: T.display.copyWith(
                              color: T.primary,
                              fontSize: 44,
                            ),
                          ),
                          if (delta != null && delta != 0) ...[
                            const SizedBox(width: T.s2),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color:
                                    rising
                                        ? const Color(0xFFE8F5EE)
                                        : T.dangerTint,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    rising
                                        ? Icons.arrow_upward_rounded
                                        : Icons.arrow_downward_rounded,
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
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Readings in target range',
                      style: T.small.copyWith(color: T.ink),
                    ),
                    if (delta != null)
                      Text(
                        'vs. previous $days days',
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: T.s3),
              Expanded(
                flex: 5,
                child: SizedBox(
                  // Taller than before to make room for the axes underneath.
                  height: 108,
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

/// The snapshot's window, as a menu rather than a label.
class _RangePicker extends StatelessWidget {
  const _RangePicker({
    required this.days,
    required this.ranges,
    required this.onChanged,
  });

  final int days;
  final List<int> ranges;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<int>(
      initialValue: days,
      onSelected: onChanged,
      tooltip: 'Change the window',
      position: PopupMenuPosition.under,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      itemBuilder:
          (context) => [
            for (final d in ranges)
              PopupMenuItem(value: d, child: Text('Last $d days')),
          ],
      child: Container(
        padding: const EdgeInsets.fromLTRB(T.s3, 7, T.s2, 7),
        decoration: BoxDecoration(
          color: T.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: T.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Last $days days', style: T.small.copyWith(color: T.ink)),
            const SizedBox(width: 2),
            const Icon(Icons.expand_more_rounded, size: 17, color: T.inkMuted),
          ],
        ),
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

    // Axis labels are laid out as widgets rather than painted, so they inherit
    // the app's font and honour the reader's text-scale setting — a chart with
    // baked-in 9pt type is unreadable to anyone who has turned text up.
    const axis = [100, 80, 60, 40];
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final v in axis)
                Text(
                  '$v%',
                  style: T.small.copyWith(color: T.inkFaint, fontSize: 10),
                ),
            ],
          ),
        ),
        const SizedBox(width: 4),
        Expanded(
          child: Column(
            children: [
              Expanded(
                child: CustomPaint(
                  painter: _TrendPainter(points),
                  size: Size.infinite,
                ),
              ),
              const SizedBox(height: 2),
              // First and last date only. A label under every point turns to
              // mush at fourteen of them, and the two ends are what say what
              // stretch of time the line covers.
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Flexible: the chart column is barely 120dp on a phone, and
                  // two dates set at whatever the reader's text scale is will
                  // not always fit inside it.
                  Flexible(
                    child: Text(
                      DateFormat('d MMM').format(points.first.date),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.small.copyWith(color: T.inkFaint, fontSize: 10),
                    ),
                  ),
                  Flexible(
                    child: Text(
                      DateFormat('d MMM').format(points.last.date),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.small.copyWith(color: T.inkFaint, fontSize: 10),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TrendPainter extends CustomPainter {
  const _TrendPainter(this.points);

  final List<ControlPoint> points;

  @override
  void paint(Canvas canvas, Size size) {
    final pcts = [
      for (final p in points) p.total == 0 ? 0.0 : (p.inRange / p.total) * 100,
    ];
    // A fixed 40–100 window rather than min–max: an axis that rescales to the
    // data makes every fortnight look equally dramatic, which is the opposite
    // of what a trend chart is for. The labels beside it name these bounds.
    const lo = 40.0;
    const hi = 100.0;
    double yOf(double v) =>
        size.height - ((v.clamp(lo, hi) - lo) / (hi - lo)) * size.height;

    // Gridlines at the labelled values, so the eye can carry a height across
    // to the axis instead of estimating it.
    final grid =
        Paint()
          ..color = T.line
          ..strokeWidth = 1;
    for (final v in [100.0, 80.0, 60.0, 40.0]) {
      final y = yOf(v);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }

    final line = Path();
    for (var i = 0; i < pcts.length; i++) {
      final x = size.width * (i / (pcts.length - 1));
      i == 0 ? line.moveTo(x, yOf(pcts[i])) : line.lineTo(x, yOf(pcts[i]));
    }

    final fill =
        Path.from(line)
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

    // Every reading marked, with the newest filled solid — which end is today
    // is otherwise a guess, and the dots say how many days are in the line.
    for (var i = 0; i < pcts.length; i++) {
      final x = size.width * (i / (pcts.length - 1));
      canvas.drawCircle(
        Offset(x, yOf(pcts[i])),
        i == pcts.length - 1 ? 4 : 2.5,
        Paint()..color = T.primary,
      );
    }
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
    final careUnread = math.max(
      0,
      overview.unreadMessages - overview.unreadNutrition,
    );

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
                  child: Text(
                    'Action Queue',
                    style: T.title.copyWith(color: T.ink),
                  ),
                ),
                TextButton(
                  onPressed: () => context.go('/clinician/patients'),
                  style: TextButton.styleFrom(
                    foregroundColor: T.primary,
                    visualDensity: VisualDensity.compact,
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('View all tasks'),
                      SizedBox(width: 4),
                      Icon(Icons.arrow_forward_rounded, size: 15),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: T.s4),
            child: Column(
              children: [
                // Same reason as the row above it.
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: _ActionTile(
                          icon: Icons.chat_bubble_rounded,
                          tone: T.primary,
                          count: careUnread,
                          label: 'Unread messages',
                          // The split matters: a backlog of thank-yous is not
                          // the same workload as two people waiting on an
                          // answer. Counted off the messages themselves — this
                          // used to show the open *alert* count, so a clinic
                          // with two raised alerts and no urgent messages read
                          // as two people waiting.
                          note:
                              overview.urgentUnread > 0
                                  ? '${overview.urgentUnread} urgent'
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
                          note:
                              analytics.overdueCheckIns > 0 ? '7+ days' : null,
                          noteTone: T.warning,
                          onTap: () => context.go('/clinician/patients'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: T.s3),
                // IntrinsicHeight, not a bare stretch. `stretch` on a Row's
                // cross axis means "be as tall as the space allows", and
                // the space inside a scrolling list is unbounded — which
                // is the "BoxConstraints forces an infinite height" that
                // took this card, and everything below it, off the
                // doctor's home screen without a word of explanation.
                // IntrinsicHeight measures the taller tile and gives both
                // that height, which is what the stretch was reaching for.
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: _ActionTile(
                          icon: Icons.flag_rounded,
                          tone: const Color(0xFF7C3AED),
                          count: overview.pendingReviews,
                          label:
                              overview.pendingReviews == 1
                                  ? 'Action item'
                                  : 'Action items',
                          note:
                              overview.pendingReviews > 0
                                  ? 'Pending review'
                                  : null,
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
                          note:
                              overview.nutritionReviews.isEmpty
                                  ? null
                                  : 'Due for review',
                          noteTone: T.success,
                          onTap: () => context.go('/clinician/nutrition'),
                        ),
                      ),
                    ],
                  ),
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
                  child: Text(
                    'Nutrition Review',
                    style: T.title.copyWith(color: T.ink),
                  ),
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
                // Flexible, so a long label at a large text scale ellipsises
                // instead of pushing the arrow off the button.
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Flexible(
                      child: Text(
                        'Go to nutrition center',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
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
      onTap:
          () => context.push(
            '/clinician/patients/${review.patientId}',
            extra: review.name,
          ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        child: Row(
          children: [
            UserAvatar(
              name: review.name,
              avatarUrl: review.avatarUrl,
              accent: T.primary,
              size: 36,
            ),
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
            // The meal itself. A food-log review is a judgement about what
            // somebody ate, and until now the row described that judgement
            // without ever showing the thing being judged.
            _MealThumbnail(url: review.lastLogPhotoUrl),
            const SizedBox(width: T.s2),
            Icon(Icons.chevron_right_rounded, size: 20, color: T.inkFaint),
          ],
        ),
      ),
    );
  }
}

/// The last meal photographed, or a plain stand-in when there is none.
///
/// Never a broken image: an older server sends no URL at all, and a patient
/// can log a meal as a note without a photograph.
class _MealThumbnail extends StatelessWidget {
  const _MealThumbnail({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    final u = url;
    if (u == null || u.isEmpty) {
      return Container(
        width: 44,
        height: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: T.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: T.line),
        ),
        child: const Icon(
          Icons.restaurant_rounded,
          size: 19,
          color: T.inkFaint,
        ),
      );
    }
    return AuthedImage(path: u, width: 44, height: 44, radius: 10);
  }
}

// ---- Live activity ---------------------------------------------------------

/// One thing that happened in the clinic, and when.
class ClinicEvent {
  const ClinicEvent({
    required this.kind,
    required this.title,
    required this.who,
    required this.at,
    required this.patientId,
  });

  /// message | reading | food
  final String kind;
  final String title;
  final String who;
  final DateTime at;
  final String patientId;
}

/// What the clinic has been doing, newest first.
///
/// Built from the three things the dashboard already holds — the patient list's
/// last message and last reading, and the nutrition queue's last food log —
/// rather than from an endpoint of its own. It is context, not work, so it
/// costs no extra request and sits below everything that does need doing.
class LiveActivity extends StatelessWidget {
  const LiveActivity({super.key, required this.events});

  final List<ClinicEvent> events;

  /// Merge the three streams and keep the newest few.
  static List<ClinicEvent> from({
    required List<PatientListItem> patients,
    required List<NutritionReview> reviews,
    int limit = 3,
  }) {
    final out = <ClinicEvent>[];
    for (final p in patients) {
      final m = p.lastMessage;
      // Only what the patient did. "You: ..." is the clinic's own reply, and a
      // feed of your own messages is a mirror, not activity.
      if (m != null && m.fromPatient) {
        out.add(
          ClinicEvent(
            kind: 'message',
            title: 'Patient message',
            who: '${p.name} replied',
            at: m.at,
            patientId: p.id,
          ),
        );
      }
      if (p.lastReadingAt != null) {
        out.add(
          ClinicEvent(
            kind: 'reading',
            title: 'Glucose reading',
            who: p.name,
            at: p.lastReadingAt!,
            patientId: p.id,
          ),
        );
      }
    }
    for (final r in reviews) {
      if (r.lastLogAt != null) {
        out.add(
          ClinicEvent(
            kind: 'food',
            title: 'Food log submitted',
            who: r.name,
            at: r.lastLogAt!,
            patientId: r.patientId,
          ),
        );
      }
    }
    out.sort((a, b) => b.at.compareTo(a.at));
    return out.take(limit).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const SizedBox.shrink();

    return Container(
      decoration: BoxDecoration(
        color: T.surfaceRaised,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: T.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s2, T.s1),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: T.success,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: T.s2),
                Expanded(
                  child: Text(
                    'Live Activity',
                    style: T.title.copyWith(color: T.ink),
                  ),
                ),
                TextButton(
                  onPressed: () => context.go('/clinician/patients'),
                  style: TextButton.styleFrom(
                    foregroundColor: T.primary,
                    visualDensity: VisualDensity.compact,
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('View all'),
                      SizedBox(width: 4),
                      Icon(Icons.arrow_forward_rounded, size: 15),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s3),
            child: Text(
              'Real-time updates from your clinic',
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ),
          // Side by side where there is room, stacked where there is not.
          // Three columns of title-plus-name do not survive a 360dp phone —
          // every one of them ellipsises to a word and a half.
          LayoutBuilder(
            builder: (context, c) {
              final wide = c.maxWidth >= 560;
              if (wide) {
                return IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var i = 0; i < events.length; i++) ...[
                        if (i > 0) Container(width: 1, color: T.line),
                        Expanded(child: _EventTile(event: events[i])),
                      ],
                    ],
                  ),
                );
              }
              return Column(
                children: [
                  for (var i = 0; i < events.length; i++) ...[
                    if (i > 0) Divider(height: 1, color: T.line),
                    _EventTile(event: events[i]),
                  ],
                ],
              );
            },
          ),
          const SizedBox(height: T.s2),
        ],
      ),
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});

  final ClinicEvent event;

  @override
  Widget build(BuildContext context) {
    final e = event;
    // Blue for a message, green for a reading, amber for a meal — the same
    // three meanings these carry everywhere else in the app.
    final (IconData icon, Color tone) = switch (e.kind) {
      'reading' => (Icons.water_drop_rounded, T.success),
      'food' => (Icons.restaurant_rounded, T.warning),
      _ => (Icons.chat_bubble_rounded, T.primary),
    };

    return InkWell(
      onTap:
          () =>
              context.push('/clinician/patients/${e.patientId}', extra: e.who),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: tone.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 17, color: tone),
            ),
            const SizedBox(width: T.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    e.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.bodyStrong.copyWith(color: T.ink, fontSize: 14),
                  ),
                  Text(
                    e.who,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                  Text(
                    _ago(e.at),
                    style: T.small.copyWith(color: T.inkFaint, fontSize: 11.5),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _ago(DateTime at) {
    final d = DateTime.now().difference(at);
    if (d.inMinutes < 1) return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes} min ago';
    if (d.inHours < 24) return '${d.inHours}h ago';
    if (d.inDays < 7) return '${d.inDays}d ago';
    return DateFormat('d MMM').format(at);
  }
}
