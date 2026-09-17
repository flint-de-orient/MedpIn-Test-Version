import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';

/// How urgently a patient needs the doctor, and what that colour means.
///
/// Four levels, each with one meaning. Red is spent only on the level that
/// says somebody may be unwell now — a dashboard where every state is coloured
/// is a dashboard nobody triages by colour.
enum Triage {
  critical('Critical', 'Immediate attention', T.danger, T.dangerTint),
  high('High', 'Review soon', Color(0xFFEA580C), Color(0xFFFFF1E7)),
  moderate('Moderate', 'Monitor', T.warning, T.warningTint),
  low('Low', 'No immediate concern', T.success, Color(0xFFE8F5EE));

  const Triage(this.label, this.meaning, this.tone, this.tint);

  final String label;

  /// What the level actually asks of the doctor, for the legend and tooltip.
  final String meaning;
  final Color tone;
  final Color tint;

  static Triage of(String band) => switch (band) {
    'critical' => Triage.critical,
    'high' => Triage.high,
    'moderate' => Triage.moderate,
    _ => Triage.low,
  };
}

/// Why this patient is in the queue, in the words a doctor would use.
///
/// The single biggest gap in the previous dashboard: it showed a risk band and
/// a percentage and left the doctor to open the record to find out what had
/// happened. A queue that cannot say why it flagged somebody is a queue that
/// gets opened item by item, which is the opposite of triage.
///
/// Reasons are ordered by what would change the next action first — an open
/// alert outranks a drifting average, which outranks silence.
({String text, bool urgent}) triageReason(PatientListItem p) {
  if (p.openAlertCount > 0) {
    final n = p.openAlertCount;
    return (text: n == 1 ? '1 open alert' : '$n open alerts', urgent: true);
  }

  // An HbA1c above target is the one number that reframes everything else on
  // the row, so it is named rather than left to the figure on the right.
  final a1c = p.hba1c;
  if (a1c != null && a1c >= 8) {
    return (text: 'Elevated HbA1c: ${a1c.toStringAsFixed(1)}%', urgent: true);
  }

  final delta = p.trendDelta;
  if (delta != null && delta > 0) {
    return (text: 'Average up $delta mg/dL', urgent: p.riskBand != 'low');
  }

  if (p.checkInOverdue) {
    final days =
        p.lastReadingAt == null
            ? null
            : DateTime.now().difference(p.lastReadingAt!).inDays;
    return (
      text: days == null ? 'No readings yet' : 'No check-in for $days days',
      urgent: false,
    );
  }

  if (a1c != null && a1c >= 7) {
    return (
      text: 'HbA1c ${a1c.toStringAsFixed(1)}% — above target',
      urgent: false,
    );
  }
  if (delta != null && delta < 0) {
    return (text: 'Average down ${-delta} mg/dL', urgent: false);
  }
  return (text: 'All readings in range', urgent: false);
}

/// "4w" alone does not say four weeks since what. This does.
String lastSeenLabel(DateTime? at) {
  if (at == null) return 'Never seen';
  final d = DateTime.now().difference(at);
  final ago = switch (d) {
    _ when d.inMinutes < 60 => '${d.inMinutes}m ago',
    _ when d.inHours < 24 => '${d.inHours}h ago',
    _ when d.inDays < 7 => '${d.inDays}d ago',
    _ when d.inDays < 60 => '${(d.inDays / 7).floor()}w ago',
    _ => '${(d.inDays / 30).floor()}mo ago',
  };
  return 'Last seen $ago';
}

/// The clinical queue: who needs the doctor, worst first.
class TriageQueue extends StatelessWidget {
  const TriageQueue({
    super.key,
    required this.patients,
    required this.updatedAt,
  });

  final List<PatientListItem> patients;

  /// When the underlying data was last fetched. A live queue that cannot say
  /// how fresh it is asks the reader to trust it blindly.
  final DateTime updatedAt;

  static const _shown = 5;

  @override
  Widget build(BuildContext context) {
    // Worst first, and within a band the one with most open alerts. The doctor
    // reads top-down and stops when they run out of time, so the order has to
    // survive that.
    final sorted = [...patients]..sort((a, b) {
      final byBand = Triage.of(
        a.riskBand,
      ).index.compareTo(Triage.of(b.riskBand).index);
      if (byBand != 0) return byBand;
      final byAlerts = b.openAlertCount.compareTo(a.openAlertCount);
      if (byAlerts != 0) return byAlerts;
      return b.riskScore.compareTo(a.riskScore);
    });

    final counts = <Triage, int>{
      for (final t in Triage.values)
        t: patients.where((p) => Triage.of(p.riskBand) == t).length,
    };
    final needing =
        (counts[Triage.critical] ?? 0) +
        (counts[Triage.high] ?? 0) +
        (counts[Triage.moderate] ?? 0);

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
            padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s2, T.s3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // The mark for the section, in the severity red it is about.
                // A bare 8px dot beside the title read as a bullet point.
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: T.danger,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: const Icon(
                    Icons.monitor_heart_rounded,
                    size: 21,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: T.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Live Triage',
                        style: T.title.copyWith(color: T.ink),
                      ),
                      const SizedBox(height: 1),
                      // What the section is for, not a count — the counts are
                      // the strip directly underneath, and saying "3 patients
                      // require attention" immediately above "1 Critical 2
                      // High" was the same fact twice in two shapes.
                      Text(
                        needing == 0
                            ? 'Nobody needs immediate attention'
                            : 'Patients requiring immediate attention',
                        maxLines: 2,
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                    ],
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

          // The whole queue in one line, before any individual row. A doctor
          // deciding whether to start now reads this and nothing else.
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s3),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: T.s3),
              decoration: BoxDecoration(
                color: T.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: T.line),
              ),
              child: IntrinsicHeight(
                child: Row(
                  children: [
                    for (final t in [
                      Triage.critical,
                      Triage.high,
                      Triage.moderate,
                    ]) ...[
                      if (t != Triage.critical)
                        Container(width: 1, height: 30, color: T.line),
                      Expanded(
                        child: _SeverityCount(level: t, count: counts[t] ?? 0),
                      ),
                    ],
                    Container(width: 1, height: 30, color: T.line),
                    // The roll, so the three severities above are read as a
                    // breakdown of something rather than as three loose counts.
                    Expanded(
                      child: _SeverityCount(
                        level: null,
                        count: patients.length,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          if (sorted.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s5),
              child: Text(
                'No patients on the list yet.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            )
          else
            for (final p in sorted.take(_shown)) ...[
              Divider(height: 1, color: T.line),
              _TriageRow(patient: p),
            ],

          Divider(height: 1, color: T.line),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: T.s1),
            child: TextButton(
              onPressed: () => context.go('/clinician/patients'),
              style: TextButton.styleFrom(foregroundColor: T.primary),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('View all patients'),
                  const SizedBox(width: T.s2),
                  const Icon(Icons.arrow_forward_rounded, size: 16),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SeverityCount extends StatelessWidget {
  const _SeverityCount({required this.level, required this.count});

  /// The severity this cell counts, or null for the roll-up total.
  final Triage? level;
  final int count;

  @override
  Widget build(BuildContext context) {
    final lvl = level;
    // The number carries the colour and the label stays quiet underneath.
    // Side by side in a disc, four cells could not fit on a phone without the
    // labels ellipsising to "Crit…" — and the number is what is being read.
    //
    // Greyed at zero: a red "0 critical" is a false alarm every time the
    // doctor glances at it. The total is navy whatever it says, because it is
    // a count of patients rather than a severity.
    final on =
        lvl == null
            ? T.ink
            : count == 0
            ? T.inkFaint
            : lvl.tone;

    return Tooltip(
      message:
          lvl == null
              ? 'Everyone on the triage list'
              : '${lvl.label}: ${lvl.meaning}',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '$count',
              style: T.display.copyWith(fontSize: 22, color: on, height: 1.1),
            ),
            const SizedBox(height: 1),
            Text(
              lvl?.label ?? 'Total',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: T.small.copyWith(color: T.inkMuted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _TriageRow extends StatelessWidget {
  const _TriageRow({required this.patient});

  final PatientListItem patient;

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final level = Triage.of(p.riskBand);
    final reason = triageReason(p);
    final act =
        level == Triage.critical ||
        level == Triage.high ||
        p.openAlertCount > 0;

    return InkWell(
      onTap: () => context.push('/clinician/patients/${p.id}', extra: p.name),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                UserAvatar(
                  name: p.name,
                  avatarUrl: p.avatarUrl,
                  accent: T.primary,
                  size: 40,
                ),
                // The severity dot rides on the face, so a scan down the column
                // reads the levels without reading the words.
                Positioned(
                  right: -1,
                  top: -1,
                  child: Container(
                    width: 13,
                    height: 13,
                    decoration: BoxDecoration(
                      color: level.tone,
                      shape: BoxShape.circle,
                      border: Border.all(color: T.surfaceRaised, width: 2),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: T.s3),
            Expanded(
              child: LayoutBuilder(
                builder: (context, c) {
                  // The reading and the sparkline sit beside the text only when
                  // there is room. On a 360dp phone the avatar, three lines of
                  // text, a percentage, a chart and a button do not fit on one
                  // line, so everything that could ellipsise did: the row read
                  // "High risk · 1 alert · …" over "Average u…". Every one of
                  // those truncations removed the reason the patient is in the
                  // queue, which is the row's whole job.
                  //
                  // Below the threshold they move to their own line underneath,
                  // read in the same glance with nothing cut. Measured on the
                  // text column rather than the screen, so it holds on a
                  // tablet, in split screen and at any text scale.
                  final inline = c.maxWidth >= 210;
                  final metrics = _rowMetrics(patient: p, compact: !inline);

                  final text = Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: T.bodyStrong.copyWith(color: T.ink),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        [
                          '${level.label} risk',
                          if (p.openAlertCount > 0)
                            '${p.openAlertCount} alert${p.openAlertCount == 1 ? '' : 's'}',
                          lastSeenLabel(p.lastReadingAt),
                        ].join(' · '),
                        // Two lines, not one. That string is three facts, and
                        // the one that fell off the end was always the last
                        // time anybody heard from the patient.
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                      const SizedBox(height: 1),
                      // Why this patient is here at all.
                      Text(
                        reason.text,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: T.small.copyWith(
                          color: reason.urgent ? T.danger : T.inkMuted,
                          fontWeight:
                              reason.urgent ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
                      if (!inline && metrics != null) ...[
                        const SizedBox(height: 4),
                        metrics,
                      ],
                    ],
                  );

                  if (inline && metrics != null) {
                    return Row(
                      children: [
                        Expanded(child: text),
                        const SizedBox(width: T.s2),
                        metrics,
                      ],
                    );
                  }
                  return text;
                },
              ),
            ),
            const SizedBox(width: T.s2),
            _RowAction(act: act, patientId: p.id, name: p.name),
          ],
        ),
      ),
    );
  }
}

/// The latest HbA1c and the direction of travel, as one unit.
///
/// Null when the patient has neither, so the row reserves no space for a
/// reading that does not exist.
Widget? _rowMetrics({required PatientListItem patient, required bool compact}) {
  final p = patient;
  if (p.hba1c == null && p.spark.length < 2) return null;
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      if (p.hba1c != null) ...[
        Text(
          '${p.hba1c!.toStringAsFixed(1)}%',
          style: T.bodyStrong.copyWith(
            color: p.hba1c! >= 7 ? T.danger : T.success,
          ),
        ),
        const SizedBox(width: T.s2),
      ],
      if (p.spark.length > 1)
        Sparkline(
          values: p.spark,
          // Coloured by where control is going, not by the risk band — two
          // different facts, and conflating them hides a high-risk patient who
          // is improving.
          color: switch (p.trend) {
            'up' => T.danger,
            'down' => T.success,
            _ => T.inkMuted,
          },
          width: compact ? 60 : 48,
        ),
    ],
  );
}

class _RowAction extends StatelessWidget {
  const _RowAction({
    required this.act,
    required this.patientId,
    required this.name,
  });

  final bool act;
  final String patientId;
  final String name;

  @override
  Widget build(BuildContext context) {
    // One button per row, and it changes word rather than colour-weight: the
    // rows that need work say Review, the rest say View. Two filled buttons of
    // equal weight on every row is the same as none.
    return TextButton(
      onPressed:
          () => context.push('/clinician/patients/$patientId', extra: name),
      style: TextButton.styleFrom(
        backgroundColor: act ? T.dangerTint : T.primaryTint,
        foregroundColor: act ? T.danger : T.primary,
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      child: Text(
        act ? 'Review' : 'View',
        style: T.label.copyWith(fontSize: 12.5),
      ),
    );
  }
}

/// A tiny axis-free trend line. Same size, same stroke, same window everywhere
/// it appears, so two rows can be compared at a glance.
class Sparkline extends StatelessWidget {
  const Sparkline({
    super.key,
    required this.values,
    required this.color,
    this.width = 56,
    this.height = 22,
  });

  final List<double> values;
  final Color color;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: CustomPaint(painter: _SparkPainter(values, color)),
    );
  }
}

class _SparkPainter extends CustomPainter {
  const _SparkPainter(this.values, this.color);

  final List<double> values;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final lo = values.reduce(math.min);
    final hi = values.reduce(math.max);
    final span = (hi - lo).abs() < 0.001 ? 1.0 : hi - lo;

    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final x = size.width * (i / (values.length - 1));
      // Inset vertically so the end dot is never clipped by the box.
      final y = size.height - 3 - ((values[i] - lo) / span) * (size.height - 6);
      i == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }

    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );

    // The newest value, marked. Which end is "now" is otherwise a guess.
    final lastY =
        size.height - 3 - ((values.last - lo) / span) * (size.height - 6);
    canvas.drawCircle(Offset(size.width, lastY), 2.4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_SparkPainter old) =>
      old.values != values || old.color != color;
}

/// How current the screen is, in words.
///
/// Shared by the dashboard header and anything else that has to say when its
/// figures were last true — a queue that calls itself live owes the reader
/// that, and two places computing it separately is two places to drift.
String freshnessLabel(DateTime at) {
  final d = DateTime.now().difference(at);
  if (d.inSeconds < 45) return 'Updated just now';
  if (d.inMinutes < 60) return 'Updated ${d.inMinutes}m ago';
  return 'Updated ${d.inHours}h ago';
}
