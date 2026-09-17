import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/models/paged.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';
import 'home_panel.dart';

// ---- Glucose in range --------------------------------------------------------

/// How much of the practice's logged sugar sat in range, and which way it is
/// going. The analytics plan's panel.
///
/// ---- What was wrong with the old snapshot --------------------------------
///
/// "Clinic snapshot", which said nothing about what it measured, over a 44pt
/// "0%" beside "Not enough readings yet" — the figure was computed as zero
/// when there were no readings at all. Its change pill printed a difference of
/// percentage points as "↓1%" and labelled it "vs. previous 14 days" while
/// comparing the two halves of the same fortnight. And a day nobody logged a
/// reading was drawn as a plunge to the bottom of an axis that stopped at 40.
///
/// Now: no figure without readings; the change in points, against the
/// half-window it actually compares; a 0–100 axis; and a day with no readings
/// is a break in the line, not a zero.
class GlucoseInRangeCard extends StatelessWidget {
  const GlucoseInRangeCard({
    super.key,
    required this.analytics,
    required this.days,
    required this.onDaysChanged,
    required this.onRetry,
  });

  final AsyncValue<ClinicAnalytics> analytics;

  /// The window on screen, and the way to change it. A range control that does
  /// not re-query is a label pretending to be a filter.
  final int days;
  final ValueChanged<int> onDaysChanged;
  final VoidCallback onRetry;

  static const ranges = <int>[7, 14, 30, 90];

  @override
  Widget build(BuildContext context) {
    return HomePanel<ClinicAnalytics>(
      icon: Icons.insights_outlined,
      title: 'Glucose in range',
      what: 'the glucose trend',
      value: analytics,
      onRetry: onRetry,
      trailing: _RangePicker(days: days, onChanged: onDaysChanged),
      builder: (a) => _InRangeBody(analytics: a, days: days),
    );
  }
}

/// The share of readings in range across the window, and the change between
/// its two halves — or nulls where there is nothing to divide.
({int? percent, int readings, int? change}) inRangeSummary(
  List<ControlPoint> points, {
  required int days,
  DateTime? now,
}) {
  final total = points.fold<int>(0, (s, p) => s + p.total);
  if (total == 0) return (percent: null, readings: 0, change: null);
  final inRange = points.fold<int>(0, (s, p) => s + p.inRange);

  final today = now ?? DateTime.now();
  final split = DateTime(today.year, today.month, today.day)
      .subtract(Duration(days: days ~/ 2 - 1));
  int? pctOf(Iterable<ControlPoint> xs) {
    final t = xs.fold<int>(0, (s, p) => s + p.total);
    if (t == 0) return null;
    return (xs.fold<int>(0, (s, p) => s + p.inRange) * 100 / t).round();
  }

  final recent = pctOf(points.where((p) => !p.date.isBefore(split)));
  final earlier = pctOf(points.where((p) => p.date.isBefore(split)));
  return (
    percent: (inRange * 100 / total).round(),
    readings: total,
    change: recent == null || earlier == null ? null : recent - earlier,
  );
}

class _InRangeBody extends StatelessWidget {
  const _InRangeBody({required this.analytics, required this.days});

  final ClinicAnalytics analytics;
  final int days;

  @override
  Widget build(BuildContext context) {
    final s = inRangeSummary(analytics.controlTrend, days: days);
    if (s.percent == null) {
      return PanelNote(
        'No glucose readings logged in the last $days days.',
        color: T.ink,
        top: 0,
      );
    }

    final half = days ~/ 2;
    final change = s.change;
    final points = change == null ? null : change.abs() == 1 ? 'point' : 'points';
    final changeText = change == null
        ? null
        : change == 0
        ? 'The same as the $half days before.'
        : '${change > 0 ? 'Up' : 'Down'} ${change.abs()} $points on the $half days before.';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('${s.percent}%', style: T.metric.copyWith(color: T.ink)),
            const SizedBox(width: T.s3),
            Expanded(
              child: Text(
                'of ${s.readings} readings were 70–180 mg/dL in the last $days days',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            ),
          ],
        ),
        if (changeText != null) PanelNote(changeText, color: T.ink),
        const SizedBox(height: T.s4),
        _InRangeChart(points: analytics.controlTrend, days: days),
      ],
    );
  }
}

/// The window, as a menu that says what it is set to.
class _RangePicker extends StatelessWidget {
  const _RangePicker({required this.days, required this.onChanged});

  final int days;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<int>(
      initialValue: days,
      onSelected: onChanged,
      tooltip: 'Change the window',
      position: PopupMenuPosition.under,
      itemBuilder: (context) => [
        for (final d in GlucoseInRangeCard.ranges)
          PopupMenuItem(value: d, child: Text('Last $d days', style: T.body)),
      ],
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: T.tap),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('$days days', style: T.small.copyWith(color: T.primary, fontWeight: FontWeight.w700)),
            const Icon(Icons.expand_more_rounded, size: T.s5, color: T.primary),
          ],
        ),
      ),
    );
  }
}

/// The daily share in range, on a 0–100 axis, one point per day with readings.
class _InRangeChart extends StatelessWidget {
  const _InRangeChart({required this.points, required this.days});

  final List<ControlPoint> points;
  final int days;

  @override
  Widget build(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context);
    final now = DateTime.now();
    final end = DateTime(now.year, now.month, now.day);
    final start = end.subtract(Duration(days: days - 1));
    final axis = T.label.copyWith(color: T.inkMuted);

    return Semantics(
      label: 'Chart of the daily share of readings in range over the last $days days',
      excludeSemantics: true,
      child: Column(
        children: [
          SizedBox(
            height: scale.scale(T.s12 + T.s12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('100%', style: axis),
                    Text('50%', style: axis),
                    Text('0%', style: axis),
                  ],
                ),
                const SizedBox(width: T.s2),
                Expanded(
                  child: CustomPaint(
                    painter: _InRangePainter(points: points, start: start, days: days),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: T.s1),
          Row(
            children: [
              SizedBox(width: scale.scale(T.s8 + T.s2)),
              Expanded(child: Text(DateFormat('d MMM').format(start), style: axis)),
              Text('Today', style: axis),
            ],
          ),
        ],
      ),
    );
  }
}

class _InRangePainter extends CustomPainter {
  const _InRangePainter({required this.points, required this.start, required this.days});

  final List<ControlPoint> points;
  final DateTime start;
  final int days;

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = T.line
      ..strokeWidth = 1;
    for (final f in [0.0, 0.5, 1.0]) {
      final y = size.height * f;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }

    // Positioned by date, so a missing day is a missing day.
    final byDay = <int, double>{};
    for (final p in points) {
      if (p.total == 0) continue;
      final day = DateTime(p.date.year, p.date.month, p.date.day).difference(start).inDays;
      if (day < 0 || day >= days) continue;
      byDay[day] = p.inRange / p.total;
    }
    if (byDay.isEmpty) return;

    final span = math.max(1, days - 1);
    Offset at(int day, double share) =>
        Offset(size.width * day / span, size.height * (1 - share));

    final stroke = Paint()
      ..color = T.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Consecutive days joined; a gap breaks the line.
    final ordered = byDay.keys.toList()..sort();
    Path? run;
    int? previous;
    for (final day in ordered) {
      final point = at(day, byDay[day]!);
      if (previous == null || day != previous + 1) {
        if (run != null) canvas.drawPath(run, stroke);
        run = Path()..moveTo(point.dx, point.dy);
      } else {
        run!.lineTo(point.dx, point.dy);
      }
      previous = day;
    }
    if (run != null) canvas.drawPath(run, stroke);

    final dot = Paint()..color = T.primary;
    for (final day in ordered) {
      canvas.drawCircle(at(day, byDay[day]!), day == ordered.last ? 4 : 2.5, dot);
    }
  }

  @override
  bool shouldRepaint(_InRangePainter old) =>
      old.points != points || old.start != start || old.days != days;
}

// ---- Nutrition -----------------------------------------------------------------

/// Diet reviews coming due, and the way to the nutrition conversations.
///
/// The one place nutrition lives on the doctor's home. It used to be three: a
/// tab, a tile in the action queue, and a card whose own footer said "Go to
/// nutrition center" beside its "View all". Shown only where something answers
/// in those conversations — a dietician or the nutrition assistant.
class NutritionCard extends StatelessWidget {
  const NutritionCard({super.key, required this.overview, required this.onRetry});

  final AsyncValue<ClinicOverview> overview;
  final VoidCallback onRetry;

  /// Due today or tomorrow, or already past.
  static List<NutritionReview> due(List<NutritionReview> reviews) =>
      reviews.where((r) => r.intervalDays > 0 && r.day >= r.intervalDays - 1).toList();

  @override
  Widget build(BuildContext context) {
    return HomePanel<ClinicOverview>(
      icon: Icons.restaurant_menu_outlined,
      title: 'Nutrition',
      what: 'diet reviews',
      value: overview,
      onRetry: onRetry,
      onViewAll: () => context.push('/clinician/nutrition'),
      viewAllLabel: 'View all nutrition conversations',
      builder: (o) {
        final reviews = due(o.nutritionReviews);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (reviews.isEmpty)
              const PanelNote('No diet reviews due today or tomorrow.', color: T.ink, top: 0)
            else
              CountLine(
                top: 0,
                parts: [CountPart(reviews.length, reviews.length == 1 ? 'diet review due' : 'diet reviews due')],
              ),
            for (final r in reviews.take(3)) _ReviewRow(review: r),
            CountLine(
              parts: [
                CountPart(o.unreadNutrition, o.unreadNutrition == 1 ? 'unread message from a patient' : 'unread messages from patients'),
                CountPart(
                  o.needsDieticianAssignment,
                  o.needsDieticianAssignment == 1 ? 'patient needs a dietician chosen' : 'patients need a dietician chosen',
                  color: T.warning,
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.review});

  final NutritionReview review;

  @override
  Widget build(BuildContext context) {
    final left = review.intervalDays - review.day;
    final StatusWord status = switch (left) {
      < 0 => StatusWord(label: 'Overdue by ${-left} ${-left == 1 ? 'day' : 'days'}', tone: Tone.warning),
      0 => const StatusWord(label: 'Due today', tone: Tone.warning),
      _ => const StatusWord(label: 'Due tomorrow', tone: Tone.neutral),
    };
    return PanelPatientRow(
      patientId: review.patientId,
      name: review.name,
      detail: review.detail,
      status: status,
      leading: UserAvatar(
        name: review.name,
        avatarUrl: review.avatarUrl,
        accent: T.primary,
        size: T.s8 + T.s2,
      ),
    );
  }
}

// ---- Waiting on you ------------------------------------------------------------

/// The operational queue: messages, flagged conversations, patients without a
/// dietician, and patients who have gone quiet — each only when it is not zero.
///
/// It was a two-by-two grid of tiles, "0" in each on a quiet day, under "View
/// all tasks" (there are no tasks) in four decorative colours including a
/// purple the palette does not have. The unread count repeated the bell.
class WaitingOnYouCard extends StatelessWidget {
  const WaitingOnYouCard({
    super.key,
    required this.overview,
    required this.analytics,
    required this.nutritionStream,
    required this.onRetry,
  });

  final AsyncValue<ClinicOverview> overview;
  final ClinicAnalytics? analytics;
  final bool nutritionStream;
  final VoidCallback onRetry;

  /// The rows that are not zero, as (count, words, where).
  static List<({int count, String text, String route, bool push})> rows(
    ClinicOverview o,
    ClinicAnalytics? a, {
    required bool nutritionStream,
  }) {
    final careUnread = math.max(0, o.unreadMessages - o.unreadNutrition);
    return [
      if (careUnread > 0)
        (
          count: careUnread,
          text: o.urgentUnread > 0
              ? '$careUnread unread ${careUnread == 1 ? 'message' : 'messages'}, ${o.urgentUnread} marked urgent'
              : '$careUnread unread ${careUnread == 1 ? 'message' : 'messages'}',
          route: '/clinician/patients',
          push: false,
        ),
      if (o.pendingReviews > 0)
        (
          count: o.pendingReviews,
          text: '${o.pendingReviews} ${o.pendingReviews == 1 ? 'conversation' : 'conversations'} flagged for review',
          route: '/clinician/chat-review',
          push: true,
        ),
      if (nutritionStream && o.needsDieticianAssignment > 0)
        (
          count: o.needsDieticianAssignment,
          text: '${patients(o.needsDieticianAssignment)} without a dietician chosen',
          route: '/clinician/nutrition',
          push: true,
        ),
      if (a != null && a.overdueCheckIns > 0)
        (
          count: a.overdueCheckIns,
          text: '${patients(a.overdueCheckIns)} with no reading for over a week',
          route: '/clinician/patients',
          push: false,
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return HomePanel<ClinicOverview>(
      icon: Icons.inbox_outlined,
      title: 'Waiting on you',
      what: 'what is waiting',
      value: overview,
      onRetry: onRetry,
      builder: (o) {
        final list = rows(o, analytics, nutritionStream: nutritionStream);
        if (list.isEmpty) {
          return const PanelNote('Nothing is waiting on you.', color: T.ink, top: 0);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final r in list)
              Padding(
                padding: const EdgeInsets.only(top: T.s2),
                child: Semantics(
                  button: true,
                  label: r.text,
                  excludeSemantics: true,
                  child: Material(
                    color: T.surface,
                    borderRadius: BorderRadius.circular(T.rControl),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(T.rControl),
                      onTap: () => r.push ? context.push(r.route) : context.go(r.route),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(minHeight: T.tap),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
                          child: Row(
                            children: [
                              Expanded(child: Text(r.text, style: T.body.copyWith(color: T.ink))),
                              const Icon(Icons.chevron_right_rounded, size: T.s6, color: T.inkMuted),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

// ---- Recent activity -----------------------------------------------------------

/// One thing a patient did, and when.
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

/// What patients have done lately, newest first. Context, not work.
///
/// Built from what the home already holds — the roll's last message and last
/// reading, and the nutrition queue's last food log — so it costs no request.
/// It called itself "Live Activity" with a green dot and "Real-time updates",
/// on a twenty-second poll; it is recent, and says so.
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
      // Only what the patient did. The clinic's own replies are not activity.
      if (m != null && m.fromPatient) {
        out.add(ClinicEvent(kind: 'message', title: 'Sent a message', who: p.name, at: m.at, patientId: p.id));
      }
      if (p.lastReadingAt != null) {
        out.add(ClinicEvent(kind: 'reading', title: 'Logged a sugar reading', who: p.name, at: p.lastReadingAt!, patientId: p.id));
      }
    }
    for (final r in reviews) {
      if (r.lastLogAt != null) {
        out.add(ClinicEvent(kind: 'food', title: 'Logged a meal', who: r.name, at: r.lastLogAt!, patientId: r.patientId));
      }
    }
    out.sort((a, b) => b.at.compareTo(a.at));
    return out.take(limit).toList();
  }

  static String ago(DateTime at) {
    final d = DateTime.now().difference(at);
    if (d.inMinutes < 1) return 'under a minute ago';
    if (d.inMinutes < 60) return '${d.inMinutes} min ago';
    if (d.inHours < 24) return '${d.inHours} h ago';
    if (d.inDays < 7) return '${d.inDays} ${d.inDays == 1 ? 'day' : 'days'} ago';
    return DateFormat('d MMM').format(at);
  }

  @override
  Widget build(BuildContext context) {
    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelHeading(icon: Icons.history_rounded, title: 'Recent activity'),
          for (final e in events)
            PanelPatientRow(
              patientId: e.patientId,
              name: e.who,
              detail: '${e.title} · ${ago(e.at)}',
            ),
        ],
      ),
    );
  }
}

// ---- Open alerts ---------------------------------------------------------------

/// The alerts that are open, worst first — for a home configured to show them
/// as a panel of their own.
///
/// No doctor preset does: the triage card names the patients with alerts and
/// links the alerts screen. Kept, restyled, for a department whose operator
/// chose it. One action language: the row opens the patient, "View all" opens
/// the alerts — not a filled "Review Case" button on every alert.
class OpenAlertsCard extends StatelessWidget {
  const OpenAlertsCard({super.key, required this.alerts, required this.onRetry});

  final AsyncValue<Paged<ClinicalAlert>> alerts;
  final VoidCallback onRetry;

  static const _order = ['emergency', 'urgent', 'warning', 'info'];

  static StatusWord word(String severity) => switch (severity) {
    'emergency' => const StatusWord(label: 'Emergency', tone: Tone.danger),
    'urgent' => const StatusWord(label: 'Urgent', tone: Tone.danger),
    'warning' => const StatusWord(label: 'Warning', tone: Tone.warning),
    _ => const StatusWord(label: 'Information', tone: Tone.neutral),
  };

  @override
  Widget build(BuildContext context) {
    return HomePanel<Paged<ClinicalAlert>>(
      icon: Icons.notification_important_outlined,
      title: 'Open alerts',
      what: 'open alerts',
      value: alerts,
      onRetry: onRetry,
      onViewAll: () => context.push('/clinician/alerts'),
      viewAllLabel: 'View all alerts',
      builder: (page) {
        final sorted = [...page.items]..sort((a, b) {
          final bySeverity = _order.indexOf(a.severity).compareTo(_order.indexOf(b.severity));
          if (bySeverity != 0) return bySeverity;
          return (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0));
        });
        if (sorted.isEmpty) {
          return const PanelNote('No open alerts.', color: T.ink, top: 0);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final a in sorted.take(3))
              PanelPatientRow(
                patientId: a.patientId ?? '',
                name: a.patientName,
                detail: a.title,
                status: word(a.severity),
                trailing: a.createdAt == null ? null : LiveActivity.ago(a.createdAt!),
              ),
            if (sorted.length > 3) PanelNote('${sorted.length - 3} more open'),
          ],
        );
      },
    );
  }
}

// ---- A practice with nobody in it ----------------------------------------------

/// Said once, where every panel below would otherwise say it again.
///
/// A new practice's home was a chart at "0%", a triage strip of four zeros,
/// "No patients on the list yet", a blood pressure panel saying nobody is
/// enrolled, a follow-ups panel, a condition register and an action queue all
/// saying the same thing in their own words. The caseload panels step aside
/// until there is a caseload, and this says why.
class EmptyPracticeCard extends StatelessWidget {
  const EmptyPracticeCard({super.key});

  @override
  Widget build(BuildContext context) {
    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelHeading(icon: Icons.people_outline_rounded, title: 'No patients yet'),
          const SizedBox(height: T.s2),
          Text(
            'Once patients are added or join this practice, who needs attention, '
            'their readings and their follow-ups appear here.',
            style: T.body.copyWith(color: T.inkMuted),
          ),
        ],
      ),
    );
  }
}
