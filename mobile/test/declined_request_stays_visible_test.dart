import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/features/appointments/domain/appointment.dart';

/// A request the clinic turned down must remain findable in the app.
///
/// The clinic does send a push when it declines. A push is dismissed, arrives
/// while the phone is face down, or is cleared by a patient tidying their
/// notifications — and after that the app held no visible record of the refusal
/// anywhere the patient would look. A declined request is `cancelled`, and
/// cancelled appointments sorted into the Past tab of a screen most patients
/// never open.
///
/// The failure mode is somebody turning up for an appointment they do not
/// have. So these pin the rule the home section is built on: a declined request
/// is the one cancellation carrying no time, because it never got one.
Appointment _appt({
  required String status,
  DateTime? scheduledFor,
  DateTime? preferredFor,
  DateTime? createdAt,
}) => Appointment.fromJson({
  'id': 'a1',
  'status': status,
  'mode': 'in_clinic',
  'durationMinutes': 15,
  if (scheduledFor != null) 'scheduledFor': scheduledFor.toIso8601String(),
  if (preferredFor != null) 'preferredFor': preferredFor.toIso8601String(),
  if (createdAt != null) 'createdAt': createdAt.toIso8601String(),
});

/// The same rule the home section applies, kept here so it can be asserted
/// without standing up a network layer.
bool isDeclinedRequest(Appointment a) =>
    a.status == 'cancelled' && a.scheduledFor == null;

void main() {
  group('telling a refusal from a cancellation', () {
    test('a declined request carries no time', () {
      // Never given one. The desk said no while it was still a wish.
      final declined = _appt(
        status: 'cancelled',
        preferredFor: DateTime(2026, 8, 30),
        createdAt: DateTime(2026, 8, 29),
      );

      expect(declined.scheduledFor, isNull);
      expect(isDeclinedRequest(declined), isTrue);
    });

    test('a cancelled booking is not a refusal', () {
      // It had an hour before somebody called it off, so it keeps one. Showing
      // this to the patient as "the clinic could not give you this day" would
      // be telling them they were turned down for a visit they were granted.
      final calledOff = _appt(
        status: 'cancelled',
        scheduledFor: DateTime(2026, 8, 31, 10),
        createdAt: DateTime(2026, 8, 29),
      );

      expect(calledOff.scheduledFor, isNotNull);
      expect(isDeclinedRequest(calledOff), isFalse);
    });

    test('a request still waiting is neither', () {
      final waiting = _appt(
        status: 'requested',
        preferredFor: DateTime(2026, 9, 1),
        createdAt: DateTime(2026, 8, 30),
      );

      expect(isDeclinedRequest(waiting), isFalse);
      expect(waiting.scheduledFor, isNull, reason: 'a request holds no slot');
    });

    test('a confirmed appointment is neither', () {
      final confirmed = _appt(
        status: 'confirmed',
        scheduledFor: DateTime(2026, 8, 31, 10),
      );

      expect(isDeclinedRequest(confirmed), isFalse);
      expect(confirmed.isActive, isTrue);
    });
  });
}
