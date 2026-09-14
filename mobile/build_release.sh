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
if ! [[ "$NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be MAJOR.MINOR.PATCH in pubspec.yaml (got '${NAME}')" >&2
  exit 1
fi

# ---- The version moves here, not by hand -----------------------------------
#
# This script used to read pubspec and never write it, so every release needed
# somebody to remember to edit the file first. That is the same class of step as
# the --dart-define this script exists to stop people forgetting, and it was
# forgotten in the same way: a dozen builds went out as 1.0.0+n with the number
# nudged by hand, twice not at all.
#
# The build number always increases. It is not a decision — Android refuses to
# install an APK whose versionCode is not higher than the one already there, so
# a rebuild that reuses a number is a rebuild nobody can install over the top.
#
# The marketing version is a decision, which is why it takes a word rather than
# climbing on its own. A recompile is not a patch release; 1.0.1 -> 1.0.2 should
# mean something changed for the person holding the phone. `patch` is the
# default because most releases are, and it counts past nine the ordinary way:
# 1.0.9 -> 1.0.10 -> 1.0.11.
#
#   ./build_release.sh          1.0.1+8114 -> 1.0.2+8115   (the usual case)
#   ./build_release.sh minor    1.0.9+8120 -> 1.1.0+8121
#   ./build_release.sh major    1.9.3+8140 -> 2.0.0+8141
#   ./build_release.sh same     1.0.2+8115 -> 1.0.2+8116   (rebuild to test)
BUMP="${1:-patch}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$NAME"

case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  same)  ;;
  *)
    echo "usage: $0 [patch|minor|major|same]   (default: patch)" >&2
    exit 1
    ;;
esac

PREV="${NAME}+${BUILD}"
NAME="${MAJOR}.${MINOR}.${PATCH}"
BUILD=$((BUILD + 1))

# Written before the build, so what is baked into the APK and what is in the
# repository can never disagree. A build that then fails leaves the number
# skipped, which costs nothing: build numbers only have to increase, and a gap
# in the marketing version is cheaper than shipping two different things under
# one name.
sed -i "s/^version: .*/version: ${NAME}+${BUILD}/" pubspec.yaml
echo "Version ${PREV} -> ${NAME}+${BUILD}"

# ---- Design-token ceiling -------------------------------------------------
#
# The token linter has existed for a while and nothing ran it, so the count
# drifted to 570 across 86 files. Failing outright would block every release,
# so this is a ratchet: the debt cannot grow, and every file cleaned lowers the
# bar behind it. When the run reports a number below the ceiling, lower this.
TOKEN_CEILING=557
dart run tool/verify_tokens.dart --max="${TOKEN_CEILING}"

APK="build/app/outputs/flutter-apk/app-arm64-v8a-release.apk"
BEFORE="$( [ -f "$APK" ] && date -r "$APK" +%s || echo 0 )"

echo "Building ${NAME}+${BUILD}"
# The architectures are named because android/app/build.gradle.kts keeps
# x86_64 out of split builds: without --target-platform the Flutter tool waits
# for an x86_64 APK that is never produced and exits non-zero after the ARM
# APKs have built fine. Obfuscated like every release since 2026-08-18, with
# the symbols kept so a crash can still be read.
flutter build apk --release --split-per-abi \
  --target-platform android-arm,android-arm64 \
  --obfuscate --split-debug-info=build/symbols \
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

Built ${NAME}

On the server:  ANDROID_LATEST_VERSION=${NAME}
EOF
