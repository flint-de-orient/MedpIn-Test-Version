import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/tokens.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/preferences_provider.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../shell/presentation/load_stamps.dart';
import '../../shell/presentation/widgets/patient_kit.dart';
import '../domain/medication.dart';
import '../domain/today_doses.dart';
import 'dose_writes.dart';
import 'medications_providers.dart';
import 'reminder_setup_sheet.dart';
import 'widgets/dose_day.dart';
import 'widgets/medicine_lifecycle.dart';
import 'widgets/reminder_health_card.dart';
import 'widgets/scan_prescription_sheet.dart';

/// The patient's medicines: today's doses first, then what they take, then
/// what they stopped and what has ended.
///
/// The page used to open on a brand wordmark, a "Scan prescription" button and
/// three coloured meal-time tiles, and put today's schedule — the thing a
/// patient comes here for every day — at the very bottom, under every
/// prescription card. Each medicine carried an "Active" pill that every
/// medicine on the list had, beside its strength set at 32px, so the loudest
/// thing on a card was "500".
class MedicationsScreen extends ConsumerStatefulWidget {
  const MedicationsScreen({super.key});

  @override
  ConsumerState<MedicationsScreen> createState() => _MedicationsScreenState();
}

class _MedicationsScreenState extends ConsumerState<MedicationsScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  /// Prescriptions and their times are the doctor's to change, not the
  /// patient's. Waiting for a pull-to-refresh meant a retimed dose kept showing
  /// the old hour — and, because the reminder scheduler is driven by this
  /// list, kept ringing at it too.
  static const _pollInterval = Duration(seconds: 30);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) => _refreshFromServer());
    // One-time: if reminders are on but the OS could sleep them, offer the
    // reliability fix. Post-frame so a sheet has a mounted context to open in.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) maybePromptReminderSetup(context, ref);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshFromServer();
  }

  void _refreshFromServer() {
    if (mounted) _refreshAll();
  }

  void _refreshAll() {
    // Reloads everything a new medicine affects. Invalidating the list also
    // re-fires the reminder scheduler via the listener in build().
    ref.invalidate(todayScheduleProvider);
    ref.invalidate(medicationAdherenceProvider);
    ref.invalidate(medicationsListProvider);
    ref.invalidate(allMedicationsProvider);
  }

  /// Patients add medicines by scanning the doctor's prescription only —
  /// typing them in is the doctor's side. This keeps the patient's list
  /// faithful to what was actually prescribed.
  Future<void> _onScan() async {
    final added = await showScanPrescriptionSheet(context);
    if (added == true) _refreshAll();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    // Keep on-device reminders in step with the live medication list: whenever
    // it (re)loads — after a scan, or a doctor's prescription — the reminders
    // are rebuilt.
    ref.listen<AsyncValue<List<Medication>>>(medicationsListProvider, (
      _,
      next,
    ) {
      if (ref.read(appPreferencesProvider).medicationReminders) {
        next.whenData(
          (meds) => syncMedicationReminders(
            meds,
            today: ref.read(todayScheduleProvider).valueOrNull,
          ),
        );
      }
    });

    // Re-arm when today's statuses change too — a dose recorded here is also
    // the moment a changed prescription is most likely to have arrived, and a
    // dose taken today stops that day's single alarm for it.
    ref.listen<AsyncValue<TodaySchedule>>(todayScheduleProvider, (_, next) {
      if (ref.read(appPreferencesProvider).medicationReminders) {
        next.whenData(
          (today) => syncMedicationReminders(
            ref.read(medicationsListProvider).valueOrNull ?? const [],
            today: today,
          ),
        );
      }
    });

    final medsAsync = ref.watch(medicationsListProvider);
    final scheduleAsync = ref.watch(todayScheduleProvider);
    final allAsync = ref.watch(allMedicationsProvider);

    // A background refresh keeps what was loaded. Switching to another person
    // does not: the value still attached then is the previous person's.
    final meds = medsAsync.isReloading ? null : medsAsync.valueOrNull;
    final today = scheduleAsync.isReloading ? null : scheduleAsync.valueOrNull;
    final all = allAsync.isReloading ? null : allAsync.valueOrNull;
    final meals = ref.watch(mealTimesProvider).valueOrNull;

    final staleStamps = [
      if (medsAsync.hasError && meds != null)
        LoadStamps.of(LoadStamps.medications),
      if (scheduleAsync.hasError && today != null)
        LoadStamps.of(LoadStamps.todaySchedule),
    ];
    final isStale = staleStamps.isNotEmpty;
    // The older of the two, because that is how old the screen is.
    final DateTime? staleSince =
        staleStamps.contains(null)
            ? null
            : staleStamps.whereType<DateTime>().fold<DateTime?>(
              null,
              (a, b) => a == null || b.isBefore(a) ? b : a,
            );

    final stopped = [
      for (final m in all ?? const <Medication>[])
        if (m.prescriptionStands && m.stoppedByPatient) m,
    ];
    final past = [
      for (final m in all ?? const <Medication>[])
        if (!m.prescriptionStands) m,
    ];

    final sections = <Widget>[
      if (isStale)
        StaleNotice(loadedAt: staleSince, onRetry: _refreshAll),
      // Today first. With no medicines at all it says nothing the section
      // below does not say better, so it steps aside rather than repeat it.
      if (meds == null || meds.isNotEmpty)
        _TodaySection(async: scheduleAsync, today: today),
      _YourMedicinesSection(
        async: medsAsync,
        meds: meds,
        meals: meals,
        showFinishedNote: hasRecentlyFinishedCourse(past, DateTime.now()),
        onScan: _onScan,
      ),
      // Stopped and ended read the whole list. Each is hidden when empty, and a
      // failure to load them hides them rather than saying there are none.
      if (stopped.isNotEmpty)
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SectionHeader(
                icon: Icons.pause_circle_outline_rounded,
                title: l10n.ptStoppedByYou,
              ),
              const SizedBox(height: T.s1),
              StoppedByYouList(medicines: stopped),
            ],
          ),
        ),
      if (past.isNotEmpty)
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SectionHeader(
                icon: Icons.history_rounded,
                title: l10n.ptPastMedicines,
              ),
              const SizedBox(height: T.s1),
              PastMedicinesList(medicines: past),
            ],
          ),
        ),
      _RecordsSection(meals: meals),
    ];

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this screen and
      // the navigation bar alike.
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            _refreshAll();
            ref.invalidate(mealTimesProvider);
          },
          child: ListView(
            padding: const EdgeInsets.only(bottom: T.s8),
            children: [
              PatientTabHeader(title: l10n.ptTabMedicines),
              Padding(
                padding: kPatientGutter,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Above everything, because a schedule of four doses is
                    // actively reassuring on a phone that will announce none of
                    // them. Draws nothing — and takes no space — when the
                    // reminders are healthy.
                    const ReminderHealthCard(),
                    for (final (i, s) in sections.indexed) ...[
                      if (i > 0) const SizedBox(height: kSectionGap),
                      s,
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

// ---- Today ----------------------------------------------------------------

class _TodaySection extends ConsumerWidget {
  const _TodaySection({required this.async, required this.today});

  final AsyncValue<TodaySchedule> async;
  final TodaySchedule? today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final now = DateTime.now();
    final schedule = today;
    final doses = schedule == null ? null : TodayDoses(schedule.slots, now);
    final next = doses?.next;
    // The one filled button on the page goes to the dose whose time has come.
    final emphasised =
        next != null && doses!.isLoggableNow(next) ? next : null;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.today_outlined,
            title: l10n.ptTodayTitle,
            subtitle: longDate(context, now),
          ),
          const SizedBox(height: T.s4),
          if (schedule == null && async.hasError)
            SectionLoadFailed(
              message: l10n.ptCouldNotLoadTodaysMedicines,
              onRetry: () => ref.invalidate(todayScheduleProvider),
            )
          else if (doses == null)
            Semantics(
              label: l10n.commonLoading,
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonLine(width: 180, height: T.s5),
                  SizedBox(height: T.s3),
                  SkeletonLine(height: T.s2),
                  SizedBox(height: T.s4),
                  SkeletonLine(height: T.s12),
                  SizedBox(height: T.s3),
                  SkeletonLine(height: T.s12),
                ],
              ),
            )
          else if (doses.isEmpty) ...[
            Text(l10n.ptNoDosesToday, style: T.bodyStrong.copyWith(color: T.ink)),
            Text(
              l10n.ptNoDosesTodayBody,
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ] else ...[
            DoseDaySummary(doses: doses),
            const SizedBox(height: T.s2),
            for (final slot in doses.slots) ...[
              const Divider(height: 1, color: T.line),
              DoseRow(
                key: ValueKey(
                  doseWriteKey(slot.medicationId, scheduledForOf(schedule!, slot)),
                ),
                slot: slot,
                doses: doses,
                schedule: schedule,
                emphasise: identical(slot, emphasised),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

// ---- Your medicines -------------------------------------------------------

class _YourMedicinesSection extends ConsumerWidget {
  const _YourMedicinesSection({
    required this.async,
    required this.meds,
    required this.meals,
    required this.showFinishedNote,
    required this.onScan,
  });

  final AsyncValue<List<Medication>> async;
  final List<Medication>? meds;
  final ({String breakfast, String lunch, String dinner})? meals;
  final bool showFinishedNote;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final list = meds;
    final active = [
      for (final m in list ?? const <Medication>[])
        if (m.isActive) m,
    ];

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.medication_outlined,
            title: l10n.ptYourMedicines,
            subtitle: list == null ? null : l10n.ptMedicineCount(active.length),
          ),
          const SizedBox(height: T.s4),
          // Said once, where a patient looking for a finished course would
          // look: it no longer stays on this list, and nothing else says so.
          if (showFinishedNote) ...[
            NoticeTile(
              status: Status.neutral,
              icon: Icons.info_outline_rounded,
              message: l10n.ptFinishedCoursesNote,
            ),
            const SizedBox(height: T.s2),
          ],
          if (list == null && async.hasError)
            SectionLoadFailed(
              message: l10n.ptCouldNotLoadMedicines,
              onRetry: () => ref.invalidate(medicationsListProvider),
            )
          else if (list == null)
            Semantics(
              label: l10n.commonLoading,
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonLine(width: 200, height: T.s5),
                  SizedBox(height: T.s2),
                  SkeletonLine(width: 140),
                  SizedBox(height: T.s5),
                  SkeletonLine(width: 180, height: T.s5),
                  SizedBox(height: T.s2),
                  SkeletonLine(width: 120),
                ],
              ),
            )
          else if (active.isEmpty) ...[
            Text(l10n.ptNoMedicinesYet, style: T.bodyStrong.copyWith(color: T.ink)),
            Text(
              l10n.ptNoMedicinesYetBody,
              style: T.small.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s4),
            PrimaryAction(
              label: l10n.ptScanPrescription,
              icon: Icons.document_scanner_outlined,
              onPressed: onScan,
            ),
          ] else ...[
            for (final (i, m) in active.indexed) ...[
              if (i > 0) const Divider(height: 1, color: T.line),
              _MedicineRow(
                medication: m,
                onStopTaking: () => stopTakingFlow(context, ref, m),
              ),
            ],
            const SizedBox(height: T.s3),
            SecondaryAction(
              label: l10n.ptScanPrescription,
              icon: Icons.document_scanner_outlined,
              onPressed: onScan,
            ),
          ],
        ],
      ),
    );
  }
}

/// One medicine being taken: what it is, when, and how.
class _MedicineRow extends StatelessWidget {
  const _MedicineRow({required this.medication, required this.onStopTaking});

  final Medication medication;
  final VoidCallback onStopTaking;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = medication;
    final locale = Localizations.localeOf(context).toString();

    final times = [
      for (final s in m.schedule)
        if (s.time.isNotEmpty) s.time,
    ]..sort();
    final relations = {
      for (final s in m.schedule)
        if (s.relationToMeal != 'anytime' && s.relationToMeal != 'any')
          s.relationToMeal,
    };

    // When, in the patient's words: the clock times, the meal they go with,
    // and — only when it is not every day — which days.
    final when = <String>[
      if (m.asNeeded)
        l10n.ptWhenNeeded
      else if (times.isEmpty)
        l10n.ptNoTimeSet
      else
        times.map((t) => clockTime(context, t)).join(' · '),
    ];
    final how = <String>[
      if (relations.length == 1) relationLabel(l10n, relations.first),
      if (m.dayInterval == 2) l10n.ptEveryOtherDay,
      if (m.daysOfWeek.isNotEmpty)
        l10n.ptOnDays(
          [
            for (final d in (m.daysOfWeek.map(int.tryParse).whereType<int>().toList()
              ..sort()))
              // 13 September 2026 was a Sunday, and the server counts from
              // Sunday = 0.
              DateFormat.E(locale).format(DateTime(2026, 9, 13 + d)),
          ].join(', '),
        ),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(medicineLabel(m), style: T.bodyStrong.copyWith(color: T.ink)),
          Text(when.join(), style: T.body.copyWith(color: T.ink)),
          if (how.isNotEmpty)
            Text(how.join(' · '), style: T.small.copyWith(color: T.inkMuted)),
          // The doctor's own note about this medicine. No invented "what it is
          // for" line: the record does not hold one, and a guessed indication is
          // a clinical claim.
          if ((m.instructions ?? '').isNotEmpty)
            Text(m.instructions!, style: T.small.copyWith(color: T.inkMuted)),
          // Another prescription for the same medicine on this list.
          AlsoOnListNote(medication: m),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: onStopTaking,
              style: TextButton.styleFrom(
                foregroundColor: T.inkMuted,
                minimumSize: const Size(T.tap, T.tap),
                padding: EdgeInsets.zero,
              ),
              child: Text(l10n.ptStopTaking),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Records and reminders -------------------------------------------------

class _RecordsSection extends StatelessWidget {
  const _RecordsSection({required this.meals});

  final ({String breakfast, String lunch, String dinner})? meals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = meals;
    return SectionCard(
      padding: const EdgeInsets.symmetric(vertical: T.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LinkRow(
            icon: Icons.description_outlined,
            title: l10n.carePrescriptions,
            subtitle: l10n.ptPrescriptionsSub,
            onTap: () => context.push('/medications/prescriptions'),
          ),
          const Divider(height: 1, indent: T.s4 + T.s12, color: T.line),
          LinkRow(
            icon: Icons.alarm_outlined,
            title: l10n.ptReminderTimes,
            // The patient's own meal times, which every "after breakfast"
            // reminder is anchored to — in words rather than three coloured
            // tiles that meant nothing a colour should mean.
            subtitle:
                m == null
                    ? null
                    : l10n.ptMealTimesLine(
                      clockTime(context, m.breakfast),
                      clockTime(context, m.lunch),
                      clockTime(context, m.dinner),
                    ),
            onTap: () => context.push('/medications/reminders'),
          ),
          const Divider(height: 1, indent: T.s4 + T.s12, color: T.line),
          LinkRow(
            icon: Icons.fact_check_outlined,
            title: l10n.ptDoseHistory,
            subtitle: l10n.ptDoseHistorySub,
            onTap: () => context.push('/medications/history'),
          ),
        ],
      ),
    );
  }
}
