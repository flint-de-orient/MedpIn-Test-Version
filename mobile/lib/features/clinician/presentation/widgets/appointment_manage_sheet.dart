import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/router/area.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../appointments/data/appointment_repository.dart';
import '../../../appointments/data/clinic_repository.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/domain/clinic.dart';
import '../../../staff/presentation/widgets/desk_geometry.dart';
import '../../../staff/presentation/widgets/request_card.dart';

/// What a front desk can actually do about a booked appointment.
///
/// This offered Check in, then Start consultation, then Mark complete — a
/// five-state machine the desk had to walk every patient through by hand. That
/// lifecycle belongs to the practice software the clinic already runs, and
/// duplicating it here was worse than not tracking it at all: three extra taps
/// per patient, and a desk that forgets one leaves the record wrong. Untracked
/// is honest. Mistracked is a summary card reporting confident wrong numbers.
///
/// What remains is what a receptionist is actually asked to do between a
/// booking being made and the patient arriving: ring them, write to them, move
/// them, or call it off. Each of those the app genuinely owns, because each
/// involves reaching the patient's phone — the one thing the practice software
/// cannot do.
///
/// The old sheet also offered "Confirm" on a request, which set the status
/// straight to confirmed with no clinic and no time. That skips slot validation
/// altogether and would fail the model's own conditional requirement on
/// scheduledFor. Confirming happens on the request card, against a slot the
/// published schedule actually offers.
class AppointmentManageSheet extends ConsumerWidget {
  const AppointmentManageSheet({
    super.key,
    required this.appointment,
    required this.onCancel,
    required this.onChanged,
  });

  final Appointment appointment;
  final Future<void> Function() onCancel;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();

    final when =
        a.scheduledFor == null
            ? null
            : DateFormat(
              'EEE, d MMM · h:mm a',
              locale,
            ).format(a.scheduledFor!.toLocal());

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          0,
          AppSpacing.md,
          AppSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UserAvatar(
                  name: a.patientName ?? '',
                  avatarUrl: a.patientAvatarUrl,
                  accent: AppColors.primary,
                  size: 44,
                ),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        a.patientName ?? 'Patient',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (when != null)
                        Text(
                          when,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                        ),
                      if (a.clinicName != null)
                        Text(
                          a.clinicName!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12.5,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),

            if ((a.reason ?? '').isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm + 2),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.sm + 2),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(kInnerRadius),
                ),
                child: Text(
                  a.reason!,
                  style: const TextStyle(fontSize: 13.5, height: 1.35),
                ),
              ),
            ],

            const SizedBox(height: AppSpacing.sm),
            Divider(color: scheme.outlineVariant.withValues(alpha: 0.6)),

            if (a.patientPhone != null)
              _SheetAction(
                icon: Icons.call_rounded,
                label: 'Call ${a.patientPhone}',
                tone: AppColors.primary,
                onTap:
                    () => launchUrl(Uri(scheme: 'tel', path: a.patientPhone)),
              ),

            if ((a.patientId ?? '').isNotEmpty)
              _SheetAction(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Message patient',
                tone: AppColors.primary,
                onTap: () {
                  Navigator.pop(context);
                  context.push(
                    '${areaPrefix(ref)}/patients/${a.patientId}/thread',
                    extra: a.patientName,
                  );
                },
              ),

            if (a.isActive && a.scheduledFor != null)
              _SheetAction(
                icon: Icons.event_repeat_rounded,
                label: 'Move to another time',
                tone: AppColors.warningOn(context),
                onTap: () async {
                  Navigator.pop(context);
                  await rescheduleAppointment(context, ref, a, onChanged);
                },
              ),

            if (a.isActive)
              _SheetAction(
                icon: Icons.cancel_outlined,
                label: 'Cancel appointment',
                tone: AppColors.dangerOn(context),
                onTap: () async {
                  Navigator.pop(context);
                  await onCancel();
                },
              ),
          ],
        ),
      ),
    );
  }
}

/// Move a booking, against a slot the schedule actually offers.
///
/// The same picker the desk uses to answer a request, so a reschedule cannot
/// land on an hour the clinic is shut or one already taken — which a free date
/// field would happily allow.
Future<void> rescheduleAppointment(
  BuildContext context,
  WidgetRef ref,
  Appointment a,
  Future<void> Function() onDone,
) async {
  final messenger = ScaffoldMessenger.of(context);
  final locale = Localizations.localeOf(context).toString();

  final clinics = await ref.read(clinicRepositoryProvider).list();
  final open = clinics.where((c) => c.isActive).toList();
  if (open.isEmpty || !context.mounted) return;

  final picked = await showModalBottomSheet<({Clinic clinic, DateTime at})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder:
        (_) => SlotPicker(
          clinics: open,
          initialDay: a.scheduledFor ?? DateTime.now(),
        ),
  );
  if (picked == null) return;

  try {
    await ref
        .read(appointmentRepositoryProvider)
        .reschedule(a.id, picked.at.toUtc().toIso8601String());
    await onDone();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          'Moved to ${DateFormat('EEE d MMM, h:mm a', locale).format(picked.at)}',
        ),
      ),
    );
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

class _SheetAction extends StatelessWidget {
  const _SheetAction({
    required this.icon,
    required this.label,
    required this.tone,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(kInnerRadius),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 4),
        child: Row(
          children: [
            Icon(icon, size: 21, color: tone),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w600,
                  color: tone,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
