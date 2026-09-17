import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../domain/appointment.dart';

Color appointmentStatusColor(String status) {
  switch (status) {
    case 'requested':
      return AppColors.warning;
    case 'confirmed':
    case 'checked_in':
      return AppColors.primary;
    case 'in_consultation':
      return AppColors.success;
    case 'completed':
      return AppColors.success;
    case 'no_show':
      return AppColors.danger;
    case 'cancelled':
    default:
      return const Color(0xFF6B7280);
  }
}

String appointmentStatusLabel(AppLocalizations l, String s) => switch (s) {
  'requested' => l.apptStatusRequested,
  'confirmed' => l.apptStatusConfirmed,
  'checked_in' => l.apptStatusCheckedIn,
  'in_consultation' => l.apptStatusInConsultation,
  'completed' => l.apptStatusCompleted,
  'cancelled' => l.apptStatusCancelled,
  'no_show' => l.apptStatusNoShow,
  _ => s,
};

String appointmentModeLabel(AppLocalizations l, String mode) =>
    mode == 'teleconsult' ? l.apptModeTeleconsult : l.apptModeInClinic;

/// A small coloured status chip.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final color = appointmentStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        appointmentStatusLabel(l10n, status),
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}

/// One appointment rendered as a card. [clinicianView] shows the patient's
/// details (for the clinic diary); otherwise it shows the clinic location (for
/// the patient's own list).
class AppointmentCard extends StatelessWidget {
  const AppointmentCard({
    super.key,
    required this.appointment,
    this.clinicianView = false,
    this.onTap,
    this.trailing,
    this.actions,
  });

  final Appointment appointment;
  final bool clinicianView;
  final VoidCallback? onTap;
  final Widget? trailing;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final a = appointment;
    final color = appointmentStatusColor(a.status);
    final dimmed = a.isCancelled;

    final title =
        clinicianView
            ? (a.patientName ?? l10n.profilePatient)
            : (a.clinicName ?? l10n.apptModeInClinic);
    final subtitle =
        clinicianView
            ? (a.patientPhone ?? '')
            : [
              if (a.clinicAddress != null) a.clinicAddress!,
              if (a.clinicCity != null) a.clinicCity!,
            ].join(' · ');

    return Opacity(
      opacity: dimmed ? 0.6 : 1,
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color: scheme.outlineVariant.withValues(alpha: 0.6),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Time block.
                    Container(
                      width: 58,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        children: [
                          // A request has no hour yet. Showing one would tell
                          // the patient to arrive at a time nobody has agreed.
                          Text(
                            a.scheduledFor == null
                                ? '--'
                                : DateFormat('h:mm').format(a.scheduledFor!),
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: color,
                            ),
                          ),
                          Text(
                            a.scheduledFor == null
                                ? 'asked'
                                : DateFormat('a').format(a.scheduledFor!),
                            style: TextStyle(
                              fontSize: 12,
                              color: color,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (subtitle.isNotEmpty) ...[
                            const SizedBox(height: 0),
                            Text(
                              subtitle,
                              style: TextStyle(
                                fontSize: 14,
                                color: scheme.onSurfaceVariant,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                          const SizedBox(height: 4),
                          // Wraps rather than running off the card. A Row with
                          // nothing flexible in it overflowed at 360 points once
                          // a request's "· requested" was added, cutting the
                          // day a patient had asked for.
                          Wrap(
                            spacing: T.s2,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    a.isTeleconsult
                                        ? Icons.videocam_outlined
                                        : Icons.location_on_outlined,
                                    size: 14,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                  const SizedBox(width: T.s1),
                                  Text(
                                    appointmentModeLabel(l10n, a.mode),
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                              Text(
                                a.displayDate == null
                                    ? 'Waiting for the clinic'
                                    : '${DateFormat('EEE, d MMM').format(a.displayDate!)}'
                                        '${a.isRequest ? ' · requested' : ''}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        StatusPill(status: a.status),
                        if (trailing != null) ...[
                          const SizedBox(height: 4),
                          trailing!,
                        ],
                      ],
                    ),
                  ],
                ),
                if (a.reason != null && a.reason!.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    a.reason!,
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurface,
                      height: 1.3,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (actions != null && actions!.isNotEmpty) ...[
                  const Divider(height: AppSpacing.lg),
                  // A Wrap, not a Row. "Reschedule" and "Cancel appointment"
                  // side by side are wider than the card on a small phone, and
                  // an overflowing Row does not draw its last child — the
                  // button a patient needs to call a visit off.
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: T.s2,
                    children: actions!,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
