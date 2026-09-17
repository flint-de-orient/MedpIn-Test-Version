import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/data/appointment_repository.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../appointments/domain/clinic.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../clinician/domain/clinician_models.dart';
import '../../clinician/presentation/clinician_providers.dart';
import '../../clinician/presentation/widgets/inbox_states.dart';
import '../domain/desk_day.dart';
import 'desk_providers.dart';
import 'widgets/desk_header.dart';
import 'widgets/desk_sections.dart';
import 'widgets/request_card.dart';

/// The front desk's day.
///
/// It answers what a receptionist asks, in the order they ask it: is anybody
/// in trouble; who is coming in next; who is already here; who is waiting on
/// us for a time; who has written. Above all of it are the three things the
/// desk starts rather than reads — register, book, walk-in — with one of them
/// filled, because a row of equal pills has no primary action.
///
/// ---- Four states, never confused -----------------------------------------
///
/// Loading, failed, empty and answered each look like themselves. The screen
/// this replaced drew "0 Scheduled, 0 Waiting, 0 Freed up" and "No
/// appointments scheduled" while the diary was still on its way and again when
/// it failed to arrive, so a receptionist could tell a patient at the counter
/// that there was no booking when the phone simply had no signal. A section
/// with no answer yet is a grey shape; a section whose answer failed says so;
/// and "nothing is waiting" is said once, only when every source has answered.
///
/// A refresh that fails keeps what was on screen. The desk re-reads every
/// fifteen seconds, and a dropped connection used to be one tick away from
/// blanking the whole day; now the last answer stays, with a line saying when
/// it arrived and a way to try again.
class StaffTodayScreen extends ConsumerStatefulWidget {
  const StaffTodayScreen({super.key});

  @override
  ConsumerState<StaffTodayScreen> createState() => _StaffTodayScreenState();
}

/// Where one source's answer stands.
enum _Stand { loading, failed, stale, ready }

_Stand _standOf(AsyncValue<Object?> v) {
  if (v.hasValue) return v.hasError ? _Stand.stale : _Stand.ready;
  return v.hasError ? _Stand.failed : _Stand.loading;
}

class _StaffTodayScreenState extends ConsumerState<StaffTodayScreen> {
  final _loadedAt = LoadedAt();

  /// Everything this screen counts, re-read together.
  ///
  /// The families go whole rather than query by query. Listing them by hand is
  /// how a card ends up refreshing everything on screen except itself.
  void _reload(WidgetRef ref) {
    ref.invalidate(appointmentDiaryProvider);
    ref.invalidate(clinicianNotificationsProvider);
    ref.invalidate(deskCountProvider);
    ref.invalidate(pendingEnrolmentsProvider);
  }

  Future<void> _refresh() async => _reload(ref);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final now = DateTime.now();

    final todayAsync = ref.watch(
      appointmentDiaryProvider(DeskQueries.today(now)),
    );
    final requestsAsync = ref.watch(
      appointmentDiaryProvider(DeskQueries.requests),
    );
    final feedAsync = ref.watch(clinicianNotificationsProvider);

    _loadedAt
      ..note('today', todayAsync)
      ..note('requests', requestsAsync)
      ..note('feed', feedAsync);

    final todayStand = _standOf(todayAsync);
    final requestsStand = _standOf(requestsAsync);
    final feedStand = _standOf(feedAsync);

    // A value survives a failed refresh — Riverpod keeps the last answer
    // beside the error — and is used as it stands, marked stale.
    final todayItems = todayAsync.valueOrNull?.items;
    final day = todayItems == null ? null : DeskDay.from(todayItems, now: now);
    final requestItems = requestsAsync.valueOrNull?.items;
    final requests =
        requestItems == null ? null : requestsLongestWaitingFirst(requestItems);
    final feedView = feedAsync.valueOrNull;
    final feed = feedView == null ? null : DeskFeed.from(feedView.items);
    final urgent = feed?.urgent ?? const [];

    // One notice for however many sources a dropped connection left stale,
    // dated by the oldest of them. Three "Could not refresh" boxes for one
    // lost signal was the same sentence three times down the page.
    final staleSince = [
      if (feedStand == _Stand.stale) _loadedAt['feed'],
      if (todayStand == _Stand.stale) _loadedAt['today'],
      if (requestsStand == _Stand.stale) _loadedAt['requests'],
    ];
    final anyStale = staleSince.isNotEmpty;
    final oldest =
        staleSince.contains(null) || staleSince.isEmpty
            ? null
            : staleSince.cast<DateTime>().reduce(
              (a, b) => a.isBefore(b) ? a : b,
            );

    // Nothing arrived from anywhere: one message, not one per section. Four
    // stacked "Could not load" boxes say the same thing four times and push
    // the one useful control — Retry — below the fold.
    final nothingArrived =
        todayStand == _Stand.failed &&
        requestsStand == _Stand.failed &&
        feedStand == _Stand.failed;

    // Said only when every source has answered, and answered with nothing.
    final caughtUp =
        todayStand == _Stand.ready &&
        requestsStand == _Stand.ready &&
        feedStand == _Stand.ready &&
        urgent.isEmpty &&
        requests!.isEmpty &&
        feedView!.messages == 0;

    const gap = SizedBox(height: T.s4);

    final sections = <Widget>[
      if (nothingArrived)
        LoadFailed(what: 'today’s desk', onRetry: _refresh)
      else ...[
        // The feed is where urgent reports come from, so its failure is said
        // first: a screen showing no red card cannot also be saying that
        // nobody reported anything.
        if (feedStand == _Stand.failed) ...[
          LoadFailed(
            what: 'urgent reports and messages',
            compact: true,
            onRetry: () => ref.invalidate(clinicianNotificationsProvider),
          ),
          gap,
        ],
        if (anyStale) ...[
          StaleNotice(
            title: l10n.deskStaleTitle,
            detail:
                oldest == null
                    ? l10n.deskStaleEarlier
                    : l10n.deskStaleAt(clockTime(context, oldest)),
            retryLabel: l10n.commonRetry,
            onRetry: _refresh,
          ),
          gap,
        ],
        if (urgent.isNotEmpty) ...[
          DeskUrgentCard(items: urgent, now: now),
          gap,
        ],

        // Who is coming in: the desk's first question on any ordinary morning.
        if (todayStand == _Stand.loading)
          DeskLoadingCard(
            title: l10n.deskComingInToday,
            icon: Icons.event_note_rounded,
          )
        else
          DeskComingInCard(
            day: day,
            now: now,
            notice:
                todayStand == _Stand.failed
                    ? LoadFailed(
                      what: 'today’s appointments',
                      compact: true,
                      onRetry: _refresh,
                    )
                    : null,
          ),
        gap,
        if (day != null && day.inClinic.isNotEmpty) ...[
          DeskInClinicCard(appointments: day.inClinic),
          gap,
        ],

        // The call-backs.
        if (requestsStand == _Stand.failed) ...[
          LoadFailed(
            what: 'appointment requests',
            compact: true,
            onRetry: _refresh,
          ),
          gap,
        ],
        if (requests != null && requests.isNotEmpty) ...[
          DeskRequestsCard(requests: requests, onChanged: _refresh),
          gap,
        ],
        const DeskWaitingOnCodeCard(),

        if (feedView != null && feedView.messages > 0) ...[
          DeskMessagesCard(
            total: feedView.messages,
            threads: feed!.threads,
            now: now,
          ),
          gap,
        ],

        if (caughtUp) ...[const DeskCaughtUp(), const SizedBox(height: T.s6)],

        // Last: the numbers a receptionist is asked for at closing time, not
        // the ones they work from.
        DeskWeekCard(now: now),
      ],
    ];

    return Scaffold(
      backgroundColor: Colors.transparent,
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
              padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s8),
              children: [
                DeskHeader(onRefresh: _refresh),
                const SizedBox(height: T.s5),
                DeskActions(
                  demoted: urgent.isNotEmpty,
                  onRegister: () => context.push('/staff/patients/new'),
                  onBook: () => startDeskBooking(context, ref),
                  // A walk-in is a patient at the window with no appointment,
                  // so this is the ordinary booking flow opening on today —
                  // not a separate kind of record the rest of the app would
                  // then have to know about.
                  onWalkIn: () => startDeskBooking(context, ref, walkIn: true),
                ),
                const SizedBox(height: T.s6),
                ...sections,
              ],
            ),
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
    final PatientsQuery query = (
      riskBand: null,
      search: _search.isEmpty ? null : _search,
      sort: 'name',
      pages: 1,
    );
    final async = ref.watch(patientsProvider(query));

    return Padding(
      padding: EdgeInsets.only(
        left: T.s4,
        right: T.s4,
        bottom: MediaQuery.viewInsetsOf(context).bottom + T.s4,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.deskChoosePatient, style: T.title.copyWith(color: T.ink)),
          const SizedBox(height: T.s3),
          TextField(
            controller: _controller,
            onChanged: _onChanged,
            autofocus: true,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: l10n.deskSearchPatients,
              prefixIcon: const Icon(Icons.search_rounded),
            ),
          ),
          const SizedBox(height: T.s2),
          // A share of the screen rather than a fixed 320 points, which on a
          // short phone with the keyboard up left the list a sliver.
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.4,
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              // The failure is the list's. This used to say "Could not load
              // the times for this day" — a sentence from the slot picker, on
              // the screen before any day had been chosen.
              error:
                  (e, _) => Align(
                    alignment: Alignment.topCenter,
                    child: LoadFailed(
                      what: 'the patient list',
                      compact: true,
                      onRetry: () => ref.invalidate(patientsProvider(query)),
                    ),
                  ),
              data: (page) {
                if (page.items.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.only(top: T.s4),
                    child: Text(
                      l10n.deskNoPatientsFound,
                      textAlign: TextAlign.center,
                      style: T.body.copyWith(color: T.inkMuted),
                    ),
                  );
                }
                return ListView.builder(
                  itemCount: page.items.length,
                  itemBuilder: (_, i) {
                    final p = page.items[i];
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      minVerticalPadding: T.s2,
                      leading: UserAvatar(
                        name: p.name,
                        avatarUrl: p.avatarUrl,
                        accent: T.primary,
                        size: T.s8 + T.s2,
                      ),
                      title: Text(
                        p.name,
                        style: T.bodyStrong.copyWith(color: T.ink),
                      ),
                      subtitle: Text(
                        p.phone,
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
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
