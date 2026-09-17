import 'dart:async';

import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/core/theme/tokens.dart';
import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/domain/patient_registration.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/patients_screen.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:medpin/shared/widgets/clinic_brand.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medpin/shared/widgets/notification_list_sheet.dart';

/// The inbox reaches past its first page.
///
/// It read one page of a hundred patients sorted by name and then put unread
/// conversations first on the phone, so an unread message from the
/// hundred-and-first patient by name never appeared. It now asks the server
/// for the inbox order across the whole roll, and the rest of the roll is a
/// button at the end of the list.

/// Nobody signed in, so the header does not go looking for an account.
class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

PatientListItem _patient(int n) => PatientListItem(
  id: 'p$n',
  name: 'Patient $n',
  phone: '',
  riskScore: 0,
  riskBand: 'low',
);

Paged<PatientListItem> _roll(
  List<int> ns, {
  required int total,
  required bool hasMore,
  int page = 1,
}) => Paged(
  items: [for (final n in ns) _patient(n)],
  page: page,
  limit: 100,
  total: total,
  hasMore: hasMore,
);

void main() {
  // The app's own face, so raised text is laid out with real glyph widths.
  // The test font draws every glyph a full em wide, which overflows rows at
  // twice the size that fit on a phone.
  setUpAll(() async {
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  late List<PatientsQuery> asked;
  late Completer<Paged<PatientListItem>> secondPage;

  /// A 360dp phone, and a fresh record of what the screen asks for.
  ///
  /// Called inside each test rather than from setUp: the page-two Completer has
  /// to be made where the test's fake clock is running, or the value it
  /// delivers never reaches the screen being pumped.
  void begin(WidgetTester tester) {
    asked = [];
    secondPage = Completer();
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Widget app({TextScaler textScaler = TextScaler.noScaling}) => ProviderScope(
    overrides: [
      secureStoreProvider.overrideWithValue(_NoSession()),
      brandClinicProvider.overrideWith((ref) async => null),
      overviewProvider.overrideWith((ref) => Completer<ClinicOverview>().future),
      // The bell counts the notification list it opens; never answered here,
      // like the overview it used to count.
      clinicianNotificationsProvider.overrideWith(
        (ref) => Completer<({int unread, int messages, int alerts, int requests, List<PanelNotification> items})>().future,
      ),
      pendingEnrolmentsProvider.overrideWith(
        (ref) async => const <PendingEnrolment>[],
      ),
      // Records every query the screen asks for. Page one answers at once with
      // two of 150; page two waits until the test lets it through.
      patientsProvider.overrideWith((ref, q) {
        asked.add(q);
        if (q.pages == 1) return _roll([1, 2], total: 150, hasMore: true);
        return secondPage.future;
      }),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder:
          (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: textScaler),
            child: child!,
          ),
      home: const PatientsScreen(),
    ),
  );

  /// The screen polls every three seconds. Taking the tree down cancels that
  /// timer, so no test ends with one still pending.
  Future<void> leave(WidgetTester tester) =>
      tester.pumpWidget(const SizedBox.shrink());

  testWidgets('asks for the inbox order, one page to begin with', (
    tester,
  ) async {
    begin(tester);
    await tester.pumpWidget(app());
    await tester.pump();

    expect(asked, isNotEmpty);
    expect(asked.first, (riskBand: null, search: null, sort: 'inbox', pages: 1));
    expect(find.text('Patient 1'), findsOneWidget);

    await leave(tester);
  });

  testWidgets('offers the rest of the roll, and asks for page two when tapped', (
    tester,
  ) async {
    begin(tester);
    await tester.pumpWidget(app());
    await tester.pump();

    expect(find.text('Show more patients'), findsOneWidget);
    // The 148 the server has that the phone has not loaded — not a guess.
    expect(find.text('148 more after these'), findsOneWidget);

    await tester.tap(find.text('Show more patients'));
    await tester.pump();

    expect(asked.last, (riskBand: null, search: null, sort: 'inbox', pages: 2));

    // The first page stays up while the second is on its way: no spinner in
    // place of the list, and the button says what is happening.
    expect(find.text('Patient 1'), findsOneWidget);
    expect(find.text('Patient 2'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Loading more patients…'), findsOneWidget);

    secondPage.complete(_roll([1, 2, 3], total: 3, hasMore: false, page: 2));
    await tester.pump();
    await tester.pump();

    expect(find.text('Patient 3'), findsOneWidget);
    // Everybody is loaded, so there is nothing left to offer.
    expect(find.text('Show more patients'), findsNothing);

    await leave(tester);
  });

  testWidgets('a new search or filter starts again from page one', (
    tester,
  ) async {
    begin(tester);
    await tester.pumpWidget(app());
    await tester.pump();

    await tester.tap(find.text('Show more patients'));
    await tester.pump();
    secondPage.complete(_roll([1, 2, 3], total: 250, hasMore: true, page: 2));
    await tester.pump();
    await tester.pump();
    expect(asked.last.pages, 2);

    await tester.enterText(find.byType(TextField), 'Patient');
    // Past the search's debounce, well short of the poll.
    await tester.pump(const Duration(milliseconds: 450));
    expect(asked.last, (
      riskBand: null,
      search: 'Patient',
      sort: 'inbox',
      pages: 1,
    ));

    await tester.tap(find.text('Show more patients'));
    await tester.pump();
    expect(asked.last.pages, 2);

    await tester.tap(find.text('Unread'));
    await tester.pump();
    expect(asked.last.pages, 1);

    await leave(tester);
  });

  testWidgets('the button grows with raised text instead of clipping it', (
    tester,
  ) async {
    begin(tester);
    await tester.pumpWidget(app(textScaler: const TextScaler.linear(2)));
    await tester.pump();

    final button = find.ancestor(
      of: find.text('Show more patients'),
      matching: find.byType(OutlinedButton),
    );
    expect(button, findsOneWidget);

    final size = tester.getSize(button);
    expect(size.height, greaterThan(T.tap));
    // Full width inside the list's side margins.
    expect(size.width, closeTo(360 - 2 * T.s4, 0.5));
    expect(tester.takeException(), isNull);

    await leave(tester);
  });
}
