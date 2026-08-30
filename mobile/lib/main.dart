import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'app.dart';
import 'shared/providers/core_providers.dart';
import 'shared/services/notification_service.dart';
import 'core/session/session_reset.dart';

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
  registerSessionContainer(container);

  runApp(UncontrolledProviderScope(container: container, child: const App()));
}
