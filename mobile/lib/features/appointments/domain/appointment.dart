/// A booked appointment, as returned by `/appointments`.
class Appointment {
  const Appointment({
    required this.id,
    this.scheduledFor,
    this.preferredFor,
    this.preferredTime,
    required this.status,
    required this.mode,
    this.durationMinutes = 15,
    this.patientId,
    this.patientName,
    this.patientPhone,
    this.patientAvatarUrl,
    this.doctorName,
    this.clinicId,
    this.clinicName,
    this.clinicAddress,
    this.clinicCity,
    this.clinicPhone,
    this.reason,
    this.queueNumber,
    this.isPriority = false,
    this.consultationNotes,
    this.createdAt,
  });

  final String id;

  /// When the appointment is — null while it is still only a request.
  ///
  /// A request carries no time: the patient asked for a day and the desk has
  /// not yet assigned an hour. This used to fall back to DateTime.now() when
  /// the server sent null, so a request rendered as though it were scheduled
  /// for this very minute and could appear in today's list. An absent time has
  /// to read as absent.
  final DateTime? scheduledFor;

  /// The day the patient asked for, on a request. Never a booking.
  final DateTime? preferredFor;

  /// The hour the patient would like, 'HH:mm', or null for "any time".
  ///
  /// A wish, not a booking. The desk sees it beside the request and picks from
  /// the hours the doctor actually keeps; it only says which end of the day to
  /// look at first.
  ///
  /// Carried on both Appointment models — this one and the clinician's — which
  /// is a duplication worth naming: two classes with one name is already a
  /// trap (see todays_clinic.dart), and every field added to one and not the
  /// other widens it.
  final String? preferredTime;

  /// True while this is a request rather than a booking.
  bool get isRequest => status == 'requested' || scheduledFor == null;

  /// The date to show for this row, whichever kind it is.
  DateTime? get displayDate => scheduledFor ?? preferredFor;

  /// requested | confirmed | checked_in | in_consultation | completed |
  /// cancelled | no_show
  final String status;

  /// in_clinic | teleconsult
  final String mode;
  final int durationMinutes;

  final String? patientId;
  final String? patientName;
  final String? patientPhone;

  /// The patient's photo, when they have set one.
  ///
  /// A face is what the desk is matching against the person in front of them;
  /// initials in a coloured circle are a placeholder, not an identification.
  final String? patientAvatarUrl;
  final String? doctorName;

  final String? clinicId;
  final String? clinicName;
  final String? clinicAddress;
  final String? clinicCity;
  final String? clinicPhone;

  final String? reason;
  final int? queueNumber;
  final bool isPriority;
  final String? consultationNotes;
  final DateTime? createdAt;

  bool get isTeleconsult => mode == 'teleconsult';
  bool get isCancelled => status == 'cancelled';
  bool get isCompleted => status == 'completed';

  /// A request is never past. It has no time to be past, and the desk has
  /// still to answer it — filing it under history would lose it.
  bool get isPast =>
      scheduledFor != null && scheduledFor!.isBefore(DateTime.now());

  /// The instant to sort this row by, requests included.
  ///
  /// A request sorts by the day it asked for, so it sits among the bookings it
  /// is competing for rather than at one end of the list.
  DateTime get sortKey =>
      scheduledFor ?? preferredFor ?? DateTime.fromMillisecondsSinceEpoch(0);

  /// Whether the patient can still act on it (cancel / reschedule).
  bool get isActive =>
      status == 'requested' ||
      status == 'confirmed' ||
      status == 'checked_in' ||
      status == 'in_consultation';

  factory Appointment.fromJson(Map<String, dynamic> j) {
    final clinic = j['clinic'];
    final clinicMap =
        clinic is Map<String, dynamic> ? clinic : const <String, dynamic>{};
    return Appointment(
      id: j['id']?.toString() ?? '',
      scheduledFor:
          DateTime.tryParse(j['scheduledFor']?.toString() ?? '')?.toLocal(),
      preferredFor:
          DateTime.tryParse(j['preferredFor']?.toString() ?? '')?.toLocal(),
      preferredTime: j['preferredTime']?.toString(),
      status: j['status']?.toString() ?? 'requested',
      mode: j['mode']?.toString() ?? 'in_clinic',
      durationMinutes: (j['durationMinutes'] as num?)?.toInt() ?? 15,
      patientId: j['patientId']?.toString(),
      patientName: j['patientName']?.toString(),
      patientPhone: j['patientPhone']?.toString(),
      patientAvatarUrl: j['patientAvatarUrl']?.toString(),
      doctorName: j['doctorName']?.toString(),
      clinicId: (clinicMap['id'] ?? j['clinicId'])?.toString(),
      clinicName: clinicMap['name']?.toString(),
      clinicAddress: clinicMap['addressLine']?.toString(),
      clinicCity: clinicMap['city']?.toString(),
      clinicPhone: clinicMap['phone']?.toString(),
      reason: j['reason']?.toString(),
      queueNumber: (j['queueNumber'] as num?)?.toInt(),
      isPriority: j['isPriority'] == true,
      consultationNotes: j['consultationNotes']?.toString(),
      createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    );
  }
}
