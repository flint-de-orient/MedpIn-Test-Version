import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/data/appointment_repository.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../appointments/domain/appointment.dart';
import '../../appointments/domain/clinic.dart';
import '../../appointments/domain/clinic_status.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../clinician/domain/clinician_models.dart';
import '../../clinician/presentation/clinician_providers.dart';
import '../../clinician/presentation/widgets/panel_ui.dart';
import 'widgets/desk_geometry.dart';
import 'widgets/request_card.dart';
import '../../clinician/presentation/widgets/clinician_notification_sheet.dart';
import '../../../shared/widgets/clinic_brand.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/notification_list_sheet.dart';
import '../../../l10n/gen/app_localizations.dart';

/// The front desk's day.
///
/// Two lists, in the order the desk works them. Requests first, because
/// somebody is waiting on an answer and nothing happens until the desk gives
/// them one; then today's booked appointments, which are the room in front of
/// them. Everything else a receptionist does — registering a walk-in, finding
/// a patient, answering a message — lives on the other tabs.
class StaffTodayScreen extends ConsumerStatefulWidget {
  const StaffTodayScreen({super.key});

  @override
  ConsumerState<StaffTodayScreen> createState() => _StaffTodayScreenState();
}

class _StaffTodayScreenState extends ConsumerState<StaffTodayScreen> {
  /// Everything asked for and not yet given a time, whatever day it is for.
  /// A request from last Tuesday that nobody answered is more urgent than one
  /// from this morning, not less, so it is never filtered out by date.
  AppointmentQuery get _requests => (
    from: null,
    to: null,
    status: 'requested',
    clinicId: null,
  );

  AppointmentQuery get _today {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    return (
      from: start,
      to: start.add(const Duration(days: 1)),
      status: null,
      clinicId: null,
    );
  }

  /// Everything this screen counts, not just the two lists it draws.
  ///
  /// The rail counted unread off the patient roll and the bell counted it off
  /// the notification endpoint, and only the appointment queries were ever
  /// invalidated. A receptionist who opened every thread, read every message
  /// and came back still saw "2 Unread" — a number from before they started,
  /// with no way to clear it short of restarting the app.
  void _reload(WidgetRef ref) {
    // The whole family, not the two queries this method used to name.
    //
    // The summary card asks for its own range — this week, when the desk
    // switches it — and that query is not one of the two. Listing them by hand
    // is how a card ends up refreshing everything on screen except itself, so
    // the family goes as a whole and Riverpod re-fetches only what is still
    // being watched.
    ref.invalidate(appointmentDiaryProvider);
    ref.invalidate(clinicianNotificationsProvider);
  }

  Future<void> _refresh() async => _reload(ref);

  @override
  Widget build(BuildContext context) {
    final requests =
        ref.watch(appointmentDiaryProvider(_requests)).valueOrNull?.items ??
        const <Appointment>[];
    // Requests are already excluded from the day: they have no scheduledFor, so
    // a date-ranged query cannot match them.
    //
    // Kept unfiltered as well as filtered. The schedule shows who is coming, so
    // it drops cancellations; the summary at the foot of the screen is a
    // tally of the whole day, and a day's cancellations are exactly what it is
    // being asked about. Filtering once at the top would have made the summary
    // report zero cancellations on every day, for ever.
    final todayAll =
        ref.watch(appointmentDiaryProvider(_today)).valueOrNull?.items ??
        const <Appointment>[];
    final today =
        todayAll.where((a) => a.status != 'cancelled').toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    return Scaffold(
      backgroundColor: Colors.transparent,
      // No floating button. Registering a patient is the desk's commonest job
      // and it now leads Quick actions — where it sits beside the other three
      // things a receptionist does all day, instead of hovering over the
      // urgent card in the same filled blue as "Review now" and competing with
      // it. A floating action button that shouts as loudly as a chest-pain
      // alert is a hierarchy that has been flattened by accident.
      // Reading a message happens on another screen, and the desk leaves this
      // one and comes back all day. AutoRefresh re-reads on a timer while the
      // screen is up and again the moment the app resumes, so the counts here
      // are never older than the last time anyone looked at them.
      body: AutoRefresh(
        onTick: _reload,
        child: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              // 96 points of bottom padding was clearance for a floating
              // "Register" button that no longer exists — it moved into Quick
              // actions. The shell's Scaffold already reserves the nav bar's
              // full height including the gesture inset, so this was reserving
              // it a second time: roughly seventy points of dead white space at
              // the foot of every scroll, on the screen whose whole complaint
              // was that too little fits above the fold.
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm,
                AppSpacing.md,
                AppSpacing.lg,
              ),
              children: [
                // Ordered by what the desk has to answer, in the order they
                // have to answer it: who needs help this minute, who is waiting
                // on us, who is coming, what else can I do, how did the day go.
                //
                // It used to open with a large blue card that said "No
                // appointments" — the least useful sentence on the screen given
                // the widest, brightest surface, on a morning when somebody was
                // already waiting for a time and somebody else had reported
                // chest pain. Nothing was wrong with the card; it was answering
                // the wrong question first.
                const _DeskHeader(),
                const SizedBox(height: AppSpacing.md),
                _DateBar(onRefresh: _refresh),
                const SizedBox(height: AppSpacing.md),

                // A patient writing "I have chest pain" already pushes to this
                // handset — the desk is on that fan-out deliberately, because
                // the receptionist is the person physically present and what
                // happens next is fetching the doctor or ringing the patient
                // back. Nothing is drawn when there is nothing: a standing
                // "Emergencies" heading on a quiet morning is a heading that
                // has stopped being read by the time it matters.
                const _UrgentSection(),

                _QueueCard(
                  today: todayAll,
                  requests: requests,
                  onConfirmed: _refresh,
                ),
                const SizedBox(height: AppSpacing.md),

                // Above the day's list, not below it.
                //
                // These are the things a receptionist starts rather than reads:
                // register the person standing at the desk, check somebody in,
                // open the messages. Sitting under "Today's appointments" they
                // were below the fold on every screen size once a single
                // request was waiting — so the four commonest actions of the
                // job needed a scroll to reach, while a list the desk mostly
                // just glances at held the space above them.
                const _QuickActionsCard(),
                const SizedBox(height: AppSpacing.md),
                _AppointmentsCard(today: today),
                const SizedBox(height: AppSpacing.md),
                _ClinicSummaryCard(today: todayAll, requests: requests),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DeskHeader extends ConsumerWidget {
  const _DeskHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Whose clinic this is, whether it is open, and what is waiting.
    //
    // The date has moved out to its own row below. It used to sit above the
    // clinic name, which put the least specific thing on the screen — the
    // date, which every phone already shows — in the position the eye reads
    // first, and pushed the operational content down a line for it.
    //
    // The mark and the name come from [ClinicWordmark], the same widget every
    // other panel uses.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const Expanded(child: ClinicWordmark(subtitleWidget: _DeskStatusLine())),
        const SizedBox(width: AppSpacing.sm),
        // The same bell the doctor has. What reaches it differs by role — the
        // desk is told about requests and messages, not about a patient's
        // HbA1c — but the control is one control.
        PanelNotificationBell(onTap: () => showClinicianNotifications(context)),
      ],
    );
  }
}

/// "Front Desk · Open · Closes 8:00 PM", from the clinic's own schedule.
///
/// A receptionist is asked "are you open?" on the phone all day, and answering
/// it from memory is how a patient gets told to come in on the afternoon the
/// clinic shuts early. So this is read from the same weekly hours and one-off
/// overrides the booking engine uses to decide which slots exist — there is no
/// second setting to keep in step, and a Durga Puja closure entered once is
/// true here the moment it is saved.
class _DeskStatusLine extends ConsumerWidget {
  const _DeskStatusLine();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();
    final clinic = ref.watch(brandClinicProvider).valueOrNull;

    final muted = TextStyle(
      fontSize: 11.5,
      height: 1.25,
      fontWeight: FontWeight.w500,
      color: scheme.onSurfaceVariant,
    );

    // No clinic loaded yet: the role, and nothing claimed about the hours.
    // "Closed" while the answer is still in flight would be a lie told
    // confidently, and this is the line people act on.
    if (clinic == null) {
      return Text(l10n.deskFrontDesk, maxLines: 1, style: muted);
    }

    final status = clinicStatusAt(clinic, DateTime.now());
    final tone =
        status.open ? AppColors.successOn(context) : scheme.onSurfaceVariant;

    final String? tail;
    if (status.open && status.closesAt != null) {
      tail = l10n.deskClosesAt(DateFormat('h:mm a', locale).format(status.closesAt!));
    } else if (!status.open && status.opensAt != null) {
      tail = l10n.deskOpensAt(DateFormat('h:mm a', locale).format(status.opensAt!));
    } else {
      tail = null;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            l10n.deskFrontDesk,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: muted,
          ),
        ),
        const SizedBox(width: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
          decoration: BoxDecoration(
            color: tone.withValues(alpha: 0.13),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            status.open ? l10n.deskOpen : l10n.deskClosed,
            style: TextStyle(
              fontSize: 10.5,
              height: 1.3,
              fontWeight: FontWeight.w800,
              color: tone,
            ),
          ),
        ),
        if (tail != null) ...[
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              '· $tail',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: muted,
            ),
          ),
        ],
      ],
    );
  }
}

/// The date, and a way to ask again.
///
/// Refresh is explicit as well as automatic. [AutoRefresh] re-reads on a timer
/// and on resume, which covers the desk that walks away and comes back — but a
/// receptionist who has just taken a booking on the phone wants to see it land
/// now, and pull-to-refresh is not discoverable on a screen that fits without
/// scrolling.
class _DateBar extends StatelessWidget {
  const _DateBar({required this.onRefresh});

  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    // The date reads in the chosen language too. DateFormat with no locale
    // argument uses Intl's global default, which is not what MaterialApp's
    // locale sets — so the day name would stay English while the words around
    // it changed, which looks like a half-finished translation.
    final locale = Localizations.localeOf(context).toString();

    return Row(
      children: [
        Icon(
          Icons.calendar_today_rounded,
          size: 15,
          color: AppColors.primary,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            DateFormat('EEEE, d MMMM y', locale).format(DateTime.now()),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
            ),
          ),
        ),
        TextButton.icon(
          onPressed: onRefresh,
          icon: const Icon(Icons.refresh_rounded, size: 17),
          label: Text(l10n.deskRefresh),
          style: TextButton.styleFrom(
            foregroundColor: AppColors.primary,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            minimumSize: const Size(0, 32),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            textStyle: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}


/// The white surface every section on this screen sits on.
class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
  });

  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(kSectionRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.45)),
      ),
      child: child,
    );
  }
}

/// A section's title, and the one place it leads.
class _CardHeader extends StatelessWidget {
  const _CardHeader({required this.title, this.actionLabel, this.onAction});

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 16.5,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.2,
            ),
          ),
        ),
        if (actionLabel != null && onAction != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primary,
              padding: const EdgeInsets.symmetric(horizontal: 6),
              minimumSize: const Size(0, 30),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    actionLabel!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 2),
                const Icon(Icons.arrow_forward_rounded, size: 14),
              ],
            ),
          ),
      ],
    );
  }
}

/// Open emergencies, above everything else on the desk's day.
///
/// Only urgent and emergency severities reach a staff account — the server
/// filters, see `DESK_ALERTS`. So everything drawn here is something a
/// receptionist can act on in the next minute, and the row leads to the thread
/// because that is where the call button is.
///
/// The red is load-bearing, not decorative. It is the only red on the screen,
/// and it is spent on the one case where the person at the desk should stop
/// what they are doing: a patient has reported something that cannot wait for
/// the doctor's next free moment. Everything else that needs action is amber.
///
/// Nothing is drawn when there is nothing. An empty "Needs attention" heading
/// on a quiet morning is a heading that stops being read by the time it
/// matters.
class _UrgentSection extends ConsumerWidget {
  const _UrgentSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final view = ref.watch(clinicianNotificationsProvider).valueOrNull;
    final urgent =
        (view?.items ?? const <PanelNotification>[])
            .where((i) => i.kind == 'urgent')
            .toList();
    if (urgent.isEmpty) return const SizedBox.shrink();

    final danger = AppColors.dangerOn(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.dangerBgOn(context),
          borderRadius: BorderRadius.circular(kSectionRadius),
          border: Border.all(color: danger.withValues(alpha: 0.28)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.priority_high_rounded, size: 15, color: danger),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.deskNeedsAttention(urgent.length),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.2,
                      color: danger,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm + 4),
            for (var i = 0; i < urgent.length; i++) ...[
              if (i > 0) const SizedBox(height: AppSpacing.sm),
              _UrgentCard(item: urgent[i]),
            ],
          ],
        ),
      ),
    );
  }
}

/// One patient who has reported something that cannot wait.
class _UrgentCard extends StatelessWidget {
  const _UrgentCard({required this.item});

  final PanelNotification item;

  /// How long ago they said it. A symptom reported four minutes ago and one
  /// reported four hours ago call for different things from the person reading
  /// this, and the row is useless without it.
  String? _reportedIn(AppLocalizations l10n) {
    final at = item.at;
    if (at == null) return null;
    final d = DateTime.now().difference(at);
    if (d.isNegative) return null;
    if (d.inHours < 1) return l10n.deskReportedAgoMinutes(d.inMinutes);
    if (d.inHours < 24) return l10n.deskReportedAgoHours(d.inHours);
    return l10n.deskReportedAgoDays(d.inDays);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final danger = AppColors.dangerOn(context);
    final scheme = Theme.of(context).colorScheme;
    final reported = _reportedIn(l10n);

    // The thread, because that is where the clinic's emergency number and the
    // patient's own phone number are. "Review now" that opened a read-only
    // detail page would be a button that stops one step short of the only two
    // things the desk can actually do about chest pain.
    final open =
        item.patientId.isEmpty
            ? null
            : () => context.push(
              '/staff/patients/${item.patientId}/thread',
              extra: item.patientName,
            );

    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(kInnerRadius),
      child: InkWell(
        onTap: open,
        borderRadius: BorderRadius.circular(kInnerRadius),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.sm + 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  UserAvatar(
                    name: item.patientName,
                    avatarUrl: item.avatarUrl,
                    accent: danger,
                    size: 44,
                  ),
                  const SizedBox(width: AppSpacing.sm + 2),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                item.patientName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.2,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: danger.withValues(alpha: 0.13),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                l10n.deskUrgentChip,
                                style: TextStyle(
                                  fontSize: 10,
                                  height: 1.2,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 0.4,
                                  color: danger,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          item.text,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14.5,
                            height: 1.25,
                            fontWeight: FontWeight.w700,
                            color: danger,
                          ),
                        ),
                        // How long it has been sitting there, and nothing else.
                        //
                        // This used to lead with "Urgent patient-reported
                        // symptom", which the chip two lines up already says in
                        // one word — and saying it twice cost the row so much
                        // width that the part nobody else says, the elapsed
                        // time, was the half that got cut: "Urgent
                        // patient-reported symptom · Rep…". The dot carries the
                        // escalation now, which is what the design had.
                        if (reported != null) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Container(
                                width: 6,
                                height: 6,
                                decoration: BoxDecoration(
                                  color: danger,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  reported,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm + 2),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: open,
                  icon: const Icon(Icons.arrow_forward_rounded, size: 17),
                  label: Text(l10n.deskReviewNow),
                  style: FilledButton.styleFrom(
                    backgroundColor: danger,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, AppSpacing.minTapTarget),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(kInnerRadius),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Who is in the clinic's flow right now, and who is waiting on the desk.
///
/// This replaced a large blue hero whose headline, on a quiet morning, was "No
/// appointments" — the least useful sentence available, given the brightest
/// surface on the screen, while a patient sat unanswered in the list below it.
/// The card now leads with the three numbers that describe the day and then
/// hands over the one thing that needs doing.
class _QueueCard extends ConsumerWidget {
  const _QueueCard({
    required this.today,
    required this.requests,
    required this.onConfirmed,
  });

  /// Everything scheduled for today, cancellations included.
  final List<Appointment> today;
  final List<Appointment> requests;
  final Future<void> Function() onConfirmed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    // Confirmed, but not yet arrived. Someone who has checked in is counted
    // under "in progress" instead — they are in the building, and counting
    // them in both places would describe a busier clinic than exists.
    final scheduled = today.where((a) => a.status == 'confirmed').length;
    final active =
        today
            .where(
              (a) =>
                  a.status == 'checked_in' || a.status == 'in_consultation',
            )
            .length;

    return _SectionCard(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.sm + 4,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardHeader(
            title: l10n.deskTodaysQueue,
            actionLabel: l10n.deskManageQueue,
            onAction: () => context.push('/staff/appointments'),
          ),
          const SizedBox(height: AppSpacing.sm + 4),
          Row(
            children: [
              Expanded(
                child: _QueueStat(
                  icon: Icons.event_note_rounded,
                  value: '$scheduled',
                  label: l10n.deskScheduled,
                  caption: l10n.deskToday,
                  tone: AppColors.primary,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _QueueStat(
                  icon: Icons.hourglass_top_rounded,
                  value: '${requests.length}',
                  label: l10n.deskWaiting,
                  caption: l10n.deskForScheduling,
                  // Amber only while somebody is actually waiting. A permanent
                  // orange tile is a colour that has stopped meaning anything.
                  tone:
                      requests.isEmpty
                          ? scheme.onSurfaceVariant
                          : AppColors.warningOn(context),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _QueueStat(
                  icon: Icons.medical_services_outlined,
                  value: '$active',
                  label: l10n.deskInProgress,
                  caption: l10n.deskNowLabel,
                  tone:
                      active == 0
                          ? scheme.onSurfaceVariant
                          : AppColors.successOn(context),
                ),
              ),
            ],
          ),
          if (requests.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.6),
            ),
            const SizedBox(height: AppSpacing.sm + 4),
            Text(
              l10n.deskWaitingCount(requests.length),
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.warningOn(context),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            for (final a in requests)
              RequestCard(appointment: a, onConfirmed: onConfirmed),
          ],
        ],
      ),
    );
  }
}

/// One number in the queue rail.
class _QueueStat extends StatelessWidget {
  const _QueueStat({
    required this.icon,
    required this.value,
    required this.label,
    required this.caption,
    required this.tone,
  });

  final IconData icon;
  final String value;
  final String label;
  final String caption;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(kInnerRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 16, color: tone),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            style: const TextStyle(
              fontSize: 24,
              height: 1.05,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
          ),
          Text(
            caption,
            // Two lines, because a third of a 360-point screen is about 84
            // points of text and "For scheduling" does not fit on one of them —
            // it arrived on the handset as "For scheduli…".
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10.5,
              height: 1.2,
              fontWeight: FontWeight.w500,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
class _DayRow extends ConsumerWidget {
  const _DayRow({required this.appointment, this.flat = false});

  final Appointment appointment;

  /// No border and no card fill, for when the row is already inside one.
  ///
  /// The check-in sheet is a list of these on a plain surface; drawing each
  /// one's outline there stacks a box inside a box inside a sheet, which is
  /// three frames around one line of text.
  final bool flat;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;
    final (label, tone) = switch (a.status) {
      'checked_in' => (l10n.deskCheckedIn, AppColors.success),
      'in_consultation' => (l10n.deskWithDoctor, AppColors.primary),
      'completed' => (l10n.deskVisitDone, scheme.onSurfaceVariant),
      'no_show' => (l10n.deskNoShow, AppColors.danger),
      _ => (l10n.deskConfirmed, scheme.onSurfaceVariant),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration:
          flat
              ? null
              : BoxDecoration(
                color: scheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(kInnerRadius),
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.4),
                ),
              ),
      child: Row(
        children: [
          SizedBox(
            width: 62,
            child: Text(
              a.scheduledFor == null
                  ? '--'
                  : DateFormat('h:mm a').format(a.scheduledFor!),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  a.patientName ?? 'Patient',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(label, style: TextStyle(fontSize: 12.5, color: tone)),
              ],
            ),
          ),
          // Checking somebody in is the desk's move, and the only one offered
          // here: starting a consultation is the doctor's.
          if (a.status == 'confirmed')
            TextButton(
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                try {
                  await ref
                      .read(appointmentRepositoryProvider)
                      .setStatus(a.id, 'checked_in');
                  ref.invalidate(appointmentDiaryProvider);
                } on ApiException catch (e) {
                  messenger.showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
              child: Text(l10n.deskCheckIn),
            ),
        ],
      ),
    );
  }
}


/// Who is actually coming in today.
///
/// Compact when empty on purpose. The old empty state was a 46-point icon and
/// two lines of centred text inside 36 points of vertical padding, which gave
/// the least informative moment of the day the largest block on the screen —
/// and pushed everything a receptionist could actually do below the fold.
class _AppointmentsCard extends ConsumerWidget {
  const _AppointmentsCard({required this.today});

  /// Today's appointments with cancellations already dropped.
  final List<Appointment> today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardHeader(
            title: l10n.deskTodaysAppointments,
            actionLabel: l10n.deskViewCalendar,
            onAction: () => context.push('/staff/appointments'),
          ),
          const SizedBox(height: AppSpacing.sm + 4),
          if (today.isEmpty)
            Container(
              padding: const EdgeInsets.all(AppSpacing.sm + 4),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(kInnerRadius),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.event_busy_outlined,
                    size: 30,
                    color: AppColors.primary.withValues(alpha: 0.45),
                  ),
                  const SizedBox(width: AppSpacing.sm + 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          l10n.deskNoAppointmentsScheduled,
                          style: const TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          l10n.deskNothingBookedBody,
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
            )
          else
            for (final a in today) _DayRow(appointment: a),
          const SizedBox(height: AppSpacing.sm + 2),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              // A walk-in is a patient at the window with no appointment, so
              // this is the ordinary booking flow with the time defaulted to
              // now — not a separate kind of record the rest of the app would
              // then have to know about.
              onPressed: () => startDeskBooking(context, ref, walkIn: true),
              icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
              label: Text(l10n.deskAddWalkIn),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primary,
                minimumSize: const Size(0, AppSpacing.minTapTarget),
                side: BorderSide(
                  color: AppColors.primary.withValues(alpha: 0.35),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(kInnerRadius),
                ),
                textStyle: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The four things a receptionist does that are not on this screen already.
class _QuickActionsCard extends ConsumerWidget {
  const _QuickActionsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // The same number the bell is counting, from the same endpoint.
    //
    // This used to sum `unreadCount` across the patient roll — a different
    // query, cached separately, that nothing invalidated when a message was
    // read. The tile and the bell could disagree by a wide margin while sitting
    // two inches apart, and the tile was usually the stale one.
    final unread = ref.watch(clinicianNotificationsProvider).valueOrNull?.messages;

    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardHeader(title: l10n.deskQuickActions),
          const SizedBox(height: AppSpacing.sm + 4),
          Row(
            children: [
              Expanded(
                child: _ActionTile(
                  icon: Icons.person_add_alt_1_rounded,
                  tone: AppColors.primary,
                  title: l10n.deskRegisterPatient,
                  caption: l10n.deskAddNewPatient,
                  onTap: () => context.push('/staff/patients/new'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _ActionTile(
                  icon: Icons.event_available_rounded,
                  tone: AppColors.warningOn(context),
                  title: l10n.deskNewAppointment,
                  caption: l10n.deskBookAppointment,
                  onTap: () => startDeskBooking(context, ref),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: _ActionTile(
                  icon: Icons.how_to_reg_rounded,
                  tone: AppColors.successOn(context),
                  title: l10n.deskCheckInPatient,
                  caption: l10n.deskWalkInCheckIn,
                  onTap: () => showCheckInSheet(context),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _ActionTile(
                  icon: Icons.forum_rounded,
                  tone: const Color(0xFF7C5CD6),
                  title: l10n.deskMessagesLabel,
                  // Null while it loads rather than a confident zero that turns
                  // into 3 a second later.
                  caption:
                      unread == null ? '—' : l10n.deskUnreadCount(unread),
                  // `go`, not `push`: Patients is one of this shell's own tabs,
                  // and pushing it stacks a copy while the bar keeps Today lit.
                  onTap: () => context.go('/staff/patients'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.tone,
    required this.title,
    required this.caption,
    required this.onTap,
  });

  final IconData icon;
  final Color tone;
  final String title;
  final String caption;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(kInnerRadius),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(kInnerRadius),
        child: Container(
          padding: const EdgeInsets.fromLTRB(11, 10, 11, 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(kInnerRadius),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
          ),
          // Icon above the words, not beside them.
          //
          // Beside them, a half-width tile on a 360-point handset leaves about
          // 95 points for text once the padding and the icon have taken theirs,
          // and "Register patient" became "Register pa…". Stacked, the label
          // gets the tile's full width and two lines if it wants them — which
          // also gives translations somewhere to go, since the Bengali for
          // "Walk-in check-in" is not going to be shorter.
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, size: 17, color: tone),
              ),
              const SizedBox(height: 9),
              Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.2,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                caption,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  height: 1.25,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// How the day went, once it has gone.
///
/// Deliberately last. These are the numbers a receptionist is asked for at
/// closing time or by the doctor on Monday, not the ones they work from — and
/// the previous layout had a version of them third from the top, above the
/// patient who was waiting for a time.
class _ClinicSummaryCard extends ConsumerStatefulWidget {
  const _ClinicSummaryCard({required this.today, required this.requests});

  final List<Appointment> today;
  final List<Appointment> requests;

  @override
  ConsumerState<_ClinicSummaryCard> createState() => _ClinicSummaryCardState();
}

class _ClinicSummaryCardState extends ConsumerState<_ClinicSummaryCard> {
  bool _week = false;

  /// The same record shape the screen above builds for today, so asking for
  /// today here hits the provider that is already loaded rather than fetching
  /// the day a second time — records compare by value, which is what makes the
  /// family key match.
  AppointmentQuery get _query {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    if (!_week) {
      return (
        from: start,
        to: start.add(const Duration(days: 1)),
        status: null,
        clinicId: null,
      );
    }
    // Monday to now. Not a rolling seven days: "this week" is the week the
    // clinic is in, and a Monday morning total that still counts last
    // Wednesday would be the wrong answer to the question being asked.
    final monday = start.subtract(Duration(days: start.weekday - 1));
    return (
      from: monday,
      to: start.add(const Duration(days: 1)),
      status: null,
      clinicId: null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    // Today comes from the parent, which already has it; a week is fetched.
    final async = ref.watch(appointmentDiaryProvider(_query));
    final rows = _week ? async.valueOrNull?.items : widget.today;
    final loading = rows == null;

    int count(bool Function(Appointment) test) =>
        rows == null ? 0 : rows.where(test).length;

    final completed = count((a) => a.status == 'completed');
    final cancelled = count((a) => a.status == 'cancelled');
    final noShow = count((a) => a.status == 'no_show');
    // Everyone who actually came through the door: checked in, with the doctor,
    // or finished. Not the size of the diary — a booking nobody kept is not a
    // visitor, and counting it as one would quietly inflate every day's total.
    final visitors = count(
      (a) =>
          a.status == 'checked_in' ||
          a.status == 'in_consultation' ||
          a.status == 'completed',
    );

    String n(int v) => loading ? '—' : '$v';

    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.bar_chart_rounded, size: 17, color: AppColors.primary),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  l10n.deskClinicSummary,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 16.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              _RangeToggle(
                week: _week,
                onChanged: (v) => setState(() => _week = v),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: _SummaryFigure(
                    value: n(completed),
                    label: l10n.deskCompleted,
                  ),
                ),
                _SummaryDivider(scheme: scheme),
                Expanded(
                  child: _SummaryFigure(
                    value: n(cancelled),
                    label: l10n.deskCancelled,
                  ),
                ),
                _SummaryDivider(scheme: scheme),
                Expanded(
                  child: _SummaryFigure(
                    value: n(noShow),
                    label: l10n.deskNoShows,
                  ),
                ),
                _SummaryDivider(scheme: scheme),
                Expanded(
                  child: _SummaryFigure(
                    value: n(visitors),
                    label: l10n.deskTotalVisitors,
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

class _SummaryDivider extends StatelessWidget {
  const _SummaryDivider({required this.scheme});

  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) => VerticalDivider(
    width: 1,
    thickness: 1,
    color: scheme.outlineVariant.withValues(alpha: 0.55),
  );
}

class _SummaryFigure extends StatelessWidget {
  const _SummaryFigure({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          maxLines: 1,
          style: const TextStyle(
            fontSize: 21,
            height: 1.1,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11,
            height: 1.2,
            fontWeight: FontWeight.w500,
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// Today, or the week so far.
class _RangeToggle extends StatelessWidget {
  const _RangeToggle({required this.week, required this.onChanged});

  final bool week;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: () => onChanged(!week),
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.fromLTRB(11, 5, 7, 5),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.7),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                week ? l10n.rangeThisWeek : l10n.deskToday,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 2),
              Icon(
                Icons.expand_more_rounded,
                size: 15,
                color: scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Book somebody in from the desk: choose the patient, then the slot.
///
/// The server has always accepted a `patientId` from a non-patient caller —
/// only the app had no way to send one, so the front desk could confirm a
/// request a patient had made but could not take a booking over the phone. That
/// is most of a receptionist's day, and it was the one thing this panel could
/// not do.
///
/// Patient first, because the desk is nearly always looking at a person: the
/// caller on the line, or the face at the window. Slot second, reusing the same
/// picker that confirms a request, so a booking made here obeys exactly the
/// same clinic hours and clash rules as one made anywhere else.
Future<void> startDeskBooking(
  BuildContext context,
  WidgetRef ref, {
  bool walkIn = false,
}) async {
  final l10n = AppLocalizations.of(context);
  final locale = Localizations.localeOf(context).toString();
  final messenger = ScaffoldMessenger.of(context);

  final patient = await showModalBottomSheet<PatientListItem>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _PatientPickerSheet(),
  );
  if (patient == null || !context.mounted) return;

  final clinics = await ref.read(clinicRepositoryProvider).list();
  final open = clinics.where((c) => c.isActive).toList();
  if (!context.mounted) return;
  if (open.isEmpty) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.deskNoActiveClinic)));
    return;
  }

  final picked = await showModalBottomSheet<({Clinic clinic, DateTime at})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    // A walk-in is standing there now, so the picker opens on today. So does a
    // phone booking, which is only a default — the desk can page forward.
    builder: (_) => SlotPicker(clinics: open, initialDay: DateTime.now()),
  );
  if (picked == null || !context.mounted) return;

  try {
    await ref
        .read(appointmentRepositoryProvider)
        .book(
          clinicId: picked.clinic.id,
          scheduledForIso: picked.at.toUtc().toIso8601String(),
          patientId: patient.id,
        );
    // The whole family, not one query: a booking lands in today's diary, in the
    // week the summary may be showing, and changes nothing about the requests
    // list — naming them individually is how one of them gets forgotten.
    ref.invalidate(appointmentDiaryProvider);
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          '${patient.name} · '
          '${l10n.deskConfirmedFor(DateFormat('EEE d MMM, h:mm a', locale).format(picked.at))}',
        ),
      ),
    );
  } on ApiException catch (e) {
    // The server re-checks the slot, so "just taken" arrives here rather than
    // being something this screen could have prevented.
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

/// Choose a patient by name or phone.
class _PatientPickerSheet extends ConsumerStatefulWidget {
  const _PatientPickerSheet();

  @override
  ConsumerState<_PatientPickerSheet> createState() =>
      _PatientPickerSheetState();
}

class _PatientPickerSheetState extends ConsumerState<_PatientPickerSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  String _search = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    // Debounced: the roll is a network query, and firing one per keystroke
    // makes a busy clinic's list flicker between stale answers.
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 280), () {
      if (mounted) setState(() => _search = v.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(
      patientsProvider((
        riskBand: null,
        search: _search.isEmpty ? null : _search,
        sort: 'name',
      )),
    );

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.deskChoosePatient,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: AppSpacing.sm + 4),
          TextField(
            controller: _controller,
            onChanged: _onChanged,
            autofocus: true,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: l10n.deskSearchPatients,
              prefixIcon: const Icon(Icons.search_rounded),
              filled: true,
              fillColor: scheme.surfaceContainerLowest,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(kInnerRadius),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            height: 320,
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error:
                  (e, _) => Center(
                    child: Text(
                      e is ApiException ? e.message : l10n.deskCouldNotLoadTimes,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  ),
              data: (page) {
                if (page.items.isEmpty) {
                  return Center(
                    child: Text(
                      l10n.deskNoPatientsFound,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  );
                }
                return ListView.builder(
                  itemCount: page.items.length,
                  itemBuilder: (_, i) {
                    final p = page.items[i];
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: UserAvatar(
                        name: p.name,
                        avatarUrl: p.avatarUrl,
                        accent: AppColors.primary,
                        size: 40,
                      ),
                      title: Text(
                        p.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Text(p.phone),
                      onTap: () => Navigator.pop(context, p),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Check in whoever has just arrived.
///
/// Every row on today's list already carries its own check-in button, and this
/// is the same action reached the other way round — from "somebody is at the
/// window" rather than from "here is the diary". A receptionist with a queue in
/// front of them should not have to find the right row first.
Future<void> showCheckInSheet(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => const _CheckInSheet(),
);

class _CheckInSheet extends ConsumerWidget {
  const _CheckInSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final async = ref.watch(
      appointmentDiaryProvider((
        from: start,
        to: start.add(const Duration(days: 1)),
        status: null,
        clinicId: null,
      )),
    );

    // Only people who are booked and have not arrived. Someone already checked
    // in cannot be checked in twice, and offering it would let the desk undo
    // the doctor's "in consultation" by accident.
    final waiting =
        (async.valueOrNull?.items ?? const <Appointment>[])
            .where((a) => a.status == 'confirmed')
            .toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.deskCheckInPatient,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: AppSpacing.sm + 4),
          if (async.isLoading && async.valueOrNull == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (waiting.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Center(
                child: Text(
                  l10n.deskNobodyToCheckIn,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          else
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: waiting.length,
                itemBuilder:
                    (_, i) => _DayRow(appointment: waiting[i], flat: true),
              ),
            ),
        ],
      ),
    );
  }
}
