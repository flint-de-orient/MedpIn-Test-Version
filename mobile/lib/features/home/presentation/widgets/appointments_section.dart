import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/presentation/appointment_providers.dart';

/// Where the patient's appointments stand, on the screen they open first.
///
/// This replaced a card that showed only the next confirmed appointment, which
/// answered one of the three questions a patient actually has. The other two
/// had nowhere to be answered at all:
///
///   - "did they get my request?" — a request appeared as a line on the same
///     card, so a patient with a confirmed visit next week could not see that
///     this week's request was still unanswered.
///   - "did they say no?" — a declined request is cancelled, and cancelled
///     appointments sort into the Past tab of a screen most patients never
///     open. The clinic sends a push, and a push is dismissed. After that the
///     app said nothing anywhere, so the patient's own record of being turned
///     down was a notification they had already swiped away — and the failure
///     mode of that is somebody arriving for an appointment they do not have.
///
/// So all three states are shown, each saying plainly what it is.
class AppointmentsSection extends ConsumerWidget {
  const AppointmentsSection({super.key});

  /// The patient's own appointments. The server scopes this list to the caller
  /// when the caller is a patient, so no filter is needed here.
  static const _query = (
    from: null,
    to: null,
    status: null,
    clinicId: null,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final all =
        ref.watch(appointmentDiaryProvider(_query)).valueOrNull?.items ??
        const <Appointment>[];

    final now = DateTime.now();
    final startOfToday = DateTime(now.year, now.month, now.day);

    final waiting =
        all.where((a) => a.status == 'requested').toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    final confirmed =
        all
            .where(
              (a) =>
                  a.isActive &&
                  a.scheduledFor != null &&
                  !a.scheduledFor!.isBefore(startOfToday),
            )
            .toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    // Turned down, and recent enough to still matter.
    //
    // A declined request is the only cancellation with no scheduledFor — it
    // never got a time. Held to a fortnight so this does not become a running
    // list of every refusal the clinic has ever made.
    final declined =
        all
            .where(
              (a) =>
                  a.status == 'cancelled' &&
                  a.scheduledFor == null &&
                  a.createdAt != null &&
                  now.difference(a.createdAt!).inDays <= 14,
            )
            .toList()
          ..sort((a, b) => b.sortKey.compareTo(a.sortKey));

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.event_note_rounded,
                size: 18,
                color: AppColors.primary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.apptYourAppointments,
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => context.push('/appointments'),
                child: Row(
                  children: [
                    Text(
                      l10n.apptViewAll,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(width: 2),
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 15,
                      color: AppColors.primary,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm + 4),

          if (waiting.isEmpty && confirmed.isEmpty && declined.isEmpty)
            Text(
              l10n.apptNothingYet,
              style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant),
            ),

          // Confirmed first: a time to turn up at outranks a question that has
          // not been answered yet.
          for (final a in confirmed.take(2))
            _StatusRow(
              icon: Icons.check_circle_rounded,
              tone: AppColors.successOn(context),
              title: l10n.apptStatusConfirmed,
              detail: DateFormat(
                'EEE, d MMM · h:mm a',
                Localizations.localeOf(context).toString(),
              ).format(a.scheduledFor!.toLocal()),
            ),

          for (final a in waiting.take(2))
            _StatusRow(
              icon: Icons.hourglass_top_rounded,
              tone: AppColors.warningOn(context),
              title: l10n.apptWaitingReply,
              detail:
                  a.preferredFor == null
                      ? l10n.dashboardAwaitingTime
                      : l10n.apptYouAskedFor(
                        DateFormat(
                          'EEE, d MMM',
                          Localizations.localeOf(context).toString(),
                        ).format(a.preferredFor!.toLocal()),
                      ),
            ),

          for (final a in declined.take(1))
            _StatusRow(
              icon: Icons.cancel_rounded,
              tone: AppColors.dangerOn(context),
              title: l10n.apptNotAvailable,
              detail:
                  a.preferredFor == null
                      ? l10n.apptNotAvailableBody
                      : l10n.apptYouAskedFor(
                        DateFormat(
                          'EEE, d MMM',
                          Localizations.localeOf(context).toString(),
                        ).format(a.preferredFor!.toLocal()),
                      ),
              footnote: a.preferredFor == null ? null : l10n.apptNotAvailableBody,
            ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.icon,
    required this.tone,
    required this.title,
    required this.detail,
    this.footnote,
  });

  final IconData icon;
  final Color tone;
  final String title;
  final String detail;
  final String? footnote;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 17, color: tone),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 13.5,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                    color: tone,
                  ),
                ),
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.3,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (footnote != null)
                  Text(
                    footnote!,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.3,
                      color: scheme.onSurfaceVariant,
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
