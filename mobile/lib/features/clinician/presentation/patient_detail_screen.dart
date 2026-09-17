import 'dart:ui' show FontFeature;
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // FilteringTextInputFormatter, LengthLimitingTextInputFormatter
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../data/clinician_repository.dart';
import '../domain/clinician_models.dart';
import '../domain/patient_summary.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_visuals.dart';
import 'widgets/sparkline.dart';
import 'widgets/ecg_section.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/disclosure_tile.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../core/network/api_exception.dart';
import '../domain/nutrition_care.dart';

/// The read side of a patient: health score, adherence, glucose control, HbA1c
/// history, test reports, recent alerts, the dietician's review cadence, and
/// the same context the AI assistant is given before it answers.
///
/// A section list rather than a screen of its own. It sits underneath the
/// prescribing form on the Patient Profile, so one screen holds everything
/// about a patient — what you read and what you then do about it — instead of
/// splitting them across a navigation step.
class PatientRecordSections extends ConsumerWidget {
  const PatientRecordSections({
    super.key,
    required this.summary,
    required this.patientId,
  });

  final PatientSummary summary;
  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = summary;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _MetricsGrid(summary: p),
        _MeasurementsSection(summary: p),
        const SizedBox(height: AppSpacing.lg),
        _DieticianSection(summary: p, patientId: patientId),
        if (p.hba1cHistory.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              const Expanded(child: _SectionTitle('HbA1c history')),
              if (p.hba1cHistory.length > 4)
                TextButton(
                  onPressed: () => _showAllHba1c(context, p.hba1cHistory),
                  child: Text('View all (${p.hba1cHistory.length})'),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          // Latest four; the rest are behind "View all".
          _Hba1cList(points: p.hba1cHistory.take(4).toList()),
        ],
        if (p.labResults.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              const Expanded(child: _SectionTitle('Test reports')),
              if (p.labResults.length > 4)
                TextButton(
                  onPressed: () => _showAllReports(context, p.labResults),
                  child: Text('View all (${p.labResults.length})'),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          // Latest four, like the HbA1c history above it. Ten reports each
          // carrying a summary and a row of analyte chips ran to several
          // screens, and pushed the alerts and the consultation history below
          // them out of sight entirely.
          for (final r in p.labResults.take(4))
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _LabReportRow(report: r),
            ),
          // Trends read every report, not just the four on show: a trend drawn
          // from a quarter of the data would be a different trend.
          _AnalyteTrends(reports: p.labResults),
        ],
        // ECGs, read and filed by a clinician. Its own request, and it hides
        // itself when empty for somebody who could not file one.
        const SizedBox(height: AppSpacing.lg),
        EcgSection(patientId: patientId),
        if (p.alerts.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          const _SectionTitle('Recent alerts'),
          const SizedBox(height: AppSpacing.sm),
          for (final a in p.alerts.take(8))
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _AlertMini(
                title: a.title,
                severity: a.severity,
                status: a.status,
                when: a.createdAt,
              ),
            ),
        ],
        _ConsultationHistory(patientId: patientId),
        if (p.aiContext != null && p.aiContext!.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          _AiContextCard(text: p.aiContext!),
        ],
      ],
    );
  }

  /// Every uploaded report, in the same sheet the HbA1c history uses.
  void _showAllReports(BuildContext context, List<LabReport> reports) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.7,
            maxChildSize: 0.95,
            builder:
                (ctx, controller) => ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    0,
                    AppSpacing.md,
                    AppSpacing.lg,
                  ),
                  children: [
                    const _SectionTitle('Test reports'),
                    const SizedBox(height: AppSpacing.md),
                    for (final r in reports)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: _LabReportRow(report: r),
                      ),
                  ],
                ),
          ),
    );
  }

  /// The full HbA1c history in a scrollable sheet, behind the "View all" action.
  void _showAllHba1c(BuildContext context, List<Hba1cPoint> points) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.6,
            maxChildSize: 0.9,
            builder:
                (ctx, controller) => ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    0,
                    AppSpacing.md,
                    AppSpacing.lg,
                  ),
                  children: [
                    const _SectionTitle('HbA1c history'),
                    const SizedBox(height: AppSpacing.md),
                    _Hba1cList(points: points),
                  ],
                ),
          ),
    );
  }
}

/// The record's consultation history — past prescriptions latest-first, each
/// collapsible to reveal that visit's diagnosis, advice, tests and follow-up.
/// Renders nothing until at least one prescription exists.
class _ConsultationHistory extends ConsumerWidget {
  const _ConsultationHistory({required this.patientId});

  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list =
        ref.watch(patientPrescriptionsProvider(patientId)).valueOrNull ??
        const [];
    if (list.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.lg),
        const _SectionTitle('Previous consultations'),
        const SizedBox(height: AppSpacing.sm),
        for (final rx in list.take(12))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: _ConsultationTile(rx: rx),
          ),
      ],
    );
  }
}

class _ConsultationTile extends StatelessWidget {
  const _ConsultationTile({required this.rx});

  final PrescriptionSummary rx;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final date =
        rx.issuedOn != null
            ? DateFormat('d MMM yyyy').format(rx.issuedOn!)
            : '—';
    final dx =
        rx.diagnosis.isNotEmpty
            ? rx.diagnosis.join(', ')
            : 'No diagnosis recorded';

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: DisclosureTile(
          tilePadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 0,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          crossAxisAlignment: CrossAxisAlignment.start,
          title: Text(
            date,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          subtitle: Text(
            dx,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          children: [
            if (rx.diagnosis.isNotEmpty)
              _kv(context, 'Diagnosis', rx.diagnosis.join('\n')),
            if (rx.medicines.isNotEmpty)
              _kv(context, 'Medicines', rx.medicines.join('\n'))
            else if (rx.itemCount > 0)
              _kv(context, 'Medicines', '${rx.itemCount} prescribed'),
            if (rx.labTestsAdvised.isNotEmpty)
              _kv(context, 'Tests advised', rx.labTestsAdvised.join(', ')),
            if (rx.generalAdvice != null)
              _kv(context, 'Advice', rx.generalAdvice!),
            if (rx.followUpOn != null)
              _kv(
                context,
                'Follow-up',
                DateFormat('d MMM yyyy').format(rx.followUpOn!),
              ),
            if (rx.doctorName != null) _kv(context, 'By', rx.doctorName!),
          ],
        ),
      ),
    );
  }

  Widget _kv(BuildContext context, String k, String v) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            k.toUpperCase(),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 0),
          Text(v, style: const TextStyle(fontSize: 14, height: 1.3)),
        ],
      ),
    );
  }
}

/// The colour an HbA1c should be shown in.
///
/// These two tiles sat side by side in fixed purple and cyan, so a last HbA1c
/// of 5.6% and an estimated one of 9.8% read as equally unremarkable — which is
/// the one pairing on this screen a clinician must not skim past. Colour now
/// follows the value: at or above 8% it is red, 7–8% amber, below 7% green.
///
/// Thresholds are the ordinary adult targets, matching the ones the patient's
/// own screens already colour against, so the same number is never green for
/// one reader and red for another.
Color _hba1cTone(num? value) {
  if (value == null) return T.inkFaint;
  if (value >= 8) return T.danger;
  if (value >= 7) return T.warning;
  return T.success;
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.summary});
  final PatientSummary summary;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    // Adherence: the percentage as the headline. The doses breakdown lives in
    // the tap-through sheet, so the tile stays clean.
    final adherenceValue =
        p.adherencePercent != null ? '${p.adherencePercent}%' : '—';

    final tiles = <Widget>[
      _Metric(
        label: 'Health score',
        value: p.healthScore?.toString() ?? '—',
        color: AppColors.toneOn(context, healthBandColor(p.healthBand)),
        icon: Icons.favorite_rounded,
      ),
      _Metric(
        label: 'Adherence',
        value: adherenceValue,
        color: AppColors.accentOn(context),
        icon: Icons.medication_rounded,
        onTap: () => _showAdherenceSheet(context, p),
      ),
      _Metric(
        label: 'Medicines',
        value: p.medicationCount?.toString() ?? '—',
        unit: (p.medicationCount ?? 0) > 0 ? 'active' : null,
        color: AppColors.primary,
        icon: Icons.local_pharmacy_rounded,
      ),
      _Metric(
        label: 'Fasting sugar',
        value: p.lastFasting != null ? '${p.lastFasting}' : '—',
        unit: p.lastFasting != null ? 'mg/dL' : null,
        color: AppColors.warningOn(context),
        icon: Icons.bloodtype_rounded,
      ),
      _Metric(
        label: 'Last HbA1c',
        value: p.lastHba1c != null ? p.lastHba1c!.toStringAsFixed(1) : '—',
        unit: p.lastHba1c != null ? '%' : null,
        color: _hba1cTone(p.lastHba1c),
        icon: Icons.science_rounded,
      ),
      _Metric(
        label: 'Est. HbA1c',
        value:
            p.estimatedHba1c != null
                ? p.estimatedHba1c!.toStringAsFixed(1)
                : '—',
        unit: p.estimatedHba1c != null ? '%' : null,
        color: _hba1cTone(p.estimatedHba1c),
        icon: Icons.auto_graph_rounded,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      // Two columns that size to their content, not a grid with a fixed
      // aspect ratio. childAspectRatio pinned every tile to width/2.1, which
      // was a few pixels short of the text at anything above the default font
      // scale — so the values were clipped and the tiles painted the overflow
      // stripes. A ratio that fits one device's text settings is a ratio that
      // breaks on another's.
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[i]),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child:
                      i + 1 < tiles.length
                          ? tiles[i + 1]
                          : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  /// The adherence breakdown — with a week/month/year filter, overall doses,
  /// per-medicine, and the honest caveat about what the number captures.
  void _showAdherenceSheet(BuildContext context, PatientSummary p) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => _AdherenceSheet(
            patientId: p.id,
            // Seed with the summary's 30-day figures so the sheet opens instantly.
            initial: AdherenceReport(
              taken: p.adherenceTaken ?? 0,
              expected: p.adherenceExpected ?? 0,
              percentage: p.adherencePercent,
              perMed: p.adherencePerMed,
            ),
          ),
    );
  }
}

class _AdherenceSheet extends ConsumerStatefulWidget {
  const _AdherenceSheet({required this.patientId, required this.initial});
  final String patientId;
  final AdherenceReport initial;

  @override
  ConsumerState<_AdherenceSheet> createState() => _AdherenceSheetState();
}

class _AdherenceSheetState extends ConsumerState<_AdherenceSheet> {
  static const _periods = [
    (label: 'Week', days: 7),
    (label: 'Month', days: 30),
    (label: 'Year', days: 365),
  ];
  int _days = 30;
  late AdherenceReport _report = widget.initial;
  bool _loading = false;

  Future<void> _select(int days) async {
    setState(() {
      _days = days;
      _loading = true;
    });
    try {
      final r = await ref
          .read(clinicianRepositoryProvider)
          .patientAdherence(widget.patientId, days: days);
      if (mounted) setState(() => _report = r);
    } catch (_) {
      // Keep whatever was showing.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final r = _report;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.92,
      builder:
          (ctx, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.xl,
            ),
            children: [
              Row(
                children: [
                  Icon(
                    Icons.medication_rounded,
                    color: AppColors.accentOn(context),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Adherence',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                  const Spacer(),
                  if (_loading)
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Row(
                children: [
                  for (final period in _periods) ...[
                    _PeriodChip(
                      label: period.label,
                      selected: _days == period.days,
                      onTap: () => _select(period.days),
                    ),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                  border: Border.all(
                    color: scheme.outlineVariant.withValues(alpha: 0.6),
                  ),
                ),
                child:
                    r.expected == 0
                        ? Text(
                          'No scheduled doses have come due in this period.',
                          style: TextStyle(color: scheme.onSurfaceVariant),
                        )
                        : Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '${r.taken}/${r.expected}',
                              style: TextStyle(
                                fontSize: 32,
                                fontWeight: FontWeight.w800,
                                color: AppColors.accentOn(context),
                              ),
                            ),
                            const SizedBox(width: 4),
                            Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Text(
                                'doses taken',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                            const Spacer(),
                            if (r.percentage != null)
                              Text(
                                '${r.percentage}%',
                                style: const TextStyle(
                                  fontSize: 32,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                          ],
                        ),
              ),
              if (r.perMed.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  'By medicine',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                for (final m in r.perMed) _AdherenceRow(med: m),
              ],
              const SizedBox(height: AppSpacing.lg),
              Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      size: 16,
                      color: scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Counts only doses whose time has already passed, and only those the patient marked as taken in the app. A low figure can mean doses were not logged, not necessarily missed.',
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
    );
  }
}

class _PeriodChip extends StatelessWidget {
  const _PeriodChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color:
              selected
                  ? AppColors.primary
                  : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color:
                selected
                    ? AppColors.primary
                    : scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? Colors.white : scheme.onSurface,
          ),
        ),
      ),
    );
  }
}

/// The patient's physical measurements — height, weight, BMI, waist, BP, pulse,
/// SpO2 — from registration and the latest consult. Hidden until at least one
/// value exists.
class _MeasurementsSection extends StatelessWidget {
  const _MeasurementsSection({required this.summary});
  final PatientSummary summary;

  static String _n(double v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1);

  /// BMI bands (WHO). The colour carries the reading, so the doctor does not
  /// have to remember where 27.4 falls while scanning a screen.
  static (Color, String) _bmiBand(BuildContext c, double bmi) {
    if (bmi < 18.5) return (AppColors.warningOn(c), 'Underweight');
    if (bmi < 25) return (AppColors.successOn(c), 'Normal');
    if (bmi < 30) return (AppColors.warningOn(c), 'Overweight');
    return (AppColors.dangerOn(c), 'Obese');
  }

  /// Only clearly abnormal readings are coloured. Tinting every borderline
  /// figure would leave a screen of amber that says nothing.
  static (Color, String) _bpBand(BuildContext c, int sys, int dia) {
    if (sys >= 180 || dia >= 120) return (AppColors.dangerOn(c), 'Crisis');
    if (sys >= 140 || dia >= 90) return (AppColors.dangerOn(c), 'High');
    if (sys >= 130 || dia >= 80) return (AppColors.warningOn(c), 'Elevated');
    if (sys < 90 || dia < 60) return (AppColors.warningOn(c), 'Low');
    return (AppColors.successOn(c), 'Normal');
  }

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final tiles = <Widget>[];

    if (p.heightCm != null) {
      tiles.add(
        _MeasureTile(
          icon: Icons.straighten_rounded,
          label: 'Height',
          value: _n(p.heightCm!.toDouble()),
          unit: 'cm',
        ),
      );
    }
    if (p.weightKg != null) {
      tiles.add(
        _MeasureTile(
          icon: Icons.monitor_weight_outlined,
          label: 'Weight',
          value: _n(p.weightKg!.toDouble()),
          unit: 'kg',
        ),
      );
    }
    if (p.bmi != null) {
      final band = _bmiBand(context, p.bmi!.toDouble());
      tiles.add(
        _MeasureTile(
          icon: Icons.accessibility_new_rounded,
          label: 'BMI',
          value: p.bmi!.toStringAsFixed(1),
          note: band.$2,
          tone: band.$1,
        ),
      );
    }
    if (p.waistCm != null) {
      tiles.add(
        _MeasureTile(
          icon: Icons.radio_button_unchecked_rounded,
          label: 'Waist',
          value: _n(p.waistCm!.toDouble()),
          unit: 'cm',
        ),
      );
    }
    if (p.systolic != null && p.diastolic != null) {
      final band = _bpBand(context, p.systolic!, p.diastolic!);
      tiles.add(
        _MeasureTile(
          icon: Icons.favorite_outline_rounded,
          label: 'Blood pressure',
          value: '${p.systolic}/${p.diastolic}',
          unit: 'mmHg',
          note: band.$2,
          tone: band.$1,
        ),
      );
    }
    if (p.pulse != null) {
      tiles.add(
        _MeasureTile(
          icon: Icons.monitor_heart_outlined,
          label: 'Pulse',
          value: '${p.pulse}',
          unit: 'bpm',
        ),
      );
    }
    if (p.spo2 != null) {
      tiles.add(
        _MeasureTile(
          icon: Icons.air_rounded,
          label: 'SpO2',
          value: '${p.spo2}',
          unit: '%',
          tone: p.spo2! < 94 ? AppColors.dangerOn(context) : null,
          note: p.spo2! < 94 ? 'Low' : null,
        ),
      );
    }

    if (tiles.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.lg),
        const _SectionTitle('Measurements'),
        const SizedBox(height: AppSpacing.sm),
        // A real two-column grid, not a Wrap of label/value pairs. Wrapped,
        // they landed wherever they fitted, so the same patient's card changed
        // shape between visits and nothing lined up down the column.
        LayoutBuilder(
          builder: (context, c) {
            const gap = AppSpacing.sm;
            final w = (c.maxWidth - gap) / 2;
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [for (final t in tiles) SizedBox(width: w, child: t)],
            );
          },
        ),
      ],
    );
  }
}

/// One measurement: what it is, what it reads, and — where it means something
/// clinically — which side of normal it falls on.
class _MeasureTile extends StatelessWidget {
  const _MeasureTile({
    required this.icon,
    required this.label,
    required this.value,
    this.unit,
    this.note,
    this.tone,
  });

  final IconData icon;
  final String label;
  final String value;
  final String? unit;
  final String? note;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = tone ?? scheme.onSurface;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.55),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: tone ?? scheme.onSurfaceVariant),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Flexible(
                child: Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1,
                    color: accent,
                  ),
                ),
              ),
              if (unit != null) ...[
                const SizedBox(width: 4),
                Text(
                  unit!,
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
          if (note != null) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
              decoration: BoxDecoration(
                color: (tone ?? scheme.onSurfaceVariant).withValues(
                  alpha: 0.12,
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                note!,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: tone ?? scheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AdherenceRow extends StatelessWidget {
  const _AdherenceRow({required this.med});
  final MedAdherence med;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final frac =
        med.expected > 0 ? (med.taken / med.expected).clamp(0.0, 1.0) : 0.0;
    final pct = med.percentage;
    final color =
        pct == null
            ? scheme.onSurfaceVariant
            : (pct >= 80
                ? AppColors.success
                : (pct >= 50 ? AppColors.warning : AppColors.danger));
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  med.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              // Right-aligned in a fixed box, with tabular figures. Ragged
              // against the medicine name, "9/17" and "6/11" refuse to line up
              // and the column cannot be read down — which is the only way
              // anyone reads a list of fractions.
              SizedBox(
                width: 104,
                child: Text(
                  '${med.taken}/${med.expected}${pct != null ? '  ·  $pct%' : ''}',
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: LinearProgressIndicator(
              value: frac,
              minHeight: 6,
              backgroundColor: scheme.surfaceContainerHighest,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
    this.unit,
    this.onTap,
  });

  final String label;
  final String value;
  final String? unit;
  final Color color;
  final IconData icon;

  /// When set, the tile is tappable (a chevron hints it) — used to open the
  /// adherence breakdown sheet.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tile = Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (onTap != null)
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: scheme.onSurfaceVariant,
                ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
              if (unit != null) ...[
                const SizedBox(width: 4),
                Text(
                  unit!,
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );

    if (onTap == null) return tile;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: tile,
    );
  }
}

class _Hba1cList extends StatelessWidget {
  const _Hba1cList({required this.points});
  final List<Hba1cPoint> points;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < points.length; i++) ...[
            if (i > 0)
              Divider(
                height: 1,
                color: scheme.outlineVariant.withValues(alpha: 0.5),
              ),
            ListTile(
              dense: true,
              leading: Icon(
                Icons.science_outlined,
                color:
                    points[i].percentage >= 9
                        ? AppColors.danger
                        : (points[i].percentage >= 7
                            ? AppColors.warning
                            : AppColors.success),
              ),
              title: Text(
                '${points[i].percentage}%',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              trailing: Text(
                points[i].testedOn != null
                    ? DateFormat('MMM yyyy').format(points[i].testedOn!)
                    : '',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Who looks after this patient's nutrition at this practice, and — for a
/// doctor who may change it — the way to choose.
///
/// ---- It used to describe a default that no longer exists --------------------
///
/// "Covered by clinic dietician" and a "Restrict" button: an assignment was a
/// restriction, and every dietician covered everybody until one was made. The
/// caseload is the assignments now, per practice — so an unassigned patient is
/// looked after by nobody, and saying otherwise reads as reassurance about a
/// gap in cover.
///
/// ---- What it says, by state ------------------------------------------------
///
///   held by an active dietician  → their name, and how they came to hold it
///   held by somebody who left    → their name, "No longer works here", and a
///                                  prompt: nobody was moved on the doctor's
///                                  behalf
///   left without one on purpose  → "No dietician", and who decided
///   nobody decided, and there is
///   a choice to make             → "Not assigned", and "Needs a choice"
///   no dietician at the practice → "No dietician", said as a fact
///
/// Every status that needs the doctor carries a word, not only the amber.
class _DieticianSection extends ConsumerWidget {
  const _DieticianSection({required this.summary, required this.patientId});

  final PatientSummary summary;
  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final care = summary.nutritionCare ?? _fromOlderServer(summary);
    final view = _CareView.of(care);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Dietician',
                style: T.bodyStrong.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            if (care.mayChange && view.action != null)
              TextButton(
                onPressed: () => _DieticianChoice.show(context, ref, patientId, care),
                child: Text(view.action!),
              ),
          ],
        ),
        InnerTile(
          tone: view.needsDoctor ? T.warningTint : null,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.restaurant_menu_rounded,
                color: view.needsDoctor ? T.warning : T.primary,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(view.title, style: T.bodyStrong),
                    if (view.flag != null)
                      Text(view.flag!, style: T.label.copyWith(color: T.warning)),
                    Text(view.detail, style: T.small.copyWith(color: T.inkMuted)),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (care.history.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => _showHistory(context, care.history),
              child: Text(
                care.history.length == 1
                    ? 'Earlier: 1 change'
                    : 'Earlier: ${care.history.length} changes',
              ),
            ),
          ),
      ],
    );
  }

  /// What a server from before per-practice assignment says, in the new shape:
  /// a name or nothing, and no way to tell a decision from a default.
  static NutritionCare _fromOlderServer(PatientSummary s) {
    final id = s.assignedDieticianId;
    return NutritionCare(
      dietician: id == null || id.isEmpty
          ? null
          : CareDietician(id: id, name: s.assignedDieticianName),
      decided: id != null && id.isNotEmpty,
    );
  }

  static Future<void> _showHistory(BuildContext context, List<CarePeriod> history) {
    final day = DateFormat('d MMM y');
    String when(CarePeriod p) {
      final from = p.since == null ? null : day.format(p.since!.toLocal());
      final to = p.until == null ? null : day.format(p.until!.toLocal());
      if (from != null && to != null) return '$from – $to';
      if (to != null) return 'Until $to';
      return 'Dates not recorded';
    }

    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.5,
        maxChildSize: 0.9,
        builder: (ctx, controller) => ListView.separated(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s6),
          itemCount: history.length + 1,
          separatorBuilder: (_, _) => const SizedBox(height: T.s2),
          itemBuilder: (ctx, i) {
            if (i == 0) return const Text('Who looked after nutrition before', style: T.title);
            final p = history[i - 1];
            return InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(p.dieticianName ?? 'No dietician', style: T.bodyStrong),
                  Text(when(p), style: T.small.copyWith(color: T.inkMuted)),
                  if (p.endedBy != null)
                    Text('Changed by ${p.endedBy}', style: T.small.copyWith(color: T.inkMuted)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// The words for one state of [NutritionCare]. Kept apart from the widget so
/// each sentence can be read — and tested — without laying anything out.
class _CareView {
  const _CareView({
    required this.title,
    required this.detail,
    this.flag,
    this.action,
    this.needsDoctor = false,
  });

  final String title;
  final String detail;

  /// A short status in words, shown beside the amber, for a state that needs
  /// the doctor. Colour is never the only thing that says so.
  final String? flag;

  /// The button's label, or null when there is nothing to choose between.
  final String? action;
  final bool needsDoctor;

  factory _CareView.of(NutritionCare care) {
    final d = care.dietician;
    final choices = care.activeDieticians;

    if (d != null && !d.active) {
      return _CareView(
        title: d.name ?? 'A former dietician',
        flag: 'No longer works here',
        detail: choices > 0
            ? 'Nobody else was given this patient. Choose who takes over.'
            : 'Nobody else was given this patient, and nobody here provides nutrition care now.',
        action: choices > 0 ? 'Choose' : null,
        needsDoctor: true,
      );
    }

    if (d != null) {
      return _CareView(
        title: d.name ?? 'Assigned',
        detail: switch (care.source) {
          'auto' => 'Assigned automatically — the practice’s only dietician when this patient joined.',
          'migration' => 'Carried over from the patient’s earlier record.',
          _ => care.decidedBy != null ? 'Chosen by ${care.decidedBy}.' : 'Chosen by a doctor.',
        },
        action: 'Change',
      );
    }

    if (care.decided) {
      return _CareView(
        title: 'No dietician',
        detail: care.decidedBy != null
            ? 'Left without one by ${care.decidedBy}.'
            : 'Left without one by a doctor.',
        action: choices > 0 ? 'Assign' : null,
      );
    }

    if (choices == 0) {
      return const _CareView(
        title: 'No dietician',
        detail: 'Nobody at this practice provides nutrition care yet.',
      );
    }

    return _CareView(
      title: 'Not assigned',
      flag: 'Needs a choice',
      detail: choices == 1
          ? 'Choose whether the practice’s dietician looks after this patient.'
          : 'This practice has $choices dieticians. Choose who looks after this patient.',
      action: 'Assign',
      needsDoctor: true,
    );
  }
}

/// The doctor choosing: one of this practice's dieticians, or nobody.
class _DieticianChoice extends StatefulWidget {
  const _DieticianChoice({
    required this.repository,
    required this.patientId,
    required this.care,
    required this.options,
  });

  final ClinicianRepository repository;
  final String patientId;
  final NutritionCare care;
  final List<({String id, String name})> options;

  static Future<void> show(
    BuildContext context,
    WidgetRef ref,
    String patientId,
    NutritionCare care,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final repository = ref.read(clinicianRepositoryProvider);

    List<({String id, String name})> options;
    try {
      options = await repository.dieticians();
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not load dieticians')));
      return;
    }
    if (!context.mounted) return;

    final outcome = await showModalBottomSheet<_ChoiceOutcome>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _DieticianChoice(
        repository: repository,
        patientId: patientId,
        care: care,
        options: options,
      ),
    );
    if (outcome == null) return;

    // Either way the record on screen is out of date: reload it.
    ref.invalidate(patientSummaryProvider(patientId));
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          outcome == _ChoiceOutcome.saved
              ? 'Nutrition care updated'
              : 'Somebody changed this patient’s dietician a moment ago. Nothing was saved — here is who holds them now.',
        ),
      ),
    );
  }

  @override
  State<_DieticianChoice> createState() => _DieticianChoiceState();
}

enum _ChoiceOutcome { saved, changedByColleague }

class _DieticianChoiceState extends State<_DieticianChoice> {
  /// Who holds the patient now — an active dietician, or nobody. A dietician
  /// who has left is not an option to keep, so the radio starts on nobody.
  late String? _selected = widget.care.dietician?.active == true ? widget.care.dietician!.id : null;

  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.repository.assignDietician(
        widget.patientId,
        dieticianId: _selected,
        // What this screen showed, so a colleague's change made meanwhile is
        // seen rather than silently replaced.
        expectedDieticianId: widget.care.dietician?.id,
      );
      if (mounted) Navigator.pop(context, _ChoiceOutcome.saved);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'DIETICIAN_CHANGED') {
        Navigator.pop(context, _ChoiceOutcome.changedByColleague);
        return;
      }
      setState(() => _error = e.statusCode != null ? e.message : 'Could not save. Check the connection and try again.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not save. Check the connection and try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final unchanged = _selected == (widget.care.dietician?.active == true ? widget.care.dietician!.id : null) &&
        widget.care.decided &&
        widget.care.dietician?.active != false;

    // Scrollable, because this list grows with the practice. A fixed column
    // with three dieticians ran past the bottom of the sheet and took the save
    // button with it.
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          T.s4,
          0,
          T.s4,
          MediaQuery.of(context).viewInsets.bottom + T.s6,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Nutrition care', style: T.title),
            const SizedBox(height: T.s1),
            Text(
              'The dietician you choose sees this patient’s nutrition record and '
              'their messages. Nobody else at the practice does.',
              style: T.small.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s3),
            // One RadioGroup owns the selection, so each tile only declares its
            // value. The per-tile groupValue/onChanged pair is deprecated, and
            // it was also the shape that let two tiles disagree about what was
            // selected.
            RadioGroup<String?>(
              groupValue: _selected,
              onChanged: (v) => setState(() => _selected = v),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final d in widget.options)
                    RadioListTile<String?>(
                      contentPadding: EdgeInsets.zero,
                      value: d.id,
                      title: Text(d.name, style: T.body),
                    ),
                  const RadioListTile<String?>(
                    contentPadding: EdgeInsets.zero,
                    value: null,
                    title: Text('No dietician', style: T.body),
                    subtitle: Text('Nobody here looks after this patient’s nutrition'),
                  ),
                ],
              ),
            ),
            if (widget.options.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: T.s1),
                child: Text(
                  'Nobody at this practice is a dietician yet. Add one in More → People.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ),
            if (_error != null) ...[
              const SizedBox(height: T.s2),
              Text(_error!, style: T.small.copyWith(color: T.danger)),
            ],
            const SizedBox(height: T.s6),
            // Full width and on its own line: a Row of two buttons is wider than
            // a phone, and an overflowing Row drops its last child without a
            // word.
            FilledButton(
              onPressed: _saving || unchanged ? null : _save,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              child: Text(_saving ? 'Saving…' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}

class _LabReportRow extends ConsumerStatefulWidget {
  const _LabReportRow({required this.report});

  final LabReport report;

  @override
  ConsumerState<_LabReportRow> createState() => _LabReportRowState();
}

class _LabReportRowState extends ConsumerState<_LabReportRow> {
  bool _busy = false;

  LabReport get report => widget.report;

  IconData _fileIcon() {
    final m = report.mimeType ?? '';
    if (m == 'application/pdf') return Icons.picture_as_pdf_rounded;
    if (m.startsWith('image/')) return Icons.image_rounded;
    return Icons.description_rounded;
  }

  /// A photo opens full-screen; a PDF/document is downloaded (with the auth
  /// header — an in-browser open would 403) and handed to the phone's viewer.
  Future<void> _open() async {
    if (!report.hasFile || report.photoUrl == null) return;
    if (report.isImage) {
      FullscreenPhoto.show(context, report.photoUrl);
      return;
    }
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final dir = await getTemporaryDirectory();
      final ext = report.mimeType == 'application/pdf' ? 'pdf' : 'bin';
      final cached = File('${dir.path}/lab_${report.photoUrl.hashCode}.$ext');
      if (!await cached.exists() || await cached.length() == 0) {
        final bytes = await ref
            .read(apiClientProvider)
            .getBytes('${AppConfig.apiOrigin}${report.photoUrl}');
        if (bytes.isEmpty) throw Exception('empty report download');
        await cached.writeAsBytes(bytes, flush: true);
      }
      final res = await OpenFilex.open(cached.path);
      if (res.type != ResultType.done && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No app on this phone can open that report'),
          ),
        );
      }
    } catch (_) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the report')),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final showThumb = report.hasFile && report.isImage;
    // The out-of-range markers, for the red summary line.
    final abnormal = report.analytes.where((a) => a.abnormal).toList();

    final tile = Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child:
                showThumb
                    ? AuthedImage(
                      path: report.photoUrl!,
                      width: 52,
                      height: 52,
                      radius: 10,
                    )
                    : Container(
                      width: 52,
                      height: 52,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child:
                          _busy
                              ? const SizedBox(
                                width: 20,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.4,
                                ),
                              )
                              : Icon(
                                _fileIcon(),
                                color: scheme.onSurfaceVariant,
                                size: 24,
                              ),
                    ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        report.testName,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (report.createdAt != null)
                      Text(
                        DateFormat('d MMM').format(report.createdAt!),
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
                if (report.note.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(report.note, style: const TextStyle(fontSize: 14)),
                ],
                if (report.hasFile) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        showThumb
                            ? Icons.visibility_outlined
                            : Icons.open_in_new_rounded,
                        size: 13,
                        color: AppColors.accentOn(context),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        showThumb
                            ? 'Tap to view'
                            : (report.mimeType == 'application/pdf'
                                ? 'Tap to open PDF'
                                : 'Tap to open'),
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.accentOn(context),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
                // Red at-a-glance summary of what's out of range.
                if (abnormal.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.warning_amber_rounded,
                        size: 14,
                        color: AppColors.dangerOn(context),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Out of range: ${abnormal.map((a) => '${a.label} ${a.flag == 'low' ? '↓' : '↑'}').join(', ')}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.dangerOn(context),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                // The structured values transcribed off the report, each with
                // its reference range and a low/high flag.
                if (report.analytes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    children: [
                      for (final a in report.analytes) _AnalyteChip(analyte: a),
                    ],
                  ),
                ] else if (report.analysisStatus == 'failed' ||
                    report.analysisStatus == 'unsupported') ...[
                  const SizedBox(height: 4),
                  Text(
                    'Could not read automatically — needs a look',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.warningOn(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );

    // The whole tile is tappable when there's a file — image → full-screen,
    // PDF/doc → download and open in the phone's viewer.
    if (!report.hasFile) return tile;
    return InkWell(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      onTap: _open,
      child: tile,
    );
  }
}

/// One transcribed value: "HbA1c 9.9 %" with a coloured border + arrow when it
/// is out of its reference range.
class _AnalyteChip extends StatelessWidget {
  const _AnalyteChip({required this.analyte});

  final Analyte analyte;

  static String _fmt(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final abnormal = analyte.abnormal;
    final color = switch (analyte.flag) {
      'high' || 'critical' => AppColors.dangerOn(context),
      'low' => AppColors.warningOn(context),
      _ => AppColors.successOn(context),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color:
            abnormal
                ? color.withValues(alpha: 0.12)
                : scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color:
              abnormal
                  ? color.withValues(alpha: 0.4)
                  : scheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${analyte.label} ',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          Text(
            _fmt(analyte.value),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: abnormal ? color : scheme.onSurface,
            ),
          ),
          if (analyte.unit != null && analyte.unit!.isNotEmpty)
            Text(
              ' ${analyte.unit}',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          if (abnormal) ...[
            const SizedBox(width: 4),
            Icon(
              analyte.flag == 'low'
                  ? Icons.arrow_downward_rounded
                  : Icons.arrow_upward_rounded,
              size: 12,
              color: color,
            ),
          ],
        ],
      ),
    );
  }
}

/// Per-analyte trends across the patient's uploaded reports — for any marker
/// that appears on two or more reports, its history sparkline + latest value.
class _AnalyteTrends extends StatelessWidget {
  const _AnalyteTrends({required this.reports});

  final List<LabReport> reports;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sorted = [...reports]..sort(
      (a, b) =>
          (a.createdAt ?? DateTime(0)).compareTo(b.createdAt ?? DateTime(0)),
    );
    final series = <String, List<Analyte>>{};
    final labels = <String, String>{};
    for (final r in sorted) {
      for (final a in r.analytes) {
        (series[a.code] ??= []).add(a);
        labels[a.code] = a.label;
      }
    }
    final trended = series.entries.where((e) => e.value.length >= 2).toList();
    if (trended.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.md),
        Text(
          'LAB TRENDS',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
            color: scheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 4,
          ),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.6),
            ),
          ),
          child: Column(
            children: [
              for (var i = 0; i < trended.length; i++) ...[
                if (i > 0)
                  Divider(
                    height: 1,
                    color: scheme.outlineVariant.withValues(alpha: 0.4),
                  ),
                _AnalyteTrendRow(
                  label: labels[trended[i].key]!,
                  readings: trended[i].value,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _AnalyteTrendRow extends StatelessWidget {
  const _AnalyteTrendRow({required this.label, required this.readings});

  final String label;
  final List<Analyte> readings;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final latest = readings.last;
    final abnormal = latest.abnormal;
    final color = switch (latest.flag) {
      'high' || 'critical' => AppColors.dangerOn(context),
      'low' => AppColors.warningOn(context),
      _ => AppColors.successOn(context),
    };
    String fmt(num v) =>
        v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (latest.rangeText.isNotEmpty)
                  // The reference range is what makes the number beside it
                  // mean anything, so it stops being the faintest text on the
                  // row. Lower-case "target" at the theme's muted grey read as
                  // a caption on a screen full of captions.
                  Text(
                    'Target ${latest.rangeText}${latest.unit != null ? ' ${latest.unit}' : ''}',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface.withValues(alpha: 0.72),
                    ),
                  ),
              ],
            ),
          ),
          Sparkline(
            values: [for (final a in readings) a.value.toDouble()],
            color: AppColors.accentOn(context),
            width: 64,
            height: 24,
            showBand: false,
          ),
          const SizedBox(width: 8),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: fmt(latest.value)),
                if (latest.unit != null)
                  TextSpan(
                    text: ' ${latest.unit}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              // A bare 126 beside "Target 70–100 mg/dL" is a number the reader
              // has to assume shares the range's unit.
              color: abnormal ? color : scheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}

class _AlertMini extends StatelessWidget {
  const _AlertMini({
    required this.title,
    required this.severity,
    required this.status,
    this.when,
  });
  final String title;
  final String severity;
  final String status;
  final DateTime? when;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // The same rule as the alerts screen: severity says how bad it was, status
    // says whether it still needs anyone. A closed emergency in emergency red
    // spends the loudest colour in the app on something already dealt with.
    final settled = status == 'resolved' || status == 'dismissed';
    final color = settled ? scheme.outline : alertSeverityColor(severity);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border(left: BorderSide(color: color, width: 4)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (when != null)
                  Text(
                    DateFormat('d MMM, h:mm a').format(when!),
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          MiniPill(
            label:
                status == 'open'
                    ? severity.toUpperCase()
                    : status.toUpperCase(),
            color: status == 'open' ? color : const Color(0xFF6B7280),
          ),
        ],
      ),
    );
  }
}

/// The AI assistant's view of this patient — collapsible, like the previous
/// consultations, so it stays out of the way until the doctor wants to see why
/// the assistant answered the way it did.
class _AiContextCard extends StatelessWidget {
  const _AiContextCard({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: DisclosureTile(
          tilePadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 0,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          crossAxisAlignment: CrossAxisAlignment.start,
          leading: Icon(
            Icons.smart_toy_outlined,
            size: 20,
            color: scheme.onSurfaceVariant,
          ),
          title: const Text(
            'Assistant context',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            'What the AI assistant sees',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          children: [
            Text(
              text,
              style: TextStyle(
                fontSize: 14,
                height: 1.5,
                color: scheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
  );
}
