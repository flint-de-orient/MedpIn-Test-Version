import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/features/auth/data/auth_repository.dart';
import 'package:akd_care/features/auth/domain/user.dart';
export 'package:akd_care/features/auth/presentation/auth_controller.dart'
    show authRepositoryProvider;
import 'package:akd_care/features/clinician/domain/appointment.dart';
import 'package:akd_care/features/clinician/domain/caseload_panels.dart';
import 'package:akd_care/features/clinician/domain/chat_summary.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/lab_overview.dart';

/// Fake data for the doctor's home, shaped exactly as the server sends it.
///
/// Built through each model's `fromJson` rather than its constructor, so the
/// previews exercise the same parsing the phone does: a field the screen reads
/// and the parser drops shows up here as an empty panel, not as a surprise on
/// a device.
///
/// Every date is relative to now, so "today" means today whenever this runs.

final _now = DateTime.now();
DateTime _today(int hour, int minute) =>
    DateTime(_now.year, _now.month, _now.day, hour, minute);
String _iso(DateTime d) => d.toUtc().toIso8601String();
String _daysAgo(int n) => _iso(_now.subtract(Duration(days: n)));
String _daysAhead(int n) => _iso(_now.add(Duration(days: n)));

// ---- who is signed in ------------------------------------------------------

const doctorUser = AppUser(
  id: 'u-doctor',
  name: 'Dr. Amit Kumar Dey',
  phone: '+919830012345',
  role: 'doctor',
  language: 'en',
  qualifications: 'MBBS, MD (Medicine), DM (Endocrinology)',
  specialty: 'Consultant Diabetologist',
);

extension AnotherPerson on AppUser {
  /// The same account under another name — a physician, a cardiologist, a
  /// practice manager — keeping the id the fixtures' appointments belong to.
  AppUser copyWithName(String name, {String? specialty, String? role}) => AppUser(
    id: id,
    name: name,
    phone: phone,
    role: role ?? this.role,
    language: language,
    specialty: specialty,
  );
}

/// Signed in, so the header has a person to draw.
class SignedInStore extends SecureStore {
  @override
  Future<String?> readAccessToken() async => 'preview-token';
}

/// `/auth/me`, answered without a network.
class SignedInRepository implements AuthRepository {
  SignedInRepository([this.user = doctorUser]);

  final AppUser user;

  @override
  Future<({AppUser user, String? diabetesType})> getMe() async =>
      (user: user, diabetesType: null);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---- what this person may see ---------------------------------------------

const _allCaps = {
  Cap.prescription,
  Cap.labOrder,
  Cap.labResult,
  Cap.department,
  Cap.multiLocation,
  Cap.aiAssistant,
  Cap.advancedAnalytics,
  Cap.advancedReports,
  Cap.reportExport,
  Cap.departmentAnalytics,
  Cap.staffAnalytics,
  Cap.scheduledReports,
};

const _doctorPermissions = {
  Perm.viewPatient,
  Perm.editRecord,
  Perm.prescribe,
  Perm.chatRead,
  Perm.chatReply,
  Perm.manageStaff,
  Perm.manageDepartment,
  Perm.viewAudit,
  Perm.shareRecords,
};

Capabilities doctorCaps({
  required List<String> widgets,
  List<String> actions = const ['START_CONSULTATION', 'ADD_PATIENT'],
  String? specialty,
  String? department,
  String role = 'doctor',
  bool hasDietician = true,
  Set<String> capabilities = _allCaps,
  Set<String> permissions = _doctorPermissions,
}) => Capabilities(
  practiceType: 'clinic',
  specialty: specialty,
  plan: 'professional',
  practice: capabilities,
  effective: capabilities,
  role: role,
  isOwner: role == 'doctor',
  resolved: true,
  hasDietician: hasDietician,
  permissions: permissions,
  ui: DashboardConfig(
    widgets: widgets,
    quickActions: actions,
    department: department,
  ),
);

// ---- the day --------------------------------------------------------------

Map<String, dynamic> _appointment(
  String id,
  String name,
  DateTime at,
  String status, {
  String doctorId = 'u-doctor',
  String doctorName = 'Dr. Amit Kumar Dey',
  String? reason,
}) => {
  'id': id,
  'patientId': 'p-$id',
  'patientName': name,
  'doctorId': doctorId,
  'doctorName': doctorName,
  'scheduledFor': _iso(at),
  'status': status,
  'mode': 'in_clinic',
  'reason': reason,
};

List<Appointment> busyDay() => [
  for (final j in [
    _appointment('a1', 'Sunita Ghosh', _today(9, 0), 'completed'),
    _appointment('a2', 'Rahul Das', _today(9, 15), 'completed'),
    _appointment('a3', 'Mohammed Imran Chowdhury', _today(9, 30), 'no_show'),
    _appointment('a4', 'Anita Banerjee', _today(9, 45), 'completed'),
    _appointment('a5', 'Pradip Kumar Mukherjee', _today(10, 0), 'in_consultation'),
    // A colleague's patient, waiting first: the primary action must not name
    // them.
    _appointment(
      'a13',
      'Anjali Sen',
      _today(10, 5),
      'checked_in',
      doctorId: 'u-sen',
      doctorName: 'Dr. Ritu Sen',
    ),
    _appointment('a6', 'Farida Begum', _today(10, 15), 'checked_in', reason: 'HbA1c review'),
    _appointment('a7', 'Subhash Chandra Mondal', _today(10, 30), 'checked_in'),
    _appointment('a8', 'Tapasi Roy', _today(10, 45), 'confirmed'),
    _appointment('a9', 'Debashis Sen', _today(11, 0), 'confirmed'),
    _appointment('a10', 'Kakoli Dutta', _today(11, 30), 'confirmed'),
    _appointment('a11', 'Nirmal Saha', _today(12, 0), 'confirmed'),
    _appointment('a12', 'Rupa Chatterjee', _today(16, 30), 'confirmed'),
  ])
    Appointment.fromJson(j),
];

/// A day with far more appointments than the card names.
List<Appointment> packedDay({int count = 36}) => [
  for (var i = 0; i < count; i++)
    Appointment.fromJson(
      _appointment(
        'p$i',
        'Patient ${i + 1}',
        _today(9, 0).add(Duration(minutes: 10 * i)),
        i < 12 ? 'completed' : (i < 16 ? 'checked_in' : 'confirmed'),
      ),
    ),
];

// ---- who needs attention --------------------------------------------------

Map<String, dynamic> _patient(
  String id,
  String name,
  String band, {
  int alerts = 0,
  num? hba1c,
  int? trendDelta,
  int? lastReadingDaysAgo = 1,
  bool overdue = false,
  List<double> spark = const [],
  String trend = 'flat',
}) => {
  'id': id,
  'name': name,
  'phone': '+9198300${id.hashCode.abs() % 99999}',
  'riskScore': switch (band) {
    'critical' => 92,
    'high' => 74,
    'moderate' => 48,
    _ => 12,
  },
  'riskBand': band,
  'openAlertCount': alerts,
  'hba1c': hba1c,
  'hba1cAt': hba1c == null ? null : _daysAgo(40),
  'trendDelta': trendDelta,
  'trend': trend,
  'spark': spark,
  'checkInOverdue': overdue,
  'lastReadingAt': lastReadingDaysAgo == null ? null : _daysAgo(lastReadingDaysAgo),
};

List<PatientListItem> attentionBusy() => [
  for (final j in [
    _patient('p1', 'Farida Begum', 'critical', alerts: 2, hba1c: 11.2, spark: [210, 260, 310, 342], trend: 'up'),
    _patient('p2', 'Gopal Krishna Bhattacharya', 'high', alerts: 1, hba1c: 9.4),
    _patient('p3', 'Mitali Pal', 'high', hba1c: 8.6, trendDelta: 38, spark: [150, 170, 181, 196], trend: 'up'),
    _patient('p4', 'Ranjit Halder', 'high', lastReadingDaysAgo: 19, overdue: true),
    _patient('p5', 'Shyamal Kundu', 'moderate', hba1c: 7.6),
    _patient('p6', 'Tapasi Roy', 'moderate', trendDelta: 12),
    for (var i = 0; i < 20; i++) _patient('lp$i', 'Low Risk Patient $i', 'low', hba1c: 6.4),
  ])
    PatientListItem.fromJson(j),
];

List<PatientListItem> attentionCalm() => [
  for (var i = 0; i < 12; i++)
    PatientListItem.fromJson(_patient('lp$i', 'Patient $i', i < 3 ? 'moderate' : 'low')),
];

List<ClinicalAlert> openAlerts() => [
  for (final j in [
    {
      'id': 'al1',
      'severity': 'emergency',
      'type': 'glucose',
      'title': 'Sugar 42 mg/dL — severe low',
      'status': 'open',
      'patientId': 'p1',
      'patientName': 'Farida Begum',
      'patientRiskBand': 'critical',
      'patientAge': 58,
      'patientGender': 'female',
      'patientPhone': '+919830011111',
      'detail': 'Felt shaky and sweaty after skipping lunch. Took glucose tablets.',
      'createdAt': _iso(_now.subtract(const Duration(minutes: 35))),
    },
    {
      'id': 'al2',
      'severity': 'urgent',
      'type': 'glucose',
      'title': 'Sugar above 400 mg/dL',
      'status': 'open',
      'patientId': 'p1',
      'patientName': 'Farida Begum',
      'patientRiskBand': 'critical',
      'createdAt': _iso(_now.subtract(const Duration(hours: 5))),
    },
    {
      'id': 'al3',
      'severity': 'warning',
      'type': 'symptom',
      'title': 'Burning feet at night',
      'status': 'acknowledged',
      'patientId': 'p2',
      'patientName': 'Gopal Krishna Bhattacharya',
      'patientRiskBand': 'high',
      'patientAge': 66,
      'patientGender': 'male',
      'patientAddress': '14/2 Lake Gardens, Kolkata 700045',
      'detail': 'Says the burning has been worse this week and keeps him awake.',
      'acknowledgedAt': _daysAgo(1),
      'createdAt': _daysAgo(1),
    },
    {
      'id': 'al4',
      'severity': 'warning',
      'type': 'vitals',
      'title': 'Blood pressure 168/102',
      'status': 'open',
      'patientId': 'p3',
      'patientName': 'Mitali Pal',
      'createdAt': _daysAgo(2),
    },
  ])
    ClinicalAlert.fromJson(j),
];

// ---- headline numbers -----------------------------------------------------

ClinicOverview busyOverview() => ClinicOverview.fromJson({
  'patientCount': 142,
  'newPatientsToday': 2,
  'activeToday': 38,
  'appointmentsToday': 12,
  'completedToday': 3,
  'pendingReviews': 1,
  'unreadMessages': 9,
  'unreadNutrition': 2,
  'urgentUnread': 1,
  'openAlerts': {'emergency': 1, 'urgent': 1, 'warning': 1, 'total': 3},
  'riskDistribution': {'low': 101, 'moderate': 28, 'high': 10, 'critical': 3},
  'nutrition': {
    'dietPatients': 40,
    'needsDieticianAssignment': 0,
    'foodLogsToday': 12,
    'reviews': [
      {'patientId': 'p5', 'name': 'Shyamal Kundu', 'day': 30, 'intervalDays': 30, 'mealsThisWeek': 9, 'lastLogAt': _daysAgo(0)},
      {'patientId': 'p6', 'name': 'Tapasi Roy', 'day': 29, 'intervalDays': 30, 'mealsThisWeek': 3, 'lastLogAt': _daysAgo(4)},
      {'patientId': 'p7', 'name': 'Bijoy Adhikari', 'day': 12, 'intervalDays': 30, 'mealsThisWeek': 0},
    ],
  },
});

ClinicOverview emptyOverview() => ClinicOverview.fromJson({
  'patientCount': 0,
  'appointmentsToday': 0,
  'completedToday': 0,
  'pendingReviews': 0,
  'unreadMessages': 0,
  'openAlerts': {'emergency': 0, 'urgent': 0, 'warning': 0, 'total': 0},
  'riskDistribution': {'low': 0, 'moderate': 0, 'high': 0, 'critical': 0},
  'nutrition': {'reviews': <Object>[]},
});

ClinicAnalytics busyAnalytics(int days) => ClinicAnalytics.fromJson({
  'controlTrend': [
    for (var i = days - 1; i >= 0; i--)
      {
        'date': _daysAgo(i),
        // A gap three days ago: nobody logged a reading that day.
        'low': i == 3 ? 0 : 2 + (i % 3),
        'inRange': i == 3 ? 0 : 30 + (i * 7 % 11),
        'high': i == 3 ? 0 : 14 - (i % 5),
        'total': i == 3 ? 0 : 46 + (i * 7 % 11) - (i % 5) + (i % 3),
      },
  ],
  'monitoring': {'overdueCheckIns': 11, 'neverCheckedIn': 4, 'trendingWorse': 6, 'activePatients': 96},
});

ClinicAnalytics emptyAnalytics() => ClinicAnalytics.fromJson({
  'controlTrend': <Object>[],
  'monitoring': {'overdueCheckIns': 0, 'neverCheckedIn': 0, 'trendingWorse': 0, 'activePatients': 0},
});

// ---- caseload panels ------------------------------------------------------

BpControl busyBp() => BpControl.fromJson({
  'days': 90,
  'caseload': 142,
  'withReading': 118,
  'withoutReading': 24,
  'bands': {'normal': 41, 'elevated': 22, 'stage1': 30, 'stage2': 19, 'hypertensive_crisis': 2, 'hypotension': 4},
  'attention': [
    {'patientId': 'p3', 'name': 'Mitali Pal', 'systolic': 186, 'diastolic': 122, 'band': 'hypertensive_crisis', 'recordedAt': _daysAgo(0)},
    {'patientId': 'p8', 'name': 'Haripada Biswas', 'systolic': 182, 'diastolic': 110, 'band': 'hypertensive_crisis', 'recordedAt': _daysAgo(3)},
    {'patientId': 'p9', 'name': 'Arati Sarkar', 'systolic': 88, 'diastolic': 56, 'band': 'hypotension', 'recordedAt': _daysAgo(1)},
    {'patientId': 'p10', 'name': 'Nemai Ghosh', 'systolic': 164, 'diastolic': 98, 'band': 'stage2', 'recordedAt': _daysAgo(6)},
  ],
  'attentionTotal': 25,
});

FollowUps busyFollowUps() => FollowUps.fromJson({
  'days': 7,
  'overdue': [
    {'patientId': 'p11', 'name': 'Kalyani Mitra', 'followUpOn': _daysAgo(9), 'doctorName': 'Dr. Amit Kumar Dey'},
    {'patientId': 'p12', 'name': 'Sanjoy Paul', 'followUpOn': _daysAgo(3), 'doctorName': 'Dr. Amit Kumar Dey'},
  ],
  'overdueTotal': 2,
  'due': [
    {'patientId': 'p13', 'name': 'Moumita Das', 'followUpOn': _daysAhead(1), 'doctorName': 'Dr. Amit Kumar Dey'},
    {'patientId': 'p14', 'name': 'Biplab Chakraborty', 'followUpOn': _daysAhead(2), 'doctorName': 'Dr. Amit Kumar Dey'},
    {'patientId': 'p15', 'name': 'Rina Basu', 'followUpOn': _daysAhead(5), 'doctorName': 'Dr. Amit Kumar Dey'},
  ],
  'dueTotal': 6,
});

ConditionRegister busyConditions() => ConditionRegister.fromJson({
  'caseload': 142,
  'conditions': [
    {'key': 'type2_diabetes', 'name': 'Type 2 diabetes', 'count': 97},
    {'key': 'hypertension', 'name': 'Hypertension', 'count': 64},
    {'key': 'dyslipidaemia', 'name': 'Dyslipidaemia', 'count': 38},
    {'key': 'hypothyroidism', 'name': 'Hypothyroidism', 'count': 21},
    {'key': 'ckd', 'name': 'Chronic kidney disease', 'count': 9},
  ],
  'withoutCondition': 17,
});

HeartRateFlags busyHeartRate() => HeartRateFlags.fromJson({
  'days': 30,
  'limits': {'low': 50, 'high': 120},
  'withReading': 88,
  'withoutReading': 54,
  'low': [
    {'patientId': 'p16', 'name': 'Asit Baran Roy', 'pulse': 44, 'recordedAt': _daysAgo(2)},
  ],
  'lowTotal': 1,
  'high': [
    {'patientId': 'p17', 'name': 'Jharna Dey', 'pulse': 132, 'recordedAt': _daysAgo(1)},
    {'patientId': 'p18', 'name': 'Prosenjit Nag', 'pulse': 124, 'recordedAt': _daysAgo(8)},
  ],
  'highTotal': 2,
});

EcgPanel busyEcg() => EcgPanel.fromJson({
  'days': 180,
  'withEcg': 36,
  'withoutEcg': 106,
  'impressions': {'normal': 24, 'borderline': 5, 'abnormal': 3, 'unknown': 4},
  'flagged': [
    {'patientId': 'p19', 'name': 'Swapan Kumar Ghoshal', 'impression': 'abnormal', 'rhythm': 'atrial_fibrillation', 'heartRate': 118, 'recordedOn': _daysAgo(2)},
    {'patientId': 'p20', 'name': 'Lipika Sen', 'impression': 'abnormal', 'rhythm': 'sinus', 'heartRate': 58, 'recordedOn': _daysAgo(11)},
    {'patientId': 'p21', 'name': 'Utpal Das', 'impression': 'borderline', 'rhythm': 'sinus', 'recordedOn': _daysAgo(20)},
  ],
  'flaggedTotal': 8,
});

LipidControl busyLipids() => LipidControl.fromJson({
  'days': 365,
  'source': 'uploaded lab reports',
  'target': {'analyte': 'LDL', 'unit': 'mg/dL', 'high': 100},
  'withResult': 61,
  'withoutResult': 81,
  'atOrBelow': 34,
  'above': [
    {'patientId': 'p22', 'name': 'Tarun Majumdar', 'ldl': 198, 'testedOn': _daysAgo(21)},
    {'patientId': 'p23', 'name': 'Dipali Saha', 'ldl': 164.5, 'testedOn': _daysAgo(60)},
    {'patientId': 'p24', 'name': 'Samir Ali', 'ldl': 142, 'testedOn': _daysAgo(95)},
  ],
  'aboveTotal': 27,
});

LabOverview busyLabs() => LabOverview.fromJson({
  'days': 30,
  'critical': [
    {
      'id': 'lr1',
      'title': 'Renal function test',
      'labName': 'Suraksha Diagnostics',
      'testedOn': _daysAgo(1),
      'patient': {'id': 'p25', 'name': 'Madhabi Pal'},
      'worstFlag': 'critical',
      'abnormal': [
        {'label': 'Creatinine', 'value': 4.8, 'unit': 'mg/dL', 'flag': 'critical'},
        {'label': 'Potassium', 'value': 6.1, 'unit': 'mmol/L', 'flag': 'high'},
      ],
    },
  ],
  'recent': [
    {
      'id': 'lr1',
      'title': 'Renal function test',
      'labName': 'Suraksha Diagnostics',
      'testedOn': _daysAgo(1),
      'patient': {'id': 'p25', 'name': 'Madhabi Pal'},
      'worstFlag': 'critical',
      'abnormal': [
        {'label': 'Creatinine', 'value': 4.8, 'unit': 'mg/dL', 'flag': 'critical'},
      ],
    },
    {
      'id': 'lr2',
      'title': 'Lipid profile',
      'labName': 'Dr Lal PathLabs',
      'testedOn': _daysAgo(3),
      'patient': {'id': 'p22', 'name': 'Tarun Majumdar'},
      'worstFlag': 'abnormal',
      'abnormal': [
        {'label': 'LDL', 'value': 198, 'unit': 'mg/dL', 'flag': 'high'},
      ],
    },
    {
      'id': 'lr3',
      'title': 'HbA1c',
      'labName': null,
      'testedOn': _daysAgo(6),
      'patient': {'id': 'p5', 'name': 'Shyamal Kundu'},
      'worstFlag': 'normal',
      'abnormal': <Object>[],
    },
  ],
  'flags': {'critical': 2, 'high': 14, 'low': 5, 'normal': 131, 'unflagged': 3},
});

ChatSummaryDay busyConversations() => ChatSummaryDay.fromJson({
  'day': '${_now.year}-${_now.month}-${_now.day}',
  'scope': 'mine',
  'kind': 'care',
  'counts': {'patients': 11, 'needsDoctor': 3, 'reviewed': 1},
  'items': [
    {
      'id': 's1',
      'patient': {'id': 'p1', 'name': 'Farida Begum'},
      'highestUrgency': 'urgent',
      'needsDoctor': true,
      'reasons': ['Urgent by triage: very low sugar after skipping lunch'],
      'overview': 'Reported a sugar of 42 and shakiness.',
    },
    {
      'id': 's2',
      'patient': {'id': 'p26', 'name': 'Arnab Bhowmick'},
      'highestUrgency': 'routine',
      'needsDoctor': true,
      'reasons': ['Asked whether to change the evening insulin dose'],
    },
    {
      'id': 's3',
      'patient': {'id': 'p27', 'name': 'Sreela Mukherjee'},
      'highestUrgency': 'advice',
      'needsDoctor': true,
      'reasons': ['Wants to move Friday’s appointment'],
    },
  ],
});

GlucoseFlags busyGlucose() => GlucoseFlags.fromJson({
  'days': 14,
  'unit': 'mg/dL',
  'thresholds': {'low': 70, 'severeLow': 54, 'veryHigh': 250, 'criticalHigh': 400, 'rangeLow': 70, 'rangeHigh': 180},
  'caseload': 142,
  'withReadings': 96,
  'withoutReadings': 46,
  'readings': 1284,
  'inRange': 822,
  'lows': [
    {'patientId': 'p1', 'name': 'Farida Begum', 'count': 3, 'severe': 1, 'lowest': 42, 'lastAt': _daysAgo(0)},
    {'patientId': 'p28', 'name': 'Arnab Bhowmick', 'count': 2, 'severe': 0, 'lowest': 63, 'lastAt': _daysAgo(2)},
  ],
  'lowsTotal': 7,
  'highs': [
    {'patientId': 'p2', 'name': 'Gopal Krishna Bhattacharya', 'count': 4, 'critical': 1, 'highest': 436, 'lastAt': _daysAgo(1)},
    {'patientId': 'p3', 'name': 'Mitali Pal', 'count': 2, 'critical': 0, 'highest': 298, 'lastAt': _daysAgo(3)},
  ],
  'highsTotal': 5,
});

GlucoseFlags noReadingsGlucose() => GlucoseFlags.fromJson({
  'days': 14,
  'caseload': 12,
  'withReadings': 0,
  'withoutReadings': 12,
  'readings': 0,
  'inRange': 0,
  'lows': <Object>[],
  'lowsTotal': 0,
  'highs': <Object>[],
  'highsTotal': 0,
});

Hba1cControl busyHba1c() => Hba1cControl.fromJson({
  'days': 180,
  'unit': '%',
  'target': {'default': 7, 'poorControl': 9, 'individual': true},
  'caseload': 142,
  'withResult': 118,
  'atTarget': 64,
  'aboveTarget': 40,
  'poorControl': 14,
  'above': [
    {'patientId': 'p1', 'name': 'Farida Begum', 'percentage': 11.2, 'target': 7, 'testedOn': _daysAgo(40), 'poorControl': true},
    {'patientId': 'p2', 'name': 'Gopal Krishna Bhattacharya', 'percentage': 9.4, 'target': 7, 'testedOn': _daysAgo(62), 'poorControl': true},
    {'patientId': 'p29', 'name': 'Bina Paul', 'percentage': 8.3, 'target': 8, 'testedOn': _daysAgo(20), 'poorControl': false},
  ],
  'aboveTotal': 54,
  'untested': [
    {'patientId': 'p30', 'name': 'Sukumar Nandi', 'lastTestedOn': null, 'lastPercentage': null},
    {'patientId': 'p31', 'name': 'Rekha Dasgupta', 'lastTestedOn': _daysAgo(260), 'lastPercentage': 8.8},
  ],
  'untestedTotal': 24,
});

FollowUps quietFollowUps() => FollowUps.fromJson({
  'days': 7,
  'overdue': <Object>[],
  'overdueTotal': 0,
  'due': <Object>[],
  'dueTotal': 0,
});

ChatSummaryDay quietConversations() => ChatSummaryDay.fromJson({
  'day': '${_now.year}-${_now.month}-${_now.day}',
  'scope': 'mine',
  'kind': 'care',
  'counts': {'patients': 0, 'needsDoctor': 0, 'reviewed': 0},
  'items': <Object>[],
});
