import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/clinician_models.dart';
import '../clinician_providers.dart';
import 'home_panel.dart';

/// How urgently a patient needs the doctor, as a band the server computed.
enum Triage {
  critical('Critical'),
  high('High risk'),
  moderate('Moderate risk'),
  low('Low risk');

  const Triage(this.label);

  final String label;

  static Triage of(String band) => switch (band) {
    'critical' => Triage.critical,
    'high' => Triage.high,
    'moderate' => Triage.moderate,
    _ => Triage.low,
  };
}

/// Whether a patient belongs on the "Needs attention" card at all.
///
/// Critical or high risk, or an alert nobody has dealt with. The old queue was
/// the whole risk-sorted roll: with nobody unwell it still listed five
/// low-risk patients under "Patients requiring immediate attention", each with
/// a "View" button, which is a list that cries wolf in both directions.
bool needsAttention(PatientListItem p) {
  final band = Triage.of(p.riskBand);
  return band == Triage.critical || band == Triage.high || p.openAlertCount > 0;
}

/// Worst first, then most open alerts, then the higher score.
List<PatientListItem> rankForAttention(Iterable<PatientListItem> patients) =>
    [...patients]..sort((a, b) {
      final byBand = Triage.of(a.riskBand).index.compareTo(Triage.of(b.riskBand).index);
      if (byBand != 0) return byBand;
      final byAlerts = b.openAlertCount.compareTo(a.openAlertCount);
      if (byAlerts != 0) return byAlerts;
      return b.riskScore.compareTo(a.riskScore);
    });

/// Why this patient is on the card, in the words a doctor would use — once.
///
/// The old row said "2 alerts" and then "2 open alerts" a line below, and
/// "Elevated HbA1c: 8.6%" above a second "8.6%". Reasons are ordered by what
/// would change the next action first: an open alert, then a poorly
/// controlled HbA1c, then sugars climbing, then silence. And there is no
/// "All readings in range" fallback any more — nothing on this row checks
/// that, so the row says when the last reading was instead.
({String text, bool urgent}) triageReason(PatientListItem p) {
  final alerts = p.openAlertCount;
  if (alerts > 0) {
    return (text: alerts == 1 ? '1 open alert' : '$alerts open alerts', urgent: true);
  }

  final a1c = p.hba1c;
  if (a1c != null && a1c >= 9) {
    return (text: 'HbA1c ${a1c.toStringAsFixed(1)}%', urgent: true);
  }

  final delta = p.trendDelta;
  if (delta != null && delta > 0) {
    return (text: 'Sugars up $delta mg/dL on average', urgent: p.riskBand != 'low');
  }

  if (p.checkInOverdue) {
    final at = p.lastReadingAt;
    return (
      text: at == null
          ? 'No readings yet'
          : 'No reading for ${DateTime.now().difference(at).inDays} days',
      urgent: false,
    );
  }

  if (a1c != null && a1c >= 7) {
    return (text: 'HbA1c ${a1c.toStringAsFixed(1)}%, above 7%', urgent: false);
  }
  if (delta != null && delta < 0) {
    return (text: 'Sugars down ${-delta} mg/dL on average', urgent: false);
  }
  return (text: lastSeenLabel(p.lastReadingAt), urgent: false);
}

/// "Last reading 3 days ago" — since what, said.
String lastSeenLabel(DateTime? at) {
  if (at == null) return 'No readings yet';
  final d = DateTime.now().difference(at);
  final ago = switch (d) {
    _ when d.inMinutes < 60 => 'within the hour',
    _ when d.inHours < 24 => '${d.inHours} ${d.inHours == 1 ? 'hour' : 'hours'} ago',
    _ when d.inDays < 2 => 'yesterday',
    _ when d.inDays < 60 => '${d.inDays} days ago',
    _ => '${(d.inDays / 30).floor()} months ago',
  };
  return 'Last reading $ago';
}

/// Who needs the doctor now.
class TriageQueue extends ConsumerWidget {
  const TriageQueue({
    super.key,
    required this.patients,
    this.openAlerts,
  });

  final AsyncValue<List<PatientListItem>> patients;

  /// Open alerts across the practice, from the overview — null while unknown.
  final int? openAlerts;

  static const int shown = 5;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<List<PatientListItem>>(
      icon: Icons.flag_outlined,
      title: 'Needs attention',
      what: 'who needs attention',
      value: patients,
      onRetry: () => ref.invalidate(attentionPatientsProvider),
      builder: (list) => _AttentionBody(patients: list, openAlerts: openAlerts),
    );
  }
}

class _AttentionBody extends StatelessWidget {
  const _AttentionBody({required this.patients, required this.openAlerts});

  final List<PatientListItem> patients;
  final int? openAlerts;

  @override
  Widget build(BuildContext context) {
    final needing = rankForAttention(patients.where(needsAttention));
    final moderate = patients
        .where((p) => Triage.of(p.riskBand) == Triage.moderate && p.openAlertCount == 0)
        .length;
    final alerts = openAlerts ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (needing.isEmpty) ...[
          // Calm, once. No red plate, no row of zeros — and it says what
          // "nobody" was checked against, so it is a finding, not a mood.
          Row(
            children: [
              const Icon(Icons.check_circle_outline_rounded, size: T.s6, color: T.success),
              const SizedBox(width: T.s3),
              Expanded(
                child: Text(
                  // Only claims what it checked. An alert can belong to a
                  // patient outside the ranked list, or to nobody, and the
                  // link below then says so — the two must not disagree.
                  alerts == 0
                      ? 'Nobody is at high risk or has an open alert.'
                      : 'Nobody on the list is at high risk.',
                  style: T.body.copyWith(color: T.ink),
                ),
              ),
            ],
          ),
          CountLine(parts: [CountPart(moderate, 'at moderate risk to keep an eye on')]),
        ] else ...[
          CountLine(
            top: 0,
            parts: [
              CountPart(
                needing.where((p) => Triage.of(p.riskBand) == Triage.critical).length,
                'critical',
                color: T.danger,
              ),
              CountPart(
                needing.where((p) => Triage.of(p.riskBand) == Triage.high).length,
                'high risk',
              ),
              CountPart(
                needing.where((p) => p.openAlertCount > 0).length,
                'with open alerts',
              ),
            ],
          ),
          for (final p in needing.take(TriageQueue.shown)) _AttentionRow(patient: p),
          if (needing.length > TriageQueue.shown)
            Row(
              children: [
                Expanded(
                  child: PanelNote('${needing.length - TriageQueue.shown} more need attention'),
                ),
                ViewAllButton(
                  onTap: () => context.go('/clinician/patients'),
                  semanticLabel: 'View all patients',
                ),
              ],
            ),
        ],
        if (alerts > 0) ...[
          const SizedBox(height: T.s3),
          _AlertsLink(count: alerts),
        ],
      ],
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({required this.patient});

  final PatientListItem patient;

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final band = Triage.of(p.riskBand);
    final reason = triageReason(p);
    final last = lastSeenLabel(p.lastReadingAt);
    // When the reason is already about readings, the last reading is the same
    // fact twice: "No reading for 19 days · last reading 19 days ago".
    final aboutReadings = reason.text.toLowerCase().contains('reading');

    return PanelPatientRow(
      patientId: p.id,
      name: p.name,
      detail: aboutReadings
          ? reason.text
          : '${reason.text} · ${last[0].toLowerCase()}${last.substring(1)}',
      status: switch (band) {
        Triage.critical => const StatusWord(label: 'Critical', tone: Tone.danger),
        Triage.high => const StatusWord(label: 'High risk', tone: Tone.warning),
        _ => const StatusWord(label: 'Open alert', tone: Tone.warning),
      },
      leading: UserAvatar(
        name: p.name,
        avatarUrl: p.avatarUrl,
        accent: T.primary,
        size: T.s8 + T.s2,
      ),
    );
  }
}

/// The way to the alerts themselves, from the card that is already about them.
///
/// The home had three: an "Alerts" pill, a "Raised Alerts" panel with a filled
/// "Review Case" button on every alert, and the bell. The patients with alerts
/// are the rows above; this is the one link to act on the alerts.
class _AlertsLink extends StatelessWidget {
  const _AlertsLink({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$count open ${count == 1 ? 'alert' : 'alerts'}. View all alerts',
      excludeSemantics: true,
      child: Material(
        color: T.surface,
        borderRadius: BorderRadius.circular(T.rControl),
        child: InkWell(
          borderRadius: BorderRadius.circular(T.rControl),
          onTap: () => context.push('/clinician/alerts'),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: T.tap),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(T.s3, T.s1, T.s1, T.s1),
              child: Row(
                children: [
                  const Icon(Icons.notification_important_outlined, size: T.s6, color: T.inkMuted),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: Text(
                      '$count open ${count == 1 ? 'alert' : 'alerts'}',
                      style: T.bodyStrong.copyWith(color: T.ink),
                    ),
                  ),
                  const IgnorePointer(child: ViewAllButton(onTap: _noop)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static void _noop() {}
}

/// "Updated 10:42", or when it last was.
///
/// Said as the time the figures arrived, not "just now": a label computed from
/// when a refresh was *asked for* said "Updated just now" beside a green dot on
/// a screen whose every request had failed.
String freshnessLabel(DateTime at) {
  final now = DateTime.now();
  final sameDay = now.year == at.year && now.month == at.month && now.day == at.day;
  final h = at.hour % 12 == 0 ? 12 : at.hour % 12;
  final m = at.minute.toString().padLeft(2, '0');
  final time = '$h:$m ${at.hour < 12 ? 'AM' : 'PM'}';
  return sameDay ? time : '${shortDate(at)}, $time';
}
