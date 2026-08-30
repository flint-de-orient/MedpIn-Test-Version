import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/app_card.dart';
import '../../domain/dashboard_data.dart';
import 'package:go_router/go_router.dart';

class NextAppointmentCard extends StatelessWidget {
  const NextAppointmentCard({super.key, required this.appointment});

  final NextAppointment? appointment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final appt = appointment;
    // A request has no time yet, and saying "No upcoming appointment" to
    // somebody who asked for one this morning tells them it went nowhere.
    final pending = appt != null && appt.scheduledFor == null;

    return AppCard(
      // The whole card opens the list. Tapping the thing that shows your next
      // appointment to see all of them is the obvious gesture, and the screen
      // that answers it already existed with no way in.
      onTap: () => context.push('/appointments'),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.accentOn(context).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              pending ? Icons.hourglass_top_rounded : Icons.event_rounded,
              color: AppColors.accentOn(context),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pending
                      ? l10n.dashboardAppointmentRequested
                      : l10n.dashboardNextAppointment,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(switch ((appt, pending)) {
                  (null, _) => l10n.dashboardNoAppointment,
                  // The day they asked for. Not a time — nobody has chosen
                  // one, and printing an hour here would have the patient
                  // turn up at an appointment that does not exist.
                  (final a, true) =>
                    a!.preferredFor == null
                        ? l10n.dashboardAwaitingTime
                        : DateFormat(
                          'EEE, d MMM',
                        ).format(a.preferredFor!.toLocal()),
                  (final a, false) => DateFormat(
                    'EEE, d MMM · h:mm a',
                  ).format(a!.scheduledFor!.toLocal()),
                }, style: Theme.of(context).textTheme.bodyMedium),
                if (appt != null) ...[
                  const SizedBox(height: 0),
                  Text(
                    // Says what is happening, not a status code. "requested"
                    // is a database word; "waiting for the clinic to confirm a
                    // time" is what the patient is actually doing.
                    pending
                        ? l10n.dashboardWaitingForClinic
                        : '${appt.mode} · ${appt.status}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color:
                          pending
                              ? AppColors.warningOn(context)
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
