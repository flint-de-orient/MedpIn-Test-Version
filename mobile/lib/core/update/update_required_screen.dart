import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'version_gate.dart';

/// Shown instead of the app when this build can no longer talk to the server.
///
/// Deliberately a wall rather than a banner. The builds this catches do not
/// fail loudly — they fail by appearing to work: a prescription scanned into
/// nothing, a screen that stays empty. Letting somebody carry on using an app
/// that will quietly lose their medicines is not a kindness.
///
/// There is no dismiss and no back. Everything below the floor is a build the
/// server knows will misbehave, and "later" is how a patient ends up trusting a
/// reminder that was never set.
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key, required this.status});

  final VersionStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final url = status.downloadUrl;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 78,
                  height: 78,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.system_update_rounded,
                    size: 38,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                const Text(
                  'Please update MedPin',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 24,
                    height: 1.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  // Says what is actually at stake. "A new version is
                  // available" would be true and useless; somebody blocked from
                  // their own medicines deserves the reason.
                  'This version can no longer work with the clinic safely — '
                  'some things would look like they had worked when they had '
                  'not. A quick update fixes it.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 15,
                    height: 1.45,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                if (url != null && url.isNotEmpty)
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: () => launchUrl(
                        Uri.parse(url),
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.download_rounded),
                      label: const Text('Get the new version'),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                      ),
                    ),
                  )
                else
                  // No link configured. Saying so beats a button that does
                  // nothing when somebody is already stuck.
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(
                        alpha: 0.5,
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      'Please contact the clinic for the latest version.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  status.latestVersion == null
                      ? 'You have build ${status.build}'
                      : 'You have build ${status.build} · '
                          'latest is ${status.latestVersion}',
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
