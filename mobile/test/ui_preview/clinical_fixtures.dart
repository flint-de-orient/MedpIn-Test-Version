import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/ecg_report.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/medications/domain/medication.dart';

/// Realistic patients, built from the JSON the server actually sends.
///
/// Through `fromJson` rather than constructors on purpose: the preview then
/// exercises the same parsing the phone does, so a field the screen expects
/// and the parser drops shows up here as a blank rather than being papered
/// over by a hand-built object.

DateTime _daysAgo(num d) =>
    DateTime.now().subtract(Duration(minutes: (d * 24 * 60).round()));
String _iso(DateTime d) => d.toUtc().toIso8601String();
String _ago(num d) => _iso(_daysAgo(d));

// ---- patient summaries ------------------------------------------------------

Map<String, dynamic> _glucoseDaily(List<int> averages) => {
  'daily': [
    for (var i = 0; i < averages.length; i++)
      {
        'date': _iso(_daysAgo(averages.length - 1 - i)).substring(0, 10),
        'average': averages[i],
        'min': averages[i] - 38,
        'max': averages[i] + 54,
        'count': 3,
      },
  ],
};

/// A type 2 diabetic with a lot on her record: rising HbA1c, patchy
/// adherence, an open alert, reports with values out of range.
PatientSummary diabetologyPatient({
  List<Object>? riskReasons,
}) => PatientSummary.fromJson({
  'patient': {
    'id': 'p-sunita',
    'name': 'Sunita Chakraborty',
    'phone': '+919830011122',
    'email': 'sunita.c@example.in',
    'gender': 'female',
    'age': 58,
    'address': '14/2 Lake Gardens, Kolkata 700045',
    'chiefComplaint':
        'Tingling and burning in both feet for three weeks, worse at night',
    'language': 'bn',
  },
  'details': {
    'diagnosedOn': _ago(365 * 9),
    'comorbidities': ['hypertension', 'retinopathy', 'dyslipidaemia'],
    'allergies': ['Sulfa drugs'],
    'footRiskCategory': 'moderate',
    'emergencyContact': {
      'name': 'Amit Chakraborty',
      'phone': '+919830099887',
      'relation': 'Son',
    },
  },
  'profile': {
    'diabetesType': 'type2',
    'riskBand': 'high',
    'riskScore': 72,
    'heightCm': 156,
    'lastRiskComputedAt': _ago(0.5),
    'lastFootScreeningAt': _ago(40),
    'lastEyeScreeningAt': _ago(400),
  },
  if (riskReasons != null) 'riskReasons': riskReasons,
  'healthScore': {'score': 54, 'band': 'needs_attention'},
  'trends': {
    ..._glucoseDaily([
      168,
      181,
      175,
      190,
      204,
      187,
      172,
      166,
      179,
      198,
      211,
      186,
      176,
      182,
    ]),
    'count': 41,
    'stats': {'average': 184, 'timeInRangePercent': 52, 'estimatedHba1c': 8.0},
  },
  'adherence': {
    'taken': 61,
    'expected': 88,
    'missed': 27,
    'percentage': 69,
    'perMedication': [
      {
        'name': 'Metformin 500 mg',
        'taken': 52,
        'expected': 58,
        'percentage': 90,
      },
      {
        'name': 'Glimepiride 2 mg',
        'taken': 9,
        'expected': 30,
        'percentage': 30,
      },
    ],
  },
  'medicationCount': 3,
  'lastFasting': {'value': 162, 'at': _ago(2)},
  'latestVitals': {
    'systolic': 148,
    'diastolic': 92,
    'pulse': 84,
    'spo2': 97,
    'weightKg': 71.5,
    'waistCm': 94,
    'at': _ago(9),
  },
  'hba1cHistory': [
    {'percentage': 8.4, 'testedOn': _ago(12)},
    {'percentage': 8.9, 'testedOn': _ago(100)},
    {'percentage': 9.6, 'testedOn': _ago(190)},
    {'percentage': 10.1, 'testedOn': _ago(280)},
    {'percentage': 9.2, 'testedOn': _ago(370)},
  ],
  'footAssessments': [
    {
      'id': 'f1',
      'assessedAt': _ago(40),
      'site': 'both',
      'finalRiskLevel': 'moderate',
    },
  ],
  'labResults': [
    {
      'id': 'lab1',
      'testName': 'HbA1c',
      'note': '',
      'photoUrl': null,
      'mimeType': 'application/pdf',
      'analysisStatus': 'done',
      'analytes': [
        {
          'code': 'hba1c',
          'label': 'HbA1c',
          'value': 8.4,
          'unit': '%',
          'refHigh': 5.7,
          'flag': 'high',
        },
      ],
      'createdAt': _ago(12),
    },
    {
      'id': 'lab2',
      'testName': 'Lipid Profile',
      'note': 'Fasting sample',
      'photoUrl': null,
      'mimeType': 'application/pdf',
      'analysisStatus': 'done',
      'analytes': [
        {
          'code': 'tchol',
          'label': 'Total cholesterol',
          'value': 224,
          'unit': 'mg/dL',
          'refHigh': 200,
          'flag': 'high',
        },
        {
          'code': 'ldl',
          'label': 'LDL',
          'value': 138,
          'unit': 'mg/dL',
          'refHigh': 100,
          'flag': 'high',
        },
        {
          'code': 'hdl',
          'label': 'HDL',
          'value': 44,
          'unit': 'mg/dL',
          'refLow': 40,
          'flag': 'normal',
        },
        {
          'code': 'tg',
          'label': 'Triglycerides',
          'value': 188,
          'unit': 'mg/dL',
          'refHigh': 150,
          'flag': 'high',
        },
      ],
      'createdAt': _ago(12),
    },
    {
      'id': 'lab3',
      'testName': 'Lipid Profile',
      'note': '',
      'photoUrl': null,
      'mimeType': 'application/pdf',
      'analysisStatus': 'done',
      'analytes': [
        {
          'code': 'ldl',
          'label': 'LDL',
          'value': 152,
          'unit': 'mg/dL',
          'refHigh': 100,
          'flag': 'high',
        },
      ],
      'createdAt': _ago(190),
    },
    {
      'id': 'lab4',
      'testName': 'Kidney Function Test',
      'note': '',
      'photoUrl': null,
      'mimeType': 'image/webp',
      'analysisStatus': 'failed',
      'analytes': [],
      'createdAt': _ago(30),
    },
  ],
  'labTestsAdvised': [
    'Lipid Profile',
    'Urine Microalbumin',
    'Kidney Function Test',
  ],
  'alerts': [
    {
      'id': 'a1',
      'severity': 'urgent',
      'type': 'hyperglycemia',
      'title': 'Glucose 312 mg/dL after dinner',
      'status': 'open',
      'createdAt': _ago(1.2),
    },
    {
      'id': 'a2',
      'severity': 'warning',
      'type': 'missed_medication',
      'title': 'Missed Glimepiride three days running',
      'status': 'resolved',
      'createdAt': _ago(20),
    },
  ],
  'aiContext':
      'Type 2 diabetes for 9 years. On metformin and glimepiride. Latest HbA1c 8.4%. '
      'Reports tingling in both feet.',
});

/// A cardiology patient: high blood pressure, a fast pulse, an abnormal ECG,
/// and an LDL well above the limit. No diabetes.
PatientSummary cardiologyPatient() => PatientSummary.fromJson({
  'patient': {
    'id': 'p-arjun',
    'name': 'Arjun Mehta',
    'phone': '+919830033344',
    'gender': 'male',
    'age': 64,
    'chiefComplaint': 'Breathless climbing stairs, palpitations since Sunday',
  },
  'details': {
    'comorbidities': ['cad', 'hypertension', 'dyslipidaemia'],
    'allergies': ['Aspirin', 'Penicillin'],
  },
  'profile': {
    'diabetesType': 'none',
    'riskBand': 'critical',
    'riskScore': 88,
    'heightCm': 172,
    'lastRiskComputedAt': _ago(0.1),
  },
  'healthScore': {'score': null, 'band': 'unknown'},
  'trends': {'daily': [], 'count': 0, 'stats': null},
  'adherence': {
    'taken': 40,
    'expected': 44,
    'missed': 4,
    'percentage': 91,
    'perMedication': [],
  },
  'medicationCount': 4,
  'lastFasting': null,
  'latestVitals': {
    'systolic': 168,
    'diastolic': 102,
    'pulse': 112,
    'spo2': 93,
    'weightKg': 84,
    'at': _ago(0.1),
  },
  'hba1cHistory': [],
  'labResults': [
    {
      'id': 'lab-c1',
      'testName': 'Lipid Profile',
      'note': '',
      'photoUrl': null,
      'mimeType': 'application/pdf',
      'analysisStatus': 'done',
      'analytes': [
        {
          'code': 'ldl',
          'label': 'LDL',
          'value': 171,
          'unit': 'mg/dL',
          'refHigh': 100,
          'flag': 'high',
        },
        {
          'code': 'hdl',
          'label': 'HDL',
          'value': 34,
          'unit': 'mg/dL',
          'refLow': 40,
          'flag': 'low',
        },
        {
          'code': 'tg',
          'label': 'Triglycerides',
          'value': 212,
          'unit': 'mg/dL',
          'refHigh': 150,
          'flag': 'high',
        },
      ],
      'createdAt': _ago(6),
    },
    {
      'id': 'lab-c2',
      'testName': 'Lipid Profile',
      'note': '',
      'photoUrl': null,
      'mimeType': 'application/pdf',
      'analysisStatus': 'done',
      'analytes': [
        {
          'code': 'ldl',
          'label': 'LDL',
          'value': 149,
          'unit': 'mg/dL',
          'refHigh': 100,
          'flag': 'high',
        },
      ],
      'createdAt': _ago(120),
    },
  ],
  'labTestsAdvised': ['Troponin I', 'Echocardiogram'],
  'alerts': [
    {
      'id': 'ca1',
      'severity': 'emergency',
      'type': 'vitals',
      'title': 'Blood pressure 168/102 with chest discomfort',
      'status': 'open',
      'createdAt': _ago(0.1),
    },
  ],
});

/// Registered at the desk this morning. Nothing measured, nothing prescribed.
PatientSummary newPatient() => PatientSummary.fromJson({
  'patient': {
    'id': 'p-priya',
    'name': 'Priya Sen',
    'phone': '+919830055566',
    'gender': 'female',
    'age': 34,
  },
  'details': <String, dynamic>{},
  'profile': null,
  'healthScore': {'score': null, 'band': 'unknown'},
  'trends': {'daily': [], 'count': 0, 'stats': null},
  'adherence': {
    'taken': 0,
    'expected': 0,
    'missed': 0,
    'percentage': null,
    'perMedication': [],
  },
  'medicationCount': 0,
  'lastFasting': null,
  'latestVitals': null,
  'hba1cHistory': [],
  'labResults': [],
  'labTestsAdvised': [],
  'alerts': [],
});

// ---- medicines ----------------------------------------------------------------

Medication _med(Map<String, dynamic> j) => Medication.fromJson(j);

List<Medication> diabetologyMedicines() => [
  _med({
    'id': 'm1',
    'name': 'Metformin',
    'strength': '500 mg',
    'form': 'tablet',
    'dose': '1 tablet',
    'schedule': [
      {'time': '08:30', 'relationToMeal': 'after_meal'},
      {'time': '20:30', 'relationToMeal': 'after_meal'},
    ],
    'isActive': true,
    'startDate': _ago(400),
    'changeableByYou': true,
  }),
  _med({
    'id': 'm2',
    'name': 'Telmisartan',
    'strength': '40 mg',
    'form': 'tablet',
    'dose': '1 tablet',
    'schedule': [
      {'time': '08:00', 'relationToMeal': 'any'},
    ],
    'isActive': true,
    'startDate': _ago(200),
    'changeableByYou': true,
    'alsoOnList': [
      {'id': 'm2b', 'strength': '20 mg', 'samePractice': false},
    ],
  }),
  _med({
    'id': 'm3',
    'name': 'Gluconorm G1',
    'strength': '500/50',
    'strengthExpected': '500/1 mg',
    'strengthComposition': 'Metformin 500 mg + Glimepiride 1 mg',
    'form': 'tablet',
    'dose': '1 tablet',
    'schedule': [
      {'time': '13:30', 'relationToMeal': 'before_meal'},
    ],
    'isActive': true,
    'startDate': _ago(30),
    'changeableByYou': false,
    'ownedBy': 'practice',
  }),
  _med({
    'id': 'm4',
    'name': 'Glimepiride',
    'strength': '2 mg',
    'form': 'tablet',
    'dose': '1 tablet',
    'schedule': [
      {'time': '08:00', 'relationToMeal': 'before_meal'},
    ],
    'isActive': false,
    'prescriptionState': 'active',
    'takingState': 'stopped_by_patient',
    'stoppedTaking': {
      'at': _ago(6),
      'reason': 'Felt dizzy and shaky in the mornings',
    },
    'startDate': _ago(90),
    'changeableByYou': true,
  }),
];

// ---- prescriptions ------------------------------------------------------------

PrescriptionSummary _rx(Map<String, dynamic> j) =>
    PrescriptionSummary.fromJson(j);

List<PrescriptionSummary> diabetologyPrescriptions() => [
  _rx({
    'id': 'rx3',
    'source': 'composed',
    'referenceNo': 'AKD-2026-000412',
    'issuedOn': _ago(12),
    'doctorName': 'Dr Anirban Dey',
    'complaint': 'Tingling in both feet',
    'diagnosis': [
      'Type 2 diabetes mellitus',
      'Hypertension',
      'Peripheral neuropathy',
    ],
    'items': [
      {
        'name': 'Metformin',
        'strength': '500 mg',
        'frequency': 'BD',
        'relationToMeal': 'after_meal',
        'durationDays': 90,
      },
      {
        'name': 'Telmisartan',
        'strength': '40 mg',
        'frequency': 'OD',
        'relationToMeal': 'any',
        'durationDays': 90,
      },
      {
        'name': 'Pregabalin',
        'strength': '75 mg',
        'frequency': 'HS',
        'relationToMeal': 'any',
        'durationDays': 30,
      },
    ],
    'labTestsAdvised': ['Lipid Profile', 'Urine Microalbumin'],
    'generalAdvice': 'Walk 30 minutes daily.\nInspect both feet every evening.',
    'followUpOn': _iso(_daysAgo(-18)),
    'isActive': true,
    'pdfUrl': '/api/v1/patients/p-sunita/prescriptions/rx3/pdf',
  }),
  _rx({
    'id': 'rx2',
    'source': 'scanned',
    'referenceNo': 'AKD-2026-000301',
    'issuedOn': _ago(100),
    'doctorName': 'Dr Anirban Dey',
    'uploadedByName': 'Rina Paul',
    'scanUrl': '/api/v1/uploads/scan1/raw',
    'scanMimeType': 'application/pdf',
    'diagnosis': [],
    'items': [],
    'labTestsAdvised': [],
    'isActive': false,
    'recordState': 'superseded',
    'endedReason': 'Replaced by the prescription of 4 Sep',
    'pdfUrl': '/api/v1/patients/p-sunita/prescriptions/rx2/pdf',
  }),
  _rx({
    'id': 'rx1',
    'source': 'composed',
    'referenceNo': 'AKD-2026-000188',
    'issuedOn': _ago(190),
    'doctorName': 'Dr Anirban Dey',
    'diagnosis': ['Type 2 diabetes mellitus'],
    'items': [
      {
        'name': 'Glimepiride',
        'strength': '2 mg',
        'frequency': 'OD',
        'relationToMeal': 'before_meal',
        'durationDays': 90,
      },
    ],
    'labTestsAdvised': ['HbA1c'],
    'isActive': false,
    'recordState': 'voided',
    'endedReason': 'Written for the wrong patient',
    'pdfUrl': '/api/v1/patients/p-sunita/prescriptions/rx1/pdf',
  }),
];

/// A long prescription: nine medicines, a diagnosis list and advice that runs
/// to several lines.
PrescriptionSummary longPrescription() => _rx({
  'id': 'rx-long',
  'source': 'composed',
  'referenceNo': 'AKD-2026-000499',
  'issuedOn': _ago(1),
  'doctorName': 'Dr Anirban Dey',
  'complaint':
      'Breathlessness on exertion, swelling of both ankles, poor sleep and '
      'frequent urination at night for a month',
  'diagnosis': [
    'Type 2 diabetes mellitus',
    'Hypertension',
    'Dyslipidaemia',
    'Diabetic peripheral neuropathy',
    'Chronic kidney disease, stage 3a',
  ],
  'items': [
    for (final (name, strength, freq) in const [
      ('Metformin', '1000 mg', 'BD'),
      ('Empagliflozin', '10 mg', 'OD'),
      ('Glimepiride', '2 mg', 'OD'),
      ('Telmisartan', '80 mg', 'OD'),
      ('Amlodipine', '5 mg', 'OD'),
      ('Atorvastatin', '40 mg', 'HS'),
      ('Pregabalin', '75 mg', 'HS'),
      ('Furosemide', '20 mg', 'OD'),
      ('Pantoprazole', '40 mg', 'OD'),
    ])
      {
        'name': name,
        'strength': strength,
        'frequency': freq,
        'relationToMeal': 'after_meal',
        'durationDays': 30,
      },
  ],
  'labTestsAdvised': [
    'HbA1c',
    'Kidney Function Test',
    'Lipid Profile',
    'Urine Microalbumin',
  ],
  'generalAdvice':
      'Restrict salt to under 5 g a day.\nWalk 30 minutes after dinner.\n'
      'Check feet every evening and report any cut or colour change.\n'
      'Weigh every morning and call if weight rises by 2 kg in 3 days.',
  'followUpOn': _iso(_daysAgo(-14)),
  'isActive': true,
  'recordState': 'current',
  'pdfUrl': '/api/v1/patients/p-sunita/prescriptions/rx-long/pdf',
});

// ---- ECGs ---------------------------------------------------------------------

List<EcgReport> cardiologyEcgs() => [
  EcgReport.fromJson({
    'id': 'e1',
    'recordedOn': _ago(0.2),
    'rhythm': 'atrial_fibrillation',
    'impression': 'abnormal',
    'heartRate': 118,
    'qrsDurationMs': 96,
    'qtcMs': 452,
    'findings':
        'Irregularly irregular rhythm, no P waves. Rate poorly controlled.',
    'readBy': 'Dr Kaushik Roy',
  }),
  EcgReport.fromJson({
    'id': 'e2',
    'recordedOn': _ago(130),
    'rhythm': 'sinus',
    'impression': 'borderline',
    'heartRate': 92,
    'prIntervalMs': 180,
    'findings': 'Left ventricular hypertrophy by voltage criteria.',
    'readBy': 'Dr Kaushik Roy',
  }),
];

// ---- the patient list -------------------------------------------------------

PatientListItem listItem(Map<String, dynamic> j) => PatientListItem.fromJson(j);

List<PatientListItem> caseload() => [
  listItem({
    'id': 'p-arjun',
    'name': 'Arjun Mehta',
    'phone': '+919830033344',
    'riskBand': 'critical',
    'riskScore': 88,
    'unreadCount': 3,
    'openAlertCount': 1,
    'lastMessage': {
      'preview':
          'Chest feels tight again since this morning, BP machine says 168/102',
      'role': 'user',
      'at': _ago(0.02),
      'urgency': 'emergency',
    },
  }),
  listItem({
    'id': 'p-sunita',
    'name': 'Sunita Chakraborty',
    'phone': '+919830011122',
    'riskBand': 'high',
    'riskScore': 72,
    'unreadCount': 1,
    'openAlertCount': 1,
    'lastReadingAt': _ago(0.4),
    'lastReadingValue': 312,
    'trend': 'up',
    'trendDelta': 24,
    'hba1c': 8.4,
    'hba1cAt': _ago(12),
    'lastMessage': {
      'preview': 'Sugar was 312 after dinner. Should I take an extra tablet?',
      'role': 'user',
      'at': _ago(0.3),
      'urgency': 'urgent',
      'mediaType': null,
    },
  }),
  listItem({
    'id': 'p-kamal',
    'name': 'Kamal Hossain',
    'phone': '+919830077788',
    'riskBand': 'moderate',
    'riskScore': 44,
    'unreadCount': 0,
    'lastReadingAt': _ago(9),
    'lastReadingValue': 142,
    'checkInOverdue': true,
    'lastMessage': {
      'preview': 'Report attached',
      'role': 'user',
      'at': _ago(1),
      'mediaType': 'pdf',
    },
  }),
  listItem({
    'id': 'p-meera',
    'name': 'Meera Bhattacharjee-Raychaudhuri',
    'phone': '+919830066655',
    'riskBand': 'low',
    'riskScore': 12,
    'unreadCount': 0,
    'lastReadingAt': _ago(1),
    'lastReadingValue': 118,
    'lastMessage': {
      'preview':
          'Take the evening dose after dinner, not before. See you on the 30th.',
      'role': 'clinician',
      'at': _ago(3),
    },
  }),
  listItem({
    'id': 'p-rahul',
    'name': 'Rahul Das',
    'phone': '+919830044433',
    'riskBand': 'low',
    'riskScore': 0,
    'unreadCount': 0,
    'lastMessage': {
      'preview': 'Your next reading is due tomorrow morning before breakfast.',
      'role': 'assistant',
      'at': _ago(12),
    },
  }),
  listItem({
    'id': 'p-priya',
    'name': 'Priya Sen',
    'phone': '+919830055566',
    'riskBand': 'low',
    'riskScore': 0,
  }),
  listItem({
    'id': 'p-long',
    'name': 'Venkata Satyanarayana Subrahmanyam Chakravarthy-Bandyopadhyay',
    'phone': '+919830022211',
    'riskBand': 'moderate',
    'riskScore': 38,
    'unreadCount': 128,
    'openAlertCount': 12,
    'checkInOverdue': true,
    'lastReadingAt': _ago(23),
    'lastReadingValue': 96,
    'lastMessage': {
      'preview':
          'Doctor, the swelling in my left ankle has not gone down after the new '
          'tablets, and I am also getting cramps at night in both calves.',
      'role': 'user',
      'at': _ago(2),
      'mediaType': 'voice',
    },
  }),
];

/// A long roll, in the server's inbox order: the unread first.
List<PatientListItem> manyPatients(int n) {
  const first = ['Aarav', 'Bina', 'Chandan', 'Deepa', 'Esha', 'Farhan', 'Gita'];
  const last = [
    'Basu',
    'Chatterjee',
    'Dutta',
    'Ghosh',
    'Kar',
    'Mitra',
    'Sarkar',
  ];
  const bands = ['low', 'low', 'moderate', 'low', 'high', 'low', 'critical'];
  return [
    for (var i = 0; i < n; i++)
      listItem({
        'id': 'p-many-$i',
        'name': '${first[i % first.length]} ${last[(i * 3) % last.length]}',
        'phone': '+91983000${(1000 + i).toString()}',
        'riskBand': bands[i % bands.length],
        'riskScore': 10 * (i % 8),
        'unreadCount': i < 6 ? (i % 3) + 1 : 0,
        'openAlertCount': i % 11 == 0 ? 1 : 0,
        'lastReadingAt': _ago(i % 15),
        'lastReadingValue': 110 + (i * 7) % 160,
        'lastMessage': {
          'preview': 'Reading taken before breakfast, as asked.',
          'role': i % 4 == 0 ? 'clinician' : 'user',
          'at': _ago(i / 5),
        },
      }),
  ];
}
