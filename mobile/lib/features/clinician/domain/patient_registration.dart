/// What happened when the desk registered somebody.
///
/// ---- Why this is not just an id ----------------------------------------
///
/// Registering a patient at the counter has two quite different outcomes and
/// the server has always said which:
///
///   * A person nobody has a record for is enrolled immediately. They are in
///     the practice's list before the receptionist looks up.
///   * A person who already uses MedPin somewhere else is *not*. The practice
///     is reaching for a record it did not create, so the enrolment is written
///     PENDING, a code goes to the patient's own handset, and the row grants
///     nothing until they read it back.
///
/// The API returns `existing`, `consentRequired`, `enrollmentId` and a
/// `message` for exactly this. The app read `json['id']` and dropped the other
/// four, so the second case showed the same "registered" confirmation as the
/// first — and then the patient appeared in no list, because a pending
/// enrolment is correctly invisible.
///
/// From the counter that is indistinguishable from the registration having
/// failed, which is what it was reported as.
class PatientRegistration {
  const PatientRegistration({
    required this.id,
    required this.existing,
    required this.consentRequired,
    required this.enrollmentId,
    required this.message,
  });

  /// The patient record. Empty only if the server sent no id, which it does
  /// not do on a success — kept nullable-ish rather than asserted because a
  /// blank id must not crash the screen that just saved somebody.
  final String id;

  /// This person already had an account before today.
  final bool existing;

  /// The enrolment is pending and the patient has been texted a code.
  ///
  /// While this is true the practice cannot see them: every clinical list is
  /// scoped to ACTIVE enrolments.
  final bool consentRequired;

  /// The row to confirm the code against. Null when nothing is pending.
  final String? enrollmentId;

  /// The server's own sentence about what happened. Shown rather than
  /// reworded, so the counter and the log say the same thing.
  final String message;

  factory PatientRegistration.fromJson(Map<String, dynamic> json) =>
      PatientRegistration(
        id: json['id']?.toString() ?? '',
        existing: json['existing'] == true,
        consentRequired: json['consentRequired'] == true,
        enrollmentId: json['enrollmentId']?.toString(),
        // Absent on the ordinary path, where the screen has always written its
        // own line and there is nothing unusual to explain.
        message: json['message']?.toString() ?? '',
      );

  /// Whether this patient is in the practice's lists right now.
  ///
  /// The one question the screen actually has to answer, and the reason it
  /// must not say "registered" for both outcomes.
  bool get isEnrolledNow => !consentRequired;
}
