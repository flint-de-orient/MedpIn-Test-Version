import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'app.dart';
import 'shared/providers/core_providers.dart';
import 'shared/services/notification_service.dart';
import 'core/session/session_reset.dart';
import 'shared/providers/app_lock_provider.dart';
import 'shared/providers/theme_provider.dart';
import 'shared/providers/locale_provider.dart';
import 'features/auth/presentation/auth_controller.dart';
import 'core/router/app_router.dart';
import 'core/update/build_info.dart';

/// Handles a push that arrives while the app is terminated or backgrounded.
///
/// Must be a top-level function: Android runs it in a separate isolate with no
/// access to anything the UI set up. It deliberately does almost nothing —
/// FCM already displays the notification itself, and the tap is handled once
/// the app is alive.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
  // A data-only medication reminder must be drawn by us — FCM only auto-displays
  // messages that carry a notification block. Rendered with the same id the
  // on-device alarm uses, so if both arrive they collapse into one.
  if (message.data['kind'] == 'medication_reminder') {
    await NotificationService.showMedicationReminderFromBackground(
      message.data,
    );
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Which build this is, from the platform rather than the build flags — so
  // Profile shows the version actually installed and the update check can
  // compare, whichever command produced the APK.
  await BuildInfo.load();

  final prefs = await SharedPreferences.getInstance();

  // Before runApp: a notification tapped from a cold start is delivered during
  // startup, and Firebase has to be ready to receive it.
  await Firebase.initializeApp();
  FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);

  // Set up local notifications (and ask for permission on Android 13+) up front,
  // so the channel exists before the first appointment update fires.
  await NotificationService.instance.init();

  // Built here rather than by ProviderScope, so the container can be handed to
  // the session reset. Riverpod 2's Ref cannot reach its own container, and
  // ProviderScope.containerOf needs a BuildContext — which the auth controller,
  // where sign-in and sign-out happen, does not have.
  final container = ProviderContainer(
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
  );
  // Named here rather than in session_reset.dart, because identity is the only
  // way a keep-list cannot silently fail — and this file already imports them.
  //
  // Everything absent from this set is thrown away when the session changes,
  // which is the point: a provider added next month is covered without anyone
  // remembering to come back here.
  registerSessionContainer(
    container,
    keep: {
      // The session itself. Invalidating it during sign-in resets the state
      // this is being called from — which left the app spinning on the splash
      // screen with nothing in the logs, because nothing had failed except
      // that the answer kept being discarded before it could be used.
      authControllerProvider,
      // And what it watches. This is the rule that is easy to miss and hard to
      // debug: invalidating a provider rebuilds everything that WATCHES it, so
      // keeping the auth controller while dropping its repository rebuilds the
      // controller anyway — from inside the sign-in that called the reset. The
      // controller is then disposed mid-flight and the app returns to
      // "unknown", which is a splash screen that never resolves.
      //
      // So the keep-list has to be closed under "watches": everything a kept
      // provider depends on is kept too. apiClientProvider, secureStoreProvider
      // and sharedPreferencesProvider are below for the same reason.
      authRepositoryProvider,
      // Chosen before anyone signs in and still true after. Dropping these
      // would flip a Bengali reader's app to English on sign-out.
      localeControllerProvider,
      themeControllerProvider,
      appLockProvider,
      // Infrastructure, not data — a token store, an HTTP client, the
      // preferences box. None holds a patient's anything, and recreating them
      // mid-flight tears the socket out from under the request that is signing
      // somebody in.
      sharedPreferencesProvider,
      secureStoreProvider,
      apiClientProvider,
      imageAuthHeaderProvider,
      // The router holds rootNavigatorKey, a global GlobalKey; recreating it
      // while the old one is mounted throws, during exactly this transition.
      // It does not need recreating: signing out redirects to /login, outside
      // every shell, so GoRouter disposes the shells and their branch stacks.
      appRouterProvider,
    },
  );

  runApp(UncontrolledProviderScope(container: container, child: const App()));
}
