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
import '../../appointments/presentation/appointment_providers.dart';
import '../../clinician/presentation/clinician_providers.dart';
import '../../clinician/presentation/widgets/panel_ui.dart';
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
    ref.invalidate(appointmentDiaryProvider(_requests));
    ref.invalidate(appointmentDiaryProvider(_today));
    ref.invalidate(clinicianNotificationsProvider);
  }

  Future<void> _refresh() async => _reload(ref);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final requests =
        ref.watch(appointmentDiaryProvider(_requests)).valueOrNull?.items ??
        const <Appointment>[];
    // Requests are already excluded from the day: they have no scheduledFor, so
    // a date-ranged query cannot match them. Cancelled ones are dropped because
    // the desk is looking at who is coming.
    final today =
        (ref.watch(appointmentDiaryProvider(_today)).valueOrNull?.items ??
                const <Appointment>[])
            .where((a) => a.status != 'cancelled')
            .toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    return Scaffold(
      backgroundColor: Colors.transparent,
      // Registering a walk-in is the desk's commonest job, so it stays one tap
      // away — as a button that owns its own corner rather than one crammed
      // into the header, where it took the whole width and left the date and
      // the clinic name a column of single letters.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/staff/patients/new'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: Text(l10n.deskRegister),
      ),
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
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm,
                AppSpacing.md,
                96,
              ),
              children: [
                const _DeskHeader(),
                const SizedBox(height: AppSpacing.md),

                // The shape of the patient's home screen, for the same reason it
                // has that shape: one card that answers "what is happening", a
                // rail of numbers under it, then the lists.
                //
                // A quiet morning used to render as a single empty box on a page
                // of nothing, which reads as an app that has failed rather than
                // a day that has not started. The hero and the rail are true on
                // an empty day too — no appointments is a fact about the day,
                // and the desk still wants the other two numbers.
                // Above everything, when there is one.
                //
                // A patient writing "I have chest pain" already pushes to this
                // handset — the desk is on that fan-out deliberately, because the
                // receptionist is the person physically present and what happens
                // next is fetching the doctor or ringing the patient back. The
                // push arrived, and the screen behind it said "No appointments"
                // with nothing anywhere about the emergency.
                const _EmergencyStrip(),

                _DayHero(today: today, requests: requests),
                const SizedBox(height: AppSpacing.md),
                _DeskRail(today: today, requests: requests),
                const SizedBox(height: AppSpacing.lg),

                if (requests.isNotEmpty) ...[
                  _SectionTitle(
                    l10n.deskWaitingForTime,
                    count: requests.length,
                    tone: AppColors.warning,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  for (final a in requests)
                    _RequestCard(appointment: a, onConfirmed: _refresh),
                  const SizedBox(height: AppSpacing.lg),
                ],

                _SectionTitle(l10n.deskToday, count: today.length),
                const SizedBox(height: AppSpacing.sm),
                if (today.isEmpty)
                  _Empty(
                    icon: Icons.event_available_outlined,
                    title: l10n.deskNothingBooked,
                    body: l10n.deskNothingBookedBody,
                  )
                else
                  for (final a in today) _DayRow(appointment: a),
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
    final scheme = Theme.of(context).colorScheme;
    // The date reads in the chosen language too. DateFormat with no locale
    // argument uses Intl's global default, which is not what MaterialApp's
    // locale sets — so the day name would stay English while the words around
    // it changed, which looks like a half-finished translation.
    final locale = Localizations.localeOf(context).toString();
    // The day, then whose clinic this is, then the bell.
    //
    // Register used to sit here, and is now the button in the corner. It is
    // the desk's commonest job, but a header is for saying where you are and
    // what is waiting — and a filled button in one takes the whole width from
    // whatever it shares the row with.
    //
    // The mark and the name come from [ClinicWordmark], the same widget every
    // other panel uses. This drew its own square mark beside its own copy of
    // the name, which is how the name ended up wrapped to two truncated lines
    // next to a logo squeezed into 44 points.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                DateFormat('EEEE, d MMMM', locale).format(DateTime.now()),
                style: TextStyle(
                  fontSize: 13,
                  height: 1.3,
                  fontWeight: FontWeight.w500,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 4),
              ClinicWordmark(
                subtitle: AppLocalizations.of(context).deskFrontDesk,
              ),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        // The same bell the doctor has. What reaches it differs by role — the
        // desk is told about requests and messages, not about a patient's
        // HbA1c — but the control is one control.
        PanelNotificationBell(onTap: () => showClinicianNotifications(context)),
      ],
    );
  }
}

/// Open emergencies, at the top of the desk's day.
///
/// Only urgent and emergency severities reach a staff account — the server
/// filters, see `DESK_ALERTS`. So everything drawn here is something a
/// receptionist can act on in the next minute, and the row leads to the thread
/// because that is where the call button is.
///
/// Nothing is drawn when there is nothing. An empty "Emergencies" heading on a
/// quiet morning is a heading that stops being read by the time it matters.
class _EmergencyStrip extends ConsumerWidget {
  const _EmergencyStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(clinicianNotificationsProvider).valueOrNull;
    final urgent =
        (view?.items ?? const <PanelNotification>[])
            .where((i) => i.kind == 'urgent')
            .toList();
    if (urgent.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.emergency_rounded,
                size: 18,
                color: AppColors.dangerOn(context),
              ),
              const SizedBox(width: 6),
              Text(
                AppLocalizations.of(context).deskNeedsAttention(urgent.length),
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.dangerOn(context),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final a in urgent)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: AppColors.dangerBgOn(context),
                borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                child: InkWell(
                  borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                  onTap:
                      a.patientId.isEmpty
                          ? null
                          : () => context.push(
                            '/staff/patients/${a.patientId}/thread',
                            extra: a.patientName,
                          ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    child: Row(
                      children: [
                        UserAvatar(
                          name: a.patientName,
                          avatarUrl: a.avatarUrl,
                          accent: AppColors.dangerOn(context),
                          size: 40,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                a.patientName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                a.text,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 13,
                                  height: 1.3,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.dangerOn(context),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right_rounded,
                          color: AppColors.dangerOn(context),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// What is happening today, in one card.
///
/// Modelled on the patient's home hero, and for the same reason: the first
/// thing on a screen should answer the question the person opened it with. For
/// a receptionist at nine in the morning that question is "how busy am I, and
/// who is first".
///
/// Drawn rather than photographed. The patient's card carries a photograph
/// because it is the app greeting someone; this one is a working surface that
/// several people share a login to, and a stock photo behind the day's numbers
/// is decoration a desk has to read past.
class _DayHero extends StatelessWidget {
  const _DayHero({required this.today, required this.requests});

  final List<Appointment> today;
  final List<Appointment> requests;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final now = DateTime.now();
    // The next one still to come, not the first of the day: at four in the
    // afternoon the morning's list is history, and a desk told "next: 9:30 AM"
    // has been told something false.
    final upcoming =
        today.where((a) => (a.scheduledFor ?? now).isAfter(now)).toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));
    final next = upcoming.firstOrNull;

    final String headline;
    final String detail;
    if (today.isEmpty) {
      headline = l10n.deskNoAppointments;
      detail =
          requests.isEmpty
              ? l10n.deskQuietDay
              : l10n.deskWaitingForTimeCount(requests.length);
    } else if (next?.scheduledFor != null) {
      headline = l10n.deskAppointmentCount(today.length);
      final at = DateFormat('h:mm a', locale).format(next!.scheduledFor!);
      detail = l10n.deskNextAt(
        next.patientName ?? l10n.deskPatientFallback,
        at,
      );
    } else {
      headline = l10n.deskAppointmentCount(today.length);
      detail = l10n.deskAllPassed;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius + 4),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2C5BE0), Color(0xFF0B2C86)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2E003399),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  l10n.deskToday.toUpperCase(),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    color: Colors.white.withValues(alpha: 0.72),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  headline,
                  style: const TextStyle(
                    fontSize: 26,
                    height: 1.1,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  detail,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.86),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Icon(
            today.isEmpty
                ? Icons.wb_sunny_outlined
                : Icons.event_available_rounded,
            size: 34,
            color: Colors.white.withValues(alpha: 0.32),
          ),
        ],
      ),
    );
  }
}

/// Three numbers the desk is asked for all day.
///
/// Unread is counted across the whole roll rather than shown per patient: the
/// question a receptionist is answering is "is anyone waiting on us", and that
/// is a total. Tapping it opens the inbox, where the per-patient answer is.
class _DeskRail extends ConsumerWidget {
  const _DeskRail({required this.today, required this.requests});

  final List<Appointment> today;
  final List<Appointment> requests;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The same number the bell is counting, from the same endpoint.
    //
    // This used to sum `unreadCount` across the patient roll — a different
    // query, cached separately, that nothing invalidated when a message was
    // read. The tile and the bell could disagree by a wide margin while sitting
    // two inches apart, and the tile was usually the stale one.
    //
    // Null while it loads, and drawn as an em dash: "0 unread" that turns into
    // 4 a second later is worse than admitting it does not know yet.
    final l10n = AppLocalizations.of(context);
    final counts = ref.watch(clinicianNotificationsProvider).valueOrNull;
    final unread = counts?.messages;

    return Row(
      children: [
        Expanded(
          child: _RailTile(
            icon: Icons.event_note_rounded,
            label: l10n.deskBooked,
            value: '${today.length}',
            tone: AppColors.primary,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: _RailTile(
            icon: Icons.hourglass_bottom_rounded,
            label: l10n.deskWaiting,
            value: '${requests.length}',
            tone: requests.isEmpty ? AppColors.primary : AppColors.warning,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: _RailTile(
            icon: Icons.mark_chat_unread_outlined,
            label: l10n.deskUnread,
            value: unread == null ? '—' : '$unread',
            tone: (unread ?? 0) > 0 ? AppColors.danger : AppColors.primary,
            // `go`, not `push`: Patients is one of this shell's own tabs, and
            // pushing it stacks a copy while the bar keeps Today lit.
            onTap: () => context.go('/staff/patients'),
          ),
        ),
      ],
    );
  }
}

class _RailTile extends StatelessWidget {
  const _RailTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.tone,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: AppSpacing.sm,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: tone),
              const SizedBox(height: 6),
              Text(
                value,
                maxLines: 1,
                style: TextStyle(
                  fontSize: 22,
                  height: 1.05,
                  fontWeight: FontWeight.w800,
                  color: tone,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {required this.count, this.tone});

  final String text;
  final int count;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          text,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        const SizedBox(width: 8),
        if (count > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: (tone ?? scheme.onSurfaceVariant).withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: tone ?? scheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

/// A patient who asked for an appointment and has no time yet.
class _RequestCard extends ConsumerStatefulWidget {
  const _RequestCard({required this.appointment, required this.onConfirmed});

  final Appointment appointment;
  final Future<void> Function() onConfirmed;

  @override
  ConsumerState<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<_RequestCard> {
  bool _busy = false;

  /// How long they have been waiting. A request nobody answered for four days
  /// is the one that costs the clinic a patient.
  /// Takes the localisations rather than reaching for a context: this is a
  /// getter on the state, and looking one up is the one thing a getter here
  /// cannot do.
  String _waitedIn(AppLocalizations l10n) {
    final at = widget.appointment.createdAt;
    if (at == null) return '';
    final d = DateTime.now().difference(at);
    if (d.inHours < 1) return l10n.deskAskedAgoMinutes(d.inMinutes);
    if (d.inHours < 24) return l10n.deskAskedAgoHours(d.inHours);
    return l10n.deskAskedAgoDays(d.inDays);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final waited = _waitedIn(l10n);
    final a = widget.appointment;
    final scheme = Theme.of(context).colorScheme;
    final stale =
        (a.createdAt != null &&
            DateTime.now().difference(a.createdAt!).inDays >= 1);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          // Amber once it has been sitting a day. Not red: nobody is unwell,
          // somebody is unanswered.
          color:
              stale
                  ? AppColors.warning.withValues(alpha: 0.55)
                  : scheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UserAvatar(
                name: a.patientName ?? '',
                avatarUrl: null,
                accent: AppColors.primary,
                size: 38,
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
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      [
                        if (a.preferredFor != null)
                          'for ${DateFormat('EEE, d MMM').format(a.preferredFor!)}',
                        if (waited.isNotEmpty) waited,
                      ].join('   '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color:
                            stale ? AppColors.warning : scheme.onSurfaceVariant,
                        fontWeight: stale ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
              if (a.patientPhone != null)
                IconButton(
                  tooltip: l10n.deskCallPatient(a.patientPhone ?? ''),
                  onPressed: () {},
                  icon: Icon(
                    Icons.call_outlined,
                    color: scheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
            ],
          ),
          if ((a.reason ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              a.reason!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          // The same trap as the header, and worse here: a Row of
          // [TextButton, Spacer, FilledButton] where the filled one demands
          // infinite width leaves nothing for the Spacer, and an overflowing
          // Row drops its last child without a word — so "Give a time", the
          // only action on this card that matters, was the one at risk of not
          // being drawn at all.
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : _decline,
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onSurfaceVariant,
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                ),
                child: Text(l10n.deskDecline),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Expanded rather than a Spacer: the action takes the room that
              // is left instead of competing for it, and a longer label in
              // Hindi or Bengali makes the button wider, never the row.
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _pickTime,
                  icon:
                      _busy
                          ? const SizedBox(
                            width: 15,
                            height: 15,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                          : const Icon(Icons.event_available_rounded, size: 18),
                  label: Text(l10n.deskGiveTime),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, AppSpacing.minTapTarget),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(
                        AppSpacing.buttonRadius,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _decline() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(l10n.deskDeclineTitle),
            // The name is not interpolated into the sentence any more: word
            // order round a subject differs by language, and a template with
            // the name welded to the front of an English clause cannot be
            // translated without rewriting it.
            content: Text(l10n.deskDeclineBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(l10n.deskKeepIt),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Decline'),
              ),
            ],
          ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .cancel(widget.appointment.id);
      await widget.onConfirmed();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Choose the clinic, the day and a free slot, then confirm.
  Future<void> _pickTime() async {
    final l10n = AppLocalizations.of(context);
    // Captured before the first await, with the messenger, for the same
    // reason: the sheet and the network call both sit between here and the
    // snackbar, and this widget may be gone by then.
    final locale = Localizations.localeOf(context).toString();
    final messenger = ScaffoldMessenger.of(context);
    final clinics = await ref.read(clinicRepositoryProvider).list();
    final open = clinics.where((c) => c.isActive).toList();
    if (!mounted) return;

    if (open.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.deskNoActiveClinic)));
      return;
    }

    final picked = await showModalBottomSheet<({Clinic clinic, DateTime at})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => _SlotPicker(
            clinics: open,
            // Their preferred day is where the picker opens — the desk is
            // answering a request, not booking from scratch.
            initialDay: widget.appointment.preferredFor,
          ),
    );
    if (picked == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .confirmRequest(
            widget.appointment.id,
            clinicId: picked.clinic.id,
            scheduledFor: picked.at,
          );
      await widget.onConfirmed();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            '${l10n.deskConfirmedFor(DateFormat('EEE d MMM, h:mm a', locale).format(picked.at))} '
            '${l10n.deskPatientTold}',
          ),
        ),
      );
    } on ApiException catch (e) {
      // The server re-checks the slot, so "just taken" arrives here rather
      // than as a double booking.
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// Clinic, day, and one of the free slots the schedule actually offers.
class _SlotPicker extends ConsumerStatefulWidget {
  const _SlotPicker({required this.clinics, this.initialDay});

  final List<Clinic> clinics;
  final DateTime? initialDay;

  @override
  ConsumerState<_SlotPicker> createState() => _SlotPickerState();
}

class _SlotPickerState extends ConsumerState<_SlotPicker> {
  late Clinic _clinic = widget.clinics.first;
  late DateTime _day = _atLeastToday(widget.initialDay ?? DateTime.now());

  static DateTime _atLeastToday(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final asked = DateTime(d.year, d.month, d.day);
    // A request for a day that has since passed opens on today rather than in
    // the past, where there is nothing to offer.
    return asked.isBefore(today) ? today : asked;
  }

  String get _dayKey => DateFormat('yyyy-MM-dd').format(_day);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final slots = ref.watch(
      slotDayProvider((clinicId: _clinic.id, date: _dayKey)),
    );

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      maxChildSize: 0.95,
      builder:
          (ctx, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.lg,
            ),
            children: [
              Text(
                l10n.deskGiveTime,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                l10n.deskOnlyAvailable,
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.md),

              if (widget.clinics.length > 1) ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final c in widget.clinics)
                      ChoiceChip(
                        label: Text(c.name),
                        selected: c.id == _clinic.id,
                        onSelected: (_) => setState(() => _clinic = c),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
              ],

              Row(
                children: [
                  Expanded(
                    child: Text(
                      DateFormat('EEEE, d MMMM').format(_day),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () async {
                      final now = DateTime.now();
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _day,
                        firstDate: DateTime(now.year, now.month, now.day),
                        lastDate: now.add(const Duration(days: 120)),
                      );
                      if (d != null) setState(() => _day = d);
                    },
                    icon: const Icon(Icons.calendar_today_rounded, size: 16),
                    label: Text(l10n.deskChange),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),

              slots.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Text(
                        l10n.deskCouldNotLoadTimes,
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    ),
                data: (day) {
                  final free = day.slots.where((s) => s.available).toList();
                  if (free.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 28),
                      child: Column(
                        children: [
                          Icon(
                            Icons.event_busy_outlined,
                            size: 40,
                            color: scheme.outlineVariant,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            l10n.deskNoFreeTimes,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            l10n.deskTryAnotherDay,
                            style: TextStyle(
                              fontSize: 13,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in free)
                        ActionChip(
                          label: Text(s.time),
                          onPressed:
                              () => Navigator.pop(ctx, (
                                clinic: _clinic,
                                at: DateTime.parse(s.iso).toLocal(),
                              )),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
    );
  }
}

/// One booked appointment in today's list.
class _DayRow extends ConsumerWidget {
  const _DayRow({required this.appointment});

  final Appointment appointment;

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
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
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

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36),
      child: Column(
        children: [
          Icon(icon, size: 46, color: scheme.outlineVariant),
          const SizedBox(height: AppSpacing.sm),
          Text(
            title,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
