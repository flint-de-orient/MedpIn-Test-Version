package com.fdo.medpin

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// FlutterFragmentActivity (not FlutterActivity) is required by local_auth so
// the biometric prompt can attach to a FragmentActivity.
class MainActivity : FlutterFragmentActivity() {
    private val remindersChannel = "clinq/reminders"
    private val appInfoChannel = "clinq/app_info"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Reliability of on-device medication alarms hinges on the app being
        // exempt from battery optimization on aggressive OEMs (MIUI/Oppo/etc.),
        // which otherwise kill scheduled alarms. Flutter can request the exact
        // alarm + notification permissions itself; only the battery exemption
        // needs a native intent, exposed here.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, remindersChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isIgnoringBatteryOptimizations" -> result.success(isIgnoringBatteryOptimizations())
                    "requestIgnoreBatteryOptimizations" -> {
                        requestIgnoreBatteryOptimizations()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

        // Which build this is, from what is installed rather than from build
        // flags a build can forget. See lib/core/update/build_info.dart.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, appInfoChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "buildInfo" -> result.success(buildInfo())
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * The installed version name, and the pubspec build number Gradle wrote
     * into the manifest.
     *
     * Not the versionCode: --split-per-abi adds an ABI offset to it, so one
     * build reports 10136 on a 64-bit phone and 9136 on a 32-bit one, and
     * neither is the number the server's update check compares against.
     */
    @Suppress("DEPRECATION")
    private fun buildInfo(): Map<String, Any?> {
        val versionName = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (_: Exception) {
            null
        }
        val build = try {
            packageManager
                .getApplicationInfo(packageName, PackageManager.GET_META_DATA)
                .metaData
                ?.get("com.fdo.medpin.PUBSPEC_BUILD")
                ?.toString()
                ?.toIntOrNull()
        } catch (_: Exception) {
            null
        }
        return mapOf("versionName" to versionName, "build" to build)
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    @SuppressLint("BatteryLife")
    private fun requestIgnoreBatteryOptimizations() {
        // The direct per-app dialog is the least-friction path; if the OEM
        // rejects it, fall back to the battery-optimization list where the user
        // can pick this app and choose "Don't optimize".
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } catch (e: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }
}
