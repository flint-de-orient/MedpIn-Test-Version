import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/clinic.dart';
import '../domain/doctor_hours.dart';

/// A location saved, and — when the save left it closed — who is still booked
/// there.
typedef ClinicSaved = ({Clinic clinic, StillBooked? stillBooked});

/// Talks to `/clinics`. Reads are open to any authenticated user; writes are
/// clinician-only (the server enforces the role, this just exposes them).
class ClinicRepository {
  ClinicRepository(this._client);

  final ApiClient _client;

  Future<List<Clinic>> list() async {
    final json = await _client.getJson('/clinics');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(Clinic.fromJson)
        .toList();
  }

  Future<Clinic> get(String id) async {
    final json = await _client.getJson('/clinics/$id');
    return Clinic.fromJson(json['clinic'] as Map<String, dynamic>);
  }

  Future<SlotDay> slots(String clinicId, String date) async {
    final json = await _client.getJson(
      '/clinics/$clinicId/slots',
      query: {'date': date},
    );
    return SlotDay.fromJson(json);
  }

  Future<Clinic> create(Map<String, dynamic> body) async {
    final json = await _client.postJson('/clinics', body: body);
    return Clinic.fromJson(json['clinic'] as Map<String, dynamic>);
  }

  /// Save a location. Switching "Accepting bookings" off closes it, and the
  /// answer then says who is still booked there.
  Future<ClinicSaved> update(String id, Map<String, dynamic> body) async {
    final json = await _client.patchJson('/clinics/$id', body: body);
    return (
      clinic: Clinic.fromJson(json['clinic'] as Map<String, dynamic>),
      stillBooked: StillBooked.fromJson(json),
    );
  }

  /// Close a location: no new slots or bookings there, and nothing already
  /// booked is touched. The answer lists who is still booked there, for the
  /// desk to move or call off.
  ///
  /// The same close the delete route makes, sent as `isActive: false` so the
  /// list comes back with it.
  Future<ClinicSaved> deactivate(String id) => update(id, const {'isActive': false});

  /// Every doctor's hours at a location.
  Future<LocationHours> doctorHours(String clinicId) async {
    final json = await _client.getJson('/clinics/$clinicId/availability');
    return LocationHours.fromJson(json);
  }

  /// Give a doctor hours of their own at a location. No sittings means the
  /// doctor is not at this location.
  Future<({DoctorHours hours, List<HoursOverlap> overlaps})> setDoctorHours(
    String clinicId,
    String doctorId, {
    required int slotMinutes,
    required List<WeeklyHour> weeklyHours,
  }) async {
    final json = await _client.putJson(
      '/clinics/$clinicId/availability/$doctorId',
      body: {
        'slotMinutes': slotMinutes,
        'weeklyHours': weeklyHours.map((w) => w.toJson()).toList(),
      },
    );
    return (
      hours: DoctorHours.fromJson(json),
      overlaps:
          (json['overlapsElsewhere'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(HoursOverlap.fromJson)
              .toList() ??
          const <HoursOverlap>[],
    );
  }

  /// Give a doctor the location's own hours back.
  Future<void> useLocationHours(String clinicId, String doctorId) async {
    await _client.delete('/clinics/$clinicId/availability/$doctorId');
  }
}

final Provider<ClinicRepository> clinicRepositoryProvider =
    Provider<ClinicRepository>((ref) {
      return ClinicRepository(ref.watch(apiClientProvider));
    });

// The number a patient rings is not worked out here any more. It was the first
// location on this list with a phone, or a placeholder compiled into the app —
// another practice's desk, or nobody. See shared/data/care_contact.dart.
