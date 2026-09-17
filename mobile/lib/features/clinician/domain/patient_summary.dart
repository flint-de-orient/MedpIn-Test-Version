import 'clinician_models.dart';
import 'nutrition_care.dart';

/// A quarterly HbA1c point on the patient's record.
class Hba1cPoint {
  const Hba1cPoint({required this.percentage, this.testedOn});
  final num percentage;
  final DateTime? testedOn;

  factory Hba1cPoint.fromJson(Map<String, dynamic> j) => Hba1cPoint(
    percentage: (j['percentage'] as num?) ?? 0,
    testedOn: DateTime.tryParse(j['testedOn']?.toString() ?? '')?.toLocal(),
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
    this.hasValue = true,
    required this.flag,
    this.unit,
    this.refLow,
    this.refHigh,
  });

  final String code;
  final String label;
  final num value;

  /// False when the report named the analyte without a value. [value] is
  /// then 0 only to keep its type, and must not be shown or charted.
  final bool hasValue;
  final String? unit;
  final num? refLow;
  final num? refHigh;
  final String flag; // low | normal | high | critical

  bool get abnormal => flag == 'low' || flag == 'high' || flag == 'critical';

  /// A compact reference window, e.g. "70–130", "<100", ">40".
  String get rangeText {
    String n(num v) =>
        v == v.roundToDouble() ? v.toInt().toString() : v.toString();
    if (refLow != null && refHigh != null)
      return '${n(refLow!)}–${n(refHigh!)}';
    if (refHigh != null) return '<${n(refHigh!)}';
    if (refLow != null) return '>${n(refLow!)}';
    return '';
  }

  factory Analyte.fromJson(Map<String, dynamic> j) => Analyte(
    code: j['code']?.toString() ?? '',
    label: j['label']?.toString() ?? '',
    value: (j['value'] as num?) ?? 0,
    hasValue: j['value'] is num,
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
  });
  final String id;
  final String testName;
  final String note;
  final String? photoUrl;
  final DateTime? createdAt;
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
    analytes:
        (j['analytes'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(Analyte.fromJson)
            .toList() ??
        const [],
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
    final ec = j['emergencyContact'] as Map<String, dynamic>?;
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
    this.riskComputedAt,
    this.healthScore,
    this.healthBand,
    this.adherencePercent,
    this.glucoseAverage,
    this.timeInRangePercent,
    this.estimatedHba1c,
    this.hba1cHistory = const [],
    this.glucoseDaily = const [],
    this.labResults = const [],
    this.details = const PatientDetails(),
    this.advisedTests = const [],
    this.alerts = const [],
    this.aiContext,
    this.assignedDieticianId,
    this.assignedDieticianName,
    this.nutritionCare,
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
    this.systolic,
    this.diastolic,
    this.pulse,
    this.spo2,
    this.waistCm,
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

  /// When the risk was last worked out. Null means never: the stored band is
  /// then only the profile's default, not a judgement.
  final DateTime? riskComputedAt;

  final int? healthScore;
  final String? healthBand;
  final int? adherencePercent;

  final int? glucoseAverage;
  final int? timeInRangePercent;
  final double? estimatedHba1c;

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

  /// The dietician a server from before per-practice assignment named. Read
  /// only when [nutritionCare] is absent.
  final String? assignedDieticianId;
  final String? assignedDieticianName;

  /// Who looks after this patient's nutrition at this practice, with its
  /// history. Null from a server that predates it.
  final NutritionCare? nutritionCare;
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
  final int? systolic;
  final int? diastolic;
  final int? pulse;
  final int? spo2;
  final double? waistCm;

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
    final patient = j['patient'] as Map<String, dynamic>? ?? const {};
    final profile = j['profile'] as Map<String, dynamic>? ?? const {};
    final health = j['healthScore'] as Map<String, dynamic>? ?? const {};
    final adherence = j['adherence'] as Map<String, dynamic>? ?? const {};
    final vitals = j['latestVitals'] as Map<String, dynamic>? ?? const {};
    final trends = j['trends'] as Map<String, dynamic>? ?? const {};
    final stats = trends['stats'] as Map<String, dynamic>?;

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
      riskComputedAt: DateTime.tryParse(profile['lastRiskComputedAt']?.toString() ?? ''),
      assignedDieticianId:
          profile['assignedDietician'] is Map
              ? (profile['assignedDietician'] as Map)['_id']?.toString()
              : profile['assignedDietician']?.toString(),
      assignedDieticianName:
          profile['assignedDietician'] is Map
              ? (profile['assignedDietician'] as Map)['name']?.toString()
              : null,
      nutritionCare:
          j['nutritionCare'] is Map<String, dynamic>
              ? NutritionCare.fromJson(j['nutritionCare'] as Map<String, dynamic>)
              : null,
      reviewIntervalDays: (profile['dietReviewIntervalDays'] as num?)?.toInt(),
      labResults:
          (j['labResults'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(LabReport.fromJson)
              .toList() ??
          const [],
      details: PatientDetails.fromJson(
        j['details'] as Map<String, dynamic>? ?? const {},
      ),
      advisedTests:
          (j['labTestsAdvised'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      healthScore: (health['score'] as num?)?.toInt(),
      healthBand: health['band']?.toString(),
      adherencePercent: (adherence['percentage'] as num?)?.toInt(),
      glucoseAverage: (stats?['average'] as num?)?.toInt(),
      timeInRangePercent: (stats?['timeInRangePercent'] as num?)?.toInt(),
      estimatedHba1c: (stats?['estimatedHba1c'] as num?)?.toDouble(),
      hba1cHistory:
          (j['hba1cHistory'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(Hba1cPoint.fromJson)
              .toList() ??
          const [],
      glucoseDaily:
          (trends['daily'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(GlucoseDailyPoint.fromJson)
              .toList() ??
          const [],
      alerts:
          (j['alerts'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ClinicalAlert.fromJson)
              .toList() ??
          const [],
      aiContext: j['aiContext']?.toString(),
      adherenceTaken: (adherence['taken'] as num?)?.toInt(),
      adherenceExpected: (adherence['expected'] as num?)?.toInt(),
      adherenceMissed: (adherence['missed'] as num?)?.toInt(),
      adherencePerMed:
          (adherence['perMedication'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(MedAdherence.fromJson)
              .toList() ??
          const [],
      medicationCount: (j['medicationCount'] as num?)?.toInt(),
      lastFasting:
          j['lastFasting'] is Map
              ? ((j['lastFasting'] as Map)['value'] as num?)?.toInt()
              : null,
      lastFastingAt:
          j['lastFasting'] is Map
              ? DateTime.tryParse(
                (j['lastFasting'] as Map)['at']?.toString() ?? '',
              )?.toLocal()
              : null,
      heightCm: (profile['heightCm'] as num?)?.toDouble(),
      weightKg:
          (vitals['weightKg'] as num?)?.toDouble() ??
          (profile['baselineWeightKg'] as num?)?.toDouble(),
      systolic: (vitals['systolic'] as num?)?.toInt(),
      diastolic: (vitals['diastolic'] as num?)?.toInt(),
      pulse: (vitals['pulse'] as num?)?.toInt(),
      spo2: (vitals['spo2'] as num?)?.toInt(),
      waistCm: (vitals['waistCm'] as num?)?.toDouble(),
    );
  }
}
