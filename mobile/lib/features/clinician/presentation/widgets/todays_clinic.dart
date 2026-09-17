import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../auth/presentation/auth_controller.dart';
// The clinician's Appointment, not the patient-app one. There are two
// classes with that name and the provider below returns this one; importing
// the other made every field on it resolve to Object.
import '../../domain/appointment.dart';
import '../clinician_providers.dart';
import 'home_actions.dart';
import 'home_panel.dart';

/// The day, at the top of the doctor's home: who is booked, who is waiting,
/// who is in with a doctor — and the one thing to do next.
///
/// ---- What it was ----------------------------------------------------------
///
/// "Today at the clinic", third on the screen, two screenfuls below five
/// action pills and a chart. The first question a doctor opens the app with —
/// who is here — was answered last, as a list of four times in a column too
/// narrow for "10:00 AM", and with no word anywhere for who was waiting.
///
/// ---- Whose day ------------------------------------------------------------
///
/// The diary is the practice's: every doctor's appointments. Rows for a
/// colleague say whose patient they are, and the primary action only ever names
/// a patient waiting for the signed-in doctor.
class TodaysClinic extends ConsumerWidget {
  const TodaysClinic({
    super.key,
    required this.actions,
    this.practiceEmpty = false,
    this.alertsOnScreen = false,
  });

  final List<String> actions;
  final bool practiceEmpty;
  final bool alertsOnScreen;

  /// Patients named on the card before the rest are left to the Today tab.
  static const int named = 4;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).user?.id;
    final async = ref.watch(appointmentsTodayProvider);

    HomeActions actionsPart(ActionsPart part, {Appointment? waiting}) => HomeActions(
      actions: actions,
      waiting: waiting,
      practiceEmpty: practiceEmpty,
      alertsOnScreen: alertsOnScreen,
      part: part,
    );

    return HomePanel<List<Appointment>>(
      icon: Icons.today_outlined,
      title: 'Today',
      what: 'today’s appointments',
      value: async,
      onRetry: () => ref.invalidate(appointmentsTodayProvider),
      onViewAll: () => context.go('/clinician/appointments'),
      viewAllLabel: 'View all of today’s appointments',
      builder: (all) {
        final day = TodayCounts.of(all, me: me);
        return _TodayBody(
          day: day,
          me: me,
          primary: actions.isEmpty ? null : actionsPart(ActionsPart.primary, waiting: day.nextForMe),
        );
      },
      // Before the day has loaded — or if it could not — the actions still
      // work, so they are drawn whole under whatever the card says.
      footer: actions.isEmpty
          ? null
          : actionsPart(async.hasValue ? ActionsPart.rest : ActionsPart.all),
    );
  }
}

/// Today's appointments, sorted into what a doctor asks about.
class TodayCounts {
  const TodayCounts({
    required this.booked,
    required this.waiting,
    required this.inConsultation,
    required this.seen,
    required this.noShow,
    required this.next,
    required this.nextForMe,
  });

  /// Everything with a time today that was not cancelled.
  final List<Appointment> booked;
  final List<Appointment> waiting;
  final List<Appointment> inConsultation;
  final List<Appointment> seen;
  final List<Appointment> noShow;

  /// Confirmed and not yet arrived, earliest first.
  final List<Appointment> next;

  /// The patient who has waited longest for the signed-in doctor, if any.
  final Appointment? nextForMe;

  factory TodayCounts.of(List<Appointment> all, {String? me}) {
    final booked =
        all
            .where((a) => a.scheduledFor != null && a.status != 'cancelled')
            .toList()
          ..sort((a, b) => a.scheduledFor!.compareTo(b.scheduledFor!));
    List<Appointment> by(String status) =>
        booked.where((a) => a.status == status).toList(growable: false);
    final waiting = by('checked_in');

    Appointment? mine;
    if (me != null) {
      for (final a in waiting) {
        if (a.doctorId == me) {
          mine = a;
          break;
        }
      }
    }

    return TodayCounts(
      booked: booked,
      waiting: waiting,
      inConsultation: by('in_consultation'),
      seen: by('completed'),
      noShow: by('no_show'),
      next: by('confirmed'),
      nextForMe: mine,
    );
  }
}

class _TodayBody extends StatelessWidget {
  const _TodayBody({required this.day, required this.me, this.primary});

  final TodayCounts day;
  final String? me;
  final Widget? primary;

  @override
  Widget build(BuildContext context) {
    final d = day;

    // Waiting first, then whoever is in, then who is next — four at most.
    final waiting = d.waiting.take(TodaysClinic.named).toList();
    final inside = d.inConsultation.take(TodaysClinic.named - waiting.length).toList();
    final next = d.next.take(TodaysClinic.named - waiting.length - inside.length).toList();
    final unnamed =
        d.waiting.length + d.inConsultation.length + d.next.length - waiting.length - inside.length - next.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (d.booked.isEmpty)
          const PanelNote('Nothing booked today.', color: T.ink, top: 0)
        else
          CountLine(
            top: 0,
            parts: [
              CountPart(d.booked.length, 'booked'),
              CountPart(d.waiting.length, 'waiting', color: T.primary),
              CountPart(d.inConsultation.length, 'in consultation'),
              CountPart(d.seen.length, 'seen'),
              CountPart(d.noShow.length, 'did not come'),
            ],
          ),
        if (primary != null) ...[const SizedBox(height: T.s3), primary!],
        if (d.booked.isNotEmpty && waiting.isEmpty && inside.isEmpty && next.isEmpty)
          const PanelNote('Nobody is still to come today.', top: T.s3),
        _group('Waiting now', waiting),
        _group('In consultation', inside),
        _group('Next', next),
        if (unnamed > 0) PanelNote('$unnamed more later today'),
      ],
    );
  }

  Widget _group(String label, List<Appointment> rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: T.s3),
          child: Semantics(
            header: true,
            child: Text(label, style: T.label.copyWith(color: T.inkMuted)),
          ),
        ),
        for (final a in rows) _VisitRow(appointment: a, me: me),
      ],
    );
  }
}

/// One appointment: the patient, the time, and whose it is.
///
/// The group it sits under says where the patient is, so the row does not
/// repeat it as a pill — three "Waiting" pills in a column said one thing
/// three times and made every row a line taller.
class _VisitRow extends StatelessWidget {
  const _VisitRow({required this.appointment, required this.me});

  final Appointment appointment;
  final String? me;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final at = a.scheduledFor!;
    final time = DateFormat('h:mm a').format(at);
    final colleague =
        a.doctorId != null && me != null && a.doctorId != me && a.doctorName != null;
    final late = a.status == 'confirmed' && at.isBefore(DateTime.now());

    return PanelPatientRow(
      patientId: a.patientId,
      name: a.patientName,
      detail: [
        time,
        if (late) 'not arrived',
        if (colleague) 'for ${a.doctorName}',
        if (a.reason != null) a.reason!,
      ].join(' · '),
      leading: UserAvatar(
        name: a.patientName,
        avatarUrl: a.patientAvatarUrl,
        accent: T.primary,
        size: T.s8 + T.s2,
      ),
    );
  }
}
