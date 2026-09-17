import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/appointments/data/clinic_repository.dart';
import 'package:medpin/features/appointments/domain/appointment.dart';
import 'package:medpin/features/appointments/domain/clinic.dart';
import 'package:medpin/features/appointments/domain/doctor_hours.dart';
import 'package:medpin/features/appointments/presentation/doctor_hours_screen.dart';
import 'package:medpin/features/appointments/presentation/widgets/still_booked_dialog.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A doctor's own hours at a location, as the desk sets them.
///
/// Every doctor at a location had the building's hours, because nothing in the
/// app — or the API — could say otherwise. The screen lists each doctor with the
/// hours they are booked in there, lets a desk that runs the location change
/// them, and says so when the same doctor already sits elsewhere at those hours.

const _clinic = Clinic(
  id: 'c1',
  name: 'Salt Lake Clinic',
  slotMinutes: 15,
  weeklyHours: [WeeklyHour(dayOfWeek: 1, start: '09:00', end: '21:00')],
);

const _monWed = [
  WeeklyHour(dayOfWeek: 1, start: '09:00', end: '13:00'),
  WeeklyHour(dayOfWeek: 3, start: '09:00', end: '13:00'),
];

class _FakeClinics implements ClinicRepository {
  _FakeClinics({this.managedByYou = true});

  final bool managedByYou;
  final saved = <({String doctorId, int slotMinutes, List<WeeklyHour> weeklyHours})>[];
  final givenBack = <String>[];

  @override
  Future<LocationHours> doctorHours(String clinicId) async => LocationHours(
    location: _clinic,
    managedByYou: managedByYou,
    doctors: const [
      DoctorHours(doctorId: 'd1', doctorName: 'Dr Sen', usesLocationHours: true),
      DoctorHours(
        doctorId: 'd2',
        doctorName: 'Dr Roy',
        specialty: 'Cardiology',
        usesLocationHours: false,
        slotMinutes: 30,
        weeklyHours: _monWed,
      ),
      DoctorHours(doctorId: 'd3', doctorName: 'Dr Das', usesLocationHours: false, slotMinutes: 15),
    ],
  );

  @override
  Future<({DoctorHours hours, List<HoursOverlap> overlaps})> setDoctorHours(
    String clinicId,
    String doctorId, {
    required int slotMinutes,
    required List<WeeklyHour> weeklyHours,
  }) async {
    saved.add((doctorId: doctorId, slotMinutes: slotMinutes, weeklyHours: weeklyHours));
    return (
      hours: DoctorHours(
        doctorId: doctorId,
        doctorName: 'Dr Roy',
        usesLocationHours: false,
        slotMinutes: slotMinutes,
        weeklyHours: weeklyHours,
      ),
      overlaps: const [HoursOverlap(locationName: 'Behala Clinic', dayOfWeek: 1, start: '10:00', end: '12:00')],
    );
  }

  @override
  Future<void> useLocationHours(String clinicId, String doctorId) async => givenBack.add(doctorId);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Widget _app(Widget home, ClinicRepository repo) => ProviderScope(
  overrides: [clinicRepositoryProvider.overrideWithValue(repo)],
  child: MaterialApp(
    theme: AppTheme.light(),
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  ),
);

void main() {
  setUpAll(() async {
    final inter = FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  testWidgets('each doctor is shown with the hours they are booked in here, in words', (tester) async {
    phone(tester);
    await tester.pumpWidget(_app(const DoctorHoursScreen(clinic: _clinic), _FakeClinics()));
    await tester.pumpAndSettle();

    expect(find.text('Clinic’s hours'), findsOneWidget);
    expect(find.text('Mon 09:00–13:00 · Wed 09:00–13:00 · 30 min'), findsOneWidget);
    expect(find.text('Not at this clinic'), findsOneWidget);
    expect(find.textContaining('View only'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a desk that does not run the clinic reads the hours and cannot open them', (tester) async {
    phone(tester);
    await tester.pumpWidget(_app(const DoctorHoursScreen(clinic: _clinic), _FakeClinics(managedByYou: false)));
    await tester.pumpAndSettle();

    expect(find.textContaining('View only'), findsOneWidget);
    await tester.tap(find.text('Dr Roy'));
    await tester.pumpAndSettle();
    expect(find.byType(DoctorHoursEditor), findsNothing);
  });

  testWidgets('changing a doctor’s sittings saves them, and says where the same hours are kept elsewhere', (
    tester,
  ) async {
    phone(tester);
    final repo = _FakeClinics();
    await tester.pumpWidget(_app(const DoctorHoursScreen(clinic: _clinic), repo));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Dr Roy'));
    await tester.pumpAndSettle();
    expect(find.byType(DoctorHoursEditor), findsOneWidget);

    // Wednesday is removed; Monday stays.
    await tester.tap(find.byTooltip('Remove Wednesday 09:00–13:00'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Save hours'), 200);
    await tester.tap(find.text('Save hours'));
    await tester.pumpAndSettle();

    expect(repo.saved, hasLength(1));
    expect(repo.saved.single.doctorId, 'd2');
    expect(repo.saved.single.slotMinutes, 30);
    expect(repo.saved.single.weeklyHours.map((w) => '${w.dayOfWeek} ${w.start}-${w.end}'), ['1 09:00-13:00']);
    expect(find.textContaining('Behala Clinic, Monday 10:00–12:00'), findsOneWidget);
  });

  testWidgets('a doctor with own hours can be given the clinic’s back', (tester) async {
    phone(tester);
    final repo = _FakeClinics();
    await tester.pumpWidget(_app(const DoctorHoursEditor(clinic: _clinic, hours: DoctorHours(
      doctorId: 'd2',
      doctorName: 'Dr Roy',
      usesLocationHours: false,
      slotMinutes: 30,
      weeklyHours: _monWed,
    )), repo));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(find.text('Use the clinic’s hours instead'), 200);
    await tester.tap(find.text('Use the clinic’s hours instead'));
    await tester.pumpAndSettle();
    expect(repo.givenBack, ['d2']);
  });

  testWidgets('closing a clinic shows who is still booked there', (tester) async {
    phone(tester);
    final still = StillBooked(
      total: 10,
      items: [
        for (var i = 0; i < 9; i++)
          Appointment(
            id: 'a$i',
            status: 'confirmed',
            mode: 'in_clinic',
            patientName: 'Patient $i',
            doctorName: 'Dr Sen',
            scheduledFor: DateTime(2026, 9, 21, 10, i),
          ),
      ],
    );

    await tester.pumpWidget(
      _app(
        Builder(
          builder:
              (context) => Scaffold(
                body: Center(
                  child: ElevatedButton(
                    onPressed: () => showStillBooked(context, 'Salt Lake Clinic', still),
                    child: const Text('close'),
                  ),
                ),
              ),
        ),
        _FakeClinics(),
      ),
    );
    await tester.tap(find.text('close'));
    await tester.pumpAndSettle();

    expect(find.text('10 appointments still booked'), findsOneWidget);
    expect(find.textContaining('Patient 0'), findsOneWidget);
    expect(find.textContaining('Patient 8'), findsNothing, reason: 'the list is shortened, and says so');
    expect(find.text('and 2 more'), findsOneWidget);
  });
}
