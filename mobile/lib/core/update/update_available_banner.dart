import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/providers/core_providers.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'version_gate.dart';

/// Remembers which version the reader has already been told about.
///
/// Keyed on the build number rather than a plain "dismissed" flag, so
/// dismissing one release does not silence the next. Somebody who waves this
/// away today should still hear about the version after it.
const _dismissedKey = 'update_prompt_dismissed_build';

final _dismissedBuildProvider =
    StateNotifierProvider<_DismissedBuild, int>((ref) {
      return _DismissedBuild(ref);
    });

class _DismissedBuild extends StateNotifier<int> {
  _DismissedBuild(this._ref)
    : super(_ref.read(sharedPreferencesProvider).getInt(_dismissedKey) ?? 0);

  final Ref _ref;

  Future<void> dismiss(int build) async {
    state = build;
    await _ref.read(sharedPreferencesProvider).setInt(_dismissedKey, build);
  }
}

/// "A newer version is available", said once and then left alone.
///
/// Deliberately not the wall. The wall is for a build the server knows will
/// misbehave; this is for one that merely is not the newest, and blocking
/// somebody out of their medicines over that would be absurd. It is a strip
/// they can dismiss, and dismissing it is remembered per version.
///
/// It shows nothing at all until the server has been told a newer build exists
/// — [canUpdate] is false whenever latestBuild is unset — so a clinic that
/// never touches those settings never sees this.
class UpdateAvailableBanner extends ConsumerWidget {
  const UpdateAvailableBanner({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // valueOrNull: while the check is in flight, or if it failed, show nothing.
    // Same promise as the wall — a version check that cannot see must not
    // change what the app looks like.
    final status = ref.watch(versionStatusProvider).valueOrNull;
    if (status == null || !status.canUpdate) return child;

    final dismissed = ref.watch(_dismissedBuildProvider);
    if (dismissed >= status.latestBuild) return child;

    final scheme = Theme.of(context).colorScheme;
    final url = status.downloadUrl;

    return Column(
      children: [
        Material(
          color: AppColors.primary.withValues(alpha: 0.1),
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                8,
                AppSpacing.sm,
                8,
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.system_update_rounded,
                    size: 18,
                    color: AppColors.primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      status.latestVersion == null
                          ? 'A newer version of MedPin is available.'
                          : 'MedPin ${status.latestVersion} is available.',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.3,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  if (url != null && url.isNotEmpty)
                    TextButton(
                      onPressed:
                          () => launchUrl(
                            Uri.parse(url),
                            mode: LaunchMode.externalApplication,
                          ),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.primary,
                        visualDensity: VisualDensity.compact,
                      ),
                      child: const Text('Update'),
                    ),
                  IconButton(
                    tooltip: 'Dismiss',
                    visualDensity: VisualDensity.compact,
                    onPressed:
                        () => ref
                            .read(_dismissedBuildProvider.notifier)
                            .dismiss(status.latestBuild),
                    icon: Icon(
                      Icons.close_rounded,
                      size: 18,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}
