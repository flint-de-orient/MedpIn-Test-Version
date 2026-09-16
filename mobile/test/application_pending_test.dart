import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/auth/data/auth_repository.dart';
import 'package:medpin/features/auth/presentation/auth_controller.dart';
import 'package:medpin/features/auth/presentation/login_screen.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:medpin/shared/widgets/auth_kit.dart';
import 'package:medpin/shared/widgets/error_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A number waiting on a practice application.
///
/// Somebody who applied to bring their practice to MedPin is told to sign in on
/// the app with the number they proved, once the practice is approved. Before
/// that the number has no account, so the app answered "No account found.
/// Please create one" and offered Register — and registering made them a
/// patient, on the one number their practice's approval then refused to make a
/// doctor.
///
/// The server now answers `APPLICATION_PENDING` for that number, and these
/// check the app says what it means and offers no way to register.

/// Nobody signed in on this handset.
class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

/// A server with an open application on every number it is asked about.
class _WaitingApplicant implements AuthRepository {
  @override
  Future<OtpSent> requestOtp({
    required String phone,
    required String purpose,
  }) async {
    throw const ApiException(
      code: 'APPLICATION_PENDING',
      message: 'This number is on a practice application.',
      statusCode: 409,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  final l10n = lookupAppLocalizations(const Locale('en'));

  Widget app(Widget home) => ProviderScope(
    overrides: [
      secureStoreProvider.overrideWithValue(_NoSession()),
      authRepositoryProvider.overrideWithValue(_WaitingApplicant()),
    ],
    child: MaterialApp(
      // The real theme — see auth_forms_test.dart for what a bare one hid.
      theme: AppTheme.light(),
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: home,
    ),
  );

  testWidgets(
    'signing in with a number under review says so, and offers no registration',
    (tester) async {
      await tester.pumpWidget(app(const LoginScreen()));

      await tester.enterText(find.byType(TextFormField), '9830012345');
      await tester.tap(find.widgetWithText(PillButton, l10n.authOtpSendButton));
      await tester.pumpAndSettle();

      expect(find.text(l10n.authApplicationPending), findsOneWidget);
      expect(
        find.text(l10n.authNotRegistered),
        findsNothing,
        reason: 'the applicant was told there is no account and to make one',
      );
      expect(
        find.text(l10n.authGoToRegister),
        findsNothing,
        reason: 'a waiting applicant was offered patient registration',
      );
    },
  );

  testWidgets(
    'and a different number is an ordinary question again',
    (tester) async {
      await tester.pumpWidget(app(const LoginScreen()));

      await tester.enterText(find.byType(TextFormField), '9830012345');
      await tester.tap(find.widgetWithText(PillButton, l10n.authOtpSendButton));
      await tester.pumpAndSettle();
      expect(find.text(l10n.authGoToRegister), findsNothing);

      await tester.enterText(find.byType(TextFormField), '9830012346');
      await tester.pump();
      expect(find.text(l10n.authGoToRegister), findsOneWidget);
    },
  );

  testWidgets('the same sentence wherever else the server says it, such as registering', (
    tester,
  ) async {
    late String message;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) {
            message = ErrorView.messageFor(
              context,
              const ApiException(code: 'APPLICATION_PENDING', message: 'x'),
            );
            return const SizedBox();
          },
        ),
      ),
    );

    expect(message, l10n.authApplicationPending);
  });
}
