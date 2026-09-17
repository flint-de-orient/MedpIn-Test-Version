import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/appointments/domain/appointment.dart';
import 'package:medpin/features/appointments/domain/clinic.dart';
import 'package:medpin/features/appointments/presentation/appointment_providers.dart';
import 'package:medpin/features/appointments/presentation/book_appointment_screen.dart';
import 'package:medpin/features/appointments/presentation/my_appointments_screen.dart';
import 'package:medpin/features/clinician/presentation/clinics_screen.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Where a patient books, and the list the practice manages its locations in.
///
/// A practice with no location showed its patients "No available times on this
/// day" about a day nobody had chosen; one with a single location asked them to
/// choose it; the patient's Reschedule was drawn on appointments it could never
/// move; and the clinics list said a location was needed "to start taking
/// bookings", and offered to create one to people who may not.

/// Tomorrow at [hour], local.
DateTime _tomorrowAt(int hour) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day + 1, hour);
}

Clinic _clinic(String id, String name, {bool active = true, bool? managed}) =>
    Clinic(id: id, name: name, isActive: active, managedByYou: managed);

/// Every location has one free slot, tomorrow at eleven.
final _slots = slotDayProvider.overrideWith(
  (ref, args) async => SlotDay(
    clinicId: args.clinicId,
    date: args.date,
    slotMinutes: 30,
    slots: [
      Slot(
        time: '11:00',
        iso: _tomorrowAt(11).toUtc().toIso8601String(),
        available: true,
      ),
    ],
  ),
);

Widget _app(Widget home, List<Override> overrides) => ProviderScope(
  overrides: [
    imageAuthHeaderProvider.overrideWith((ref) async => const <String, String>{}),
    ...overrides,
  ],
  child: MaterialApp(
    theme: AppTheme.light(),
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  ),
);

void main() {
  // The app's own face, so text is laid out with real glyph widths rather than
  // the test font's full-em boxes — which is also what shows a row overflowing
  // at the width it would on a phone.
  setUpAll(() async {
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  group('the patient', () {
    testWidgets('is offered Reschedule only where moving it can work', (tester) async {
      phone(tester);
      final atClinic = Appointment(
        id: 'a1',
        status: 'confirmed',
        mode: 'in_clinic',
        scheduledFor: _tomorrowAt(10),
        clinicId: 'c1',
        clinicName: 'Salt Lake Clinic',
      );
      final request = Appointment(
        id: 'a2',
        status: 'requested',
        mode: 'in_clinic',
        preferredFor: _tomorrowAt(0),
      );
      final atNoLocation = Appointment(
        id: 'a3',
        status: 'confirmed',
        mode: 'in_clinic',
        scheduledFor: _tomorrowAt(15),
      );

      expect(canPatientReschedule(atClinic), isTrue);
      expect(canPatientReschedule(request), isFalse);
      expect(canPatientReschedule(atNoLocation), isFalse);

      await tester.pumpWidget(
        _app(const MyAppointmentsScreen(), [
          myAppointmentsProvider.overrideWith((ref) async => [atClinic, request, atNoLocation]),
        ]),
      );
      await tester.pumpAndSettle();

      // Every row still cancels, and nothing on a 360-point card overflows —
      // an overflowing row of actions does not draw its last button.
      expect(find.text('Cancel appointment'), findsNWidgets(3));
      expect(find.text('Reschedule'), findsOneWidget, reason: 'a Reschedule that could not work was drawn');

      await tester.pumpWidget(const SizedBox());
    });

    Future<void> bookWith(WidgetTester tester, List<Clinic> clinics) async {
      phone(tester);
      await tester.pumpWidget(
        _app(const BookAppointmentScreen(), [
          _slots,
          clinicsProvider.overrideWith((ref) async => clinics),
        ]),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('at a practice with no location is pointed to asking, not to an empty day', (
      tester,
    ) async {
      await bookWith(tester, const []);
      expect(find.textContaining('does not take bookings in the app'), findsOneWidget);
      expect(find.text('Ask for an appointment'), findsOneWidget);
      expect(find.text('No available times on this day'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('at one location is not asked which', (tester) async {
      await bookWith(tester, [_clinic('c1', 'Salt Lake Clinic')]);
      expect(find.text('CHOOSE A CLINIC'), findsNothing);
      expect(find.byIcon(Icons.radio_button_checked_rounded), findsNothing);
      expect(find.text('Salt Lake Clinic'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('at two locations chooses between them', (tester) async {
      await bookWith(tester, [
        _clinic('c1', 'Salt Lake Clinic'),
        _clinic('c2', 'Behala Clinic'),
      ]);
      expect(find.text('CHOOSE A CLINIC'), findsOneWidget);
      expect(find.byIcon(Icons.radio_button_checked_rounded), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('the clinics list', () {
    Future<void> listWith(WidgetTester tester, List<Clinic> clinics) async {
      phone(tester);
      await tester.pumpWidget(
        _app(const ClinicsScreen(), [clinicsProvider.overrideWith((ref) async => clinics)]),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('with no location says it is optional, and still offers one', (tester) async {
      await listWith(tester, const []);
      expect(find.textContaining('Appointments work without one'), findsOneWidget);
      expect(find.text('Add a clinic to start taking bookings'), findsNothing);
      expect(find.text('Add clinic'), findsOneWidget);
    });

    testWidgets('for somebody narrowed to one location: the rest are view only, and nothing new is offered', (
      tester,
    ) async {
      await listWith(tester, [
        _clinic('c1', 'Salt Lake Clinic', managed: true),
        _clinic('c2', 'Behala Clinic', managed: false),
      ]);
      expect(find.text('View only'), findsOneWidget);
      expect(find.text('Add clinic'), findsNothing);
    });

    testWidgets('for somebody who runs them all: every one editable, and a new one offered', (
      tester,
    ) async {
      await listWith(tester, [
        _clinic('c1', 'Salt Lake Clinic', managed: true),
        _clinic('c2', 'Behala Clinic', managed: true),
      ]);
      expect(find.text('View only'), findsNothing);
      expect(find.text('Add clinic'), findsOneWidget);
    });
  });
}
