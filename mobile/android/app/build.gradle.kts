import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// `flutter build apk --split-per-abi` reaches Gradle as this property. It makes
// the Flutter plugin configure `splits.abi`, and AGP refuses to have that and
// `ndk.abiFilters` set at the same time — so the two ways of keeping x86_64 out
// of a release build have to be mutually exclusive. See the release block.
//
// A split build therefore has to name the architectures itself:
//
//   flutter build apk --release --split-per-abi \
//     --target-platform android-arm,android-arm64 \
//     --obfuscate --split-debug-info=build/symbols
//
// Without --target-platform the Flutter tool also expects an x86_64 APK and
// exits non-zero when Gradle does not produce one.
val splitPerAbi = (project.findProperty("split-per-abi") as String?).toBoolean()

// The release signing key, read from android/key.properties (gitignored).
//
// Android stores the signature at install time and refuses any update carrying
// a different one. That makes the key an irreversible commitment: once a build
// signed with it is in someone's hands, every future update must use the same
// file, and losing it means every user has to uninstall — losing their login,
// their preferences and their scheduled reminders — before they can install
// again. Back it up somewhere that will outlive this laptop.
//
// Absent, the build falls back to the debug key and says so loudly. That keeps
// `flutter run --release` working on a machine without the keystore, which is
// most of them, without letting a debug-signed build be mistaken for a
// shippable one.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
if (hasReleaseKey) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    namespace = "com.fdo.medpin"
    compileSdk = flutter.compileSdkVersion
    // Pinned rather than `flutter.ndkVersion` (26.3.11579264), which is
    // present on this machine but missing its cmake toolchain files and fails
    // the native build outright. Raised from 27.0.12077973 to satisfy
    // speech_to_text; NDK releases are backward compatible, so this covers
    // every plugin in the project.
    ndkVersion = "28.2.13676358"

    compileOptions {
        // Required by flutter_local_notifications (uses java.time on older APIs).
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.fdo.medpin"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Jitsi Meet (jitsi_meet_flutter_sdk 11.x) requires API 26+.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // The pubspec build number, before --split-per-abi adds its ABI offset
        // to versionCode (8136 ships as 10136 on arm64). Written into the
        // manifest so the app can read which build it is however it was
        // compiled — see lib/core/update/build_info.dart.
        manifestPlaceholders["pubspecBuild"] = flutter.versionCode.toString()
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                // Relative to android/, so key.properties can say
                // `storeFile=medpin-release.jks` and the file sits beside it.
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig =
                if (hasReleaseKey) {
                    signingConfigs.getByName("release")
                } else {
                    // Loud on purpose. A debug-signed APK installs and runs
                    // perfectly, so nothing about the build or the phone says
                    // it cannot be updated later — the failure surfaces months
                    // afterwards, on every user at once.
                    // println, not logger.warn: the Flutter tool filters
                    // Gradle's warn level out entirely, so the banner was
                    // never once printed — a warning nobody sees is precisely
                    // the failure it was written to prevent.
                    println(
                        "\n" +
                            "  ****************************************************************\n" +
                            "  *  NO RELEASE KEY — signing with the DEBUG key.                *\n" +
                            "  *  Do not distribute this build.                               *\n" +
                            "  *  Anyone who installs it can never be updated from a properly *\n" +
                            "  *  signed build without uninstalling first and losing their    *\n" +
                            "  *  data.  See android/KEYSTORE.md.                             *\n" +
                            "  ****************************************************************\n",
                    )
                    signingConfigs.getByName("debug")
                }

            // Almost the whole APK is the Flutter engine, shipped once per CPU
            // architecture: 20.7 MB for arm64, 18.9 for 32-bit ARM and 22.2 for
            // x86_64, against 3.5 MB for everything this app actually is.
            //
            // x86_64 is emulators only — no phone runs it — so a release build
            // carrying it posts 22 MB to every patient for nobody's benefit.
            // Both ARM slices stay: arm64 for anything current, armeabi-v7a
            // because budget handsets in this clinic's market are still 32-bit,
            // and locking them out to save space is not a trade worth making.
            //
            // A split build drops x86_64 through `splits` above instead, and
            // AGP will not accept both mechanisms at once.
            if (!splitPerAbi) {
                ndk {
                    abiFilters.clear()
                    abiFilters.addAll(listOf("arm64-v8a", "armeabi-v7a"))
                }
            }

            // R8 runs on release builds. Without these rules it strips the
            // generic signatures Gson needs and flutter_local_notifications
            // throws on every read of its scheduled-notification store — which
            // is why medicine reminders never fired in a release build.
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
