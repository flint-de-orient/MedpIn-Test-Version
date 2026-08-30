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
          //
          // Each row is separated rather than stacked flush. Three states in a
          // column with no gap read as one paragraph, and the eye cannot tell
          // where a confirmed visit ends and an unanswered request begins.
          for (var i = 0; i < confirmed.take(2).length; i++) ...[
            if (i > 0) _RowDivider(),
            _StatusRow(
              appointment: confirmed[i],
              icon: Icons.check_circle_rounded,
              tone: AppColors.successOn(context),
              title: l10n.apptStatusConfirmed,
              detail: DateFormat(
                'EEE, d MMM · h:mm a',
                Localizations.localeOf(context).toString(),
              ).format(confirmed[i].scheduledFor!.toLocal()),
            ),
          ],

          for (var i = 0; i < waiting.take(2).length; i++) ...[
            if (confirmed.isNotEmpty || i > 0) _RowDivider(),
            _StatusRow(
              appointment: waiting[i],
              icon: Icons.hourglass_top_rounded,
              tone: AppColors.warningOn(context),
              title: l10n.apptWaitingReply,
              detail:
                  waiting[i].preferredFor == null
                      ? l10n.dashboardAwaitingTime
                      : l10n.apptYouAskedFor(
                        DateFormat(
                          'EEE, d MMM',
                          Localizations.localeOf(context).toString(),
                        ).format(waiting[i].preferredFor!.toLocal()),
                      ),
            ),
          ],

          for (var i = 0; i < declined.take(1).length; i++) ...[
            if (confirmed.isNotEmpty || waiting.isNotEmpty) _RowDivider(),
            _StatusRow(
              appointment: declined[i],
              icon: Icons.cancel_rounded,
              tone: AppColors.dangerOn(context),
              title: l10n.apptNotAvailable,
              detail:
                  declined[i].preferredFor == null
                      ? l10n.apptNotAvailableBody
                      : l10n.apptYouAskedFor(
                        DateFormat(
                          'EEE, d MMM',
                          Localizations.localeOf(context).toString(),
                        ).format(declined[i].preferredFor!.toLocal()),
                      ),
              footnote:
                  declined[i].preferredFor == null
                      ? null
                      : l10n.apptNotAvailableBody,
              // A refusal has no doctor and no mode to show: nobody was ever
              // allocated. Printing "with Dr Dey · In clinic" under "not
              // available" would describe a visit that is not happening.
              showWho: false,
            ),
          ],
        ],
      ),
    );
  }
}

/// A hairline between states, so three of them do not read as one paragraph.
class _RowDivider extends StatelessWidget {
  const _RowDivider();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm + 2),
    child: Divider(
      height: 1,
      color: Theme.of(
        context,
      ).colorScheme.outlineVariant.withValues(alpha: 0.6),
    ),
  );
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.appointment,
    required this.icon,
    required this.tone,
    required this.title,
    required this.detail,
    this.footnote,
    this.showWho = true,
  });

  final Appointment appointment;
  final IconData icon;
  final Color tone;
  final String title;
  final String detail;
  final String? footnote;

  /// False for a refusal, which has no doctor and no mode: nobody was ever
  /// allocated, and printing "with Dr Dey · In clinic" under "not available"
  /// would describe a visit that is not happening.
  final bool showWho;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final a = appointment;

    // Who the patient is seeing, and what for. Both were missing: the card gave
    // a date and an hour and left the person unnamed, which on a screen that
    // may list two appointments is the one thing telling them apart.
    final who = [
      if ((a.doctorName ?? '').isNotEmpty) a.doctorName!,
      if ((a.doctorSpecialty ?? '').isNotEmpty) a.doctorSpecialty!,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm + 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: tone),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // A pill, not a coloured sentence. "Confirmed" as plain text
                // sat at the same weight as everything around it and matched
                // nothing else in the app, where every other status is a badge.
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.3,
                      fontWeight: FontWeight.w800,
                      color: tone,
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 14.5,
                    height: 1.3,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (showWho && who.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    who,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.3,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
                if (showWho) ...[
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      // Video or clinic, said with an icon and the word. An
                      // icon alone asks the reader to know the convention, and
                      // turning up at a clinic for a video call is a wasted
                      // journey.
                      Icon(
                        a.isTeleconsult
                            ? Icons.videocam_outlined
                            : Icons.place_outlined,
                        size: 14,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        a.isTeleconsult ? 'Video consultation' : 'In clinic',
                        style: TextStyle(
                          fontSize: 12.5,
                          height: 1.3,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ],
                if (footnote != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    footnote!,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.3,
                      color: scheme.onSurfaceVariant,
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
