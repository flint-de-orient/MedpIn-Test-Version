import 'dart:async';

import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/features/appointments/domain/appointment.dart';
import 'package:akd_care/features/appointments/presentation/appointment_providers.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/domain/patient_registration.dart';
import 'package:akd_care/features/staff/domain/desk_day.dart';
import 'package:akd_care/features/staff/presentation/desk_providers.dart';
import 'package:akd_care/features/staff/presentation/staff_today_screen.dart';
import 'package:akd_care/features/staff/presentation/widgets/desk_sections.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:akd_care/shared/widgets/notification_list_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_preview/desk_fixtures.dart';
import 'ui_preview/preview_harness.dart';

/// The front desk's Today, held to what it promises.
///
/// The screen it replaced drew "0 Scheduled · 0 Waiting · 0 Freed up" and "No
/// appointments scheduled" while the diary was still loading and again when it
/// failed, so the desk could tell a patient there was no booking when the phone
/// had no signal. These pin the four states apart, the counts to their
/// sources, one filled button, and a failed refresh that keeps the day.
void main() {
  final now = DateTime(2026, 9, 17, 10, 0);

  Appointment at(
    String id,
    DateTime when, {
    String status = 'confirmed',
    int minutes = 15,
    int? token,
  }) => Appointment(
    id: id,
    scheduledFor: when,
    status: status,
    mode: 'in_clinic',
    durationMinutes: minutes,
    patientName: 'Patient $id',
    queueNumber: token,
  );

  group('DeskDay', () {
    test('counts only what happened, and never a request', () {
      final day = DeskDay.from([
        at('a', now.subtract(const Duration(hours: 2)), status: 'completed'),
        at('b', now.subtract(const Duration(hours: 1)), status: 'no_show'),
        at('c', now.add(const Duration(hours: 1)), status: 'cancelled'),
        at('d', now.add(const Duration(hours: 2))),
        const Appointment(id: 'r', status: 'requested', mode: 'in_clinic'),
      ], now: now);

      expect(day.booked, 3, reason: 'a cancellation is not a booking');
      expect(day.seen, 1);
      expect(day.didNotCome, 1);
      expect(day.cancelled, 1);
    });

    test('someone a few minutes late is still coming in; a slot that ended '
        'is not', () {
      final day = DeskDay.from([
        at('late', now.subtract(const Duration(minutes: 5))),
        at('gone', now.subtract(const Duration(minutes: 40))),
        at('later', now.add(const Duration(minutes: 30))),
        at('soon', now.add(const Duration(minutes: 10))),
      ], now: now);

      expect(day.comingIn.map((a) => a.id), ['late', 'soon', 'later']);
      expect(day.next?.id, 'late');
    });

    test('only confirmed bookings are expected; arrivals are in the clinic, '
        'the doctor’s patient first', () {
      final day = DeskDay.from([
        at('w1', now, status: 'checked_in', token: 14),
        at('w2', now, status: 'checked_in', token: 12),
        at('doc', now, status: 'in_consultation', token: 13),
        at('done', now, status: 'completed'),
      ], now: now);

      expect(day.comingIn, isEmpty);
      expect(day.inClinic.map((a) => a.id), ['doc', 'w2', 'w1']);
    });

    test('requests: the longest wait first', () {
      Appointment asked(String id, Duration ago) => Appointment(
        id: id,
        status: 'requested',
        mode: 'in_clinic',
        createdAt: now.subtract(ago),
      );
      final sorted = requestsLongestWaitingFirst([
        asked('new', const Duration(minutes: 5)),
        asked('old', const Duration(days: 3)),
        asked('mid', const Duration(hours: 4)),
      ]);
      expect(sorted.map((a) => a.id), ['old', 'mid', 'new']);
    });
  });

  group('DeskFeed', () {
    PanelNotification note(String id, String kind, String patient, int ago) =>
        PanelNotification(
          id: id,
          kind: kind,
          patientId: patient,
          patientName: 'Name $patient',
          text: 'text $id',
          at: now.subtract(Duration(minutes: ago)),
          unread: true,
        );

    test('one row per patient and thread, newest first, with how many', () {
      final feed = DeskFeed.from([
        note('1', 'message', 'p1', 30),
        note('2', 'message', 'p1', 5),
        note('3', 'nutrition', 'p1', 10),
        note('4', 'message', 'p2', 1),
        note('5', 'request', 'p3', 2),
        note('6', 'urgent', 'p4', 3),
      ]);

      expect(feed.urgent.map((i) => i.id), ['6']);
      expect(feed.threads.map((t) => '${t.patientId}/${t.nutrition}'), [
        'p2/false',
        'p1/false',
        'p1/true',
      ]);
      final p1 = feed.threads.firstWhere(
        (t) => t.patientId == 'p1' && !t.nutrition,
      );
      expect(p1.count, 2);
      expect(p1.latest, 'text 2', reason: 'the newest thing they wrote');
    });
  });

  group('the Today screen', () {
    setUpAll(loadPreviewFonts);

    const offline = ApiException(
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server',
    );

    Future<void> open(
      WidgetTester tester, {
      FutureOr<Paged<Appointment>> Function(AppointmentQuery q)? diary,
      FutureOr<DeskNotifications> Function()? feed,
      FutureOr<int> Function(AppointmentQuery q)? week,
      bool settle = true,
    }) async {
      usePhone(tester, height: 3000);
      await tester.pumpWidget(
        previewApp(
          overrides: [
            ...baseOverrides(),
            ...signedInAs(deskUser),
            brandClinicProvider.overrideWith((ref) async => deskClinic),
            pendingEnrolmentsProvider.overrideWith(
              (ref) async => const <PendingEnrolment>[],
            ),
            overviewProvider.overrideWith(
              (ref) async => overview(unread: 4, alerts: 1),
            ),
            appointmentDiaryProvider.overrideWith(
              (ref, q) async =>
                  diary != null
                      ? await diary(q)
                      : q.status == 'requested'
                      ? paged(waitingRequests())
                      : paged(busyDay()),
            ),
            clinicianNotificationsProvider.overrideWith(
              (ref) async =>
                  feed != null
                      ? await feed()
                      : busyNotifications(urgent: false),
            ),
            deskCountProvider.overrideWith(
              (ref, q) async => week != null ? await week(q) : 0,
            ),
          ],
          home: const StaffTodayScreen(),
        ),
      );
      if (settle) {
        await tester.pumpAndSettle();
      } else {
        await pumpFrames(tester);
      }
    }

    int filledButtons(WidgetTester tester) =>
        find.byType(FilledButton).evaluate().length;

    testWidgets('while loading it claims nothing about the day', (
      tester,
    ) async {
      await open(
        tester,
        diary: (q) => Completer<Paged<Appointment>>().future,
        feed: () => Completer<DeskNotifications>().future,
        week: (q) => Completer<int>().future,
        settle: false,
      );

      expect(find.text('Nothing booked today'), findsNothing);
      expect(find.textContaining('No urgent reports'), findsNothing);
      expect(find.text('0'), findsNothing);
      expect(find.byType(DeskLoadingCard), findsOneWidget);
    });

    testWidgets('when nothing arrives it says so once, and not that the day '
        'is empty', (tester) async {
      await open(
        tester,
        diary: (q) => throw offline,
        feed: () => throw offline,
        week: (q) => throw offline,
      );

      expect(find.text('Could not load today’s desk'), findsOneWidget);
      expect(find.textContaining('Could not load'), findsOneWidget);
      expect(find.text('Nothing booked today'), findsNothing);
      expect(find.textContaining('No urgent reports'), findsNothing);
    });

    testWidgets('a quiet day: said once, no zeros, no week card', (
      tester,
    ) async {
      await open(
        tester,
        diary: (q) => paged(const []),
        feed: () => quietNotifications,
      );

      expect(find.text('Nothing booked today'), findsOneWidget);
      expect(
        find.text(
          'No urgent reports, no one waiting for a time and no unread '
          'messages.',
        ),
        findsOneWidget,
      );
      expect(find.text('This week so far'), findsNothing);
      expect(find.text('0'), findsNothing);
      expect(find.textContaining('0 booked'), findsNothing);
    });

    testWidgets('one filled button: Register, until somebody is urgent', (
      tester,
    ) async {
      await open(tester);
      expect(filledButtons(tester), 1);
      expect(
        find.widgetWithText(FilledButton, 'Register patient'),
        findsOneWidget,
      );
    });

    testWidgets('with an urgent report, the conversation is the one filled '
        'button', (tester) async {
      await open(tester, feed: () => busyNotifications());
      expect(filledButtons(tester), 1);
      expect(
        find.widgetWithText(FilledButton, 'Open conversation'),
        findsOneWidget,
      );
      expect(
        find.widgetWithText(OutlinedButton, 'Register patient'),
        findsOneWidget,
      );
      expect(find.text('Needs attention now'), findsOneWidget);
    });

    testWidgets('counts come from their sources', (tester) async {
      await open(tester, feed: () => busyNotifications(urgent: false));

      expect(find.text('3 patients waiting for a time'), findsOneWidget);
      // The server's count, not the three rows the feed happens to hold.
      expect(find.text('4 unread messages'), findsOneWidget);
      // Eight today, one of them cancelled.
      expect(find.textContaining('8 booked'), findsOneWidget);
    });

    testWidgets('a refresh that fails keeps the day on screen', (tester) async {
      var failing = false;
      await open(
        tester,
        diary:
            (q) =>
                failing
                    ? throw offline
                    : q.status == 'requested'
                    ? paged(waitingRequests())
                    : paged(busyDay()),
        feed: () => failing ? throw offline : busyNotifications(urgent: false),
      );
      expect(find.text('Ayesha Rahman'), findsWidgets);

      failing = true;
      final container = containerOf(tester, find.byType(StaffTodayScreen));
      container.invalidate(appointmentDiaryProvider);
      container.invalidate(clinicianNotificationsProvider);
      await tester.pumpAndSettle();

      expect(find.text('Ayesha Rahman'), findsWidgets);
      expect(find.text('3 patients waiting for a time'), findsOneWidget);
      expect(find.text('Could not refresh'), findsOneWidget);
      expect(find.textContaining('Could not load'), findsNothing);
    });
  });
}
