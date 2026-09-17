import 'clinician_models.dart';

/// A nested object, whichever map type the decoder handed over.
///
/// `as Map<String, dynamic>?` throws on a `Map<dynamic, dynamic>`, and a throw
/// inside the summary's parser turns the whole record into "Could not load" —
/// one oddly typed block taking every other section down with it.
Map<String, dynamic> _map(Object? v) =>
    v is Map ? Map<String, dynamic>.from(v) : const <String, dynamic>{};

List<Map<String, dynamic>> _maps(Object? v) => [
  if (v is List)
    for (final e in v)
      if (e is Map) Map<String, dynamic>.from(e),
];

DateTime? _date(Object? v) =>
    v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

/// A quarterly HbA1c point on the patient's record.
class Hba1cPoint {
  const Hba1cPoint({required this.percentage, this.testedOn});
  final num percentage;
  final DateTime? testedOn;

  factory Hba1cPoint.fromJson(Map<String, dynamic> j) => Hba1cPoint(
    percentage: (j['percentage'] as num?) ?? 0,
    testedOn: DateTime.tryParse(j['testedOn']?.toString() ?? '')?.toLocal(),
  );

  /// Null for a row with no figure on it.
  ///
  /// [Hba1cPoint.fromJson] reads a missing percentage as 0, and a record
  /// listing "HbA1c 0%" states a result nobody measured — worse than leaving
  /// the row out, because 0 is a number a reader acts on.
  static Hba1cPoint? tryParse(Map<String, dynamic> j) =>
      j['percentage'] is num ? Hba1cPoint.fromJson(j) : null;
}

/// One foot assessment: when, and the risk the assessor settled on.
class FootAssessmentPoint {
  const FootAssessmentPoint({this.assessedAt, this.riskLevel});

  final DateTime? assessedAt;

  /// low | moderate | high | urgent, as the assessment recorded it.
  final String? riskLevel;

  factory FootAssessmentPoint.fromJson(Map<String, dynamic> j) =>
      FootAssessmentPoint(
        assessedAt: _date(j['assessedAt']),
        riskLevel: j['finalRiskLevel']?.toString(),
      );
}

/// One medicine's dose adherence over the window — taken vs due doses.
class MedAdherence {
  const MedAdherence({
    required this.name,
    required this.taken,
    required this.expected,
    this.percentage,
  });
  final String name;
  final int taken;
  final int expected;
  final int? percentage;

  factory MedAdherence.fromJson(Map<String, dynamic> j) => MedAdherence(
    name: j['name']?.toString() ?? 'Medicine',
    taken: (j['taken'] as num?)?.toInt() ?? 0,
    expected: (j['expected'] as num?)?.toInt() ?? 0,
    percentage: (j['percentage'] as num?)?.toInt(),
  );
}

/// Medication adherence for a chosen window — the tap-through sheet fetches this
/// per period (week / month / year) via `/doctor/patients/:id/adherence`.
class AdherenceReport {
  const AdherenceReport({
    required this.taken,
    required this.expected,
    this.percentage,
    this.perMed = const [],
  });
  final int taken;
  final int expected;
  final int? percentage;
  final List<MedAdherence> perMed;

  factory AdherenceReport.fromJson(Map<String, dynamic> j) => AdherenceReport(
    taken: (j['taken'] as num?)?.toInt() ?? 0,
    expected: (j['expected'] as num?)?.toInt() ?? 0,
    percentage: (j['percentage'] as num?)?.toInt(),
    perMed:
        (j['perMedication'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(MedAdherence.fromJson)
            .toList() ??
        const [],
  );
}

/// One day's glucose summary — the point the continuous-monitoring graph plots.
class GlucoseDailyPoint {
  const GlucoseDailyPoint({
    required this.date,
    required this.average,
    required this.min,
    required this.max,
  });
  final DateTime date;
  final int average;
  final int min;
  final int max;

  factory GlucoseDailyPoint.fromJson(Map<String, dynamic> j) =>
      GlucoseDailyPoint(
        date:
            DateTime.tryParse(j['date']?.toString() ?? '')?.toLocal() ??
            DateTime.now(),
        average: (j['average'] as num?)?.toInt() ?? 0,
        min: (j['min'] as num?)?.toInt() ?? 0,
        max: (j['max'] as num?)?.toInt() ?? 0,
      );
}

/// One structured reading transcribed from a report — value, unit, reference
/// window and a low/normal/high flag.
class Analyte {
  const Analyte({
    required this.code,
    required this.label,
    required this.value,
    required this.flag,
    this.unit,
    this.refLow,
    this.refHigh,
  });

  final String code;
  final String label;
  final num value;
  final String? unit;
  final num? refLow;
  final num? refHigh;
  final String flag; // low | normal | high | critical

  bool get abnormal => flag == 'low' || flag == 'high' || flag == 'critical';

  /// A compact reference window, e.g. "70–130", "<100", ">40".
  String get rangeText {
    String n(num v) =>
        v == v.roundToDouble() ? v.toInt().toString() : v.toString();
    if (refLow != null && refHigh != null) {
      return '${n(refLow!)}–${n(refHigh!)}';
    }
    if (refHigh != null) return '<${n(refHigh!)}';
    if (refLow != null) return '>${n(refLow!)}';
    return '';
  }

  factory Analyte.fromJson(Map<String, dynamic> j) => Analyte(
    code: j['code']?.toString() ?? '',
    label: j['label']?.toString() ?? '',
    value: (j['value'] as num?) ?? 0,
    unit: j['unit']?.toString(),
    refLow: j['refLow'] as num?,
    refHigh: j['refHigh'] as num?,
    flag: j['flag']?.toString() ?? 'normal',
  );
}

/// A test report the patient uploaded against a doctor-advised test.
class LabReport {
  const LabReport({
    required this.id,
    required this.testName,
    required this.note,
    this.photoUrl,
    this.createdAt,
    this.mimeType,
    this.originalName,
    this.analysisStatus,
    this.analysisSummary,
    this.analytes = const [],
    this.testedOn,
  });
  final String id;
  final String testName;
  final String note;
  final String? photoUrl;
  final DateTime? createdAt;

  /// The date printed on the report, when the reader found one. Different
  /// from [createdAt], which is when it was uploaded — a report from March
  /// uploaded in September is a March result.
  final DateTime? testedOn;
  final String? mimeType;
  final String? originalName;

  /// pending | done | failed | unsupported — so "couldn't read it" reads
  /// differently from "nothing on it".
  final String? analysisStatus;
  final String? analysisSummary;

  /// The structured values transcribed off the report, with ranges + flags.
  final List<Analyte> analytes;

  /// Labs email PDFs, so most reports are not pictures. Unknown types count as
  /// documents — a file card that opens beats an image box that cannot load.
  bool get isImage => mimeType?.startsWith('image/') ?? false;
  bool get hasFile => photoUrl != null && photoUrl!.isNotEmpty;

  factory LabReport.fromJson(Map<String, dynamic> j) => LabReport(
    id: j['id']?.toString() ?? '',
    testName: j['testName']?.toString() ?? '',
    note: j['note']?.toString() ?? '',
    photoUrl:
        (j['photoUrl'] == null || j['photoUrl'].toString().isEmpty)
            ? null
            : j['photoUrl'].toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    mimeType: j['mimeType']?.toString(),
    originalName: j['originalName']?.toString(),
    analysisStatus: j['analysisStatus']?.toString(),
    analysisSummary: j['analysisSummary']?.toString(),
    // Only values that carry a figure. `Analyte.fromJson` reads a missing
    // value as 0, and "LDL 0 mg/dL" on a record is a result nobody measured.
    analytes: [
      for (final a in _maps(j['analytes']))
        if (a['value'] is num) Analyte.fromJson(a),
    ],
    testedOn: _date(j['testedOn']),
  );
}

/// The full clinical picture for one patient (`GET /doctor/patients/:id/summary`).
/// Only the fields the clinician UI renders are pulled out; the raw analytics
/// blobs are large and screen-specific.
/// Everything the clinic recorded about a patient beyond their name and phone.
///
/// Split out rather than flattened onto [PatientSummary] because these are the
/// facts a doctor reads once at the start of a consultation — allergies,
/// comorbidities, who to ring — and keeping them together lets the screen show
/// them as one block instead of scattering them through the header.
class PatientDetails {
  const PatientDetails({
    this.diagnosedOn,
    this.heightCm,
    this.comorbidities = const [],
    this.allergies = const [],
    this.footRiskCategory,
    this.emergencyName,
    this.emergencyPhone,
    this.emergencyRelation,
    this.notes,
  });

  final DateTime? diagnosedOn;
  final num? heightCm;
  final List<String> comorbidities;
  final List<String> allergies;
  final String? footRiskCategory;
  final String? emergencyName;
  final String? emergencyPhone;
  final String? emergencyRelation;
  final String? notes;

  bool get isEmpty =>
      diagnosedOn == null &&
      heightCm == null &&
      comorbidities.isEmpty &&
      allergies.isEmpty &&
      (footRiskCategory == null || footRiskCategory == 'low') &&
      emergencyPhone == null &&
      (notes ?? '').isEmpty;

  factory PatientDetails.fromJson(Map<String, dynamic> j) {
    final ec =
        j['emergencyContact'] is Map ? _map(j['emergencyContact']) : null;
    return PatientDetails(
      diagnosedOn:
          DateTime.tryParse(j['diagnosedOn']?.toString() ?? '')?.toLocal(),
      heightCm: j['heightCm'] as num?,
      comorbidities:
          (j['comorbidities'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      allergies:
          (j['allergies'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      footRiskCategory: j['footRiskCategory']?.toString(),
      emergencyName: ec?['name']?.toString(),
      emergencyPhone: ec?['phone']?.toString(),
      emergencyRelation: ec?['relation']?.toString(),
      notes: j['notes']?.toString(),
    );
  }
}

class PatientSummary {
  const PatientSummary({
    required this.id,
    required this.name,
    required this.phone,
    this.email,
    this.gender,
    this.age,
    this.address,
    this.chiefComplaint,
    this.language,
    this.avatarUrl,
    this.diabetesType,
    this.riskBand,
    this.riskScore,
    this.riskReasons = const [],
    this.riskComputedAt,
    this.healthScore,
    this.healthBand,
    this.adherencePercent,
    this.glucoseAverage,
    this.timeInRangePercent,
    this.estimatedHba1c,
    this.glucoseReadingCount,
    this.glucoseWindowDays,
    this.hba1cHistory = const [],
    this.glucoseDaily = const [],
    this.labResults = const [],
    this.details = const PatientDetails(),
    this.advisedTests = const [],
    this.alerts = const [],
    this.aiContext,
    this.assignedDieticianId,
    this.assignedDieticianName,
    this.reviewIntervalDays,
    this.adherenceTaken,
    this.adherenceExpected,
    this.adherenceMissed,
    this.adherencePerMed = const [],
    this.medicationCount,
    this.lastFasting,
    this.lastFastingAt,
    this.heightCm,
    this.weightKg,
    this.weightMeasuredAt,
    this.systolic,
    this.diastolic,
    this.pulse,
    this.spo2,
    this.waistCm,
    this.vitalsAt,
    this.lastFootScreeningAt,
    this.lastEyeScreeningAt,
    this.footAssessments = const [],
  });

  final String id;
  final String name;
  final String phone;
  final String? email;
  final String? gender;
  final int? age;

  /// Postal address, captured at desk registration.
  final String? address;

  /// The patient's current presenting complaint, shown on the profile and
  /// carried into a consult.
  final String? chiefComplaint;
  final String? language;

  /// Relative `/api/v1/uploads/:id/raw` path of the photo the patient set.
  final String? avatarUrl;

  final String? diabetesType;
  final String? riskBand;
  final int? riskScore;

  /// Why the patient is in [riskBand], in the server's words — "HbA1c 9.4%",
  /// "1 unresolved emergency alert(s)". Empty until the server sends them, and
  /// the record then says nothing rather than guessing at reasons of its own.
  final List<String> riskReasons;

  /// When the band was last worked out from readings, alerts and reports.
  ///
  /// Null means never: the profile's band is then the schema's default "low",
  /// which is not a finding about this patient and must not be shown as one.
  final DateTime? riskComputedAt;

  final int? healthScore;
  final String? healthBand;
  final int? adherencePercent;

  final int? glucoseAverage;
  final int? timeInRangePercent;
  final double? estimatedHba1c;

  /// How many glucose readings [glucoseAverage] and [timeInRangePercent] were
  /// made from, over [glucoseWindowDays] days. A percentage of three readings
  /// and one of ninety are different claims.
  final int? glucoseReadingCount;
  final int? glucoseWindowDays;

  final List<Hba1cPoint> hba1cHistory;

  /// Per-day glucose averages (with min/max) — the continuous-monitoring series.
  final List<GlucoseDailyPoint> glucoseDaily;

  final List<LabReport> labResults;

  /// The rest of the record — allergies, comorbidities, emergency contact.
  final PatientDetails details;

  /// Tests already ordered on an active prescription — so the doctor can see
  /// what is outstanding before ordering it again.
  final List<String> advisedTests;
  final List<ClinicalAlert> alerts;
  final String? aiContext;

  final String? assignedDieticianId;
  final String? assignedDieticianName;
  final int? reviewIntervalDays;

  /// Adherence as raw doses (taken / expected due) over the last 30 days — the
  /// honest form behind the percentage.
  final int? adherenceTaken;
  final int? adherenceExpected;
  final int? adherenceMissed;

  /// Per-medicine dose adherence, for the tap-through breakdown.
  final List<MedAdherence> adherencePerMed;

  /// How many medicines the patient is currently on.
  final int? medicationCount;

  /// The patient's most recent fasting glucose reading (mg/dL) and when.
  final int? lastFasting;
  final DateTime? lastFastingAt;

  /// Physical measurements — height from the profile, the rest from the latest
  /// VitalRecord. Shown in the profile's measurements section.
  final double? heightCm;
  final double? weightKg;

  /// When [weightKg] was measured — null when it is the weight given at
  /// registration rather than one taken at a visit.
  final DateTime? weightMeasuredAt;
  final int? systolic;
  final int? diastolic;
  final int? pulse;
  final int? spo2;
  final double? waistCm;

  /// When the latest vitals above were recorded. A blood pressure without its
  /// date cannot be told from one taken this morning.
  final DateTime? vitalsAt;

  /// The last foot and eye checks, from the diabetic foot and eye modules.
  final DateTime? lastFootScreeningAt;
  final DateTime? lastEyeScreeningAt;

  /// Foot assessments, newest first.
  final List<FootAssessmentPoint> footAssessments;

  /// Body-mass index from height + weight, or null if either is missing.
  double? get bmi {
    final h = heightCm;
    final w = weightKg;
    if (h == null || w == null || h <= 0) return null;
    final m = h / 100;
    return w / (m * m);
  }

  /// The latest lab HbA1c on record (the measured value, not the estimate).
  num? get lastHba1c =>
      hba1cHistory.isNotEmpty ? hba1cHistory.first.percentage : null;

  factory PatientSummary.fromJson(Map<String, dynamic> j) {
    final patient = _map(j['patient']);
    final profile = _map(j['profile']);
    final health = _map(j['healthScore']);
    final adherence = _map(j['adherence']);
    final vitals = _map(j['latestVitals']);
    final trends = _map(j['trends']);
    final stats = trends['stats'] is Map ? _map(trends['stats']) : null;
    final vitalsAt = _date(vitals['at']);
    final fasting = j['lastFasting'] is Map ? _map(j['lastFasting']) : null;
    final dietician = profile['assignedDietician'];

    return PatientSummary(
      id: patient['id']?.toString() ?? '',
      name: patient['name']?.toString() ?? '',
      phone: patient['phone']?.toString() ?? '',
      email: patient['email']?.toString(),
      gender: patient['gender']?.toString(),
      age: (patient['age'] as num?)?.toInt(),
      address: patient['address']?.toString(),
      chiefComplaint: patient['chiefComplaint']?.toString(),
      language: patient['language']?.toString(),
      avatarUrl: patient['avatarUrl']?.toString(),
      diabetesType: profile['diabetesType']?.toString(),
      riskBand: profile['riskBand']?.toString(),
      riskScore: (profile['riskScore'] as num?)?.toInt(),
      riskReasons: _reasons(j['riskReasons'] ?? profile['riskReasons']),
      riskComputedAt: _date(profile['lastRiskComputedAt']),
      assignedDieticianId:
          dietician is Map
              ? dietician['_id']?.toString()
              : dietician?.toString(),
      assignedDieticianName:
          dietician is Map ? dietician['name']?.toString() : null,
      reviewIntervalDays: (profile['dietReviewIntervalDays'] as num?)?.toInt(),
      labResults: [
        for (final r in _maps(j['labResults'])) LabReport.fromJson(r),
      ],
      details: PatientDetails.fromJson(_map(j['details'])),
      advisedTests:
          (j['labTestsAdvised'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      healthScore: (health['score'] as num?)?.toInt(),
      healthBand: health['band']?.toString(),
      adherencePercent: (adherence['percentage'] as num?)?.toInt(),
      glucoseAverage: (stats?['average'] as num?)?.toInt(),
      timeInRangePercent: (stats?['timeInRangePercent'] as num?)?.toInt(),
      estimatedHba1c: (stats?['estimatedHba1c'] as num?)?.toDouble(),
      glucoseReadingCount: (trends['count'] as num?)?.toInt(),
      glucoseWindowDays: (trends['days'] as num?)?.toInt(),
      hba1cHistory: [
        for (final h in _maps(j['hba1cHistory']))
          if (Hba1cPoint.tryParse(h) case final point?) point,
      ],
      glucoseDaily: [
        for (final d in _maps(trends['daily'])) GlucoseDailyPoint.fromJson(d),
      ],
      alerts: [for (final a in _maps(j['alerts'])) ClinicalAlert.fromJson(a)],
      aiContext: j['aiContext']?.toString(),
      adherenceTaken: (adherence['taken'] as num?)?.toInt(),
      adherenceExpected: (adherence['expected'] as num?)?.toInt(),
      adherenceMissed: (adherence['missed'] as num?)?.toInt(),
      adherencePerMed: [
        for (final m in _maps(adherence['perMedication']))
          MedAdherence.fromJson(m),
      ],
      medicationCount: (j['medicationCount'] as num?)?.toInt(),
      lastFasting: (fasting?['value'] as num?)?.toInt(),
      lastFastingAt: _date(fasting?['at']),
      heightCm: (profile['heightCm'] as num?)?.toDouble(),
      weightKg:
          (vitals['weightKg'] as num?)?.toDouble() ??
          (profile['baselineWeightKg'] as num?)?.toDouble(),
      weightMeasuredAt: vitals['weightKg'] is num ? vitalsAt : null,
      systolic: (vitals['systolic'] as num?)?.toInt(),
      diastolic: (vitals['diastolic'] as num?)?.toInt(),
      pulse: (vitals['pulse'] as num?)?.toInt(),
      spo2: (vitals['spo2'] as num?)?.toInt(),
      waistCm: (vitals['waistCm'] as num?)?.toDouble(),
      vitalsAt: vitalsAt,
      lastFootScreeningAt: _date(profile['lastFootScreeningAt']),
      lastEyeScreeningAt: _date(profile['lastEyeScreeningAt']),
      footAssessments: [
        for (final f in _maps(j['footAssessments']))
          FootAssessmentPoint.fromJson(f),
      ],
    );
  }

  /// Reasons as plain sentences, whichever shape they arrive in: a string, or
  /// an object carrying one under a common key.
  static List<String> _reasons(Object? v) {
    if (v is! List) return const [];
    final out = <String>[];
    for (final e in v) {
      final text = switch (e) {
        final String s => s,
        final Map m =>
          (m['label'] ??
                  m['text'] ??
                  m['reason'] ??
                  m['message'] ??
                  m['summary'])
              ?.toString(),
        _ => null,
      };
      final trimmed = text?.trim() ?? '';
      if (trimmed.isNotEmpty) out.add(trimmed);
    }
    return out;
  }
}
