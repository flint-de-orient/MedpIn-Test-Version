import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../domain/medication.dart';

class MedicationSlotTile extends StatelessWidget {
  const MedicationSlotTile({
    super.key,
    required this.slot,
    required this.onTap,
  });

  final MedicationScheduleSlot slot;
  final VoidCallback onTap;

  Color _statusColor(String status) {
    switch (status) {
      case 'taken':
        return AppColors.success;
      case 'skipped':
      case 'missed':
        return AppColors.danger;
      default:
        return AppColors.warning;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'taken':
        return Icons.check_circle_rounded;
      case 'skipped':
        return Icons.remove_circle_rounded;
      case 'missed':
        return Icons.cancel_rounded;
      default:
        return Icons.radio_button_unchecked_rounded;
    }
  }

  String _relationLabel(AppLocalizations l10n, String relation) {
    switch (relation) {
      case 'before_meal':
        return l10n.medsRelationBeforeMeal;
      case 'after_meal':
        return l10n.medsRelationAfterMeal;
      case 'with_meal':
        return l10n.medsRelationWithMeal;
      default:
        return l10n.medsRelationAnytime;
    }
  }

  String _statusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'taken':
        return l10n.medsStatusTaken;
      case 'skipped':
        return l10n.medsStatusSkipped;
      case 'missed':
        return l10n.medsStatusMissed;
      default:
        return l10n.medsStatusPending;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final color = _statusColor(slot.status);
    final isPending = slot.status == 'pending';

    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        onTap: isPending ? onTap : null,
        child: Container(
          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
          padding: const EdgeInsets.all(AppSpacing.md),
          constraints: const BoxConstraints(
            minHeight: AppSpacing.minTapTarget + 16,
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.accentOn(context).withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  slot.time,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      slot.name,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 0),
                    Text(
                      '${slot.dose} · ${_relationLabel(l10n, slot.relationToMeal)}',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              Column(
                children: [
                  Icon(_statusIcon(slot.status), color: color, size: 26),
                  const SizedBox(height: 0),
                  Text(
                    _statusLabel(l10n, slot.status),
                    style: TextStyle(
                      color: color,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
