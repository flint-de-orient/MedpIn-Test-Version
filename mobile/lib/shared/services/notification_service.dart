import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

/// Handles a tap on a reminder's action button while the app is not running.
///
/// Android delivers these into a separate background isolate, so nothing from
/// the app's state is reachable here — the snooze re-schedules through a fresh
/// plugin instance rather than through [NotificationService].
@pragma('vm:entry-point')
void medicationActionHandler(NotificationResponse response) {
  if (response.actionId != NotificationService.snoozeActionId) return;
  final payload = response.payload;
  NotificationService.scheduleSnoozeFromBackground(payload);
}

/// One dose to remind about, with a deterministic notification [id].
///
/// Either a daily repeat ([repeatsDaily]: one alarm per medicine and time, for a
/// medicine taken every day with no end) or a single alarm for one dose on one
/// date (everything else — see `buildUpcomingDoses`). The service stays
/// unaware of the API model, a re-sync replaces rather than duplicates, and a
/// server push for the same dose collapses onto the same [id].
class ScheduledDose {
  const ScheduledDose({
    required this.id,
    required this.medId,
    required this.name,
    required this.when,
    this.dose,
    this.relationToMeal,
    this.repeatsDaily = true,
  });

  /// True: [when] is the first time, and the alarm repeats at that clock time
  /// every day. False: [when] is the one dose this alarm is for.
  final bool repeatsDaily;

  /// Deterministic notification id in the medication reserved range, stable for
  /// a given (medicine, slot time, day) — see `medReminderNotificationId`.
  final int id;
  final String medId;
  final String name;

  /// Absolute local time the dose is due. The alarm fires [leadTime] earlier.
  final DateTime when;
  final String? dose;
  final String? relationToMeal;
}

/// The deterministic notification id for one dose on one day, shared by the
/// on-device alarm and the server-sent FCM push so the two collapse into a
/// single notification instead of double-reminding. FNV-1a over
/// `medId|HH:mm|yyyy-MM-dd`, folded into the medication reserved id range. The
/// backend computes the identical value (see backend medReminder id helper).
int medReminderNotificationId(String medId, String hhmm, DateTime day) {
  final dateStr =
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  final key = '$medId|$hhmm|$dateStr';
  var hash = 0x811c9dc5;
  for (final c in key.codeUnits) {
    hash ^= c;
    hash = (hash * 0x01000193) & 0xFFFFFFFF;
  }
  return NotificationService.medIdBase +
      (hash % NotificationService.medIdWindow);
}

/// The id for ONE dose on ONE date — a single alarm rather than a daily repeat.
///
/// Identical to `medOccurrenceNotificationId` in backend/src/utils/medReminderId.js
/// (pinned by the same fixtures on both sides), so the server's push for this
/// dose collapses onto this alarm. Its own wide range: a fortnight of single
/// alarms folded into the daily range's 90 000 would collide — one alarm
/// silently replacing another — about one time in three.
int medOccurrenceReminderId(String medId, String hhmm, DateTime day) {
  final dateStr =
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  final key = '$medId|$hhmm|$dateStr';
  var hash = 0x811c9dc5;
  for (final c in key.codeUnits) {
    hash ^= c;
    hash = (hash * 0x01000193) & 0xFFFFFFFF;
  }
  return NotificationService.medOccurrenceIdBase +
      (hash % NotificationService.medOccurrenceIdSpan);
}

/// A stable per-(medicine, slot-time) id for a DAILY-repeating reminder — no
/// date in the key, so the single alarm repeats every day and never needs
/// re-arming (the reason a morning dose stopped firing under the rolling-window
/// scheme when the app wasn't reopened overnight).
int medDailyReminderId(String medId, String hhmm) {
  final key = '$medId|$hhmm';
  var hash = 0x811c9dc5;
  for (final c in key.codeUnits) {
    hash ^= c;
    hash = (hash * 0x01000193) & 0xFFFFFFFF;
  }
  return NotificationService.medIdBase +
      (hash % NotificationService.medIdWindow);
}

/// Local notifications: short in-the-moment updates via [show], and repeating
/// medication reminders via [scheduleMedicationReminders].
///
/// The medication reminders are *scheduled on the device* (Android exact
/// alarms), so "time to take your medicine" fires at the right minute even when
/// the app is closed or the phone has been idle — no server, push, or network
/// needed at reminder time.
/// Whether the medication reminders on this phone will actually fire.
///
/// Every field is a fact read from the platform, not a guess.
class ReminderHealth {
  const ReminderHealth({
    required this.expected,
    required this.armed,
    required this.notificationsAllowed,
    required this.exactAlarmsAllowed,
  });

  /// Doses that should have an alarm — one per distinct medicine time.
  final int expected;

  /// Alarms the platform says are actually pending in the reserved id range.
  final int armed;

  /// Android 13+ runtime permission. False means nothing can be shown at all,
  /// alarm or push.
  final bool notificationsAllowed;

  /// Android 12+ exact-alarm gate. False is survivable — timing drifts to
  /// whenever Doze next wakes — so it is a warning, not a failure.
  final bool exactAlarmsAllowed;

  /// The one that matters: medicines exist and nothing is going to ring.
  ///
  /// Not `armed < expected`. A partially armed set is worth knowing about but
  /// is not the emergency; zero is, and saying "some reminders may be missing"
  /// about a phone that is working fine is how a warning gets ignored on the
  /// day it is true.
  bool get silent => expected > 0 && armed == 0;

  /// Something a person should be told, even if alarms are arming.
  bool get degraded => !notificationsAllowed || !exactAlarmsAllowed;

  bool get healthy => !silent && !degraded;
}

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _ready = false;
  int _id = 0;

  /// Invoked when the user taps a notification this service showed, with that
  /// notification's payload. Set by the push layer so a tap can open the right
  /// conversation. The payload is the FCM data map as JSON, or `med:<id>` for a
  /// medication reminder.
  void Function(String payload)? onNotificationTap;

  /// Medication reminder ids live in a reserved range so cancelling/replacing
  /// the whole set never touches the ids [show] hands out.
  static const int medIdBase = 700000;
  static const int _medIdSpan = 100000;

  /// Hashing modulo for a dose's deterministic id — kept below [_medIdSpan] so a
  /// hashed id can never leave the reserved medication range.
  static const int medIdWindow = 90000;

  /// Single-dose alarms: see [medOccurrenceReminderId]. Far above every other
  /// id this app uses, and below the 32-bit limit Android ids live in.
  static const int medOccurrenceIdBase = 10000000;
  static const int medOccurrenceIdSpan = 1000000000;

  /// Whether [id] is a medication reminder of either kind — what a re-sync
  /// cancels and what the health check counts.
  static bool isMedicationReminderId(int id) =>
      (id >= medIdBase && id < medIdBase + _medIdSpan) ||
      (id >= medOccurrenceIdBase &&
          id < medOccurrenceIdBase + medOccurrenceIdSpan);

  /// Snoozes sit outside the daily range so re-syncing the schedule (which
  /// cancels that whole range) does not silently drop a dose the patient just
  /// pushed back by ten minutes.
  static const int _snoozeIdBase = 900000;

  /// The single, gentle check-in reminder. Above the medication range (which is
  /// cancelled and rebuilt wholesale on every sync) and below the snooze range,
  /// so re-syncing medicines never drops the check-in nudge.
  static const int _checkInId = 850000;

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'clinq_updates',
    'MedPin updates',
    description: 'Appointments and messages from the clinic',
    importance: Importance.high,
  );

  /// Fires five minutes ahead of the dose so the patient can reach the medicine
  /// before it is due, rather than being told they are already late.
  static const Duration leadTime = Duration(minutes: 5);

  /// How long the alarm keeps ringing if nobody touches it. Long enough to be
  /// heard from another room, short enough not to wake a household when the
  /// patient is out — after this Android cancels it and the sound stops.
  static const Duration ringFor = Duration(minutes: 3);

  static const String stopActionId = 'med_stop';
  static const String snoozeActionId = 'med_snooze';
  static const Duration snoozeFor = Duration(minutes: 10);

  /// A *new* channel id, not a reworked `clinq_meds`.
  ///
  /// Android freezes a channel's sound and importance the first time it is
  /// created and ignores every later change, so a phone that already had the
  /// old quiet channel would have gone on chiming once however this code was
  /// written. Alarm usage also means the reminder follows the alarm volume,
  /// which is the one people leave up overnight.
  static const AndroidNotificationChannel _medsChannel =
      AndroidNotificationChannel(
        'clinq_meds_alarm',
        'Medication alarms',
        description: 'Rings when it is time to take a medicine',
        importance: Importance.max,
        playSound: true,
        enableVibration: true,
        audioAttributesUsage: AudioAttributesUsage.alarm,
      );

  /// A deliberately gentle channel — default importance, ordinary sound, no
  /// alarm behaviour — so a nudge to check in never feels like the medication
  /// alarm. Nagging is exactly what makes people mute reminders, and a muted
  /// reminder helps no one.
  static const AndroidNotificationChannel _checkInChannel =
      AndroidNotificationChannel(
        'clinq_checkin',
        'Check-in reminders',
        description: 'A gentle nudge to log a glucose reading',
        importance: Importance.defaultImportance,
      );

  /// Safe to call more than once; the first call does the work.
  Future<void> init() async {
    if (_ready) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: android);
    await _plugin.initialize(
      settings,
      // A tap on a notification we showed (a foreground push, or a med reminder)
      // routes through the push layer, which opens the relevant conversation.
      onDidReceiveNotificationResponse: (resp) {
        if (resp.actionId == snoozeActionId) {
          scheduleSnoozeFromBackground(resp.payload);
          return;
        }
        // Stop only needs the notification gone, which the action itself does.
        if (resp.actionId == stopActionId) return;
        final payload = resp.payload;
        if (payload != null && payload.isNotEmpty)
          onNotificationTap?.call(payload);
      },
      // Action taps while the app is dead arrive in a background isolate;
      // without this handler Stop and Snooze would do nothing outside the app.
      onDidReceiveBackgroundNotificationResponse: medicationActionHandler,
    );

    final android_ =
        _plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();
    await android_?.createNotificationChannel(_channel);
    await android_?.createNotificationChannel(_medsChannel);
    await android_?.createNotificationChannel(_checkInChannel);
    // Android 13+ requires an explicit runtime permission for notifications.
    await android_?.requestNotificationsPermission();
    // Android 12+ gate for exact alarms. A medicine reminder that fires whenever
    // Doze next wakes is useless, so we ask for exact timing.
    await android_?.requestExactAlarmsPermission();

    tz_data.initializeTimeZones();
    // The clinic and its patients are in India; medication times are IST wall
    // clock. Pinning the zone keeps reminders correct without a native
    // timezone plugin.
    tz.setLocalLocation(tz.getLocation('Asia/Kolkata'));

    _ready = true;
  }

  /// Reads the platform to find out whether reminders will fire.
  ///
  /// [expected] is how many the app believes it armed — the caller has the
  /// medicine list, this class does not.
  ///
  /// `pendingNotificationRequests` is the honest source: it is what Android
  /// will actually act on, rather than what this app remembers asking for.
  /// Those two disagree exactly when it matters — a withheld permission, an
  /// OEM battery manager clearing the alarm table, a force-stop — and it is
  /// the disagreement that has to reach a person.
  Future<ReminderHealth> reminderHealth({required int expected}) async {
    await init();
    final android =
        _plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();

    var armed = 0;
    try {
      for (final p in await _plugin.pendingNotificationRequests()) {
        if (isMedicationReminderId(p.id)) armed++;
      }
    } catch (_) {
      // Reading the pending list can throw on some OEM builds. An unknown
      // count must not be reported as zero — that would put a red banner on a
      // working phone, which is the fastest way to teach someone to ignore it.
      armed = expected;
    }

    return ReminderHealth(
      expected: expected,
      armed: armed,
      // Null means the platform would not say. Treated as allowed: this drives
      // a warning, and a warning shown on a "don't know" is a warning shown to
      // everybody.
      notificationsAllowed: await android?.areNotificationsEnabled() ?? true,
      exactAlarmsAllowed: await android?.canScheduleExactNotifications() ?? true,
    );
  }

  /// Re-requests the runtime permissions reliable alarms need, and reports
  /// whether exact alarms are permitted afterwards (false → schedules fall back
  /// to inexact timing). Safe to call from a "make reminders reliable" prompt.
  Future<bool> ensureAlarmPermissions() async {
    await init();
    final android =
        _plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();
    await android?.requestNotificationsPermission();
    await android?.requestExactAlarmsPermission();
    return await android?.canScheduleExactNotifications() ?? true;
  }

  /// Show a notification now. Keep [title]/[body] short and specific. [payload]
  /// (an FCM data map as JSON) is handed back to [onNotificationTap] on tap, so
  /// the app can open the conversation the notification is about.
  Future<void> show({
    required String title,
    required String body,
    String? payload,
  }) async {
    await init();
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'clinq_updates',
        'MedPin updates',
        channelDescription: 'Appointments and messages from the clinic',
        importance: Importance.high,
        priority: Priority.high,
      ),
    );
    _id = (_id + 1) % 100000;
    await _plugin.show(_id, title, body, details, payload: payload);
  }

  /// Rebuilds the medication reminder set from [doses]: one daily-repeating
  /// alarm per distinct slot time, anchored at the next occurrence.
  ///
  /// This said the opposite until now — "a rolling window of concrete, per-day
  /// dose alarms (not a blind daily-repeat), so a slot the patient has already
  /// taken can simply be left out". It is a blind daily repeat, it does not
  /// skip taken slots, and [buildUpcomingDoses] ignores dose status entirely.
  /// The design changed on purpose: a repeat survives a reboot and needs no
  /// re-arming overnight, which is worth more than one that can be silenced for
  /// a day. Three comments in this path described the old design; this was the
  /// last of them, and the worst placed, because it sat on the function itself.
  ///
  /// Cancels the previous set first, so a re-timed schedule takes effect
  /// immediately. Idempotent.
  ///
  /// ---- The window this opens ------------------------------------------
  ///
  /// Cancel-then-re-arm means that between the two, the patient has no alarms
  /// at all. If the re-arm fails — a withheld notification permission, an OEM
  /// battery restriction — they are left with none, and the only report is the
  /// [debugPrint] below, which reaches logcat and no human being.
  ///
  /// The count returned is how a caller detects that.
  /// [refreshAndScheduleMedicationReminders] uses it to retry with backoff;
  /// the two `syncMedicationReminders` call sites in the medications screen
  /// still discard it. Nothing yet tells the patient. See the note there.
  Future<int> scheduleMedicationReminders(List<ScheduledDose> doses) async {
    await init();

    // Drop the previous medication set — both kinds, and nothing else. A
    // stopped or finished medicine's alarms go here, which is how they stop.
    for (final p in await _plugin.pendingNotificationRequests()) {
      if (isMedicationReminderId(p.id)) {
        await _plugin.cancel(p.id);
      }
    }

    final now = tz.TZDateTime.now(tz.local);
    final details = alarmDetails();
    var armed = 0;
    for (final d in doses) {
      if (!isMedicationReminderId(d.id)) continue; // stay in range

      tz.TZDateTime fireAt;
      if (d.repeatsDaily) {
        // Anchor the daily repeat at the next occurrence of this dose's clock
        // time, [leadTime] early — or at its first dose, for a medicine that
        // starts later. `_armDose` repeats it every day, so it keeps firing
        // each morning without the app having to re-arm overnight.
        final first = tz.TZDateTime.from(d.when, tz.local).subtract(leadTime);
        fireAt = _nextInstanceOf(d.when.hour, d.when.minute).subtract(leadTime);
        if (!fireAt.isAfter(now)) fireAt = fireAt.add(const Duration(days: 1));
        if (first.isAfter(fireAt)) fireAt = first;
      } else {
        // One dose. Early by [leadTime] where there is still time for that; a
        // dose due in three minutes is reminded about now rather than never.
        final due = tz.TZDateTime.from(d.when, tz.local);
        if (!due.isAfter(now)) continue;
        fireAt = due.subtract(leadTime);
        if (!fireAt.isAfter(now)) fireAt = now.add(const Duration(seconds: 5));
      }
      if (await _armDose(d, fireAt, details)) armed++;
    }

    if (doses.isNotEmpty && armed == 0) {
      debugPrint(
        'medication reminders: armed 0 of ${doses.length} — check notification/exact-alarm permission',
      );
    }
    return armed;
  }

  /// Arms one dose, falling back from exact to inexact timing when the device
  /// withholds the exact-alarm permission — a reminder a few minutes off beats
  /// no reminder at all.
  Future<bool> _armDose(
    ScheduledDose d,
    tz.TZDateTime fireAt,
    NotificationDetails details,
  ) async {
    const modes = [
      AndroidScheduleMode.exactAllowWhileIdle,
      AndroidScheduleMode.inexactAllowWhileIdle,
    ];
    for (final mode in modes) {
      try {
        await _plugin.zonedSchedule(
          d.id,
          '${d.name} in ${leadTime.inMinutes} minutes',
          _doseBody(d),
          fireAt,
          details,
          androidScheduleMode: mode,
          // iOS-only, but a required param; absolute time is what we schedule.
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
          // Repeat every day at this clock time — survives reboot (boot receiver)
          // and needs no re-arming, so a morning dose fires every morning. A
          // single dose does not repeat: a weekly tablet repeated daily is a
          // daily reminder to take it.
          matchDateTimeComponents:
              d.repeatsDaily ? DateTimeComponents.time : null,
          payload: 'med:${d.medId}',
        );
        return true;
      } on PlatformException catch (e) {
        // Exact alarms not permitted → retry the same dose inexactly.
        if (mode == AndroidScheduleMode.exactAllowWhileIdle) {
          debugPrint(
            'exact alarm denied for ${d.name} (${e.code}); falling back to inexact',
          );
          continue;
        }
        debugPrint('dose alarm failed for ${d.name}: $e');
        return false;
      } catch (e) {
        debugPrint('dose alarm failed for ${d.name}: $e');
        return false;
      }
    }
    return false;
  }

  /// Renders a medication reminder that arrived as a server push (FCM), using
  /// the SAME id the on-device alarm uses for this dose so the two collapse into
  /// one notification instead of double-reminding. The backstop for when the OS
  /// dropped the local alarm (reboot, alarm limits, an OEM that killed it).
  Future<void> showMedicationReminder({
    required int id,
    required String name,
    String? medId,
    String? dose,
    String? relationToMeal,
    String? time,
  }) async {
    await init();
    final bits = <String>[];
    if (dose != null && dose.isNotEmpty) bits.add(dose);
    final meal = _mealLabel(relationToMeal);
    if (meal != null) bits.add(meal);
    if (time != null && time.isNotEmpty) bits.add('at $time');
    await _plugin.show(
      id,
      'Time to take $name',
      bits.join(' · '),
      alarmDetails(),
      payload: 'med:${medId ?? ''}',
    );
  }

  /// Clears every scheduled medication reminder (e.g. on sign-out, so the next
  /// person on a shared phone isn't reminded about someone else's medicine).
  Future<void> cancelMedicationReminders() async {
    await init();
    for (final p in await _plugin.pendingNotificationRequests()) {
      if (isMedicationReminderId(p.id)) {
        await _plugin.cancel(p.id);
      }
    }
  }

  /// Arms the single, adaptive check-in reminder.
  ///
  /// "Adaptive" because it is re-armed from the LAST reading each time the
  /// patient logs one: a patient who checks in on cadence keeps pushing the
  /// nudge forward and never actually sees it — only a lapse lets it fire.
  /// That is the whole trick to reminding without nagging: one pending nudge,
  /// always aimed at the next due date, never a backlog of missed ones. Uses
  /// inexact timing (a nudge, not an alarm) so it needs no exact-alarm grant.
  Future<void> scheduleCheckInReminder({
    DateTime? lastReadingAt,
    int intervalDays = 3,
    int hour = 10,
  }) async {
    await init();
    await _plugin.cancel(_checkInId);

    final now = tz.TZDateTime.now(tz.local);
    final base =
        lastReadingAt != null
            ? tz.TZDateTime.from(lastReadingAt, tz.local)
            : now;
    final due = base.add(Duration(days: intervalDays < 1 ? 1 : intervalDays));
    var when = tz.TZDateTime(tz.local, due.year, due.month, due.day, hour);
    // Already overdue → the next civilised hour, not this very instant.
    if (!when.isAfter(now)) when = _nextInstanceOf(hour, 0);

    try {
      await _plugin.zonedSchedule(
        _checkInId,
        'Time for a quick check-in',
        "Log a glucose reading so your doctor can see how you're doing.",
        when,
        _checkInDetails(),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
        // One-shot on purpose: no matchDateTimeComponents. The next reading
        // re-arms it, and if none comes this fires exactly once, not daily.
      );
    } catch (e) {
      debugPrint('check-in reminder schedule failed: $e');
    }
  }

  /// Clears the check-in reminder (toggle off, or sign-out).
  Future<void> cancelCheckInReminder() async {
    await init();
    await _plugin.cancel(_checkInId);
  }

  /// Everything this device has pending or on screen, gone.
  ///
  /// Sign-out used to call [cancelMedicationReminders] and
  /// [cancelCheckInReminder], which between them missed two things and both
  /// of them showed a departing patient's medicine names to whoever picked the
  /// phone up next:
  ///
  ///  * a snoozed dose is scheduled from [_snoozeIdBase], outside the range
  ///    [cancelMedicationReminders] sweeps, so it survived and rang;
  ///  * neither call touches notifications already sitting in the tray, so a
  ///    reminder that had fired stayed there, readable from the lock screen.
  ///
  /// `cancelAll` is the right instrument here precisely because it is
  /// indiscriminate. There is no such thing as a notification this device
  /// should still deliver once nobody is signed in to it.
  Future<void> cancelAllOnSignOut() async {
    await init();
    await _plugin.cancelAll();
  }

  static NotificationDetails _checkInDetails() => const NotificationDetails(
    android: AndroidNotificationDetails(
      'clinq_checkin',
      'Check-in reminders',
      channelDescription: 'A gentle nudge to log a glucose reading',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      category: AndroidNotificationCategory.reminder,
    ),
  );

  /// The alarm-style presentation shared by the scheduled reminder and its
  /// snooze, so a snoozed dose rings exactly as the original did.
  ///
  /// `FLAG_INSISTENT` (4) is what makes it an alarm rather than a chime:
  /// Android repeats the sound until the notification goes away. [ringFor]
  /// bounds that, and the Stop action ends it immediately — one notification
  /// that rings until dismissed but cannot ring forever.
  static NotificationDetails alarmDetails() => NotificationDetails(
    android: AndroidNotificationDetails(
      'clinq_meds_alarm',
      'Medication alarms',
      channelDescription: 'Rings when it is time to take a medicine',
      importance: Importance.max,
      priority: Priority.max,
      category: AndroidNotificationCategory.alarm,
      audioAttributesUsage: AudioAttributesUsage.alarm,
      // Deliberately NOT a full-screen intent. Android 14 gates that behind an
      // app-op it grants only to calling and alarm-clock apps; for everyone
      // else it rejects at post time and drops the notification entirely. The
      // reminder was being enqueued and then silently discarded. Importance.max
      // on an alarm channel already gives a heads-up banner over the lock
      // screen, which is what was actually wanted.
      additionalFlags: Int32List.fromList(<int>[4]), // FLAG_INSISTENT
      timeoutAfter: ringFor.inMilliseconds,
      enableVibration: true,
      vibrationPattern: Int64List.fromList(<int>[0, 700, 500, 700, 500, 700]),
      // Dismissible by design: an alarm the patient cannot silence is one they
      // will turn off at the system level, losing every later dose with it.
      autoCancel: true,
      ongoing: false,
      actions: <AndroidNotificationAction>[
        AndroidNotificationAction(
          stopActionId,
          'Stop',
          cancelNotification: true,
          showsUserInterface: false,
        ),
        AndroidNotificationAction(
          snoozeActionId,
          'Remind in ${snoozeFor.inMinutes} min',
          cancelNotification: true,
          showsUserInterface: false,
        ),
      ],
    ),
  );

  /// Re-rings a dose [snoozeFor] later, from the background isolate an action
  /// tap runs in. Uses its own plugin instance and its own id range, so it
  /// neither depends on app state nor collides with the daily set.
  static Future<void> scheduleSnoozeFromBackground(String? payload) async {
    final plugin = FlutterLocalNotificationsPlugin();
    tz_data.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Kolkata'));
    try {
      await plugin.zonedSchedule(
        _snoozeIdBase + tz.TZDateTime.now(tz.local).second,
        'Medicine reminder',
        'You snoozed this dose — take it now.',
        tz.TZDateTime.now(tz.local).add(snoozeFor),
        alarmDetails(),
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
        payload: payload,
      );
    } catch (e) {
      debugPrint('snooze schedule failed: $e');
    }
  }

  String _doseBody(ScheduledDose d) {
    final bits = <String>[];
    if (d.dose != null && d.dose!.isNotEmpty) bits.add(d.dose!);
    final meal = _mealLabel(d.relationToMeal);
    if (meal != null) bits.add(meal);
    // The dose time itself, because the alarm rings before it: without it
    // "in 5 minutes" leaves the patient working out when that actually is.
    final hh = d.when.hour.toString().padLeft(2, '0');
    final mm = d.when.minute.toString().padLeft(2, '0');
    bits.add('at $hh:$mm');
    return bits.join(' · ');
  }

  /// Renders a medication reminder from a BACKGROUND isolate — a data-only push
  /// that arrived while the app was terminated. Mirrors
  /// [scheduleSnoozeFromBackground]: a fresh plugin, no app state, no permission
  /// prompts (there's no activity to attach them to). Uses the same id as the
  /// on-device alarm so the two collapse instead of double-reminding.
  static Future<void> showMedicationReminderFromBackground(
    Map<String, dynamic> data,
  ) async {
    final id = int.tryParse(data['notifId']?.toString() ?? '');
    if (id == null) return;
    final plugin = FlutterLocalNotificationsPlugin();
    // The alarm channel is created on first app run and persists system-side;
    // recreating it here is idempotent and covers a fresh install edge case.
    final android =
        plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();
    await android?.createNotificationChannel(_medsChannel);

    final name =
        (data['name']?.toString().isNotEmpty ?? false)
            ? data['name'].toString()
            : 'your medicine';
    final bits = <String>[];
    final dose = data['dose']?.toString();
    if (dose != null && dose.isNotEmpty) bits.add(dose);
    final meal = _mealLabel(data['relationToMeal']?.toString());
    if (meal != null) bits.add(meal);
    final time = data['time']?.toString();
    if (time != null && time.isNotEmpty) bits.add('at $time');

    try {
      await plugin.show(
        id,
        'Time to take $name',
        bits.join(' · '),
        alarmDetails(),
        payload: 'med:${data['medicationId'] ?? ''}',
      );
    } catch (e) {
      debugPrint('background med reminder show failed: $e');
    }
  }

  static String? _mealLabel(String? relation) {
    switch (relation) {
      case 'before_meal':
        return 'before food';
      case 'after_meal':
        return 'after food';
      case 'with_meal':
        return 'with food';
      default:
        return null;
    }
  }

  /// The next time [hh]:[mm] happens in local time — today if it is still ahead,
  /// otherwise tomorrow. The daily-repeat flag carries it forward after that.
  tz.TZDateTime _nextInstanceOf(int hh, int mm) {
    final now = tz.TZDateTime.now(tz.local);
    var when = tz.TZDateTime(tz.local, now.year, now.month, now.day, hh, mm);
    if (!when.isAfter(now)) when = when.add(const Duration(days: 1));
    return when;
  }
}
