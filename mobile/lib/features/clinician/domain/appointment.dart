/// One appointment on the clinic diary, from `GET /api/v1/appointments`.
///
/// Only the fields the doctor's dashboard needs are parsed. Status follows the
/// backend `APPOINTMENT_STATUS` enum:
/// requested · confirmed · checked_in · in_consultation · completed ·
/// cancelled · no_show.
class Appointment {
  const Appointment({
    required this.id,
    required this.patientId,
    required this.patientName,
    this.scheduledFor,
    this.preferredFor,
    this.preferredTime,
    required this.status,
    required this.mode,
    this.reason,
    this.isPriority = false,
    this.doctorId,
    this.doctorName,
    this.patientAvatarUrl,
  });

  final String id;
  final String patientId;
  final String patientName;

  /// Whose appointment it is.
  ///
  /// The diary a doctor reads is the practice's — every doctor's patients —
  /// so "who is waiting" without this is "who is waiting for somebody", and a
  /// Start consultation button naming a colleague's patient would be wrong.
  final String? doctorId;
  final String? doctorName;

  /// The patient's photo, when they set one.
  final String? patientAvatarUrl;

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
  /// A wish and not a booking, which is why the desk sees it beside the
  /// request rather than in a slot: it says which end of the day to look at
  /// first, and nothing more.
  final String? preferredTime;

  /// True while this is a request rather than a booking.
  bool get isRequest => status == 'requested' || scheduledFor == null;

  /// The date to show for this row, whichever kind it is.
  DateTime? get displayDate => scheduledFor ?? preferredFor;

  /// The instant to sort by, requests included — they sort by the day asked
  /// for, so they sit among the bookings they are competing for.
  DateTime get sortKey =>
      scheduledFor ?? preferredFor ?? DateTime.fromMillisecondsSinceEpoch(0);

  /// Raw status string from the API (one of APPOINTMENT_STATUS).
  final String status;

  /// `in_clinic` | `teleconsult`.
  final String mode;

  /// Free-text reason for the visit, e.g. "Lab Results Review".
  final String? reason;
  final bool isPriority;

  bool get isCompleted => status == 'completed';

  /// The doctor is with this patient right now (called in or mid-consult).
  bool get isInProgress =>
      status == 'checked_in' || status == 'in_consultation';

  bool get isCancelled => status == 'cancelled' || status == 'no_show';

  /// Still to come — booked/confirmed but not started.
  bool get isUpcoming => !isCompleted && !isInProgress && !isCancelled;

  /// Short human label for the status pill.
  String get statusLabel {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'in_consultation':
        return 'In progress';
      case 'checked_in':
        return 'Checked in';
      case 'confirmed':
        return 'Confirmed';
      case 'requested':
        return 'Requested';
      case 'cancelled':
        return 'Cancelled';
      case 'no_show':
        return 'No show';
      default:
        return status;
    }
  }

  factory Appointment.fromJson(Map<String, dynamic> j) {
    return Appointment(
      id: j['id']?.toString() ?? '',
      patientId: j['patientId']?.toString() ?? '',
      patientName: j['patientName']?.toString() ?? 'Patient',
      scheduledFor:
          DateTime.tryParse(j['scheduledFor']?.toString() ?? '')?.toLocal(),
      preferredFor:
          DateTime.tryParse(j['preferredFor']?.toString() ?? '')?.toLocal(),
      preferredTime: j['preferredTime']?.toString(),
      status: j['status']?.toString() ?? 'requested',
      mode: j['mode']?.toString() ?? 'in_clinic',
      reason:
          (j['reason']?.toString().trim().isEmpty ?? true)
              ? null
              : j['reason'].toString().trim(),
      isPriority: j['isPriority'] == true,
      doctorId: j['doctorId']?.toString(),
      doctorName: j['doctorName']?.toString(),
      patientAvatarUrl: j['patientAvatarUrl']?.toString(),
    );
  }
}
