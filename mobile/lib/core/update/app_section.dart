import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../features/profile/presentation/widgets/profile_section.dart';
import '../../l10n/gen/app_localizations.dart';
import '../config/app_config.dart';
import 'build_info.dart';
import 'version_gate.dart';

/// The app itself: one section, the same on every profile screen.
///
/// ---- What this replaced ----------------------------------------------------
///
/// Three answers to one question, on the same screen. An "About" row showed a
/// version, a separate card below it showed the version again with its own
/// border and a line of developer instructions, and a footer under Log out
/// showed it a third time — each read from a compile-time flag that said
/// "1.0.0" whenever the APK had not been built by the release script. Nothing
/// was grouped with anything, and every copy was wrong in the same way.
///
/// Now there is one group: what is installed, and — when the server has said —
/// whether a newer one exists.
///
/// ---- Three states, and the third matters most -----------------------------
///
///   - an update exists: say which, and offer it;
///   - up to date: say so, because "no news" and "not checked" look identical
///     otherwise;
///   - not known: the server did not answer, so no second row at all. A version
///     check that cannot see must not assert that you are current.
class AppSection extends ConsumerWidget {
  const AppSection({super.key, this.label = 'App', this.onAbout});

  /// The heading. The desk's profile calls this group "About".
  final String label;

  /// What tapping About opens. The platform's about dialog when absent; the
  /// patient's profile passes its own, which links to the searchable licences.
  final VoidCallback? onAbout;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final status = ref.watch(versionStatusProvider).valueOrNull;
    final info = BuildInfo.current;

    final canUpdate = status?.canUpdate ?? false;
    // A number came back from the server to compare against. Anything less is
    // not evidence that this build is the newest.
    final known = status != null && status.latestBuild > 0;
    final url = status?.downloadUrl;

    final Widget? updates =
        canUpdate
            ? ProfileRow(
              icon: Icons.system_update_rounded,
              title: 'Update available',
              subtitle:
                  status!.latestVersion == null
                      ? 'A newer version is ready to install'
                      : 'MedPin ${status.latestVersion} is ready to install',
              trailingIcon: Icons.download_rounded,
              showDivider: false,
              onTap:
                  (url == null || url.isEmpty)
                      ? null
                      : () => launchUrl(
                        Uri.parse(url),
                        mode: LaunchMode.externalApplication,
                      ),
            )
            : known
            ? const ProfileRow(
              icon: Icons.verified_rounded,
              title: 'Up to date',
              subtitle: 'You are on the latest version',
              showDivider: false,
            )
            : null;

    return ProfileSection(
      label: label,
      children: [
        ProfileRow(
          icon: Icons.info_outline_rounded,
          title: l10n.profileAbout,
          value: 'v${info.version}',
          showDivider: updates != null,
          onTap:
              onAbout ??
              () => showAboutDialog(
                context: context,
                applicationName: AppConfig.appName,
                // The build number in the dialog, where somebody helping with a
                // misbehaving phone looks for it, and nowhere else.
                applicationVersion:
                    info.build > 0
                        ? '${info.version} (build ${info.build})'
                        : info.version,
              ),
        ),
        if (updates != null) updates,
      ],
    );
  }
}
