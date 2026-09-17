import 'dart:async';

import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/patient_registration.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/patients_screen.dart';
import 'package:akd_care/features/clinician/presentation/widgets/record_ui.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// The patient list says who needs the doctor, opens the record, keeps the
/// conversation one tap away, and never trades a list it has for an error it
/// could survive.

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

PatientListItem _p(
  String id,
  String name, {
  String band = 'low',
  int unread = 0,
  int alerts = 0,
  bool withMessage = true,
  String urgency = 'routine',
}) => PatientListItem(
  id: id,
  name: name,
  phone: '',
  riskScore: 0,
  riskBand: band,
  unreadCount: unread,
  openAlertCount: alerts,
  lastMessage:
      withMessage
          ? MessagePreview(
            preview: 'A message from $name',
            role: 'user',
            at: DateTime.now().subtract(const Duration(hours: 1)),
            urgency: urgency,
          )
          : null,
);

Paged<PatientListItem> _roll(List<PatientListItem> items) => Paged(
  items: items,
  page: 1,
  limit: 100,
  total: items.length,
  hasMore: false,
);

void main() {
  setUpAll(() async {
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  late List<PatientsQuery> asked;

  Future<void> open(
    WidgetTester tester,
    FutureOr<Paged<PatientListItem>> Function(PatientsQuery q, int read) answer,
  ) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    asked = [];
    var reads = 0;

    final router = GoRouter(
      initialLocation: '/clinician/patients',
      routes: [
        GoRoute(
          path: '/clinician/patients',
          builder: (_, _) => const PatientsScreen(),
        ),
        GoRoute(
          path: '/clinician/patients/:id',
          builder: (_, s) => Text('record ${s.pathParameters['id']}'),
        ),
        GoRoute(
          path: '/clinician/patients/:id/thread',
          builder: (_, s) => Text('thread ${s.pathParameters['id']}'),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStoreProvider.overrideWithValue(_NoSession()),
          brandClinicProvider.overrideWith((ref) async => null),
          overviewProvider.overrideWith(
            (ref) => Completer<ClinicOverview>().future,
          ),
          pendingEnrolmentsProvider.overrideWith(
            (ref) async => const <PendingEnrolment>[],
          ),
          patientsProvider.overrideWith((ref, q) async {
            asked.add(q);
            return answer(q, reads++);
          }),
        ],
        child: MaterialApp.router(
          theme: AppTheme.light(),
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> leave(WidgetTester tester) =>
      tester.pumpWidget(const SizedBox.shrink());

  testWidgets('a row opens the record, and its button the conversation', (
    tester,
  ) async {
    await open(tester, (_, _) => _roll([_p('p1', 'Sunita Das', unread: 2)]));

    await tester.tap(find.text('Sunita Das'));
    await tester.pumpAndSettle();
    expect(find.text('record p1'), findsOneWidget);

    await leave(tester);
    await open(tester, (_, _) => _roll([_p('p1', 'Sunita Das', unread: 2)]));
    await tester.tap(
      find.bySemanticsLabel(
        'Open the conversation with Sunita Das, 2 unread messages',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('thread p1'), findsOneWidget);
    await leave(tester);
  });

  testWidgets('a patient who never wrote has no conversation button', (
    tester,
  ) async {
    await open(
      tester,
      (_, _) => _roll([_p('p2', 'Priya Sen', withMessage: false)]),
    );
    expect(find.text('Priya Sen'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('Open the conversation')),
      findsNothing,
    );
    await leave(tester);
  });

  testWidgets('why a patient needs the doctor is said in words', (
    tester,
  ) async {
    await open(
      tester,
      (_, _) => _roll([
        _p(
          'p1',
          'Arjun Mehta',
          band: 'critical',
          alerts: 2,
          unread: 1,
          urgency: 'emergency',
        ),
        _p('p2', 'Rahul Das'),
      ]),
    );
    expect(find.text('2 open alerts'), findsOneWidget);
    expect(find.text('Emergency message'), findsOneWidget);
    expect(find.text('Critical risk'), findsOneWidget);
    // Low is the profile's default, not a finding: nothing is said for it.
    expect(find.text('Low risk'), findsNothing);
    await leave(tester);
  });

  testWidgets('At risk asks for the risk order and leaves out low risk', (
    tester,
  ) async {
    await open(
      tester,
      (_, _) =>
          _roll([_p('p1', 'Arjun Mehta', band: 'high'), _p('p2', 'Rahul Das')]),
    );
    await tester.tap(find.text('At risk'));
    await tester.pump();
    await tester.pump();

    expect(asked.last.sort, 'risk');
    expect(asked.last.pages, 1);
    expect(find.text('Arjun Mehta'), findsOneWidget);
    expect(find.text('Rahul Das'), findsNothing);
    await leave(tester);
  });

  testWidgets('a refresh that cannot connect keeps the list and says so', (
    tester,
  ) async {
    await open(
      tester,
      (_, read) =>
          read == 0
              ? _roll([_p('p1', 'Sunita Das')])
              : Future.error(
                const ApiException(code: 'NETWORK_ERROR', message: 'offline'),
              ),
    );
    expect(find.text('Sunita Das'), findsOneWidget);

    // Past the three-second poll, which re-reads and fails.
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    await tester.pump();

    expect(find.text('Sunita Das'), findsOneWidget);
    expect(find.textContaining('Could not refresh the list'), findsOneWidget);
    expect(find.text('No patients yet'), findsNothing);
    await leave(tester);
  });

  testWidgets('a refusal replaces the list rather than drawing over it', (
    tester,
  ) async {
    await open(
      tester,
      (_, read) =>
          read == 0
              ? _roll([_p('p1', 'Sunita Das')])
              : Future.error(
                const ApiException(
                  code: 'FORBIDDEN',
                  message: 'You do not have permission to do that',
                  statusCode: 403,
                ),
              ),
    );
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    await tester.pump();

    expect(find.text('Sunita Das'), findsNothing);
    expect(find.text('No access'), findsOneWidget);
    // Retry cannot change a refusal, so it is not offered.
    expect(find.text('Try again'), findsNothing);
    await leave(tester);
  });

  testWidgets('a first load that fails says it failed, not that none exist', (
    tester,
  ) async {
    await open(
      tester,
      (_, _) => Future.error(
        const ApiException(code: 'NETWORK_ERROR', message: 'offline'),
      ),
    );
    expect(find.text('No connection'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('No patients yet'), findsNothing);
    await leave(tester);
  });

  test('an initial is drawn from the name, not the title', () {
    expect(nameForInitial('Dr Anirban Dey'), 'Anirban Dey');
    expect(nameForInitial('Dr. Smt. Rina Paul'), 'Rina Paul');
    expect(nameForInitial('Drupad Sen'), 'Drupad Sen');
    // A name that is only a title is left as it is.
    expect(nameForInitial('Dr'), 'Dr');
  });
}
