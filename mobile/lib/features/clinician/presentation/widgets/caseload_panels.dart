import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/caseload_panels.dart';
import '../../domain/ecg_report.dart';
import '../clinician_providers.dart';
import 'home_panel.dart';

/// The caseload panels: blood sugar, HbA1c, blood pressure, follow-ups, the
/// condition register, heart rate, ECGs and lipids.
///
/// ---- Each one through [HomePanel] -----------------------------------------
///
/// So each is loading, failed, refused, unavailable or answered — and says
/// which — and a refresh that fails keeps the figures that were there. A panel
/// that could not load never shows the reassuring empty ("nobody in crisis"),
/// because a list that did not arrive has said nothing about the caseload. And
/// an answered empty still says what it counted, so "no crisis readings" is
/// distinguishable from "nobody has been measured".
///
/// ---- Colour is never the only carrier -------------------------------------
///
/// Every band is a word on a tint, and every count is a number followed by what
/// it counts. These patients are the reason the panels exist, and a red dot
/// means nothing to somebody who cannot see red.
///
/// ---- Their own requests, on the slower rhythm -----------------------------
///
/// Fetched when the home opens, on return to the app and on pull to refresh,
/// never on the twenty-second poll: each reads every reading in its window for
/// the whole caseload. See `_refreshCaseload` in the home screen.

/// The patients a panel names before it only counts.
const int _shown = 3;

/// "6 months", "a year", "14 days" — the window a panel counted over.
String windowLabel(int days) => switch (days) {
  365 => 'the last year',
  180 => 'the last 6 months',
  90 => 'the last 90 days',
  _ => 'the last $days days',
};

Widget _more(int total, int shown, String what) => total > shown
    ? PanelNote('${total - shown} more $what')
    : const SizedBox.shrink();

Widget _noCaseload() =>
    const PanelNote('No patients are enrolled at this practice yet.', top: 0);

/// "118 of 142 patients" in weight, then the rest of the sentence.
Widget _ofCaseload(int count, int caseload, String rest) => Text.rich(
  TextSpan(
    children: [
      TextSpan(
        text: '$count of ${patients(caseload)}',
        style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink),
      ),
      TextSpan(text: ' $rest'),
    ],
  ),
  style: T.body.copyWith(color: T.inkMuted),
);

// ---------------------------------------------------------------------------
// Blood sugar: lows and very highs
// ---------------------------------------------------------------------------

class GlucoseFlagsCard extends ConsumerWidget {
  const GlucoseFlagsCard({super.key, this.showInRange = true});

  /// A fortnight: long enough that a pattern of evening hypos shows, short
  /// enough that it is still this prescription's doing.
  static const int days = 14;

  /// Whether to state the share of readings in range. Not when the glucose
  /// trend is on the same home: two cards each giving a percentage in range,
  /// counted over slightly different patients, is two answers to one question.
  final bool showInRange;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<GlucoseFlags>(
      icon: Icons.bloodtype_outlined,
      title: 'Blood sugar',
      what: 'blood sugar readings',
      value: ref.watch(glucoseFlagsProvider(days)),
      onRetry: () => ref.invalidate(glucoseFlagsProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d, showInRange: showInRange),
      ),
    );
  }

  static List<Widget> _body(GlucoseFlags d, {required bool showInRange}) {
    if (d.caseload == 0) return [_noCaseload()];
    if (d.readings == 0) {
      return [
        PanelNote(
          'Nobody logged a sugar reading in ${windowLabel(d.days)}.',
          color: T.ink,
          top: 0,
        ),
      ];
    }

    final pct = d.inRangePercent!;
    return [
      if (showInRange)
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: '$pct%',
                style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink),
              ),
              TextSpan(
                text:
                    ' of ${d.readings} readings were ${d.rangeLow}–${d.rangeHigh} mg/dL '
                    'over ${windowLabel(d.days)}.',
              ),
            ],
          ),
          style: T.body.copyWith(color: T.inkMuted),
        )
      else
        _ofCaseload(d.withReadings, d.caseload, 'logged a reading in ${windowLabel(d.days)}.'),
      if (d.lowsTotal == 0 && d.highsTotal == 0)
        PanelNote(
          'No readings below ${d.low} or above ${d.veryHigh} mg/dL.',
        ),
      if (d.lowsTotal > 0) ...[
        PanelNote(
          '${patients(d.lowsTotal)} had a low, below ${d.low} mg/dL',
          color: T.ink,
          strong: true,
          top: T.s3,
        ),
        for (final e in d.lows.take(_shown))
          PanelPatientRow(
            patientId: e.patient.id,
            name: e.patient.name,
            detail:
                '${e.count} ${e.count == 1 ? 'low' : 'lows'} · lowest ${e.extreme} mg/dL',
            status: e.serious > 0
                ? StatusWord(label: 'Below ${d.severeLow}', tone: Tone.danger)
                : const StatusWord(label: 'Low', tone: Tone.warning),
            trailing: e.patient.at == null ? null : shortDate(e.patient.at!),
          ),
        _more(d.lowsTotal, d.lows.take(_shown).length, 'had a low'),
      ],
      if (d.highsTotal > 0) ...[
        PanelNote(
          '${patients(d.highsTotal)} read above ${d.veryHigh} mg/dL',
          color: T.ink,
          strong: true,
          top: T.s3,
        ),
        for (final e in d.highs.take(_shown))
          PanelPatientRow(
            patientId: e.patient.id,
            name: e.patient.name,
            detail:
                '${e.count} above ${d.veryHigh} · highest ${e.extreme} mg/dL',
            status: e.serious > 0
                ? StatusWord(label: 'Above ${d.criticalHigh}', tone: Tone.danger)
                : const StatusWord(label: 'Very high', tone: Tone.warning),
            trailing: e.patient.at == null ? null : shortDate(e.patient.at!),
          ),
        _more(d.highsTotal, d.highs.take(_shown).length, 'read very high'),
      ],
      if (d.withoutReadings > 0 && showInRange)
        PanelNote(
          '${patients(d.withoutReadings)} logged no readings in ${windowLabel(d.days)}.',
          top: T.s3,
        ),
    ];
  }
}

// ---------------------------------------------------------------------------
// HbA1c
// ---------------------------------------------------------------------------

class Hba1cControlCard extends ConsumerWidget {
  const Hba1cControlCard({super.key});

  static const int days = 180;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<Hba1cControl>(
      icon: Icons.science_outlined,
      title: 'HbA1c',
      what: 'HbA1c results',
      value: ref.watch(hba1cControlProvider(days)),
      onRetry: () => ref.invalidate(hba1cControlProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static String _pct(num v) => '${labValue(v)}%';

  static List<Widget> _body(Hba1cControl d) {
    if (d.caseload == 0) return [_noCaseload()];
    return [
      if (d.withResult == 0)
        PanelNote(
          'No HbA1c results on file from ${windowLabel(d.days)}.',
          color: T.ink,
          top: 0,
        )
      else ...[
        _ofCaseload(d.withResult, d.caseload, 'have a result from ${windowLabel(d.days)}.'),
        CountLine(
          parts: [
            CountPart(d.atTarget, 'at their target'),
            CountPart(d.aboveTarget, 'above it', color: T.warning),
            CountPart(
              d.poorControl,
              'at ${_pct(d.poorControlLine)} or more',
              color: T.danger,
            ),
          ],
        ),
      ],
      if (d.aboveTotal > 0) ...[
        for (final a in d.above.take(_shown))
          PanelPatientRow(
            patientId: a.patient.id,
            name: a.patient.name,
            detail: '${_pct(a.percentage)} · their target ${_pct(a.target)}',
            status: a.poorControl
                ? StatusWord(label: '${_pct(d.poorControlLine)}+', tone: Tone.danger)
                : const StatusWord(label: 'Above target', tone: Tone.warning),
            trailing: a.patient.at == null ? null : shortDate(a.patient.at!),
          ),
        _more(d.aboveTotal, d.above.take(_shown).length, 'above target'),
      ],
      if (d.untestedTotal > 0) ...[
        PanelNote(
          '${patients(d.untestedTotal)} with no result in ${windowLabel(d.days)}',
          color: T.ink,
          strong: true,
          top: T.s3,
        ),
        for (final u in d.untested.take(_shown))
          PanelPatientRow(
            patientId: u.patient.id,
            name: u.patient.name,
            detail: u.lastTestedOn == null
                ? 'No result on file'
                : 'Last ${_pct(u.lastPercentage ?? 0)} on ${shortDate(u.lastTestedOn!)}',
          ),
        _more(d.untestedTotal, d.untested.take(_shown).length, 'with no recent result'),
      ],
    ];
  }
}

// ---------------------------------------------------------------------------
// Blood pressure control
// ---------------------------------------------------------------------------

class BpControlCard extends ConsumerWidget {
  const BpControlCard({super.key});

  static const int days = 90;

  /// The tint a band's tile takes, for anything drawing a band elsewhere.
  static Color? toneFor(BpBand band) => switch (band) {
    BpBand.hypertensiveCrisis => T.dangerTint,
    BpBand.hypotension || BpBand.stage2 => T.warningTint,
    _ => null,
  };

  static StatusWord _word(BpBand? band) => switch (band) {
    BpBand.hypertensiveCrisis => const StatusWord(label: 'Crisis', tone: Tone.danger),
    BpBand.hypotension => const StatusWord(label: 'Low', tone: Tone.warning),
    BpBand.stage2 => const StatusWord(label: 'Stage 2', tone: Tone.warning),
    _ => StatusWord(label: band?.label ?? 'Reading', tone: Tone.neutral),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<BpControl>(
      icon: Icons.monitor_heart_outlined,
      title: 'Blood pressure',
      what: 'blood pressure readings',
      value: ref.watch(bpControlProvider(days)),
      onRetry: () => ref.invalidate(bpControlProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static List<Widget> _body(BpControl d) {
    if (d.caseload == 0) return [_noCaseload()];
    int n(BpBand b) => d.bands[b] ?? 0;
    return [
      _ofCaseload(d.withReading, d.caseload, 'had a reading in ${windowLabel(d.days)}.'),
      CountLine(
        parts: [
          CountPart(n(BpBand.hypertensiveCrisis), 'in crisis', color: T.danger),
          CountPart(n(BpBand.stage2), 'at stage 2'),
          CountPart(n(BpBand.stage1), 'at stage 1'),
          CountPart(n(BpBand.elevated), 'elevated'),
          CountPart(n(BpBand.normal), 'normal'),
          CountPart(n(BpBand.hypotension), 'low'),
        ],
      ),
      if (d.withoutReading > 0)
        PanelNote('${d.withoutReading} not measured in ${windowLabel(d.days)}.'),
      if (d.attention.isEmpty)
        const PanelNote('Nobody’s latest reading is in crisis, at stage 2 or low.')
      else ...[
        for (final p in d.attention.take(_shown))
          PanelPatientRow(
            patientId: p.id,
            name: p.name,
            detail: p.detail,
            status: _word(BpBand.fromApi(p.flag)),
            trailing: p.at == null ? null : shortDate(p.at!),
          ),
        _more(d.attentionTotal, d.attention.take(_shown).length, 'need attention'),
      ],
    ];
  }
}

// ---------------------------------------------------------------------------
// Follow-ups due
// ---------------------------------------------------------------------------

class FollowUpsDueCard extends ConsumerWidget {
  const FollowUpsDueCard({super.key});

  static const int days = 7;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).user?.name;
    return HomePanel<FollowUps>(
      icon: Icons.event_repeat_outlined,
      title: 'Follow-ups',
      what: 'follow-ups',
      value: ref.watch(followUpsProvider(days)),
      onRetry: () => ref.invalidate(followUpsProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d, me: me),
      ),
    );
  }

  /// "Tomorrow", "Fri 18 Sep" — when, in the words a doctor plans a week in.
  static String _when(DateTime at) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(at.year, at.month, at.day);
    final diff = day.difference(today).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Tomorrow';
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return '${weekdays[at.weekday - 1]} ${shortDate(at)}';
  }

  /// The doctor who asked for the follow-up, unless it is the reader: their
  /// own name on every row is noise, a colleague's is the point.
  static String? _whose(String? doctor, String? me) {
    if (doctor == null || doctor.trim().isEmpty) return null;
    String plain(String s) =>
        s.toLowerCase().replaceAll(RegExp(r'^(dr|prof)\.?\s+'), '').trim();
    if (me != null && plain(doctor) == plain(me)) return null;
    return 'Asked for by $doctor';
  }

  static List<Widget> _body(FollowUps d, {String? me}) {
    if (d.overdueTotal == 0 && d.dueTotal == 0) {
      return [
        PanelNote(
          'None due in the next ${d.days} days, and none overdue.',
          color: T.ink,
          top: 0,
        ),
      ];
    }
    return [
      CountLine(
        top: 0,
        parts: [
          CountPart(d.overdueTotal, 'overdue', color: T.warning),
          CountPart(d.dueTotal, 'due in the next ${d.days} days'),
        ],
      ),
      for (final p in d.overdue.take(_shown))
        PanelPatientRow(
          patientId: p.id,
          name: p.name,
          detail: [
            if (p.at != null) 'Was due ${shortDate(p.at!)}',
            if (_whose(p.detail, me) case final whose?) whose,
          ].join(' · '),
          status: const StatusWord(label: 'Overdue', tone: Tone.warning),
        ),
      _more(d.overdueTotal, d.overdue.take(_shown).length, 'overdue'),
      for (final p in d.due.take(_shown))
        PanelPatientRow(
          patientId: p.id,
          name: p.name,
          detail: _whose(p.detail, me),
          trailing: p.at == null ? null : _when(p.at!),
        ),
      _more(d.dueTotal, d.due.take(_shown).length, 'due this week'),
    ];
  }
}

// ---------------------------------------------------------------------------
// Condition register
// ---------------------------------------------------------------------------

class ConditionRegisterCard extends ConsumerWidget {
  const ConditionRegisterCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final language = Localizations.localeOf(context).languageCode;
    return HomePanel<ConditionRegister>(
      icon: Icons.assignment_outlined,
      title: 'Conditions',
      what: 'the condition register',
      value: ref.watch(conditionRegisterProvider(language)),
      onRetry: () => ref.invalidate(conditionRegisterProvider(language)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static List<Widget> _body(ConditionRegister d) {
    if (d.caseload == 0) return [_noCaseload()];
    if (d.conditions.isEmpty) {
      return [
        const PanelNote(
          'No diagnosed conditions are recorded for this practice’s patients.',
          color: T.ink,
          top: 0,
        ),
      ];
    }
    return [
      for (final c in d.conditions)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: Text(c.name, style: T.body.copyWith(color: T.ink))),
              const SizedBox(width: T.s3),
              Text('${c.count}', style: T.bodyStrong.copyWith(color: T.ink)),
            ],
          ),
        ),
      if (d.withoutCondition > 0)
        PanelNote('${patients(d.withoutCondition)} with no diagnosed condition recorded.'),
    ];
  }
}

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

class HeartRateFlagsCard extends ConsumerWidget {
  const HeartRateFlagsCard({super.key});

  static const int days = 30;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<HeartRateFlags>(
      icon: Icons.favorite_border_rounded,
      title: 'Heart rate',
      what: 'pulse readings',
      value: ref.watch(heartRateFlagsProvider(days)),
      onRetry: () => ref.invalidate(heartRateFlagsProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static List<Widget> _body(HeartRateFlags d) {
    final caseload = d.withReading + d.withoutReading;
    if (caseload == 0) return [_noCaseload()];
    return [
      _ofCaseload(d.withReading, caseload, 'had a pulse recorded in ${windowLabel(d.days)}.'),
      if (d.withReading > 0 && d.lowTotal == 0 && d.highTotal == 0)
        PanelNote('Nobody’s latest pulse is below ${d.lowLimit} or above ${d.highLimit} bpm.'),
      for (final p in d.low.take(_shown))
        PanelPatientRow(
          patientId: p.id,
          name: p.name,
          detail: p.detail,
          status: StatusWord(label: 'Below ${d.lowLimit}', tone: Tone.warning),
          trailing: p.at == null ? null : shortDate(p.at!),
        ),
      _more(d.lowTotal, d.low.take(_shown).length, 'below ${d.lowLimit} bpm'),
      for (final p in d.high.take(_shown))
        PanelPatientRow(
          patientId: p.id,
          name: p.name,
          detail: p.detail,
          status: StatusWord(label: 'Above ${d.highLimit}', tone: Tone.warning),
          trailing: p.at == null ? null : shortDate(p.at!),
        ),
      _more(d.highTotal, d.high.take(_shown).length, 'above ${d.highLimit} bpm'),
    ];
  }
}

// ---------------------------------------------------------------------------
// ECGs
// ---------------------------------------------------------------------------

class RecentEcgsCard extends ConsumerWidget {
  const RecentEcgsCard({super.key});

  static const int days = 180;

  /// The tint an impression's tile takes. Read by the ECG section on the
  /// patient record, so the two screens colour an impression the same way.
  static Color? toneFor(EcgImpression impression) => switch (impression) {
    EcgImpression.abnormal => T.dangerTint,
    EcgImpression.borderline => T.warningTint,
    _ => null,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<EcgPanel>(
      icon: Icons.show_chart_rounded,
      title: 'ECGs',
      what: 'ECGs',
      value: ref.watch(ecgPanelProvider(days)),
      onRetry: () => ref.invalidate(ecgPanelProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static List<Widget> _body(EcgPanel d) {
    final caseload = d.withEcg + d.withoutEcg;
    if (caseload == 0) return [_noCaseload()];
    if (d.withEcg == 0) {
      return [
        PanelNote('No ECGs filed in ${windowLabel(d.days)}.', color: T.ink, top: 0),
      ];
    }
    int n(EcgImpression i) => d.impressions[i] ?? 0;
    return [
      _ofCaseload(d.withEcg, caseload, 'have an ECG from ${windowLabel(d.days)}.'),
      CountLine(
        parts: [
          CountPart(n(EcgImpression.abnormal), 'abnormal', color: T.danger),
          CountPart(n(EcgImpression.borderline), 'borderline'),
          CountPart(n(EcgImpression.normal), 'normal'),
          CountPart(n(EcgImpression.unknown), 'not yet read', color: T.warning),
        ],
      ),
      if (d.flagged.isEmpty)
        const PanelNote('No latest ECG was read as abnormal or borderline.')
      else ...[
        for (final f in d.flagged.take(_shown))
          PanelPatientRow(
            patientId: f.patient.id,
            name: f.patient.name,
            detail: f.patient.detail,
            status: StatusWord(
              label: f.impression.label,
              tone: f.impression == EcgImpression.abnormal ? Tone.danger : Tone.warning,
            ),
            trailing: f.patient.at == null ? null : shortDate(f.patient.at!),
          ),
        _more(d.flaggedTotal, d.flagged.take(_shown).length, 'abnormal or borderline'),
      ],
    ];
  }
}

// ---------------------------------------------------------------------------
// Lipids
// ---------------------------------------------------------------------------

class LipidControlCard extends ConsumerWidget {
  const LipidControlCard({super.key});

  static const int days = 365;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return HomePanel<LipidControl>(
      icon: Icons.water_drop_outlined,
      title: 'LDL cholesterol',
      what: 'LDL results',
      value: ref.watch(lipidControlProvider(days)),
      onRetry: () => ref.invalidate(lipidControlProvider(days)),
      builder: (d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _body(d),
      ),
    );
  }

  static List<Widget> _body(LipidControl d) {
    final caseload = d.withResult + d.withoutResult;
    if (caseload == 0) return [_noCaseload()];
    return [
      _ofCaseload(d.withResult, caseload, 'have an LDL result from ${windowLabel(d.days)}.'),
      // Where the numbers came from, every time. They were read off uploaded
      // reports automatically, and a value misread from a photograph is still
      // a value — the report is what to act on.
      const PanelNote(
        'Read automatically from uploaded lab reports. Open the report before acting on a value.',
      ),
      if (d.withResult > 0 && d.aboveTotal == 0)
        PanelNote('Nobody’s latest LDL is above ${d.limit}.'),
      for (final p in d.above.take(_shown))
        PanelPatientRow(
          patientId: p.id,
          name: p.name,
          detail: p.detail,
          status: const StatusWord(label: 'Above target', tone: Tone.warning),
          trailing: p.at == null ? null : shortDate(p.at!),
        ),
      _more(d.aboveTotal, d.above.take(_shown).length, 'above ${d.limit}'),
      if (d.atOrBelow > 0) PanelNote('${d.atOrBelow} at or below ${d.limit}.'),
    ];
  }
}
