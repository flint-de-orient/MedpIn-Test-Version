import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/appointment.dart';

/// Talks to `/appointments`. Patients see and act on their own; clinicians see
/// the whole diary (the server scopes it by role).
class AppointmentRepository {
  AppointmentRepository(this._client);

  final ApiClient _client;

  Future<Paged<Appointment>> list({
    DateTime? from,
    DateTime? to,
    String? status,
    String? clinicId,
    String? patientId,
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/appointments',
      query: {
        'page': page,
        'limit': limit,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
        if (status != null) 'status': status,
        if (clinicId != null) 'clinicId': clinicId,
        if (patientId != null) 'patientId': patientId,
      },
    );
    return Paged.fromJson(json, Appointment.fromJson);
  }

  /// Book a slot. [scheduledForIso] is the absolute ISO instant from the chosen
  /// [Slot]; the server re-validates it against the live schedule.
  /// Books a slot.
  ///
  /// [patientId] is for the front desk booking on somebody's behalf — the
  /// receptionist taking a call, or a walk-in at the window. A patient booking
  /// for themselves leaves it null and the server uses their own id; it ignores
  /// the field for patient callers anyway, so this cannot be used to book into
  /// another person's name.
  Future<Appointment> book({
    required String clinicId,
    required String scheduledForIso,
    String mode = 'in_clinic',
    String? reason,
    String? patientId,
  }) async {
    final json = await _client.postJson(
      '/appointments',
      body: {
        'clinicId': clinicId,
        'scheduledFor': scheduledForIso,
        'mode': mode,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
        if (patientId != null) 'patientId': patientId,
      },
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }

  Future<Appointment> reschedule(String id, String scheduledForIso) async {
    final json = await _client.patchJson(
      '/appointments/$id/reschedule',
      body: {'scheduledFor': scheduledForIso},
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }

  Future<Appointment> cancel(String id, {String? reason}) async {
    final json = await _client.patchJson(
      '/appointments/$id/cancel',
      body: {if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }

  /// Ask to be told when a slot frees up on a day that is currently full.
  /// [dateKey] is `yyyy-MM-dd`; the server records the request and pushes the
  /// patient the moment a slot on that day opens.
  Future<void> joinWaitlist({
    required String clinicId,
    required String dateKey,
  }) async {
    await _client.postJson(
      '/appointments/waitlist',
      body: {'clinicId': clinicId, 'date': dateKey},
    );
  }

  /// Clinician-only: advance the appointment's status (confirm, complete, …)
  /// and optionally attach consultation notes.
  /// Ask the clinic for an appointment without choosing a slot.
  ///
  /// The other path — picking a free time from the published schedule —
  /// confirms immediately. This one creates a request the desk answers, for
  /// the patient who would rather say "Tuesday" than read a timetable.
  Future<Appointment> requestAppointment({
    required DateTime preferredFor,
    /// 'HH:mm', or null for "any time" — which is a real answer, and the one
    /// most patients mean. The desk still picks from the doctor's real hours;
    /// this only says which end of the day to look at first.
    String? preferredTime,
    String reason = '',
  }) async {
    final json = await _client.postJson(
      '/appointments/request',
      body: {
        // Date only, at local midnight. Sending the instant would shift the
        // day across the timezone boundary for anyone asking late at night.
        'preferredFor':
            DateTime(
              preferredFor.year,
              preferredFor.month,
              preferredFor.day,
            ).toIso8601String(),
        if (preferredTime != null) 'preferredTime': preferredTime,
        if (reason.isNotEmpty) 'reason': reason,
      },
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }

  /// Turn a request into a booking: give it a clinic and a time.
  ///
  /// One call, not reschedule-then-set-status. Reschedule validates the time
  /// against the appointment's existing clinic, and a request has none — so
  /// that route would skip slot validation and leave the row `requested` with a
  /// time on it, which is the state that holds a slot without being a booking.
  Future<Appointment> confirmRequest(
    String id, {
    required String clinicId,
    required DateTime scheduledFor,
    /// Sent only on a second attempt, after the desk has been shown that this
    /// patient already has a slot that day and has chosen to go ahead.
    bool allowSameDay = false,
  }) async {
    final json = await _client.patchJson(
      '/appointments/$id/confirm',
      body: {
        'clinicId': clinicId,
        'scheduledFor': scheduledFor.toUtc().toIso8601String(),
        if (allowSameDay) 'allowSameDay': true,
      },
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }

  Future<Appointment> setStatus(
    String id,
    String status, {
    String? consultationNotes,
  }) async {
    final json = await _client.patchJson(
      '/appointments/$id/status',
      body: {
        'status': status,
        if (consultationNotes != null && consultationNotes.isNotEmpty)
          'consultationNotes': consultationNotes,
      },
    );
    return Appointment.fromJson(json['appointment'] as Map<String, dynamic>);
  }
}

final Provider<AppointmentRepository> appointmentRepositoryProvider =
    Provider<AppointmentRepository>((ref) {
      return AppointmentRepository(ref.watch(apiClientProvider));
    });
