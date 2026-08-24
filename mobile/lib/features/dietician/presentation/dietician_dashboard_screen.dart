import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/app_logo.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/diet_models.dart';
import 'dietician_providers.dart';
import 'widgets/dietician_bell.dart';
import 'widgets/nutrition_sparkline.dart';

/// The dietician's day in one screen.
///
/// Rebuilt around one question — *which patient's nutrition needs me, and what
/// do I do about it* — rather than the one it used to answer, which was *how
/// many things are there*. Those sound similar and produce very different
/// screens. The old one led with a full-width hero whose entire content was the
/// number of lapsed reviews, so the emptiest possible day got the largest
/// possible headline, and the same "all caught up" was then repeated in a
/// second panel underneath.
///
/// The order is the order the work happens in: what is due today, then the
/// caseload at a glance, then the patients who need attention, then where the
/// plans stand, then the evidence (meals) and finally what has just happened.
/// Every count on it comes from the same request as the list beneath it, so a
/// number can never disagree with the rows it is counting.
class DieticianDashboardScreen extends ConsumerWidget {
  const DieticianDashboardScreen({super.key});

  static String _partOfDay() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final async = ref.watch(dietDashboardProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
      // The dietician's day is made of other people's actions — a patient
      // logging a meal, a doctor prescribing, a report the server has just
      // finished reading. Waiting for a pull-to-refresh showed them a morning
      // that had already moved on.
      body: AutoRefresh(
        onTick: (ref) => ref.invalidate(dietDashboardProvider),
        interval: const Duration(seconds: 30),
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _BrandHeader(name: user?.name ?? '', avatarUrl: user?.avatarUrl),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async => ref.invalidate(dietDashboardProvider),
                  child: async.when(
                    loading:
                        () => const Center(child: CircularProgressIndicator()),
                    error: (_, _) => _LoadFailed(ref: ref),
                    data:
                        (d) => ListView(
                          padding: const EdgeInsets.fromLTRB(
                            T.s4,
                            T.s2,
                            T.s4,
                            T.s8,
                          ),
                          children: [
                            _Greeting(name: user?.name ?? ''),
                            const SizedBox(height: T.s4),
                            _TodaysWork(d: d),
                            const SizedBox(height: T.s4),
                            _QuickStats(d: d),
                            if (d.attention.isNotEmpty) ...[
                              const SizedBox(height: T.s4),
                              _Attention(items: d.attention),
                            ],
                            if (!d.planStatus.isEmpty) ...[
                              const SizedBox(height: T.s4),
                              _PlanStatusCard(status: d.planStatus),
                            ],
                            if (d.recentLogs.isNotEmpty) ...[
                              const SizedBox(height: T.s4),
                              _RecentLogs(logs: d.recentLogsForGrid()),
                            ],
                            if (d.activity.isNotEmpty) ...[
                              const SizedBox(height: T.s4),
                              _RecentActivity(items: d.activity),
                            ],
                          ],
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

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.ref});

  final WidgetRef ref;

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      const SizedBox(height: 140),
      const Center(child: Text('Could not load your dashboard')),
      const SizedBox(height: T.s4),
      Center(
        child: OutlinedButton(
          onPressed: () => ref.invalidate(dietDashboardProvider),
          child: const Text('Retry'),
        ),
      ),
    ],
  );
}

// ---------------------------------------------------------------- header

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.name, required this.avatarUrl});

  final String name;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s2),
      child: Row(
        children: [
          // AppLogo, not a path: the widget exists so a change of artwork is a
          // one-file edit, and the path this originally guessed at did not
          // exist — it silently rendered the fallback icon instead.
          const AppLogo(size: 34),
          const SizedBox(width: T.s2),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'MedPin',
                style: T.title.copyWith(color: T.primary, height: 1.1),
              ),
              Text(
                'Dietician Panel',
                style: T.label.copyWith(
                  letterSpacing: 0,
                  fontWeight: FontWeight.w500,
                  color: T.inkMuted,
                ),
              ),
            ],
          ),
          const Spacer(),
          const DieticianBell(),
          const SizedBox(width: T.s3),
          // Just the avatar. The name, the role and a dropdown chevron all
          // crowded into the same row as the brand lockup and the bell — four
          // blocks of text across a phone, none of which a dietician reads
          // twice. The name belongs in the greeting a line below, which is
          // where it now lives, and the chevron promised a menu that does not
          // exist: tapping opens the Profile tab.
          Semantics(
            button: true,
            label: 'Profile',
            child: GestureDetector(
              onTap: () => context.go('/dietician/profile'),
              behavior: HitTestBehavior.opaque,
              child: Stack(
                children: [
                  UserAvatar(
                    name: name,
                    avatarUrl: avatarUrl,
                    accent: T.primary,
                    size: 38,
                  ),
                  // Not decoration: a dietician sharing a caseload needs to
                  // know at a glance whose session this is.
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      width: 11,
                      height: 11,
                      decoration: BoxDecoration(
                        color: T.success,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final first = name.split(' ').first;
    // A plain column since the freshness label was removed. It claimed
    // "Updated just now" on every frame regardless of when the fetch actually
    // happened or whether it succeeded — so on a dropped connection the
    // counts went stale under a green dot promising they were current. A
    // staleness indicator that cannot detect staleness is worse than none.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                '${DieticianDashboardScreen._partOfDay()}, '
                '${first.isEmpty ? 'there' : first}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: T.title.copyWith(color: T.ink),
              ),
            ),
            const SizedBox(width: T.s2),
            // An icon, not 👋. Emoji render in the system font and shift
            // with every OS version — on this device the wave came out a
            // different weight and baseline from the type beside it.
            Icon(Icons.waving_hand_rounded, size: 18, color: T.warning),
          ],
        ),
        Text(
          DateFormat('EEEE, d MMMM').format(DateTime.now()),
          style: T.small.copyWith(color: T.inkMuted),
        ),
      ],
    );
  }
}

// -------------------------------------------------------- today's work

/// The one status component on the screen.
///
/// It changes shape with the workload rather than reserving a hero-sized block
/// for a zero: with work outstanding it leads with the count and a button that
/// starts it; with none it says so in one line and gives the space back. The
/// old screen had both a hero *and* a separate "all caught up" panel saying the
/// same thing twice.
class _TodaysWork extends StatelessWidget {
  const _TodaysWork({required this.d});

  final DietDashboard d;

  @override
  Widget build(BuildContext context) {
    final overview = d.overview;
    // Side by side only where there is room for two columns. Below that they
    // stack — but the overview is always rendered, which it was not: hiding it
    // whenever the caseload had no readings meant the commonest reason to look
    // (has anybody been testing?) was answered by an absence.
    final wide = MediaQuery.sizeOf(context).width >= 560;

    return SectionCard(
      child:
          wide
              ? IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 5, child: _WorkSummary(d: d)),
                    const SizedBox(width: T.s3),
                    Expanded(flex: 6, child: _OverviewTile(overview: overview)),
                  ],
                ),
              )
              : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _WorkSummary(d: d),
                  const SizedBox(height: T.s4),
                  _OverviewTile(overview: overview),
                ],
              ),
    );
  }
}

class _WorkSummary extends StatelessWidget {
  const _WorkSummary({required this.d});

  final DietDashboard d;

  @override
  Widget build(BuildContext context) {
    if (d.allCaughtUp) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Today's nutrition work", style: T.title.copyWith(color: T.ink)),
          const SizedBox(height: T.s3),
          Row(
            children: [
              const Icon(
                Icons.check_circle_rounded,
                size: 20,
                color: T.success,
              ),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  'All caught up',
                  style: T.bodyStrong.copyWith(color: T.success),
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s1),
          Text(
            'Every plan is sent and no review is due.',
            style: T.small.copyWith(color: T.inkMuted),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text("Today's nutrition work", style: T.title.copyWith(color: T.ink)),
        const SizedBox(height: T.s2),
        MetricValue(
          value: '${d.workDue}',
          unit: d.workDue == 1 ? 'review due' : 'reviews due',
          size: 40,
        ),
        const SizedBox(height: T.s3),
        // The split, because "2 reviews" does not say what kind of work it is
        // and the two need different screens.
        Wrap(
          spacing: T.s2,
          runSpacing: T.s2,
          children: [
            if (d.reviewsDue > 0)
              StatusPill(
                label:
                    '${d.reviewsDue} food '
                    '${d.reviewsDue == 1 ? 'log' : 'logs'}',
                status: Status.neutral,
              ),
            if (d.plansMissing > 0)
              StatusPill(
                label:
                    '${d.plansMissing} diet '
                    '${d.plansMissing == 1 ? 'plan' : 'plans'}',
                status: Status.ok,
              ),
          ],
        ),
        const SizedBox(height: T.s4),
        SizedBox(
          height: 46,
          child: FilledButton(
            onPressed: () => context.go('/dietician/patients'),
            style: FilledButton.styleFrom(
              backgroundColor: T.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(T.rControl),
              ),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Review now', style: T.bodyStrong),
                SizedBox(width: T.s2),
                Icon(Icons.arrow_forward_rounded, size: 18),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OverviewTile extends StatelessWidget {
  const _OverviewTile({required this.overview});

  final NutritionOverview overview;

  @override
  Widget build(BuildContext context) {
    final delta = overview.deltaPercent;
    if (!overview.hasData) return const _OverviewEmpty();
    return InnerTile(
      padding: const EdgeInsets.all(T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Nutrition overview (14 days)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.label.copyWith(
                    letterSpacing: 0,
                    fontWeight: FontWeight.w500,
                    color: T.inkMuted,
                  ),
                ),
              ),
              Tooltip(
                message:
                    'Share of your patients’ glucose readings that landed '
                    'in the clinic’s target range over the last 14 days.',
                triggerMode: TooltipTriggerMode.tap,
                child: const Icon(
                  Icons.info_outline_rounded,
                  size: 14,
                  color: T.inkFaint,
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              MetricValue(
                value: '${overview.inTargetPercent}%',
                size: 28,
                color: T.primary,
              ),
              const SizedBox(width: T.s2),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(
                    'In target range',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                ),
              ),
            ],
          ),
          if (delta != null) ...[
            const SizedBox(height: T.s1),
            Row(
              children: [
                Icon(
                  delta >= 0
                      ? Icons.arrow_upward_rounded
                      : Icons.arrow_downward_rounded,
                  size: 13,
                  // Up is good here — more readings in range — so the colour
                  // follows the meaning, not the direction of the arrow.
                  color: delta >= 0 ? T.success : T.warning,
                ),
                const SizedBox(width: 2),
                Flexible(
                  child: Text(
                    // Points, not per cent. 29% against a previous 100% is a
                    // fall of 71 percentage points; writing it as "71%" reads
                    // as a 71% relative drop, which would be a different and
                    // much smaller number.
                    '${delta.abs()} pts vs previous 14 days',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.label.copyWith(
                      letterSpacing: 0,
                      color: delta >= 0 ? T.success : T.warning,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: T.s2),
          // The painter draws its own axis now: two layouts cannot agree
          // about where a gridline sits, and these two did not.
          NutritionSparkline(series: overview.series),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------- quick stats

class _QuickStats extends StatelessWidget {
  const _QuickStats({required this.d});

  final DietDashboard d;

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[
      _StatCard(
        icon: Icons.groups_rounded,
        tone: T.primary,
        value: '${d.patients}',
        label: 'Active patients',
        action: 'View all',
        onTap: () => context.go('/dietician/patients'),
      ),
      _StatCard(
        icon: Icons.send_rounded,
        tone: T.success,
        value: '${d.plansMissing}',
        label: d.plansMissing == 1 ? 'Plan to send' : 'Plans to send',
        action: d.plansMissing > 0 ? 'Review' : null,
        onTap: () => context.go('/dietician/patients'),
      ),
      _StatCard(
        icon: Icons.chat_bubble_rounded,
        tone: T.warning,
        value: '${d.unreadMessages}',
        label: 'Unread messages',
        // Not another link: the urgent count is the reason to look, so it
        // takes the line a "View all" would otherwise have used.
        footnote: d.urgentMessages > 0 ? '${d.urgentMessages} urgent' : null,
        footnoteTone: T.warning,
        onTap: () => context.go('/dietician/patients'),
      ),
      _StatCard(
        icon: Icons.person_add_alt_1_rounded,
        tone: const Color(0xFF8B5CF6),
        value: '${d.newThisWeek}',
        label: 'New this week',
        action: 'View all',
        onTap: () => context.go('/dietician/patients'),
      ),
    ];

    // Four across is the mockup, and it only fits a tablet. On a phone they
    // wrap two-by-two rather than shrinking to a width where "Unread messages"
    // has to ellipsise.
    final four = MediaQuery.sizeOf(context).width >= 620;
    if (four) {
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < cards.length; i++) ...[
              if (i > 0) const SizedBox(width: T.s3),
              Expanded(child: cards[i]),
            ],
          ],
        ),
      );
    }
    return Column(
      children: [
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: cards[0]),
              const SizedBox(width: T.s3),
              Expanded(child: cards[1]),
            ],
          ),
        ),
        const SizedBox(height: T.s3),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: cards[2]),
              const SizedBox(width: T.s3),
              Expanded(child: cards[3]),
            ],
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.tone,
    required this.value,
    required this.label,
    required this.onTap,
    this.action,
    this.footnote,
    this.footnoteTone,
  });

  final IconData icon;
  final Color tone;
  final String value;
  final String label;
  final VoidCallback onTap;
  final String? action;
  final String? footnote;
  final Color? footnoteTone;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 18, color: tone),
              ),
              const SizedBox(width: T.s2),
              Flexible(child: MetricValue(value: value, size: 24)),
            ],
          ),
          const SizedBox(height: T.s2),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: T.small.copyWith(fontWeight: FontWeight.w600, color: T.ink),
          ),
          const Spacer(),
          if (footnote != null)
            Padding(
              padding: const EdgeInsets.only(top: T.s1),
              child: Row(
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: footnoteTone ?? T.inkMuted,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: T.s1),
                  Flexible(
                    child: Text(
                      footnote!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.label.copyWith(
                        letterSpacing: 0,
                        color: footnoteTone ?? T.inkMuted,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else if (action != null)
            Align(
              alignment: Alignment.centerLeft,
              child: ActionLink(label: action!, onTap: onTap),
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------ attention

/// The section the old dashboard was missing entirely.
///
/// It used to list counts and then a gallery of meals, which between them
/// never answered "who needs me". Each row is one patient, the single most
/// pressing reason they surfaced, and the button for that specific job.
class _Attention extends StatelessWidget {
  const _Attention({required this.items});

  final List<NutritionAttention> items;

  static Status _statusFor(String kind) => switch (kind) {
    'log_review' => Status.alert,
    'adherence' => Status.watch,
    _ => Status.neutral,
  };

  @override
  Widget build(BuildContext context) {
    // Three is the most that can be acted on in one sitting; the rest are one
    // tap away rather than an endless column on the home screen.
    final shown = items.take(3).toList();
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: T.danger,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  'Nutrition attention',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              ActionLink(
                label: 'View all patients',
                onTap: () => context.go('/dietician/patients'),
              ),
            ],
          ),
          Text(
            'Patients who need your attention',
            style: T.small.copyWith(color: T.inkMuted),
          ),
          const SizedBox(height: T.s3),
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const SizedBox(height: T.s2),
            _AttentionRow(item: shown[i], status: _statusFor(shown[i].kind)),
          ],
        ],
      ),
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({required this.item, required this.status});

  final NutritionAttention item;
  final Status status;

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 400;
    return InnerTile(
      padding: const EdgeInsets.all(T.s3),
      onTap: () => context.push('/dietician/patients/${item.patientId}'),
      child: Row(
        children: [
          Stack(
            children: [
              UserAvatar(
                name: item.name,
                avatarUrl: item.avatarUrl,
                // The reason they surfaced, carried on the avatar too, so the
                // row reads at a glance before any of its text is parsed.
                accent: status.tone,
                size: 42,
              ),
              Positioned(
                right: 0,
                top: 0,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: status.tone,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: 3),
                Wrap(
                  spacing: T.s2,
                  runSpacing: T.s1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusPill(label: item.label, status: status),
                    if (item.kind == 'adherence' && item.missedLogs > 0)
                      Text(
                        '${item.missedLogs} missed '
                        '${item.missedLogs == 1 ? 'log' : 'logs'}',
                        style: T.label.copyWith(
                          letterSpacing: 0,
                          fontWeight: FontWeight.w500,
                          color: T.inkMuted,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  item.detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.label.copyWith(
                    letterSpacing: 0,
                    fontWeight: FontWeight.w500,
                    color: T.inkMuted,
                  ),
                ),
              ],
            ),
          ),
          // The spark and the button both drop on a narrow phone before the
          // patient's name or their reason does.
          if (!narrow && item.spark.isNotEmpty) ...[
            const SizedBox(width: T.s2),
            AdherenceSpark(days: item.spark, tone: status.tone),
          ],
          const SizedBox(width: T.s2),
          _RowAction(
            label: item.actionLabel,
            status: status,
            onTap:
                () => context.push(
                  item.kind == 'log_review'
                      ? '/dietician/patients/${item.patientId}?tab=logs'
                      : '/dietician/patients/${item.patientId}',
                ),
          ),
        ],
      ),
    );
  }
}

class _RowAction extends StatelessWidget {
  const _RowAction({
    required this.label,
    required this.status,
    required this.onTap,
  });

  final String label;
  final Status status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    child: GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        constraints: const BoxConstraints(minHeight: T.tap - 8),
        padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s2),
        decoration: BoxDecoration(
          color: status.tint,
          borderRadius: BorderRadius.circular(T.rControl),
        ),
        child: Center(
          child: Text(
            label,
            maxLines: 1,
            style: T.label.copyWith(
              fontSize: 12,
              letterSpacing: 0,
              fontWeight: FontWeight.w700,
              color: status.tone,
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------- plan status

class _PlanStatusCard extends StatelessWidget {
  const _PlanStatusCard({required this.status});

  final PlanStatus status;

  @override
  Widget build(BuildContext context) {
    final cells =
        <({IconData icon, Color tone, int n, String label, String sub})>[
          (
            icon: Icons.description_rounded,
            tone: T.success,
            n: status.active,
            label: status.active == 1 ? 'Active plan' : 'Active plans',
            sub: 'On track',
          ),
          (
            icon: Icons.edit_document,
            tone: T.warning,
            n: status.draft,
            label: status.draft == 1 ? 'Draft plan' : 'Draft plans',
            sub: 'Ready to send',
          ),
          (
            icon: Icons.event_rounded,
            tone: T.primary,
            n: status.reviewDueSoon,
            // Not "expiring": a plan has no expiry date. What falls due is its
            // review, and naming it that is the difference between a dietician
            // trusting this number and learning to ignore it.
            label: 'Review due',
            sub: 'Within 3 days',
          ),
        ];

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Diet plan status',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              ActionLink(
                label: 'View plans',
                onTap: () => context.go('/dietician/patients'),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < cells.length; i++) ...[
                  if (i > 0)
                    const VerticalDivider(
                      width: T.s4,
                      thickness: 1,
                      color: Color(0xFFEDF1F7),
                    ),
                  Expanded(
                    // Stacked, not icon-beside-text. Three cells across a
                    // 360dp phone leave about 58dp of text width once a 34px
                    // plate and its gap are taken out, which is where "Active
                    // plans" and "Ready to send" were being cut to "Active…"
                    // and "Ready…". Vertical gives each label the full third.
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: cells[i].tone.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(T.rCard),
                          ),
                          child: Icon(
                            cells[i].icon,
                            size: 17,
                            color: cells[i].tone,
                          ),
                        ),
                        const SizedBox(height: T.s2),
                        MetricValue(value: '${cells[i].n}', size: 22),
                        const SizedBox(height: 2),
                        Text(
                          cells[i].label,
                          maxLines: 2,
                          textAlign: TextAlign.center,
                          style: T.label.copyWith(
                            letterSpacing: 0,
                            fontWeight: FontWeight.w600,
                            color: T.ink,
                          ),
                        ),
                        Text(
                          cells[i].sub,
                          maxLines: 2,
                          textAlign: TextAlign.center,
                          style: T.label.copyWith(
                            fontSize: 10,
                            letterSpacing: 0,
                            fontWeight: FontWeight.w500,
                            color: T.inkMuted,
                          ),
                        ),
                      ],
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

// ----------------------------------------------------------- food logs

class _RecentLogs extends StatelessWidget {
  const _RecentLogs({required this.logs});

  final List<DietRecentLog> logs;

  static String _meal(String t) =>
      t.isEmpty ? 'Meal' : t[0].toUpperCase() + t.substring(1);

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.fromLTRB(T.s5, T.s5, 0, T.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: T.s5),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Recent food logs',
                    style: T.title.copyWith(color: T.ink),
                  ),
                ),
                ActionLink(
                  label: 'View all',
                  onTap: () => context.go('/dietician/patients'),
                ),
              ],
            ),
          ),
          const SizedBox(height: T.s3),
          SizedBox(
            // Scaled by the text factor: the caption under each photo grows
            // with the system setting and would otherwise clip.
            height: MediaQuery.textScalerOf(context).scale(210),
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.only(right: T.s5),
              itemCount: logs.length,
              separatorBuilder: (_, _) => const SizedBox(width: T.s3),
              itemBuilder: (context, i) => _LogTile(log: logs[i]),
            ),
          ),
        ],
      ),
    );
  }
}

class _LogTile extends StatelessWidget {
  const _LogTile({required this.log});

  final DietRecentLog log;

  @override
  Widget build(BuildContext context) {
    final at = log.createdAt;
    return SizedBox(
      width: 158,
      child: GestureDetector(
        // push, not go: tapping a meal is a drill-down and has to leave a Back
        // button. `go` replaced the tab's route, which stranded the
        // dietician on a patient record with no way out but the nav bar.
        onTap: () => context.push('/dietician/patients/${log.patientId}'),
        behavior: HitTestBehavior.opaque,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // One fixed ratio for every tile, whatever shape the photograph
            // is. Four plates at four heights was the untidiest thing on the
            // old screen.
            AspectRatio(
              aspectRatio: 4 / 3,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(T.rControl),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (log.photoUrl != null)
                      AuthedImage(path: log.photoUrl!, fit: BoxFit.cover)
                    else
                      Container(
                        color: const Color(0xFFF1F4F9),
                        child: const Icon(
                          Icons.restaurant_rounded,
                          size: 28,
                          color: T.inkFaint,
                        ),
                      ),
                    if (at != null)
                      Positioned(
                        left: T.s2,
                        bottom: T.s2,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: T.s2,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: T.rFull,
                          ),
                          child: Text(
                            DateFormat('h:mm a').format(at),
                            style: T.label.copyWith(
                              fontSize: 10,
                              letterSpacing: 0,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: T.s2),
            Text(
              log.patientName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.small.copyWith(
                fontWeight: FontWeight.w700,
                color: T.ink,
              ),
            ),
            Text(
              _RecentLogs._meal(log.mealType),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.label.copyWith(
                letterSpacing: 0,
                fontWeight: FontWeight.w500,
                color: T.inkMuted,
              ),
            ),
            const SizedBox(height: 3),
            // The line that turns a gallery into a worklist.
            //
            // Wraps to two lines rather than ellipsising. At a system text
            // scale above 1.0 "Needs review" no longer fits a 158px tile on
            // one line, and the truncation landed mid-word — "Needs revi…" —
            // on the one caption that has to be unambiguous.
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Icon(
                    log.needsReview
                        ? Icons.schedule_rounded
                        : Icons.check_circle_rounded,
                    size: 12,
                    color: log.needsReview ? T.warning : T.success,
                  ),
                ),
                const SizedBox(width: T.s1),
                Expanded(
                  child: Text(
                    log.needsReview ? 'Needs review' : 'Reviewed',
                    maxLines: 2,
                    style: T.label.copyWith(
                      letterSpacing: 0,
                      fontWeight: FontWeight.w600,
                      color: log.needsReview ? T.warning : T.success,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------- activity

/// What has just happened, as three short lines.
///
/// Sits last on purpose. It is the only block on the screen that asks for
/// nothing — everything above it is work, and a feed placed among the work
/// competes with it for the same glance.
class _RecentActivity extends StatelessWidget {
  const _RecentActivity({required this.items});

  final List<DietActivity> items;

  static ({IconData icon, Color tone}) _face(String kind) => switch (kind) {
    'food_log' => (icon: Icons.water_drop_rounded, tone: T.success),
    'plan' => (icon: Icons.event_note_rounded, tone: T.warning),
    _ => (icon: Icons.chat_bubble_rounded, tone: T.primary),
  };

  /// "18 min ago" — the same shorthand the attention rows use, so two blocks
  /// on one screen do not describe time two different ways.
  static String _ago(DateTime? at) {
    if (at == null) return '';
    final d = DateTime.now().difference(at);
    if (d.inMinutes < 1) return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes} min ago';
    if (d.inHours < 24) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final shown = items.take(3).toList();
    // Three across is the mockup and it needs the width; below that they
    // stack, because "Ayesha Rahman submitted a food log" in a third of a
    // 360dp screen is four truncated lines.
    final row = MediaQuery.sizeOf(context).width >= 600;

    final cells = [
      for (final a in shown) _ActivityCell(item: a, face: _face(a.kind)),
    ];

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Recent activity',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              ActionLink(
                label: 'View all',
                onTap: () => context.go('/dietician/patients'),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          if (row)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < cells.length; i++) ...[
                    if (i > 0)
                      const VerticalDivider(
                        width: T.s4,
                        thickness: 1,
                        color: Color(0xFFEDF1F7),
                      ),
                    Expanded(child: cells[i]),
                  ],
                ],
              ),
            )
          else
            Column(
              children: [
                for (var i = 0; i < cells.length; i++) ...[
                  if (i > 0) const SizedBox(height: T.s3),
                  cells[i],
                ],
              ],
            ),
        ],
      ),
    );
  }
}

class _ActivityCell extends StatelessWidget {
  const _ActivityCell({required this.item, required this.face});

  final DietActivity item;
  final ({IconData icon, Color tone}) face;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: face.tone.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(face.icon, size: 17, color: face.tone),
        ),
        const SizedBox(width: T.s2),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${item.patientName} ${item.text}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.small.copyWith(
                  fontWeight: FontWeight.w600,
                  color: T.ink,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _RecentActivity._ago(item.at),
                style: T.label.copyWith(
                  letterSpacing: 0,
                  fontWeight: FontWeight.w500,
                  color: T.inkMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}


/// The overview tile with nothing behind it yet.
///
/// Rendered rather than hidden. "No readings in the last 14 days" is a real
/// answer to the question the tile asks, and for a dietician it is an
/// actionable one — a caseload that has stopped testing is exactly the thing
/// worth noticing. Hiding the block made that state indistinguishable from a
/// screen that had not finished loading.
class _OverviewEmpty extends StatelessWidget {
  const _OverviewEmpty();

  @override
  Widget build(BuildContext context) => InnerTile(
    padding: const EdgeInsets.all(T.s3),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Nutrition overview (14 days)',
          style: T.label.copyWith(
            letterSpacing: 0,
            fontWeight: FontWeight.w500,
            color: T.inkMuted,
          ),
        ),
        const SizedBox(height: T.s3),
        Row(
          children: [
            Icon(Icons.show_chart_rounded, size: 18, color: T.inkFaint),
            const SizedBox(width: T.s2),
            Expanded(
              child: Text(
                'No glucose readings logged in the last 14 days.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}
