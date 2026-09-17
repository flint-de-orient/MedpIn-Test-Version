import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/paged.dart';
import '../data/appointment_repository.dart';
import '../data/clinic_repository.dart';
import '../domain/appointment.dart';
import '../domain/clinic.dart';
import '../domain/doctor_hours.dart';

/// All clinics the caller may see (patients: active only; clinicians: all).
final clinicsProvider = FutureProvider.autoDispose<List<Clinic>>((ref) {
  return ref.watch(clinicRepositoryProvider).list();
});

/// Every doctor's hours at one location, by the location's id.
final locationHoursProvider = FutureProvider.autoDispose
    .family<LocationHours, String>((ref, clinicId) {
      return ref.watch(clinicRepositoryProvider).doctorHours(clinicId);
    });

/// Bookable slots for one clinic on one clinic-local date ('YYYY-MM-DD').
final slotDayProvider = FutureProvider.autoDispose
    .family<SlotDay, ({String clinicId, String date})>((ref, args) {
      return ref
          .watch(clinicRepositoryProvider)
          .slots(args.clinicId, args.date);
    });

/// The signed-in patient's own appointments (server scopes by role). Split in
/// the UI into upcoming and past.
final myAppointmentsProvider = FutureProvider.autoDispose<List<Appointment>>((
  ref,
) async {
  final paged = await ref.watch(appointmentRepositoryProvider).list(limit: 100);
  return paged.items;
});

/// Query parameters for the clinician appointment diary.
typedef AppointmentQuery =
    ({DateTime? from, DateTime? to, String? status, String? clinicId});

/// Clinician view of the diary for a date range / status.
final appointmentDiaryProvider = FutureProvider.autoDispose
    .family<Paged<Appointment>, AppointmentQuery>((ref, q) {
      return ref
          .watch(appointmentRepositoryProvider)
          .list(
            from: q.from,
            to: q.to,
            status: q.status,
            clinicId: q.clinicId,
            limit: 100,
          );
    });

/// Local-day bounds for "today", stable within the day so the family key does
/// not churn on every rebuild.
({DateTime from, DateTime to}) todayBounds() {
  final now = DateTime.now();
  final from = DateTime(now.year, now.month, now.day);
  final to = DateTime(now.year, now.month, now.day, 23, 59, 59);
  return (from: from, to: to);
}
