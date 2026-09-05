import '../../medications/domain/strength.dart';

/// The patient's own view of their care, from `GET /dashboard`.
///
/// Deliberately a read-only picture: what the clinic has decided about them,
/// what they have been asked to eat, what they are taking, and what they have
/// logged. Everything actionable lives on the tabs beside it.
class CareSummary {
  const CareSummary({
    required this.profile,
    this.latestHba1c,
    this.followUpOn,
    this.dietPlan,
    this.medications = const [],
    this.recentFoodLogs = const [],
    this.homeCards = const [],
    this.conditions = const [],
    this.household = const [],
  });

  final CareProfile profile;
  final Hba1cResult? latestHba1c;

  /// The doctor's next-visit instruction — the soonest upcoming prescription
  /// follow-up date. Null when none is set or it has passed.
  final DateTime? followUpOn;

  final PatientDietPlan? dietPlan;
  final List<CareMedication> medications;
  final List<CareFoodLog> recentFoodLogs;

  /// Which cards this patient's Home should show, from their conditions.
  ///
  /// Empty means the server recorded none — either the patient has no
  /// conditions yet or the deployment has not migrated — and empty is read as
  /// "show everything", not "show nothing". See [shows].
  final List<String> homeCards;

  /// What the patient is being treated for.
  final List<PatientConditionSummary> conditions;

  /// Everyone this phone looks after. One entry is the ordinary case and
  /// renders no switcher at all.
  final List<HouseholdMember> household;

  /// Whether a card belongs on this patient's Home.
  ///
  /// The permissive half matters more than the selective one. An empty card
  /// list is the pre-migration state and every patient is in it today, so
  /// reading it as "hide everything" would blank the Home screen of the clinic
  /// running right now. Cards start being chosen once conditions exist, and not
  /// a moment before.
  bool shows(String card) => homeCards.isEmpty || homeCards.contains(card);

  /// True only when this login is responsible for more than one person, which
  /// is the sole condition under which a switcher appears.
  bool get isHousehold => household.length > 1;

  factory CareSummary.fromJson(Map<String, dynamic> j) => CareSummary(
    profile: CareProfile.fromJson(
      j['profile'] as Map<String, dynamic>? ?? const {},
    ),
    latestHba1c:
        j['latestHba1c'] is Map
            ? Hba1cResult.fromJson(
              Map<String, dynamic>.from(j['latestHba1c'] as Map),
            )
            : null,
    followUpOn: DateTime.tryParse(j['followUpOn']?.toString() ?? '')?.toLocal(),
    dietPlan:
        j['dietPlan'] is Map
            ? PatientDietPlan.fromJson(
              Map<String, dynamic>.from(j['dietPlan'] as Map),
            )
            : null,
    medications:
        (j['medications'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(CareMedication.fromJson)
            .toList() ??
        const [],
    recentFoodLogs:
        (j['recentFoodLogs'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(CareFoodLog.fromJson)
            .toList() ??
        const [],
    homeCards:
        (j['homeCards'] as List?)?.map((c) => c.toString()).toList() ?? const [],
    conditions:
        (j['conditions'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(PatientConditionSummary.fromJson)
            .toList() ??
        const [],
    household:
        (j['people'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(HouseholdMember.fromJson)
            .toList() ??
        const [],
  );
}

/// One illness the patient is being treated for.
class PatientConditionSummary {
  const PatientConditionSummary({
    required this.key,
    required this.name,
    this.detail = const {},
  });

  final String key;
  final String name;

  /// Condition-specific facts — `{type: 'type2'}` for diabetes. Displayed and
  /// never searched, which is why it is loose on both sides of the wire.
  final Map<String, dynamic> detail;

  /// "Diabetes (Type 2)" when a type is recorded, "Diabetes" when it is not.
  String get label {
    final t = detail['type']?.toString();
    if (t == null || t.isEmpty) return name;
    return '$name (${_prettyType(t)})';
  }

  static String _prettyType(String raw) => switch (raw) {
    'type1' => 'Type 1',
    'type2' => 'Type 2',
    'gestational' => 'Gestational',
    'prediabetes' => 'Prediabetes',
    _ => raw,
  };

  factory PatientConditionSummary.fromJson(Map<String, dynamic> j) =>
      PatientConditionSummary(
        key: j['key']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        detail:
            j['detail'] is Map
                ? Map<String, dynamic>.from(j['detail'] as Map)
                : const {},
      );
}

/// A person this login looks after — themselves, or a child, parent or spouse
/// whose record lives under their phone number.
class HouseholdMember {
  const HouseholdMember({
    required this.id,
    required this.name,
    required this.relationship,
    required this.isSelf,
  });

  final String id;
  final String name;
  final String relationship;

  /// The account holder, sorted first by the server because the person opening
  /// the app is usually themselves.
  final bool isSelf;

  factory HouseholdMember.fromJson(Map<String, dynamic> j) => HouseholdMember(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    relationship: j['relationship']?.toString() ?? 'self',
    isSelf: j['isSelf'] as bool? ?? false,
  );
}

class CareProfile {
  const CareProfile({
    this.email,
    this.address,
    this.diabetesType,
    this.riskBand,
    this.heightCm,
    this.weightKg,
    this.bmi,
    this.bloodPressure,
    this.allergies = const [],
    this.reviewIntervalDays,
  });

  final String? diabetesType;

  /// What the clinic will use to reach this patient.
  final String? email;
  final String? address;

  /// The clinic's own assessment, shown beside the patient's name. Set by the
  /// doctor, not computed here.
  final String? riskBand;

  final int? heightCm;
  final num? weightKg;
  final num? bmi;

  /// The patient's latest recorded blood pressure, or null if none on file.
  final BloodPressure? bloodPressure;

  final List<String> allergies;
  final int? reviewIntervalDays;

  String? get conditionLabel => switch (diabetesType) {
    'type1' => 'Type 1 Diabetes',
    'type2' => 'Type 2 Diabetes',
    'gestational' => 'Gestational Diabetes',
    'prediabetes' => 'Prediabetes',
    'none' => 'Not diabetic',
    _ => null,
  };

  /// Only the bands worth flagging get a badge — "Low Risk" beside someone's
  /// name is a label doing no work.
  bool get showRisk =>
      riskBand == 'high' || riskBand == 'critical' || riskBand == 'moderate';

  String get riskLabel => switch (riskBand) {
    'critical' => 'Critical Risk',
    'high' => 'High Risk',
    'moderate' => 'Moderate Risk',
    _ => 'Low Risk',
  };

  /// "Every 2 weeks" reads better than "14 days" for the rhythms a clinic uses.
  String? get reviewLabel => switch (reviewIntervalDays) {
    null => null,
    1 => 'Daily',
    3 => 'Every 3 days',
    7 => 'Weekly',
    14 => 'Every 2 weeks',
    30 => 'Monthly',
    final d => 'Every $d days',
  };

  factory CareProfile.fromJson(Map<String, dynamic> j) => CareProfile(
    diabetesType: j['diabetesType']?.toString(),
    email: j['email']?.toString(),
    address: j['address']?.toString(),
    riskBand: j['riskBand']?.toString(),
    heightCm: (j['heightCm'] as num?)?.toInt(),
    weightKg: j['weightKg'] as num?,
    bmi: j['bmi'] as num?,
    bloodPressure:
        j['bloodPressure'] is Map
            ? BloodPressure.fromJson(
              Map<String, dynamic>.from(j['bloodPressure'] as Map),
            )
            : null,
    allergies:
        (j['allergies'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    reviewIntervalDays: (j['reviewIntervalDays'] as num?)?.toInt(),
  );
}

/// The patient's latest blood pressure, flagged high against their own targets.
class BloodPressure {
  const BloodPressure({
    required this.systolic,
    this.diastolic,
    this.isHigh = false,
  });

  final int systolic;
  final int? diastolic;
  final bool isHigh;

  /// "120/80" when both are known, else just the systolic.
  String get label => diastolic != null ? '$systolic/$diastolic' : '$systolic';

  factory BloodPressure.fromJson(Map<String, dynamic> j) => BloodPressure(
    systolic: (j['systolic'] as num?)?.toInt() ?? 0,
    diastolic: (j['diastolic'] as num?)?.toInt(),
    isHigh: j['isHigh'] == true,
  );
}

class Hba1cResult {
  const Hba1cResult({
    required this.percentage,
    this.testedOn,
    this.isHigh = false,
  });

  final num percentage;
  final DateTime? testedOn;

  /// Measured against this patient's own target, set by the doctor — not a
  /// textbook threshold.
  final bool isHigh;

  factory Hba1cResult.fromJson(Map<String, dynamic> j) => Hba1cResult(
    percentage: j['percentage'] as num? ?? 0,
    testedOn: DateTime.tryParse(j['testedOn']?.toString() ?? '')?.toLocal(),
    isHigh: j['isHigh'] == true,
  );
}

class PatientDietPlan {
  const PatientDietPlan({
    this.goal = '',
    this.meals = const [],
    this.avoid = const [],
    this.notes = '',
    this.dieticianName,
    this.sharedAt,
  });

  final String goal;
  final List<PlanMeal> meals;
  final List<String> avoid;
  final String notes;
  final String? dieticianName;
  final DateTime? sharedAt;

  factory PatientDietPlan.fromJson(Map<String, dynamic> j) => PatientDietPlan(
    goal: j['goal']?.toString() ?? '',
    meals:
        (j['meals'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(PlanMeal.fromJson)
            .toList() ??
        const [],
    avoid: (j['avoid'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    notes: j['notes']?.toString() ?? '',
    dieticianName: j['dieticianName']?.toString(),
    sharedAt: DateTime.tryParse(j['sharedAt']?.toString() ?? '')?.toLocal(),
  );
}

class PlanMeal {
  const PlanMeal({
    required this.name,
    this.time = '',
    this.items = const [],
    this.notes = '',
  });

  final String name;
  final String time;
  final List<String> items;
  final String notes;

  /// One line for the card face; the full list is on the detail sheet.
  String get summary => items.isNotEmpty ? items.join(', ') : notes;

  factory PlanMeal.fromJson(Map<String, dynamic> j) => PlanMeal(
    name: j['name']?.toString() ?? '',
    time: j['time']?.toString() ?? '',
    items: (j['items'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    notes: j['notes']?.toString() ?? '',
  );
}

class CareMedication {
  const CareMedication({
    required this.id,
    required this.name,
    this.strength = '',
    this.dose = '',
    this.instructions = '',
    this.times = const [],
  });

  final String id;
  final String name;
  final String strength;
  final String dose;
  final String instructions;
  final List<String> times;

  String get title {
    final s = formatStrength(strength);
    return s.isEmpty ? name : '$name $s';
  }

  /// "Twice daily with meals" from the schedule the doctor set, rather than a
  /// raw list of clock times.
  String get scheduleLabel {
    if (instructions.isNotEmpty) return instructions;
    final n = times.length;
    final how = switch (n) {
      0 => 'As needed',
      1 => 'Once daily',
      2 => 'Twice daily',
      3 => 'Three times daily',
      _ => '$n times daily',
    };
    if (n == 0) return how;
    return '$how at ${times.join(', ')}';
  }

  factory CareMedication.fromJson(Map<String, dynamic> j) => CareMedication(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString() ?? '',
    dose: j['dose']?.toString() ?? '',
    instructions: j['instructions']?.toString() ?? '',
    times: (j['times'] as List?)?.map((e) => e.toString()).toList() ?? const [],
  );
}

class CareFoodLog {
  const CareFoodLog({
    required this.id,
    required this.mealType,
    this.note = '',
    this.photoUrl,
    this.createdAt,
  });

  final String id;
  final String mealType;
  final String note;
  final String? photoUrl;
  final DateTime? createdAt;

  factory CareFoodLog.fromJson(Map<String, dynamic> j) => CareFoodLog(
    id: j['id']?.toString() ?? '',
    mealType: j['mealType']?.toString() ?? '',
    note: j['note']?.toString() ?? '',
    photoUrl: j['photoUrl']?.toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
  );
}
