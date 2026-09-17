import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/providers/preferences_provider.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../glucose/domain/glucose_trends.dart';
import '../../../glucose/presentation/glucose_providers.dart';
import '../../../glucose/presentation/log_glucose_sheet.dart';
import '../../../medications/domain/medication.dart';
import '../../../medications/domain/today_doses.dart';
import '../../../medications/presentation/dose_writes.dart';
import '../../../medications/presentation/medications_providers.dart';
import '../../../medications/presentation/widgets/dose_day.dart';
import '../../../shell/presentation/load_stamps.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
import '../../domain/today_plan.dart';

/// The answer to "what do I need to do today?", and the first card on Home.
///
/// It replaced a photograph of a doctor with "1 dose due" printed over it. That
/// hero took a third of the screen, named one dose, said nothing about the dose
/// that had already been missed, printed "20:30" beside an app that says
/// "8:30 PM" everywhere else, and for a patient with no medicines at all said
/// "All clear — You're on track!", which was true of nobody.
///
/// It is a list of today's jobs instead: the doses, counted in words, the next
/// one with the only filled button on the screen when it is time to take it,
/// and a sugar check on the day the phone would nudge for one.
class TodayCard extends ConsumerWidget {
  const TodayCard({super.key, required this.showCheckIn, this.now});

  /// Whether sugar checks belong on this patient's Home at all — the same
  /// condition that decides whether the sugar card is shown.
  final bool showCheckIn;

  /// Fixed in tests; the wall clock otherwise.
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final at = now ?? DateTime.now();
    final schedule = ref.watch(todayScheduleProvider);
    final meds = ref.watch(medicationsListProvider).valueOrNull;
    final trends =
        showCheckIn ? ref.watch(glucoseTrendsProvider).valueOrNull : null;

    // Switching to another person rebuilds the provider with the previous
    // person's doses still attached. Those are not this person's doses.
    final today = schedule.isReloading ? null : schedule.valueOrNull;
    final doses = today == null ? null : TodayDoses(today.slots, at);
    final next = doses?.next;
    final canRecordNext = next != null && doses!.isLoggableNow(next);
    final checkIn = trends != null && checkInDue(trends, at);

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.today_outlined,
            title: l10n.ptTodayTitle,
            subtitle: longDate(context, at),
          ),
          const SizedBox(height: T.s4),
          if (schedule.hasError && today != null) ...[
            StaleNotice(
              loadedAt: LoadStamps.of(LoadStamps.todaySchedule),
              onRetry: () => ref.invalidate(todayScheduleProvider),
            ),
            const SizedBox(height: T.s3),
          ],
          if (schedule.hasError && today == null)
            SectionLoadFailed(
              message: l10n.ptCouldNotLoadTodaysMedicines,
              onRetry: () => ref.invalidate(todayScheduleProvider),
            )
          else if (doses == null)
            const _DosesSkeleton()
          else if (doses.isEmpty)
            _NoDosesToday(hasMedicines: meds?.isNotEmpty ?? true)
          else ...[
            DoseDaySummary(doses: doses),
            if (next != null) ...[
              const SizedBox(height: T.s4),
              _NextDose(
                slot: next,
                doses: doses,
                schedule: today!,
                canRecord: canRecordNext,
                onLogged: () => _rearmReminders(ref),
              ),
            ],
          ],
          if (checkIn) ...[
            const SizedBox(height: T.s3),
            _CheckInDue(
              trends: trends,
              now: at,
              // One filled button on the screen at a time. A dose due now
              // outranks a sugar check, so the check steps down to outlined.
              primary: !canRecordNext,
            ),
          ],
          const SizedBox(height: T.s2),
          ActionLink(
            label: l10n.ptAllMedicines,
            onTap: () => context.go('/medications'),
          ),
        ],
      ),
    );
  }

  /// A dose recorded here should move today's alarms exactly as one recorded
  /// on the Medicines tab does — the same entry point, behind the same switch.
  static void _rearmReminders(WidgetRef ref) {
    if (!ref.read(appPreferencesProvider).medicationReminders) return;
    refreshAndScheduleMedicationReminders(ref).catchError((_) {});
  }
}

class _DosesSkeleton extends StatelessWidget {
  const _DosesSkeleton();

  @override
  Widget build(BuildContext context) => Semantics(
    label: AppLocalizations.of(context).commonLoading,
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SkeletonLine(width: 180, height: T.s5),
        SizedBox(height: T.s3),
        SkeletonLine(height: T.s2),
        SizedBox(height: T.s4),
        SkeletonLine(height: T.s12),
      ],
    ),
  );
}

/// Nothing to take today — said as the one of two facts it actually is.
class _NoDosesToday extends StatelessWidget {
  const _NoDosesToday({required this.hasMedicines});

  final bool hasMedicines;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          hasMedicines ? l10n.ptNoDosesToday : l10n.ptNoMedicinesYet,
          style: T.bodyStrong.copyWith(color: T.ink),
        ),
        Text(
          hasMedicines ? l10n.ptNoDosesTodayBody : l10n.ptNoMedicinesYetBody,
          style: T.small.copyWith(color: T.inkMuted),
        ),
      ],
    );
  }
}

/// The next dose, and — when its time has come — the button that records it.
class _NextDose extends ConsumerWidget {
  const _NextDose({
    required this.slot,
    required this.doses,
    required this.schedule,
    required this.canRecord,
    this.onLogged,
  });

  final MedicationScheduleSlot slot;
  final TodayDoses doses;
  final TodaySchedule schedule;
  final bool canRecord;
  final VoidCallback? onLogged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final state = doseStateOf(slot, doses.now);
    final time = clockTime(context, slot.time);
    final key = doseWriteKey(slot.medicationId, scheduledForOf(schedule, slot));
    final write = ref.watch(doseWritesProvider.select((m) => m[key]));
    final detail = [
      if (slot.dose.isNotEmpty) slot.dose,
      relationLabel(l10n, slot.relationToMeal),
    ].join(' · ');

    // While an answer is saving or did not save, that is the status; otherwise
    // the time, said as due or as next.
    final status =
        write != null
            ? doseStatusOf(context, slot, doses, write)
            : state == DoseState.due
            ? (
              status: Status.watch,
              label: l10n.ptDoseDueNow(time),
              icon: Icons.alarm_rounded,
            )
            : (
              status: Status.neutral,
              label: l10n.ptNextDoseAt(time),
              icon: Icons.schedule_rounded,
            );

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          StatusWord(label: status.label, status: status.status, icon: status.icon),
          const SizedBox(height: T.s1),
          Text(keepUnitsTogether(slot.name), style: T.title.copyWith(color: T.ink)),
          if (detail.isNotEmpty)
            Text(detail, style: T.body.copyWith(color: T.inkMuted)),
          if (write?.phase == DosePhase.failed) ...[
            const SizedBox(height: T.s3),
            PrimaryAction(
              label: l10n.commonTryAgain,
              icon: Icons.refresh_rounded,
              onPressed:
                  () => retryDoseWrite(context, ref, write!, onLogged: onLogged),
            ),
          ] else if (canRecord && write == null) ...[
            const SizedBox(height: T.s3),
            PrimaryAction(
              label: l10n.ptRecordThisDose,
              icon: Icons.check_rounded,
              onPressed:
                  () => recordDoseFlow(
                    context,
                    ref,
                    schedule: schedule,
                    slot: slot,
                    onLogged: onLogged,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A sugar check, on the day the reminder would have asked for one.
class _CheckInDue extends StatelessWidget {
  const _CheckInDue({
    required this.trends,
    required this.now,
    required this.primary,
  });

  final GlucoseTrends trends;
  final DateTime now;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final last = lastReadingAt(trends);
    final detail =
        last == null
            ? l10n.ptNoReadingsInDays(trends.days)
            : l10n.ptLastReadingDaysAgo(daysSince(last, now));

    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.water_drop_outlined, size: 24, color: T.primary),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.ptSugarCheckDue,
                      style: T.bodyStrong.copyWith(color: T.ink),
                    ),
                    Text(detail, style: T.small.copyWith(color: T.inkMuted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          if (primary)
            PrimaryAction(
              label: l10n.ptAddAReading,
              icon: Icons.add_rounded,
              onPressed: () => showLogGlucoseSheet(context),
            )
          else
            SecondaryAction(
              label: l10n.ptAddAReading,
              icon: Icons.add_rounded,
              onPressed: () => showLogGlucoseSheet(context),
            ),
        ],
      ),
    );
  }
}
