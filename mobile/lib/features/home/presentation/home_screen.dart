import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/active_patient.dart';
import '../../../shared/widgets/character_avatar.dart';
import '../../../shared/widgets/mood_avatar.dart';
import '../../../shared/widgets/status_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../glucose/presentation/glucose_providers.dart';
import '../../labtests/presentation/lab_tests_providers.dart';
import '../../medications/presentation/medications_providers.dart';
import '../../shell/presentation/care_access.dart';
import '../../shell/presentation/load_stamps.dart';
import '../../shell/presentation/widgets/patient_kit.dart';
import '../../sharing/presentation/widgets/sharing_question_card.dart';
import 'home_providers.dart';
import 'widgets/appointments_section.dart';
import 'widgets/clinic_message_card.dart';
import 'widgets/diet_plan_card.dart';
import 'widgets/health_summary_card.dart';
import 'widgets/home_glucose_section.dart';
import 'widgets/household_switcher.dart';
import 'widgets/recent_meals_card.dart';
import 'widgets/today_card.dart';

/// The patient's home: what today asks of them, and then their care.
///
/// Ordered by what a patient opening the app wants to know first:
///
///  1. whose record this is, when the phone carries more than one person;
///  2. today — the doses, the next one, a sugar check when one is due;
///  3. appointments, the only other thing here with a date attached;
///  4. a recent message from somebody at the clinic;
///  5. blood sugar — the latest reading and the trend;
///  6. the diet plan and the meals logged against it;
///  7. what the clinic has on file.
///
/// Each section loads and fails on its own. The whole page used to hang off one
/// request, so a care summary that could not be fetched blanked today's doses
/// too, although they come from a different request that had succeeded.
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
    // A reply from the doctor.
    ref.invalidate(latestClinicMessageProvider);
    // Whether the patient is anybody's patient: a desk may have just enrolled
    // them, and that is what brings the Doctor and Dietician tabs.
    ref.invalidate(patientEnrolmentsProvider);
    // Every glucose window, so a reading logged anywhere moves all of them.
    invalidateGlucoseTrends(ref);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final asyncCare = ref.watch(careSummaryProvider);
    // The last value during a background refresh, so the cards do not drop to
    // skeletons every thirty seconds — but not while switching to another
    // person, when the value still attached is the previous person's care.
    final care = asyncCare.isReloading ? null : asyncCare.valueOrNull;
    final careFailed = care == null && asyncCare.hasError;
    final careStale = care != null && asyncCare.hasError;
    final enrolled = ref.watch(clinicCareProvider) == ClinicCare.enrolled;

    // The conversation belongs to the signed-in login, not to whichever family
    // member is being looked at; under a child's name it would put the
    // parent's doctor's words on the child's Home. Only for somebody enrolled
    // at a practice, and hidden when it cannot be fetched — the Doctor tab has
    // its own, fuller, failure state.
    final clinicMessage =
        enrolled && ref.watch(activePatientProvider) == null
            ? ref.watch(latestClinicMessageProvider).valueOrNull
            : null;

    final sections = <Widget>[
      if (care != null && care.isHousehold)
        HouseholdSwitcher(members: care.household),
      if (careStale)
        StaleNotice(
          loadedAt: LoadStamps.of(LoadStamps.careSummary),
          onRetry: _refresh,
        ),
      TodayCard(showCheckIn: care?.shows('glucose') ?? false),
      AppointmentsSection(followUpOn: care?.followUpOn),
      // A clinic connected to this record is waiting on the patient's answer
      // about what else it may see (C8). Nothing is drawn when nothing waits.
      const SharingQuestionsBanner(),
      if (clinicMessage != null) ClinicMessageCard(message: clinicMessage),
      if (care == null && !careFailed) ...[
        const SkeletonSection(lines: 4),
        const SkeletonSection(),
      ],
      if (careFailed)
        SectionLoadFailed(
          message: l10n.ptCouldNotLoadCarePlan,
          onRetry: () => ref.invalidate(careSummaryProvider),
        ),
      if (care != null) ...[
        // Cards follow the patient's conditions. An empty list means the
        // server recorded none, which is read as "show everything".
        if (care.shows('glucose'))
          HomeGlucoseSection(labHba1c: care.latestHba1c),
        if (care.dietPlan != null && care.shows('diet_plan'))
          DietPlanCard(plan: care.dietPlan!),
        // Meals are logged for a dietician. With no practice there is nobody
        // to log them for, so an empty card asking for them is noise; meals
        // already logged are still the patient's and still shown.
        if (enrolled || care.recentFoodLogs.isNotEmpty)
          RecentMealsCard(items: care.recentFoodLogs),
        HealthSummaryCard(profile: care.profile),
      ],
    ];

    return Scaffold(
      // Transparent, and no ground of its own: the shell paints it once for
      // every tab, so it also runs behind the navigation bar.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async => _refresh(),
          child: ListView(
            padding: const EdgeInsets.only(bottom: T.s8),
            children: [
              const _Header(),
              Padding(
                padding: kPatientGutter,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, section) in sections.indexed) ...[
                      if (i > 0) const SizedBox(height: kSectionGap),
                      section,
                    ],
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

/// The greeting, the patient's first name, and their face as the way to
/// Profile.
///
/// No bell. It opened notification *settings*, not notifications — a bell that
/// leads to switches is a promise of messages the app does not keep — and the
/// settings are one row away in Profile. No waving-hand glyph in a colour the
/// palette does not have, and no "Here's your health summary" under the name.
class _Header extends ConsumerWidget {
  const _Header();

  static String _firstName(String full) {
    final parts = full.trim().split(RegExp(r'\s+'));
    return parts.isEmpty ? '' : parts.first;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider).user;
    final name = _firstName(user?.name ?? '');
    final hour = DateTime.now().hour;
    final greeting =
        hour < 12
            ? l10n.ptGreetingMorning
            : hour < 17
            ? l10n.ptGreetingAfternoon
            : l10n.ptGreetingEvening;

    return PatientTabHeader(
      eyebrow: name.isEmpty ? null : greeting,
      title: name.isEmpty ? greeting : name,
      titleStyle: T.name,
      trailing: [
        Semantics(
          button: true,
          label: l10n.profileTitle,
          child: InkResponse(
            onTap: () => context.go('/profile'),
            radius: T.tap / 2 + T.s1,
            child: SizedBox(
              width: T.tap + T.s2,
              height: T.tap + T.s2,
              child: Center(
                child: StatusAvatar(
                  name: user?.name ?? '',
                  avatarUrl: user?.avatarUrl,
                  role: CareRole.patient,
                  gender: user?.gender,
                  // Calm, always. The ring used to turn amber when there were
                  // no readings and red after a high one — a status told by
                  // colour alone, round someone's face. The sugar card says it
                  // in words.
                  mood: Mood.calm,
                  size: T.tap,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
