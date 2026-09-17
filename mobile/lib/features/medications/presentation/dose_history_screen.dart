import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/medications_repository.dart';
import '../domain/medication.dart';
import 'medications_providers.dart';
import '../domain/strength.dart';

/// The patient's medicine-taking history: every past scheduled dose over the
/// chosen window, marked taken / skipped / missed, grouped by day, so they can
/// see exactly what they took and when.
class DoseHistoryScreen extends ConsumerStatefulWidget {
  const DoseHistoryScreen({super.key});

  @override
  ConsumerState<DoseHistoryScreen> createState() => _DoseHistoryScreenState();
}

class _DoseHistoryScreenState extends ConsumerState<DoseHistoryScreen> {
  static const _periods = [
    (label: '7 days', days: 7),
    (label: '2 weeks', days: 14),
    (label: '30 days', days: 30),
  ];
  int _days = 14;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(doseHistoryProvider(_days));

    return Scaffold(
      appBar: AppBar(title: const Text('Dose history')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              0,
            ),
            child: Row(
              children: [
                for (final p in _periods) ...[
                  _PeriodChip(
                    label: p.label,
                    selected: _days == p.days,
                    onTap: () => setState(() => _days = p.days),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(doseHistoryProvider(_days)),
              child: async.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error:
                    (e, _) => ListView(
                      children: [
                        const SizedBox(height: 120),
                        Center(
                          child: Text(
                            'Could not load your history',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                data: (doses) {
                  if (doses.isEmpty) {
                    return ListView(
                      children: [
                        const SizedBox(height: 120),
                        Icon(
                          Icons.medication_outlined,
                          size: 52,
                          color: scheme.outlineVariant,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Center(
                          child: Text(
                            'No doses in this period',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    );
                  }
                  return _HistoryList(days: _days, doses: doses);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.doses, required this.days});
  final List<DoseHistoryEntry> doses;

  /// Passed down so a recovered dose refreshes the window it was shown in.
  final int days;

  static String _dayLabel(DateTime at) {
    final now = DateTime.now();
    final d = DateTime(at.year, at.month, at.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(d).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    return DateFormat('EEEE, d MMM').format(at);
  }

  @override
  Widget build(BuildContext context) {
    // Group by calendar day (the backend already sorts newest-first).
    final byDay = <String, List<DoseHistoryEntry>>{};
    final order = <String>[];
    for (final dose in doses) {
      final at = dose.scheduledFor ?? DateTime.now();
      final key = DateFormat('yyyy-MM-dd').format(at);
      if (!byDay.containsKey(key)) {
        byDay[key] = [];
        order.add(key);
      }
      byDay[key]!.add(dose);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.xl,
      ),
      children: [
        for (final key in order) ...[
          Builder(
            builder: (context) {
              final scheme = Theme.of(context).colorScheme;
              final list = byDay[key]!;
              final at = list.first.scheduledFor ?? DateTime.now();
              final taken = list.where((d) => d.status == 'taken').length;
              return Padding(
                padding: const EdgeInsets.only(
                  top: AppSpacing.md,
                  bottom: AppSpacing.sm,
                ),
                child: Row(
                  children: [
                    Text(
                      _dayLabel(at),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '$taken/${list.length} taken',
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          for (final dose in byDay[key]!) _DoseRow(dose: dose, days: days),
        ],
      ],
    );
  }
}

class _DoseRow extends ConsumerStatefulWidget {
  const _DoseRow({required this.dose, required this.days});

  final DoseHistoryEntry dose;

  /// The window currently on screen, so the right family member is refreshed
  /// after a dose is recovered.
  final int days;

  @override
  ConsumerState<_DoseRow> createState() => _DoseRowState();
}

class _DoseRowState extends ConsumerState<_DoseRow> {
  bool _saving = false;

  DoseHistoryEntry get dose => widget.dose;

  /// Records a missed dose as taken, late.
  ///
  /// A missed dose used to be a red word and nothing else — the screen told a
  /// patient they had failed and offered no way to put it right, which is both
  /// discouraging and inaccurate: people do take a tablet an hour late and
  /// then have no way to say so. The adherence figure the doctor reads is
  /// built from these records, so leaving no route to correct one makes that
  /// figure wrong as well as the screen unkind.
  ///
  /// It writes against the dose's own `scheduledFor`, so the record stays
  /// attached to the slot it belongs to rather than to now.
  Future<void> _markTaken() async {
    final at = dose.scheduledFor;
    if (at == null || _saving) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(medicationsRepositoryProvider)
          .logDose(
            medicationId: dose.medicationId,
            scheduledFor: at,
            status: 'taken',
          );
      if (!mounted) return;
      ref.invalidate(doseHistoryProvider(widget.days));
      // Today's schedule and the reminders built from it both read this, so a
      // dose recovered here stops the slot nagging on the Medicines tab.
      ref.invalidate(todayScheduleProvider);
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update this dose')),
      );
    }
  }

  ({Color color, IconData icon, String label}) get _status => switch (dose
      .status) {
    'taken' => (
      color: AppColors.success,
      icon: Icons.check_circle_rounded,
      // More than two hours after it was due.
      label: dose.late ? 'Taken late' : 'Taken',
    ),
    'skipped' => (
      color: AppColors.warning,
      icon: Icons.remove_circle_rounded,
      label: 'Skipped',
    ),
    _ => (color: AppColors.danger, icon: Icons.cancel_rounded, label: 'Missed'),
  };

  @override
  Widget build(BuildContext context) {
    final s = _status;
    final time =
        dose.scheduledFor != null
            ? DateFormat('h:mm a').format(dose.scheduledFor!)
            : dose.time;
    final sub = [
      if (dose.strength != null && dose.strength!.isNotEmpty)
        formatStrength(dose.strength),
      time,
      if (dose.status == 'taken' && dose.takenAt != null)
        'took ${DateFormat('h:mm a').format(dose.takenAt!)}',
    ].whereType<String>().join('  ·  ');

    // Only a missed dose can be recovered, and only one with a slot to attach
    // the record to. A skipped dose was a decision, not an oversight.
    final recoverable = dose.status == 'missed' && dose.scheduledFor != null;

    return Padding(
      padding: const EdgeInsets.only(bottom: T.s3),
      child: SectionCard(
        padding: const EdgeInsets.all(T.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(s.icon, color: s.color, size: 22),
                const SizedBox(width: T.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        dose.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: T.small.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        sub,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: T.label.copyWith(
                          fontWeight: FontWeight.w500,
                          letterSpacing: 0,
                          color: T.inkMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: T.s2),
                StatusPill(
                  label: s.label,
                  status: switch (dose.status) {
                    'taken' => Status.ok,
                    'skipped' => Status.watch,
                    _ => Status.alert,
                  },
                ),
              ],
            ),
            if (recoverable) ...[
              const SizedBox(height: T.s3),
              SizedBox(
                height: 40,
                child: OutlinedButton.icon(
                  onPressed: _saving ? null : _markTaken,
                  icon:
                      _saving
                          ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                          : const Icon(Icons.check_rounded, size: 18),
                  label: Text(_saving ? 'Saving…' : 'I took this one'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: T.primary,
                    side: const BorderSide(color: T.line),
                    textStyle: T.small.copyWith(fontWeight: FontWeight.w700),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(T.rControl),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
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
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
