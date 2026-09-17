// Shared scaffolding for the patient-app preview renders.
//
// Not a test on its own (no `_test` suffix): the preview tests import it. It
// pumps the real router and the real screens with every provider that would
// reach the network overridden by fixtures, at phone size, and writes what was
// drawn to build/ui_previews/patient/<name>.png so the screen can be looked at
// rather than inferred from an analyzer that cannot see layout.

import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:medpin/core/router/app_router.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/appointments/domain/appointment.dart';
import 'package:medpin/features/appointments/presentation/appointment_providers.dart';
import 'package:medpin/features/auth/data/auth_repository.dart';
import 'package:medpin/features/auth/domain/user.dart';
import 'package:medpin/features/auth/presentation/auth_controller.dart';
import 'package:medpin/features/chat/data/chat_repository.dart';
import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/thread_group.dart';
import 'package:medpin/features/chat/presentation/chat_controller.dart';
import 'package:medpin/features/chat/presentation/nutrition_chat_screen.dart';
import 'package:medpin/features/foodlog/domain/food_log.dart';
import 'package:medpin/features/foodlog/presentation/food_log_providers.dart';
import 'package:medpin/features/glucose/domain/glucose_trends.dart';
import 'package:medpin/features/glucose/presentation/glucose_providers.dart';
import 'package:medpin/features/home/domain/care_summary.dart';
import 'package:medpin/features/home/presentation/home_providers.dart';
import 'package:medpin/features/medications/data/medications_repository.dart';
import 'package:medpin/features/shell/presentation/care_access.dart';
import 'package:medpin/features/shell/presentation/load_stamps.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/features/labtests/domain/lab_tests.dart';
import 'package:medpin/features/labtests/presentation/lab_tests_providers.dart';
import 'package:medpin/features/medications/domain/medication.dart';
import 'package:medpin/features/medications/presentation/medications_providers.dart';
import 'package:medpin/features/prescriptions/data/prescriptions_repository.dart';
import 'package:medpin/features/prescriptions/domain/patient_prescription.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:medpin/shared/data/upload_repository.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// What the phone actually renders at: app.dart scales every screen's text by
/// 0.87 of the system setting, so a phone at its default size draws at this.
const double kPhoneTextScale = 0.87;

/// One notch above the default, which is what a patient who turns the text up
/// asks for. Rendered unclamped here, so a layout that only survives because
/// app.dart caps the scale is caught rather than hidden.
const double kLargeTextScale = 1.3;

final GlobalKey previewBoundaryKey = GlobalKey(debugLabel: 'preview');

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/// Inter, the Material icons, and a face for Bengali and Hindi.
///
/// Inter carries neither Indic script; on the phone those glyphs fall back to
/// the system's Noto Sans Bengali / Devanagari. Nirmala UI, which Windows
/// ships, covers both and stands in for it here — without it every Bengali
/// word renders as a row of boxes and the render proves nothing.
Future<void> loadPreviewFonts() async {
  final inter = FontLoader('Inter')
    ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
  await inter.load();

  final iconFile = File(
    r'C:\flutter\bin\cache\artifacts\material_fonts\materialicons-regular.otf',
  );
  if (iconFile.existsSync()) {
    final icons = FontLoader('MaterialIcons')
      ..addFont(
        Future.value(ByteData.view(iconFile.readAsBytesSync().buffer)),
      );
    await icons.load();
  }

  for (final path in [r'C:\Windows\Fonts\Nirmala.ttf']) {
    final file = File(path);
    if (!file.existsSync()) continue;
    final indic = FontLoader(kIndicFallback)
      ..addFont(Future.value(ByteData.view(file.readAsBytesSync().buffer)));
    await indic.load();
  }
}

const String kIndicFallback = 'PreviewIndic';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _NoAuthRepository implements AuthRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The profile the Health details form loads.
class FakeProfileRepository implements AuthRepository {
  @override
  Future<Map<String, dynamic>> getProfile() async => {
    'heightCm': 168,
    'chiefComplaint': 'Sugar high in the evenings',
    'allergies': ['Penicillin'],
    'diagnosedOn': '2019-03-01',
    'emergencyContact': {
      'name': 'Mita Das',
      'phone': '+919830098300',
      'relation': 'Mother',
    },
  };

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A store whose token read never answers, so the real controller's bootstrap
/// never overwrites the signed-in state the preview sets.
class _SilentStore extends SecureStore {
  @override
  Future<String?> readAccessToken() => Completer<String?>().future;
}

class FakeAuthController extends AuthController {
  FakeAuthController(AppUser user) : super(_NoAuthRepository(), _SilentStore()) {
    state = AuthState.authenticated(user);
  }
}

class _NoChatRepository implements ChatRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _NoUploadRepository implements UploadRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The chat controller holding a fixed conversation, and never polling.
class FakeChatController extends ChatController {
  FakeChatController(ChatState initial)
    : super(_NoChatRepository(), _NoUploadRepository()) {
    state = initial;
  }

  @override
  Future<void> resumeLatest() async {}

  @override
  Future<void> pollForUpdates() async {}
}

/// Answers the local-notification and reminder channels the way a working
/// phone would: permissions granted, and [armedReminders] medicine alarms
/// pending (zero draws the "reminders are off" card).
void mockPlatformChannels({int armedReminders = 40}) {
  // The plugin registrant does not run under test, so the platform half of
  // local notifications is registered by hand and its channel answered below.
  AndroidFlutterLocalNotificationsPlugin.registerWith();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  for (final name in [
    'dexterous.com/flutter/local_notifications',
    'clinq/reminders',
    'plugins.it_nomads.com/flutter_secure_storage',
  ]) {
    messenger.setMockMethodCallHandler(MethodChannel(name), (call) async {
      switch (call.method) {
        case 'pendingNotificationRequests':
          return [
            for (var i = 0; i < armedReminders; i++)
              <String, Object?>{
                'id': 700000 + i,
                'title': 'Medicine',
                'body': null,
                'payload': null,
              },
          ];
        case 'getActiveNotifications':
          return <Object?>[];
        case 'initialize':
        case 'areNotificationsEnabled':
        case 'canScheduleExactNotifications':
        case 'requestNotificationsPermission':
        case 'requestExactAlarmsPermission':
        case 'isIgnoringBatteryOptimizations':
          return true;
      }
      return null;
    });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

DateTime get _now => DateTime.now();
DateTime _today(int h, int m) => DateTime(_now.year, _now.month, _now.day, h, m);
String _iso(DateTime d) => d.toUtc().toIso8601String();

const patientUser = AppUser(
  id: 'u-rahul',
  name: 'Rahul Das',
  phone: '+919830012345',
  role: 'patient',
  language: 'en',
  gender: 'male',
);

/// A patient with a real day: three doses today (one taken late), a diet plan,
/// meals logged, readings across a month with a gap, a lab HbA1c on file.
CareSummary typicalCare({bool household = false}) => CareSummary.fromJson({
  'profile': {
    'diabetesType': 'type2',
    'heightCm': 168,
    'weightKg': 72.5,
    'bmi': 25.7,
    'bloodPressure': {'systolic': 132, 'diastolic': 84, 'isHigh': false},
    'allergies': ['Penicillin'],
    'reviewIntervalDays': 7,
  },
  'latestHba1c': {
    'percentage': 7.8,
    'testedOn': _iso(_now.subtract(const Duration(days: 19))),
    'isHigh': true,
  },
  'followUpOn': _iso(DateTime(_now.year, _now.month, _now.day + 8)),
  'dietPlan': {
    'goal': 'Keep to about 1,600 kcal a day, spread over five small meals.',
    'dieticianName': 'Romit Sen',
    'sharedAt': _iso(_now.subtract(const Duration(days: 3))),
    'meals': [
      {
        'name': 'Breakfast',
        'time': '8:00 AM',
        'items': ['2 moong dal chilla', 'Mint chutney', 'Tea without sugar'],
      },
      {
        'name': 'Mid-morning',
        'time': '11:00 AM',
        'items': ['1 guava', '6 almonds'],
      },
      {
        'name': 'Lunch',
        'time': '1:30 PM',
        'items': ['1 cup brown rice', 'Fish curry', 'Cucumber salad'],
      },
      {
        'name': 'Evening',
        'time': '5:00 PM',
        'items': ['Roasted chana', 'Buttermilk'],
      },
      {
        'name': 'Dinner',
        'time': '8:30 PM',
        'items': ['2 rotis', 'Mixed vegetable', 'Dal'],
      },
    ],
    'avoid': ['Sweets', 'Fried snacks', 'Sugary drinks'],
  },
  'recentFoodLogs': [
    {
      'id': 'f1',
      'mealType': 'lunch',
      'note': 'Rice, fish curry, salad',
      'createdAt': _iso(_today(13, 40)),
    },
    {
      'id': 'f2',
      'mealType': 'breakfast',
      'note': 'Two chillas and tea',
      'createdAt': _iso(_today(8, 20)),
    },
    {
      'id': 'f3',
      'mealType': 'dinner',
      'note': 'Rotis and dal',
      'createdAt': _iso(_now.subtract(const Duration(days: 1, hours: 2))),
    },
  ],
  'homeCards': const <String>[],
  'people':
      household
          ? [
            {
              'id': 'p-rahul',
              'name': 'Rahul Das',
              'relationship': 'self',
              'isSelf': true,
            },
            {
              'id': 'p-mita',
              'name': 'Mita Das',
              'relationship': 'parent',
              'isSelf': false,
            },
          ]
          : const [],
});

/// Nobody has recorded anything yet.
CareSummary newPatientCare() =>
    CareSummary.fromJson({'profile': const <String, dynamic>{}});

TodaySchedule typicalToday() => TodaySchedule.fromJson({
  'date': _today(0, 0).toIso8601String().substring(0, 10),
  'slots': [
    {
      'medicationId': 'm-metformin',
      'name': 'Metformin 500 mg',
      'dose': '1 tablet',
      'time': '08:00',
      'relationToMeal': 'after_meal',
      'status': 'taken',
      'scheduledFor': _iso(_today(8, 0)),
    },
    {
      'medicationId': 'm-atorva',
      'name': 'Atorvastatin 10 mg',
      'dose': '1 tablet',
      'time': '09:00',
      'relationToMeal': 'anytime',
      'status': 'taken',
      'late': true,
      'scheduledFor': _iso(_today(9, 0)),
    },
    {
      'medicationId': 'm-glimepiride',
      'name': 'Glimepiride 1 mg',
      'dose': '1 tablet',
      'time': '13:30',
      'relationToMeal': 'before_meal',
      'status': 'missed',
      'scheduledFor': _iso(_today(13, 30)),
    },
    {
      'medicationId': 'm-metformin',
      'name': 'Metformin 500 mg',
      'dose': '1 tablet',
      'time': '20:30',
      'relationToMeal': 'after_meal',
      'status': 'pending',
      'scheduledFor': _iso(_today(20, 30)),
    },
  ],
});

/// Two doses: one whose time has just come, one later, so the first carries
/// the filled button.
TodaySchedule dueNowToday() {
  final n = DateTime.now();
  final past = n.subtract(const Duration(minutes: 20));
  final soon = n.add(const Duration(hours: 3));
  String hhmm(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  return TodaySchedule.fromJson({
    'date': n.toIso8601String().substring(0, 10),
    'slots': [
      {
        'medicationId': 'm-metformin',
        'name': 'Metformin 500 mg',
        'dose': '1 tablet',
        'time': hhmm(past),
        'relationToMeal': 'after_meal',
        'status': 'pending',
        'scheduledFor': _iso(past),
      },
      {
        'medicationId': 'm-glimepiride',
        'name': 'Glimepiride 1 mg',
        'dose': '1 tablet',
        'time': hhmm(soon),
        'relationToMeal': 'before_meal',
        'status': 'pending',
        'scheduledFor': _iso(soon),
      },
    ],
  });
}

TodaySchedule longNameToday() => TodaySchedule.fromJson({
  'date': _today(0, 0).toIso8601String().substring(0, 10),
  'slots': [
    {
      'medicationId': 'm-long',
      'name':
          'Glimepiride 2 mg + Metformin 1000 mg Extended Release (Gluconorm G2 Forte)',
      'dose': '1 tablet, crushed and mixed with water',
      'time': '08:00',
      'relationToMeal': 'before_meal',
      'status': 'taken',
      'late': true,
      'scheduledFor': _iso(_today(8, 0)),
    },
    {
      'medicationId': 'm-long2',
      'name': 'Insulin Glargine 100 IU/ml (Basalog One Prefilled Pen)',
      'dose': '18 units under the skin of the abdomen',
      'time': '21:30',
      'relationToMeal': 'anytime',
      'status': 'pending',
      'scheduledFor': _iso(_today(21, 30)),
    },
  ],
});

List<Medication> longNameMeds() => [
  Medication.fromJson(
    _med(
      'm-long',
      'Glimepiride + Metformin Extended Release (Gluconorm G2 Forte)',
      '2 mg + 1000 mg',
      [
        ['08:00', 'before_meal'],
        ['20:00', 'before_meal'],
      ],
      instructions:
          'Swallow whole. Do not chew. If you feel shaky or sweaty, eat something sweet and call the clinic.',
    ),
  ),
  Medication.fromJson(
    _med('m-long2', 'Insulin Glargine (Basalog One Prefilled Pen)', '100 IU/ml', [
      ['21:30', 'anytime'],
    ]),
  ),
];

List<Appointment> longNameAppointments() => [
  Appointment.fromJson({
    'id': 'a1',
    'status': 'confirmed',
    'mode': 'in_clinic',
    'durationMinutes': 15,
    'scheduledFor': _iso(DateTime(_now.year, _now.month, _now.day + 1, 18, 45)),
    'doctorName': 'Dr. Anindita Bandyopadhyay Chattopadhyay',
    'doctorSpecialty': 'Endocrinology and Diabetes Care',
    'createdAt': _iso(_now.subtract(const Duration(days: 2))),
  }),
];

TodaySchedule emptyToday() => TodaySchedule.fromJson({
  'date': _today(0, 0).toIso8601String().substring(0, 10),
  'slots': const [],
});

Map<String, dynamic> _med(
  String id,
  String name,
  String strength,
  List<List<String>> times, {
  String prescriptionState = 'active',
  String takingState = 'taking',
  String? instructions,
  Map<String, dynamic>? extra,
}) => {
  'id': id,
  'name': name,
  'form': 'tablet',
  'strength': strength,
  'dose': '1 tablet',
  'schedule': [
    for (final t in times) {'time': t[0], 'relationToMeal': t[1]},
  ],
  'daysOfWeek': const [],
  'isActive': prescriptionState == 'active' && takingState == 'taking',
  'startDate': _iso(_now.subtract(const Duration(days: 40))),
  'prescriptionState': prescriptionState,
  'takingState': takingState,
  'ownedBy': 'practice',
  'instructions': instructions,
  ...?extra,
};

List<Medication> typicalMeds() => [
  Medication.fromJson(
    _med(
      'm-metformin',
      'Metformin',
      '500 mg',
      [
        ['08:00', 'after_meal'],
        ['20:30', 'after_meal'],
      ],
      instructions: 'Take with food.',
    ),
  ),
  Medication.fromJson(
    _med('m-glimepiride', 'Glimepiride', '1 mg', [
      ['13:30', 'before_meal'],
    ]),
  ),
  Medication.fromJson(
    _med(
      'm-atorva',
      'Atorvastatin',
      '10 mg',
      [
        ['09:00', 'anytime'],
      ],
      extra: {
        'alsoOnList': [
          {'id': 'm-atorva-20', 'strength': '20 mg', 'samePractice': false},
        ],
      },
    ),
  ),
];

/// The active three, plus one the patient stopped and two that have ended.
List<Medication> allMedsWithHistory() => [
  ...typicalMeds(),
  Medication.fromJson(
    _med(
      'm-vitd',
      'Vitamin D3',
      '60000 IU',
      [
        ['09:00', 'after_meal'],
      ],
      takingState: 'stopped_by_patient',
      extra: {
        'stoppedTaking': {
          'at': _iso(_now.subtract(const Duration(days: 6))),
          'reason': 'Ran out',
        },
      },
    ),
  ),
  Medication.fromJson(
    _med(
      'm-amox',
      'Amoxicillin',
      '500 mg',
      [
        ['08:00', 'after_meal'],
        ['20:00', 'after_meal'],
      ],
      prescriptionState: 'completed',
      extra: {'completedAt': _iso(_now.subtract(const Duration(days: 12)))},
    ),
  ),
  Medication.fromJson(
    _med(
      'm-teneli',
      'Teneligliptin',
      '20 mg',
      [
        ['08:00', 'before_meal'],
      ],
      prescriptionState: 'stopped_by_doctor',
      extra: {
        'stoppedByDoctor': {
          'at': _iso(_now.subtract(const Duration(days: 30))),
          'reason': 'Replaced by glimepiride',
        },
      },
    ),
  ),
];

final mealTimes = (breakfast: '08:00', lunch: '13:30', dinner: '20:30');

/// A month of readings with a four-day gap in the middle, and one high.
GlucoseTrends typicalTrends({int days = 30}) {
  final series = <Map<String, dynamic>>[];
  for (var d = days - 1; d >= 0; d--) {
    // Nothing logged on days 12–15 before today: the gap the chart must not
    // draw as a fall to zero.
    if (d >= 12 && d <= 15) continue;
    if (d % 2 == 1 && d > 3) continue;
    final day = DateTime(_now.year, _now.month, _now.day - d, 8, 10);
    final fasting = 118 + (d * 7) % 41;
    series.add({
      'at': _iso(day),
      'value': fasting,
      'flag': fasting > 130 ? 'high' : 'in_range',
      'context': 'fasting',
    });
    if (d % 3 == 0) {
      final post = d == 6 ? 262 : 168 + (d * 11) % 30;
      series.add({
        'at': _iso(day.add(const Duration(hours: 6))),
        'value': post,
        'flag': post > 250 ? 'very_high' : (post > 180 ? 'high' : 'in_range'),
        'context': 'post_meal',
      });
    }
  }
  final values = series.map((s) => s['value'] as num).toList();
  final avg = values.reduce((a, b) => a + b) / values.length;
  return GlucoseTrends.fromJson({
    'days': days,
    'count': series.length,
    'series': series,
    'stats': {
      'average': avg,
      'min': values.reduce((a, b) => a < b ? a : b),
      'max': values.reduce((a, b) => a > b ? a : b),
      'timeInRangePercent': 62,
      'estimatedHba1c': 7.1,
    },
  });
}

GlucoseTrends emptyTrends({int days = 30}) => GlucoseTrends.fromJson({
  'days': days,
  'count': 0,
  'series': const [],
  'stats': const <String, dynamic>{},
});

List<Appointment> typicalAppointments() => [
  Appointment.fromJson({
    'id': 'a1',
    'status': 'confirmed',
    'mode': 'in_clinic',
    'durationMinutes': 15,
    'scheduledFor': _iso(
      DateTime(_now.year, _now.month, _now.day + 8, 10, 30),
    ),
    'doctorName': 'Dr. Amit Kumar Dey',
    'doctorSpecialty': 'Diabetology',
    'createdAt': _iso(_now.subtract(const Duration(days: 2))),
  }),
  Appointment.fromJson({
    'id': 'a2',
    'status': 'requested',
    'mode': 'teleconsult',
    'durationMinutes': 15,
    'preferredFor': _iso(DateTime(_now.year, _now.month, _now.day + 2)),
    'createdAt': _iso(_now.subtract(const Duration(hours: 5))),
  }),
];

LabTestsView typicalLabTests() => LabTestsView.fromJson({
  'advised': ['HbA1c', 'Lipid profile', 'Kidney function test'],
  'advisedStatus': [
    {'name': 'HbA1c', 'reported': true},
    {'name': 'Lipid profile', 'reported': true},
    {'name': 'Kidney function test', 'reported': false},
  ],
  'results': [
    {
      'id': 'r1',
      'testName': 'Lipid profile',
      'note': '',
      'createdAt': _iso(_now.subtract(const Duration(minutes: 3))),
      'mimeType': 'application/pdf',
      'originalName': 'Lipid_profile_Sept.pdf',
      'sizeBytes': 184000,
      'photoUrl': '/api/v1/uploads/r1/raw',
      'analysis': {'status': 'pending'},
    },
    {
      'id': 'r2',
      'testName': 'HbA1c',
      'note': '',
      'createdAt': _iso(_now.subtract(const Duration(days: 19))),
      'mimeType': 'application/pdf',
      'originalName': 'HbA1c_report.pdf',
      'sizeBytes': 96000,
      'photoUrl': '/api/v1/uploads/r2/raw',
      'analysis': {
        'status': 'done',
        'summary': 'HbA1c 7.8% — above the usual target of 7%.',
        'abnormal': ['HbA1c'],
      },
    },
    {
      'id': 'r3',
      'testName': 'Thyroid profile',
      'note': 'Photo of the printout',
      'createdAt': _iso(_now.subtract(const Duration(days: 40))),
      'mimeType': 'application/pdf',
      'originalName': 'thyroid.pdf',
      'photoUrl': '/api/v1/uploads/r3/raw',
      'analysis': {
        'status': 'failed',
        'summary': 'The photo was too blurred to read. Your doctor can still open it.',
      },
    },
  ],
});

List<PatientPrescription> typicalPrescriptions() => [
  PatientPrescription.fromJson({
    'id': 'rx1',
    'referenceNo': 'RX-2026-0918',
    'pdfUrl': '/api/v1/patients/me/prescriptions/rx1/pdf',
    'issuedOn': _iso(_now.subtract(const Duration(days: 19))),
    'doctorName': 'Dr. Amit Kumar Dey',
    'complaint': 'Tiredness after meals, sugar high in the evenings.',
    'diagnosis': ['Type 2 Diabetes Mellitus', 'Dyslipidaemia'],
    'items': [
      {
        'name': 'Metformin',
        'strength': '500 mg',
        'frequency': 'Twice a day',
        'relationToMeal': 'after_meal',
        'durationDays': 90,
      },
      {
        'name': 'Glimepiride',
        'strength': '1 mg',
        'frequency': 'Once a day',
        'relationToMeal': 'before_meal',
        'durationDays': 90,
      },
    ],
    'labTestsAdvised': ['HbA1c', 'Lipid profile', 'Kidney function test'],
    'generalAdvice': 'Walk 30 minutes after dinner. Check fasting sugar twice a week.',
    'followUpOn': _iso(DateTime(_now.year, _now.month, _now.day + 8)),
  }),
  PatientPrescription.fromJson({
    'id': 'rx0',
    'referenceNo': 'RX-2026-0611',
    'pdfUrl': '/api/v1/patients/me/prescriptions/rx0/pdf',
    'issuedOn': _iso(_now.subtract(const Duration(days: 96))),
    'doctorName': 'Dr. Amit Kumar Dey',
    'diagnosis': ['Type 2 Diabetes Mellitus'],
    'items': [
      {'name': 'Metformin', 'strength': '500 mg', 'frequency': 'Twice a day'},
    ],
  }),
];

List<FoodLogEntry> typicalFoodLog() => [
  for (final (i, type, note, ago) in [
    (1, 'lunch', 'Brown rice, fish curry and cucumber salad', 0),
    (2, 'breakfast', 'Two moong dal chillas, tea without sugar', 0),
    (3, 'dinner', 'Two rotis, dal and mixed vegetables', 1),
    (4, 'snack', 'A guava', 1),
    (5, 'lunch', 'Rice, chicken curry — a bigger portion than usual', 2),
  ])
    FoodLogEntry.fromJson({
      'id': 'fl$i',
      'mealType': type,
      'note': note,
      'createdAt': _iso(
        _now.subtract(Duration(days: ago, hours: i * 3)),
      ),
    }),
];

ChatMessage chatMsg(
  String id,
  String role,
  String content, {
  required DateTime at,
  String? senderName,
  String? senderRole,
  String urgency = 'routine',
  bool pinned = false,
  DateTime? seenByClinicAt,
  List<Map<String, dynamic>>? attachments,
}) => ChatMessage.fromJson({
  'id': id,
  'seq': 1,
  'role': role,
  'content': content,
  'language': 'en',
  'urgency': urgency,
  'createdAt': _iso(at),
  'senderName': senderName,
  'senderRole': senderRole,
  'pinned': pinned,
  'seenByClinicAt': seenByClinicAt == null ? null : _iso(seenByClinicAt),
  'attachments': attachments,
});

/// A conversation with the assistant, the doctor and the desk in it.
ChatState typicalChat() {
  final y = _now.subtract(const Duration(days: 1));
  DateTime at(DateTime d, int h, int m) => DateTime(d.year, d.month, d.day, h, m);
  return ChatState(
    sessionId: 's1',
    messages: [
      chatMsg(
        'c1',
        'user',
        'My fasting sugar was 168 this morning. Is that too high?',
        at: at(y, 9, 12),
        seenByClinicAt: at(y, 9, 40),
      ),
      chatMsg(
        'c2',
        'assistant',
        'A fasting reading of **168 mg/dL** is above the usual target of 80–130.\n\n'
            '- Take your medicines as prescribed\n'
            '- Log another fasting reading tomorrow\n\n'
            'I have shared this with your clinic.',
        at: at(y, 9, 12),
      ),
      chatMsg(
        'c3',
        'clinician',
        'Rahul, please continue metformin after dinner and send me your readings for three days.',
        at: at(y, 11, 5),
        senderName: 'Dr. Amit Kumar Dey',
        senderRole: 'doctor',
        pinned: true,
      ),
      chatMsg(
        'c4',
        'clinician',
        'Your appointment is confirmed for next Thursday at 10:30 AM.',
        at: at(_now, 10, 2),
        senderName: 'Priya Sharma',
        senderRole: 'staff',
      ),
      chatMsg(
        'c5',
        'user',
        '',
        at: at(_now, 10, 20),
        attachments: [
          {
            'id': 'v1',
            'url': '/api/v1/uploads/v1/raw',
            'kind': 'voice_note',
            'mimeType': 'audio/mpeg',
            'transcript': 'Thank you, I will come on Thursday.',
          },
        ],
      ),
      chatMsg(
        'c6',
        'user',
        'Here is my lipid report.',
        at: at(_now, 10, 24),
        attachments: [
          {
            'id': 'd1',
            'url': '/api/v1/uploads/d1/raw',
            'kind': 'lab_report',
            'mimeType': 'application/pdf',
            'name': 'Lipid_profile_Sept.pdf',
            'sizeBytes': 184000,
          },
        ],
      ),
    ],
  );
}

// ---------------------------------------------------------------------------
// Pumping and capturing
// ---------------------------------------------------------------------------

/// A repository whose dose writes fail, for the "not saved" state.
class FailingDoseRepository implements MedicationsRepository {
  int attempts = 0;

  @override
  Future<void> logDose({
    required String medicationId,
    required DateTime scheduledFor,
    required String status,
    num? unitsAdministered,
    String? injectionSite,
    String? skipReason,
  }) async {
    attempts++;
    throw const ApiException(
      code: 'NETWORK_ERROR',
      message: 'No connection.',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Answers once, then fails every refresh — the "stale" state: last-known data
/// on screen, and a refresh that did not arrive.
Future<T> Function() failAfterFirst<T>(T value) {
  var calls = 0;
  return () async {
    calls++;
    if (calls > 1) throw Exception('offline');
    return value;
  };
}

/// Everything the patient screens read, answered from fixtures.
List<Override> patientOverrides({
  CareSummary? care,
  Object? careError,
  bool careLoading = false,
  bool careFailsOnRefresh = false,
  TodaySchedule? today,
  Object? todayError,
  bool todayLoading = false,
  bool todayFailsOnRefresh = false,
  List<Medication>? meds,
  Object? medsError,
  bool medsLoading = false,
  bool medsFailsOnRefresh = false,
  List<Medication>? allMeds,
  GlucoseTrends? trends,
  Object? trendsError,
  List<Appointment>? appointments,
  LabTestsView? labTests,
  Object? labTestsError,
  List<PatientPrescription>? prescriptions,
  Object? prescriptionsError,
  List<FoodLogEntry>? foodLog,
  Object? foodLogError,
  ChatState? chat,
  bool enrolled = true,
  MedicationsRepository? medicationsRepository,
  AppUser user = patientUser,
}) {
  Future<T> answer<T>(T? value, Object? error, {bool loading = false}) {
    if (loading) return Completer<T>().future;
    if (error != null) return Future<T>.error(error);
    return Future<T>.value(value as T);
  }

  // Stamped as the real providers stamp themselves, so a stale notice has a
  // real time to show.
  final careOnce = failAfterFirst(care ?? typicalCare());
  final todayOnce = failAfterFirst(today ?? typicalToday());
  final medsOnce = failAfterFirst(meds ?? typicalMeds());

  final t = trends ?? typicalTrends();
  return [
    authControllerProvider.overrideWith((ref) => FakeAuthController(user)),
    authRepositoryProvider.overrideWithValue(FakeProfileRepository()),
    imageAuthHeaderProvider.overrideWith((ref) async => const {}),
    patientEnrolmentsProvider.overrideWith(
      (ref) async =>
          enrolled
              ? const [PatientEnrolment(id: 'e1', practiceId: 'p1')]
              : const <PatientEnrolment>[],
    ),
    if (enrolled)
      careContactProvider.overrideWith(
        (ref) async => const CareContact(
          practiceName: 'Salt Lake Diabetes Care',
          phone: '+913324001234',
        ),
      ),
    careSummaryProvider.overrideWith((ref) async {
      if (careFailsOnRefresh) {
        final v = await careOnce();
        LoadStamps.mark(LoadStamps.careSummary);
        return v;
      }
      return answer(care ?? typicalCare(), careError, loading: careLoading);
    }),
    todayScheduleProvider.overrideWith((ref) async {
      if (todayFailsOnRefresh) {
        final v = await todayOnce();
        LoadStamps.mark(LoadStamps.todaySchedule);
        return v;
      }
      return answer(today ?? typicalToday(), todayError, loading: todayLoading);
    }),
    medicationsListProvider.overrideWith((ref) async {
      if (medsFailsOnRefresh) {
        final v = await medsOnce();
        LoadStamps.mark(LoadStamps.medications);
        return v;
      }
      return answer(meds ?? typicalMeds(), medsError, loading: medsLoading);
    }),
    allMedicationsProvider.overrideWith(
      (ref) async => allMeds ?? meds ?? typicalMeds(),
    ),
    if (medicationsRepository != null)
      medicationsRepositoryProvider.overrideWithValue(medicationsRepository),
    mealTimesProvider.overrideWith((ref) async => mealTimes),
    medicationAdherenceProvider.overrideWith(
      (ref) async => MedicationAdherence.fromJson(const {}),
    ),
    glucoseTrendsProvider.overrideWith((ref) => answer(t, trendsError)),
    glucoseTrendsRangeProvider.overrideWith(
      (ref, range) => answer(
        trends == null ? typicalTrends(days: range.days) : t,
        trendsError,
      ),
    ),
    appointmentDiaryProvider.overrideWith(
      (ref, q) async => Paged<Appointment>(
        items: appointments ?? typicalAppointments(),
        page: 1,
        limit: 100,
        total: (appointments ?? typicalAppointments()).length,
        hasMore: false,
      ),
    ),
    myAppointmentsProvider.overrideWith(
      (ref) async => appointments ?? typicalAppointments(),
    ),
    latestClinicMessageProvider.overrideWith((ref) async {
      final c = chat ?? typicalChat();
      final clinic = c.messages.where((m) => m.isClinician).toList();
      return clinic.isEmpty ? null : clinic.last;
    }),
    labTestsProvider.overrideWith(
      (ref) => answer(labTests ?? typicalLabTests(), labTestsError),
    ),
    patientPrescriptionsProvider.overrideWith(
      (ref) => answer(
        prescriptions ?? typicalPrescriptions(),
        prescriptionsError,
      ),
    ),
    foodLogProvider.overrideWith(
      (ref) => answer(foodLog ?? typicalFoodLog(), foodLogError),
    ),
    threadListProvider.overrideWith(
      (ref) async => const ThreadList(
        groups: [
          ThreadGroup(
            practiceName: 'Salt Lake Diabetes Care',
            enrollmentId: 'e1',
            threads: [ChatThread(id: 's1')],
          ),
        ],
      ),
    ),
    chatControllerProvider.overrideWith(
      (ref) => FakeChatController(chat ?? typicalChat()),
    ),
    nutritionThreadProvider.overrideWith(
      (ref) async => (
        items: typicalNutritionThread(),
        dietician: const DieticianFace(
          name: 'Romit Sen',
          avatarUrl: null,
          assigned: true,
        ),
      ),
    ),
    doseHistoryProvider.overrideWith((ref, days) async => typicalDoseHistory()),
  ];
}

List<ChatMessage> typicalNutritionThread() {
  final y = _now.subtract(const Duration(days: 1));
  DateTime at(DateTime d, int h, int m) => DateTime(d.year, d.month, d.day, h, m);
  return [
    chatMsg(
      'n1',
      'user',
      'I had two rotis and dal for dinner. Is rice better at lunch?',
      at: at(y, 21, 4),
    ),
    chatMsg(
      'n2',
      'dietician',
      'Rice at lunch is fine — keep it to one cup, with plenty of vegetables.',
      at: at(y, 21, 30),
      senderName: 'Romit Sen',
      senderRole: 'dietician',
    ),
    chatMsg(
      'n3',
      'assistant',
      'Your plan allows **1 cup of brown rice** at lunch.',
      at: at(_now, 9, 10),
    ),
  ];
}

List<DoseHistoryEntry> typicalDoseHistory() => [
  for (final (i, name, time, status, late) in [
    (0, 'Metformin', '08:00', 'taken', false),
    (0, 'Atorvastatin', '09:00', 'taken', true),
    (0, 'Glimepiride', '13:30', 'missed', false),
    (1, 'Metformin', '20:30', 'taken', false),
    (1, 'Glimepiride', '13:30', 'skipped', false),
    (1, 'Metformin', '08:00', 'taken', false),
  ])
    DoseHistoryEntry.fromJson({
      'medicationId': 'm-$name',
      'name': name,
      'strength': switch (name) { 'Metformin' => '500 mg', 'Atorvastatin' => '10 mg', _ => '1 mg' },
      'time': time,
      'status': status,
      'late': late,
      'scheduledFor': _iso(
        DateTime(
          _now.year,
          _now.month,
          _now.day - i,
          int.parse(time.substring(0, 2)),
          int.parse(time.substring(3)),
        ),
      ),
      'takenAt':
          status == 'taken'
              ? _iso(
                DateTime(
                  _now.year,
                  _now.month,
                  _now.day - i,
                  int.parse(time.substring(0, 2)) + (late ? 3 : 0),
                  int.parse(time.substring(3)),
                ),
              )
              : null,
    }),
];

/// Pumps the real router at [location], inside the real patient shell, the
/// way app.dart builds it: the app theme, the three locales, and app.dart's
/// own text scaling.
Future<ProviderContainer> pumpPatientApp(
  WidgetTester tester, {
  required String location,
  required List<Override> overrides,
  Locale locale = const Locale('en'),
  double textScale = kPhoneTextScale,
  Size size = const Size(360, 780),
  int frames = 12,
  int armedReminders = 40,
}) async {
  SharedPreferences.setMockInitialValues({
    'akd_language_code': locale.languageCode,
    // The one-time reliability sheet would open over whatever is being
    // previewed. It has its own preview; here it is already answered.
    'akd_reminder_setup_done': true,
  });
  final prefs = await SharedPreferences.getInstance();
  mockPlatformChannels(armedReminders: armedReminders);

  tester.view.physicalSize = Size(size.width * 3, size.height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  // A layout error taken with takeException() loses the widget that caused
  // it, so its source line is printed here, where the details still exist.
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    final text = details.toString();
    final where = RegExp(r'file:///\S*lib/\S+').firstMatch(text)?.group(0);
    // ignore: avoid_print
    print('PREVIEW ERROR: ${details.exceptionAsString()} at ${where ?? '?'}');
    previous?.call(details);
  };
  addTearDown(() => FlutterError.onError = previous);

  final container = ProviderContainer(
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs), ...overrides],
  );
  addTearDown(container.dispose);

  final GoRouter router = container.read(appRouterProvider);
  final theme = withIndicFallback(AppTheme.light());

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        theme: theme,
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        routerConfig: router,
        builder:
            (context, child) => RepaintBoundary(
              key: previewBoundaryKey,
              child: MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(textScale)),
                child: DefaultTextStyle.merge(
                  style: const TextStyle(fontFamilyFallback: [kIndicFallback]),
                  child: child ?? const SizedBox.shrink(),
                ),
              ),
            ),
      ),
    ),
  );
  await tester.pump();
  router.go(location);
  await settle(tester, frames: frames);
  return container;
}

/// A fixed number of frames rather than pumpAndSettle: the chat composer and
/// the generating bubble animate for as long as they are on screen.
Future<void> settle(WidgetTester tester, {int frames = 12}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

/// The app theme, with the Indic stand-in face added as a fallback wherever
/// the theme sets a text style of its own.
///
/// A phone falls back to its system Bengali and Devanagari faces for any glyph
/// Inter lacks. The test engine has no system faces, so a button label whose
/// style comes from the theme — and so never meets the page's default style —
/// drew blank in Hindi. This is the preview's problem, not the app's.
ThemeData withIndicFallback(ThemeData t) {
  const fallback = [kIndicFallback];
  TextStyle? fb(TextStyle? s) => s?.copyWith(fontFamilyFallback: fallback);
  ButtonStyle? button(ButtonStyle? style) {
    final text = style?.textStyle;
    if (style == null || text == null) return style;
    return style.copyWith(
      textStyle: WidgetStateProperty.resolveWith((st) => fb(text.resolve(st))),
    );
  }

  return t.copyWith(
    textTheme: t.textTheme.apply(fontFamilyFallback: fallback),
    primaryTextTheme: t.primaryTextTheme.apply(fontFamilyFallback: fallback),
    filledButtonTheme: FilledButtonThemeData(
      style: button(t.filledButtonTheme.style),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: button(t.outlinedButtonTheme.style),
    ),
    textButtonTheme: TextButtonThemeData(style: button(t.textButtonTheme.style)),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: button(t.elevatedButtonTheme.style),
    ),
    chipTheme: t.chipTheme.copyWith(
      labelStyle: fb(t.chipTheme.labelStyle),
      secondaryLabelStyle: fb(t.chipTheme.secondaryLabelStyle),
    ),
    appBarTheme: t.appBarTheme.copyWith(
      titleTextStyle: fb(t.appBarTheme.titleTextStyle),
    ),
    inputDecorationTheme: t.inputDecorationTheme.copyWith(
      labelStyle: fb(t.inputDecorationTheme.labelStyle),
      hintStyle: fb(t.inputDecorationTheme.hintStyle),
    ),
  );
}

/// Writes what the boundary drew to build/ui_previews/patient/[name].png.
Future<void> capture(WidgetTester tester, String name) async {
  // Asset images decode off the fake clock; give them a real moment first.
  await tester.runAsync(() async {
    for (final element in find.byType(Image).evaluate()) {
      final image = (element.widget as Image).image;
      if (image is AssetImage) {
        await precacheImage(image, element, onError: (_, _) {});
      }
    }
  });
  await tester.pump(const Duration(milliseconds: 50));

  final boundary =
      previewBoundaryKey.currentContext!.findRenderObject()!
          as RenderRepaintBoundary;
  await tester.runAsync(() async {
    const ratio = 2.0;
    final image = await boundary.toImage(pixelRatio: ratio);
    final dir = Directory('build/ui_previews/patient');
    dir.createSync(recursive: true);

    Future<void> write(ui.Image img, String file) async {
      final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
      File('${dir.path}/$file.png').writeAsBytesSync(bytes!.buffer.asUint8List());
    }

    // A whole page in one image is unreadable once it is downscaled to fit a
    // viewer, so anything taller than a phone is cut into phone-height slices
    // that overlap a little, the way it is actually read: a screen at a time.
    const slice = 780 * ratio;
    const overlap = 60 * ratio;
    if (image.height <= slice + overlap) {
      await write(image, name);
      return;
    }
    var top = 0.0;
    var part = 1;
    while (top < image.height) {
      final height = (image.height - top).clamp(0, slice).toDouble();
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawImageRect(
        image,
        Rect.fromLTWH(0, top, image.width.toDouble(), height),
        Rect.fromLTWH(0, 0, image.width.toDouble(), height),
        Paint(),
      );
      final piece = await recorder.endRecording().toImage(
        image.width,
        height.round(),
      );
      await write(piece, '${name}_$part');
      if (top + height >= image.height) break;
      top += slice - overlap;
      part++;
    }
  });
}

/// Unmounts the app so the screens' poll timers are cancelled before the test
/// framework checks for pending timers.
Future<void> unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(seconds: 1));
}
