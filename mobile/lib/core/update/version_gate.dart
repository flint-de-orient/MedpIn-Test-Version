import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shared/providers/core_providers.dart';

/// What the server says about app builds, and what this one is.
///
/// Two different answers, because they call for two different things:
///
///   - [mustUpdate] — this build is below the server's floor. It is not merely
///     old, it is known to misbehave: the prescription scan changed shape, and
///     a client from before that change photographs a prescription, reads an
///     empty `created` list and shows the patient nothing at all. No error, no
///     explanation. Being told to update is a far better experience than a
///     feature that silently does nothing.
///   - [canUpdate] — newer exists. Worth mentioning once, never worth blocking.
typedef VersionStatus = ({
  bool mustUpdate,
  bool canUpdate,
  int build,
  int latestBuild,
  String? latestVersion,
  String? downloadUrl,
});

const VersionStatus _allClear = (
  mustUpdate: false,
  canUpdate: false,
  build: 0,
  latestBuild: 0,
  latestVersion: null,
  downloadUrl: null,
);

/// Asks the server, and fails open.
///
/// Every failure path here returns "all clear" on purpose. A patient on a train
/// with no signal, a server mid-restart, a malformed response — none of those
/// are reasons to lock somebody out of their own medicines. The gate exists to
/// catch a known-broken client, and a gate that closes when it cannot see is
/// worse than no gate at all.
/// The build number from pubspec, baked in at compile time.
///
/// NOT `PackageInfo.buildNumber`, which on Android is the APK's versionCode —
/// and with `--split-per-abi` Flutter adds an ABI offset to that: build 8103
/// ships as 10103 on arm64 and 9103 on armeabi-v7a. The same build reports two
/// different numbers depending on the handset, so comparing either against a
/// floor from pubspec is meaningless. Set 8103 as the floor and nothing is ever
/// below it; set 10103 and every 32-bit phone is locked out of a build it is
/// running perfectly well.
///
/// Passed with `--dart-define=APP_BUILD=<pubspec build>`; see the build script.
/// Zero when nobody passed it, which switches the gate off rather than guessing
/// — a forgotten flag must not become a locked door.
const int appBuildNumber = int.fromEnvironment('APP_BUILD');

const int _bakedBuild = appBuildNumber;

final versionStatusProvider = FutureProvider<VersionStatus>((ref) async {
  final build = _bakedBuild;
  // No build number we can trust is no comparison we can make.
  if (build <= 0) return _allClear;

  try {
    final json = await ref.read(apiClientProvider).getJson('/app/version');
    final android = json['android'];
    if (android is! Map<String, dynamic>) return _allClear;

    final minBuild = (android['minBuild'] as num?)?.toInt() ?? 0;
    final latestBuild = (android['latestBuild'] as num?)?.toInt() ?? 0;

    return (
      // Strictly below the floor. Equal is fine — the floor is the oldest
      // build that still works, not the oldest that is unwelcome.
      mustUpdate: minBuild > 0 && build < minBuild,
      canUpdate: latestBuild > 0 && build < latestBuild && build >= minBuild,
      build: build,
      latestBuild: latestBuild,
      latestVersion: android['latestVersion']?.toString(),
      downloadUrl: json['downloadUrl']?.toString(),
    );
  } catch (_) {
    return _allClear;
  }
});
