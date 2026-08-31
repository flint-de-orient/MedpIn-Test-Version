/// Central place for environment-dependent configuration.
///
/// API calls go to the live backend by default, so a plain `flutter build`
/// produces an app that reaches the real server. Point it elsewhere for local
/// development without touching this file by passing the URL at build time —
/// the override always wins:
///
///   * Android emulator (host machine on port 4000):
///       flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
///   * Physical device over `adb reverse tcp:4000 tcp:4000`:
///       flutter run --dart-define=API_BASE_URL=http://localhost:4000/api/v1
///   * Physical device over Wi-Fi / a staging server:
///       flutter run --dart-define=API_BASE_URL=http://192.168.1.9:4000/api/v1
class AppConfig {
  AppConfig._();

  static const String _apiPath = '/api/v1';

  /// The live backend, used whenever no build-time override is supplied. This
  /// is why release builds no longer fall back to an emulator-only address and
  /// fail on a real phone with a misleading "no internet" error.
  static const String _defaultBaseUrl = 'https://clinq.flintdeorient.in$_apiPath';

  /// Build-time override. Empty when not supplied.
  static const String _apiBaseUrlOverride = String.fromEnvironment('API_BASE_URL');

  /// Base URL for all API calls, already including the `/api/v1` prefix.
  static String get apiBaseUrl =>
      _apiBaseUrlOverride.isNotEmpty ? _apiBaseUrlOverride : _defaultBaseUrl;

  /// Scheme + host, without the `/api/v1` path — for building absolute URLs
  /// from the relative paths the API returns (e.g. upload raw-image URLs).
  static String get apiOrigin {
    final base = apiBaseUrl;
    return base.endsWith(_apiPath) ? base.substring(0, base.length - _apiPath.length) : base;
  }

  /// Jitsi server for in-app voice/video calls.
  ///
  /// Self-hosted rather than the public `meet.jit.si`: patient consultations
  /// then stay on the clinic's own infrastructure, and it sidesteps
  /// meet.jit.si's requirement that a moderator log in before a call can start.
  /// Point it elsewhere without a code change via
  ///   --dart-define=JITSI_SERVER=https://meet.example.com
  static const String _jitsiServerOverride = String.fromEnvironment('JITSI_SERVER');
  static const String _defaultJitsiServer = 'https://meet.flintdeorient.in';
  static String get jitsiServerUrl =>
      _jitsiServerOverride.isNotEmpty ? _jitsiServerOverride : _defaultJitsiServer;

  /// Connection/receive timeouts for Dio.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 20);

  static const String appName = 'MedPin';

  /// Shown in Profile → About. Kept in step with `version:` in pubspec.yaml.
  /// The marketing version — "1.0.0".
  ///
  /// Read from the build rather than typed here. It was a hardcoded constant,
  /// which meant bumping pubspec changed what the store saw and not a word of
  /// what the app said about itself. The default is the same string it always
  /// held, so a build made without the flag is no worse than before.
  ///
  /// See [runningVersion] for what to actually show a reader: this is half the
  /// answer, and on a sideloaded pilot it is the less useful half.
  static const String appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '1.0.0',
  );

  /// Clinic contact number used by the emergency chat card's "Call clinic"
  /// button. Not part of API_CONTRACT.md (no endpoint exposes clinic
  /// contact details) — placeholder pending a real number from the clinic;
  /// swap before release.
  static const String clinicPhoneNumber = '+913322345678';
}
