import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'widgets/panel_ui.dart';
import 'widgets/clinician_notification_sheet.dart';
import '../../../core/theme/tokens.dart';
import 'widgets/dashboard_sections.dart';
import 'widgets/triage_queue.dart';

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
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (mounted) setState(() => _lastRefreshed = DateTime.now());
    ref.invalidate(overviewProvider);
    ref.invalidate(clinicAnalyticsProvider(_days));
    ref.invalidate(attentionPatientsProvider);
    ref.invalidate(alertsProvider(_alertsQuery));
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
                        onRefresh: () async => _refresh(),
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
                            // Ordered by what the doctor opens the app to find
                            // out. The clinic's own numbers are read once and
                            // then ignored, so they sit at the top as context —
                            // everything below them is work, clinical first and
                            // operational second.
                            //
                            // The previous order put four metric cards, an alert
                            // strip and a monitoring strip above the patients,
                            // which answered "how is the clinic doing" before
                            // "who needs me now". A doctor does not open this to
                            // learn they have seven patients.
                            if (analytics != null) ...[
                              ClinicSnapshot(
                                analytics: analytics,
                                days: _days,
                                onDaysChanged: (d) => setState(() => _days = d),
                              ),
                              const SizedBox(height: T.s6),
                            ],

                            // 1. Clinical: who needs a doctor.
                            TriageQueue(
                              patients: attention,
                              updatedAt: _lastRefreshed,
                            ),

                            // 2 and 3. What is queued up, and the nutrition
                            // reviews. Side by side on a tablet, stacked on a
                            // phone: the design pairs them across one row, and
                            // a 2x2 tile grid next to a list of patients does
                            // not survive 360dp of width.
                            //
                            // The nutrition card is shown whenever the overview
                            // loaded, empty list or not: it says "Nothing due
                            // for review" on its own, and the isNotEmpty guard
                            // that used to be here meant that line could never
                            // be read.
                            if (overview != null) ...[
                              const SizedBox(height: T.s6),
                              LayoutBuilder(
                                builder: (context, c) {
                                  final queue =
                                      analytics == null
                                          ? null
                                          : ActionQueue(
                                            overview: overview,
                                            analytics: analytics,
                                          );
                                  final nutrition = NutritionReviewQueue(
                                    reviews: overview.nutritionReviews,
                                  );
                                  if (c.maxWidth >= 620 && queue != null) {
                                    return IntrinsicHeight(
                                      child: Row(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: [
                                          Expanded(child: queue),
                                          const SizedBox(width: T.s4),
                                          Expanded(child: nutrition),
                                        ],
                                      ),
                                    );
                                  }
                                  return Column(
                                    children: [
                                      if (queue != null) ...[
                                        queue,
                                        const SizedBox(height: T.s6),
                                      ],
                                      nutrition,
                                    ],
                                  );
                                },
                              ),
                            ],

                            // 4. Alerts that have already been raised, last:
                            // they are a record of what the queue above has
                            // already surfaced.
                            //
                            // Rendered whether or not there are any. It has an
                            // "all clear" state built into it, and the
                            // `alerts.isNotEmpty` guard that used to be here
                            // meant that state could never appear — the
                            // section simply vanished, which reads as a screen
                            // that failed to finish rather than as a clinic
                            // with nothing outstanding.
                            const SizedBox(height: T.s6),
                            _TriageQueue(alerts: alerts),

                            // 5. What the clinic has been doing. Context rather
                            // than work, so it sits under everything that needs
                            // doing and never competes with the triage queue.
                            Builder(
                              builder: (context) {
                                final events = LiveActivity.from(
                                  patients: attention,
                                  reviews:
                                      overview?.nutritionReviews ?? const [],
                                );
                                if (events.isEmpty)
                                  return const SizedBox.shrink();
                                return Padding(
                                  padding: const EdgeInsets.only(top: T.s6),
                                  child: LiveActivity(events: events),
                                );
                              },
                            ),
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

    // Qualifications under the name, where a clinician's identity normally
    // sits. Falls back to the role when the profile has none, so the line is
    // never blank.
    final creds =
        (user?.qualifications?.trim().isNotEmpty ?? false)
            ? user!.qualifications!.trim()
            : (user?.role == 'doctor' ? 'Doctor' : 'Clinic staff');

    return Container(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s3),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: T.line)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Image.asset(
                'assets/brand/medpin_emblem.png',
                height: 34,
                errorBuilder:
                    (_, _, _) => const Icon(
                      Icons.forum_rounded,
                      size: 28,
                      color: T.primary,
                    ),
              ),
              const SizedBox(width: T.s2),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'MedPin',
                    style: T.display.copyWith(
                      fontSize: 21,
                      letterSpacing: -0.5,
                      color: T.primary,
                    ),
                  ),
                  Text(
                    'Doctor Panel',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                ],
              ),
              const Spacer(),
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
                      // The name only where there is room for it. On a narrow
                      // phone it would push the bell off the row, so below
                      // 380dp the face stands for the doctor on its own.
                      if (MediaQuery.sizeOf(context).width >= 380) ...[
                        const SizedBox(width: T.s2),
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 132),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                user?.name ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: T.bodyStrong.copyWith(color: T.ink),
                              ),
                              Text(
                                creds,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: T.small.copyWith(color: T.inkMuted),
                              ),
                            ],
                          ),
                        ),
                        const Icon(
                          Icons.expand_more_rounded,
                          size: 18,
                          color: T.inkFaint,
                        ),
                      ],
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
              Text(
                DateFormat('EEE, d MMMM').format(DateTime.now()),
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const Spacer(),
              Flexible(
                child: Text(
                  freshnessLabel(updatedAt),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
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

// ---- Live triage queue ----------------------------------------------------

class _TriageQueue extends StatelessWidget {
  const _TriageQueue({required this.alerts});

  final List<ClinicalAlert> alerts;

  static const _severityOrder = ['emergency', 'urgent', 'warning', 'info'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Worst first, then newest within a severity — "sorted by urgency" has to
    // actually be true, since the doctor reads the top row and acts.
    final sorted = [...alerts]..sort((a, b) {
      final bySeverity = _severityOrder
          .indexOf(a.severity)
          .compareTo(_severityOrder.indexOf(b.severity));
      if (bySeverity != 0) return bySeverity;
      return (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0));
    });
    final shown = sorted.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Named for what it holds. This sat under "Live Triage Queue"
        // directly below a section titled "Live Triage" — two headings a word
        // apart, over different data from different endpoints. Asked where
        // the sections after Live Triage had gone, nobody could answer,
        // because the answer depended on which of the two you were looking at.
        const Text(
          'Raised Alerts',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (shown.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.7),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.check_circle_rounded,
                  color: AppColors.accentOn(context),
                  size: 26,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'No open alerts. Nothing is waiting on triage.',
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          )
        else
          for (final a in shown) _TriageCard(alert: a),
        if (alerts.length > shown.length)
          SizedBox(
            width: double.infinity,
            child: Material(
              color: AppColors.infoBgOn(context),
              borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
              child: InkWell(
                borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                onTap: () => context.push('/clinician/alerts'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Center(
                    child: Text(
                      'View all triage (${alerts.length})',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _TriageCard extends StatelessWidget {
  const _TriageCard({required this.alert});

  final ClinicalAlert alert;

  static Color _sevColor(String severity) => switch (severity) {
    'emergency' => AppColors.danger,
    'urgent' => const Color(0xFFEA580C),
    'warning' => AppColors.warning,
    _ => const Color(0xFF9CA3AF),
  };

  static String _sevLabel(String severity) => switch (severity) {
    'emergency' => 'Critical',
    'urgent' => 'Urgent',
    'warning' => 'Elevated',
    _ => 'Routine',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sev = AppColors.toneOn(context, _sevColor(alert.severity));
    final quote =
        (alert.detail?.trim().isNotEmpty ?? false)
            ? alert.detail!.trim()
            : null;
    final canOpen = alert.patientId != null;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 4, color: sev),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        UserAvatar(
                          name: alert.patientName ?? '?',
                          avatarUrl: null,
                          accent: sev,
                          size: 40,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                alert.patientName ?? 'Unknown patient',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 0),
                              Text(
                                '${_sevLabel(alert.severity)} · ${alert.title}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: sev,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (alert.createdAt != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            DateFormat('h:mm a').format(alert.createdAt!),
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (quote != null) ...[
                      const SizedBox(height: AppSpacing.md),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(AppSpacing.md),
                        decoration: BoxDecoration(
                          color: scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          quote,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.35,
                            fontStyle: FontStyle.italic,
                            color: scheme.onSurface,
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.md),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed:
                            canOpen
                                ? () => context.push(
                                  '/clinician/patients/${alert.patientId}/thread',
                                  extra: alert.patientName,
                                )
                                : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                          ),
                        ),
                        child: const Text(
                          'Review Case',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
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
