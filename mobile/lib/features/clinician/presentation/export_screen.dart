import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/hero_band.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/clinician_models.dart';
import '../data/clinic_export.dart';
import '../data/clinician_repository.dart';

/// Export the clinic's records to a file the doctor keeps.
///
/// The whole point is that the doctor's data is theirs: a spreadsheet for an
/// audit, a JSON dump for whatever system the practice moves to next, a record
/// that survives this app. Everything here already exists behind the panel —
/// this only puts it in a file.
///
/// It never writes to a folder of its own. The file is built in the app's
/// temporary directory and handed straight to the OS share sheet, so the
/// doctor picks the destination each time and nothing lands somewhere another
/// app could read unasked. That matters more than usual here: the file has
/// named patients, phone numbers and clinical readings in it.
class ExportScreen extends ConsumerStatefulWidget {
  const ExportScreen({super.key});

  @override
  ConsumerState<ExportScreen> createState() => _ExportScreenState();
}

class _ExportScreenState extends ConsumerState<ExportScreen> {
  final Set<ExportDataset> _selected = {
    ExportDataset.patients,
    ExportDataset.summary,
  };
  ExportFormat _format = ExportFormat.csv;

  /// How far back the time-series data goes. Null means everything.
  ///
  /// Applies to alerts, which is the only dataset here with a time dimension —
  /// the patient list is the current roll, and trimming it by date would hand
  /// somebody a "patient export" quietly missing patients.
  int? _sinceDays = 90;
  bool _busy = false;

  static const _ranges = <(int?, String)>[
    (30, 'Last 30 days'),
    (90, 'Last 90 days'),
    (365, 'Last year'),
    (null, 'Everything'),
  ];

  Future<void> _export() async {
    if (_selected.isEmpty || _busy) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);

    try {
      final repo = ref.read(clinicianRepositoryProvider);

      // Fetched here rather than read from the dashboard's providers: those
      // hold one page for the screen, and an export that silently stopped at
      // the first fifty patients would be worse than no export.
      final patients =
          _selected.contains(ExportDataset.patients)
              ? await _allPatients(repo)
              : const <PatientListItem>[];
      final since =
          _sinceDays == null
              ? null
              : DateTime.now().subtract(Duration(days: _sinceDays!));
      final alerts =
          _selected.contains(ExportDataset.alerts)
              ? (await repo.alerts(status: 'open', limit: 200)).items
                  .where(
                    (a) =>
                        since == null ||
                        (a.createdAt ?? DateTime.now()).isAfter(since),
                  )
                  .toList()
              : const <ClinicalAlert>[];
      final overview =
          _selected.contains(ExportDataset.summary)
              ? await repo.overview()
              : null;
      final analytics =
          _selected.contains(ExportDataset.summary)
              ? await repo.analytics()
              : null;

      final export = ClinicExport(
        format: _format,
        datasets: _selected,
        patients: patients,
        alerts: alerts,
        overview: overview,
        analytics: analytics,
        generatedAt: DateTime.now(),
        clinicianName: ref.read(authControllerProvider).user?.name ?? '',
      );

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/${export.filename}');
      await file.writeAsString(export.build(), flush: true);

      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path, mimeType: _format.mime)],
          subject: 'MedPin export — ${export.filename}',
        ),
      );
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not build the export')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Walks every page. The list endpoint is paged and an export is the one
  /// place that genuinely wants all of it.
  Future<List<PatientListItem>> _allPatients(ClinicianRepository repo) async {
    final all = <PatientListItem>[];
    for (var page = 1; page <= 40; page++) {
      final res = await repo.patients(page: page, limit: 100);
      all.addAll(res.items);
      if (res.items.length < 100) break;
    }
    return all;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(title: const Text('Export data')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: AppSpacing.xl),
        children: [
          HeroBand(
            eyebrow: 'Your records, your copy',
            title: 'Export',
            // No giant figure. The band's job is to say what the screen is,
            // and this screen's subject is a choice rather than a quantity —
            // "CSV" set at 64px was a label pretending to be a statistic.
            child: Text(
              _selected.isEmpty
                  ? 'Choose what to include, then pick a format.'
                  : 'Ready to export ${_selected.length} '
                      '${_selected.length == 1 ? 'set' : 'sets'} '
                      'as ${_format.label}.',
              style: TextStyle(
                fontSize: 16,
                height: 1.4,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _Label('What to include'),
                const SizedBox(height: AppSpacing.sm),
                for (final d in ExportDataset.values) ...[
                  _DatasetTile(
                    dataset: d,
                    selected: _selected.contains(d),
                    onChanged:
                        (on) => setState(
                          () => on ? _selected.add(d) : _selected.remove(d),
                        ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],

                const SizedBox(height: AppSpacing.md),
                // Before Format, because it changes what is in the file
                // rather than how the file is written.
                const _Label('Alerts from'),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    for (final (days, label) in _ranges)
                      ChoiceChip(
                        label: Text(label),
                        selected: _sinceDays == days,
                        onSelected: (_) => setState(() => _sinceDays = days),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                const _Label('Format'),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    for (final f in ExportFormat.values) ...[
                      Expanded(
                        child: _FormatTile(
                          format: f,
                          selected: _format == f,
                          onTap: () => setState(() => _format = f),
                        ),
                      ),
                      if (f != ExportFormat.values.last)
                        const SizedBox(width: AppSpacing.sm),
                    ],
                  ],
                ),

                const SizedBox(height: AppSpacing.lg),
                // Said plainly and before the button, not buried after it.
                // The doctor is about to take identifiable clinical records
                // out of the app, and that should be a decision rather than a
                // side effect of tapping Export.
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.warningBgOn(context),
                    borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                    border: Border.all(
                      color: AppColors.warning.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.lock_outline_rounded,
                        size: 20,
                        color: AppColors.warningOn(context),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          'The file contains patient names, phone numbers and '
                          'clinical readings. Treat it as a clinical record: '
                          'it leaves the app when you choose where to send it.',
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: AppColors.warningOn(context),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                SizedBox(
                  height: 56,
                  child: FilledButton.icon(
                    onPressed: _selected.isEmpty || _busy ? null : _export,
                    icon:
                        _busy
                            ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(
                                  Colors.white,
                                ),
                              ),
                            )
                            : const Icon(Icons.ios_share_rounded),
                    label: Text(
                      _busy ? 'Building…' : 'Export ${_format.label}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
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

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.8,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    ),
  );
}

class _DatasetTile extends StatelessWidget {
  const _DatasetTile({
    required this.dataset,
    required this.selected,
    required this.onChanged,
  });

  final ExportDataset dataset;
  final bool selected;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      onTap: () => onChanged(!selected),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color:
              selected
                  ? AppColors.primary.withValues(alpha: 0.06)
                  : scheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color:
                selected
                    ? AppColors.primary.withValues(alpha: 0.45)
                    : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected ? Icons.check_circle_rounded : Icons.circle_outlined,
              size: 24,
              color: selected ? AppColors.primary : scheme.outline,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    dataset.label,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    dataset.detail,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.35,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FormatTile extends StatelessWidget {
  const _FormatTile({
    required this.format,
    required this.selected,
    required this.onTap,
  });

  final ExportFormat format;
  final bool selected;
  final VoidCallback onTap;

  static String _blurb(ExportFormat f) => switch (f) {
    ExportFormat.csv => 'Opens in Excel or Sheets',
    ExportFormat.json => 'For another system to read',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color:
              selected
                  ? AppColors.primary.withValues(alpha: 0.06)
                  : scheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color:
                selected
                    ? AppColors.primary.withValues(alpha: 0.45)
                    : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              format == ExportFormat.csv
                  ? Icons.table_chart_outlined
                  : Icons.data_object_rounded,
              size: 24,
              color: selected ? AppColors.primary : scheme.onSurfaceVariant,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              format.label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: selected ? AppColors.primary : scheme.onSurface,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              _blurb(format),
              style: TextStyle(
                fontSize: 12,
                height: 1.3,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
