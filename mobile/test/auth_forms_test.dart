import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/core/utils/auth_validators.dart';
import 'package:akd_care/features/auth/presentation/doctor_password_login_screen.dart';
import 'package:akd_care/features/auth/presentation/login_screen.dart';
import 'package:akd_care/features/auth/presentation/register_screen.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/widgets/auth_kit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Field-level validation for the two auth forms.
///
/// These assert the *client* rules stay at least as strict as the server's
/// (`backend/src/routes/auth.js`). A client rule looser than the server's turns
/// into an opaque VALIDATION_ERROR after a round trip; stricter is safe.
void main() {
  Widget harness(Widget screen) => ProviderScope(
    child: MaterialApp(
      // The real theme, not a bare MaterialApp.
      //
      // Without it these tests missed a shipped bug: AppTheme gives every
      // OutlinedButton `minimumSize: Size.fromHeight(52)` — a minimum *width*
      // of infinity — so a button sharing a Row with an Expanded field took
      // the whole row and the field rendered one character wide. A themeless
      // harness renders a layout no user ever sees.
      theme: AppTheme.light(),
      locale: const Locale('en'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: screen,
    ),
  );

  Future<void> enter(WidgetTester tester, String label, String text) async {
    // Scoped through the AuthField wrapper. The label used to be the field's
    // own InputDecoration.labelText; the auth kit moved it out to a Text above
    // the input, so matching the label against the TextFormField itself found
    // nothing and every enterText threw "Bad state: No element".
    await tester.enterText(
      find.descendant(
        of: find.widgetWithText(AuthField, label),
        matching: find.byType(TextFormField),
      ),
      text,
    );
    await tester.pump();
  }

  /// The register form is taller than the default 800x600 test surface, so a
  /// plain `tap()` on the submit button silently misses (tap only *warns* when
  /// the hit test lands outside the viewport). Give the tests a phone-shaped
  /// surface tall enough to hold the whole form.
  void useTallSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  /// Errors are hidden until the first submit attempt, so most field-rule
  /// tests have to press the button once before anything is on screen.
  Future<void> submit(WidgetTester tester, String label) async {
    // PillButton, not ElevatedButton: both forms were rebuilt on the auth
    // kit and this finder silently matched nothing afterwards.
    await tester.tap(find.widgetWithText(PillButton, label));
    await tester.pumpAndSettle();
  }

  group('AuthValidators', () {
    test('phone accepts 10-digit numbers starting 6-9', () {
      for (final ok in [
        '9830012345',
        '6000000000',
        '7412589630',
        '8888888888',
      ]) {
        expect(AuthValidators.isValidPhone(ok), isTrue, reason: ok);
      }
      for (final bad in [
        '5830012345',
        '983001234',
        '98300123456',
        '',
        'abcdefghij',
      ]) {
        expect(AuthValidators.isValidPhone(bad), isFalse, reason: bad);
      }
    });

    test('phone strips punctuation before validating', () {
      expect(AuthValidators.isValidPhone('98300 12345'), isTrue);
      expect(AuthValidators.toE164('98300-12345'), '+919830012345');
    });

    test('email mirrors the server contract', () {
      expect(AuthValidators.isValidEmail('a@b.co'), isTrue);
      for (final bad in ['a@b', 'a b@c.com', '@b.com', 'plain']) {
        expect(AuthValidators.isValidEmail(bad), isFalse, reason: bad);
      }
    });

    test('bounds match the server schema', () {
      expect(AuthValidators.minPasswordLength, 8);
      expect(AuthValidators.maxPasswordLength, 128);
      expect(AuthValidators.minNameLength, 2);
      expect(AuthValidators.maxNameLength, 120);
    });

    test('enums cover every value the server accepts', () {
      expect(
        AuthValidators.diabetesTypes,
        containsAll(['type1', 'type2', 'gestational', 'prediabetes', 'none']),
      );
      expect(
        AuthValidators.genders,
        containsAll(['male', 'female', 'other', 'undisclosed']),
      );
    });

    test('date of birth rejects the future, today, and implausible ages', () {
      final now = DateTime(2026, 7, 23);
      expect(
        AuthValidators.isPlausibleDateOfBirth(DateTime(1975, 4, 2), now: now),
        isTrue,
      );
      expect(
        AuthValidators.isPlausibleDateOfBirth(DateTime(2027, 1, 1), now: now),
        isFalse,
      );
      expect(AuthValidators.isPlausibleDateOfBirth(now, now: now), isFalse);
      expect(
        AuthValidators.isPlausibleDateOfBirth(DateTime(1850, 1, 1), now: now),
        isFalse,
      );
    });
  });

  group('Login form', () {
    testWidgets('asks for a number and nothing else', (tester) async {
      await tester.pumpWidget(harness(const LoginScreen()));

      // The whole point of the redesign. A patient has no password to type,
      // and a box asking for one is a box they cannot fill.
      expect(find.widgetWithText(AuthField, 'Password'), findsNothing);
      expect(find.widgetWithText(AuthField, 'Phone number'), findsOneWidget);
      expect(find.widgetWithText(PillButton, 'Send OTP'), findsOneWidget);
      expect(find.widgetWithText(PillButton, 'Log in'), findsNothing);
    });

    testWidgets('shows nothing until the button is pressed', (tester) async {
      await tester.pumpWidget(harness(const LoginScreen()));
      expect(find.text('Enter a valid 10-digit mobile number'), findsNothing);

      await enter(tester, 'Phone number', '123');
      // Still nothing: errors wait for a submit rather than scolding someone
      // three digits into a ten-digit number.
      expect(find.text('Enter a valid 10-digit mobile number'), findsNothing);
    });

    testWidgets('rejects a 9-digit number and one starting below 6', (
      tester,
    ) async {
      await tester.pumpWidget(harness(const LoginScreen()));

      await enter(tester, 'Phone number', '983001234');
      await submit(tester, 'Send OTP');
      expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);

      await enter(tester, 'Phone number', '5830012345');
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);
    });

    testWidgets('the country code is visible before anything is typed', (
      tester,
    ) async {
      await tester.pumpWidget(harness(const LoginScreen()));

      // It was a `prefixText`, which Flutter hides while the field is empty
      // and unfocused — so "+91" appeared only once someone started typing,
      // which is the one moment they no longer need telling. Before that the
      // box read "Enter your 10-digit number" with nothing saying whose ten
      // digits, on the screen where a patient decides whether to include a
      // country code.
      expect(find.text('+91'), findsOneWidget);
    });

    testWidgets('offers the doctor and the desk a way to a password', (
      tester,
    ) async {
      await tester.pumpWidget(harness(const LoginScreen()));
      // Quiet, but present, and it has to name BOTH. The link said "Doctor?"
      // while the screen it opens said "For clinic staff accounts" — so a
      // receptionist read the link, decided it was not for them, and the
      // screen offered no other door.
      expect(
        find.text('Doctor or clinic staff? Sign in with a password'),
        findsOneWidget,
      );
    });
  });

  group('Doctor password form', () {
    testWidgets('is the only screen that asks for a password', (tester) async {
      await tester.pumpWidget(harness(const DoctorPasswordLoginScreen()));
      expect(find.widgetWithText(AuthField, 'Phone number'), findsOneWidget);
      expect(find.widgetWithText(AuthField, 'Password'), findsOneWidget);
    });

    testWidgets('says it is only for accounts that already have one', (
      tester,
    ) async {
      // §30: nobody is given a password any more. Somebody new reading "for
      // clinic staff" would sit here with nothing to type.
      await tester.pumpWidget(harness(const DoctorPasswordLoginScreen()));
      expect(
        find.text(
          'Only for staff accounts that already have a password. New staff, '
          'and everyone else, sign in with a code sent by SMS.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('does not impose the registration length rule on an existing '
        'password', (tester) async {
      await tester.pumpWidget(harness(const DoctorPasswordLoginScreen()));

      await enter(tester, 'Phone number', '9830012345');
      await enter(tester, 'Password', 'short');
      await submit(tester, 'Log in');

      // A doctor whose password predates any rule must not be told their own
      // password is "too short" — that reads as a rule about the account.
      expect(find.text('Password must be at least 8 characters'), findsNothing);
    });

    testWidgets('still requires something in the box', (tester) async {
      await tester.pumpWidget(harness(const DoctorPasswordLoginScreen()));
      await enter(tester, 'Phone number', '9830012345');
      await submit(tester, 'Log in');
      expect(find.text('Please enter your password'), findsOneWidget);
    });
  });

  group('Register form', () {
    testWidgets('has no password fields and no progress bar', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      expect(find.widgetWithText(AuthField, 'Password'), findsNothing);
      expect(find.widgetWithText(AuthField, 'Confirm password'), findsNothing);
      // The bar measured a two-step wizard. There is one step now, and a
      // progress indicator that only ever reads "1 of 2" is furniture.
      expect(find.byType(StepBar), findsNothing);
    });

    testWidgets('there is no invite code to type', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      // This form makes patients and nothing else. The invite code was a
      // shared string that turned the new account into a dietician or a front
      // desk — a credential that cannot be un-shared, does not record who used
      // it, and was in fact used by an account nobody at the clinic
      // recognised. Clinical accounts are created by the doctor, in his panel.
      expect(find.textContaining('invite'), findsNothing);
      expect(find.textContaining('Invite'), findsNothing);
    });

    testWidgets(
      'keeps the rest of the form back until the number is verified',
      (tester) async {
        useTallSurface(tester);
        await tester.pumpWidget(harness(const RegisterScreen()));

        // Nothing to fill in and nothing to submit. A page of greyed-out fields
        // reads as broken; an absent one reads as not-yet.
        expect(find.widgetWithText(AuthField, 'Full name'), findsNothing);
        expect(find.widgetWithText(AuthField, 'Date of birth'), findsNothing);

        final button = tester.widget<PillButton>(
          find.widgetWithText(PillButton, 'Create account'),
        );
        expect(button.onPressed, isNull);
      },
    );

    testWidgets('says why it will not submit rather than doing nothing', (
      tester,
    ) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      // A disabled button cannot be tapped, so the thing to do next has to be
      // on the screen already: a phone field with a Verify beside it, sitting
      // where the form would otherwise be.
      expect(find.widgetWithText(AuthField, 'Phone number'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Verify'), findsOneWidget);
    });

    testWidgets('an invalid number never reaches the server', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      await enter(tester, 'Phone number', '12345');
      await tester.tap(find.widgetWithText(OutlinedButton, 'Verify').first);
      await tester.pumpAndSettle();

      expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);
    });

    testWidgets('the phone field gets the width of the screen', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      // It shipped 14px wide, its label running down the page a letter at a
      // time, because the Verify button beside it inherited a minimum width of
      // infinity from the theme. Anything close to the full width is fine;
      // the failure this guards against is an order of magnitude off.
      final field = tester.getSize(
        find.widgetWithText(AuthField, 'Phone number'),
      );
      expect(field.width, greaterThan(240));
    });

    testWidgets('nothing on the form overflows its row', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));
      // A RenderFlex overflow throws in a widget test, which is the whole
      // point of pumping the real theme above.
      expect(tester.takeException(), isNull);
    });

    testWidgets('the country code is visible on the register form too', (
      tester,
    ) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));
      expect(find.text('+91'), findsOneWidget);
    });

    testWidgets('the first step fits a phone screen', (tester) async {
      // A form that overflows by a few dozen pixels is worse than one that
      // clearly scrolls: it jiggles, and the reader cannot tell whether there
      // is more below or the screen is broken. This shipped that way, with a
      // section heading over each of two single-field blocks pushing it ~150px
      // past the viewport.
      //
      // The bound is a ceiling rather than a measurement. This harness renders
      // with a test font whose every glyph is a full em, so text here is
      // markedly wider than on any real device and a strict `== 0` would fail
      // on a screen that fits with room to spare.
      tester.view.physicalSize = const Size(720, 1600);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(const RegisterScreen()));
      await tester.pump(const Duration(milliseconds: 200));

      final position =
          tester.state<ScrollableState>(find.byType(Scrollable).first).position;
      expect(position.maxScrollExtent, lessThan(160));
    });

    testWidgets('no field is labelled twice', (tester) async {
      useTallSurface(tester);
      await tester.pumpWidget(harness(const RegisterScreen()));

      // A section heading over a single labelled field said the same words
      // twice — "Your phone number" above a field labelled "Phone number".
      for (final label in const ['Phone number']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
    });

  });
}
