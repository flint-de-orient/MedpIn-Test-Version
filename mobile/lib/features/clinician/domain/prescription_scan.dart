/// What the server read off a photographed prescription, before anything is
/// filed.
///
/// The clinic's pilot runs on paper: fifty handwritten prescriptions, each
/// photographed at the desk. Reading them costs one model call and saves the
/// desk transcribing a medicine list by hand — and, more to the point, it is
/// the only way the app can check that the slip in front of them belongs to the
/// record they have open.
class PrescriptionScan {
  const PrescriptionScan({
    required this.readable,
    required this.name,
    this.issuedOn,
    this.items = const [],
    this.diagnosis = const [],
    this.labTests = const [],
    this.advice,
    this.note,
    this.prescriberName,
  });

  /// False for a blurred photograph, or one that is not a prescription.
  ///
  /// Not a failure: the image is still the record, and it files with no
  /// structured detail. Refusing would leave the pilot with nothing.
  final bool readable;

  /// Whose name is on the paper, against whose record this is.
  final ScanNameCheck name;

  /// The date printed on the prescription, or null when it carries none.
  ///
  /// Null is why the date picker still exists — as a fallback, rather than as
  /// the first thing the desk is asked while holding the paper it is printed
  /// on.
  final DateTime? issuedOn;

  final List<ScannedRxItem> items;
  final List<String> diagnosis;
  final List<String> labTests;
  final String? advice;

  /// The model's own remark about the page — "handwriting unclear on line 3".
  final String? note;
  final String? prescriberName;

  bool get hasDetail =>
      items.isNotEmpty ||
      diagnosis.isNotEmpty ||
      labTests.isNotEmpty ||
      (advice ?? '').trim().isNotEmpty;

  factory PrescriptionScan.fromJson(Map<String, dynamic> j) => PrescriptionScan(
    readable: j['readable'] == true,
    name: ScanNameCheck.fromJson(j['name']),
    issuedOn: DateTime.tryParse(j['issuedOn']?.toString() ?? '')?.toLocal(),
    items:
        (j['items'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ScannedRxItem.fromJson)
            .toList(),
    diagnosis:
        (j['diagnosis'] as List? ?? const []).map((e) => e.toString()).toList(),
    labTests:
        (j['labTests'] as List? ?? const []).map((e) => e.toString()).toList(),
    advice: (j['advice']?.toString().trim().isEmpty ?? true)
        ? null
        : j['advice'].toString().trim(),
    note: j['note']?.toString(),
    prescriberName:
        (j['prescriber'] as Map?)?['name']?.toString(),
  );
}

/// Whether the name on the paper is the patient whose record is open.
///
/// Three answers and no score. Indian names transliterate many ways, and a
/// similarity threshold loose enough for Dey/Dae also accepts Das for Dhara —
/// two people who may both be in the waiting room. So a partial match is not
/// "probably fine", it is "somebody must look".
class ScanNameCheck {
  const ScanNameCheck({
    required this.verdict,
    this.onPaper,
    this.onFile,
    this.mustConfirm = false,
  });

  /// `exact` · `partial` · `different` · `unknown`.
  final String verdict;

  /// The name printed on the prescription, or null when none was legible.
  final String? onPaper;

  /// The name on the record the desk has open.
  final String? onFile;

  /// True when the desk has to say out loud that this is the right person.
  final bool mustConfirm;

  bool get isMismatch => verdict == 'different';

  factory ScanNameCheck.fromJson(Object? raw) {
    final j = raw is Map ? raw : const {};
    return ScanNameCheck(
      verdict: j['verdict']?.toString() ?? 'unknown',
      onPaper: j['onPaper']?.toString(),
      onFile: j['onFile']?.toString(),
      mustConfirm: j['mustConfirm'] == true,
    );
  }
}

/// One medicine line read off the page.
///
/// Not `ScannedMedicine` — that name is taken by the patient-side scan, which
/// is a different thing: it carries the computed reminder times for a medicine
/// about to be armed. This is a line on a prescription *record*, with the
/// frequency as the doctor wrote it and no alarms attached. Two classes with
/// one name is a trap this codebase has already sprung once, on `Appointment`.
class ScannedRxItem {
  const ScannedRxItem({
    required this.name,
    this.strength,
    this.dose,
    this.frequency,
    this.durationDays,
    this.relationToMeal,
    this.instructions,
  });

  final String name;
  final String? strength;
  final String? dose;

  /// "1-0-1", "BD", "TDS" — kept as the doctor wrote it.
  final String? frequency;
  final int? durationDays;
  final String? relationToMeal;
  final String? instructions;

  /// One line, for a list the desk reads rather than edits.
  String get summary => [
    name,
    if ((strength ?? '').isNotEmpty) strength!,
    if ((frequency ?? '').isNotEmpty) frequency!,
    if (durationDays != null) '${durationDays}d',
  ].join('  ');

  factory ScannedRxItem.fromJson(Map<String, dynamic> j) => ScannedRxItem(
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString(),
    dose: j['dose']?.toString(),
    frequency: j['frequency']?.toString(),
    durationDays: (j['durationDays'] as num?)?.toInt(),
    relationToMeal: j['relationToMeal']?.toString(),
    instructions: j['instructions']?.toString(),
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    if ((strength ?? '').isNotEmpty) 'strength': strength,
    if ((dose ?? '').isNotEmpty) 'dose': dose,
    if ((frequency ?? '').isNotEmpty) 'frequency': frequency,
    if (durationDays != null) 'durationDays': durationDays,
    if ((relationToMeal ?? '').isNotEmpty) 'relationToMeal': relationToMeal,
    if ((instructions ?? '').isNotEmpty) 'instructions': instructions,
  };
}
