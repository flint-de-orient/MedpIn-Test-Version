import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/appointments/data/appointment_repository.dart';
import 'package:akd_care/features/appointments/data/clinic_repository.dart';
import 'package:akd_care/features/appointments/domain/appointment.dart';
import 'package:akd_care/features/appointments/domain/clinic.dart';
import 'package:akd_care/features/appointments/presentation/appointment_providers.dart';
import 'package:akd_care/features/appointments/presentation/widgets/appointment_time_picker.dart';
import 'package:akd_care/features/clinician/presentation/appointments_admin_screen.dart';
import 'package:akd_care/features/staff/presentation/widgets/request_card.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Giving an appointment a time, and moving one, as the desk does it.
///
/// "Move to another time" did nothing: the move ran on the context of the sheet
/// it was chosen from, which had closed by the time the locations loaded, so it
/// returned without a word. And location was treated as required — a practice
/// with no location was told to add one before it could give a patient a time.
/// Location is optional: none is a day and a time chosen freely, one is not a
/// question, and only two or more are.

/// Tomorrow at [hour], local.
DateTime _tomorrowAt(int hour) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day + 1, hour);
}

Clinic _clinic(String id, String name, {bool active = true, bool? managed}) =>
    Clinic(id: id, name: name, isActive: active, managedByYou: managed);

class _FakeClinics implements ClinicRepository {
  _FakeClinics(this.clinics, {this.delay = Duration.zero});

  final List<Clinic> clinics;
  final Duration delay;

  @override
  Future<List<Clinic>> list() async {
    await Future<void>.delayed(delay);
    return clinics;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAppointments implements AppointmentRepository {
  final rescheduled = <({String id, String iso, String? clinicId})>[];
  final confirmed = <({String id, String? clinicId, DateTime at})>[];

  @override
  Future<Appointment> reschedule(
    String id,
    String scheduledForIso, {
    String? clinicId,
  }) async {
    rescheduled.add((id: id, iso: scheduledForIso, clinicId: clinicId));
    return Appointment(
      id: 'moved-$id',
      status: 'confirmed',
      mode: 'in_clinic',
      scheduledFor: DateTime.parse(scheduledForIso).toLocal(),
    );
  }

  @override
  Future<Appointment> confirmRequest(
    String id, {
    required String? clinicId,
    required DateTime scheduledFor,
    bool allowSameDay = false,
  }) async {
    confirmed.add((id: id, clinicId: clinicId, at: scheduledFor));
    return Appointment(
      id: id,
      status: 'confirmed',
      mode: 'in_clinic',
      scheduledFor: scheduledFor,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

Paged<Appointment> _paged(List<Appointment> items) =>
    Paged(items: items, page: 1, limit: 100, total: items.length, hasMore: false);

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

/// A button that asks [pickAppointmentTime] and keeps what it answered.
class _PickHarness extends ConsumerWidget {
  const _PickHarness({required this.onPicked, this.preferClinicId});

  final void Function(PickedTime?) onPicked;
  final String? preferClinicId;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    body: Center(
      child: ElevatedButton(
        onPressed:
            () async => onPicked(
              await pickAppointmentTime(
                context,
                ref,
                initialDay: _tomorrowAt(0),
                preferClinicId: preferClinicId,
              ),
            ),
        child: const Text('pick'),
      ),
    ),
  );
}

void main() {
  // The app's own face, so text is laid out with real glyph widths rather than
  // the test font's full-em boxes.
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

  group('"Move to another time" on the appointments screen', () {
    final booked = Appointment(
      id: 'a1',
      status: 'confirmed',
      mode: 'in_clinic',
      scheduledFor: _tomorrowAt(10),
      patientId: 'p1',
      patientName: 'Rahul Bose',
      clinicId: 'c1',
      clinicName: 'Salt Lake Clinic',
    );

    testWidgets('opens the picker and moves it, however long the locations take to load', (
      tester,
    ) async {
      phone(tester);
      final appointments = _FakeAppointments();

      await tester.pumpWidget(
        _app(const AppointmentsAdminScreen(), [
          _slots,
          appointmentRepositoryProvider.overrideWithValue(appointments),
          // Slower than the sheet takes to close — the ordinary case on a
          // phone, and the one that killed the move.
          clinicRepositoryProvider.overrideWithValue(
            _FakeClinics([
              _clinic('c1', 'Salt Lake Clinic', managed: true),
            ], delay: const Duration(seconds: 2)),
          ),
          appointmentDiaryProvider.overrideWith(
            (ref, q) async => _paged(q.status == null ? [booked] : const []),
          ),
        ]),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Move to another time'));

      // The sheet has gone; the locations have not arrived.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('Move to another time'), findsNothing);

      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(
        find.text('11:00'),
        findsOneWidget,
        reason: 'the picker never opened: the move did nothing',
      );

      await tester.tap(find.text('11:00'));
      await tester.pumpAndSettle();

      expect(appointments.rescheduled, hasLength(1));
      final moved = appointments.rescheduled.single;
      expect(moved.id, 'a1');
      expect(DateTime.parse(moved.iso), _tomorrowAt(11).toUtc());
      expect(moved.clinicId, isNull, reason: 'same location, so nothing to move it to');
      expect(find.textContaining('Moved to'), findsOneWidget);

      // Takes the screen's refresh timer down with it.
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('the picker asks only what the locations make a question', () {
    Future<PickedTime?> pickWith(
      WidgetTester tester,
      List<Clinic> clinics, {
      String? preferClinicId,
      Future<void> Function()? interact,
    }) async {
      phone(tester);
      PickedTime? result;
      var answered = false;
      await tester.pumpWidget(
        _app(
          _PickHarness(
            preferClinicId: preferClinicId,
            onPicked: (p) {
              answered = true;
              result = p;
            },
          ),
          [_slots, clinicRepositoryProvider.overrideWithValue(_FakeClinics(clinics))],
        ),
      );
      await tester.tap(find.text('pick'));
      await tester.pumpAndSettle();
      if (interact != null) await interact();
      if (!answered) {
        // Dismiss whatever is open, so the harness answers.
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
      }
      return result;
    }

    testWidgets('no open location: a day and a time, with no location in the answer', (
      tester,
    ) async {
      final picked = await pickWith(
        tester,
        // A closed location is no location.
        [_clinic('c1', 'Closed Clinic', active: false, managed: true)],
        interact: () async {
          expect(
            find.text('No clinic has published hours, so choose the day and the time yourself.'),
            findsOneWidget,
          );
          expect(find.byType(ChoiceChip), findsNothing);
          expect(find.textContaining('Add one'), findsNothing, reason: 'sent to create a location');

          await tester.tap(find.text('Pick a time'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('OK'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Use this time'));
          await tester.pumpAndSettle();
        },
      );

      expect(picked, isNotNull);
      expect(picked!.clinic, isNull);
      expect(picked.at, _tomorrowAt(10));
    });

    testWidgets('one location: its free slots, and nothing to choose between', (tester) async {
      final picked = await pickWith(
        tester,
        [_clinic('c1', 'Salt Lake Clinic', managed: true)],
        interact: () async {
          expect(find.byType(ChoiceChip), findsNothing);
          expect(find.text('Salt Lake Clinic'), findsOneWidget);
          await tester.tap(find.text('11:00'));
          await tester.pumpAndSettle();
        },
      );
      expect(picked?.clinic?.id, 'c1');
    });

    testWidgets('several: the choice, opening on the location it is already at', (tester) async {
      await pickWith(
        tester,
        [
          _clinic('c1', 'Salt Lake Clinic', managed: true),
          _clinic('c2', 'Behala Clinic', managed: true),
        ],
        preferClinicId: 'c2',
        interact: () async {
          expect(find.byType(ChoiceChip), findsNWidgets(2));
          final behala = tester.widget<ChoiceChip>(
            find.widgetWithText(ChoiceChip, 'Behala Clinic'),
          );
          expect(behala.selected, isTrue);
        },
      );
    });

    testWidgets('a location the reader does not run is not offered, so one of two is not a question', (
      tester,
    ) async {
      await pickWith(
        tester,
        [
          _clinic('c1', 'Salt Lake Clinic', managed: true),
          _clinic('c2', 'Behala Clinic', managed: false),
        ],
        interact: () async {
          expect(find.byType(ChoiceChip), findsNothing);
          expect(find.text('Behala Clinic'), findsNothing);
        },
      );
    });

    testWidgets('every open location somebody else’s: says so, and opens nothing', (tester) async {
      final picked = await pickWith(
        tester,
        [_clinic('c2', 'Behala Clinic', managed: false)],
        interact: () async {
          expect(find.text('None of the open clinics is one you manage.'), findsOneWidget);
          expect(find.byType(SlotPicker), findsNothing);
          expect(find.byType(FreeTimePicker), findsNothing);
        },
      );
      expect(picked, isNull);
    });
  });

  testWidgets('the desk gives a request a time at a practice with no location', (tester) async {
    phone(tester);
    final appointments = _FakeAppointments();
    final request = Appointment(
      id: 'r1',
      status: 'requested',
      mode: 'in_clinic',
      preferredFor: _tomorrowAt(0),
      patientName: 'Mira Das',
    );

    await tester.pumpWidget(
      _app(
        Scaffold(body: RequestCard(appointment: request, onConfirmed: () async {})),
        [
          appointmentRepositoryProvider.overrideWithValue(appointments),
          clinicRepositoryProvider.overrideWithValue(_FakeClinics(const [])),
        ],
      ),
    );

    await tester.tap(find.text('Schedule'));
    await tester.pumpAndSettle();
    expect(find.text('No active clinic to book into. Add one in Profile.'), findsNothing);

    await tester.tap(find.text('Pick a time'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use this time'));
    await tester.pumpAndSettle();

    expect(appointments.confirmed, hasLength(1));
    expect(appointments.confirmed.single.clinicId, isNull);
    expect(appointments.confirmed.single.at, _tomorrowAt(10));
  });
}
