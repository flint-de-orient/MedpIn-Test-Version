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
NAME="$(grep -m1 '^version:' pubspec.yaml | sed 's/^version: *//; s/+.*//')"

if ! [[ "$BUILD" =~ ^[0-9]+$ ]]; then
  echo "Could not read a build number from pubspec.yaml (got '${BUILD}')" >&2
  exit 1
fi

echo "Building ${NAME}+${BUILD}"
flutter build apk --release --split-per-abi --dart-define="APP_BUILD=${BUILD}"

cat <<EOF

Built ${NAME}+${BUILD}.

On the server, the matching settings are:

  ANDROID_LATEST_BUILD=${BUILD}
  ANDROID_LATEST_VERSION=${NAME}

Raise ANDROID_MIN_BUILD to ${BUILD} only when older builds are genuinely broken
against the server — it locks every older install out of the app entirely, and
only builds that already carry the gate can be told why.
EOF
