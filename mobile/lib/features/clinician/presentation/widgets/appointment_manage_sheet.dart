import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/router/area.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../appointments/data/appointment_repository.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/presentation/widgets/appointment_time_picker.dart';
import '../../../staff/presentation/widgets/desk_geometry.dart';

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
    required this.onReschedule,
  });

  final Appointment appointment;
  final Future<void> Function() onCancel;

  /// Move it — run by the screen that opened this sheet, after the sheet has
  /// gone. See the note on the action below for why it cannot run in here.
  final Future<void> Function() onReschedule;

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
        padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
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
                const SizedBox(width: T.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        a.patientName ?? 'Patient',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: T.bodyStrong.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (when != null)
                        Text(
                          when,
                          style: T.small.copyWith(
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                        ),
                      if (a.clinicName != null)
                        Text(
                          a.clinicName!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: T.small.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),

            if ((a.reason ?? '').isNotEmpty) ...[
              const SizedBox(height: T.s3),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(T.s3),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(kInnerRadius),
                ),
                child: Text(a.reason!, style: T.small),
              ),
            ],

            const SizedBox(height: T.s2),
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
                // The move runs in the screen underneath, exactly as the cancel
                // below does. It ran in here, on this sheet's own context: the
                // sheet closed, the locations loaded, and by the time they had
                // this context was no longer mounted — so the function returned
                // without a word. Every time the network was slower than the
                // sheet's closing animation, the button did nothing at all.
                onTap: () async {
                  Navigator.pop(context);
                  await onReschedule();
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
/// field would happily allow. Where the practice has no open location there
/// are no published hours, and the picker asks for a day and a time instead.
///
/// [context] and [ref] are the calling screen's, which is still there when the
/// picker closes. Nothing here returns without saying why.
Future<void> rescheduleAppointment(
  BuildContext context,
  WidgetRef ref,
  Appointment a,
  Future<void> Function() onDone,
) async {
  final messenger = ScaffoldMessenger.of(context);
  final locale = Localizations.localeOf(context).toString();

  final PickedTime? picked;
  try {
    picked = await pickAppointmentTime(
      context,
      ref,
      initialDay: a.scheduledFor,
      preferClinicId: a.clinicId,
      title: 'Move to another time',
    );
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
    return;
  }
  if (picked == null || !context.mounted) return;

  // Another location, only when one was chosen that it is not already at. A
  // teleconsult is at no location, whichever location's hours the time was
  // chosen from.
  final moveTo =
      !a.isTeleconsult && picked.clinic != null && picked.clinic!.id != a.clinicId
          ? picked.clinic!.id
          : null;

  try {
    await ref
        .read(appointmentRepositoryProvider)
        .reschedule(
          a.id,
          picked.at.toUtc().toIso8601String(),
          clinicId: moveTo,
        );
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
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: T.tap),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: T.s3, horizontal: T.s1),
          child: Row(
            children: [
              Icon(icon, color: tone),
              const SizedBox(width: T.s4),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.bodyStrong.copyWith(color: tone),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
