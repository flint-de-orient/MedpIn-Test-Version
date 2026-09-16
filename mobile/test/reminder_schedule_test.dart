import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/medications/domain/medication.dart';
import 'package:medpin/features/medications/presentation/medications_providers.dart';
import 'package:medpin/shared/services/notification_service.dart';

/// What the phone arms for each kind of medicine.
///
/// The daily repeat was the only kind: days of the week and every-other-day
/// "fired daily — an occasional extra reminder (safe)". A weekly methotrexate on
/// a daily repeat is a daily reminder to take methotrexate, and a finished
/// antibiotic course rang until the app was next opened. These pin the
/// replacement: a repeat only where a repeat is true, single alarms everywhere
/// else, and the same ids the server pushes with.
Medication med({
  String id = 'm1',
  List<String> daysOfWeek = const [],
  int dayInterval = 1,
  DateTime? startDate,
  DateTime? endDate,
  bool isActive = true,
  List<String> times = const ['08:00'],
}) => Medication(
  id: id,
  name: 'Test medicine',
  form: 'tablet',
  strength: '5 mg',
  dose: '1 tablet',
  schedule: [
    for (final t in times) MedicationScheduleEntry(time: t, relationToMeal: 'any'),
  ],
  daysOfWeek: daysOfWeek,
  isActive: isActive,
  startDate: startDate,
  endDate: endDate,
  dayInterval: dayInterval,
);

void main() {
  // A Wednesday, just after midnight, local time.
  final now = DateTime(2026, 9, 16, 0, 5);

  test('an everyday medicine with no end keeps one repeating alarm per time', () {
    final doses = buildUpcomingDoses([med(times: ['08:00', '20:00'])], now: now);
    expect(doses, hasLength(2));
    expect(doses.every((d) => d.repeatsDaily), isTrue);
    expect(doses.first.id, medDailyReminderId('m1', '08:00'));
  });

  test('a weekly medicine rings on its weekday only, never daily', () {
    // 3 = Wednesday, 0 = Sunday.
    final doses = buildUpcomingDoses([med(daysOfWeek: ['0'], startDate: DateTime(2026, 9, 1))], now: now);
    expect(doses.any((d) => d.repeatsDaily), isFalse, reason: 'a weekly medicine was armed as a daily repeat');
    expect(doses.map((d) => d.when.weekday).toSet(), {DateTime.sunday});
    expect(doses, hasLength(2), reason: 'two Sundays fall in the next fortnight');
  });

  test('an every-other-day medicine rings on its days, counted from its start', () {
    final doses = buildUpcomingDoses([med(dayInterval: 2, startDate: DateTime(2026, 9, 15, 9))], now: now);
    final days = doses.map((d) => d.when.day).toList();
    // Started the 15th: due the 17th, 19th, 21st, 23rd, 25th, 27th, 29th.
    expect(days, [17, 19, 21, 23, 25, 27, 29]);
    expect(doses.any((d) => d.repeatsDaily), isFalse);
  });

  test('a course rings until its end and not after it', () {
    final doses = buildUpcomingDoses(
      [med(startDate: DateTime(2026, 9, 10), endDate: DateTime(2026, 9, 18, 10))],
      now: now,
    );
    expect(doses.map((d) => d.when.day).toList(), [16, 17, 18], reason: 'a finished course kept ringing');
    expect(doses.any((d) => d.repeatsDaily), isFalse);
  });

  test('a medicine starting later is first reminded about on its start date', () {
    final doses = buildUpcomingDoses([med(startDate: DateTime(2026, 9, 20, 7))], now: now);
    expect(doses.single.repeatsDaily, isTrue);
    expect(doses.single.when, DateTime(2026, 9, 20, 8));
  });

  test('a medicine stopped by anyone, or finished, arms nothing', () {
    expect(buildUpcomingDoses([med(isActive: false)], now: now), isEmpty);
    expect(buildUpcomingDoses([med(endDate: DateTime(2026, 9, 15))], now: now), isEmpty);
  });

  test('a single-dose alarm is not armed for a dose already taken today', () {
    const today = TodaySchedule(
      date: '2026-09-16',
      slots: [
        MedicationScheduleSlot(
          medicationId: 'm1',
          name: 'Test medicine',
          dose: '1 tablet',
          time: '08:00',
          relationToMeal: 'any',
          status: 'taken',
        ),
      ],
    );
    final doses = buildUpcomingDoses(
      [med(startDate: DateTime(2026, 9, 10), endDate: DateTime(2026, 9, 18, 10))],
      today: today,
      now: now,
    );
    expect(doses.map((d) => d.when.day).toList(), [17, 18]);
  });

  test('single-dose ids agree with the numbers the server is pinned to', () {
    // The same fixtures as backend/tests/medicineLifecycle.test.js.
    expect(medOccurrenceReminderId('66b1f2a4c9e11a0012345678', '08:00', DateTime(2026, 9, 16)), 987727319);
    expect(medOccurrenceReminderId('66b1f2a4c9e11a0012345678', '08:00', DateTime(2026, 9, 17)), 970949700);
    expect(medOccurrenceReminderId('aaaaaaaaaaaaaaaaaaaaaaaa', '21:30', DateTime(2027, 1, 1)), 535574948);
    expect(medOccurrenceReminderId('5f9d1b', '00:00', DateTime(2026, 12, 31)), 845916719);
    expect(NotificationService.isMedicationReminderId(987727319), isTrue, reason: 'a re-sync would leave it ringing');
    expect(NotificationService.isMedicationReminderId(850000), isFalse, reason: 'the check-in nudge would be swept away');
  });
}
