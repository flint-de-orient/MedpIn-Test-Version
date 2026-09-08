import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/providers/core_providers.dart';

/// How often a dietician should review each patient's food log.
///
/// ---- Why this is here rather than on a screen of its own ---------------
///
/// It used to sit at the top of a Dieticians screen, above a list of them. The
/// list moved to People, where every role now lives, and what was left was one
/// setting — and a whole screen for one row is the kind of navigation that
/// makes an app feel bigger than it is.
///
/// It is a practice-wide clinical policy, so it lives with the other practice
/// settings. One cadence covers everybody: a clinic has one or two dieticians
/// and hundreds of patients, and asking the doctor to set it per patient made
/// "nobody is watching this one" the default.

final _reviewIntervalProvider = FutureProvider.autoDispose<int>((ref) async {
  final data = await ref.read(apiClientProvider).getJson('/doctor/settings');
  return (data['dietReviewIntervalDays'] as num?)?.toInt() ?? 14;
});

/// The row, and the sheet behind it. Mounted by the Practice screen.
class FoodLogReviewTile extends ConsumerWidget {
  const FoodLogReviewTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final days = ref.watch(_reviewIntervalProvider).valueOrNull;

    return Row(
      children: [
        Expanded(
          child: Text(
            // Never a bare number: "14" is not a cadence, and somebody
            // scanning this needs the unit more than the digit.
            days == null
                ? 'Loading…'
                : days == 1
                    ? 'Every day, for every patient'
                    : days == 7
                        ? 'Every week, for every patient'
                        : days % 7 == 0
                            ? 'Every ${days ~/ 7} weeks, for every patient'
                            : 'Every $days days, for every patient',
            style: T.small.copyWith(color: T.inkMuted),
          ),
        ),
        if (days != null)
          TextButton(
            onPressed: () => _change(context, ref, days),
            child: const Text('Change'),
          ),
      ],
    );
  }
}

Future<void> _change(BuildContext context, WidgetRef ref, int current) async {
  final messenger = ScaffoldMessenger.of(context);

  final picked = await showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _IntervalSheet(current: current),
  );
  if (picked == null) return;

  try {
    await ref.read(apiClientProvider).patchJson(
          '/doctor/settings',
          body: {'dietReviewIntervalDays': picked},
        );
    ref.invalidate(_reviewIntervalProvider);
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

const _intervalOptions = <({int days, String label, String fits})>[
  (
    days: 1,
    label: 'Daily',
    fits: 'New diagnosis, insulin titration, pregnancy',
  ),
  (
    days: 3,
    label: 'Every 3 days',
    fits: 'Close watch while something is being changed',
  ),
  (days: 7, label: 'Weekly', fits: 'Active management'),
  (days: 14, label: 'Every 2 weeks', fits: 'Steady patients'),
  (days: 30, label: 'Monthly', fits: 'Stable, maintenance'),
];

String intervalLabel(int days) =>
    _intervalOptions
        .where((o) => o.days == days)
        .map((o) => o.label)
        .firstOrNull ??
    'Every $days days';

/// Picks the clinic-wide review cadence. Preset chips rather than a free number
/// field: the useful answers are a handful of rhythms, and a mistyped number
/// would drop the entire patient list into the dietician's queue at once.
class _IntervalSheet extends StatefulWidget {
  const _IntervalSheet({required this.current});

  final int current;

  @override
  State<_IntervalSheet> createState() => _IntervalSheetState();
}

class _IntervalSheetState extends State<_IntervalSheet> {
  late int _selected = widget.current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Food-log review',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'How often the dietician should review each patient’s food log. '
            'A patient becomes due once this many days have passed since the '
            'dietician last wrote to them.',
            style: TextStyle(
              fontSize: 14,
              height: 1.45,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final option in _intervalOptions)
            _IntervalRow(
              label: option.label,
              fits: option.fits,
              selected: _selected == option.days,
              onTap: () => setState(() => _selected = option.days),
            ),
          // A tight cadence is right for one patient and overwhelming as a
          // clinic default — every patient lands in the queue at once. Said
          // before they save, not discovered after.
          if (_selected <= 3) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.warningBgOn(context),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: Color(0xFFB45309),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      _selected == 1
                          ? 'Every patient will be due for review every day. Useful for a small '
                              'list; heavy going for a large one.'
                          : 'Every patient will be due every 3 days.',
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: Color(0xFFB45309),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            height: AppSpacing.minTapTarget + 6,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: () => Navigator.pop(context, _selected),
              child: const Text(
                'Save',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}

class _IntervalRow extends StatelessWidget {
  const _IntervalRow({
    required this.label,
    required this.fits,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String fits;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? AppColors.accentSoftOn(context) : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: 12,
          ),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 21,
                color: selected ? AppColors.primary : scheme.outline,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: selected ? AppColors.primary : scheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 0),
                    Text(
                      fits,
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

