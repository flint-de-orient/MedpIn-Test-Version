import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../shell/presentation/widgets/patient_kit.dart';
import '../data/medications_repository.dart';
import '../domain/medication.dart';
import 'medications_providers.dart';
import 'widgets/mark_dose_sheet.dart';

/// Recording whether a dose was taken — and saying so honestly when that
/// record did not reach the clinic.
///
/// ---- Why this is state, not a snackbar ------------------------------------
///
/// A failed write used to be a four-second snackbar, after which the dose row
/// looked exactly as it had before the patient answered. Somebody who glanced
/// away missed it, believed the tablet was recorded, and the doctor saw a
/// missed dose. For a patient with poor sight a message that vanishes is no
/// message at all.
///
/// So the answer is kept, keyed to its dose, until it is saved or the patient
/// lets it go. The row says "Not saved: Taken" and offers to try again for as
/// long as that is true. A snackbar still announces it, with the same retry.
///
/// One flow for every place a dose can be recorded — the Medicines tab and
/// Home — so they cannot drift apart on what they send.

enum DosePhase { saving, saved, failed }

/// An answer the patient gave about one dose, and where it stands.
@immutable
class DoseWrite {
  const DoseWrite({
    required this.medicationId,
    required this.scheduledFor,
    required this.status,
    required this.phase,
    this.skipReason,
    this.error,
  });

  final String medicationId;

  /// The dose's own instant, which is what the record is attached to.
  final DateTime scheduledFor;

  /// taken | skipped
  final String status;
  final String? skipReason;
  final DosePhase phase;

  /// The server's refusal, when there was one — shown under the retry.
  final String? error;

  String get key => doseWriteKey(medicationId, scheduledFor);

  DoseWrite copyWith({DosePhase? phase, String? error}) => DoseWrite(
    medicationId: medicationId,
    scheduledFor: scheduledFor,
    status: status,
    skipReason: skipReason,
    phase: phase ?? this.phase,
    error: error,
  );
}

String doseWriteKey(String medicationId, DateTime scheduledFor) =>
    '$medicationId|${scheduledFor.toUtc().toIso8601String()}';

/// The dose's instant: the server's where it sent one, the phone's
/// reconstruction only for a server that does not.
DateTime scheduledForOf(TodaySchedule schedule, MedicationScheduleSlot slot) {
  if (slot.scheduledFor != null) return slot.scheduledFor!;
  final datePart =
      schedule.date.isNotEmpty
          ? schedule.date
          : DateTime.now().toIso8601String().substring(0, 10);
  return DateTime.tryParse('${datePart}T${slot.time}:00') ?? DateTime.now();
}

class DoseWrites extends Notifier<Map<String, DoseWrite>> {
  @override
  Map<String, DoseWrite> build() => const {};

  /// Sends [write]. True when the clinic has it.
  Future<bool> submit(DoseWrite write) async {
    final saving = write.copyWith(phase: DosePhase.saving);
    state = {...state, saving.key: saving};
    try {
      await ref
          .read(medicationsRepositoryProvider)
          .logDose(
            medicationId: write.medicationId,
            scheduledFor: write.scheduledFor,
            status: write.status,
            skipReason: write.skipReason,
          );
      // Kept as "saved" rather than dropped: until today's schedule reloads,
      // the row would otherwise flash back to "due" and look unrecorded.
      state = {...state, saving.key: saving.copyWith(phase: DosePhase.saved)};
      ref.invalidate(todayScheduleProvider);
      ref.invalidate(medicationAdherenceProvider);
      return true;
    } catch (e) {
      state = {
        ...state,
        saving.key: saving.copyWith(
          phase: DosePhase.failed,
          error: e is ApiException ? e.message : null,
        ),
      };
      return false;
    }
  }

  /// The patient chose not to keep a failed answer.
  void discard(String key) {
    state = {...state}..remove(key);
  }
}

final doseWritesProvider = NotifierProvider<DoseWrites, Map<String, DoseWrite>>(
  DoseWrites.new,
);

/// Asks whether [slot] was taken, and records the answer.
///
/// [onLogged] runs after the clinic has the answer — the callers use it to
/// re-arm the day's reminders.
Future<void> recordDoseFlow(
  BuildContext context,
  WidgetRef ref, {
  required TodaySchedule schedule,
  required MedicationScheduleSlot slot,
  VoidCallback? onLogged,
}) async {
  final l10n = AppLocalizations.of(context);
  final result = await showMarkDoseSheet(
    context,
    slot.name,
    detail: [
      clockTime(context, slot.time),
      if (slot.dose.isNotEmpty) slot.dose,
      relationLabel(l10n, slot.relationToMeal),
    ].join(' · '),
  );
  if (result == null || !context.mounted) return;

  await _send(
    context,
    ref,
    DoseWrite(
      medicationId: slot.medicationId,
      scheduledFor: scheduledForOf(schedule, slot),
      status: result.status,
      skipReason: result.skipReason,
      phase: DosePhase.saving,
    ),
    onLogged,
  );
}

/// Sends a failed answer again, exactly as it was given.
Future<void> retryDoseWrite(
  BuildContext context,
  WidgetRef ref,
  DoseWrite write, {
  VoidCallback? onLogged,
}) => _send(context, ref, write, onLogged);

Future<void> _send(
  BuildContext context,
  WidgetRef ref,
  DoseWrite write,
  VoidCallback? onLogged,
) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final ok = await ref.read(doseWritesProvider.notifier).submit(write);
  if (ok) {
    onLogged?.call();
    return;
  }
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(l10n.ptDoseNotSavedSnack),
        duration: const Duration(seconds: 8),
        action: SnackBarAction(
          label: l10n.commonTryAgain,
          onPressed: () {
            if (context.mounted) _send(context, ref, write, onLogged);
          },
        ),
      ),
    );
}

/// "After meal", in the patient's language.
String relationLabel(AppLocalizations l10n, String relation) =>
    switch (relation) {
      'before_meal' => l10n.medsRelationBeforeMeal,
      'after_meal' => l10n.medsRelationAfterMeal,
      'with_meal' => l10n.medsRelationWithMeal,
      _ => l10n.medsRelationAnytime,
    };
