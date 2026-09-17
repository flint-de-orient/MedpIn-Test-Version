import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/presentation/appointment_providers.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';

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
/// So all three states are shown, each saying plainly what it is. The card
/// now shares the page's one surface language — it was the only section on
/// Home with its own radius, border and heading size.
class AppointmentsSection extends ConsumerWidget {
  const AppointmentsSection({super.key, this.followUpOn});

  /// The follow-up date the doctor wrote on a prescription, when there is one.
  /// Said only while nothing is booked for it — once a visit is confirmed, the
  /// visit is the answer.
  final DateTime? followUpOn;

  /// The patient's own appointments. The server scopes this list to the caller
  /// when the caller is a patient, so no filter is needed here.
  static const _query = (from: null, to: null, status: null, clinicId: null);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final async = ref.watch(appointmentDiaryProvider(_query));
    final all = async.valueOrNull?.items ?? const <Appointment>[];

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

    String day(DateTime d) => DateFormat('EEE, d MMM', locale).format(d.toLocal());

    final rows = <Widget>[
      // Confirmed first: a time to turn up at outranks a question that has
      // not been answered yet.
      for (final a in confirmed.take(2))
        _StatusRow(
          appointment: a,
          status: Status.ok,
          icon: Icons.check_circle_rounded,
          title: l10n.apptStatusConfirmed,
          detail:
              '${dayLabel(context, a.scheduledFor!.toLocal())} · '
              '${clockOf(context, a.scheduledFor!.toLocal())}',
        ),
      for (final a in waiting.take(2))
        _StatusRow(
          appointment: a,
          status: Status.watch,
          icon: Icons.hourglass_top_rounded,
          title: l10n.apptWaitingReply,
          detail:
              a.preferredFor == null
                  ? l10n.dashboardAwaitingTime
                  : l10n.apptYouAskedFor(day(a.preferredFor!)),
        ),
      for (final a in declined.take(1))
        _StatusRow(
          appointment: a,
          status: Status.alert,
          icon: Icons.event_busy_rounded,
          title: l10n.apptNotAvailable,
          detail:
              a.preferredFor == null
                  ? l10n.apptNotAvailableBody
                  : l10n.apptYouAskedFor(day(a.preferredFor!)),
          footnote: a.preferredFor == null ? null : l10n.apptNotAvailableBody,
          // A refusal has no doctor and no mode to show: nobody was ever
          // allocated. Printing "with Dr Dey · In clinic" under "not
          // available" would describe a visit that is not happening.
          showWho: false,
        ),
    ];

    final followUp = followUpOn;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.event_outlined,
            title: l10n.apptYourAppointments,
          ),
          const SizedBox(height: T.s4),
          if (async.hasError && async.valueOrNull == null)
            SectionLoadFailed(
              message: l10n.ptCouldNotLoadAppointments,
              onRetry: () => ref.invalidate(appointmentDiaryProvider(_query)),
            )
          else if (async.isLoading && async.valueOrNull == null)
            const SkeletonLine(height: T.s12)
          else ...[
            if (rows.isEmpty)
              Text(
                l10n.apptNothingYet,
                style: T.body.copyWith(color: T.inkMuted),
              ),
            for (final (i, row) in rows.indexed) ...[
              if (i > 0) const SizedBox(height: T.s3),
              row,
            ],
            if (confirmed.isEmpty && followUp != null) ...[
              const SizedBox(height: T.s3),
              NoticeTile(
                status: Status.neutral,
                icon: Icons.event_repeat_rounded,
                message: l10n.ptFollowUpBy(
                  DateFormat('EEEE, d MMMM', locale).format(followUp),
                ),
              ),
            ],
          ],
          // At the foot, like every card's link: beside the title it squeezed
          // the title to a word a line once the text was made larger.
          const SizedBox(height: T.s2),
          ActionLink(
            label: l10n.apptViewAll,
            onTap: () => context.push('/appointments'),
          ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.appointment,
    required this.status,
    required this.icon,
    required this.title,
    required this.detail,
    this.footnote,
    this.showWho = true,
  });

  final Appointment appointment;
  final Status status;
  final IconData icon;
  final String title;
  final String detail;
  final String? footnote;

  /// False for a refusal, which has no doctor and no mode.
  final bool showWho;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appointment;

    // Who the patient is seeing, and what for. On a card that may list two
    // appointments, the person is what tells them apart.
    final who = [
      if ((a.doctorName ?? '').isNotEmpty) a.doctorName!,
      if ((a.doctorSpecialty ?? '').isNotEmpty) a.doctorSpecialty!,
    ].join(' · ');

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          StatusWord(label: title, status: status, icon: icon),
          const SizedBox(height: T.s1),
          Text(detail, style: T.bodyStrong.copyWith(color: T.ink)),
          if (showWho && who.isNotEmpty)
            Text(who, style: T.small.copyWith(color: T.inkMuted)),
          if (showWho) ...[
            const SizedBox(height: T.s1),
            // Video or clinic, said with an icon and the word. Turning up at a
            // clinic for a video call is a wasted journey.
            StatusWord(
              label:
                  a.isTeleconsult ? l10n.apptModeTeleconsult : l10n.apptModeInClinic,
              status: Status.neutral,
              strong: false,
              icon:
                  a.isTeleconsult
                      ? Icons.videocam_outlined
                      : Icons.place_outlined,
            ),
          ],
          if (footnote != null)
            Text(footnote!, style: T.small.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }
}
