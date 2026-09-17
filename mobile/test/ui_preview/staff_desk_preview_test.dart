import 'dart:async';

import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/features/appointments/domain/appointment.dart';
import 'package:akd_care/features/appointments/presentation/appointment_providers.dart';
import 'package:akd_care/features/clinician/domain/patient_registration.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/staff/presentation/desk_providers.dart';
import 'package:akd_care/features/staff/presentation/staff_profile_screen.dart';
import 'package:akd_care/features/staff/presentation/staff_shell.dart';
import 'package:akd_care/features/staff/presentation/staff_today_screen.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'desk_fixtures.dart';
import 'preview_harness.dart';

/// The front desk's panel, drawn: Today busy, calm, empty, loading, failed,
/// stale and at a large text size, and Profile.
///
/// Run: flutter test test/ui_preview/staff_desk_preview_test.dart
/// Look: build/ui_previews/staff/*.png
void main() {
  setUpAll(loadPreviewFonts);

  GoRouter deskRouter([String initial = '/staff/today']) => GoRouter(
    initialLocation: initial,
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => StaffShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/today',
                builder: (_, _) => const StaffTodayScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/patients',
                builder: (_, _) => const SizedBox.shrink(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/staff/profile',
                builder: (_, _) => const StaffProfileScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );

  const offline = ApiException(
    code: 'NETWORK_ERROR',
    message: 'Could not reach the server',
  );

  Future<List<Override>> deskOverrides({
    FutureOr<Paged<Appointment>> Function(AppointmentQuery q)? diary,
    FutureOr<DeskNotifications> Function()? notifications,
    FutureOr<int> Function(AppointmentQuery q)? weekCount,
    List<PendingEnrolment> waitingOnCode = const [],
  }) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    return [
      ...baseOverrides(),
      ...signedInAs(deskUser),
      sharedPreferencesProvider.overrideWithValue(prefs),
      brandClinicProvider.overrideWith((ref) async => deskClinic),
      clinicsProvider.overrideWith((ref) async => [deskClinic]),
      overviewProvider.overrideWith(
        (ref) async => overview(unread: 4, alerts: 1),
      ),
      pendingEnrolmentsProvider.overrideWith((ref) async => waitingOnCode),
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
            notifications != null ? await notifications() : busyNotifications(),
      ),
      // The week so far, as the server would count it.
      deskCountProvider.overrideWith(
        (ref, q) async =>
            weekCount != null
                ? await weekCount(q)
                : switch (q.status) {
                  null => 46,
                  'cancelled' => 3,
                  'completed' => 31,
                  'no_show' => 2,
                  _ => 0,
                },
      ),
    ];
  }

  Future<void> open(
    WidgetTester tester,
    List<Override> overrides, {
    double height = 780,
    PreviewScale scale = PreviewScale.production,
    String initial = '/staff/today',
    bool settle = true,
  }) async {
    usePhone(tester, height: height);
    await tester.pumpWidget(
      previewApp(
        overrides: overrides,
        router: deskRouter(initial),
        scale: scale,
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await pumpFrames(tester);
    }
  }

  const area = 'staff';

  testWidgets('today, busy, somebody urgent', (tester) async {
    await open(
      tester,
      await deskOverrides(
        waitingOnCode: [
          PendingEnrolment(
            id: 'e1',
            patientId: 'p-e1',
            name: 'Tapas Ghosh',
            phone: '+919830055555',
            registeredOn: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
      ),
    );
    await snap(tester, area, 'today_busy_urgent_fold');
  });

  testWidgets('today, busy, nobody urgent', (tester) async {
    await open(
      tester,
      await deskOverrides(
        notifications: () => busyNotifications(urgent: false),
      ),
    );
    await snap(tester, area, 'today_busy_calm_fold');
  });

  testWidgets('today, busy, the whole scroll', (tester) async {
    await open(
      tester,
      await deskOverrides(
        waitingOnCode: [
          PendingEnrolment(
            id: 'e1',
            patientId: 'p-e1',
            name: 'Tapas Ghosh',
            phone: '+919830055555',
            registeredOn: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
      ),
      height: 2800,
    );
    await snap(tester, area, 'today_busy_full');
  });

  testWidgets('today, nothing booked, nothing waiting', (tester) async {
    await open(
      tester,
      await deskOverrides(
        diary: (q) => paged(const []),
        notifications: () => quietNotifications,
        weekCount: (q) => 0,
      ),
    );
    await snap(tester, area, 'today_quiet');
  });

  testWidgets('today, loading', (tester) async {
    await open(
      tester,
      await deskOverrides(
        diary: (q) => Completer<Paged<Appointment>>().future,
        notifications: () => Completer<DeskNotifications>().future,
        weekCount: (q) => Completer<int>().future,
      ),
      settle: false,
    );
    await snap(tester, area, 'today_loading');
  });

  testWidgets('today, nothing could be fetched', (tester) async {
    await open(
      tester,
      await deskOverrides(
        diary: (q) => throw offline,
        notifications: () => throw offline,
        weekCount: (q) => throw offline,
      ),
    );
    await snap(tester, area, 'today_failed');
  });

  testWidgets('today, only the diary failed', (tester) async {
    await open(
      tester,
      await deskOverrides(
        diary:
            (q) =>
                q.status == 'requested'
                    ? paged(waitingRequests())
                    : throw offline,
        notifications: () => busyNotifications(urgent: false),
      ),
      height: 1600,
    );
    await snap(tester, area, 'today_diary_failed');
  });

  testWidgets('today, a refresh failed after a good load', (tester) async {
    var failing = false;
    await open(
      tester,
      await deskOverrides(
        diary:
            (q) =>
                failing
                    ? throw offline
                    : q.status == 'requested'
                    ? paged(waitingRequests())
                    : paged(busyDay()),
        notifications:
            () => failing ? throw offline : busyNotifications(urgent: false),
      ),
      height: 1400,
    );
    failing = true;
    final container = containerOf(tester, find.byType(StaffTodayScreen));
    container.invalidate(appointmentDiaryProvider);
    container.invalidate(clinicianNotificationsProvider);
    await tester.pumpAndSettle();
    await snap(tester, area, 'today_stale');
  });

  testWidgets('today, busy, text at 1.3', (tester) async {
    await open(
      tester,
      await deskOverrides(),
      height: 3800,
      scale: PreviewScale.large,
    );
    await snap(tester, area, 'today_busy_large_text');
  });

  testWidgets('profile', (tester) async {
    await open(
      tester,
      await deskOverrides(),
      initial: '/staff/profile',
      height: 1500,
    );
    await snap(tester, area, 'profile_full');
  });
}
