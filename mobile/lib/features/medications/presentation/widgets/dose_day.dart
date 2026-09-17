import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
import '../../domain/medication.dart';
import '../../domain/today_doses.dart';
import '../dose_writes.dart';

/// Where one of today's doses stands, in words, with its colour and icon —
/// including an answer the patient gave that is still saving or did not save.
///
/// Every dose status in the patient app comes from here. It was a coloured
/// icon with a 12px word under it on one screen and a bare colour on another;
/// "Pending" said nothing about whether the time had come, and a dose taken
/// three hours late read exactly like one taken on time.
({Status status, String label, IconData icon}) doseStatusOf(
  BuildContext context,
  MedicationScheduleSlot slot,
  TodayDoses doses,
  DoseWrite? write,
) {
  final l10n = AppLocalizations.of(context);
  String answer(String status) =>
      status == 'skipped' ? l10n.medsStatusSkipped : l10n.medsStatusTaken;

  // The patient's own answer outranks "due" only while the server has not yet
  // said anything else about the dose.
  if (write != null && slot.status == 'pending') {
    switch (write.phase) {
      case DosePhase.saving:
        return (
          status: Status.neutral,
          label: l10n.ptSaving,
          icon: Icons.sync_rounded,
        );
      case DosePhase.saved:
        return write.status == 'skipped'
            ? (
              status: Status.neutral,
              label: l10n.medsStatusSkipped,
              icon: Icons.remove_circle_outline_rounded,
            )
            : (
              status: Status.ok,
              label: l10n.medsStatusTaken,
              icon: Icons.check_circle_rounded,
            );
      case DosePhase.failed:
        return (
          status: Status.alert,
          label: l10n.ptDoseNotSaved(answer(write.status)),
          icon: Icons.error_outline_rounded,
        );
    }
  }

  return switch (doseStateOf(slot, doses.now)) {
    DoseState.taken => (
      status: Status.ok,
      label: l10n.medsStatusTaken,
      icon: Icons.check_circle_rounded,
    ),
    DoseState.takenLate => (
      status: Status.watch,
      label: l10n.ptDoseTakenLate,
      icon: Icons.schedule_rounded,
    ),
    DoseState.skipped => (
      status: Status.neutral,
      label: l10n.medsStatusSkipped,
      icon: Icons.remove_circle_outline_rounded,
    ),
    DoseState.missed => (
      status: Status.alert,
      label: l10n.medsStatusMissed,
      icon: Icons.error_outline_rounded,
    ),
    DoseState.due => (
      status: Status.watch,
      label: l10n.ptDoseDueNowShort,
      icon: Icons.alarm_rounded,
    ),
    DoseState.upcoming => (
      status: Status.neutral,
      label: l10n.ptDoseLaterToday,
      icon: Icons.schedule_rounded,
    ),
  };
}

/// "2 of 4 doses taken", what happened to the rest, and a bar with one segment
/// per dose. The bar is the glance; the words are the fact.
class DoseDaySummary extends StatelessWidget {
  const DoseDaySummary({super.key, required this.doses});

  final TodayDoses doses;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final words = <Widget>[
      if (doses.allTaken)
        StatusWord(
          label: l10n.ptAllDosesTaken,
          status: Status.ok,
          icon: Icons.check_circle_rounded,
        ),
      if (doses.missed > 0)
        StatusWord(
          label: l10n.ptDosesMissed(doses.missed),
          status: Status.alert,
          icon: Icons.error_outline_rounded,
        ),
      if (doses.takenLate > 0)
        StatusWord(
          label: l10n.ptDosesTakenLate(doses.takenLate),
          status: Status.watch,
          icon: Icons.schedule_rounded,
        ),
      if (doses.skipped > 0)
        StatusWord(
          label: l10n.ptDosesSkipped(doses.skipped),
          status: Status.neutral,
          icon: Icons.remove_circle_outline_rounded,
        ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.ptDosesTakenOf(doses.taken, doses.total),
          style: T.title.copyWith(color: T.ink),
        ),
        const SizedBox(height: T.s2),
        ExcludeSemantics(
          child: Row(
            children: [
              for (var i = 0; i < doses.slots.length; i++) ...[
                if (i > 0) const SizedBox(width: T.s1),
                Expanded(
                  child: Container(
                    height: T.s2,
                    decoration: BoxDecoration(
                      color: switch (doseStateOf(doses.slots[i], doses.now)) {
                        DoseState.taken || DoseState.takenLate => T.success,
                        DoseState.missed => T.danger,
                        DoseState.skipped => T.inkFaint,
                        DoseState.due => T.warning,
                        DoseState.upcoming => T.line,
                      },
                      borderRadius: T.rFull,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (words.isNotEmpty) ...[
          const SizedBox(height: T.s2),
          Wrap(spacing: T.s4, runSpacing: T.s1, children: words),
        ],
      ],
    );
  }
}

/// One of today's doses on the Medicines tab: its time, the medicine, where it
/// stands in words, and the one thing to do about it.
class DoseRow extends ConsumerWidget {
  const DoseRow({
    super.key,
    required this.slot,
    required this.doses,
    required this.schedule,
    this.emphasise = false,
    this.onLogged,
  });

  final MedicationScheduleSlot slot;
  final TodayDoses doses;
  final TodaySchedule schedule;

  /// The next dose due: its button is the screen's one filled action.
  final bool emphasise;

  final VoidCallback? onLogged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final key = doseWriteKey(slot.medicationId, scheduledForOf(schedule, slot));
    final write = ref.watch(doseWritesProvider.select((m) => m[key]));
    final status = doseStatusOf(context, slot, doses, write);
    final state = doseStateOf(slot, doses.now);
    final pending = slot.status == 'pending';
    final open =
        pending &&
        (state == DoseState.due || state == DoseState.upcoming) &&
        (write == null || write.phase == DosePhase.failed);
    final failed = pending && write?.phase == DosePhase.failed;

    final detail = [
      if (slot.dose.isNotEmpty) slot.dose,
      relationLabel(l10n, slot.relationToMeal),
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: T.s3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The time, in its own column so a day's doses scan down one edge.
          SizedBox(
            width: MediaQuery.textScalerOf(context).scale(T.s12 + T.s6),
            child: Text(
              clockTime(context, slot.time),
              style: T.bodyStrong.copyWith(color: T.ink),
            ),
          ),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  keepUnitsTogether(slot.name),
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                if (detail.isNotEmpty)
                  Text(detail, style: T.small.copyWith(color: T.inkMuted)),
                const SizedBox(height: T.s1),
                StatusWord(
                  label: status.label,
                  status: status.status,
                  icon: status.icon,
                ),
                if (failed && (write!.error ?? '').isNotEmpty)
                  Text(write.error!, style: T.small.copyWith(color: T.inkMuted)),
                if (failed) ...[
                  const SizedBox(height: T.s2),
                  Wrap(
                    spacing: T.s2,
                    runSpacing: T.s2,
                    children: [
                      SecondaryAction(
                        label: l10n.commonTryAgain,
                        icon: Icons.refresh_rounded,
                        expand: false,
                        onPressed:
                            () => retryDoseWrite(
                              context,
                              ref,
                              write!,
                              onLogged: onLogged,
                            ),
                      ),
                      TextButton(
                        onPressed:
                            () => ref
                                .read(doseWritesProvider.notifier)
                                .discard(key),
                        style: TextButton.styleFrom(
                          foregroundColor: T.inkMuted,
                          minimumSize: const Size(T.tap, T.tap),
                        ),
                        child: Text(l10n.commonCancel),
                      ),
                    ],
                  ),
                ] else if (open) ...[
                  const SizedBox(height: T.s2),
                  // Louder the nearer it is: the dose due now gets the page's
                  // one filled button, another whose time has come an outlined
                  // one, and a dose hours away only a quiet way to record it
                  // early — an evening tablet taken at lunch still happens.
                  if (emphasise)
                    PrimaryAction(
                      label: l10n.ptRecordThisDose,
                      icon: Icons.check_rounded,
                      expand: false,
                      onPressed: () => _record(context, ref),
                    )
                  else if (doses.isLoggableNow(slot))
                    SecondaryAction(
                      label: l10n.ptRecordDose,
                      expand: false,
                      onPressed: () => _record(context, ref),
                    )
                  else
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        onPressed: () => _record(context, ref),
                        style: TextButton.styleFrom(
                          foregroundColor: T.primary,
                          minimumSize: const Size(T.tap, T.tap),
                          padding: EdgeInsets.zero,
                        ),
                        child: Text(l10n.ptRecordDose),
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

  void _record(BuildContext context, WidgetRef ref) => recordDoseFlow(
    context,
    ref,
    schedule: schedule,
    slot: slot,
    onLogged: onLogged,
  );
}
