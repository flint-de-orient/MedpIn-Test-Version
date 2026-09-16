import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/caseload_panels.dart';
import '../clinician_providers.dart';

/// The caseload panels: blood pressure control, follow-ups due, the condition
/// register and heart rate.
///
/// ---- Three states, never two ------------------------------------------------
///
/// Each panel is loading, failed, or answered — and says which. A panel that
/// could not load never shows the reassuring empty ("nobody in crisis"), because
/// a list that did not arrive has said nothing about the caseload. And an
/// answered empty still says what it counted, so "no crisis readings" is
/// distinguishable from "nobody has been measured".
///
/// ---- Colour is never the only carrier ---------------------------------------
///
/// Every band has its word beside its count. These patients are the reason the
/// panels exist, and a red dot means nothing to somebody who cannot see red.

/// The patients a panel names before it only counts.
const int _shown = 3;

class _PanelShell extends StatelessWidget {
  const _PanelShell({
    required this.icon,
    required this.title,
    required this.loading,
    required this.failed,
    required this.failedText,
    required this.children,
  });

  final IconData icon;
  final String title;
  final bool loading;
  final bool failed;
  final String failedText;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: T.s5, color: T.primary),
              const SizedBox(width: T.s2),
              Expanded(child: Text(title, style: T.title)),
            ],
          ),
          if (failed)
            Padding(
              padding: const EdgeInsets.only(top: T.s2),
              child: Text(failedText, style: T.small.copyWith(color: T.inkMuted)),
            )
          else if (loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: T.s5),
              child: Center(
                child: SizedBox(
                  width: T.s5,
                  height: T.s5,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            ...children,
        ],
      ),
    );
  }
}

/// One named patient, tappable to their record.
class _PatientRow extends StatelessWidget {
  const _PatientRow({required this.patient, this.tone});

  final PanelPatient patient;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final name = patient.name ?? 'A patient';
    final when = patient.at == null ? null : _shortDate(patient.at!);
    return Padding(
      padding: const EdgeInsets.only(top: T.s2),
      child: InnerTile(
        tone: tone,
        onTap: () => context.push('/clinician/patients/${patient.id}', extra: patient.name),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: T.tap - 2 * T.s3),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: T.bodyStrong),
                    if (patient.detail != null && patient.detail!.isNotEmpty)
                      Text(patient.detail!, style: T.small.copyWith(color: T.inkMuted)),
                  ],
                ),
              ),
              if (when != null) Text(when, style: T.small.copyWith(color: T.inkMuted)),
            ],
          ),
        ),
      ),
    );
  }
}

String _shortDate(DateTime d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${months[d.month - 1]}';
}

Widget _note(String text, {Color? color, FontWeight? weight}) => Padding(
      padding: const EdgeInsets.only(top: T.s2),
      child: Text(text, style: T.small.copyWith(color: color ?? T.inkMuted, fontWeight: weight)),
    );

Widget _more(int total, int shown, String noun) =>
    total > shown ? _note('+${total - shown} more $noun') : const SizedBox.shrink();

// ---------------------------------------------------------------------------
// Blood pressure control
// ---------------------------------------------------------------------------

class BpControlCard extends ConsumerWidget {
  const BpControlCard({super.key});

  static const int days = 90;

  static Color? toneFor(BpBand band) => switch (band) {
        BpBand.hypertensiveCrisis => T.dangerTint,
        BpBand.hypotension || BpBand.stage2 => T.warningTint,
        _ => null,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bpControlProvider(days));
    final data = async.valueOrNull;

    return _PanelShell(
      icon: Icons.monitor_heart_outlined,
      title: 'Blood pressure control',
      loading: data == null,
      failed: data == null && async.hasError,
      failedText: 'Could not load blood pressure. Pull down to try again.',
      children: data == null ? const [] : _body(data),
    );
  }

  static List<Widget> _body(BpControl d) {
    if (d.caseload == 0) return [_note('No patients are enrolled at this practice yet.')];
    return [
      _note(
        '${d.withReading} of ${d.caseload} patients measured in the last ${d.days} days.',
      ),
      Padding(
        padding: const EdgeInsets.only(top: T.s2),
        child: Wrap(
          spacing: T.s2,
          runSpacing: T.s2,
          children: [
            for (final band in BpBand.values)
              if ((d.bands[band] ?? 0) > 0)
                InnerTile(
                  tone: toneFor(band),
                  padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
                  child: Text('${band.label} ${d.bands[band]}', style: T.small.copyWith(color: T.ink)),
                ),
          ],
        ),
      ),
      if (d.withoutReading > 0)
        _note('${d.withoutReading} not measured in ${d.days} days.', color: T.warning, weight: FontWeight.w600),
      if (d.attention.isEmpty)
        _note('Nobody’s latest reading is in crisis, stage 2 or low.')
      else ...[
        for (final p in d.attention.take(_shown))
          _PatientRow(patient: p, tone: T.warningTint),
        _more(d.attentionTotal, _shown.clamp(0, d.attention.length), 'needing attention'),
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
    final async = ref.watch(followUpsProvider(days));
    final data = async.valueOrNull;

    return _PanelShell(
      icon: Icons.event_repeat_outlined,
      title: 'Follow-ups due',
      loading: data == null,
      failed: data == null && async.hasError,
      failedText: 'Could not load follow-ups. Pull down to try again.',
      children: data == null ? const [] : _body(data),
    );
  }

  static List<Widget> _body(FollowUps d) {
    if (d.overdueTotal == 0 && d.dueTotal == 0) {
      return [_note('No follow-ups are due in the next ${d.days} days, and none are overdue.')];
    }
    return [
      if (d.overdueTotal > 0) ...[
        _note('${d.overdueTotal} overdue', color: T.danger, weight: FontWeight.w600),
        for (final p in d.overdue.take(_shown)) _PatientRow(patient: p, tone: T.dangerTint),
        _more(d.overdueTotal, _shown.clamp(0, d.overdue.length), 'overdue'),
      ],
      if (d.dueTotal > 0) ...[
        _note('${d.dueTotal} due in the next ${d.days} days', weight: FontWeight.w600),
        for (final p in d.due.take(_shown)) _PatientRow(patient: p),
        _more(d.dueTotal, _shown.clamp(0, d.due.length), 'due'),
      ],
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
    final async = ref.watch(conditionRegisterProvider(language));
    final data = async.valueOrNull;

    return _PanelShell(
      icon: Icons.assignment_outlined,
      title: 'Conditions',
      loading: data == null,
      failed: data == null && async.hasError,
      failedText: 'Could not load the condition register. Pull down to try again.',
      children: data == null ? const [] : _body(data),
    );
  }

  static List<Widget> _body(ConditionRegister d) {
    if (d.caseload == 0) return [_note('No patients are enrolled at this practice yet.')];
    if (d.conditions.isEmpty) {
      return [_note('No diagnosed conditions are recorded for this practice’s patients.')];
    }
    return [
      for (final c in d.conditions)
        Padding(
          padding: const EdgeInsets.only(top: T.s2),
          child: Row(
            children: [
              Expanded(child: Text(c.name, style: T.body)),
              Text('${c.count}', style: T.bodyStrong),
            ],
          ),
        ),
      if (d.withoutCondition > 0) _note('${d.withoutCondition} patients have no diagnosed condition recorded.'),
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
    final async = ref.watch(heartRateFlagsProvider(days));
    final data = async.valueOrNull;

    return _PanelShell(
      icon: Icons.favorite_border,
      title: 'Heart rate',
      loading: data == null,
      failed: data == null && async.hasError,
      failedText: 'Could not load heart rate. Pull down to try again.',
      children: data == null ? const [] : _body(data),
    );
  }

  static List<Widget> _body(HeartRateFlags d) {
    if (d.withReading == 0 && d.withoutReading == 0) {
      return [_note('No patients are enrolled at this practice yet.')];
    }
    final range = '${d.lowLimit}–${d.highLimit} bpm';
    return [
      if (d.lowTotal == 0 && d.highTotal == 0)
        _note('No latest pulse outside $range in the last ${d.days} days.'),
      if (d.lowTotal > 0) ...[
        _note('${d.lowTotal} below ${d.lowLimit} bpm', color: T.warning, weight: FontWeight.w600),
        for (final p in d.low.take(_shown)) _PatientRow(patient: p, tone: T.warningTint),
        _more(d.lowTotal, _shown.clamp(0, d.low.length), 'below $range'),
      ],
      if (d.highTotal > 0) ...[
        _note('${d.highTotal} above ${d.highLimit} bpm', color: T.warning, weight: FontWeight.w600),
        for (final p in d.high.take(_shown)) _PatientRow(patient: p, tone: T.warningTint),
        _more(d.highTotal, _shown.clamp(0, d.high.length), 'above $range'),
      ],
      if (d.withoutReading > 0) _note('${d.withoutReading} patients have no pulse recorded in ${d.days} days.'),
    ];
  }
}
