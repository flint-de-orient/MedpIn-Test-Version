import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/providers/core_providers.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'version_gate.dart';

/// Which version the reader has already been asked about.
///
/// Silences the dialog, and only the dialog. The dot on the Profile tab is not
/// dismissible and is not stored — it is derived from whether an update exists,
/// so it clears when the app is actually updated and not a moment before. That
/// is the difference between the two: "later" postpones being asked, it does
/// not pretend the update went away.
const _promptedKey = 'update_prompt_shown_build';

final promptedBuildProvider = StateNotifierProvider<_PromptedBuild, int>((ref) {
  return _PromptedBuild(ref);
});

class _PromptedBuild extends StateNotifier<int> {
  _PromptedBuild(this._ref)
    : super(_ref.read(sharedPreferencesProvider).getInt(_promptedKey) ?? 0);

  final Ref _ref;

  Future<void> markShown(int build) async {
    state = build;
    await _ref.read(sharedPreferencesProvider).setInt(_promptedKey, build);
  }
}

/// Asks once per version: now, or later?
///
/// Once, because a dialog on every launch is a dialog people learn to dismiss
/// without reading — and the next one might be the one that mattered. Asked at
/// all, because a dot on a tab is easy to miss and an update nobody knows about
/// is an update nobody installs.
///
/// Choosing "later" is respected: the reader is not asked again about this
/// version. The mark on the Profile tab stays, so the choice is postponed
/// rather than lost, and the full detail waits for them there.
Future<void> maybeShowUpdatePrompt(BuildContext context, WidgetRef ref) async {
  final status = ref.read(versionStatusProvider).valueOrNull;
  if (status == null || !status.canUpdate) return;
  if (ref.read(promptedBuildProvider) >= status.latestBuild) return;

  // Written before the dialog opens, not after it closes. If the app is killed
  // while the dialog is up, the reader has still been asked — and being asked
  // twice about one version is exactly what this is here to prevent.
  await ref.read(promptedBuildProvider.notifier).markShown(status.latestBuild);
  if (!context.mounted) return;

  final url = status.downloadUrl;

  await showDialog<void>(
    context: context,
    builder: (ctx) {
      final scheme = Theme.of(ctx).colorScheme;
      return AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        icon: Container(
          width: 52,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.system_update_rounded,
            size: 26,
            color: AppColors.primary,
          ),
        ),
        title: Text(
          status.latestVersion == null
              ? 'Update available'
              : 'MedPin ${status.latestVersion} is ready',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
        ),
        content: Text(
          'A newer version is available to install. You can do it now, or '
          'later from your Profile.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14,
            height: 1.4,
            color: scheme.onSurfaceVariant,
          ),
        ),
        actionsAlignment: MainAxisAlignment.center,
        actions: [
          Column(
            children: [
              if (url != null && url.isNotEmpty)
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      launchUrl(
                        Uri.parse(url),
                        mode: LaunchMode.externalApplication,
                      );
                    },
                    icon: const Icon(Icons.download_rounded, size: 18),
                    label: const Text('Update now'),
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
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onSurfaceVariant,
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                ),
                child: const Text('Later'),
              ),
            ],
          ),
        ],
      );
    },
  );
}
