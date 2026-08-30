import 'package:flutter_test/flutter_test.dart';
import 'package:akd_care/features/appointments/domain/clinic.dart';
import 'package:akd_care/features/appointments/domain/clinic_status.dart';

/// The front desk header says "Open · Closes 8:00 PM", and a receptionist reads
/// it before telling somebody on the phone whether to come in. These are the
/// cases where getting it wrong sends a patient to a locked door.

Clinic _clinic({
  List<WeeklyHour> weekly = const [],
  List<ClinicOverride> overrides = const [],
}) => Clinic(
  id: 'c1',
  name: 'Test Clinic',
  weeklyHours: weekly,
  overrides: overrides,
);

/// 30 August 2026 is a Sunday, so dayOfWeek 0 in the clinic's own numbering.
DateTime _sundayAt(int h, int m) => DateTime(2026, 8, 30, h, m);

void main() {
  group('clinicStatusAt', () {
    test('open inside a weekly window, and says when it closes', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
      );
      final s = clinicStatusAt(c, _sundayAt(12, 45));

      expect(s.open, isTrue);
      expect(s.closesAt, DateTime(2026, 8, 30, 20, 0));
      expect(s.opensAt, isNull);
    });

    test('DateTime.weekday 7 maps to the clinic\'s Sunday, which is 0', () {
      // The one line most likely to be wrong, and silently: Dart calls Sunday
      // 7, the schema calls it 0, and a clinic that opens only on Sundays would
      // read as permanently closed if the modulo went missing.
      expect(_sundayAt(12, 0).weekday, 7);
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
      );
      expect(clinicStatusAt(c, _sundayAt(12, 0)).open, isTrue);
    });

    test('closed before opening, and says when it opens', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
      );
      final s = clinicStatusAt(c, _sundayAt(7, 30));

      expect(s.open, isFalse);
      expect(s.opensAt, DateTime(2026, 8, 30, 9, 0));
      expect(s.closesAt, isNull);
    });

    test('after the last window, closed with nothing promised', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
      );
      final s = clinicStatusAt(c, _sundayAt(21, 0));

      expect(s.open, isFalse);
      expect(s.opensAt, isNull, reason: 'nothing left today to open for');
      expect(s.closesAt, isNull);
    });

    test('a lunch break closes and reopens', () {
      final c = _clinic(
        weekly: [
          const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '13:00'),
          const WeeklyHour(dayOfWeek: 0, start: '17:00', end: '20:00'),
        ],
      );

      expect(clinicStatusAt(c, _sundayAt(11, 0)).closesAt,
          DateTime(2026, 8, 30, 13, 0));

      final afternoon = clinicStatusAt(c, _sundayAt(15, 0));
      expect(afternoon.open, isFalse);
      expect(afternoon.opensAt, DateTime(2026, 8, 30, 17, 0),
          reason: 'the evening surgery is still to come');

      expect(clinicStatusAt(c, _sundayAt(18, 0)).open, isTrue);
    });

    test('a closure override beats the rota', () {
      // The case this exists for: the doctor shuts for Durga Puja, enters it
      // once, and the header must not keep saying Open because the weekly
      // pattern still has a Sunday in it.
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
        overrides: [
          const ClinicOverride(date: '2026-08-30', isClosed: true, windows: []),
        ],
      );
      final s = clinicStatusAt(c, _sundayAt(12, 0));

      expect(s.open, isFalse);
      expect(s.opensAt, isNull);
    });

    test('an override with hours replaces the rota rather than adding to it', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
        overrides: [
          const ClinicOverride(
            date: '2026-08-30',
            isClosed: false,
            windows: [(start: '10:00', end: '12:00')],
          ),
        ],
      );

      expect(clinicStatusAt(c, _sundayAt(11, 0)).open, isTrue);
      expect(
        clinicStatusAt(c, _sundayAt(15, 0)).open,
        isFalse,
        reason: 'the ordinary Sunday hours must not still apply',
      );
    });

    test('an override for another day is ignored', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
        overrides: [
          const ClinicOverride(date: '2026-08-31', isClosed: true, windows: []),
        ],
      );
      expect(clinicStatusAt(c, _sundayAt(12, 0)).open, isTrue);
    });

    test('no hours at all is closed, not open', () {
      // A clinic with an empty schedule is the state every clinic starts in.
      // Defaulting to open would have the header vouch for a door nobody has
      // said anything about.
      expect(clinicStatusAt(_clinic(), _sundayAt(12, 0)).open, isFalse);
    });

    test('malformed times are dropped, not crashed on', () {
      final c = _clinic(
        weekly: [
          const WeeklyHour(dayOfWeek: 0, start: 'nonsense', end: '20:00'),
          const WeeklyHour(dayOfWeek: 0, start: '25:00', end: '26:00'),
          const WeeklyHour(dayOfWeek: 0, start: '14:00', end: '09:00'),
        ],
      );
      expect(clinicStatusAt(c, _sundayAt(12, 0)).open, isFalse);
    });

    test('the boundary minute: closing time is closed', () {
      final c = _clinic(
        weekly: [const WeeklyHour(dayOfWeek: 0, start: '09:00', end: '20:00')],
      );
      expect(clinicStatusAt(c, _sundayAt(19, 59)).open, isTrue);
      expect(clinicStatusAt(c, _sundayAt(20, 0)).open, isFalse);
      expect(clinicStatusAt(c, _sundayAt(9, 0)).open, isTrue);
    });
  });
}
