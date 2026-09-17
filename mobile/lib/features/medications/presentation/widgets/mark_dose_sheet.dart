import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';

class MarkDoseResult {
  const MarkDoseResult({required this.status, this.skipReason});
  final String status; // taken | skipped
  final String? skipReason;
}

Future<MarkDoseResult?> showMarkDoseSheet(
  BuildContext context,
  String medicationName,
) {
  return showModalBottomSheet<MarkDoseResult>(
    context: context,
    showDragHandle: true,
    builder: (context) => _MarkDoseSheet(medicationName: medicationName),
  );
}

class _MarkDoseSheet extends StatelessWidget {
  const _MarkDoseSheet({required this.medicationName});

  final String medicationName;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The medicine, with the pill mark beside it. The sheet used to open
          // with a bare line of text and two buttons; on a phone held at arm's
          // length that is easy to answer for the wrong medicine.
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.accentSoftOn(context),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.medication_rounded,
                  size: 22,
                  color: AppColors.accentOn(context),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      medicationName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 0),
                    Text(
                      'Did you take this dose?',
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),

          // Taken is the answer nearly every time, so it is the filled button
          // and it comes first. Skipped is deliberately quieter — not hidden,
          // because an honest "no" is what makes the adherence figure worth
          // showing the doctor, but not weighted the same as the common case.
          SizedBox(
            height: 54,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed:
                  () => Navigator.of(
                    context,
                  ).pop(const MarkDoseResult(status: 'taken')),
              icon: const Icon(Icons.check_circle_rounded, size: 22),
              label: Text(
                l10n.medsMarkTaken,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            height: 54,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.dangerOn(context),
                side: BorderSide(
                  color: AppColors.dangerOn(context).withValues(alpha: 0.4),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed: () async {
                final reason = await _pickSkipReason(context);
                if (context.mounted) {
                  Navigator.of(
                    context,
                  ).pop(MarkDoseResult(status: 'skipped', skipReason: reason));
                }
              },
              icon: const Icon(Icons.cancel_outlined, size: 21),
              label: Text(
                l10n.medsMarkSkipped,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Icon(
                Icons.lock_outline_rounded,
                size: 14,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  // Said plainly, because a patient who thinks a skip gets them
                  // told off simply taps "taken" — and then the adherence
                  // figure the doctor prescribes against is fiction.
                  'Your answer helps your doctor. Skipping a dose is not a problem to hide.',
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.35,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

Future<String?> _pickSkipReason(BuildContext context) async {
  final l10n = AppLocalizations.of(context);
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder:
        (ctx) => AlertDialog(
          title: Text(l10n.medsSkipReasonTitle),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 2,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, ''),
              child: Text(l10n.commonCancel),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: Text(l10n.commonSave),
            ),
          ],
        ),
  );
}
