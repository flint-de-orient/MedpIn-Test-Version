import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../domain/lab_overview.dart';
import 'home_panel.dart';

/// The three panels a laboratory or pathology home is made of, and the recent
/// reports a physician's and a cardiologist's home carry.
///
/// ---- Why these three and not a sample queue -----------------------------
///
/// This platform has no sample model, no ordering workflow and no bench
/// states. "12 pending, 4 processing" would be four numbers with nothing
/// behind them — which renders as a laboratory with no work in it rather than
/// as a feature nobody has built, and is the harder of the two to notice.
///
/// What exists is the report and the flags on its values. That is a real and
/// genuinely different screen from a caseload: what came back abnormal, rather
/// than who is in the building.
///
/// ---- Every flag carries a word ------------------------------------------
///
/// Red-green deficiency runs alongside diabetes, and retinopathy is common in
/// this clinic's patients. A red chip is never the only thing saying a result
/// is critical.

StatusWord _flagWord(String flag) => switch (flag) {
  'critical' => const StatusWord(label: 'Critical', tone: Tone.danger),
  'abnormal' || 'high' => const StatusWord(label: 'Abnormal', tone: Tone.warning),
  'low' => const StatusWord(label: 'Low', tone: Tone.warning),
  _ => const StatusWord(label: 'Normal', tone: Tone.neutral),
};

/// A report as a row: whose, what, which values, and when it was sampled.
Widget _reportRow(LabReportSummary r) {
  final values = [
    for (final v in r.abnormal)
      [v.label, v.reading, v.flag == 'normal' ? null : v.flag]
          .whereType<String>()
          .where((s) => s.isNotEmpty)
          .join(' '),
  ].where((s) => s.isNotEmpty);
  return PanelPatientRow(
    patientId: r.patientId ?? '',
    name: r.patientName,
    detail: [
      r.labName == null || r.labName!.isEmpty ? r.title : '${r.title} · ${r.labName}',
      if (values.isNotEmpty) values.join(', '),
    ].join('\n'),
    status: r.worstFlag == 'normal' ? null : _flagWord(r.worstFlag),
    trailing: r.testedOn == null ? null : shortDate(r.testedOn!),
  );
}

/// Results that came back critical, and nothing else.
///
/// Shown even when there are none — "Nothing critical" is exactly what somebody
/// opening this needs to read — but only once the answer has arrived. Saying it
/// while the request is in flight is saying it without knowing.
class CriticalLabResults extends StatelessWidget {
  const CriticalLabResults({super.key, required this.overview, required this.onRetry});

  final AsyncValue<LabOverview> overview;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return HomePanel<LabOverview>(
      icon: Icons.priority_high_rounded,
      title: 'Critical results',
      what: 'lab results',
      value: overview,
      onRetry: onRetry,
      builder: (o) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (o.critical.isEmpty)
            Row(
              children: [
                const Icon(Icons.check_circle_outline_rounded, size: T.s6, color: T.success),
                const SizedBox(width: T.s3),
                Expanded(
                  child: Text(
                    'Nothing came back critical in the last ${o.days} days.',
                    style: T.body.copyWith(color: T.ink),
                  ),
                ),
              ],
            )
          else ...[
            CountLine(
              top: 0,
              parts: [
                CountPart(
                  o.critical.length,
                  o.critical.length == 1 ? 'report with a critical value' : 'reports with a critical value',
                  color: T.danger,
                ),
              ],
            ),
            for (final r in o.critical) _reportRow(r),
          ],
        ],
      ),
    );
  }
}

/// The most recent reports, critical or not.
class RecentLabReports extends StatelessWidget {
  const RecentLabReports({super.key, required this.overview, required this.onRetry});

  final AsyncValue<LabOverview> overview;
  final VoidCallback onRetry;

  /// Enough to see the shape of the week without becoming the whole screen.
  static const shown = 4;

  @override
  Widget build(BuildContext context) {
    return HomePanel<LabOverview>(
      icon: Icons.science_outlined,
      title: 'Recent lab reports',
      what: 'lab reports',
      value: overview,
      onRetry: onRetry,
      builder: (o) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (o.recent.isEmpty)
            PanelNote('No lab reports filed in the last ${o.days} days.', color: T.ink, top: 0)
          else ...[
            for (final r in o.recent.take(shown)) _reportRow(r),
            if (o.recent.length > shown)
              PanelNote('${o.recent.length - shown} more in the last ${o.days} days'),
          ],
        ],
      ),
    );
  }
}

/// How many values came back at each flag, over the window, as one sentence.
class LabFlagSummary extends StatelessWidget {
  const LabFlagSummary({super.key, required this.overview, required this.onRetry});

  final AsyncValue<LabOverview> overview;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return HomePanel<LabOverview>(
      icon: Icons.fact_check_outlined,
      title: 'Results by flag',
      what: 'result counts',
      value: overview,
      onRetry: onRetry,
      builder: (o) {
        final f = o.flags;
        if (f.total == 0) {
          return PanelNote('No values recorded in the last ${o.days} days.', color: T.ink, top: 0);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${f.total} values',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink),
                  ),
                  TextSpan(text: ' in the last ${o.days} days'),
                ],
              ),
              style: T.body.copyWith(color: T.inkMuted),
            ),
            CountLine(
              parts: [
                CountPart(f.critical, 'critical', color: T.danger),
                CountPart(f.high, 'high'),
                CountPart(f.low, 'low'),
                CountPart(f.normal, 'normal'),
                // Only when there are any. When it is non-zero the answer
                // matters: those values have not been judged at all.
                CountPart(f.unflagged, 'not flagged', color: T.warning),
              ],
            ),
          ],
        );
      },
    );
  }
}
