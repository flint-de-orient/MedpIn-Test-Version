#!/usr/bin/env bash
#
# Build the release APKs with the build number baked in.
#
# Use this rather than calling `flutter build apk` directly. The app compares
# its own build against the server's floor (see lib/core/update/version_gate.dart),
# and it cannot read that number from the APK: `PackageInfo.buildNumber` is the
# Android versionCode, and --split-per-abi adds an ABI offset to it, so one
# build reports 10104 on a 64-bit phone and 9104 on a 32-bit one. Comparing
# either against a floor taken from pubspec is meaningless.
#
# So the number is passed in at compile time. Forgetting the flag does not break
# anything — the gate switches itself off rather than guessing — but it does
# mean the update check silently stops working, which is the kind of quiet
# failure this script exists to prevent.
set -euo pipefail

cd "$(dirname "$0")"

BUILD="$(grep -m1 '^version:' pubspec.yaml | sed 's/.*+//')"
# Both halves are baked in. NAME used to be read only to print it, while the
# app carried its own hardcoded '1.0.0' — so bumping pubspec changed what the
# APK reported and not a word of what the app said about itself.
NAME="$(grep -m1 '^version:' pubspec.yaml | sed 's/^version: *//; s/+.*//')"

if ! [[ "$BUILD" =~ ^[0-9]+$ ]]; then
  echo "Could not read a build number from pubspec.yaml (got '${BUILD}')" >&2
  exit 1
fi

APK="build/app/outputs/flutter-apk/app-arm64-v8a-release.apk"
BEFORE="$( [ -f "$APK" ] && date -r "$APK" +%s || echo 0 )"

echo "Building ${NAME}+${BUILD}"
flutter build apk --release --split-per-abi \
  --dart-define="APP_BUILD=${BUILD}" \
  --dart-define="APP_VERSION=${NAME}"

# Proof, not an exit code.
#
# A release build takes six-odd minutes cold and about one warm, and the output
# is easy to lose to a pipe — which is how a build in progress got mistaken for
# a build that never ran. An exit code of 0 from a pipeline is the last stage's,
# not flutter's, so the only honest check is whether the file on disk actually
# moved.
AFTER="$( [ -f "$APK" ] && date -r "$APK" +%s || echo 0 )"
if [ "$AFTER" -le "$BEFORE" ]; then
  echo "FAILED: $APK was not rewritten — the APK on disk is from an earlier build." >&2
  exit 1
fi

cat <<EOF

Built ${NAME}+${BUILD}.

On the server, the matching settings are:

  ANDROID_LATEST_BUILD=${BUILD}
  ANDROID_LATEST_VERSION=${NAME}

Raise ANDROID_MIN_BUILD to ${BUILD} only when older builds are genuinely broken
against the server — it locks every older install out of the app entirely, and
only builds that already carry the gate can be told why.
EOF
