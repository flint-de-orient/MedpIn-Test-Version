import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/widgets/error_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

/// What a refusal looks like, as opposed to a breakage.
///
/// ---- Why this needed changing ------------------------------------------
///
/// Every failure rendered the same: a red error triangle, the title "Something
/// went wrong", and a Retry button. Correct for a dropped connection. Wrong
/// three times over for a 403 — nothing went wrong, the triangle says the
/// software broke, and Retry is a control that cannot possibly help.
///
/// It matters more since the tenant scoping landed. Five routes that used to
/// succeed across practices now refuse, so a clinician meeting one of these is
/// no longer a rare event — and a red triangle teaches them the app is
/// unreliable rather than that the record is not theirs.
///
/// ---- And the one thing these must not do -------------------------------
///
/// The server answers 404 both for something that does not exist and for
/// something belonging to another practice, deliberately: asking for an id
/// must not reveal whether the row is there. The app sees one code and must
/// not guess which case it was, so there is exactly one not-found state.

Widget _harness(Widget child) => MaterialApp(
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

ApiException _err(String code, {int? status}) =>
    ApiException(code: code, message: 'server said so', statusCode: status);

void main() {
  group('a refusal is drawn as an answer, not a fault', () {
    testWidgets('403 shows a permission state with no retry', (tester) async {
      /*
       * The case the brief names. Retry is absent because pressing it sends
       * the same request with the same grant and gets the same refusal — and
       * a button that cannot change the outcome is the dead-control rule
       * wearing a different hat.
       */
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('FORBIDDEN', status: 403), onRetry: () {})),
      );

      expect(find.text('You do not have access'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
      expect(find.text('Something went wrong'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsNothing);
    });

    testWidgets('and still says what to do about it', (tester) async {
      // The title names the state; the body is the sentence a person acts on.
      await tester.pumpWidget(_harness(ErrorView(error: _err('FORBIDDEN'))));
      expect(find.textContaining('permission'), findsOneWidget);
    });

    testWidgets('404 shows one not-found state, whatever caused it', (tester) async {
      /*
       * There is deliberately no second variant for "belongs to another
       * practice". The server refuses to distinguish them and the app would
       * undo that by trying.
       */
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('NOT_FOUND', status: 404), onRetry: () {})),
      );

      expect(find.text('Not found'), findsOneWidget);
      expect(find.byIcon(Icons.search_off_rounded), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsNothing);
    });

    testWidgets('401 offers no retry either', (tester) async {
      // Retrying re-sends the same dead credential.
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('UNAUTHORIZED', status: 401), onRetry: () {})),
      );

      expect(find.text('Signed out'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsNothing);
    });
  });

  group('but a breakage still looks like one', () {
    testWidgets('a dropped connection keeps its retry', (tester) async {
      // The one case Retry was always right for, and the commonest.
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('NETWORK_ERROR'), onRetry: () {})),
      );

      expect(find.text('No connection'), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);
    });

    testWidgets('a timeout is drawn the same way', (tester) async {
      await tester.pumpWidget(_harness(ErrorView(error: _err('TIMEOUT'), onRetry: () {})));
      expect(find.text('No connection'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);
    });

    testWidgets('rate limiting offers a retry, because waiting is the fix', (tester) async {
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('RATE_LIMITED', status: 429), onRetry: () {})),
      );

      expect(find.text('Too many requests'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);
    });

    testWidgets('and a server error keeps the error treatment', (tester) async {
      // Something genuinely did go wrong. This is the case the original
      // presentation was written for, and it is the only one that keeps it.
      await tester.pumpWidget(
        _harness(ErrorView(error: _err('INTERNAL_ERROR', status: 500), onRetry: () {})),
      );

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);
    });
  });

  group('a validation failure says which field', () {
    testWidgets('the server’s field messages are shown, not swallowed', (tester) async {
      /*
       * A bare "check the details you entered" leaves somebody re-reading a
       * form they believe is correct. The server already names the fields.
       */
      await tester.pumpWidget(
        _harness(
          ErrorView(
            error: const ApiException(
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: [
                ApiErrorDetail(path: 'phone', message: 'Enter a 10-digit mobile number'),
              ],
            ),
          ),
        ),
      );

      expect(find.textContaining('Enter a 10-digit mobile number'), findsOneWidget);
    });
  });

  group('nothing internal reaches the screen', () {
    testWidgets('the server’s raw message is not rendered for a 500', (tester) async {
      /*
       * `ApiException.message` carries whatever the server said, and outside
       * production that includes connection strings and driver text. The view
       * maps the *code* to copy and must not fall back to the raw message.
       */
      await tester.pumpWidget(
        _harness(
          ErrorView(
            error: const ApiException(
              code: 'INTERNAL_ERROR',
              message: 'connect ECONNREFUSED 127.0.0.1:27017',
              statusCode: 500,
            ),
            onRetry: null,
          ),
        ),
      );

      expect(find.textContaining('27017'), findsNothing);
      expect(find.textContaining('ECONNREFUSED'), findsNothing);
    });

    testWidgets('and an unknown code does not leak it either', (tester) async {
      // A code the app has never heard of falls through to generic copy. The
      // code itself is a server-side identifier and means nothing to a reader.
      await tester.pumpWidget(
        _harness(
          ErrorView(
            error: const ApiException(
              code: 'TENANT_SCOPE_VIOLATION_7734',
              message: 'practice 6aa5300b95eac3bcb3e351cb denied',
            ),
          ),
        ),
      );

      expect(find.textContaining('TENANT_SCOPE_VIOLATION'), findsNothing);
      expect(find.textContaining('6aa5300b'), findsNothing);
    });
  });
}
