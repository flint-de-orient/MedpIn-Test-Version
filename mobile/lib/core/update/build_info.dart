import 'package:flutter/foundation.dart';
// Newer Flutter exports an `appBuildNumber` of its own from services.dart; the
// app's is the one from version_gate.dart, and the two collided at compile time.
import 'package:flutter/services.dart' hide appBuildNumber;

import '../config/app_config.dart';
import 'version_gate.dart' show appBuildNumber;

/// Which build of the app this is, as installed.
///
/// ---- Why the platform and not the build flags ----------------------------
///
/// The version name and build number used to come only from `--dart-define`,
/// which build_release.sh passes and `flutter build apk` does not. A build made
/// any other way said "1.0.0", switched its update check off, and printed a
/// developer's instruction on a doctor's profile — on a phone that was running
/// 1.0.20 (build 8136). Nothing about that was visible until somebody looked.
///
/// The platform always knows. Android has the version name, and Gradle writes
/// the pubspec build number into the manifest (see AndroidManifest.xml) without
/// the ABI offset that `--split-per-abi` adds to versionCode — so the number is
/// the same on every handset and matches what the server compares against.
///
/// The flags stay as the fallback for where there is no platform to ask: a
/// widget test, a desktop run.
@immutable
class BuildInfo {
  const BuildInfo({required this.version, required this.build});

  /// "1.0.20".
  final String version;

  /// The pubspec build number, 8136 — or 0 when nothing could say.
  final int build;

  static const _compiled = BuildInfo(
    version: AppConfig.appVersion,
    build: appBuildNumber,
  );

  static BuildInfo _current = _compiled;

  /// The answer, once [load] has run; the compiled values before that.
  static BuildInfo get current => _current;

  static const _channel = MethodChannel('clinq/app_info');

  /// Asks the platform. Called once, before the first frame.
  ///
  /// Never throws: a phone that cannot answer keeps the compiled values, which
  /// is no worse than before this existed.
  static Future<void> load() async {
    try {
      final info = await _channel.invokeMapMethod<String, Object?>('buildInfo');
      final version = info?['versionName']?.toString().trim();
      final build = int.tryParse(info?['build']?.toString() ?? '');
      _current = BuildInfo(
        version:
            (version != null && version.isNotEmpty)
                ? version
                : _compiled.version,
        build: (build != null && build > 0) ? build : _compiled.build,
      );
    } catch (_) {
      _current = _compiled;
    }
  }

  /// For a test that needs a particular build.
  @visibleForTesting
  static void debugOverride(BuildInfo? info) => _current = info ?? _compiled;
}
