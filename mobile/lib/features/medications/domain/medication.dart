import 'med_shorthand.dart';

/// `Medication` object from API_CONTRACT.md §4.
class Medication {
  const Medication({
    required this.id,
    required this.name,
    required this.form,
    required this.strength,
    this.strengthExpected,
    this.strengthComposition,
    required this.dose,
    required this.schedule,
    required this.daysOfWeek,
    required this.isActive,
    this.genericName,
    this.startDate,
    this.endDate,
    this.instructions,
    this.route = 'oral',
    this.asNeeded = false,
    this.stat = false,
    this.dayInterval = 1,
  });

  final String id;
  final String name;
  final String? genericName;
  final String form;
  final String strength;

  /// What the clinic's brand list says this product's strength should be.
  /// Present only when it disagrees with [strength], or when none was recorded.
  /// Never applied automatically — a dose is changed by a person.
  final String? strengthExpected;

  /// "Metformin 500 mg + Glimepiride 1 mg", so the disagreement can be judged
  /// rather than merely reported.
  final String? strengthComposition;

  bool get hasStrengthMismatch => (strengthExpected ?? '').isNotEmpty;
  final String dose;
  final List<MedicationScheduleEntry> schedule;
  final List<String> daysOfWeek;
  final DateTime? startDate;
  final DateTime? endDate;
  final bool isActive;
  final String? instructions;

  /// oral | iv | sc | im | topical | inhaled.
  final String route;

  /// PRN/SOS — taken as needed, so it arms no reminders.
  final bool asNeeded;

  /// Stat — a single immediate dose.
  final bool stat;

  /// 1 = daily, 2 = every other day (EOD).
  final int dayInterval;

  factory Medication.fromJson(Map<String, dynamic> json) {
    return Medication(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      genericName: json['genericName'] as String?,
      form: json['form']?.toString() ?? '',
      strength: json['strength']?.toString() ?? '',
      strengthExpected: json['strengthExpected']?.toString(),
      strengthComposition: json['strengthComposition']?.toString(),
      dose: json['dose']?.toString() ?? '',
      schedule:
          (json['schedule'] as List<dynamic>? ?? const [])
              .map(
                (e) =>
                    MedicationScheduleEntry.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
      daysOfWeek:
          (json['daysOfWeek'] as List<dynamic>? ?? const [])
              .map((e) => e.toString())
              .toList(),
      startDate:
          json['startDate'] == null
              ? null
              : DateTime.tryParse(json['startDate'].toString()),
      endDate:
          json['endDate'] == null
              ? null
              : DateTime.tryParse(json['endDate'].toString()),
      isActive: json['isActive'] as bool? ?? true,
      instructions: json['instructions'] as String?,
      route: json['route']?.toString() ?? 'oral',
      asNeeded: json['asNeeded'] as bool? ?? false,
      stat: json['stat'] as bool? ?? false,
      dayInterval: (json['dayInterval'] as num?)?.toInt() ?? 1,
    );
  }
}

/// Result of `POST /medications/scan` — the medicines read from a prescription
/// photo and created in the tracker. [readable] is false when the photo could
/// not be read, so the UI can ask for a clearer one.
/// What the scan read, before any of it is saved.
///
/// [items] is a proposal, not a record. The server used to create the medicines
/// as it read them and hand back what it had already done — so a misread hour
/// was a live alarm before the patient could see it. It now reads, works out
/// the times, and stops; the patient looks, drops anything they do not
/// recognise, and only then is any of it written.
class PrescriptionScanResult {
  const PrescriptionScanResult({
    required this.readable,
    required this.created,
    this.items = const [],
    this.prescriber,
    this.note,
  });

  final bool readable;

  /// Empty from a scan. Filled by the confirm step with what was actually
  /// saved, so the sheet can say how many rather than guessing.
  final List<Medication> created;

  final List<ScannedMedicine> items;
  final Map<String, dynamic>? prescriber;
  final String? note;

  factory PrescriptionScanResult.fromJson(Map<String, dynamic> json) {
    return PrescriptionScanResult(
      readable: json['readable'] as bool? ?? false,
      created:
          (json['created'] as List<dynamic>? ?? const [])
              .map((e) => Medication.fromJson(e as Map<String, dynamic>))
              .toList(),
      items:
          (json['items'] as List<dynamic>? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(ScannedMedicine.fromJson)
              .toList(),
      prescriber: json['prescriber'] as Map<String, dynamic>?,
      note: json['note'] as String?,
    );
  }
}

/// One medicine the scan proposes, with the times it worked out.
class ScannedMedicine {
  const ScannedMedicine({
    required this.name,
    this.strength,
    this.dose,
    this.whenText,
    this.instructions,
    this.durationDays,
    this.schedule = const [],
  });

  final String name;
  final String? strength;
  final String? dose;
  /// The doctor's own words about when — "1 tab each AF Lunch". Shown beside
  /// the time so the patient checks a sentence against their paper rather than
  /// an hour they have no way to verify.
  final String? whenText;

  final String? instructions;
  final int? durationDays;

  /// 'HH:mm' times with their relation to a meal.
  final List<({String time, String relationToMeal})> schedule;

  factory ScannedMedicine.fromJson(Map<String, dynamic> j) => ScannedMedicine(
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString(),
    dose: j['dose']?.toString(),
    whenText: j['whenText']?.toString(),
    instructions: j['instructions']?.toString(),
    durationDays: (j['durationDays'] as num?)?.toInt(),
    schedule: [
      for (final s in (j['schedule'] as List?) ?? const [])
        if (s is Map<String, dynamic> && s['time'] != null)
          (
            time: s['time'].toString(),
            relationToMeal: s['relationToMeal']?.toString() ?? 'any',
          ),
    ],
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    if (strength != null) 'strength': strength,
    if (dose != null) 'dose': dose,
    if (instructions != null) 'instructions': instructions,
    if (durationDays != null) 'durationDays': durationDays,
    'schedule': [
      for (final s in schedule)
        {'time': s.time, 'relationToMeal': s.relationToMeal},
    ],
  };
}

/// The patient/dietician-facing plain-language dosing phrase, derived from the
/// medicine's shape (dose count, meal relation, route, and the PRN/Stat/EOD/HS
/// flags) via the shared shorthand dictionary — e.g. "Twice a day, after food".
extension MedicationDoseSummary on Medication {
  String get doseSummary => doseSummaryFrom(
    doseCount: schedule.length,
    relationToMeal: schedule.isNotEmpty ? schedule.first.relationToMeal : null,
    route: route,
    asNeeded: asNeeded,
    stat: stat,
    everyOtherDay: dayInterval > 1,
    atBedtime: schedule.any((s) => s.slot == 'bedtime'),
  );
}

class MedicationScheduleEntry {
  const MedicationScheduleEntry({
    required this.time,
    required this.relationToMeal,
    this.slot,
  });

  /// "HH:mm".
  final String time;

  /// before_meal | after_meal | with_meal | anytime.
  final String relationToMeal;

  /// morning | noon | afternoon | night | bedtime — so a bedtime (HS) dose can
  /// read "at bedtime" rather than a bare time.
  final String? slot;

  factory MedicationScheduleEntry.fromJson(Map<String, dynamic> json) {
    return MedicationScheduleEntry(
      time: json['time']?.toString() ?? '',
      relationToMeal: json['relationToMeal']?.toString() ?? 'anytime',
      slot: json['slot']?.toString(),
    );
  }
}

/// One row of `GET /medications/schedule/today`.
class MedicationScheduleSlot {
  const MedicationScheduleSlot({
    required this.medicationId,
    required this.name,
    required this.dose,
    required this.time,
    required this.relationToMeal,
    required this.status,
    this.logId,
  });

  final String medicationId;
  final String name;
  final String dose;
  final String time;
  final String relationToMeal;

  /// pending | taken | skipped | missed.
  final String status;
  final String? logId;

  factory MedicationScheduleSlot.fromJson(Map<String, dynamic> json) {
    return MedicationScheduleSlot(
      medicationId: json['medicationId']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      dose: json['dose']?.toString() ?? '',
      time: json['time']?.toString() ?? '',
      relationToMeal: json['relationToMeal']?.toString() ?? 'anytime',
      status: json['status']?.toString() ?? 'pending',
      logId: json['logId']?.toString(),
    );
  }

  MedicationScheduleSlot copyWith({String? status, String? logId}) {
    return MedicationScheduleSlot(
      medicationId: medicationId,
      name: name,
      dose: dose,
      time: time,
      relationToMeal: relationToMeal,
      status: status ?? this.status,
      logId: logId ?? this.logId,
    );
  }
}

class TodaySchedule {
  const TodaySchedule({required this.date, required this.slots});

  final String date;
  final List<MedicationScheduleSlot> slots;

  factory TodaySchedule.fromJson(Map<String, dynamic> json) {
    return TodaySchedule(
      date: json['date']?.toString() ?? '',
      slots:
          (json['slots'] as List<dynamic>? ?? const [])
              .map(
                (e) =>
                    MedicationScheduleSlot.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
    );
  }
}

/// One past dose in the patient's history (`GET /medications/schedule/history`).
class DoseHistoryEntry {
  const DoseHistoryEntry({
    required this.medicationId,
    required this.name,
    required this.time,
    required this.status,
    this.strength,
    this.form,
    this.relationToMeal,
    this.scheduledFor,
    this.takenAt,
  });

  final String medicationId;
  final String name;
  final String? strength;
  final String? form;
  final String time; // HH:mm (clinic wall-clock)
  final String? relationToMeal;
  final DateTime? scheduledFor;
  final DateTime? takenAt;

  /// taken | skipped | missed.
  final String status;

  factory DoseHistoryEntry.fromJson(Map<String, dynamic> j) => DoseHistoryEntry(
    medicationId: j['medicationId']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString(),
    form: j['form']?.toString(),
    time: j['time']?.toString() ?? '',
    relationToMeal: j['relationToMeal']?.toString(),
    scheduledFor:
        DateTime.tryParse(j['scheduledFor']?.toString() ?? '')?.toLocal(),
    takenAt: DateTime.tryParse(j['takenAt']?.toString() ?? '')?.toLocal(),
    status: j['status']?.toString() ?? 'missed',
  );
}

/// `GET /medications/adherence?days=30`.
class MedicationAdherence {
  const MedicationAdherence({
    required this.expected,
    required this.taken,
    required this.missed,
    required this.percentage,
    required this.perMedication,
  });

  final int expected;
  final int taken;
  final int missed;
  final num percentage;
  final List<PerMedicationAdherence> perMedication;

  factory MedicationAdherence.fromJson(Map<String, dynamic> json) {
    return MedicationAdherence(
      expected: (json['expected'] as num?)?.toInt() ?? 0,
      taken: (json['taken'] as num?)?.toInt() ?? 0,
      missed: (json['missed'] as num?)?.toInt() ?? 0,
      percentage: json['percentage'] as num? ?? 0,
      perMedication:
          (json['perMedication'] as List<dynamic>? ?? const [])
              .map(
                (e) =>
                    PerMedicationAdherence.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
    );
  }
}

class PerMedicationAdherence {
  const PerMedicationAdherence({
    required this.medicationId,
    required this.name,
    required this.expected,
    required this.taken,
    required this.percentage,
  });

  final String medicationId;
  final String name;
  final int expected;
  final int taken;
  final num percentage;

  factory PerMedicationAdherence.fromJson(Map<String, dynamic> json) {
    return PerMedicationAdherence(
      medicationId: json['medicationId']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      expected: (json['expected'] as num?)?.toInt() ?? 0,
      taken: (json['taken'] as num?)?.toInt() ?? 0,
      percentage: json['percentage'] as num? ?? 0,
    );
  }
}
