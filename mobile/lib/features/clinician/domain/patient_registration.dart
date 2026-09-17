/// What happened when the desk registered somebody.
///
/// ---- Why this is not just an id ----------------------------------------
///
/// Registering a patient at the counter has two quite different outcomes and
/// the server has always said which:
///
///   * A number nobody has an account for is registered immediately. They are
///     in the practice's list before the receptionist looks up.
///   * A number that already has a MedPin account is *not*. The practice is
///     reaching for a record it did not create, so the enrolment is written
///     PENDING, a code goes to the patient's own handset, and the row grants
///     nothing until they read it back.
///
/// ---- And what the desk is not told in the second case ------------------
///
/// Who the account belongs to. The server sends back no id and no stored name
/// until the code comes back: a mistyped digit must not put a stranger's name
/// on the counter's screen. [id] is empty and [name] is what the desk typed;
/// the patient's own id and name arrive with [EnrolmentConfirmation].
class PatientRegistration {
  const PatientRegistration({
    required this.id,
    required this.name,
    required this.existing,
    required this.consentRequired,
    required this.enrollmentId,
    required this.message,
  });

  /// The patient record. Empty while consent is pending — see above.
  final String id;

  /// The name the desk typed, or the patient's own once they are this
  /// practice's patient.
  final String name;

  /// This number already had an account before today.
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
        name: json['name']?.toString() ?? '',
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

/// The patient's answers, at the counter, to the two questions asked when a
/// practice is connected: may this clinic see their own health logs, and their
/// earlier history.
///
/// Null answers mean the desk did not ask — the patient is asked in their own
/// app instead, and nothing is recorded on their behalf. That is why this is
/// not two plain booleans: "not asked" and "said no" are different facts.
class ConsentShareAnswers {
  const ConsentShareAnswers({required this.asked, this.ownLogs = false, this.history = false});

  /// The desk put the questions to the patient.
  final bool asked;
  final bool ownLogs;
  final bool history;

  static const notAsked = ConsentShareAnswers(asked: false);

  /// The body the confirmation sends: the code, and the answers only if asked.
  Map<String, dynamic> confirmBody(String code) => {
    'code': code,
    if (asked) 'share': {'ownLogs': ownLogs, 'history': history},
  };
}

/// What a confirmed code returned: who the patient is, now that they have said
/// yes, and what the practice is not seeing.
class EnrolmentConfirmation {
  const EnrolmentConfirmation({
    required this.patientId,
    required this.patientName,
    required this.notShared,
    required this.ownLogsShared,
    required this.historyShared,
  });

  final String? patientId;
  final String? patientName;
  final List<String> notShared;
  final bool ownLogsShared;
  final bool historyShared;

  factory EnrolmentConfirmation.fromJson(Map<String, dynamic> json) {
    final patient = json['patient'] as Map?;
    final sharing = json['sharing'] as Map?;
    return EnrolmentConfirmation(
      patientId: patient?['id']?.toString(),
      patientName: patient?['name']?.toString(),
      notShared: ((sharing?['notShared'] as List?) ?? const []).map((e) => e.toString()).toList(),
      ownLogsShared: sharing?['ownLogsShared'] == true,
      historyShared: sharing?['historyShared'] == true,
    );
  }

  /// One line for the counter about what the practice will not see.
  String get sharingSummary => switch ((ownLogsShared, historyShared)) {
    (true, true) => 'They shared their own health logs and their earlier history.',
    (true, false) => 'They shared their own health logs, not their earlier history.',
    (false, true) => 'They shared their earlier history, not their own health logs.',
    (false, false) => 'Their own health logs and earlier history are not shared with this clinic.',
  };
}

/// Somebody the practice has registered who has not yet agreed.
///
/// What the desk typed when it asked — a name, the number the code went to —
/// and when. Never the account's own details: a pending enrolment grants no
/// access, and the account behind a number is not the practice's to know until
/// its owner says so. A request made before the desk's words were kept has no
/// name to show.
class PendingEnrolment {
  const PendingEnrolment({
    required this.id,
    required this.name,
    required this.phone,
    required this.registeredOn,
  });

  /// The enrolment, which is what a code is confirmed against.
  final String id;

  /// What the desk typed. Null for a request from before that was kept.
  final String? name;

  /// Which number the code went to — how a desk tells two people with the same
  /// name apart, and checks they did not mistype it.
  final String? phone;
  final DateTime? registeredOn;

  /// What the row is called on screen: the typed name, else the number.
  String get label => name ?? phone ?? 'Name not recorded';

  factory PendingEnrolment.fromJson(Map<String, dynamic> json) => PendingEnrolment(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString(),
    phone: json['phone']?.toString(),
    registeredOn: DateTime.tryParse(json['registeredOn']?.toString() ?? '')?.toLocal(),
  );
}
