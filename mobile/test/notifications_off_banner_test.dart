import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/push/notifications_off_banner.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/auth/data/auth_repository.dart';
import 'package:medpin/features/auth/domain/user.dart';
import 'package:medpin/features/auth/presentation/auth_controller.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/services/notification_service.dart';

/// A phone that will not show MedPin's notifications says so, on every
/// screen, to whoever is signed in — and "Turn on" gets them turned on.
///
/// Before this, a copy of the app whose permission prompt had been dismissed
/// looked exactly like one that worked, and everything sent to it was lost.

/// A phone whose notifications are [block]ed, or not.
class _Phone extends NotificationGate {
  _Phone(this.block, {this.promptAllows = false, this.promptThrows = false});

  /// The plugin refuses the request (`permissionRequestInProgress`).
  final bool promptThrows;

  NotificationBlock? block;

  /// Whether Android still shows its prompt, and the person taps "Allow".
  final bool promptAllows;

  int asked = 0;
  final opened = <NotificationBlock>[];

  @override
  Future<NotificationBlock?> whatBlocks() async => block;

  @override
  Future<bool> ask() async {
    asked++;
    if (promptThrows) {
      throw PlatformException(
        code: 'permissionRequestInProgress',
        message: 'Another permission request is already in progress',
      );
    }
    if (promptAllows) block = null;
    return block == null;
  }

  @override
  Future<void> openSettings(NotificationBlock b) async => opened.add(b);
}

/// Never answers, so the controller's own start-up never replaces the state.
class _PendingStore extends SecureStore {
  @override
  Future<String?> readAccessToken() => Completer<String?>().future;
}

class _SignedIn extends AuthController {
  _SignedIn()
    : super(
        AuthRepository(ApiClient(secureStore: SecureStore()), SecureStore()),
        _PendingStore(),
      ) {
    state = const AuthState.authenticated(
      AppUser(
        id: 'd1',
        name: 'Dr Sen',
        phone: '+919800000000',
        role: 'doctor',
        language: 'en',
      ),
    );
  }
}

class _SignedOut extends AuthController {
  _SignedOut()
    : super(
        AuthRepository(ApiClient(secureStore: SecureStore()), SecureStore()),
        _PendingStore(),
      ) {
    state = const AuthState.unauthenticated();
  }
}

Future<void> _open(
  WidgetTester tester,
  _Phone phone, {
  bool signedIn = true,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        notificationGateProvider.overrideWithValue(phone),
        authControllerProvider.overrideWith(
          (ref) => signedIn ? _SignedIn() : _SignedOut(),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        // Where the app puts it: above the navigator, outside every Scaffold.
        builder: (context, child) => NotificationsOffBanner(child: child!),
        home: Builder(
          builder:
              (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed:
                        () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder:
                                (_) => const Scaffold(
                                  body: Text('A patient thread'),
                                ),
                          ),
                        ),
                    child: const Text('Open a thread'),
                  ),
                ),
              ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _comeBackToTheApp(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpAndSettle();
}

const _off = 'Notifications are off on this phone';

void main() {
  testWidgets('a signed-in phone with notifications blocked says so', (
    tester,
  ) async {
    await _open(tester, _Phone(NotificationBlock.app));
    expect(find.text(_off), findsOneWidget);
    expect(find.text('Open a thread'), findsOneWidget, reason: 'the app is still usable under it');
  });

  testWidgets('nothing is shown where notifications work', (tester) async {
    await _open(tester, _Phone(null));
    expect(find.text(_off), findsNothing);
  });

  testWidgets('nor before anyone has signed in', (tester) async {
    await _open(tester, _Phone(NotificationBlock.app), signedIn: false);
    expect(find.text(_off), findsNothing);
  });

  testWidgets('"Turn on" asks, and an "Allow" takes the strip away', (
    tester,
  ) async {
    final phone = _Phone(NotificationBlock.app, promptAllows: true);
    await _open(tester, phone);
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(phone.asked, 1);
    expect(phone.opened, isEmpty);
    expect(find.text(_off), findsNothing);
  });

  testWidgets(
    'once Android stops asking, "Turn on" opens the settings, and coming back with them on clears it',
    (tester) async {
      final phone = _Phone(NotificationBlock.app);
      await _open(tester, phone);
      await tester.tap(find.text('Turn on'));
      await tester.pumpAndSettle();
      expect(phone.opened, [NotificationBlock.app]);
      expect(find.text(_off), findsOneWidget);

      phone.block = null; // turned on in the phone's settings
      await _comeBackToTheApp(tester);
      expect(find.text(_off), findsNothing);
    },
  );

  testWidgets('a blocked message channel goes straight to that channel', (
    tester,
  ) async {
    final phone = _Phone(NotificationBlock.channel);
    await _open(tester, phone);
    expect(find.text(_off), findsOneWidget);
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(phone.asked, 0, reason: 'the prompt cannot turn a channel back on');
    expect(phone.opened, [NotificationBlock.channel]);
  });

  testWidgets('it can be put away until the app is next opened', (
    tester,
  ) async {
    // Found by what a screen reader announces, which is also what makes the
    // close button usable by one.
    final semantics = tester.ensureSemantics();
    await _open(tester, _Phone(NotificationBlock.app));
    await tester.tap(find.bySemanticsLabel('Not now'));
    await tester.pumpAndSettle();
    expect(find.text(_off), findsNothing);
    semantics.dispose();
  });

  testWidgets('the screen underneath survives the strip going away', (
    tester,
  ) async {
    final phone = _Phone(NotificationBlock.app, promptAllows: true);
    await _open(tester, phone);
    await tester.tap(find.text('Open a thread'));
    await tester.pumpAndSettle();
    expect(find.text('A patient thread'), findsOneWidget);

    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(find.text(_off), findsNothing);
    expect(
      find.text('A patient thread'),
      findsOneWidget,
      reason: 'the strip going away closed the screen the person was on',
    );
  });

  testWidgets('when the prompt cannot be shown, "Turn on" opens the settings instead of doing nothing', (
    tester,
  ) async {
    // The plugin throws permissionRequestInProgress while a request it started
    // is unanswered. That escaped the handler, and the button did nothing.
    final phone = _Phone(NotificationBlock.app, promptThrows: true);
    await _open(tester, phone);
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(phone.asked, 1);
    expect(phone.opened, [NotificationBlock.app]);

    phone.block = null; // turned on in the phone's settings
    await _comeBackToTheApp(tester);
    expect(find.text(_off), findsNothing);
  });
}
