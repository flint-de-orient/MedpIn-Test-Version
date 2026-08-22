import '../../chat/domain/chat_message.dart';
import '../../clinician/domain/patient_summary.dart' show LabReport;

/// A patient assigned to the dietician (`GET /dietician/patients`).
class DietPatient {
  const DietPatient({
    required this.id,
    required this.name,
    required this.phone,
    this.avatarUrl,
    this.diabetesType,
    required this.riskBand,
    this.reviewIntervalDays,
    this.lastReviewAt,
    required this.reviewDue,
    this.dateOfBirth,
  });

  final String id;
  final String name;
  final String phone;
  final String? avatarUrl;
  final String? diabetesType;
  final String riskBand; // low | moderate | high | critical
  final int? reviewIntervalDays;
  final DateTime? lastReviewAt;
  final bool reviewDue;
  final DateTime? dateOfBirth;

  int? get age {
    final dob = dateOfBirth;
    if (dob == null) return null;
    final now = DateTime.now();
    var years = now.year - dob.year;
    if (now.month < dob.month || (now.month == dob.month && now.day < dob.day))
      years -= 1;
    return years < 0 || years > 130 ? null : years;
  }

  /// Days until the next review is due — negative once it has been missed.
  ///
  /// Worked out from the same two fields the server used to decide [reviewDue],
  /// so the wording on the card and the flag beside it can never disagree.
  int? get daysUntilReview {
    final last = lastReviewAt;
    final every = reviewIntervalDays;
    if (last == null || every == null) return null;
    final due = DateTime(
      last.year,
      last.month,
      last.day,
    ).add(Duration(days: every));
    final now = DateTime.now();
    return due.difference(DateTime(now.year, now.month, now.day)).inDays;
  }

  factory DietPatient.fromJson(Map<String, dynamic> j) => DietPatient(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    phone: j['phone']?.toString() ?? '',
    avatarUrl: j['avatarUrl']?.toString(),
    diabetesType: j['diabetesType']?.toString(),
    riskBand: j['riskBand']?.toString() ?? 'low',
    reviewIntervalDays: (j['reviewIntervalDays'] as num?)?.toInt(),
    lastReviewAt:
        DateTime.tryParse(j['lastReviewAt']?.toString() ?? '')?.toLocal(),
    reviewDue: j['reviewDue'] == true,
    dateOfBirth:
        DateTime.tryParse(j['dateOfBirth']?.toString() ?? '')?.toLocal(),
  );
}

/// One medicine the doctor has the patient on (nutrition context).
class DietMed {
  const DietMed({
    required this.name,
    required this.strength,
    required this.dose,
    required this.times,
  });

  final String name;
  final String strength;
  final String dose;
  final List<String> times;

  factory DietMed.fromJson(Map<String, dynamic> j) => DietMed(
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString() ?? '',
    dose: j['dose']?.toString() ?? '',
    times: (j['times'] as List?)?.map((e) => e.toString()).toList() ?? const [],
  );
}

/// The nutrition-relevant view of a patient (`.../overview`).
class DietPatientOverview {
  const DietPatientOverview({
    required this.id,
    required this.name,
    required this.phone,
    this.avatarUrl,
    this.gender,
    this.dateOfBirth,
    this.diabetesType,
    required this.riskBand,
    this.heightCm,
    this.diagnosedOn,
    this.chiefComplaint,
    required this.allergies,
    required this.medications,
    this.reviewIntervalDays,
    this.vitals,
    this.advice = const [],
    this.advisedTests = const [],
    this.labReports = const [],
    this.latestHba1c,
    this.hba1cTestedOn,
  });

  final String id;
  final String name;
  final String phone;
  final String? avatarUrl;
  final String? gender;
  final DateTime? dateOfBirth;
  final String? diabetesType;
  final String riskBand;
  final int? heightCm;
  final DateTime? diagnosedOn;

  /// The patient's own stated main concern (from registration / health details).
  final String? chiefComplaint;
  final List<String> allergies;
  final List<DietMed> medications;
  final int? reviewIntervalDays;

  /// The latest real vitals & measurements, each with the date it was taken.
  final DietVitals? vitals;

  /// The doctor's advice + diagnosis over time, newest first — the clinical
  /// reasoning behind the medicine list, which a plan should respect.
  final List<DietAdvice> advice;

  /// Lab work the doctor ordered, and whether a result has come back. An
  /// advised-but-missing test is why a diet plan may be resting on stale
  /// numbers, so it is worth seeing before writing one.
  final List<AdvisedTest> advisedTests;

  /// The uploaded reports themselves — summary, out-of-range analytes, the file
  /// to open — the same shape the doctor sees.
  final List<LabReport> labReports;

  final num? latestHba1c;
  final DateTime? hba1cTestedOn;

  /// Whole years since birth, for the header.
  int? get age {
    if (dateOfBirth == null) return null;
    final now = DateTime.now();
    var a = now.year - dateOfBirth!.year;
    if (now.month < dateOfBirth!.month ||
        (now.month == dateOfBirth!.month && now.day < dateOfBirth!.day)) {
      a--;
    }
    return a >= 0 && a < 130 ? a : null;
  }

  factory DietPatientOverview.fromJson(Map<String, dynamic> j) {
    final p = j['patient'] as Map<String, dynamic>? ?? const {};
    final m = j['medical'] as Map<String, dynamic>? ?? const {};
    final labs = j['labTests'] as Map<String, dynamic>? ?? const {};
    final complaint = m['chiefComplaint']?.toString().trim() ?? '';
    return DietPatientOverview(
      id: p['id']?.toString() ?? '',
      name: p['name']?.toString() ?? '',
      phone: p['phone']?.toString() ?? '',
      avatarUrl: p['avatarUrl']?.toString(),
      gender: p['gender']?.toString(),
      dateOfBirth:
          DateTime.tryParse(p['dateOfBirth']?.toString() ?? '')?.toLocal(),
      diabetesType: m['diabetesType']?.toString(),
      riskBand: m['riskBand']?.toString() ?? 'low',
      heightCm: (m['heightCm'] as num?)?.toInt(),
      diagnosedOn:
          DateTime.tryParse(m['diagnosedOn']?.toString() ?? '')?.toLocal(),
      chiefComplaint: complaint.isEmpty ? null : complaint,
      allergies:
          (m['allergies'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      medications:
          (j['medications'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(DietMed.fromJson)
              .toList() ??
          const [],
      reviewIntervalDays: (j['reviewIntervalDays'] as num?)?.toInt(),
      vitals:
          j['vitals'] is Map<String, dynamic>
              ? DietVitals.fromJson(j['vitals'] as Map<String, dynamic>)
              : null,
      advice:
          (j['advice'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(DietAdvice.fromJson)
              .toList() ??
          const [],
      advisedTests:
          (labs['advised'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(AdvisedTest.fromJson)
              .toList() ??
          const [],
      labReports:
          (labs['recent'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(LabReport.fromJson)
              .toList() ??
          const [],
      latestHba1c:
          (labs['latestHba1c'] as Map<String, dynamic>?)?['percentage'] as num?,
      hba1cTestedOn:
          DateTime.tryParse(
            (labs['latestHba1c'] as Map<String, dynamic>?)?['testedOn']
                    ?.toString() ??
                '',
          )?.toLocal(),
    );
  }
}

/// One dated measurement — a value and when it was actually taken.
class VitalReading {
  const VitalReading({required this.value, this.at, this.previous});
  final num value;
  final DateTime? at;

  /// The reading before this one, when there is one. Only ever the measured
  /// value — a direction nobody recorded is not shown at all.
  final num? previous;

  /// 1 rising, -1 falling, 0 unchanged, null when there is nothing to compare.
  int? get trend {
    final prev = previous;
    if (prev == null) return null;
    if (value > prev) return 1;
    if (value < prev) return -1;
    return 0;
  }

  static VitalReading? fromJson(Object? j) =>
      j is Map<String, dynamic>
          ? VitalReading(
            value: (j['value'] as num?) ?? 0,
            at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
            previous: j['previous'] as num?,
          )
          : null;
}

/// The latest blood-pressure reading, with the doctor's flag if one was set.
class DietBloodPressure {
  const DietBloodPressure({
    this.systolic,
    this.diastolic,
    this.flag,
    this.at,
    this.previousSystolic,
  });
  final num? systolic;
  final num? diastolic;
  final num? previousSystolic;

  /// Direction of the systolic, which is the number a clinician reads first.
  int? get trend {
    final now = systolic;
    final prev = previousSystolic;
    if (now == null || prev == null) return null;
    if (now > prev) return 1;
    if (now < prev) return -1;
    return 0;
  }

  final String?
  flag; // normal | elevated | stage1 | stage2 | hypertensive_crisis | hypotension
  final DateTime? at;

  String get label => '${systolic ?? '—'}/${diastolic ?? '—'}';
  bool get isHigh =>
      flag == 'stage1' || flag == 'stage2' || flag == 'hypertensive_crisis';

  static DietBloodPressure? fromJson(Object? j) =>
      j is Map<String, dynamic>
          ? DietBloodPressure(
            systolic: j['systolic'] as num?,
            diastolic: j['diastolic'] as num?,
            flag: j['flag']?.toString(),
            at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
            previousSystolic: j['previousSystolic'] as num?,
          )
          : null;
}

/// The latest self-logged blood sugar.
class DietGlucose {
  const DietGlucose({
    required this.valueMgDl,
    this.context,
    this.flag,
    this.at,
  });
  final num valueMgDl;
  final String?
  context; // fasting | pre_meal | post_meal | bedtime | random | hypo_check
  final String?
  flag; // severe_low | low | in_range | high | very_high | critical_high
  final DateTime? at;

  bool get isAbnormal => flag != null && flag != 'in_range';

  static DietGlucose? fromJson(Object? j) =>
      j is Map<String, dynamic>
          ? DietGlucose(
            valueMgDl: (j['valueMgDl'] as num?) ?? 0,
            context: j['context']?.toString(),
            flag: j['flag']?.toString(),
            at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
          )
          : null;
}

/// The patient's latest real vitals & measurements — each its own most-recent
/// reading. An absent field means it was never recorded (honest emptiness, not
/// a fabricated zero).
class DietVitals {
  const DietVitals({
    this.bloodPressure,
    this.pulse,
    this.spo2,
    this.weightKg,
    this.waistCm,
    this.temperatureC,
    this.bmi,
    this.glucose,
  });

  final DietBloodPressure? bloodPressure;
  final VitalReading? pulse;
  final VitalReading? spo2;
  final VitalReading? weightKg;
  final VitalReading? waistCm;
  final VitalReading? temperatureC;
  final num? bmi;
  final DietGlucose? glucose;

  bool get hasAny =>
      bloodPressure != null ||
      pulse != null ||
      spo2 != null ||
      weightKg != null ||
      waistCm != null ||
      temperatureC != null ||
      glucose != null;

  factory DietVitals.fromJson(Map<String, dynamic> j) => DietVitals(
    bloodPressure: DietBloodPressure.fromJson(j['bloodPressure']),
    pulse: VitalReading.fromJson(j['pulse']),
    spo2: VitalReading.fromJson(j['spo2']),
    weightKg: VitalReading.fromJson(j['weightKg']),
    waistCm: VitalReading.fromJson(j['waistCm']),
    temperatureC: VitalReading.fromJson(j['temperatureC']),
    bmi: j['bmi'] as num?,
    glucose: DietGlucose.fromJson(j['glucose']),
  );
}

/// One entry from the doctor's advice history — the diagnosis and general
/// advice given on a date, so the dietician plans with the reasoning in view.
class DietAdvice {
  const DietAdvice({
    this.issuedOn,
    this.diagnosis = const [],
    this.generalAdvice = '',
    this.followUpOn,
    this.doctorName,
  });

  final DateTime? issuedOn;
  final List<String> diagnosis;
  final String generalAdvice;
  final DateTime? followUpOn;
  final String? doctorName;

  factory DietAdvice.fromJson(Map<String, dynamic> j) => DietAdvice(
    issuedOn: DateTime.tryParse(j['issuedOn']?.toString() ?? '')?.toLocal(),
    diagnosis:
        (j['diagnosis'] as List?)
            ?.map((e) => e.toString())
            .where((s) => s.isNotEmpty)
            .toList() ??
        const [],
    generalAdvice: j['generalAdvice']?.toString() ?? '',
    followUpOn: DateTime.tryParse(j['followUpOn']?.toString() ?? '')?.toLocal(),
    doctorName: j['doctorName']?.toString(),
  );
}

/// One meal in a diet plan. `name` and `time` are free text on purpose — an
/// Indian day is not breakfast/lunch/dinner, and "before namaz" has to be
/// sayable.
class DietMeal {
  const DietMeal({
    required this.name,
    this.time = '',
    this.items = const [],
    this.notes = '',
  });

  final String name;
  final String time;
  final List<String> items;
  final String notes;

  DietMeal copyWith({
    String? name,
    String? time,
    List<String>? items,
    String? notes,
  }) => DietMeal(
    name: name ?? this.name,
    time: time ?? this.time,
    items: items ?? this.items,
    notes: notes ?? this.notes,
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    'time': time,
    'items': items,
    'notes': notes,
  };

  factory DietMeal.fromJson(Map<String, dynamic> j) => DietMeal(
    name: j['name']?.toString() ?? '',
    time: j['time']?.toString() ?? '',
    items: (j['items'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    notes: j['notes']?.toString() ?? '',
  );
}

/// The patient's diet plan. One per patient — a second would mean two answers
/// to "what do I eat", which is worse than none.
class DietPlan {
  const DietPlan({
    this.goal = '',
    this.meals = const [],
    this.avoid = const [],
    this.notes = '',
    this.dieticianName,
    this.sharedAt,
    this.updatedAt,
  });

  final String goal;
  final List<DietMeal> meals;
  final List<String> avoid;
  final String notes;
  final String? dieticianName;

  /// When the plan was last pushed into the care thread. Null means the patient
  /// has never been shown it — a finished-looking draft is still a draft.
  final DateTime? sharedAt;
  final DateTime? updatedAt;

  bool get isEmpty =>
      goal.isEmpty && meals.isEmpty && avoid.isEmpty && notes.isEmpty;

  /// True when the dietician has edited the plan since the patient last saw it.
  bool get hasUnsentChanges =>
      !isEmpty &&
      (sharedAt == null ||
          (updatedAt != null && updatedAt!.isAfter(sharedAt!)));

  Map<String, dynamic> toJson() => {
    'goal': goal,
    'meals': meals.map((m) => m.toJson()).toList(),
    'avoid': avoid,
    'notes': notes,
  };

  factory DietPlan.fromJson(Map<String, dynamic> j) => DietPlan(
    goal: j['goal']?.toString() ?? '',
    meals:
        (j['meals'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(DietMeal.fromJson)
            .toList() ??
        const [],
    avoid: (j['avoid'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    notes: j['notes']?.toString() ?? '',
    dieticianName: j['dieticianName']?.toString(),
    sharedAt: DateTime.tryParse(j['sharedAt']?.toString() ?? '')?.toLocal(),
    updatedAt: DateTime.tryParse(j['updatedAt']?.toString() ?? '')?.toLocal(),
  );
}

/// A patient as the dashboard lists them — enough to decide whether to open it.
class DietPatientBrief {
  const DietPatientBrief({
    required this.id,
    required this.name,
    this.avatarUrl,
    required this.riskBand,
    this.diabetesType,
    this.reviewIntervalDays,
    this.lastReviewAt,
    this.sinceDays = 0,
  });

  final String id;
  final String name;
  final String? avatarUrl;
  final String riskBand;
  final String? diabetesType;
  final int? reviewIntervalDays;
  final DateTime? lastReviewAt;

  /// Days since the last review, or since the record started if never reviewed.
  final int sinceDays;

  factory DietPatientBrief.fromJson(Map<String, dynamic> j) => DietPatientBrief(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    avatarUrl: j['avatarUrl']?.toString(),
    riskBand: j['riskBand']?.toString() ?? 'low',
    diabetesType: j['diabetesType']?.toString(),
    reviewIntervalDays: (j['reviewIntervalDays'] as num?)?.toInt(),
    lastReviewAt:
        DateTime.tryParse(j['lastReviewAt']?.toString() ?? '')?.toLocal(),
    sinceDays: (j['sinceDays'] as num?)?.toInt() ?? 0,
  );
}

/// One row in the dietician's action queue: either a review that has come due
/// or a patient still waiting for a plan.
class DietQueueItem {
  const DietQueueItem({
    required this.patientId,
    required this.name,
    required this.days,
    required this.needsPlan,
  });

  final String patientId;
  final String name;
  final int days;
  final bool needsPlan;

  String get label => '${days}d';
}

/// A meal one of the dietician's patients logged, for the dashboard feed.
class DietRecentLog {
  const DietRecentLog({
    required this.id,
    required this.patientId,
    required this.patientName,
    required this.mealType,
    required this.note,
    this.photoUrl,
    this.createdAt,
  });

  final String id;
  final String patientId;
  final String patientName;
  final String mealType;
  final String note;
  final String? photoUrl;
  final DateTime? createdAt;

  factory DietRecentLog.fromJson(Map<String, dynamic> j) => DietRecentLog(
    id: j['id']?.toString() ?? '',
    patientId: j['patientId']?.toString() ?? '',
    patientName: j['patientName']?.toString() ?? '',
    mealType: j['mealType']?.toString() ?? '',
    note: j['note']?.toString() ?? '',
    photoUrl: j['photoUrl']?.toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
  );
}

/// Everything the dietician's dashboard shows, in one response — so the three
/// counts always agree with the three lists below them.
class DietDashboard {
  const DietDashboard({
    required this.patients,
    this.newThisWeek = 0,
    required this.reviewsDue,
    required this.plansMissing,
    this.unreadMessages = 0,
    required this.reviewsDueList,
    required this.plansMissingList,
    required this.recentLogs,
  });

  final int patients;

  /// Patients whose record was opened in the last seven days.
  final int newThisWeek;

  final int reviewsDue;
  final int plansMissing;

  /// Patient messages in this dietician's nutrition threads nobody has opened.
  final int unreadMessages;
  final List<DietPatientBrief> reviewsDueList;
  final List<DietPatientBrief> plansMissingList;
  final List<DietRecentLog> recentLogs;

  /// The most recent meal from each patient, newest first.
  ///
  /// The raw feed is chronological, so a patient who photographed breakfast,
  /// lunch and a snack filled the whole grid on their own — four plates that
  /// looked like a cross-section of the caseload but were one person's
  /// Tuesday. One per patient makes "latest meals" mean what it says.
  List<DietRecentLog> get recentLogsByPatient {
    final seen = <String>{};
    final out = <DietRecentLog>[];
    final sorted = [...recentLogs]..sort((a, b) {
      final at = a.createdAt, bt = b.createdAt;
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
    for (final log in sorted) {
      if (seen.add(log.patientId)) out.add(log);
    }
    return out;
  }

  /// Reviews due, longest-waiting first, with anyone who has no plan at all
  /// left out — they belong under "waiting for a plan", not under "overdue for
  /// review", and a patient in both lists twice reads as twice the work.
  List<DietPatientBrief> get reviewsSorted {
    final planIds = plansMissingList.map((p) => p.id).toSet();
    return [...reviewsDueList.where((p) => !planIds.contains(p.id))]
      ..sort((a, b) => b.sinceDays.compareTo(a.sinceDays));
  }

  List<DietPatientBrief> get plansSorted =>
      [...plansMissingList]..sort((a, b) => b.sinceDays.compareTo(a.sinceDays));

  /// The two worklists as one queue. Reviews first: a patient already on a plan
  /// whose review has lapsed is care going stale, which outranks care not yet
  /// started. Longest-waiting first within each, and a patient in both lists
  /// appears once — as the plan they still do not have.
  List<DietQueueItem> get queue {
    final planIds = plansMissingList.map((p) => p.id).toSet();
    final sortedReviews = [
      ...reviewsDueList.where((p) => !planIds.contains(p.id)),
    ]..sort((a, b) => b.sinceDays.compareTo(a.sinceDays));
    final sortedPlans = [...plansMissingList]
      ..sort((a, b) => b.sinceDays.compareTo(a.sinceDays));

    return [
      for (final p in sortedReviews)
        DietQueueItem(
          patientId: p.id,
          name: p.name,
          days: p.sinceDays,
          needsPlan: false,
        ),
      for (final p in sortedPlans)
        DietQueueItem(
          patientId: p.id,
          name: p.name,
          days: p.sinceDays,
          needsPlan: true,
        ),
    ];
  }

  factory DietDashboard.fromJson(Map<String, dynamic> j) {
    final counts = j['counts'] as Map<String, dynamic>? ?? const {};
    List<DietPatientBrief> briefs(String key) =>
        (j[key] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(DietPatientBrief.fromJson)
            .toList() ??
        const [];
    return DietDashboard(
      patients: (counts['patients'] as num?)?.toInt() ?? 0,
      newThisWeek: (counts['newThisWeek'] as num?)?.toInt() ?? 0,
      reviewsDue: (counts['reviewsDue'] as num?)?.toInt() ?? 0,
      plansMissing: (counts['plansMissing'] as num?)?.toInt() ?? 0,
      unreadMessages: (counts['unreadMessages'] as num?)?.toInt() ?? 0,
      reviewsDueList: briefs('reviewsDue'),
      plansMissingList: briefs('plansMissing'),
      recentLogs:
          (j['recentLogs'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(DietRecentLog.fromJson)
              .toList() ??
          const [],
    );
  }
}

/// A lab test the doctor ordered, and whether a result has come back.
class AdvisedTest {
  const AdvisedTest({required this.name, required this.reported});

  final String name;
  final bool reported;

  factory AdvisedTest.fromJson(Map<String, dynamic> j) => AdvisedTest(
    name: j['name']?.toString() ?? '',
    reported: j['reported'] == true,
  );
}

/// One message in the patient's care thread, as the dietician sees it.
class DietMessage {
  const DietMessage({
    required this.id,
    required this.role,
    required this.content,
    this.senderName,
    this.createdAt,
    this.pinned = false,
    this.deletedForEveryone = false,
    this.replyToId,
    this.replyPreviewContent,
    this.imagePaths = const [],
    this.voiceNotes = const [],
    this.documents = const [],
  });

  final String id;
  final String role; // user | assistant | clinician | dietician | system
  final String content;
  final String? senderName;
  final DateTime? createdAt;

  /// Kept at the top of the thread (mirrors the patient/doctor bubbles).
  final bool pinned;

  /// Deleted for everyone by its author — rendered as a tombstone.
  final bool deletedForEveryone;

  /// The message this one answers, plus a text preview of it (server-sent), so
  /// a reply shows its quote even when the original is off-screen.
  final String? replyToId;
  final String? replyPreviewContent;

  /// Photos on this turn, as relative `/uploads/:id/raw` paths.
  final List<String> imagePaths;
  final List<VoiceNote> voiceNotes;
  final List<DocumentAttachment> documents;

  bool get hasAttachments =>
      imagePaths.isNotEmpty || voiceNotes.isNotEmpty || documents.isNotEmpty;

  bool get fromPatient => role == 'user';
  bool get fromDietician => role == 'dietician';

  factory DietMessage.fromJson(Map<String, dynamic> j) => DietMessage(
    id: j['id']?.toString() ?? '',
    role: j['role']?.toString() ?? 'user',
    content: j['content']?.toString() ?? '',
    senderName: j['senderName']?.toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    pinned: j['pinned'] == true,
    deletedForEveryone: j['deletedForEveryone'] == true,
    replyToId: j['replyToId']?.toString(),
    replyPreviewContent:
        j['replyPreview'] is Map
            ? (j['replyPreview'] as Map)['content']?.toString()
            : null,
    imagePaths:
        _parts(j)
            .where(isImageAttachment)
            .map((a) => a['url']?.toString() ?? '')
            .where((s) => s.isNotEmpty)
            .toList(),
    voiceNotes:
        _parts(j)
            .where(isAudioAttachment)
            .map(
              (a) => VoiceNote(
                url: a['url']?.toString() ?? '',
                transcript: a['transcript']?.toString(),
                mimeType: a['mimeType']?.toString(),
              ),
            )
            .where((v) => v.url.isNotEmpty)
            .toList(),
    documents:
        _parts(j)
            .where(isDocumentAttachment)
            .map(
              (a) => DocumentAttachment(
                url: a['url']?.toString() ?? '',
                name: a['originalName']?.toString() ?? 'Document',
                mimeType: a['mimeType']?.toString(),
                sizeBytes: (a['sizeBytes'] as num?)?.toInt(),
              ),
            )
            .where((d) => d.url.isNotEmpty)
            .toList(),
  );

  static List<Map<String, dynamic>> _parts(Map<String, dynamic> j) =>
      (j['attachments'] as List?)?.whereType<Map<String, dynamic>>().toList() ??
      const [];
}

/// A plan the patient has been taken off, kept so the dietician can see what
/// they were on before and for how long.
class DietPlanRevision {
  const DietPlanRevision({
    required this.id,
    required this.plan,
    this.replacedAt,
    this.startedAt,
  });

  final String id;
  final DietPlan plan;
  final DateTime? replacedAt;
  final DateTime? startedAt;

  /// How long the patient was on it, when both ends are known.
  int? get days {
    final from = startedAt;
    final to = replacedAt;
    if (from == null || to == null) return null;
    final d = to.difference(from).inDays;
    return d < 0 ? null : d;
  }

  factory DietPlanRevision.fromJson(Map<String, dynamic> j) => DietPlanRevision(
    id: j['id']?.toString() ?? '',
    plan: DietPlan.fromJson(j),
    replacedAt: DateTime.tryParse(j['replacedAt']?.toString() ?? '')?.toLocal(),
    startedAt: DateTime.tryParse(j['startedAt']?.toString() ?? '')?.toLocal(),
  );
}

/// One thing waiting for the dietician: a patient's unread message, a lapsed
/// review, or a patient with no plan yet.
class DietNotification {
  const DietNotification({
    required this.id,
    required this.kind,
    required this.patientId,
    required this.patientName,
    required this.text,
    this.avatarUrl,
    this.at,
    this.unread = false,
  });

  final String id;

  /// message | review | plan
  final String kind;
  final String patientId;
  final String patientName;
  final String text;
  final String? avatarUrl;
  final DateTime? at;
  final bool unread;

  factory DietNotification.fromJson(Map<String, dynamic> j) => DietNotification(
    id: j['id']?.toString() ?? '',
    kind: j['kind']?.toString() ?? 'message',
    patientId: j['patientId']?.toString() ?? '',
    patientName: j['patientName']?.toString() ?? '',
    text: j['text']?.toString() ?? '',
    avatarUrl: j['avatarUrl']?.toString(),
    at: DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal(),
    unread: j['unread'] == true,
  );
}

class DietNotifications {
  const DietNotifications({required this.unread, required this.items});

  final int unread;
  final List<DietNotification> items;

  factory DietNotifications.fromJson(Map<String, dynamic> j) =>
      DietNotifications(
        unread: (j['unread'] as num?)?.toInt() ?? 0,
        items:
            (j['items'] as List? ?? const [])
                .whereType<Map<String, dynamic>>()
                .map(DietNotification.fromJson)
                .toList(),
      );
}
