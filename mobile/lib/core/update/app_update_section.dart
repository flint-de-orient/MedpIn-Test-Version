import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'version_gate.dart';

/// The app's own version, and whether a newer one exists.
///
/// This replaced a strip that floated over whatever screen the reader was on.
/// The strip worked, but it was the wrong shape for what it says: an update
/// notice is reference material, not an interruption. Nobody needs to be told
/// mid-consultation, and a thing that appears uninvited gets dismissed
/// reflexively — often before it has been read.
///
/// A row in Profile is where somebody goes *looking* for this, so it can be
/// permanent rather than dismissible, and it can afford to say more: which
/// build is running, whether that is the newest, and where to get the newest if
/// not. It is also the same row in all four panels, so "what version is that
/// phone on?" has one answer in one place whoever is holding it.
///
/// Three states, and the third matters most:
///
///   - an update exists — say which, and offer it;
///   - up to date — say so, because "no news" and "not checked" look identical
///     otherwise;
///   - not known — the server did not answer, so it claims nothing at all. A
///     version check that cannot see must not assert that you are current.
class AppUpdateSection extends ConsumerWidget {
  const AppUpdateSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(versionStatusProvider);
    final status = async.valueOrNull;

    // The build actually running, not a constant somebody has to remember to
    // bump. AppConfig.appVersion is the marketing version and says 1.0.0
    // whatever is installed.
    final running =
        appBuildNumber > 0
            ? '${AppConfig.appVersion} (${appBuildNumber})'
            : AppConfig.appVersion;

    final canUpdate = status?.canUpdate ?? false;
    final known = status != null && (status.latestBuild > 0);
    final url = status?.downloadUrl;

    final (IconData icon, Color tone, String headline, String detail) = switch ((
      canUpdate,
      known,
    )) {
      (true, _) => (
        Icons.system_update_rounded,
        AppColors.primary,
        'Update available',
        status!.latestVersion == null
            ? 'A newer version is ready to install'
            : 'MedPin ${status.latestVersion} is ready to install',
      ),
      (false, true) => (
        Icons.verified_rounded,
        AppColors.successOn(context),
        'Up to date',
        'You are on the latest version',
      ),
      // Never "up to date" on a check that did not happen. Offline, a server
      // mid-restart, or a clinic that has not set the numbers — none of those
      // are evidence that this build is current, and saying so would be a
      // reassurance the app has not earned.
      _ => (
        Icons.info_outline_rounded,
        scheme.onSurfaceVariant,
        'App version',
        'MedPin $running',
      ),
    };

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color:
              canUpdate
                  ? AppColors.primary.withValues(alpha: 0.28)
                  : scheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 19, color: tone),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      headline,
                      style: TextStyle(
                        fontSize: 15,
                        height: 1.25,
                        fontWeight: FontWeight.w800,
                        color: canUpdate ? AppColors.primary : null,
                      ),
                    ),
                    Text(
                      detail,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.3,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // The running build, always, whatever the state above says. It is the
          // first thing anyone is asked for when a handset misbehaves, and
          // hunting for it in an About dialog is a step nobody should need.
          const SizedBox(height: AppSpacing.sm + 2),
          Divider(
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.6),
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          Row(
            children: [
              Text(
                'Installed',
                style: TextStyle(
                  fontSize: 13,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const Spacer(),
              Text(
                running,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),

          if (canUpdate && url != null && url.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed:
                    () => launchUrl(
                      Uri.parse(url),
                      mode: LaunchMode.externalApplication,
                    ),
                icon: const Icon(Icons.download_rounded, size: 18),
                label: const Text('Get the update'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(
                      AppSpacing.buttonRadius,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
