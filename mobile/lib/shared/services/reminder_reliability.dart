import 'package:flutter/services.dart';

/// Native bridge for the reliability levers Flutter can't pull itself:
/// exemption from OEM battery optimization, which otherwise kills scheduled
/// dose alarms on MIUI/Oppo/Vivo/Samsung, and the notification settings page.
/// (The notification and exact-alarm permission prompts are handled by
/// flutter_local_notifications.)
class ReminderReliability {
  const ReminderReliability._();

  static const MethodChannel _ch = MethodChannel('clinq/reminders');

  /// True when this app is already exempt (or the platform has no such notion,
  /// e.g. iOS) — in which case there is nothing to prompt for.
  static Future<bool> isIgnoringBatteryOptimizations() async {
    try {
      return await _ch.invokeMethod<bool>('isIgnoringBatteryOptimizations') ??
          true;
    } catch (_) {
      return true;
    }
  }

  /// Opens the system dialog (or settings) to exempt this app from battery
  /// optimization. No-op where unsupported.
  static Future<void> requestIgnoreBatteryOptimizations() async {
    try {
      await _ch.invokeMethod('requestIgnoreBatteryOptimizations');
    } catch (_) {}
  }

  /// Opens this app's page in the phone's notification settings, or the page
  /// for one channel when [channelId] is given. Once Android has stopped
  /// showing the permission prompt, this is the only way back.
  static Future<void> openNotificationSettings({String? channelId}) async {
    try {
      await _ch.invokeMethod('openNotificationSettings', {
        'channelId': channelId,
      });
    } catch (_) {}
  }
}
