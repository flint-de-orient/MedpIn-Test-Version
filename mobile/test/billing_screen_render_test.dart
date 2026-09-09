import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/features/clinician/data/billing_repository.dart';
import 'package:akd_care/features/clinician/domain/billing.dart';
import 'package:akd_care/features/clinician/presentation/billing_screen.dart';

/// What the billing screen actually puts on glass.
///
/// The model tests prove `Allowance.unlimited` is true for a null cap. They say
/// nothing about what is drawn, and the failure worth catching is a rendering
/// one: an uncapped practice — which is every practice on the platform today,
/// the founding clinic included — showing "0 of 0" where it should say
/// "No limit". That reads as "you are full" on the one screen where somebody
/// decides whether to buy something, and it is exactly backwards.
///
/// So these pump the real screen at phone width and read the text.

Widget _screen({required BillingStatus status, bool mayPay = true}) {
  return ProviderScope(
    overrides: [
      billingStatusProvider.overrideWith((ref) async => status),
      capabilitySetProvider.overrideWith(
        (ref) => Capabilities(
          resolved: true,
          practiceType: null,
          specialty: null,
          plan: null,
          practice: const {},
          effective: const {},
          role: 'doctor',
          isOwner: true,
          permissions: mayPay ? const {Perm.manageStaff} : const {},
        ),
      ),
    ],
    child: const MaterialApp(home: BillingScreen()),
  );
}

BillingStatus _status(Map<String, dynamic> json) => BillingStatus.fromJson(json);

void main() {
  // A phone, not a desktop. Three meters and three plan tiles have room on a
  // 1200px surface and not on a 360dp one.
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  Future<void> pump(WidgetTester tester, Widget w) async {
    tester.view.physicalSize = const Size(360 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(w);
    await tester.pumpAndSettle();
  }

  group('an uncapped practice', () {
    final uncapped = _status({
      'plan': 'trial',
      // No `limits` key at all — the founding clinic's shape.
      'usage': {'patients': 312, 'staff': 4, 'locations': 2},
      'canPay': true,
      'testMode': true,
    });

    testWidgets('says No limit, never a zero cap', (tester) async {
      await pump(tester, _screen(status: uncapped));

      expect(find.text('No limit'), findsNWidgets(3));

      // The inversion this file exists for. "0 of 0" reads as full.
      expect(find.textContaining(' of 0'), findsNothing);
      expect(find.text('0 of 0'), findsNothing);
    });

    testWidgets('and shows the real counts beside it', (tester) async {
      await pump(tester, _screen(status: uncapped));

      // The number alone, with no "of", because there is nothing to be out of.
      expect(find.text('312'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
    });

    testWidgets('nothing is called full', (tester) async {
      await pump(tester, _screen(status: uncapped));
      expect(find.text('Full'), findsNothing);
      expect(find.text('Nearly full'), findsNothing);
    });
  });

  group('a capped practice', () {
    testWidgets('reads n of m', (tester) async {
      await pump(
        tester,
        _screen(
          status: _status({
            'plan': 'essential',
            'limits': {'patients': 1000, 'staff': 10, 'locations': 1},
            'usage': {'patients': 312, 'staff': 4, 'locations': 1},
            'canPay': true,
          }),
        ),
      );

      expect(find.text('312 of 1000'), findsOneWidget);
      expect(find.text('4 of 10'), findsOneWidget);
      expect(find.text('No limit'), findsNothing);
    });

    testWidgets('a full meter carries a word, not only a colour', (tester) async {
      // Red-green deficiency runs alongside diabetes, and this screen's
      // readers are the clinic's own staff.
      await pump(
        tester,
        _screen(
          status: _status({
            'plan': 'essential',
            'limits': {'patients': 1000, 'staff': 10, 'locations': 1},
            'usage': {'patients': 900, 'staff': 10, 'locations': 1},
            'canPay': true,
          }),
        ),
      );

      expect(find.text('Full'), findsWidgets);
      expect(find.text('Nearly full'), findsWidgets);
    });
  });

  group('what the screen will not claim', () {
    testWidgets('a never-confirmed subscription says so', (tester) async {
      await pump(
        tester,
        _screen(
          status: _status({
            'plan': 'professional',
            'subscription': {
              'id': 's1',
              'plan': 'professional',
              'status': 'active',
              // No confirmedAt. A webhook that never arrived.
            },
            'canPay': true,
          }),
        ),
      );

      expect(find.text('Never confirmed by Razorpay'), findsOneWidget);
    });

    testWidgets('a halt says nothing has been taken away', (tester) async {
      // Honest only while the server really does nothing on `halted`. If that
      // policy is ever chosen, this test is the reminder that the copy moves
      // with it.
      await pump(
        tester,
        _screen(
          status: _status({
            'plan': 'professional',
            'subscription': {'id': 's1', 'plan': 'professional', 'status': 'halted'},
            'canPay': true,
          }),
        ),
      );

      expect(find.text('Payment failed'), findsOneWidget);
      expect(find.textContaining('Nothing has been taken away'), findsOneWidget);
    });

    testWidgets('test mode is stated, not hidden', (tester) async {
      await pump(
        tester,
        _screen(
          status: _status({'plan': 'trial', 'canPay': true, 'testMode': true}),
        ),
      );
      expect(find.textContaining('Test mode'), findsOneWidget);
    });

    testWidgets('a server that cannot take money offers no button', (tester) async {
      await pump(
        tester,
        _screen(status: _status({'plan': 'trial', 'canPay': false})),
      );

      expect(find.text('Payments are not set up'), findsOneWidget);
      expect(find.textContaining('Choose '), findsNothing);
    });
  });

  group('who may buy', () {
    testWidgets('without MANAGE_STAFF the reason is on screen', (tester) async {
      // Not just missing buttons. Somebody who cannot see why assumes the
      // screen is broken.
      await pump(
        tester,
        _screen(
          status: _status({'plan': 'trial', 'canPay': true}),
          mayPay: false,
        ),
      );

      expect(find.textContaining('manages staff'), findsOneWidget);
      expect(find.textContaining('Choose '), findsNothing);
    });

    testWidgets('with it, the tiers are offered', (tester) async {
      await pump(
        tester,
        _screen(status: _status({'plan': 'trial', 'canPay': true})),
      );

      expect(find.text('Choose Essential'), findsOneWidget);
      expect(find.text('Choose Professional'), findsOneWidget);
      expect(find.text('Choose Enterprise'), findsOneWidget);
    });

    testWidgets('and the current plan is not offered back', (tester) async {
      await pump(
        tester,
        _screen(status: _status({'plan': 'professional', 'canPay': true})),
      );

      expect(find.text('Choose Professional'), findsNothing);
      expect(find.text('Current'), findsOneWidget);
    });
  });

  group('the text scaler', () {
    testWidgets('nothing overflows a notch up', (tester) async {
      // "Unlimited patients and people" is the longest line here and the one
      // that clipped when the tile had a fixed height.
      tester.view.physicalSize = const Size(360 * 3, 800 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
          child: _screen(
            status: _status({
              'plan': 'trial',
              'limits': {'patients': 1000, 'staff': 10, 'locations': 1},
              'usage': {'patients': 312, 'staff': 4, 'locations': 1},
              'canPay': true,
              'testMode': true,
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
