import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../domain/lab_overview.dart';
import 'panel_ui.dart';

/// The three panels a laboratory or pathology department's home screen is made
/// of.
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

/// How a flag is spoken and coloured. One place, so the three panels below
/// cannot disagree about what amber means.
({String word, Color ink, Color tint}) _flag(String flag) {
  switch (flag) {
    case 'critical':
      return (word: 'Critical', ink: T.danger, tint: T.dangerTint);
    case 'high':
      return (word: 'High', ink: T.warning, tint: T.warningTint);
    case 'low':
      return (word: 'Low', ink: T.warning, tint: T.warningTint);
    default:
      return (word: 'Normal', ink: T.success, tint: T.successTint);
  }
}

/// Results that came back critical, and nothing else.
///
/// Shown even when there are none — "Nothing critical" is exactly what
/// somebody opening this needs to read, and a panel that vanishes when empty
/// is indistinguishable from a screen that failed to finish loading.
class CriticalLabResults extends StatelessWidget {
  const CriticalLabResults({super.key, required this.overview, this.onOpen});

  final LabOverview overview;
  final void Function(LabReportSummary report)? onOpen;

  @override
  Widget build(BuildContext context) {
    final reports = overview.critical;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PanelSectionHeader(
          title: 'Critical results',
          // The count, not a badge alone. "3" beside a heading is a number
          // whose unit the reader has to guess.
          subtitle: reports.isEmpty
              ? 'Nothing critical in the last ${overview.days} days'
              : '${reports.length} to look at',
        ),
        const SizedBox(height: T.s3),
        if (reports.isEmpty)
          const _AllClear(
            message: 'No result has come back critical.',
          )
        else
          for (final report in reports) ...[
            _ReportRow(report: report, onOpen: onOpen),
            const SizedBox(height: T.s2),
          ],
      ],
    );
  }
}

/// The most recent reports, critical or not.
class RecentLabReports extends StatelessWidget {
  const RecentLabReports({super.key, required this.overview, this.onOpen});

  final LabOverview overview;
  final void Function(LabReportSummary report)? onOpen;

  /// Enough to see the shape of the day without becoming the whole screen.
  /// The full list is the Records tab's job.
  static const _shown = 6;

  @override
  Widget build(BuildContext context) {
    final all = overview.recent;
    final reports = all.take(_shown).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PanelSectionHeader(
          title: 'Recent reports',
          // Says what is not being shown, rather than truncating in silence.
          subtitle: all.length > _shown
              ? 'Showing $_shown of ${all.length}'
              : null,
        ),
        const SizedBox(height: T.s3),
        if (reports.isEmpty)
          const _AllClear(
            message: 'No lab reports have been filed yet.',
            tone: _Tone.neutral,
          )
        else
          for (final report in reports) ...[
            _ReportRow(report: report, onOpen: onOpen),
            const SizedBox(height: T.s2),
          ],
      ],
    );
  }
}

/// How many values came back at each flag, over the window.
class LabFlagSummary extends StatelessWidget {
  const LabFlagSummary({super.key, required this.overview});

  final LabOverview overview;

  @override
  Widget build(BuildContext context) {
    final f = overview.flags;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PanelSectionHeader(
          title: 'Results',
          // The window, stated. A count with no period attached reads as
          // all-time, and an all-time count only ever grows.
          subtitle: 'Last ${overview.days} days',
        ),
        const SizedBox(height: T.s3),
        if (f.total == 0)
          const _AllClear(
            message: 'No values recorded in this period.',
            tone: _Tone.neutral,
          )
        else
          Wrap(
            // A Wrap, not a Row of four: at 360dp four counts across
            // ellipsise their own labels, and a count whose label is
            // "Unflagg…" is worse than one on a second line.
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              _Count(label: 'Critical', value: f.critical, flag: 'critical'),
              _Count(label: 'High', value: f.high, flag: 'high'),
              _Count(label: 'Low', value: f.low, flag: 'low'),
              _Count(label: 'Normal', value: f.normal, flag: 'normal'),
              if (f.unflagged > 0)
                // Only when there are any. A permanent zero here invites the
                // question "unflagged by whom", which is a conversation the
                // panel cannot have; when it is non-zero the answer matters,
                // because those values have not been judged at all.
                _Count(label: 'Not flagged', value: f.unflagged, flag: 'none'),
            ],
          ),
      ],
    );
  }
}

class _ReportRow extends StatelessWidget {
  const _ReportRow({required this.report, this.onOpen});

  final LabReportSummary report;
  final void Function(LabReportSummary report)? onOpen;

  @override
  Widget build(BuildContext context) {
    final tone = _flag(report.isCritical ? 'critical' : report.worstFlag == 'abnormal' ? 'high' : 'normal');
    final when = report.testedOn;

    return PanelCard(
      onTap: onOpen == null ? null : () => onOpen!(report),
      // The rail carries the severity, and the chip below says it in words.
      accentEdge: report.worstFlag == 'normal' ? null : tone.ink,
      padding: const EdgeInsets.symmetric(
        horizontal: T.s4,
        vertical: T.s3,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Expanded, and no Spacer beside it: the two both take flex and
              // would split the row, leaving the title ellipsised with blank
              // space next to it.
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      report.patientName ?? 'Unnamed patient',
                      style: T.bodyStrong,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      report.labName == null || report.labName!.isEmpty
                          ? report.title
                          : '${report.title} · ${report.labName}',
                      style: T.small.copyWith(color: T.inkMuted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: T.s3),
              if (report.worstFlag != 'normal')
                _Chip(word: tone.word, ink: tone.ink, tint: tone.tint),
            ],
          ),
          if (report.abnormal.isNotEmpty) ...[
            const SizedBox(height: T.s2),
            // Wrapping rather than scrolling: a horizontal rail always cuts
            // whatever lands at its edge, and the value that is cut off is as
            // likely to be the one that matters as any other.
            Wrap(
              spacing: T.s2,
              runSpacing: T.s1,
              children: [
                for (final v in report.abnormal) _Value(value: v),
              ],
            ),
          ],
          if (when != null) ...[
            const SizedBox(height: T.s2),
            Text(
              'Sampled ${DateFormat('d MMM').format(when)}',
              style: T.label.copyWith(color: T.inkFaint),
            ),
          ],
        ],
      ),
    );
  }
}

class _Value extends StatelessWidget {
  const _Value({required this.value});

  final LabValue value;

  @override
  Widget build(BuildContext context) {
    final tone = _flag(value.flag);
    final reading = value.reading;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s1),
      decoration: BoxDecoration(
        color: tone.tint,
        borderRadius: BorderRadius.circular(T.rCard),
      ),
      child: Text(
        // Label, reading and the word for the flag. A coloured chip with a
        // number in it says something is notable and not what.
        [
          value.label,
          reading,
          tone.word.toLowerCase(),
        ].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
        style: T.label.copyWith(color: tone.ink),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.word, required this.ink, required this.tint});

  final String word;
  final Color ink;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: 2),
      decoration: BoxDecoration(color: tint, borderRadius: T.rFull),
      child: Text(word, style: T.label.copyWith(color: ink)),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.value, required this.flag});

  final String label;
  final int value;
  final String flag;

  @override
  Widget build(BuildContext context) {
    final tone = flag == 'none'
        ? (word: label, ink: T.inkMuted, tint: T.surface)
        : _flag(flag);

    return Container(
      // Its own padding and its own minimum width, inherited from nothing.
      // This is the bug this codebase keeps finding: a chip that looks right
      // in a Row and becomes a full-width bar inside a Wrap.
      constraints: const BoxConstraints(minWidth: 84),
      padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
      decoration: BoxDecoration(
        color: tone.tint,
        borderRadius: BorderRadius.circular(T.rCard),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$value', style: T.metric.copyWith(color: tone.ink)),
          Text(label, style: T.label.copyWith(color: tone.ink)),
        ],
      ),
    );
  }
}

enum _Tone { clear, neutral }

/// An empty state that says what is empty, rather than disappearing.
class _AllClear extends StatelessWidget {
  const _AllClear({required this.message, this.tone = _Tone.clear});

  final String message;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final clear = tone == _Tone.clear;

    return PanelCard(
      background: clear ? T.successTint : null,
      padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
      child: Row(
        children: [
          Icon(
            clear ? Icons.check_circle_outline : Icons.science_outlined,
            size: 20,
            color: clear ? T.success : T.inkFaint,
          ),
          const SizedBox(width: T.s3),
          Expanded(
            child: Text(
              message,
              style: T.body.copyWith(color: clear ? T.success : T.inkMuted),
            ),
          ),
        ],
      ),
    );
  }
}
