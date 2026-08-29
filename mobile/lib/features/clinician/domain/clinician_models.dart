import 'patient_summary.dart';

/// Dashboard headline numbers from `GET /doctor/overview`.
class ClinicOverview {
  const ClinicOverview({
    required this.patientCount,
    this.newPatientsToday = 0,
    required this.activeToday,
    required this.appointmentsToday,
    required this.completedToday,
    required this.pendingReviews,
    required this.unreadMessages,
    this.unreadNutrition = 0,
    this.urgentUnread = 0,
    required this.emergencyAlerts,
    required this.urgentAlerts,
    required this.warningAlerts,
    required this.totalOpenAlerts,
    required this.riskLow,
    required this.riskModerate,
    required this.riskHigh,
    required this.riskCritical,
    this.dietPatients = 0,
    this.foodLogsToday = 0,
    this.nutritionReviews = const [],
  });

  final int patientCount;

  /// Patients who registered today — the "+3 today" next to the headline count.
  final int newPatientsToday;

  final int activeToday;
  final int appointmentsToday;

  /// Today's finished consultations — the "Completed" headline tile.
  final int completedToday;

  /// Conversations flagged for the doctor to read — the "Pending" tile.
  final int pendingReviews;

  /// Patient messages the clinic has not opened yet — the "New Messages" alert.
  final int unreadMessages;

  /// How many of [unreadMessages] are in a nutrition thread — which the doctor
  /// reaches through Chat review, not the Patients tab.
  final int unreadNutrition;

  /// How many unread messages the patient marked urgent or an emergency.
  ///
  /// Defaults to zero, so a server that predates the field simply shows no
  /// urgency note rather than an incorrect one.
  final int urgentUnread;

  final int emergencyAlerts;
  final int urgentAlerts;
  final int warningAlerts;
  final int totalOpenAlerts;
  final int riskLow;
  final int riskModerate;
  final int riskHigh;
  final int riskCritical;

  /// Patients a doctor has assigned to a dietician, and meals logged today.
  final int dietPatients;
  final int foodLogsToday;

  /// The patients on a review cadence, closest to their review date first.
  final List<NutritionReview> nutritionReviews;

  /// Open alerts that need immediate eyes — the "High Priority" alert count.
  int get highPriorityAlerts => emergencyAlerts + urgentAlerts;

  /// Every open alert, whatever its severity — what the header bell counts.
  /// The bell leads to a screen that lists all three, so counting only the
  /// urgent ones would leave a badge that says 0 above a screen with rows in it.
  int get openAlertsTotal => emergencyAlerts + urgentAlerts + warningAlerts;

  /// Everything actually waiting for the doctor — what the bell should say.
  ///
  /// Alerts alone left the badge reading zero while patients waited for a
  /// reply, because unread messages only ever showed as cards on Home. A bell
  /// that means "alerts only" while looking like "everything" gets misread.
  /// `unreadMessages` already includes the nutrition ones, so they are not
  /// added twice.
  int get waitingTotal => openAlertsTotal + unreadMessages + pendingReviews;

  factory ClinicOverview.fromJson(Map<String, dynamic> j) {
    final alerts = j['openAlerts'] as Map<String, dynamic>? ?? const {};
    final risk = j['riskDistribution'] as Map<String, dynamic>? ?? const {};
    final nutrition = j['nutrition'] as Map<String, dynamic>? ?? const {};
    int n(dynamic v) => (v as num?)?.toInt() ?? 0;
    return ClinicOverview(
      patientCount: n(j['patientCount']),
      newPatientsToday: n(j['newPatientsToday']),
      activeToday: n(j['activeToday']),
      appointmentsToday: n(j['appointmentsToday']),
      completedToday: n(j['completedToday']),
      pendingReviews: n(j['pendingReviews']),
      unreadMessages: n(j['unreadMessages']),
      unreadNutrition: n(j['unreadNutrition']),
      urgentUnread: n(j['urgentUnread']),
      emergencyAlerts: n(alerts['emergency']),
      urgentAlerts: n(alerts['urgent']),
      warningAlerts: n(alerts['warning']),
      totalOpenAlerts: n(alerts['total']),
      riskLow: n(risk['low']),
      riskModerate: n(risk['moderate']),
      riskHigh: n(risk['high']),
      riskCritical: n(risk['critical']),
      dietPatients: n(nutrition['dietPatients']),
      foodLogsToday: n(nutrition['foodLogsToday']),
      nutritionReviews:
          (nutrition['reviews'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(NutritionReview.fromJson)
              .toList() ??
          const [],
    );
  }
}

/// Clinic-wide population analytics for the dashboard (`GET /doctor/analytics`).
/// Aggregates, not per-patient series — the database collapses everyone into a
/// handful of daily buckets so this stays small however many readings exist.
class ClinicAnalytics {
  const ClinicAnalytics({
    this.controlTrend = const [],
    this.glucoseDaily = const [],
    this.engagement = const [],
    this.overdueCheckIns = 0,
    this.neverCheckedIn = 0,
    this.trendingWorse = 0,
    this.activePatients = 0,
  });

  final List<ControlPoint> controlTrend;

  /// Per-day clinic-wide glucose (average/min/max mg/dL) for the AGP-style line.
  final List<GlucoseDailyPoint> glucoseDaily;

  final List<EngagementPoint> engagement;
  final int overdueCheckIns;
  final int neverCheckedIn;
  final int trendingWorse;
  final int activePatients;

  /// Total readings across the whole window — used to gate the "not enough data
  /// yet" empty state so a line built from a handful of points isn't read as a
  /// clinic-wide signal.
  int get totalReadings => controlTrend.fold(0, (s, p) => s + p.total);

  /// The glucose series for the chart: the server's true daily averages when
  /// present, otherwise a reasonable approximation from the low/in-range/high
  /// counts (band midpoints) so the chart still draws against an older deploy
  /// that doesn't send `glucoseDaily` yet.
  List<GlucoseDailyPoint> get glucoseDailyOrApprox {
    if (glucoseDaily.isNotEmpty) return glucoseDaily;
    return [
      for (final p in controlTrend)
        if (p.total > 0)
          GlucoseDailyPoint(
            date: p.date,
            average:
                ((p.low * 57 + p.inRange * 125 + p.high * 215) / p.total)
                    .round(),
            min: 0,
            max: 0,
          ),
    ];
  }

  factory ClinicAnalytics.fromJson(Map<String, dynamic> j) {
    final m = j['monitoring'] as Map<String, dynamic>? ?? const {};
    int n(dynamic v) => (v as num?)?.toInt() ?? 0;
    return ClinicAnalytics(
      controlTrend:
          (j['controlTrend'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ControlPoint.fromJson)
              .toList() ??
          const [],
      glucoseDaily:
          (j['glucoseDaily'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(GlucoseDailyPoint.fromJson)
              .toList() ??
          const [],
      engagement:
          (j['engagement'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(EngagementPoint.fromJson)
              .toList() ??
          const [],
      overdueCheckIns: n(m['overdueCheckIns']),
      neverCheckedIn: n(m['neverCheckedIn']),
      trendingWorse: n(m['trendingWorse']),
      activePatients: n(m['activePatients']),
    );
  }
}

/// One day's clinic-wide glucose split (counts of readings low/in-range/high).
class ControlPoint {
  const ControlPoint({
    required this.date,
    required this.low,
    required this.inRange,
    required this.high,
    required this.total,
  });

  final DateTime date;
  final int low;
  final int inRange;
  final int high;
  final int total;

  factory ControlPoint.fromJson(Map<String, dynamic> j) => ControlPoint(
    date:
        DateTime.tryParse(j['date']?.toString() ?? '')?.toLocal() ??
        DateTime.now(),
    low: (j['low'] as num?)?.toInt() ?? 0,
    inRange: (j['inRange'] as num?)?.toInt() ?? 0,
    high: (j['high'] as num?)?.toInt() ?? 0,
    total: (j['total'] as num?)?.toInt() ?? 0,
  );
}

/// One day's count of distinct patients who logged at least one reading.
class EngagementPoint {
  const EngagementPoint({required this.date, required this.patients});

  final DateTime date;
  final int patients;

  factory EngagementPoint.fromJson(Map<String, dynamic> j) => EngagementPoint(
    date:
        DateTime.tryParse(j['date']?.toString() ?? '')?.toLocal() ??
        DateTime.now(),
    patients: (j['patients'] as num?)?.toInt() ?? 0,
  );
}

/// One medicine on a past prescription — enough detail to pre-fill a consult
/// medicine row when the doctor reuses it.
class PrescribedItem {
  const PrescribedItem({
    required this.name,
    this.strength,
    this.frequency,
    this.durationDays,
    this.relationToMeal,
    this.route,
  });

  final String name;
  final String? strength;

  /// The API frequency string, e.g. `BD`, `OD`, `TDS`.
  final String? frequency;
  final int? durationDays;

  /// `any` | `before_meal` | `with_meal` | `after_meal`.
  final String? relationToMeal;

  /// `oral` | `iv` | `sc` | `im` | `topical` | `inhaled`.
  final String? route;

  factory PrescribedItem.fromJson(Map<String, dynamic> j) => PrescribedItem(
    name: j['name']?.toString() ?? '',
    strength: j['strength']?.toString(),
    frequency: j['frequency']?.toString(),
    durationDays: (j['durationDays'] as num?)?.toInt(),
    relationToMeal: j['relationToMeal']?.toString(),
    route: j['route']?.toString(),
  );
}

/// A past prescription/consultation for the record's history
/// (`GET /patients/:id/prescriptions`).
class PrescriptionSummary {
  const PrescriptionSummary({
    required this.id,
    this.referenceNo,
    this.issuedOn,
    this.doctorName,
    this.complaint,
    this.diagnosis = const [],
    this.labTestsAdvised = const [],
    this.generalAdvice,
    this.followUpOn,
    this.itemCount = 0,
    this.medicines = const [],
    this.items = const [],
    this.pdfUrl,
    this.source = 'composed',
    this.scanUrl,
    this.scanMimeType,
    this.uploadedByName,
  });

  final String id;

  /// Human-readable reference printed on the PDF, e.g. `AKD-2026-000412`.
  final String? referenceNo;
  final DateTime? issuedOn;
  final String? doctorName;
  final String? complaint;
  final List<String> diagnosis;
  final List<String> labTestsAdvised;
  final String? generalAdvice;
  final DateTime? followUpOn;
  final int itemCount;

  /// The prescribed medicines as "name (strength)" strings, so the history tile
  /// shows what was actually given, not just how many.
  final List<String> medicines;

  /// The full previous items, for tap-to-reuse in a new consult.
  final List<PrescribedItem> items;

  /// Relative path to the downloadable PDF (`/api/v1/.../prescriptions/:id/pdf`).
  final String? pdfUrl;

  /// `composed` — written in the app, with structured medicines behind it.
  /// `scanned` — a photograph or PDF of a paper prescription, filed later.
  ///
  /// The clinic's pilot runs on paper, so for its first fifty patients every
  /// prescription is the second kind. The distinction is not cosmetic: a
  /// scanned one has no machine-readable items, so an empty medicine list on
  /// it means "not typed in", never "this patient is on nothing".
  final String source;

  bool get isScanned => source == 'scanned';

  /// The photograph or PDF itself, for a scanned prescription.
  final String? scanUrl;

  /// Who filed it, when that is not the prescriber — a receptionist, usually.
  final String? uploadedByName;

  /// What the scan actually is: `image/webp` for a photograph (the upload path
  /// re-encodes images, which is also what strips the GPS coordinates of the
  /// patient's home out of it), `application/pdf` for one supplied as a PDF.
  final String? scanMimeType;

  /// The document this prescription *is* — generated for one written in the
  /// app, the scan for one written on paper. Every reader wants whichever
  /// exists, and only this class knows which that is.
  String? get documentUrl => isScanned ? scanUrl : pdfUrl;

  /// The extension the document must be saved under. A phone opens a file by
  /// its name, so a WebP written to disk as `.pdf` finds no app that will
  /// take it.
  String get documentExtension =>
      !isScanned || (scanMimeType ?? '').contains('pdf')
          ? 'pdf'
          : (scanMimeType ?? 'image/webp').split('/').last;

  factory PrescriptionSummary.fromJson(
    Map<String, dynamic> j,
  ) => PrescriptionSummary(
    id: j['id']?.toString() ?? '',
    source: j['source']?.toString() ?? 'composed',
    scanUrl: j['scanUrl']?.toString(),
    scanMimeType: j['scanMimeType']?.toString(),
    uploadedByName: j['uploadedByName']?.toString(),
    referenceNo: j['referenceNo']?.toString(),
    issuedOn: DateTime.tryParse(j['issuedOn']?.toString() ?? '')?.toLocal(),
    doctorName: j['doctorName']?.toString(),
    complaint:
        (j['complaint'] == null || j['complaint'].toString().isEmpty)
            ? null
            : j['complaint'].toString(),
    diagnosis:
        (j['diagnosis'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    labTestsAdvised:
        (j['labTestsAdvised'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    generalAdvice:
        (j['generalAdvice'] == null || j['generalAdvice'].toString().isEmpty)
            ? null
            : j['generalAdvice'].toString(),
    followUpOn: DateTime.tryParse(j['followUpOn']?.toString() ?? '')?.toLocal(),
    itemCount: (j['items'] as List?)?.length ?? 0,
    medicines:
        (j['items'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map((it) {
              final name = it['name']?.toString() ?? '';
              final strength = it['strength']?.toString();
              return (strength != null && strength.isNotEmpty)
                  ? '$name ($strength)'
                  : name;
            })
            .where((s) => s.isNotEmpty)
            .toList() ??
        const [],
    items:
        (j['items'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(PrescribedItem.fromJson)
            .toList() ??
        const [],
    pdfUrl: j['pdfUrl']?.toString(),
  );
}

/// One nutrition card on the doctor's home: where a patient is in their review
/// cycle, and what their logging actually looks like.
class NutritionReview {
  const NutritionReview({
    required this.patientId,
    required this.name,
    required this.day,
    required this.intervalDays,
    required this.mealsThisWeek,
    this.lastLogAt,
    this.avatarUrl,
    this.lastLogPhotoUrl,
    this.nutritionSessionId,
  });

  final String patientId;

  /// The nutrition thread this review happens in, when one exists.
  final String? nutritionSessionId;
  final String name;

  /// Days into the current review cycle — the "Day 14/30" on the card.
  final int day;
  final int intervalDays;
  final int mealsThisWeek;
  final DateTime? lastLogAt;

  /// The patient's face, and the last meal they photographed.
  ///
  /// Both null on a server that predates them, and the card falls back to an
  /// initial and a plain icon — never to a broken image.
  final String? avatarUrl;
  final String? lastLogPhotoUrl;

  bool get isDue => intervalDays > 0 && day >= intervalDays;

  /// The headline on the card. Derived from logging activity rather than
  /// nutrient analysis: the app records meals, not sodium, and a card claiming
  /// otherwise would be inventing a number the doctor might act on.
  String get flag {
    if (lastLogAt == null) return 'Never logged a meal';
    final quiet = DateTime.now().difference(lastLogAt!).inDays;
    if (quiet >= 3) return 'Stopped logging';
    if (mealsThisWeek < 7) return 'Logging patchy';
    return 'Logging well';
  }

  String get detail {
    if (lastLogAt == null) return 'No meals recorded since joining';
    final quiet = DateTime.now().difference(lastLogAt!).inDays;
    if (quiet >= 3) return 'Nothing logged for $quiet days';
    return '$mealsThisWeek ${mealsThisWeek == 1 ? 'meal' : 'meals'} in the past week';
  }

  factory NutritionReview.fromJson(Map<String, dynamic> j) => NutritionReview(
    patientId: j['patientId']?.toString() ?? '',
    nutritionSessionId: j['nutritionSessionId']?.toString(),
    name: j['name']?.toString() ?? '',
    day: (j['day'] as num?)?.toInt() ?? 0,
    intervalDays: (j['intervalDays'] as num?)?.toInt() ?? 0,
    mealsThisWeek: (j['mealsThisWeek'] as num?)?.toInt() ?? 0,
    lastLogAt: DateTime.tryParse(j['lastLogAt']?.toString() ?? '')?.toLocal(),
  );
}

/// The doctor's Patients tab payload (`GET /doctor/worklist`).
class DoctorWorklist {
  const DoctorWorklist({
    required this.patients,
    required this.reviews,
    required this.plans,
    required this.queue,
    required this.recentMeals,
  });

  final int patients;
  final int reviews;
  final int plans;
  final List<WorklistItem> queue;
  final List<RecentMeal> recentMeals;

  factory DoctorWorklist.fromJson(Map<String, dynamic> j) {
    final counts = j['counts'] as Map<String, dynamic>? ?? const {};
    int n(dynamic v) => (v as num?)?.toInt() ?? 0;
    return DoctorWorklist(
      patients: n(counts['patients']),
      reviews: n(counts['reviews']),
      plans: n(counts['plans']),
      queue:
          (j['queue'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(WorklistItem.fromJson)
              .toList() ??
          const [],
      recentMeals:
          (j['recentMeals'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(RecentMeal.fromJson)
              .toList() ??
          const [],
    );
  }
}

/// One row in the doctor's action queue.
class WorklistItem {
  const WorklistItem({
    required this.kind,
    required this.patientId,
    required this.name,
    required this.days,
  });

  /// `review` — a conversation flagged for the doctor to read.
  /// `plan` — a patient who has never been prescribed for.
  final String kind;
  final String patientId;
  final String name;
  final int days;

  bool get needsPlan => kind == 'plan';

  factory WorklistItem.fromJson(Map<String, dynamic> j) => WorklistItem(
    kind: j['kind']?.toString() ?? 'review',
    patientId: j['patientId']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    days: (j['days'] as num?)?.toInt() ?? 0,
  );
}

/// A meal one of the clinic's patients logged, for the Latest Meals strip.
class RecentMeal {
  const RecentMeal({
    required this.id,
    required this.patientId,
    required this.patientName,
    required this.mealType,
    this.photoUrl,
    this.createdAt,
  });

  final String id;
  final String patientId;
  final String patientName;
  final String mealType;
  final String? photoUrl;
  final DateTime? createdAt;

  factory RecentMeal.fromJson(Map<String, dynamic> j) => RecentMeal(
    id: j['id']?.toString() ?? '',
    patientId: j['patientId']?.toString() ?? '',
    patientName: j['patientName']?.toString() ?? '',
    mealType: j['mealType']?.toString() ?? '',
    photoUrl: j['photoUrl']?.toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
  );
}

/// One row in the doctor's patient directory (`GET /doctor/patients`).
/// The newest turn in a patient's thread, for the clinician's inbox row.
class MessagePreview {
  const MessagePreview({
    required this.preview,
    required this.role,
    required this.at,
    this.urgency = 'routine',
    this.mediaType,
  });

  /// Already trimmed server-side — a 4000-character message has no business
  /// crossing the wire to fill a two-line row.
  final String preview;

  /// `user` | `assistant` | `clinician`. Lets the row say who spoke last, which
  /// is the difference between "waiting on you" and "already answered".
  final String role;
  final DateTime at;
  final String urgency;

  /// `voice` | `photo` | `pdf` | `document` | `file` when the newest turn is
  /// media, so the row can draw a subtle icon before the label. Null for text.
  final String? mediaType;

  bool get fromPatient => role == 'user';

  /// The assistant answered, not a person from the clinic. Worth separating:
  /// the inbox labelled every non-patient turn "You:", so a doctor scanning
  /// the list read the assistant's replies as their own and could not tell
  /// which conversations they had actually been part of.
  bool get fromAssistant => role == 'assistant';

  factory MessagePreview.fromJson(Map<String, dynamic> j) => MessagePreview(
    preview: j['preview']?.toString() ?? '',
    role: j['role']?.toString() ?? 'user',
    at:
        DateTime.tryParse(j['at']?.toString() ?? '')?.toLocal() ??
        DateTime.now(),
    urgency: j['urgency']?.toString() ?? 'routine',
    mediaType: j['mediaType']?.toString(),
  );
}

class PatientListItem {
  const PatientListItem({
    required this.id,
    required this.name,
    required this.phone,
    required this.riskScore,
    required this.riskBand,
    this.avatarUrl,
    this.lastMessage,
    this.unreadCount = 0,
    this.lastReadingAt,
    this.lastReadingValue,
    this.openAlertCount = 0,
    this.spark = const [],
    this.trend = 'flat',
    this.trendDelta,
    this.checkInIntervalDays,
    this.checkInOverdue = false,
    this.hba1c,
    this.hba1cAt,
    this.hba1cSpark = const [],
  });

  final String id;
  final String name;
  final String phone;

  /// Relative `/api/v1/uploads/:id/raw` path of the photo the patient set, or
  /// null. Absolute URL and auth header are assembled at render time.
  final String? avatarUrl;

  /// Newest turn in this patient's thread, or null if they have never written.
  final MessagePreview? lastMessage;

  /// Patient messages no clinician has opened yet. Drives the unread badge.
  final int unreadCount;
  final int riskScore;
  final String riskBand; // low | moderate | high | critical
  final DateTime? lastReadingAt;
  final num? lastReadingValue;
  final int openAlertCount;

  /// Recent glucose values (oldest→newest) for the row's inline sparkline.
  final List<double> spark;

  /// Where control is heading: 'up' | 'down' | 'flat'.
  final String trend;

  /// Change in the recent average vs the prior window, mg/dL (null if unknown).
  final int? trendDelta;

  /// The doctor's expected days between check-ins (null = app default).
  final int? checkInIntervalDays;

  /// True when the last reading is older than the check-in cadence.
  final bool checkInOverdue;

  /// Latest HbA1c (%), when it was tested, and a short recent series
  /// (oldest→newest) for the row's HbA1c mini-sparkline.
  final num? hba1c;
  final DateTime? hba1cAt;
  final List<double> hba1cSpark;

  factory PatientListItem.fromJson(Map<String, dynamic> j) => PatientListItem(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    phone: j['phone']?.toString() ?? '',
    riskScore: (j['riskScore'] as num?)?.toInt() ?? 0,
    riskBand: j['riskBand']?.toString() ?? 'low',
    avatarUrl: j['avatarUrl']?.toString(),
    // `is Map` rather than `is Map<String, dynamic>`: a nested object can decode
    // as Map<dynamic, dynamic> depending on the path it took, and the stricter
    // test would drop it silently. Defensive, not a fix for a known bug.
    lastMessage:
        j['lastMessage'] is Map
            ? MessagePreview.fromJson(
              Map<String, dynamic>.from(j['lastMessage'] as Map),
            )
            : null,
    unreadCount: (j['unreadCount'] as num?)?.toInt() ?? 0,
    lastReadingAt:
        DateTime.tryParse(j['lastReadingAt']?.toString() ?? '')?.toLocal(),
    lastReadingValue: j['lastReadingValue'] as num?,
    openAlertCount: (j['openAlertCount'] as num?)?.toInt() ?? 0,
    spark:
        (j['spark'] as List?)?.map((e) => (e as num).toDouble()).toList() ??
        const [],
    trend: j['trend']?.toString() ?? 'flat',
    trendDelta: (j['trendDelta'] as num?)?.toInt(),
    checkInIntervalDays: (j['checkInIntervalDays'] as num?)?.toInt(),
    checkInOverdue: j['checkInOverdue'] == true,
    hba1c: j['hba1c'] as num?,
    hba1cAt: DateTime.tryParse(j['hba1cAt']?.toString() ?? '')?.toLocal(),
    hba1cSpark:
        (j['hba1cSpark'] as List?)
            ?.map((e) => (e as num).toDouble())
            .toList() ??
        const [],
  );
}

/// A clinical alert (`GET /doctor/alerts`).
class ClinicalAlert {
  const ClinicalAlert({
    required this.id,
    required this.severity,
    required this.type,
    required this.title,
    required this.status,
    this.patientId,
    this.patientName,
    this.patientAvatarUrl,
    this.patientAddress,
    this.patientRiskBand,
    this.patientAge,
    this.patientGender,
    this.patientPhone,
    this.detail,
    this.matchedRules = const [],
    this.createdAt,
    this.acknowledgedAt,
    this.resolvedAt,
    this.resolutionNotes,
  });

  final String id;
  final String severity; // emergency | urgent | warning | info
  final String type;
  final String title;
  final String status; // open | acknowledged | resolved | dismissed
  final String? patientId;
  final String? patientName;

  /// Enough of the patient to recognise and act on the alert without opening
  /// their record first.
  final String? patientAvatarUrl;
  final String? patientAddress;
  final String? patientRiskBand;
  final int? patientAge;
  final String? patientGender;
  final String? patientPhone;
  final String? detail;
  final List<String> matchedRules;
  final DateTime? createdAt;
  final DateTime? acknowledgedAt;
  final DateTime? resolvedAt;
  final String? resolutionNotes;

  bool get isOpen => status == 'open';
  bool get isResolved => status == 'resolved' || status == 'dismissed';

  factory ClinicalAlert.fromJson(Map<String, dynamic> j) => ClinicalAlert(
    id: j['id']?.toString() ?? '',
    severity: j['severity']?.toString() ?? 'warning',
    type: j['type']?.toString() ?? 'other',
    title: j['title']?.toString() ?? '',
    status: j['status']?.toString() ?? 'open',
    patientId: j['patientId']?.toString(),
    patientName: j['patientName']?.toString(),
    patientAvatarUrl: j['patientAvatarUrl']?.toString(),
    patientAddress: j['patientAddress']?.toString(),
    patientRiskBand: j['patientRiskBand']?.toString(),
    patientAge: (j['patientAge'] as num?)?.toInt(),
    patientGender: j['patientGender']?.toString(),
    patientPhone: j['patientPhone']?.toString(),
    detail: j['detail']?.toString(),
    matchedRules:
        (j['matchedRules'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    acknowledgedAt:
        DateTime.tryParse(j['acknowledgedAt']?.toString() ?? '')?.toLocal(),
    resolvedAt: DateTime.tryParse(j['resolvedAt']?.toString() ?? '')?.toLocal(),
    resolutionNotes: j['resolutionNotes']?.toString(),
  );
}
