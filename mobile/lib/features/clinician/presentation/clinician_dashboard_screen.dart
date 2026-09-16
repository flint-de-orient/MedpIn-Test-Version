import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../auth/presentation/auth_controller.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/panel_ui.dart';
import 'widgets/clinician_notification_sheet.dart';
import '../../../core/theme/tokens.dart';
import 'widgets/triage_queue.dart';
import '../../../shared/widgets/clinic_brand.dart';
import 'widgets/chat_summary_card.dart';
import 'widgets/caseload_panels.dart';
import 'widgets/dashboard_registry.dart';
import '../../../core/capabilities/capabilities.dart';

/// The doctor's home: the clinic at a glance — headline counts, what is on
/// today, the alerts that need attention, the live triage queue, and the
/// nutrition reviews coming due.
///
/// Every number is live: pulled from the API and refreshed on a timer, on
/// resume, and on pull-to-refresh, so it is never stale while the doctor is
/// looking at it.
class ClinicianDashboardScreen extends ConsumerStatefulWidget {
  const ClinicianDashboardScreen({super.key});

  @override
  ConsumerState<ClinicianDashboardScreen> createState() =>
      _ClinicianDashboardScreenState();
}

/// The panels that have something to draw, with one gap between each pair.
///
/// Nulls dropped before the spacing is worked out, so a panel still waiting on
/// its data takes its gap with it rather than leaving a hole where it will be.
/// And no gap after the last one: it would sit on top of the list's own bottom
/// padding and end the screen in 72px of nothing.
List<Widget> _spaced(List<Widget?> panels) {
  final present = panels.whereType<Widget>().toList(growable: false);
  return [
    for (var i = 0; i < present.length; i++) ...[
      present[i],
      if (i != present.length - 1) const SizedBox(height: T.s6),
    ],
  ];
}

class _ClinicianDashboardScreenState
    extends ConsumerState<ClinicianDashboardScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  /// When the data on screen was last pulled. The triage queue says this out
  /// loud — a queue calling itself live owes the reader the time it was true.
  DateTime _lastRefreshed = DateTime.now();

  /// The snapshot's window, in days. Fourteen by default: long enough for a
  /// trend to mean something, short enough that a change last week still shows.
  int _days = 14;

  AlertsQuery get _alertsQuery => (status: 'open', severity: null);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Live updates: re-pull every 20s so a new message, a resolved alert or a
    // checked-in patient shows without any manual refresh.
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refresh();
      _refreshConversations();
    }
  }

  void _refresh() {
    if (mounted) setState(() => _lastRefreshed = DateTime.now());
    ref.invalidate(overviewProvider);
    ref.invalidate(clinicAnalyticsProvider(_days));
    ref.invalidate(attentionPatientsProvider);
    ref.invalidate(alertsProvider(_alertsQuery));
    // Only meaningful when a lab panel is on screen; invalidating a provider
    // nobody is watching does nothing, which is cheaper than deciding here
    // whether it is.
    ref.invalidate(labOverviewProvider(_days));
  }

  /// The day's conversation summaries: on return to the app and on pull only.
  ///
  /// Not on the twenty-second poll. The list reads every conversation of the
  /// day and may have the assistant summarise each patient whose day moved on,
  /// and a summary changes when a patient writes, not three times a minute. A
  /// doctor coming back to the app, or pulling down, is asking for it.
  void _refreshConversations() {
    ref.invalidate(chatSummariesProvider(ChatSummaryCard.query));
    // The caseload panels refresh on the same slower rhythm — see providers.
    ref.invalidate(bpControlProvider(BpControlCard.days));
    ref.invalidate(followUpsProvider(FollowUpsDueCard.days));
    ref.invalidate(conditionRegisterProvider);
    ref.invalidate(heartRateFlagsProvider(HeartRateFlagsCard.days));
    ref.invalidate(ecgPanelProvider(RecentEcgsCard.days));
    ref.invalidate(lipidControlProvider(LipidControlCard.days));
  }

  @override
  Widget build(BuildContext context) {
    // valueOrNull, not .when: on a timer refresh the provider briefly re-enters
    // loading, and reading the last value keeps the screen from flashing a
    // spinner every twenty seconds.
    final overview = ref.watch(overviewProvider).valueOrNull;
    final analytics = ref.watch(clinicAnalyticsProvider(_days)).valueOrNull;
    final attention =
        ref.watch(attentionPatientsProvider).valueOrNull ??
        const <PatientListItem>[];
    final alerts =
        ref.watch(alertsProvider(_alertsQuery)).valueOrNull?.items ?? const [];
    final loading = overview == null && ref.watch(overviewProvider).isLoading;

    /*
     * What this person's home screen is made of, as the server works it out.
     *
     * `Capabilities.unknown` while the answer is in flight, and its `ui` is
     * null — so the fallback below is the general clinical set rather than an
     * empty screen. That is the same rule the rest of this file follows and
     * the same one the server follows: unknown does not narrow.
     *
     * The fallback is deliberately short. A long one here would be a second
     * copy of `uiConfig.js`'s default, drifting from it, and the screen it
     * produces would be the one somebody sees for the half-second before the
     * real answer lands — so it holds what every practice has and nothing that
     * depends on a plan.
     */
    final caps = ref.watch(capabilitySetProvider);
    final widgets =
        caps.ui?.widgets ??
        const ['TRIAGE_QUEUE', 'TODAYS_CLINIC', 'OPEN_ALERTS'];
    final actions = caps.ui?.quickActions ?? const <String>[];

    /*
     * Fetched only when something on this screen will draw it.
     *
     * Most practices show no lab panel, and a request on every refresh for
     * something nobody is looking at is a query per doctor per twenty seconds
     * for nothing. `watch` inside the condition is safe here because the
     * condition itself comes from a watched provider: when the dashboard
     * changes shape, this rebuilds and the subscription follows it.
     */
    final wantsLabs = needsLabOverview(widgets);
    final labs = wantsLabs ? ref.watch(labOverviewProvider(_days)) : null;

    final data = DashboardData(
      overview: overview,
      analytics: analytics,
      attention: attention,
      alerts: alerts,
      labs: labs == null
          ? null
          : (value: labs.valueOrNull, loading: labs.isLoading),
      updatedAt: _lastRefreshed,
      days: _days,
      onDaysChanged: (d) => setState(() => _days = d),
    );

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _DashboardHeader(updatedAt: _lastRefreshed),
            Expanded(
              child:
                  loading
                      ? const Center(child: CircularProgressIndicator())
                      : RefreshIndicator(
                        onRefresh: () async {
                          _refresh();
                          _refreshConversations();
                        },
                        // A plain list. This was briefly a CustomScrollView
                        // with the band as a collapsing sliver, which was a
                        // mistake worth recording: FlexibleSpaceBar draws its
                        // title at *every* extent, not only when collapsed, so
                        // the compact line rendered on top of the expanded
                        // band, and CollapseMode.parallax scales the
                        // background — which pushed the avatar off the right
                        // edge. Collapsing this header needs a
                        // SliverPersistentHeader with its own layout, not
                        // FlexibleSpaceBar.
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(
                            T.s4,
                            T.s3,
                            T.s4,
                            T.s12,
                          ),
                          children: [
                            /*
                             * Composed from what the server says, not from a
                             * list written here.
                             *
                             * The order and the selection used to live in this
                             * file, argued for in comments that are now in
                             * `uiConfig.js` beside the default they describe —
                             * because the argument is about what a clinician
                             * needs to see first, and that answer is different
                             * for a cardiology caseload and a laboratory
                             * bench. Hard-coding one of them here meant every
                             * other department got a diabetes clinic's screen.
                             *
                             * What has not changed is that this app decides
                             * how each panel looks and what it fetches. The
                             * server sends identifiers and nothing else.
                             */
                            if (actions.isNotEmpty) ...[
                              QuickActionBar(actions: actions),
                              const SizedBox(height: T.s6),
                            ],

                            /*
                             * Built first, then spaced — rather than emitting
                             * a gap after each panel as it goes.
                             *
                             * Two reasons, and both of them are the kind of
                             * thing that only shows up on a device. A builder
                             * that returns null is a panel with nothing to say
                             * yet, and its gap has to go with it or a
                             * half-loaded dashboard has holes in it. And a gap
                             * after the *last* panel lands on top of the
                             * list's own bottom padding, which is 48 — so the
                             * screen would end in 72px of nothing.
                             */
                            ..._spaced([
                              for (final id in widgets)
                                dashboardWidgets[id]?.call(data),
                            ]),
                          ],
                        ),
                      ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Header ---------------------------------------------------------------

class _DashboardHeader extends ConsumerWidget {
  const _DashboardHeader({required this.updatedAt});

  /// When the figures below were last refreshed. It belongs here rather than
  /// inside the triage card: it is true of the whole screen, and stating it
  /// once at the top stops each section having to claim its own freshness.
  final DateTime updatedAt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;

    return Container(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s3),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Expanded(child: ClinicWordmark(subtitle: 'Doctor Panel')),
              const SizedBox(width: T.s2),
              PanelNotificationBell(
                onTap: () => showClinicianNotifications(context),
              ),
              const SizedBox(width: T.s1),
              // The whole identity block is the tap target, not just the face —
              // a 38px circle is a small thing to hit, and the name beside it
              // pointed at the same place while looking inert.
              InkWell(
                borderRadius: BorderRadius.circular(12),
                // `go`, not `push`: Profile is one of this shell's own tabs, so
                // pushing it stacked a copy while the bar kept the old tab lit.
                onTap: () => context.go('/clinician/more'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 4,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      UserAvatar(
                        name: user?.name ?? '',
                        avatarUrl: user?.avatarUrl,
                        accent: T.primary,
                        size: 38,
                      ),
                      // Just the avatar, as on the dietician's header.
                      //
                      // The name, the credentials and a chevron shared one row
                      // with the brand lockup and the bell — four blocks of
                      // text across a phone, and the chevron promised a menu
                      // that does not exist. The greeting a line below already
                      // says who is signed in; tapping the face opens Profile.
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s2),
          // Today's date, and how current the screen is. Both are context for
          // everything below, and neither is worth a line of its own.
          Row(
            children: [
              const Icon(
                Icons.calendar_today_rounded,
                size: 14,
                color: T.inkMuted,
              ),
              const SizedBox(width: 6),
              // Expanded, and no Spacer after it.
              //
              // This was Flexible followed by Spacer, and both take a flex of
              // one — so the free space was split evenly between the date and
              // an empty box, and the date ellipsised with half the row
              // standing empty beside it. Shortening the format could never
              // fix that; "Mon, 24 A…" was the same bug as "Monday, 24 A…".
              //
              // With the freshness label laid out at its natural width and
              // Expanded taking whatever is left, the date gets the real
              // remainder and the label still sits hard right.
              Expanded(
                child: Text(
                  DateFormat('EEE, d MMM yyyy').format(DateTime.now()),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ),
              const SizedBox(width: 8),
              // Never ellipsised. "Updated just n…" tells the reader nothing —
              // the whole value of the line is the word at the end, and it was
              // the word being cut. If the row is too narrow for both, the
              // date gives way first: it is on the phone's status bar anyway,
              // and how current the screen is, is not.
              Text(
                freshnessLabel(updatedAt),
                maxLines: 1,
                softWrap: false,
                textAlign: TextAlign.right,
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(width: 6),
              // Green only while the screen is genuinely current. A dot that is
              // always green is a light that is not wired to anything.
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color:
                      DateTime.now().difference(updatedAt).inMinutes < 2
                          ? T.success
                          : T.inkFaint,
                  shape: BoxShape.circle,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}


