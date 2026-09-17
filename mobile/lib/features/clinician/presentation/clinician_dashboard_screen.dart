import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/clinic_brand.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/practice_repository.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/caseload_panels.dart';
import 'widgets/chat_summary_card.dart';
import 'widgets/clinician_notification_sheet.dart';
import 'widgets/dashboard_registry.dart';
import 'widgets/home_actions.dart';
import 'widgets/home_panel.dart';
import 'widgets/panel_ui.dart';
import 'widgets/triage_queue.dart';

/// The doctor's home: who is booked and waiting today, who needs attention,
/// and the caseload their specialty is measured by.
///
/// ---- What a doctor asks first, first ---------------------------------------
///
/// The order comes from the server (services/uiConfig.js) and every clinical
/// preset opens the same way: the day, then who needs attention, then the
/// specialty's panels. The primary action lives with the day, because it is
/// about the day: start the consultation of whoever is waiting.
///
/// ---- Honest about time -----------------------------------------------------
///
/// The header said "Updated just now" beside a green dot, and the time behind
/// it was set when a refresh was *asked for* — so with every request failing,
/// the screen still claimed to be current. It now says the time the figures
/// last arrived, and when a refresh fails it keeps the figures and says how old
/// they are, with a way to try again. A failed refresh never turns a list into
/// an error or an empty state.
class ClinicianDashboardScreen extends ConsumerStatefulWidget {
  const ClinicianDashboardScreen({super.key});

  @override
  ConsumerState<ClinicianDashboardScreen> createState() =>
      _ClinicianDashboardScreenState();
}

class _ClinicianDashboardScreenState
    extends ConsumerState<ClinicianDashboardScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  /// When the overview last arrived. Not when it was last asked for.
  DateTime? _updatedAt;

  /// The glucose chart's window, in days.
  int _days = 14;

  static const _labDays = 30;
  static const AlertsQuery _openAlerts = (status: 'open', severity: null);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ref.listenManual(overviewProvider, (previous, next) {
      if (next is AsyncData && mounted) {
        setState(() => _updatedAt = DateTime.now());
      }
    }, fireImmediately: true);
    // Live figures every twenty seconds: a check-in, a resolved alert, a new
    // message show without anybody pulling.
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _refreshLive());
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
      _refreshLive();
      _refreshCaseload();
    }
  }

  /// Invalidates a request unless one is already on its way: restarting it
  /// every tick on a slow connection means none ever finishes.
  void _again(ProviderOrFamily provider, bool Function() inFlight) {
    if (!inFlight()) ref.invalidate(provider);
  }

  List<String> get _widgets =>
      ref.read(capabilitySetProvider).ui?.widgets ?? _fallbackWidgets;

  /// What the home is made of before the server's answer arrives: the two
  /// panels every clinical preset opens with, and nothing that depends on a
  /// plan. Unknown does not narrow — but it does not invent a specialty either.
  static const _fallbackWidgets = ['TODAYS_CLINIC', 'TRIAGE_QUEUE'];

  void _refreshLive() {
    if (!mounted) return;
    final widgets = _widgets;
    _again(overviewProvider, () => ref.read(overviewProvider).isLoading);
    _again(appointmentsTodayProvider, () => ref.read(appointmentsTodayProvider).isLoading);
    if (widgets.contains('TRIAGE_QUEUE') || widgets.contains('LIVE_ACTIVITY')) {
      _again(attentionPatientsProvider, () => ref.read(attentionPatientsProvider).isLoading);
    }
    if (widgets.contains('ANALYTICS_SUMMARY') || widgets.contains('ACTION_QUEUE')) {
      _again(clinicAnalyticsProvider(_days), () => ref.read(clinicAnalyticsProvider(_days)).isLoading);
    }
    if (widgets.contains('OPEN_ALERTS')) {
      _again(alertsProvider(_openAlerts), () => ref.read(alertsProvider(_openAlerts)).isLoading);
    }
    if (needsLabOverview(widgets)) {
      _again(labOverviewProvider(_labDays), () => ref.read(labOverviewProvider(_labDays)).isLoading);
    }
  }

  /// The conversations and the caseload panels: on return to the app and on
  /// pull, not on the poll. Each reads a day of conversations or every reading
  /// in its window for the whole caseload.
  void _refreshCaseload() {
    ref.invalidate(chatSummariesProvider(ChatSummaryCard.query));
    ref.invalidate(glucoseFlagsProvider(GlucoseFlagsCard.days));
    ref.invalidate(hba1cControlProvider(Hba1cControlCard.days));
    ref.invalidate(bpControlProvider(BpControlCard.days));
    ref.invalidate(followUpsProvider(FollowUpsDueCard.days));
    ref.invalidate(conditionRegisterProvider);
    ref.invalidate(heartRateFlagsProvider(HeartRateFlagsCard.days));
    ref.invalidate(ecgPanelProvider(RecentEcgsCard.days));
    ref.invalidate(lipidControlProvider(LipidControlCard.days));
  }

  void _retryAll() {
    _refreshLive();
    _refreshCaseload();
  }

  Future<void> _pull() async {
    _retryAll();
    // The spinner stays until the overview answers, either way.
    try {
      await ref.read(overviewProvider.future);
    } catch (_) {
      // Said on the screen, by the date line and the panels.
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(capabilitySetProvider);
    final widgets = caps.ui?.widgets ?? _fallbackWidgets;
    final actions = caps.ui?.quickActions ?? const <String>[];

    // A practice manager reads no patient, and the overview is a patient
    // count: the server refuses it. Not asked for, rather than asked for and
    // announced as refused across the top of their home.
    final readsPatients = caps.can(Perm.viewPatient);
    final overview = readsPatients
        ? ref.watch(overviewProvider)
        : const AsyncValue<ClinicOverview>.loading();
    final data = DashboardData(
      caps: caps,
      widgets: widgets,
      actions: actions,
      overview: overview,
      attention: widgets.contains('TRIAGE_QUEUE') || widgets.contains('LIVE_ACTIVITY')
          ? ref.watch(attentionPatientsProvider)
          : null,
      analytics: widgets.contains('ANALYTICS_SUMMARY') || widgets.contains('ACTION_QUEUE')
          ? ref.watch(clinicAnalyticsProvider(_days))
          : null,
      alerts: widgets.contains('OPEN_ALERTS') ? ref.watch(alertsProvider(_openAlerts)) : null,
      labs: needsLabOverview(widgets) ? ref.watch(labOverviewProvider(_labDays)) : null,
      days: _days,
      onDaysChanged: (d) => setState(() => _days = d),
      onRetry: _retryAll,
    );

    /*
     * Composed from what the server says, not from a list written here: the
     * order and the selection are the argument uiConfig.js makes about what a
     * diabetologist, a physician and a cardiologist need to see first.
     */
    final panels = <Widget>[
      // A home without the day on it still gets its actions — first.
      if (actions.isNotEmpty && !widgets.contains('TODAYS_CLINIC'))
        _actionsWithoutTheDay(actions, data),
      for (final id in widgets)
        if (dashboardWidgets[id]?.call(data) case final panel?) panel,
    ];

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _HomeHeader(caps: caps),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _pull,
                child: ListView(
                  // Clear of the navigation bar: the last card ends above it
                  // with room to spare, rather than sliding under its edge.
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s12),
                  children: [
                    _DayLine(
                      overview: readsPatients ? overview : null,
                      updatedAt: _updatedAt,
                      onRetry: _retryAll,
                    ),
                    const SizedBox(height: T.s3),
                    for (var i = 0; i < panels.length; i++) ...[
                      if (i > 0) const SizedBox(height: T.s4),
                      panels[i],
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionsWithoutTheDay(List<String> actions, DashboardData data) {
    final clinical = actions.contains('START_CONSULTATION') || actions.contains('ADD_PATIENT');
    if (!clinical) return HomeShortcuts(actions: actions);
    return HomeCard(
      child: HomeActions(
        actions: actions,
        practiceEmpty: data.practiceEmpty,
        alertsOnScreen: data.widgets.contains('TRIAGE_QUEUE'),
      ),
    );
  }
}

// ---- Header -------------------------------------------------------------------

/// The practice, the doctor and their specialty; the bell; and the way to More.
///
/// It said "MedPin — Doctor Panel": the product's name and a description of the
/// screen, where the practice's name belongs, over an avatar reading "D" for
/// every doctor whose name begins "Dr.".
class _HomeHeader extends ConsumerWidget {
  const _HomeHeader({required this.caps});

  final Capabilities caps;

  /// The specialty under the doctor's name: their department here, what their
  /// own letterhead says, or what the practice treats — the same three the
  /// server composes the home from, so the label explains the screen.
  static String? specialtyLabel(Capabilities caps, String? ownSpecialty) {
    final department = caps.department?.name;
    if (department != null && department.trim().isNotEmpty) return department;
    if (ownSpecialty != null && ownSpecialty.trim().isNotEmpty) return ownSpecialty.trim();
    return switch (caps.specialty) {
      'diabetology' => 'Diabetology',
      'cardiology' => 'Cardiology',
      'general_physician' => 'General physician',
      _ => null,
    };
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final practice = ref.watch(practiceOverviewProvider).valueOrNull;
    final specialty = specialtyLabel(caps, user?.specialty);
    final who = [
      if (user != null && user.name.trim().isNotEmpty) user.name.trim(),
      if (specialty != null) specialty,
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s2, T.s2),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Row(
        children: [
          // The practice's own artwork when it has some. Not its initials in
          // a tile: "DC" says nothing the name beside it does not, and costs
          // the name the width it needs to stay on two lines.
          if (practice?.logoLightUrl != null && practice!.logoLightUrl!.isNotEmpty) ...[
            PracticeMark(name: practice.name, logoUrl: practice.logoLightUrl, size: T.s8 + T.s2),
            const SizedBox(width: T.s3),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // The practice when there is one. No product name in its
                // place: a header that has not heard from the server yet says
                // who is signed in, which it does know.
                if (practice != null && practice.name.trim().isNotEmpty)
                  Text(
                    practice.name.trim(),
                    style: T.bodyStrong.copyWith(color: T.ink),
                    // Three lines before it gives way: a long practice name at
                    // a larger text size is still the practice's whole name.
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (who.isNotEmpty)
                  Text(who, style: T.small.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          const SizedBox(width: T.s1),
          PanelNotificationBell(onTap: () => showClinicianNotifications(context)),
          Semantics(
            button: true,
            label: 'Your profile and settings',
            excludeSemantics: true,
            child: InkWell(
              customBorder: const CircleBorder(),
              // `go`, not `push`: More is one of this shell's own tabs.
              onTap: () => context.go('/clinician/more'),
              child: Padding(
                padding: const EdgeInsets.all(T.s1),
                child: UserAvatar(
                  name: user?.name ?? '',
                  avatarUrl: user?.avatarUrl,
                  accent: T.primary,
                  size: T.s8 + T.s2,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- The date, and how current the figures are -----------------------------

class _DayLine extends StatelessWidget {
  const _DayLine({
    required this.overview,
    required this.updatedAt,
    required this.onRetry,
  });

  /// Null for a home that does not read the overview: the date alone.
  final AsyncValue<Object?>? overview;
  final DateTime? updatedAt;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final date = DateFormat('EEEE, d MMMM').format(DateTime.now());
    final at = updatedAt;
    final overview = this.overview;

    if (overview == null) {
      return Text(date, style: T.small.copyWith(color: T.inkMuted));
    }

    // Fresh, or still arriving for the first time: one quiet line.
    if (!overview.hasError) {
      final String status;
      if (overview.hasValue && at != null) {
        status = 'Updated ${freshnessLabel(at)}';
      } else {
        status = 'Loading';
      }
      return Row(
        children: [
          Expanded(child: Text(date, style: T.small.copyWith(color: T.inkMuted))),
          const SizedBox(width: T.s2),
          Text(status, style: T.small.copyWith(color: T.inkMuted)),
        ],
      );
    }

    // A refresh failed. Keep the figures, and say how old they are.
    final problem = loadProblemOf(overview.error);
    final String message;
    if (problem == LoadProblem.failed) {
      message = overview.hasValue && at != null
          ? 'Not updated since ${freshnessLabel(at)}. The figures below may be out of date.'
          : 'Could not reach the server. Nothing below is current.';
    } else {
      message = readableServerMessage(overview.error) ??
          (problem == LoadProblem.denied
              ? 'Your role at this practice does not include its overview.'
              : 'This server cannot show the practice overview yet.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(date, style: T.small.copyWith(color: T.inkMuted)),
        const SizedBox(height: T.s2),
        InnerTile(
          tone: problem == LoadProblem.failed ? T.warningTint : null,
          padding: const EdgeInsets.fromLTRB(T.s3, T.s1, T.s1, T.s1),
          child: Row(
            children: [
              Icon(
                problem == LoadProblem.failed ? Icons.cloud_off_rounded : Icons.info_outline_rounded,
                size: T.s5,
                color: problem == LoadProblem.failed ? T.warning : T.inkMuted,
              ),
              const SizedBox(width: T.s2),
              Expanded(child: Text(message, style: T.small.copyWith(color: T.ink))),
              if (problem == LoadProblem.failed) RetryButton(onTap: onRetry) else const SizedBox(height: T.tap),
            ],
          ),
        ),
      ],
    );
  }
}
