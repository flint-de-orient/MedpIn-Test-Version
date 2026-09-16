import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/providers/core_providers.dart';
import '../../../shared/services/notification_service.dart';
import '../data/medications_repository.dart';
import '../domain/medication.dart';

/// The patient's own meal times, which every "after breakfast" reminder is
/// anchored to. Shown on the Medicines tab so the schedule below it reads in
/// the patient's own day rather than in abstract clock times.
final mealTimesProvider = FutureProvider.autoDispose<
  ({String breakfast, String lunch, String dinner})
>((ref) async {
  final json = await ref.read(apiClientProvider).getJson('/auth/me');
  final profile = json['profile'] as Map<String, dynamic>? ?? const {};
  final meals = profile['mealTimes'] as Map<String, dynamic>? ?? const {};
  return (
    breakfast: meals['breakfast']?.toString() ?? '08:00',
    lunch: meals['lunch']?.toString() ?? '13:30',
    dinner: meals['dinner']?.toString() ?? '20:30',
  );
});

final FutureProvider<TodaySchedule> todayScheduleProvider =
    FutureProvider<TodaySchedule>(
      (ref) => ref.watch(medicationsRepositoryProvider).getTodaySchedule(),
    );

final FutureProvider<MedicationAdherence> medicationAdherenceProvider =
    FutureProvider<MedicationAdherence>(
      (ref) => ref.watch(medicationsRepositoryProvider).getAdherence(days: 30),
    );

/// The patient's medications. Fetched from the real API and reused both to list
/// medicines and to build the reminder schedule.
final FutureProvider<List<Medication>> medicationsListProvider =
    FutureProvider<List<Medication>>(
      (ref) => ref.watch(medicationsRepositoryProvider).getMedications(),
    );

/// Every medicine on the list, ended ones included — for "Stopped by you" and
/// "Past medicines". Separate from [medicationsListProvider], which the
/// reminders are built from and must only ever hold what is being taken.
final FutureProvider<List<Medication>> allMedicationsProvider =
    FutureProvider<List<Medication>>(
      (ref) => ref.watch(medicationsRepositoryProvider).getAllMedications(),
    );

/// The patient's dose history over [days] days (newest first) — the medicine-
/// taking history screen. Family so the range toggle re-fetches.
final doseHistoryProvider = FutureProvider.autoDispose
    .family<List<DoseHistoryEntry>, int>(
      (ref, days) =>
          ref.watch(medicationsRepositoryProvider).getDoseHistory(days: days),
    );

/// How far ahead single-dose alarms are armed. Re-armed on every open, resume,
/// sign-in and medicine change; if the app is not opened for longer than this,
/// the server's push (medicationReminderCron.js) is what remains.
const Duration reminderHorizon = Duration(days: 14);

/// A ceiling on single-dose alarms, well inside Android's per-app alarm limit,
/// soonest first.
const int maxSingleDoseAlarms = 300;

/// Whether a medicine is reminded about with one alarm repeating daily.
///
/// The same rule as `remindsDaily` in backend/src/utils/medReminderId.js — both
/// ends must choose alike, or the alarm and the push for one dose carry
/// different ids and the patient is reminded twice.
///
/// A daily repeat cannot skip a day or stop on a date. It used to be the only
/// kind: days of the week and every-other-day "fired daily — an occasional
/// extra reminder (safe)". It is not safe. A weekly methotrexate on a daily
/// repeat is a daily reminder to take methotrexate, and a finished antibiotic
/// course kept ringing until the app happened to be opened.
bool remindsDaily(Medication m) =>
    m.daysOfWeek.isEmpty && m.dayInterval <= 1 && m.endDate == null;

/// Whether a dose of [m] falls on local calendar date [day]: its weekdays, and
/// its interval counted in calendar days from its start. The same calendar as
/// `occursOn` in backend/src/services/medicationLifecycle.js.
bool occursOnDate(Medication m, DateTime day) {
  if (m.asNeeded || m.stat) return false;
  if (m.daysOfWeek.isNotEmpty && !m.daysOfWeek.contains('${day.weekday % 7}')) {
    return false;
  }
  if (m.dayInterval > 1) {
    final start = m.startDate?.toLocal();
    if (start == null) return false;
    final diff =
        DateTime.utc(day.year, day.month, day.day)
            .difference(DateTime.utc(start.year, start.month, start.day))
            .inDays;
    if (diff < 0 || diff % m.dayInterval != 0) return false;
  }
  return true;
}

/// Expands the medicines being taken into their reminders.
///
/// An everyday medicine with no end keeps one daily-repeating alarm per time —
/// it survives a reboot and needs no re-arming, which is why it replaced a
/// rolling window that went silent overnight. Everything else — days of the
/// week, every other day, a course with an end — is armed dose by dose across
/// [reminderHorizon]: only on the days it is due, never past its end, and not
/// for a dose already taken today.
///
/// Only medicines being taken: `isActive` is false for one the doctor stopped,
/// one whose course completed, and one the patient stopped taking.
List<ScheduledDose> buildUpcomingDoses(
  List<Medication> meds, {
  TodaySchedule? today,
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  final daily = <ScheduledDose>[];
  final single = <ScheduledDose>[];
  final seen = <int>{};

  final handled = <String>{
    for (final s in today?.slots ?? const <MedicationScheduleSlot>[])
      if (s.status == 'taken' || s.status == 'skipped') '${s.medicationId}|${s.time}',
  };

  for (final m in meds) {
    if (!m.isActive || m.asNeeded || m.stat) continue;
    final end = m.endDate?.toLocal();
    if (end != null && !end.isAfter(at)) continue;
    final start = m.startDate?.toLocal();

    for (final s in m.schedule) {
      if (s.time.isEmpty) continue;
      final parts = s.time.split(':');
      if (parts.length != 2) continue;
      final hh = int.tryParse(parts[0]);
      final mm = int.tryParse(parts[1]);
      if (hh == null || mm == null || hh > 23 || mm > 59) continue;

      if (remindsDaily(m)) {
        final id = medDailyReminderId(m.id, s.time);
        if (!seen.add(id)) continue; // one alarm per distinct slot time
        var first = DateTime(at.year, at.month, at.day, hh, mm);
        if (start != null && start.isAfter(first)) {
          first = DateTime(start.year, start.month, start.day, hh, mm);
          if (first.isBefore(start)) first = first.add(const Duration(days: 1));
        }
        daily.add(
          ScheduledDose(
            id: id,
            medId: m.id,
            name: m.name,
            when: first,
            dose: m.dose.isNotEmpty ? m.dose : null,
            relationToMeal: s.relationToMeal,
          ),
        );
        continue;
      }

      for (var i = 0; i <= reminderHorizon.inDays; i++) {
        final day = DateTime(at.year, at.month, at.day + i);
        if (!occursOnDate(m, day)) continue;
        final when = DateTime(day.year, day.month, day.day, hh, mm);
        if (!when.isAfter(at)) continue;
        if (start != null && when.isBefore(start)) continue;
        if (end != null && when.isAfter(end)) continue;
        if (i == 0 && handled.contains('${m.id}|${s.time}')) continue;
        final id = medOccurrenceReminderId(m.id, s.time, day);
        if (!seen.add(id)) continue;
        single.add(
          ScheduledDose(
            id: id,
            medId: m.id,
            name: m.name,
            when: when,
            dose: m.dose.isNotEmpty ? m.dose : null,
            relationToMeal: s.relationToMeal,
            repeatsDaily: false,
          ),
        );
      }
    }
  }

  single.sort((a, b) => a.when.compareTo(b.when));
  return [...daily, ...single.take(maxSingleDoseAlarms)];
}

/// (Re)builds and arms the device reminders from [meds] and today's [today]
/// statuses. Returns how many alarms armed.
Future<int> syncMedicationReminders(
  List<Medication> meds, {
  TodaySchedule? today,
}) {
  return NotificationService.instance.scheduleMedicationReminders(
    buildUpcomingDoses(meds, today: today),
  );
}

/// The single robust entry point — call on login, app resume, a schedule change,
/// and after marking a dose. Pulls the medications AND today's statuses, then
/// arms, retrying with backoff: at cold start the token or network is often not
/// ready on the first try, and silently swallowing that failure is exactly what
/// left patients un-reminded.
Future<void> refreshAndScheduleMedicationReminders(WidgetRef ref) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      final repo = ref.read(medicationsRepositoryProvider);
      final meds = await repo.getMedications();
      TodaySchedule? today;
      try {
        today = await repo.getTodaySchedule();
      } catch (_) {
        // Non-fatal: without today's statuses we just don't skip taken slots.
      }
      final doses = buildUpcomingDoses(meds, today: today);
      final armed = await NotificationService.instance
          .scheduleMedicationReminders(doses);
      if (doses.isEmpty || armed > 0) return; // nothing to do, or it stuck
    } catch (_) {
      // fall through to retry
    }
    await Future.delayed(Duration(seconds: 2 * (attempt + 1)));
  }
}
