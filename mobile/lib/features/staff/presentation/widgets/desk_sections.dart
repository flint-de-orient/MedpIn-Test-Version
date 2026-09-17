import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/load_failed.dart';
import '../../../../shared/widgets/notification_list_sheet.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/presentation/appointment_providers.dart';
import '../../../clinician/presentation/clinician_providers.dart';
import '../../../clinician/presentation/widgets/inbox_states.dart';
import '../../domain/desk_day.dart';
import '../desk_providers.dart';
import 'request_card.dart';

/// The pieces of the desk's Today screen.
///
/// Each answers one of the questions a receptionist has, in the order they
/// have them: is anybody in trouble, who is coming in next, who is already
/// here, who is waiting on us for a time, who has written. A section with
/// nothing to say is not drawn — except the day's list, whose empty answer
/// ("nothing booked today") is itself what the desk needs to know.

/// How long ago, in the words the desk uses.
String deskAgo(AppLocalizations l10n, DateTime? at, DateTime now) {
  if (at == null) return '';
  final d = now.difference(at);
  if (d.isNegative || d.inMinutes < 1) return l10n.deskJustNow;
  if (d.inHours < 1) return l10n.deskAgoMinutes(d.inMinutes);
  if (d.inHours < 24) return l10n.deskAgoHours(d.inHours);
  return l10n.deskAgoDays(d.inDays);
}

/// The three things a receptionist starts rather than reads.
///
/// One filled button. Registering the person at the counter is the desk's
/// commonest job, so it carries the weight; booking and walk-ins sit under it
/// at one size and one height, never a row of pills of assorted widths.
///
/// Side by side only when both labels fit on one line each. At a large text
/// size, or in a language whose words are longer, they stack at full width:
/// "Book appo" and "intment" on two lines is a label split in the middle of a
/// word, which is how it drew at 1.3.
///
/// [demoted] while somebody has reported something urgent: then the one filled
/// button on the screen is the one that opens that patient's conversation, and
/// a blue "Register patient" as loud as a chest-pain alert would be a hierarchy
/// flattened by accident.
class DeskActions extends StatelessWidget {
  const DeskActions({
    super.key,
    required this.demoted,
    required this.onRegister,
    required this.onBook,
    required this.onWalkIn,
  });

  final bool demoted;
  final VoidCallback onRegister;
  final VoidCallback onBook;
  final VoidCallback onWalkIn;

  static const _pad = EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2);
  static const _tall = Size.fromHeight(T.hControl);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final labelStyle =
        theme.outlinedButtonTheme.style?.textStyle?.resolve({}) ??
        theme.textTheme.labelLarge ??
        T.small;

    final register =
        demoted
            ? OutlinedButton(
              onPressed: onRegister,
              style: OutlinedButton.styleFrom(minimumSize: _tall),
              child: Text(l10n.deskRegisterPatient),
            )
            : FilledButton(
              onPressed: onRegister,
              style: FilledButton.styleFrom(minimumSize: _tall),
              child: Text(l10n.deskRegisterPatient),
            );

    Widget secondary(String label, VoidCallback onPressed) => OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(minimumSize: _tall, padding: _pad),
      child: Text(label, textAlign: TextAlign.center),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final half = (constraints.maxWidth - T.s2) / 2 - _pad.horizontal;
        final fitsSideBySide = [
          l10n.deskBookAppointment,
          l10n.deskAddWalkIn,
        ].every((label) => textWidths(context, label, labelStyle).line <= half);

        final book = secondary(l10n.deskBookAppointment, onBook);
        final walkIn = secondary(l10n.deskAddWalkIn, onWalkIn);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            register,
            const SizedBox(height: T.s2),
            if (fitsSideBySide)
              Row(
                children: [
                  Expanded(child: book),
                  const SizedBox(width: T.s2),
                  Expanded(child: walkIn),
                ],
              )
            else ...[
              book,
              const SizedBox(height: T.s2),
              walkIn,
            ],
          ],
        );
      },
    );
  }
}

/// Patients who reported something that cannot wait.
///
/// The only red on the screen, and it is spent on the one case where the
/// person at the desk should stop what they are doing. Said in words — "Needs
/// attention now" — and not by the red alone.
///
/// The button opens the conversation, because that is where the patient's
/// number and the call button are: what the desk does about chest pain is ring
/// the patient or fetch the doctor, and both start there.
class DeskUrgentCard extends StatelessWidget {
  const DeskUrgentCard({super.key, required this.items, required this.now});

  final List<PanelNotification> items;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(T.s4),
      decoration: BoxDecoration(
        color: T.dangerTint,
        borderRadius: BorderRadius.circular(T.rSection),
        border: Border.all(color: T.danger.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.priority_high_rounded, color: T.danger),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  l10n.deskNeedsAttention(items.length),
                  style: T.title.copyWith(color: T.danger),
                ),
              ),
            ],
          ),
          for (final item in items) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              tone: T.surfaceRaised,
              padding: const EdgeInsets.all(T.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Expanded(
                        child: Text(
                          item.patientName,
                          style: T.bodyStrong.copyWith(color: T.ink),
                        ),
                      ),
                      const SizedBox(width: T.s2),
                      Text(
                        deskAgo(l10n, item.at, now),
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                    ],
                  ),
                  const SizedBox(height: T.s1),
                  Text(item.text, style: T.body.copyWith(color: T.ink)),
                  if (item.patientId.isNotEmpty) ...[
                    const SizedBox(height: T.s3),
                    FilledButton(
                      onPressed:
                          () => context.push(
                            '/staff/patients/${item.patientId}/thread',
                            extra: item.patientName,
                          ),
                      style: FilledButton.styleFrom(
                        backgroundColor: T.danger,
                        foregroundColor: T.surfaceRaised,
                        minimumSize: const Size.fromHeight(T.tap),
                      ),
                      child: Text(l10n.deskOpenConversation),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A section card: its heading, then a notice when its answer is stale or did
/// not arrive, then whatever it holds.
///
/// A failure is said inside the section it belongs to rather than instead of
/// it, so the heading and its "View all" stay where the desk expects them.
class _DeskSection extends StatelessWidget {
  const _DeskSection({
    required this.header,
    required this.children,
    this.notice,
  });

  final Widget header;
  final Widget? notice;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          if (notice != null) ...[const SizedBox(height: T.s3), notice!],
          if (children.isNotEmpty) ...[
            const SizedBox(height: T.s4),
            ...children,
          ],
        ],
      ),
    );
  }
}

/// Who is coming in, the next of them first.
///
/// This replaced a strip of three tiles — Scheduled, Waiting, Freed up — which
/// on a quiet morning read 0, 0 and 0 in the largest type on the screen, and on
/// a busy one said "4" without saying who, or when.
///
/// [day] is null when the diary has not arrived and [notice] says why.
class DeskComingInCard extends StatelessWidget {
  const DeskComingInCard({
    super.key,
    required this.day,
    required this.now,
    this.notice,
  });

  final DeskDay? day;
  final DateTime now;
  final Widget? notice;

  /// Enough to plan the next hour by. The rest is one tap away, in the diary.
  static const _shown = 4;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final d = day;

    final children = <Widget>[];
    if (d != null) {
      final shown = d.comingIn.take(_shown).toList();
      final more = d.comingIn.length - shown.length;

      if (d.booked == 0) {
        // Said, not hidden. A desk looking for a booking that is not there
        // needs to see that there are none, rather than an absent section it
        // cannot tell from one still loading.
        children.add(
          Text(
            l10n.deskNothingBooked,
            style: T.body.copyWith(color: T.inkMuted),
          ),
        );
      } else if (shown.isEmpty) {
        children.add(
          Text(l10n.deskNoMoreToday, style: T.body.copyWith(color: T.inkMuted)),
        );
      } else {
        children.add(_NextArrival(appointment: shown.first, now: now));
        for (final a in shown.skip(1)) {
          children
            ..add(const Divider(height: T.s4, color: T.line))
            ..add(_ArrivalRow(appointment: a));
        }
        if (more > 0) {
          children
            ..add(const SizedBox(height: T.s3))
            ..add(
              Text(
                l10n.deskMoreLaterToday(more),
                style: T.small.copyWith(color: T.inkMuted),
              ),
            );
        }
      }

      if (d.booked > 0 || d.cancelled > 0) {
        // Only what happened. "0 did not come" beside "0 cancelled" on every
        // quiet afternoon is a row of zeros by another name.
        final parts = [
          if (d.booked > 0) l10n.deskBookedCount(d.booked),
          if (d.seen > 0) l10n.deskSeenCount(d.seen),
          if (d.didNotCome > 0) l10n.deskNoShowCount(d.didNotCome),
          if (d.cancelled > 0) l10n.deskCancelledCount(d.cancelled),
        ];
        children
          ..add(const Divider(height: T.s6, color: T.line))
          ..add(
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${l10n.deskSoFarToday}  ',
                    style: T.small.copyWith(
                      color: T.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  TextSpan(text: parts.join(' · ')),
                ],
              ),
              style: T.small.copyWith(color: T.inkMuted),
            ),
          );
      }
    }

    return _DeskSection(
      header: SectionHeader(
        icon: Icons.event_note_rounded,
        title: l10n.deskComingInToday,
        subtitle: DateFormat('EEEE, d MMMM', locale).format(now),
        trailing: ActionLink(
          label: l10n.apptViewAll,
          onTap: () => context.push('/staff/appointments'),
        ),
      ),
      notice: notice,
      children: children,
    );
  }
}

class _NextArrival extends StatelessWidget {
  const _NextArrival({required this.appointment, required this.now});

  final Appointment appointment;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appointment;
    final minutes = a.scheduledFor!.difference(now).inMinutes;

    final when = [
      l10n.deskNext,
      if (minutes > 0 && minutes < 60) l10n.deskInMinutes(minutes),
    ].join(' · ');

    return InnerTile(
      tone: T.primaryTint,
      padding: const EdgeInsets.fromLTRB(T.s3, T.s3, T.s1, T.s3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(when, style: T.label.copyWith(color: T.primary)),
                const SizedBox(height: T.s1),
                Text(
                  clockTime(context, a.scheduledFor!),
                  style: T.title.copyWith(color: T.ink),
                ),
                Text(
                  a.patientName ?? l10n.deskPatientFallback,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                if (a.isTeleconsult)
                  Text(
                    l10n.apptModeTeleconsult,
                    style: T.small.copyWith(color: T.primary),
                  ),
                if ((a.reason ?? '').trim().isNotEmpty)
                  Text(
                    a.reason!.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
              ],
            ),
          ),
          _CallButton(phone: a.patientPhone),
        ],
      ),
    );
  }
}

/// One later arrival: the time, the name, a way to ring them.
///
/// Time and name side by side while the name's longest word fits beside the
/// time; stacked when it does not. A fixed time column at a large text size
/// left the name a sliver, and "Chattopadhyay" was drawn as "Chattopadh" and
/// "yay" on two lines.
class _ArrivalRow extends StatelessWidget {
  const _ArrivalRow({required this.appointment});

  final Appointment appointment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appointment;
    final timeStyle = T.bodyStrong.copyWith(color: T.ink);
    final nameStyle = T.body.copyWith(color: T.ink);
    final name = a.patientName ?? l10n.deskPatientFallback;

    // Every row's time column is as wide as the widest time of day can be, so
    // the names line up down the card. The digits are not all one width, so
    // the widest of a few candidates, and a hairline of slack for rounding.
    final timeWidth =
        [
          for (final hour in const [0, 10, 12, 22])
            textWidths(
              context,
              clockTime(context, DateTime(2000, 1, 1, hour, 0)),
              timeStyle,
            ).line,
        ].reduce((a, b) => a > b ? a : b) +
        T.s1;

    final nameBlock = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(name, style: nameStyle),
        if (a.isTeleconsult)
          Text(
            l10n.apptModeTeleconsult,
            style: T.small.copyWith(color: T.primary),
          ),
      ],
    );
    final time = Text(clockTime(context, a.scheduledFor!), style: timeStyle);

    return LayoutBuilder(
      builder: (context, constraints) {
        final nameWidth =
            constraints.maxWidth - T.s3 - timeWidth - T.s3 - T.tap;
        final sideBySide =
            nameWidth > 0 &&
            textWidths(context, name, nameStyle).word <= nameWidth;

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(width: T.s3),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: T.s3),
                child:
                    sideBySide
                        ? Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: timeWidth, child: time),
                            const SizedBox(width: T.s3),
                            Expanded(child: nameBlock),
                          ],
                        )
                        : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [time, nameBlock],
                        ),
              ),
            ),
            _CallButton(phone: a.patientPhone),
          ],
        );
      },
    );
  }
}

/// Ring them: the desk's own move on a row like this, and the one thing the
/// practice software cannot do from the counter. Named, because it is a glyph.
class _CallButton extends StatelessWidget {
  const _CallButton({required this.phone});

  final String? phone;

  @override
  Widget build(BuildContext context) {
    final number = phone;
    if (number == null || number.isEmpty) {
      return const SizedBox(width: T.tap, height: T.tap);
    }
    return IconButton(
      tooltip: AppLocalizations.of(context).deskCallPatient(number),
      onPressed: () => launchUrl(Uri(scheme: 'tel', path: number)),
      icon: const Icon(Icons.call_outlined, color: T.primary),
    );
  }
}

/// Who is already in the building, as the server knows it.
///
/// Drawn only when somebody is. This app does not mark arrivals itself, so an
/// empty list here says nothing about the waiting room — and a section that
/// said "nobody has arrived" on a full morning would be believed.
class DeskInClinicCard extends StatelessWidget {
  const DeskInClinicCard({super.key, required this.appointments});

  final List<Appointment> appointments;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return _DeskSection(
      header: SectionHeader(
        icon: Icons.meeting_room_outlined,
        title: l10n.deskInTheClinic,
      ),
      children: [
        for (var i = 0; i < appointments.length; i++) ...[
          if (i > 0) const Divider(height: T.s4, color: T.line),
          _InClinicRow(appointment: appointments[i]),
        ],
      ],
    );
  }
}

class _InClinicRow extends StatelessWidget {
  const _InClinicRow({required this.appointment});

  final Appointment appointment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appointment;
    final withDoctor = a.status == 'in_consultation';
    final token = a.queueNumber;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                a.patientName ?? l10n.deskPatientFallback,
                style: T.bodyStrong.copyWith(color: T.ink),
              ),
              Text(
                [
                  withDoctor ? l10n.deskWithDoctor : l10n.deskArrivedWaiting,
                  if (a.scheduledFor != null)
                    clockTime(context, a.scheduledFor!),
                ].join(' · '),
                style: T.small.copyWith(
                  color: withDoctor ? T.primary : T.inkMuted,
                  fontWeight: withDoctor ? FontWeight.w600 : null,
                ),
              ),
            ],
          ),
        ),
        if (token != null) ...[
          const SizedBox(width: T.s2),
          TonePill(label: l10n.deskToken(token)),
        ],
      ],
    );
  }
}

/// Patients who asked for an appointment and are waiting for the desk to give
/// them a time — the call-backs.
class DeskRequestsCard extends StatelessWidget {
  const DeskRequestsCard({
    super.key,
    required this.requests,
    required this.onChanged,
  });

  /// Longest-waiting first.
  final List<Appointment> requests;
  final Future<void> Function() onChanged;

  /// The oldest few; the diary holds the whole pile.
  static const _shown = 3;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final shown = requests.take(_shown).toList();

    return _DeskSection(
      header: SectionHeader(
        icon: Icons.hourglass_top_rounded,
        title: l10n.deskWaitingForTimeTitle(requests.length),
        trailing:
            requests.length > _shown
                ? ActionLink(
                  label: l10n.apptViewAll,
                  onTap: () => context.push('/staff/appointments'),
                )
                : null,
      ),
      children: [
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const Divider(height: T.s4, color: T.line),
          RequestCard(
            appointment: shown[i],
            onConfirmed: onChanged,
            gapBelow: 0,
          ),
        ],
      ],
    );
  }
}

/// Registered patients who already use the app and have not yet read back the
/// code sent to their phone. They are in no list until they do.
///
/// Hidden when there are none, and when the answer is not in — the Patients
/// tab, which this leads to, says its own piece about a failure.
class DeskWaitingOnCodeCard extends ConsumerWidget {
  const DeskWaitingOnCodeCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final waiting = ref.watch(pendingEnrolmentsProvider).valueOrNull;
    if (waiting == null || waiting.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: T.s4),
      child: SectionCard(
        padding: const EdgeInsets.all(T.s4),
        child: SectionHeader(
          icon: Icons.sms_outlined,
          title: l10n.deskWaitingOnCode(waiting.length),
          subtitle: waiting.map((p) => p.name).take(3).join(', '),
          // `go`, not `push`: Patients is one of this shell's own tabs, and
          // pushing it stacks a copy while the bar keeps Today lit.
          trailing: ActionLink(
            label: l10n.apptViewAll,
            onTap: () => context.go('/staff/patients'),
          ),
        ),
      ),
    );
  }
}

/// Who has written to the clinic and is waiting for a reply.
class DeskMessagesCard extends StatelessWidget {
  const DeskMessagesCard({
    super.key,
    required this.total,
    required this.threads,
    required this.now,
  });

  /// The server's count of unread messages. The rows may not reach it: the
  /// feed behind them is capped.
  final int total;
  final List<UnreadThread> threads;
  final DateTime now;

  static const _shown = 4;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final shown = threads.take(_shown).toList();

    return _DeskSection(
      header: SectionHeader(
        icon: Icons.forum_outlined,
        title: l10n.deskUnreadMessagesTitle(total),
        trailing: ActionLink(
          label: l10n.apptViewAll,
          onTap: () => context.go('/staff/patients'),
        ),
      ),
      children: [
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const Divider(height: 1, color: T.line),
          _ThreadRow(thread: shown[i], now: now),
        ],
      ],
    );
  }
}

class _ThreadRow extends StatelessWidget {
  const _ThreadRow({required this.thread, required this.now});

  final UnreadThread thread;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final t = thread;
    final open =
        t.patientId.isEmpty
            ? null
            : () => context.push(
              '/staff/patients/${t.patientId}/thread',
              extra: t.patientName,
            );

    final tags = [
      if (t.count > 1) l10n.deskNewMessages(t.count),
      if (t.nutrition) l10n.deskNutritionChat,
    ];

    return InkWell(
      onTap: open,
      borderRadius: BorderRadius.circular(T.rControl),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: T.s3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            UserAvatar(
              name: nameForInitial(t.patientName),
              avatarUrl: t.avatarUrl,
              accent: T.primary,
              size: T.s8 + T.s2,
            ),
            const SizedBox(width: T.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Expanded(
                        child: Text(
                          t.patientName,
                          style: T.bodyStrong.copyWith(color: T.ink),
                        ),
                      ),
                      const SizedBox(width: T.s2),
                      Text(
                        deskAgo(l10n, t.at, now),
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                    ],
                  ),
                  Text(
                    t.latest,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.ink),
                  ),
                  if (tags.isNotEmpty) ...[
                    const SizedBox(height: T.s1),
                    Text(
                      tags.join(' · '),
                      style: T.label.copyWith(color: T.primary),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Said once, and only when it is known to be true: every source loaded, and
/// nobody urgent, nobody waiting for a time, nothing unread.
class DeskCaughtUp extends StatelessWidget {
  const DeskCaughtUp({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: T.s1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.check_circle_outline_rounded, color: T.success),
          const SizedBox(width: T.s3),
          Expanded(
            child: Text(
              AppLocalizations.of(context).deskCaughtUp,
              style: T.body.copyWith(color: T.inkMuted),
            ),
          ),
        ],
      ),
    );
  }
}

/// The shape of a section whose answer has not arrived.
///
/// Grey bars rather than a zero or an empty sentence: "nothing booked today"
/// shown while the diary is still on its way is the one message the desk would
/// act on wrongly.
class DeskLoadingCard extends StatelessWidget {
  const DeskLoadingCard({super.key, required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    Widget bar(double widthFactor) => FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: Container(
        height: T.s3,
        decoration: BoxDecoration(
          color: T.line,
          borderRadius: BorderRadius.circular(T.s1),
        ),
      ),
    );

    return Semantics(
      label: 'Loading',
      child: _DeskSection(
        header: SectionHeader(icon: icon, title: title),
        children: [
          bar(0.7),
          const SizedBox(height: T.s3),
          bar(0.5),
          const SizedBox(height: T.s3),
          bar(0.6),
        ],
      ),
    );
  }
}

/// The week so far, counted by the server.
///
/// It replaced a card of four figures, two of which could never be anything
/// but zero: it counted "requests" and "declined" inside a date range, and a
/// date range is applied to an appointment's time — which a request, and a
/// request turned down, do not have. What is left are the figures the diary can
/// actually answer, and only the ones that happened.
///
/// Drawn only once it has something to say: nothing while loading, nothing on
/// a week with no bookings (the day's own card has already said so), and a
/// line of its own if the figures could not be fetched.
class DeskWeekCard extends ConsumerWidget {
  const DeskWeekCard({super.key, required this.now});

  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final week = weekSoFar(now);

    AsyncValue<int> total(String? status) => ref.watch(
      deskCountProvider((
        from: week.from,
        to: week.to,
        status: status,
        clinicId: null,
      )),
    );

    final all = total(null);
    final cancelled = total('cancelled');
    final seen = total('completed');
    final noShow = total('no_show');
    final parts = [all, cancelled, seen, noShow];

    final failed = parts.any((p) => p.hasError && p.valueOrNull == null);
    final ready = parts.every((p) => p.valueOrNull != null);
    if (!failed && !ready) return const SizedBox.shrink();

    final range = DateFormat('d MMM', locale);
    final header = SectionHeader(
      icon: Icons.insights_rounded,
      title: l10n.deskThisWeekSoFar,
      subtitle: '${range.format(week.from)} – ${range.format(now)}',
    );

    if (failed) {
      return _DeskSection(
        header: header,
        notice: LoadFailed(
          what: 'this week’s figures',
          compact: true,
          onRetry: () => ref.invalidate(deskCountProvider),
        ),
        children: const [],
      );
    }

    final booked = all.value! - cancelled.value!;
    if (booked <= 0 && cancelled.value! == 0) return const SizedBox.shrink();

    final figures = [
      l10n.deskBookedCount(booked),
      if (seen.value! > 0) l10n.deskSeenCount(seen.value!),
      if (noShow.value! > 0) l10n.deskNoShowCount(noShow.value!),
      if (cancelled.value! > 0) l10n.deskCancelledCount(cancelled.value!),
    ];

    return _DeskSection(
      header: header,
      children: [
        Text(figures.join(' · '), style: T.body.copyWith(color: T.ink)),
      ],
    );
  }
}

/// The desk's appointment queries, named once.
abstract final class DeskQueries {
  /// Everything asked for and not yet given a time, whatever day it is for.
  static const AppointmentQuery requests = (
    from: null,
    to: null,
    status: 'requested',
    clinicId: null,
  );

  /// Today, midnight to midnight, cancellations included.
  static AppointmentQuery today(DateTime now) {
    final start = DateTime(now.year, now.month, now.day);
    return (
      from: start,
      to: start.add(const Duration(days: 1)),
      status: null,
      clinicId: null,
    );
  }
}
