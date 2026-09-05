import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../shared/widgets/load_failed.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/providers/preferences_provider.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/character_avatar.dart';
import '../../../shared/widgets/mood_avatar.dart';
import '../../../shared/widgets/status_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../glucose/domain/glucose_trends.dart';
import '../../glucose/presentation/glucose_providers.dart';
import '../../glucose/presentation/log_glucose_sheet.dart';
import '../../labtests/presentation/lab_tests_providers.dart';
import '../../medications/domain/medication.dart';
import '../../medications/presentation/medications_providers.dart';
import '../domain/care_summary.dart';
import 'home_providers.dart';
import 'widgets/appointments_section.dart';
import 'widgets/household_switcher.dart';
import 'widgets/home_glucose_chart.dart';
import '../../../shared/widgets/surfaces.dart';

/// The patient's home: their care as the clinic has set it out.
///
/// Read-only by design. This is the answer to "what am I supposed to be
/// doing", and every action it implies — logging a meal, ticking off a dose,
/// asking a question — already has a tab of its own. A second place to do
/// those things would be a second place to keep them in sync.
///
/// The page is ordered by urgency, not by category: what is happening today,
/// then the number that decides everything else, then the plan, then what the
/// patient has actually been eating, and only then the details on file. A
/// dashboard where every block is equally loud is a dashboard nobody scans.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  /// The home screen shows what the clinic has decided — a new prescription, a
  /// diet plan the dietician just sent, a fresh HbA1c. None of that is the
  /// patient's own doing, so waiting for them to pull-to-refresh means showing
  /// them yesterday's care and giving no sign there is anything newer.
  static const _pollInterval = Duration(seconds: 30);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back from the background is the likeliest moment for something to
    // have changed, so check at once rather than waiting out the timer.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (!mounted) return;
    ref.invalidate(careSummaryProvider);
    // Also the source the on-device reminders are built from: a dose the doctor
    // has just retimed should move on this screen *and* stop ringing at the old
    // hour, without waiting for the app to be backgrounded and reopened.
    ref.invalidate(medicationsListProvider);
    // Today's doses too, so a dose ticked off in the Medicines tab moves this
    // screen the moment the patient comes back to it.
    ref.invalidate(todayScheduleProvider);
    // And the lab reports: a report uploaded from the Profile tab, or an
    // analysis that finished on the server a minute after the upload, both have
    // to land here without the patient knowing to come back and pull down.
    ref.invalidate(labTestsProvider);
    // Every glucose window, so a reading logged anywhere moves all of them.
    invalidateGlucoseTrends(ref);
  }

  @override
  Widget build(BuildContext context) {
    final asyncCare = ref.watch(careSummaryProvider);
    // Read the last value during a background refresh: .when would drop the
    // whole screen to a spinner every thirty seconds.
    final loaded = asyncCare.valueOrNull;
    final async = loaded != null ? AsyncData<CareSummary>(loaded) : asyncCare;

    return Scaffold(
      // Transparent, and no ground of its own: the shell paints it once for
      // every tab, so it also runs behind the navigation bar.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async => _refresh(),
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => ListView(
                  padding: const EdgeInsets.all(T.s6),
                  children: [
                    const SizedBox(height: T.s12),
                    LoadFailed(
                      what: 'your care summary',
                      onRetry: () => ref.invalidate(careSummaryProvider),
                    ),
                  ],
                ),
            data:
                (care) => ListView(
                  // 24 down both sides, and the same again at the foot so the
                  // last card clears the navigation pill with air to spare.
                  padding: const EdgeInsets.fromLTRB(T.s6, T.s2, T.s6, T.s6),
                  children: [
                    _Header(
                      mood: switch (ref
                          .watch(glucoseTrendsProvider)
                          .valueOrNull
                          ?.series
                          .lastOrNull
                          ?.flag) {
                        'severe_low' ||
                        'low' ||
                        'severe_high' ||
                        'very_high' ||
                        'critical_high' ||
                        'high' => Mood.concerned,
                        null => Mood.watchful,
                        _ => Mood.calm,
                      },
                    ),
                    const SizedBox(height: T.s5),
                    _HeroCard(care: care),

                    // Directly under the hero, because it is the only thing on
                    // this screen with a deadline attached to it.
                    //
                    // There was no appointment section here at all. A patient
                    // asked for a time, the desk gave them one, and the screen
                    // they open every day said nothing about any of it — so the
                    // first they knew was the reminder the evening before, and
                    // a declined request they learned about from a push they
                    // had already swiped away.
                    const SizedBox(height: T.s8),
                    const AppointmentsSection(),

                    // Whose Home this is. Only rendered when the phone carries
                    // more than one person — a switcher above a single name is
                    // a control that answers a question nobody asked.
                    if (care.isHousehold) ...[
                      const SizedBox(height: T.s8),
                      HouseholdSwitcher(members: care.household),
                    ],

                    const SizedBox(height: T.s8),
                    _HealthProfileCard(care: care),

                    // Cards follow the patient's conditions. Diabetes brings
                    // the sugar chart, hypertension brings blood pressure, and
                    // an empty list means the server recorded none — which is
                    // read as "show everything", not "show nothing". Every
                    // patient is in that state today.
                    if (care.shows('glucose')) ...[
                      const SizedBox(height: T.s8),
                      _GlucoseSection(labHba1c: care.latestHba1c),
                    ],
                    if (care.dietPlan != null && care.shows('diet_plan')) ...[
                      const SizedBox(height: T.s8),
                      _DietPlanCard(plan: care.dietPlan!),
                    ],
                    const SizedBox(height: T.s8),
                    _FoodLogsCard(items: care.recentFoodLogs),
                    if (care.profile.allergies.isNotEmpty) ...[
                      const SizedBox(height: T.s8),
                      _AllergiesCard(items: care.profile.allergies),
                    ],
                  ],
                ),
          ),
        ),
      ),
    );
  }
}

// ---- Header ---------------------------------------------------------------

/// Greeting, name, and the two controls that used to be a whole app bar.
///
/// Not a card. It was one, and a panel around a greeting made the top of the
/// page look like another read-out to get past rather than someone saying
/// hello. Sitting directly on the ground it reads as the page's voice.
class _Header extends ConsumerWidget {
  const _Header({required this.mood});

  final Mood mood;

  static String _partOfDay() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  /// The first name only. "Good evening, Rahul Das" is a form field reading
  /// itself back; "Good evening, Rahul" is a person being addressed.
  static String _firstName(String full) {
    final parts = full.trim().split(RegExp(r'\s+'));
    return parts.isEmpty ? '' : parts.first;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final name = _firstName(user?.name ?? '');

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: name.isEmpty ? 'Welcome' : '${_partOfDay()}, ',
                      // Small, so the name it introduces is unmistakably the
                      // larger of the two. Set at title size this line ran
                      // past the notification button and took the name with
                      // it.
                      style: T.small.copyWith(
                        fontWeight: FontWeight.w500,
                        color: T.inkMuted,
                      ),
                    ),
                    if (name.isNotEmpty)
                      TextSpan(
                        text: name,
                        style: T.title.copyWith(
                          fontWeight: FontWeight.w800,
                          color: T.ink,
                        ),
                      ),
                    // An icon, not the emoji it replaces. A system emoji is
                    // whatever face the OS ships — it changes between
                    // manufacturers, ignores the app's type and colour, and on
                    // this phone rendered a flat yellow that belongs to no
                    // part of the palette.
                    const WidgetSpan(
                      alignment: PlaceholderAlignment.middle,
                      child: Padding(
                        padding: EdgeInsets.only(left: T.s2),
                        child: Icon(
                          Icons.waving_hand_rounded,
                          size: 18,
                          color: Color(0xFFE9A23B),
                        ),
                      ),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                "Here's your health summary",
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: T.small.copyWith(color: T.inkMuted),
              ),
            ],
          ),
        ),
        const SizedBox(width: T.s2),
        _RoundIconButton(
          icon: Icons.notifications_none_rounded,
          onTap: () => context.push('/profile/notifications'),
        ),
        const SizedBox(width: T.s2),
        GestureDetector(
          onTap: () => context.go('/profile'),
          child: StatusAvatar(
            name: user?.name ?? '',
            avatarUrl: user?.avatarUrl,
            role: CareRole.patient,
            gender: user?.gender,
            mood: mood,
            size: 44,
          ),
        ),
      ],
    );
  }
}

/// A white disc with a hairline — the header's only control shape.
class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        // 48 of target around a 44 disc: the drawn size is the reference's,
        // the touched size is the one the guidelines ask for.
        child: SizedBox(
          width: T.tap,
          height: T.tap,
          child: Center(
            child: Container(
              width: T.hCircle,
              height: T.hCircle,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border: Border.all(color: T.line),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x0A0B1B3A),
                    blurRadius: 12,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: Icon(icon, size: 20, color: T.ink),
            ),
          ),
        ),
      ),
    );
  }
}

// ---- Today ----------------------------------------------------------------

/// The one saturated surface on the screen, and therefore what the eye lands
/// on first.
///
/// It carries whichever of two facts is actually pressing: the next dose due
/// today, or — when the day's doses are done — the next clinic visit. A card
/// this prominent has to earn it by being the most useful sentence on the
/// page, not by being the prettiest.
class _HeroCard extends ConsumerWidget {
  const _HeroCard({required this.care});

  final CareSummary care;

  /// Where the photograph lives. Replacing it is a file swap and nothing else
  /// — see assets/cards/README.md.
  static const _photo = 'assets/cards/consult.jpg';

  /// The drawn stand-in, used only until the photograph is dropped in.
  static const _drawn = 'assets/cards/consult.png';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slots =
        ref.watch(todayScheduleProvider).valueOrNull?.slots ??
        const <MedicationScheduleSlot>[];
    final pending = slots.where((s) => s.status == 'pending').toList();
    final next = pending.firstOrNull;

    final String eyebrow;
    final String headline;
    final String detail;
    if (next != null) {
      eyebrow = 'TODAY';
      headline =
          pending.length == 1 ? '1 dose due' : '${pending.length} doses due';
      detail = '${next.name} at ${next.time}';
    } else if (care.followUpOn != null) {
      eyebrow = 'NEXT VISIT';
      headline = DateFormat('d MMM').format(care.followUpOn!);
      detail = DateFormat('EEEE').format(care.followUpOn!);
    } else {
      eyebrow = 'TODAY';
      headline = 'All clear';
      detail = 'Nothing due right now';
    }

    // The encouragement only appears when there is genuinely nothing
    // outstanding. Telling someone they are on track while three doses sit
    // unticked is the kind of cheerfulness that teaches people to ignore an
    // app.
    final onTrack = next == null;

    return Semantics(
      button: true,
      label: '$headline. $detail',
      child: GestureDetector(
        onTap: () => context.go('/medications'),
        child: Container(
          height: 208,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(T.rSection),
            boxShadow: const [
              BoxShadow(
                color: Color(0x38003399),
                blurRadius: 24,
                offset: Offset(0, 10),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Anchored right so a portrait crop keeps the faces, and behind
              // a blue base so the card is never white while it decodes.
              const ColoredBox(color: Color(0xFF1B45C9)),
              Image.asset(
                _photo,
                fit: BoxFit.cover,
                alignment: Alignment.centerRight,
                // Two fallbacks deep on purpose. The photograph is the one
                // asset that has to be supplied by hand, so the card degrades
                // to the drawn consultation and then to a plain gradient
                // rather than to a broken-image box on a patient's home.
                errorBuilder:
                    (_, _, _) => Image.asset(
                      _drawn,
                      fit: BoxFit.cover,
                      alignment: Alignment.centerRight,
                      errorBuilder:
                          (_, _, _) => const DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [Color(0xFF2C5BE0), Color(0xFF0B2C86)],
                              ),
                            ),
                          ),
                    ),
              ),
              // Left-weighted scrim. The words live on that half, and a
              // photograph will not be as obliging about its own contrast as
              // an illustration drawn to leave room.
              // Left-weighted, and weighted to the *text*, not to the middle
              // of the card. It holds near-opaque across the headline, gives
              // up most of the way through the doctor so he reads as emerging
              // from the blue rather than sitting behind a panel, and is
              // almost gone by the patient at 86%.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [
                      Color(0xF71B45C9),
                      Color(0xE61B45C9),
                      Color(0x8C1B45C9),
                      Color(0x1F1B45C9),
                      Color(0x0A1B45C9),
                    ],
                    stops: [0, 0.28, 0.52, 0.78, 1],
                  ),
                ),
              ),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x00000000), Color(0x3D0B1B3A)],
                    stops: [0.55, 1],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(T.s5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _HeroChip(
                      label: eyebrow,
                      icon:
                          next != null
                              ? Icons.schedule_rounded
                              : Icons.check_circle_rounded,
                    ),
                    const SizedBox(height: T.s2),
                    Text(
                      headline,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.display.copyWith(
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.small.copyWith(
                        color: Colors.white.withValues(alpha: 0.88),
                      ),
                    ),
                    const Spacer(),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (onTrack)
                          Flexible(
                            child: _OnTrackNote(
                              title: "You're on track!",
                              detail: 'Keep it up.',
                            ),
                          )
                        else
                          const Spacer(),
                        const SizedBox(width: T.s2),
                        const _ViewDetailsButton(),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The eyebrow pill on the hero. Hand-rolled rather than the shared glass chip
/// so its contrast is fixed against the one background it ever sits on.
class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.label, required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(T.s2, 5, T.s3, 5),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.20),
      borderRadius: T.rFull,
      border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: Colors.white),
        const SizedBox(width: 5),
        Text(
          label,
          style: T.label.copyWith(
            color: Colors.white,
            letterSpacing: 0.6,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _OnTrackNote extends StatelessWidget {
  const _OnTrackNote({required this.title, required this.detail});

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s2),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.16),
      borderRadius: BorderRadius.circular(T.rControl),
      border: Border.all(color: Colors.white.withValues(alpha: 0.24)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.22),
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.thumb_up_rounded,
            size: 14,
            color: Colors.white,
          ),
        ),
        const SizedBox(width: T.s2),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: T.label.copyWith(
                  fontSize: 12,
                  letterSpacing: 0,
                  color: Colors.white,
                ),
              ),
              Text(
                detail,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: T.label.copyWith(
                  fontSize: 11,
                  letterSpacing: 0,
                  fontWeight: FontWeight.w400,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Visible affordance for a card that is entirely tappable. The whole hero
/// takes the tap; this is what says so.
class _ViewDetailsButton extends StatelessWidget {
  const _ViewDetailsButton();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(T.s4, 10, T.s3, 10),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(T.rControl),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'View details',
          style: T.small.copyWith(
            fontWeight: FontWeight.w700,
            color: T.primary,
          ),
        ),
        const SizedBox(width: T.s2),
        Icon(Icons.arrow_forward_rounded, size: 16, color: T.primary),
      ],
    ),
  );
}

// ---- Health profile -------------------------------------------------------

/// Condition, body measurements, and how often the clinic looks at the food
/// log. Four full-width cards' worth of content in one.
class _HealthProfileCard extends StatelessWidget {
  const _HealthProfileCard({required this.care});

  final CareSummary care;

  @override
  Widget build(BuildContext context) {
    final p = care.profile;
    final condition = p.conditionLabel;
    final review = p.reviewLabel;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.person_outline_rounded,
            title: 'Health profile',
          ),
          const SizedBox(height: T.s4),
          // Stacked, not side by side. The reference sets these two in one
          // row, but that row is 740px wide there and 312 here — split in
          // half it gave "Type 2 Diabetes" two lines and clipped the review
          // to "Food log ... / Every ...", which is worse than either the
          // reference or what it replaced.
          Row(
            children: [
              Expanded(
                child: Text(
                  condition ?? 'Condition not set',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.title.copyWith(
                    fontWeight: FontWeight.w800,
                    color: condition == null ? T.inkMuted : T.ink,
                  ),
                ),
              ),
              if (condition != null) ...[
                const SizedBox(width: T.s2),
                const StatusPill(
                  label: 'Active',
                  status: Status.ok,
                  icon: Icons.autorenew_rounded,
                ),
              ],
            ],
          ),
          if (review != null) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              tone: T.primaryTint,
              onTap: () => context.push('/food-log/history'),
              child: Row(
                children: [
                  Icon(Icons.event_repeat_rounded, size: 20, color: T.primary),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: Text(
                      'Food log review',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                  ),
                  const SizedBox(width: T.s2),
                  Text(
                    review,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(
                      fontWeight: FontWeight.w700,
                      color: T.ink,
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded, size: 18, color: T.primary),
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s4),
          const Divider(height: 1, color: T.line),
          const SizedBox(height: T.s4),
          Row(
            children: [
              _BodyMetric(
                icon: Icons.monitor_weight_outlined,
                value: p.weightKg == null ? '—' : _trim(p.weightKg!),
                unit: p.weightKg == null ? null : 'kg',
                label: 'Weight',
              ),
              const _MetricDivider(),
              _BodyMetric(
                icon: Icons.straighten_rounded,
                value: p.heightCm == null ? '—' : '${p.heightCm}',
                unit: p.heightCm == null ? null : 'cm',
                label: 'Height',
              ),
              const _MetricDivider(),
              _BodyMetric(
                icon: Icons.speed_rounded,
                value: p.bmi == null ? '—' : _trim(p.bmi!),
                label: 'BMI',
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// 83 rather than 83.0, but 83.5 stays 83.5.
  static String _trim(num v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1);
}

class _BodyMetric extends StatelessWidget {
  const _BodyMetric({
    required this.icon,
    required this.value,
    required this.label,
    this.unit,
  });

  final IconData icon;
  final String value;
  final String? unit;
  final String label;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Icon(icon, size: 20, color: T.inkMuted),
        const SizedBox(height: T.s2),
        MetricValue(value: value, unit: unit, size: 20),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: T.label.copyWith(
            fontWeight: FontWeight.w500,
            letterSpacing: 0,
            color: T.inkMuted,
          ),
        ),
      ],
    ),
  );
}

class _MetricDivider extends StatelessWidget {
  const _MetricDivider();

  @override
  Widget build(BuildContext context) =>
      Container(width: 1, height: 44, color: T.line);
}

// ---- Glucose --------------------------------------------------------------

/// The section that decides everything else on the screen, so it gets the most
/// room and the only interactive control on the page.
class _GlucoseSection extends ConsumerStatefulWidget {
  const _GlucoseSection({required this.labHba1c});

  /// The lab result, shown *beside* the estimate rather than instead of it.
  final Hba1cResult? labHba1c;

  @override
  ConsumerState<_GlucoseSection> createState() => _GlucoseSectionState();
}

class _GlucoseSectionState extends ConsumerState<_GlucoseSection> {
  GlucoseRange _range = GlucoseRange.d30;

  static String _windowLabel(GlucoseRange r) => switch (r) {
    GlucoseRange.d7 => 'Last 7 days',
    GlucoseRange.d30 => 'Last 30 days',
    GlucoseRange.m3 => 'Last 3 months',
    GlucoseRange.m6 => 'Last 6 months',
  };

  /// The stats rail runs to the card's right wall, so a half-visible tile
  /// shows there is more to swipe to. Everything else keeps the gutter.
  static const _gutter = EdgeInsets.only(right: T.s5);

  @override
  Widget build(BuildContext context) {
    final unit = ref.watch(appPreferencesProvider).glucoseUnit;
    final async = ref.watch(glucoseTrendsRangeProvider(_range));

    return SectionCard(
      padding: const EdgeInsets.fromLTRB(T.s5, T.s5, 0, T.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: _gutter,
            child: SectionHeader(
              icon: Icons.monitor_heart_outlined,
              title: 'Glucose',
              subtitle: _windowLabel(_range),
              trailing: ActionLink(
                label: 'Add reading',
                leadingIcon: Icons.add_rounded,
                onTap: () => showLogGlucoseSheet(context),
              ),
            ),
          ),
          const SizedBox(height: T.s4),
          async.when(
            loading:
                () => SizedBox(
                  height: 180,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5),
                        ),
                        const SizedBox(height: T.s3),
                        Text(
                          'Loading ${_windowLabel(_range).toLowerCase()}...',
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                      ],
                    ),
                  ),
                ),
            error:
                (_, _) => Padding(
                  padding: const EdgeInsets.fromLTRB(0, T.s5, T.s5, T.s5),
                  child: Text(
                    'Could not load your readings.',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                ),
            data: (t) {
              if (t.series.length < 2) {
                return const Padding(padding: _gutter, child: _CheckInPrompt());
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StatsRail(trends: t, unit: unit, labHba1c: widget.labHba1c),
                  const SizedBox(height: T.s5),
                  Padding(
                    padding: _gutter,
                    child: HomeGlucoseChart(points: t.series, unit: unit),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: T.s4),
          Padding(
            padding: _gutter,
            child: _RangePicker(
              value: _range,
              onChanged: (r) => setState(() => _range = r),
            ),
          ),
        ],
      ),
    );
  }
}

/// What a server flag means, in the two forms this screen needs it: a colour
/// and a word.
///
/// Derived from `reading.flag`, never re-thresholded here. The clinic sets the
/// bands; a second copy in the client is a second thing to get wrong, and the
/// one that would be wrong silently.
({Status status, String label}) _flagVerdict(String? flag) => switch (flag) {
  'critical_high' ||
  'severe_high' => (status: Status.alert, label: 'Needs attention'),
  'very_high' => (status: Status.alert, label: 'Well above target'),
  'high' => (status: Status.watch, label: 'Above target'),
  'severe_low' => (status: Status.alert, label: 'Needs attention'),
  'low' => (status: Status.watch, label: 'Below target'),
  'in_range' => (status: Status.ok, label: 'Within range'),
  _ => (status: Status.neutral, label: 'No band set'),
};

/// The window's figures, as one swipeable rail.
///
/// This was a 2x2 grid, and with the lab result stacked underneath it the
/// block ran to roughly 250dp — so the chart, which is the part worth looking
/// at, started below the fold on every phone. Four across in a fixed row was
/// the other thing tried, and at 360dp it left each tile about 76dp and
/// truncated every status word; the status word is the clinical content, so
/// that was the worse trade.
///
/// A rail keeps the tiles wide enough to read, puts the chart back above the
/// fold, and gives the lab result somewhere to sit that shares the rhythm
/// instead of interrupting it — same shape, same type, tinted to say it comes
/// from a blood test rather than from the readings in this window.
class _StatsRail extends StatelessWidget {
  const _StatsRail({
    required this.trends,
    required this.unit,
    required this.labHba1c,
  });

  final GlucoseTrends trends;
  final GlucoseUnit unit;
  final Hba1cResult? labHba1c;

  /// The reading that produced a stat, so its own server flag and timestamp
  /// can be shown rather than re-derived.
  GlucoseTrendPoint? _pointFor(num? value) {
    if (value == null) return null;
    for (final p in trends.series) {
      if ((p.value - value).abs() < 0.01) return p;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final s = trends.stats;
    final lowest = _pointFor(s.min);
    final highest = _pointFor(s.max);

    // The average is not a reading, so it carries no server flag. It is judged
    // against the same general band the chart shades, and worded with that in
    // mind — "above target", not "high".
    final avg =
        s.average == null
            ? (status: Status.neutral, label: '-')
            : s.average! > kTargetHighMgdl
            ? (status: Status.watch, label: 'Above target')
            : s.average! < kTargetLowMgdl
            ? (status: Status.alert, label: 'Below target')
            : (status: Status.ok, label: 'Within range');

    final tiles = <Widget>[
      _StatTile(
        label: 'Average',
        value:
            s.average == null ? '—' : unit.format(s.average!, withUnit: false),
        unit: s.average == null ? null : unit.label,
        pill: s.average == null ? null : avg.label,
        status: avg.status,
      ),
      _StatTile(
        label: 'Lowest',
        value: s.min == null ? '—' : unit.format(s.min!, withUnit: false),
        unit: s.min == null ? null : unit.label,
        pill: s.min == null ? null : _flagVerdict(lowest?.flag).label,
        status: _flagVerdict(lowest?.flag).status,
        at: lowest?.at,
      ),
      _StatTile(
        label: 'Highest',
        value: s.max == null ? '—' : unit.format(s.max!, withUnit: false),
        unit: s.max == null ? null : unit.label,
        pill: s.max == null ? null : _flagVerdict(highest?.flag).label,
        status: _flagVerdict(highest?.flag).status,
        at: highest?.at,
      ),
      _StatTile(
        label: 'Estimated HbA1c',
        value:
            s.estimatedHba1c == null
                ? '—'
                : '~${s.estimatedHba1c!.toStringAsFixed(1)}',
        unit: s.estimatedHba1c == null ? null : '%',
        footnote: 'From your readings',
        status: Status.neutral,
        info:
            'Worked out from the readings you have logged, not from a blood '
            'test. It moves as you log more.',
      ),
      // Two numbers both called HbA1c, points apart, with neither saying where
      // it came from was the most alarming thing this screen could have done.
      // Adjacent and differently tinted, the distinction is unmissable.
      if (labHba1c != null)
        _StatTile(
          label: 'Lab HbA1c',
          value: labHba1c!.percentage.toStringAsFixed(1),
          unit: '%',
          footnote:
              labHba1c!.testedOn == null
                  ? 'From a blood test'
                  : 'Tested ${DateFormat('d MMM').format(labHba1c!.testedOn!)}',
          status: labHba1c!.isHigh ? Status.alert : Status.neutral,
          tone: T.primaryTint,
          onTap: () => context.push('/profile/tests'),
        ),
    ];

    return SizedBox(
      // Scaled by the text factor: the tiles hold four short lines and would
      // clip at the larger accessibility sizes.
      height: MediaQuery.textScalerOf(context).scale(114),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.only(right: T.s5),
        itemCount: tiles.length,
        separatorBuilder: (_, _) => const SizedBox(width: T.s3),
        itemBuilder: (_, i) => SizedBox(width: 148, child: tiles[i]),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.status,
    this.unit,
    this.pill,
    this.footnote,
    this.at,
    this.info,
    this.tone,
    this.onTap,
  });

  final String label;
  final String value;
  final String? unit;
  final Status status;
  final String? pill;
  final String? footnote;

  /// When this reading was taken. Shown for the extremes, where "438" means
  /// something quite different this morning than three weeks ago.
  final DateTime? at;
  final String? info;
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      padding: const EdgeInsets.all(T.s3),
      tone: tone,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.label.copyWith(
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0,
                    color: T.inkMuted,
                  ),
                ),
              ),
              if (info != null)
                Tooltip(
                  message: info!,
                  triggerMode: TooltipTriggerMode.tap,
                  showDuration: const Duration(seconds: 6),
                  child: Icon(
                    Icons.info_outline_rounded,
                    size: 14,
                    color: T.inkFaint,
                  ),
                ),
              if (onTap != null)
                Icon(Icons.chevron_right_rounded, size: 16, color: T.primary),
            ],
          ),
          const SizedBox(height: T.s1),
          MetricValue(
            value: value,
            unit: unit,
            size: 24,
            color: status == Status.alert ? T.danger : null,
          ),
          const Spacer(),
          if (pill != null)
            StatusPill(
              label: pill!,
              status: status,
              icon:
                  status == Status.alert
                      ? Icons.warning_amber_rounded
                      : status == Status.ok
                      ? Icons.check_rounded
                      : null,
            ),
          if (at != null) ...[
            const SizedBox(height: T.s1),
            Text(
              DateFormat('d MMM, h:mm a').format(at!),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.label.copyWith(
                fontSize: 10,
                letterSpacing: 0,
                fontWeight: FontWeight.w500,
                color: T.inkFaint,
              ),
            ),
          ],
          if (footnote != null)
            Text(
              footnote!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.label.copyWith(
                fontSize: 10,
                letterSpacing: 0,
                fontWeight: FontWeight.w500,
                color: T.inkFaint,
              ),
            ),
        ],
      ),
    );
  }
}

class _RangePicker extends StatelessWidget {
  const _RangePicker({required this.value, required this.onChanged});

  final GlucoseRange value;
  final ValueChanged<GlucoseRange> onChanged;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      for (final r in GlucoseRange.values) ...[
        if (r != GlucoseRange.values.first) const SizedBox(width: T.s2),
        Semantics(
          button: true,
          selected: r == value,
          child: GestureDetector(
            onTap: () => onChanged(r),
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              padding: const EdgeInsets.symmetric(
                horizontal: T.s5,
                vertical: T.s2,
              ),
              decoration: BoxDecoration(
                color: r == value ? T.primary : const Color(0xFFF1F4F9),
                borderRadius: T.rFull,
              ),
              child: Text(
                r.label,
                style: T.small.copyWith(
                  fontWeight: FontWeight.w700,
                  color: r == value ? Colors.white : T.inkMuted,
                ),
              ),
            ),
          ),
        ),
      ],
    ],
  );
}

/// Shown when there are too few readings to draw a trend — a friendly first
/// check-in nudge in place of an empty chart.
class _CheckInPrompt extends StatelessWidget {
  const _CheckInPrompt();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Log a reading every few days and your trend builds here — the same '
          'one your doctor sees.',
          style: T.small.copyWith(color: T.inkMuted),
        ),
        const SizedBox(height: T.s4),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: () => showLogGlucoseSheet(context),
            icon: const Icon(Icons.add_rounded, size: 20),
            label: const Text('Add your first reading'),
            style: FilledButton.styleFrom(
              backgroundColor: T.primary,
              minimumSize: const Size.fromHeight(T.tap),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(T.rControl),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ---- Diet plan ------------------------------------------------------------

/// Today's plan as five things to eat, not as three paragraphs about eating.
///
/// The card used to open with the dietician's goal sentence and then truncate
/// every meal to a line and a half — so the part a patient reads at 8am ("what
/// am I having for breakfast") was the part that got cut. The goal moved to
/// the full-plan sheet; the calorie target, which is the one number worth
/// carrying, was pulled out of that sentence and given its own line.
class _DietPlanCard extends StatelessWidget {
  const _DietPlanCard({required this.plan});

  final PatientDietPlan plan;

  /// The daily calorie target, out of whatever prose the dietician wrote it
  /// into. Null when they did not write one — which is common, and not an
  /// error to paper over with a zero.
  static String? _calorieTarget(PatientDietPlan plan) {
    final match = RegExp(
      r'(\d{3,5}(?:,\d{3})*)\s*k?\s*cal',
      caseSensitive: false,
    ).firstMatch('${plan.goal} ${plan.notes}');
    if (match == null) return null;
    final n = int.tryParse(match.group(1)!.replaceAll(',', ''));
    if (n == null || n < 500 || n > 6000) return null;
    return NumberFormat.decimalPattern().format(n);
  }

  /// One icon per meal, chosen from its name. A rail of five identical forks
  /// gives the eye nothing to aim at.
  static IconData _mealIcon(String name) {
    final n = name.toLowerCase();
    if (n.contains('break')) return Icons.wb_twilight_rounded;
    if (n.contains('mid') || n.contains('snack')) return Icons.eco_rounded;
    if (n.contains('lunch')) return Icons.wb_sunny_rounded;
    if (n.contains('even') || n.contains('tea'))
      return Icons.local_cafe_rounded;
    if (n.contains('dinner') || n.contains('night')) {
      return Icons.nightlight_round;
    }
    return Icons.restaurant_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final kcal = _calorieTarget(plan);

    return SectionCard(
      // The rail runs to the card's right wall, so a half-visible tile shows
      // there is more to swipe to. Its own padding restores the gutter.
      padding: const EdgeInsets.fromLTRB(T.s5, T.s5, 0, T.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: T.s5),
            child: SectionHeader(
              icon: Icons.restaurant_menu_rounded,
              title: "Today's diet plan",
              subtitle:
                  plan.sharedAt == null
                      ? null
                      : 'Updated ${DateFormat('d MMM').format(plan.sharedAt!)}',
            ),
          ),
          if (kcal != null) ...[
            const SizedBox(height: T.s4),
            Text(
              'Daily target',
              style: T.label.copyWith(
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
                color: T.inkMuted,
              ),
            ),
            const SizedBox(height: 2),
            MetricValue(value: kcal, unit: 'kcal', size: 26, color: T.primary),
          ],
          if (plan.meals.isNotEmpty) ...[
            const SizedBox(height: T.s4),
            SizedBox(
              // Scaled by the text factor: the tiles hold three lines of meal
              // description and would clip at the larger accessibility sizes.
              height: MediaQuery.textScalerOf(context).scale(154),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(right: T.s5),
                itemCount: plan.meals.length,
                separatorBuilder: (_, _) => const SizedBox(width: T.s3),
                itemBuilder: (context, i) {
                  final m = plan.meals[i];
                  return SizedBox(
                    width: 154,
                    child: InnerTile(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                _mealIcon(m.name),
                                size: 16,
                                color: T.primary,
                              ),
                              const SizedBox(width: T.s1),
                              Expanded(
                                child: Text(
                                  m.time,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: T.label.copyWith(
                                    fontSize: 11,
                                    letterSpacing: 0,
                                    color: T.inkMuted,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: T.s1),
                          Text(
                            m.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: T.small.copyWith(
                              fontWeight: FontWeight.w700,
                              color: T.ink,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Expanded(
                            child: Text(
                              m.summary,
                              maxLines: 5,
                              overflow: TextOverflow.ellipsis,
                              style: T.label.copyWith(
                                fontSize: 11,
                                height: 1.35,
                                letterSpacing: 0,
                                fontWeight: FontWeight.w500,
                                color: T.inkMuted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: T.s3),
          Padding(
            padding: const EdgeInsets.only(right: T.s5),
            child: Center(
              child: ActionLink(
                label: 'View full plan',
                onTap:
                    () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => _FullPlanSheet(plan: plan),
                    ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The whole plan, including the avoid list and any closing note. Shown as a
/// sheet rather than a PDF: there is no document to open, and a link that
/// promised one would be a link that breaks.
class _FullPlanSheet extends StatelessWidget {
  const _FullPlanSheet({required this.plan});

  final PatientDietPlan plan;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder:
          (context, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const Text(
                'Your diet plan',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
              if (plan.dieticianName != null) ...[
                const SizedBox(height: 4),
                Text(
                  'From ${plan.dieticianName}',
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (plan.goal.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  plan.goal,
                  style: const TextStyle(fontSize: 14, height: 1.5),
                ),
              ],
              for (final meal in plan.meals) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  meal.time.isEmpty ? meal.name : '${meal.name} · ${meal.time}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                for (final item in meal.items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '•  $item',
                      style: const TextStyle(fontSize: 14, height: 1.45),
                    ),
                  ),
                if (meal.notes.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      meal.notes,
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
              if (plan.avoid.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                const Text(
                  'Best avoided',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    for (final item in plan.avoid)
                      Chip(
                        label: Text(item),
                        visualDensity: VisualDensity.compact,
                      ),
                  ],
                ),
              ],
              if (plan.notes.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  plan.notes,
                  style: const TextStyle(fontSize: 14, height: 1.5),
                ),
              ],
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
    );
  }
}

// ---- Medicines ------------------------------------------------------------

// ---- Food logs ------------------------------------------------------------

// ---- Food logs ------------------------------------------------------------

/// Meals, not lab reports.
///
/// A result is something a patient reads once and cannot act on from here; a
/// photograph of what they ate yesterday is the most engaging thing in the app
/// and the one that gets them logging the next one.
class _FoodLogsCard extends StatelessWidget {
  const _FoodLogsCard({required this.items});

  final List<CareFoodLog> items;

  static String _when(DateTime? at) {
    if (at == null) return '';
    final now = DateTime.now();
    final day = DateTime(at.year, at.month, at.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(day).inDays;
    final date = switch (diff) {
      0 => 'Today',
      1 => 'Yesterday',
      _ => DateFormat('d MMM').format(at),
    };
    return '$date • ${DateFormat('h:mm a').format(at)}';
  }

  static String _meal(String type) =>
      type.isEmpty ? 'Meal' : type[0].toUpperCase() + type.substring(1);

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.fromLTRB(T.s5, T.s5, 0, T.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: T.s5),
            child: SectionHeader(
              icon: Icons.photo_camera_outlined,
              title: 'Recent food logs',
              trailing:
                  items.isEmpty
                      ? null
                      : ActionLink(
                        label: 'View all',
                        // The meal history, not the dietician thread. Logging
                        // happens in the conversation, so "Log a meal" below
                        // rightly opens it — but "View all" beside a row of
                        // past meals means show me the rest of them, and
                        // dropping the patient into a chat is not that.
                        onTap: () => context.push('/food-log/history'),
                      ),
            ),
          ),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(0, T.s5, T.s5, T.s2),
              child: Column(
                children: [
                  Icon(
                    Icons.restaurant_menu_rounded,
                    size: 32,
                    color: T.inkFaint,
                  ),
                  const SizedBox(height: T.s2),
                  Text(
                    'No meals logged yet',
                    style: T.small.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Photos of what you eat help your dietician give better '
                    'advice.',
                    textAlign: TextAlign.center,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                  const SizedBox(height: T.s4),
                  FilledButton.icon(
                    onPressed: () => context.go('/food-log'),
                    icon: const Icon(Icons.add_a_photo_rounded, size: 18),
                    label: const Text('Log a meal'),
                    style: FilledButton.styleFrom(
                      backgroundColor: T.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(T.rControl),
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            SizedBox(
              height: T.s4 + MediaQuery.textScalerOf(context).scale(118),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(top: T.s4, right: T.s5),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(width: T.s3),
                itemBuilder:
                    (context, i) => _FoodLogTile(
                      log: items[i],
                      when: _when(items[i].createdAt),
                      meal: _meal(items[i].mealType),
                    ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One meal in the rail. Every tile is the same rectangle, the same radius and
/// the same caption position — the rail's whole job is to be scanned, and a
/// row of differently-shaped photographs cannot be.
class _FoodLogTile extends StatelessWidget {
  const _FoodLogTile({
    required this.log,
    required this.when,
    required this.meal,
  });

  final CareFoodLog log;
  final String when;
  final String meal;

  @override
  Widget build(BuildContext context) {
    final hasPhoto = log.photoUrl != null;

    return SizedBox(
      width: 150,
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFF1F4F9),
          borderRadius: BorderRadius.circular(T.rControl),
          border: Border.all(color: const Color(0xFFEEF2F8)),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (hasPhoto)
              AuthedImage(path: log.photoUrl!, fit: BoxFit.cover)
            else
              Icon(Icons.restaurant_rounded, size: 28, color: T.inkFaint),

            // Without a scrim a caption over a bright plate is unreadable and
            // over a dark one it disappears. This makes the bottom third
            // predictable whatever the photograph is doing.
            if (hasPhoto)
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.center,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x00000000), Color(0xD9000000)],
                  ),
                ),
              ),

            Positioned(
              left: T.s2,
              right: T.s2,
              bottom: T.s2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: T.s2,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color:
                          hasPhoto
                              ? Colors.white.withValues(alpha: 0.92)
                              : Colors.white,
                      borderRadius: T.rFull,
                    ),
                    child: Text(
                      meal,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.label.copyWith(
                        fontSize: 11,
                        letterSpacing: 0,
                        color: T.ink,
                      ),
                    ),
                  ),
                  if (when.isNotEmpty) ...[
                    const SizedBox(height: T.s1),
                    Text(
                      when,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: T.label.copyWith(
                        fontSize: 10,
                        letterSpacing: 0,
                        fontWeight: FontWeight.w500,
                        color:
                            hasPhoto
                                ? Colors.white.withValues(alpha: 0.90)
                                : T.inkMuted,
                      ),
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

// ---- Allergies ------------------------------------------------------------

/// Not in the reference layout, and kept anyway: an allergy is the one fact on
/// this screen that exists to stop something happening. It shows only when the
/// patient has one on file, so for most people the page ends at the food logs.
class _AllergiesCard extends StatelessWidget {
  const _AllergiesCard({required this.items});

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.warning_amber_rounded,
            title: 'Allergies',
          ),
          const SizedBox(height: T.s4),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              for (final a in items) StatusPill(label: a, status: Status.alert),
            ],
          ),
        ],
      ),
    );
  }
}
