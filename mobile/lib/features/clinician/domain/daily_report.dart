/// One doctor's day, as `GET /doctor/reports/daily?format=json` describes it.
///
/// The same object the server draws the PDF from, so what the doctor previews
/// here is what they share. It carries no record ids, phone numbers or
/// reference numbers — the server leaves them out, and nothing here asks for
/// them.
library;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

String? _text(Object? v) {
  final s = v?.toString().trim();
  return (s == null || s.isEmpty) ? null : s;
}

List<String> _strings(Object? v) =>
    v is List ? v.map((e) => e.toString()).where((e) => e.trim().isNotEmpty).toList() : const [];

List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];

class DailyReport {
  const DailyReport({
    required this.date,
    required this.practiceName,
    required this.doctorName,
    required this.patients,
  });

  /// `YYYY-MM-DD`, in the clinic's timezone — the day the server summarised.
  final String date;
  final String? practiceName;
  final String? doctorName;
  final List<DailyReportPatient> patients;

  int get prescriptionCount => patients.fold(0, (n, p) => n + p.prescriptions.length);

  factory DailyReport.fromJson(Map<String, dynamic> json) {
    final report = (json['report'] as Map?)?.cast<String, dynamic>() ?? json;
    return DailyReport(
      date: report['date']?.toString() ?? '',
      practiceName: _text((report['practice'] as Map?)?['name']),
      doctorName: _text((report['doctor'] as Map?)?['name']),
      patients: _maps(report['patients']).map(DailyReportPatient.fromJson).toList(),
    );
  }
}

class DailyReportPatient {
  const DailyReportPatient({
    required this.name,
    this.age,
    this.sex,
    this.seenAt,
    this.complaint,
    this.complaintBooked = false,
    this.diagnosis = const [],
    this.vitals = const [],
    this.glucose = const [],
    this.prescriptions = const [],
    this.voidedPrescriptions = 0,
    this.advice,
    this.followUpOn,
  });

  final String name;
  final int? age;
  final String? sex;
  final DateTime? seenAt;
  final String? complaint;

  /// The complaint is the reason the patient gave when booking, not one the
  /// doctor recorded — said differently on screen, because it is their words.
  final bool complaintBooked;
  final List<String> diagnosis;
  final List<DailyVitals> vitals;
  final List<DailyGlucose> glucose;
  final List<DailyPrescription> prescriptions;

  /// Issued in error and voided: counted, never shown.
  final int voidedPrescriptions;
  final String? advice;
  final DateTime? followUpOn;

  /// "54 yrs · Male", or whatever of it is known.
  String get demographics =>
      [if (age != null) '$age yrs', if (sex != null) sex!].join(' · ');

  factory DailyReportPatient.fromJson(Map<String, dynamic> json) {
    final complaint = (json['complaint'] as Map?)?.cast<String, dynamic>();
    return DailyReportPatient(
      name: _text(json['name']) ?? 'Unnamed patient',
      age: (json['age'] as num?)?.toInt(),
      sex: _text(json['sex']),
      seenAt: _date(json['seenAt']),
      complaint: _text(complaint?['text']),
      complaintBooked: complaint?['source'] == 'appointment',
      diagnosis: _strings(json['diagnosis']),
      vitals: _maps(json['vitals']).map(DailyVitals.fromJson).toList(),
      glucose: _maps(json['glucose']).map(DailyGlucose.fromJson).toList(),
      prescriptions: _maps(json['prescriptions']).map(DailyPrescription.fromJson).toList(),
      voidedPrescriptions: (json['voidedPrescriptions'] as num?)?.toInt() ?? 0,
      advice: _text(json['advice']),
      followUpOn: _date(json['followUpOn']),
    );
  }
}

class DailyVitals {
  const DailyVitals({this.at, this.bloodPressure, this.pulse, this.spo2, this.weightKg, this.waistCm, this.temperatureC});

  final DateTime? at;
  final String? bloodPressure;
  final num? pulse;
  final num? spo2;
  final num? weightKg;
  final num? waistCm;
  final num? temperatureC;

  /// "BP 150/94 mmHg · Pulse 88/min", with nothing invented for what was not taken.
  String get summary => [
    if (bloodPressure != null) 'BP $bloodPressure mmHg',
    if (pulse != null) 'Pulse $pulse/min',
    if (spo2 != null) 'SpO₂ $spo2%',
    if (weightKg != null) 'Weight $weightKg kg',
    if (waistCm != null) 'Waist $waistCm cm',
    if (temperatureC != null) 'Temp $temperatureC °C',
  ].join(' · ');

  factory DailyVitals.fromJson(Map<String, dynamic> json) => DailyVitals(
    at: _date(json['at']),
    bloodPressure: _text(json['bloodPressure']),
    pulse: json['pulse'] as num?,
    spo2: json['spo2'] as num?,
    weightKg: json['weightKg'] as num?,
    waistCm: json['waistCm'] as num?,
    temperatureC: json['temperatureC'] as num?,
  );
}

class DailyGlucose {
  const DailyGlucose({this.at, required this.valueMgDl, this.context});

  final DateTime? at;
  final num valueMgDl;
  final String? context;

  factory DailyGlucose.fromJson(Map<String, dynamic> json) => DailyGlucose(
    at: _date(json['at']),
    valueMgDl: (json['valueMgDl'] as num?) ?? 0,
    context: _text(json['context']),
  );
}

class DailyPrescription {
  const DailyPrescription({
    this.standing = true,
    this.scanned = false,
    this.items = const [],
    this.investigations = const [],
  });

  /// False when a later prescription has since replaced it.
  final bool standing;

  /// Filed from a paper prescription rather than typed.
  final bool scanned;
  final List<DailyItem> items;
  final List<String> investigations;

  factory DailyPrescription.fromJson(Map<String, dynamic> json) => DailyPrescription(
    standing: json['standing'] != false,
    scanned: json['source'] == 'scanned',
    items: _maps(json['items']).map(DailyItem.fromJson).toList(),
    investigations: _strings(json['investigations']),
  );
}

class DailyItem {
  const DailyItem({required this.name, this.strength, this.dose, this.frequency, this.durationDays, this.relationToMeal, this.instructions});

  final String name;
  final String? strength;
  final String? dose;
  final String? frequency;
  final int? durationDays;
  final String? relationToMeal;
  final String? instructions;

  /// "Metformin 500 mg — BD, after food · 30 days".
  String get line {
    final head = [name, strength, dose].whereType<String>().join(' ');
    final meal = switch (relationToMeal) {
      'before_meal' => 'before food',
      'after_meal' => 'after food',
      'with_meal' => 'with food',
      _ => null,
    };
    final when = [frequency, meal].whereType<String>().join(', ');
    final tail = [
      if (when.isNotEmpty) when,
      if (durationDays != null) '$durationDays days',
      if (instructions != null) instructions!,
    ].join(' · ');
    return tail.isEmpty ? head : '$head — $tail';
  }

  factory DailyItem.fromJson(Map<String, dynamic> json) => DailyItem(
    name: _text(json['name']) ?? 'Unnamed medicine',
    strength: _text(json['strength']),
    dose: _text(json['dose']),
    frequency: _text(json['frequency']),
    durationDays: (json['durationDays'] as num?)?.toInt(),
    relationToMeal: _text(json['relationToMeal']),
    instructions: _text(json['instructions']),
  );
}
