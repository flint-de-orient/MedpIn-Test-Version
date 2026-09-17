import 'dart:async';
import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';
import '../../shared/providers/core_providers.dart';
import '../../shared/services/notification_service.dart';
import '../router/app_router.dart';
import 'chat_push_signal.dart';

/// Registers this device for push and keeps its token current on the server.
///
/// Delivery matters more here than in most apps: the same channel carries a
/// medication reminder and the alert that a patient has reported chest pain.
/// So registration failures are logged and retried on the next launch rather
/// than being allowed to fail silently.
class PushService {
  PushService(this._ref);

  final Ref _ref;
  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _onMessage;
  StreamSubscription<RemoteMessage>? _onOpened;

  /// Called once the user is signed in — a token is only useful when the
  /// server knows whose device it belongs to.
  Future<void> start() async {
    final messaging = FirebaseMessaging.instance;

    // Android 13+ requires this at runtime. Declining is a legitimate choice;
    // the app must keep working, so the result is recorded and not enforced.
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('push: permission denied — notifications will not arrive');
      return;
    }

    final token = await messaging.getToken();
    if (token != null) await _register(token);

    // FCM rotates tokens on reinstall, restore and occasionally on its own. A
    // stale token silently swallows every notification, so the rotation is
    // followed rather than read once at startup.
    _tokenRefresh?.cancel();
    _tokenRefresh = messaging.onTokenRefresh.listen(_register);

    _wireNotificationHandlers();
  }

  /// Wires the three ways a notification reaches a signed-in app: foreground
  /// (Android won't show it, so we do), a tap that resumed the app, and a tap
  /// that cold-started it. Re-runnable — subscriptions are replaced, not stacked.
  void _wireNotificationHandlers() {
    NotificationService.instance.onNotificationTap = _routeFromPayload;

    // Foreground: FCM does not display a notification while the app is open, so
    // surface it ourselves and carry the routing data as the tap payload.
    _onMessage?.cancel();
    _onMessage = FirebaseMessaging.onMessage.listen((m) {
      // Data-only medication reminder: render it with the SAME id as the local
      // alarm so the two collapse instead of double-reminding.
      if (m.data['kind'] == 'medication_reminder') {
        final id = int.tryParse(m.data['notifId']?.toString() ?? '');
        if (id != null) {
          NotificationService.instance.showMedicationReminder(
            id: id,
            name: m.data['name']?.toString() ?? 'your medicine',
            medId: m.data['medicationId']?.toString(),
            dose: m.data['dose']?.toString(),
            relationToMeal: m.data['relationToMeal']?.toString(),
            time: m.data['time']?.toString(),
          );
        }
        return;
      }
      // Tell an open chat screen to go and read the message.
      //
      // This is what makes a reply appear while the patient is looking at the
      // thread. Before it, foreground FCM raised a banner and nothing else, so
      // the screen learned about the message only when its two-second poll
      // happened to succeed — and every failure in that poll is swallowed by
      // design, so when it stopped working the thread just went quiet.
      ChatPushSignal.instance.fromPushData(m.data);

      final n = m.notification;
      if (n == null) return;
      NotificationService.instance.show(
        title: n.title ?? 'MedPin',
        body: n.body ?? '',
        payload: jsonEncode(m.data),
      );
    });

    // A tap that brought the app back from the background.
    _onOpened?.cancel();
    _onOpened = FirebaseMessaging.onMessageOpenedApp.listen(
      (m) => _routeFromData(m.data),
    );

    // A tap that cold-started the app from a terminated state. Delayed a beat so
    // the post-login route settles before the conversation is pushed on top.
    FirebaseMessaging.instance.getInitialMessage().then((m) {
      if (m != null) {
        Future.delayed(
          const Duration(milliseconds: 700),
          () => _routeFromData(m.data),
        );
      }
    });
  }

  void _routeFromPayload(String payload) {
    // Medication reminders carry a "med:<id>" payload, not routable JSON.
    if (payload.startsWith('med:')) return;
    try {
      final decoded = jsonDecode(payload);
      if (decoded is Map) {
        _routeFromData(decoded.map((k, v) => MapEntry(k.toString(), v)));
      }
    } catch (_) {
      // Not a routable payload — ignore rather than crash on a tap.
    }
  }

  /// Opens the conversation a notification is about. A patient only ever gets a
  /// clinician reply, so their tap opens their own chat; a clinician's tap opens
  /// the patient thread the alert or message named (or the alert list if none).
  void _routeFromData(Map<String, dynamic> data) {
    final user = _ref.read(authControllerProvider).user;
    if (user == null) return;
    final router = _ref.read(appRouterProvider);

    if (user.role == 'patient') {
      // Route the tap to the screen the nudge is about; anything unrecognised
      // opens the chat, which is always a safe place to land.
      switch (data['kind']?.toString()) {
        case 'prescription':
        case 'medication_change':
          router.go('/medications');
        case 'glucose_checkin':
          router.go('/home');
        case 'lab_upload':
          router.go('/profile/tests');
        // The dietician's thread, which lives at /food-log rather than /chat.
        //
        // These fell through to the care thread, so a patient tapping "your
        // dietician replied" landed in the doctor's conversation and found
        // nothing new there — the message they were told about was one screen
        // away, in a thread the notification never mentioned.
        case 'dietician_reply':
        case 'nutrition_message':
        case 'nutrition':
          router.go('/food-log');
        // Anything about a time: when it is, that it moved, that one opened.
        case 'appointment_change_patient':
        case 'appointment_tomorrow':
        case 'slot_freed':
          router.go('/appointments');
        // A clinic or MedPin answered their feedback: where replies are read.
        case 'feedback_reply':
          router.go('/profile/feedback/mine');
        // A clinic asking to see more, or the questions asked once when a clinic
        // is connected: both are answered on "Who can see my records?".
        case 'share_request':
        case 'sharing_question':
          router.go('/profile/sharing');
        // The care thread is the safe landing for anything unrecognised — it
        // is where the clinic talks to them, and an older app meeting a newer
        // server ends up here rather than nowhere.
        default:
          router.go('/chat');
      }
      return;
    }
    // The area this account is allowed into.
    //
    // Everything here pushed `/clinician/...` outright, so on a front-desk
    // phone every notification that did arrive was a tap onto a blank page —
    // the router bounces staff out of that tree. Half of "notifications do not
    // work for the clinic panel" was notifications that worked and then went
    // nowhere.
    final area = user.role == 'staff' ? '/staff' : '/clinician';

    // The doctor's own day, not a patient. These carry no patientId and used
    // to fall through to the alerts screen, which is a list of clinical alarms
    // and says nothing about tomorrow's list.
    final kind = data['kind']?.toString();
    if (kind == 'schedule_digest') {
      router.go(area == '/staff' ? '/staff/today' : '/clinician/appointments');
      return;
    }

    // The evening summary of the day's conversations. It names no patient —
    // the list is where they are.
    if (kind == 'chat_digest') {
      router.go(area == '/staff' ? '/staff/today' : '/clinician/chat-summaries');
      return;
    }

    // A practice this account now owns has been set up. Its own screen is
    // where the locations, hours and people are — not the alert list.
    if (kind == 'practice_ready') {
      router.go(area == '/staff' ? '/staff/today' : '/clinician/practice');
      return;
    }

    // Patient feedback. It names nobody on the lock screen, and the inbox is
    // where it is read — under whichever prefix this account is allowed into.
    if (kind == 'patient_feedback') {
      router.push('$area/feedback');
      return;
    }

    final patientId = data['patientId']?.toString();
    if (patientId != null && patientId.isNotEmpty) {
      router.push('$area/patients/$patientId/thread');
    } else if (area == '/staff') {
      // No alerts screen on the desk's side, and there should not be —
      // resolving an alert is a clinical act. Today is where a receptionist
      // can actually do something about what they were just told.
      router.go('/staff/today');
    } else {
      router.push('/clinician/alerts');
    }
  }

  Future<void> _register(String token) async {
    try {
      await _ref
          .read(apiClientProvider)
          .postJson('/auth/device-token', body: {'token': token});
    } catch (e) {
      // Not fatal: the next launch re-registers. Worth logging, because a
      // patient whose token never registers simply stops receiving alerts and
      // nothing else would reveal it.
      debugPrint('push: could not register device token — $e');
    }
  }

  /// Detaches the token on sign-out so the next person to use this device does
  /// not receive the previous patient's clinical notifications.
  Future<void> stop() async {
    await _tokenRefresh?.cancel();
    _tokenRefresh = null;
    await _onMessage?.cancel();
    _onMessage = null;
    await _onOpened?.cancel();
    _onOpened = null;
    NotificationService.instance.onNotificationTap = null;

    // Two separate attempts, deliberately.
    //
    // These were one try block, and the server call is the one that fails:
    // by the time sign-out reaches here the credentials it needs are already
    // cleared, so the DELETE 401s, throws, and took `deleteToken` down with
    // it. The device therefore kept a live FCM token and the server kept
    // pushing dose reminders to a signed-out phone — which is exactly the
    // symptom, and why local cancellation alone never fixed it.
    //
    // Deleting the token locally is the half that actually stops delivery, so
    // it must not depend on the half that talks to a server we may no longer
    // be authorised to call.
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _ref
            .read(apiClientProvider)
            .delete('/auth/device-token', body: {'token': token});
      }
    } catch (e) {
      debugPrint('push: could not tell the server to detach this device — $e');
    }
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (e) {
      debugPrint('push: could not delete the local FCM token — $e');
    }
  }
}

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));
