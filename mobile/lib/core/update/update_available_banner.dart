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

    // A card that belongs to this app, not a system notice bolted on top.
    //
    // The first version was a tinted strip running edge to edge with a text
    // button on it — the shape Android uses for "no internet connection", which
    // is exactly the wrong register. This is a small courtesy, so it looks like
    // one: an inset card on the app's own ground, the same rounded geometry as
    // every other surface, and a filled pill for the action.
    return Column(
      children: [
        SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              4,
            ),
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.22),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x140B1B3A),
                    blurRadius: 10,
                    offset: Offset(0, 3),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.11),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      Icons.system_update_rounded,
                      size: 18,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          status.latestVersion == null
                              ? 'Update available'
                              : 'MedPin ${status.latestVersion} is ready',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14,
                            height: 1.25,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          'A newer version is available to install.',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.3,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (url != null && url.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed:
                          () => launchUrl(
                            Uri.parse(url),
                            mode: LaunchMode.externalApplication,
                          ),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        minimumSize: const Size(0, 34),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(999),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      child: const Text('Update'),
                    ),
                  ],
                  // Quieter than the action beside it, deliberately. Dismissing
                  // is always available and never the thing being asked for.
                  IconButton(
                    tooltip: 'Not now',
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(
                      minWidth: 30,
                      minHeight: 30,
                    ),
                    onPressed:
                        () => ref
                            .read(_dismissedBuildProvider.notifier)
                            .dismiss(status.latestBuild),
                    icon: Icon(
                      Icons.close_rounded,
                      size: 17,
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
