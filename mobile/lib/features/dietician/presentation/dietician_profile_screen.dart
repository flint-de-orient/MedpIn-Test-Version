import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/app_lock_provider.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../profile/presentation/widgets/profile_section.dart';
import '../../profile/presentation/widgets/theme_selector.dart';
import '../../../shared/providers/theme_provider.dart';
import 'widgets/dietician_bell.dart';

/// The dietician's profile — the counterpart of the doctor's, minus the clinic
/// tools they have no business in (alerts, knowledge base, patient feedback).
/// Appearance, language, their own details, app lock and sign-out.
class DieticianProfileScreen extends ConsumerStatefulWidget {
  const DieticianProfileScreen({super.key});

  @override
  ConsumerState<DieticianProfileScreen> createState() =>
      _DieticianProfileScreenState();
}

class _DieticianProfileScreenState
    extends ConsumerState<DieticianProfileScreen> {
  bool _uploadingAvatar = false;

  /// Tap to replace the photo, long-press to view it full screen — the same
  /// gestures the patient and the doctor already have, so the three panels
  /// behave identically for the one thing every user does first.
  Future<void> _changeAvatar() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: Text(l10n.chatAttachCamera),
                  onTap: () => Navigator.pop(ctx, ImageSource.camera),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: Text(l10n.chatAttachGallery),
                  onTap: () => Navigator.pop(ctx, ImageSource.gallery),
                ),
              ],
            ),
          ),
    );
    if (source == null) return;

    final file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 85,
    );
    if (file == null) return;

    setState(() => _uploadingAvatar = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: file.path,
            filename: file.name,
            kind: UploadKind.avatar,
          );
      final user = await ref
          .read(authRepositoryProvider)
          .updateMe(avatarAssetId: asset.id);
      ref.read(authControllerProvider.notifier).replaceUser(user);
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileSaved)));
    } on ApiException {
      messenger.showSnackBar(SnackBar(content: Text(l10n.chatAttachFailed)));
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _changeLanguage(String code) async {
    await ref.read(localeControllerProvider.notifier).setLanguage(code);
  }

  Future<void> _toggleAppLock(bool value) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (!value) {
      await ref.read(appLockProvider.notifier).disable();
      return;
    }
    // Enabling needs one successful unlock first, so nobody can lock themselves
    // out with a method their phone does not actually support.
    final ok = await ref
        .read(appLockProvider.notifier)
        .enable(l10n.profileAppLock);
    if (!ok) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Could not turn on app lock — check your device screen lock.',
          ),
        ),
      );
    }
  }

  Future<void> _confirmLogout() async {
    final l10n = AppLocalizations.of(context);
    // The same dialog the patient and doctor get, down to the wording and the
    // red confirm — three panels asking the same question three different ways
    // is three chances to misread it.
    final confirmed = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(l10n.authLogoutConfirmTitle),
            content: Text(l10n.authLogoutConfirmBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(l10n.commonCancel),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(
                  l10n.profileLogout,
                  style: TextStyle(color: AppColors.dangerOn(context)),
                ),
              ),
            ],
          ),
    );
    if (confirmed == true) {
      await ref.read(authControllerProvider.notifier).logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = isDark ? AppColors.primaryDark : AppColors.primary;

    final user = ref.watch(authControllerProvider).user;
    final currentLocale = ref.watch(localeControllerProvider);
    final lockEnabled = ref.watch(appLockProvider).enabled;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Profile',
          style: TextStyle(color: accent, fontWeight: FontWeight.w700),
        ),
        automaticallyImplyLeading: false,
        actions: const [
          // Present here too, so the count does not vanish the moment the
          // dietician opens their own settings.
          DieticianBell(),
          SizedBox(width: 4),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.md,
          AppSpacing.xl,
        ),
        children: [
          // A centred identity card rather than a row: this screen opens on
          // who the dietician is, and the credentials underneath are what a
          // patient sees attached to every plan they send.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.55),
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              children: [
                Semantics(
                  button: true,
                  label: l10n.profileChangePhoto,
                  child: GestureDetector(
                    onTap: _uploadingAvatar ? null : _changeAvatar,
                    onLongPress:
                        user?.avatarUrl != null
                            ? () =>
                                FullscreenPhoto.show(context, user!.avatarUrl)
                            : null,
                    child: Stack(
                      children: [
                        UserAvatar(
                          name: user?.name ?? '',
                          avatarUrl: user?.avatarUrl,
                          accent: accent,
                          size: 96,
                        ),
                        if (_uploadingAvatar)
                          Positioned.fill(
                            child: ClipOval(
                              child: Container(
                                color: Colors.black.withValues(alpha: 0.45),
                                child: const Center(
                                  child: SizedBox(
                                    width: 20,
                                    height: 22,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.4,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        // A 30px badge is under the 48px minimum, and this one
                        // sits at the very corner of the avatar where a thumb
                        // lands least accurately. The disc still looks the
                        // same size; the padding around it is what the finger
                        // gets, which is the point.
                        Positioned(
                          right: -9,
                          bottom: -9,
                          child: IgnorePointer(
                            child: Container(
                              width: 48,
                              height: 48,
                              alignment: Alignment.center,
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: accent,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: scheme.surfaceContainerLowest,
                                    width: 2.5,
                                  ),
                                ),
                                child: const Icon(
                                  Icons.edit_rounded,
                                  size: 14,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  user?.name ?? '',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: Text(
                        user?.specialty?.trim().isNotEmpty == true
                            ? user!.specialty!.trim()
                            : 'Dietician',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    if ((user?.phone ?? '').isNotEmpty) ...[
                      Text(
                        '  •  ',
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      Icon(
                        Icons.call_rounded,
                        size: 13,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        user!.phone,
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
                // Only what the record actually holds. The design shows a row of
                // credentials; inventing one for a dietician who has not entered
                // theirs would put a qualification on every plan they send.
                if ((user?.qualifications ?? '').trim().isNotEmpty ||
                    (user?.registrationNo ?? '').trim().isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if ((user?.qualifications ?? '').trim().isNotEmpty)
                        _CredChip(
                          label: user!.qualifications!.trim(),
                          accent: accent,
                        ),
                      if ((user?.registrationNo ?? '').trim().isNotEmpty)
                        _CredChip(
                          label: 'ID: ${user!.registrationNo!.trim()}',
                          accent: null,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          // Hidden while kDarkThemeEnabled is false: a control that
          // changes nothing is worse than no control.
          if (kDarkThemeEnabled)
            ProfileSection(
              label: l10n.profileAppearance,
              children: const [
                Padding(
                  padding: EdgeInsets.all(AppSpacing.md),
                  child: ThemeSelector(),
                ),
              ],
            ),

          // In a card, like every other group here. Loose chips on the
          // background read as content that had escaped its section rather
          // than as a setting.
          ProfileSection(
            label: l10n.profileLanguage,
            children: [
              Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    // Each option renders in its own script, so a Bengali
                    // speaker can find "বাংলা" while the app is still in
                    // English.
                    _LangChip(
                      label: l10n.languageEnglish,
                      selected: currentLocale?.languageCode == 'en',
                      accent: accent,
                      onTap: () => _changeLanguage('en'),
                    ),
                    _LangChip(
                      label: l10n.languageBengali,
                      selected: currentLocale?.languageCode == 'bn',
                      accent: accent,
                      onTap: () => _changeLanguage('bn'),
                    ),
                    _LangChip(
                      label: l10n.languageHindi,
                      selected: currentLocale?.languageCode == 'hi',
                      accent: accent,
                      onTap: () => _changeLanguage('hi'),
                    ),
                  ],
                ),
              ),
            ],
          ),

          ProfileSection(
            label: l10n.profileAccount,
            children: [
              ProfileRow(
                icon: Icons.person_outline_rounded,
                title: l10n.profileEditProfile,
                showDivider: false,
                onTap: () => context.push('/dietician/profile/edit'),
              ),
            ],
          ),

          _label(l10n.profileSecurity, scheme),
          Container(
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
              border: Border.all(color: scheme.outlineVariant),
            ),
            clipBehavior: Clip.antiAlias,
            child: SwitchListTile.adaptive(
              value: lockEnabled,
              onChanged: _toggleAppLock,
              activeThumbColor: accent,
              secondary: Icon(Icons.lock_outline_rounded, color: accent),
              title: Text(
                l10n.profileAppLock,
                style: const TextStyle(fontSize: 16),
              ),
              // Two lines of helper text at 14 against a 16 title, with a
              // switch and an icon on the same row, left roughly nothing for
              // the words. Smaller, muted and given some line height, it reads
              // as the explanation it is rather than as a second title.
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  l10n.profileAppLockSub,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: 8,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          ProfileSection(
            label: 'App',
            children: [
              ProfileRow(
                icon: Icons.info_outline_rounded,
                title: l10n.profileAbout,
                value: 'v${AppConfig.appVersion}',
                showDivider: false,
                onTap:
                    () => showAboutDialog(
                      context: context,
                      applicationName: AppConfig.appName,
                      applicationVersion: 'v${AppConfig.appVersion}',
                    ),
              ),
            ],
          ),

          // Set apart from the settings above it. Flush under the last card,
          // "Log out" read as one more row of the App group — and it is the
          // only control here that ends the session.
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.lg),
            child: Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.7),
            ),
          ),
          SizedBox(
            width: double.infinity,
            height: AppSpacing.minTapTarget + 8,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(
                  color: AppColors.dangerOn(context),
                  width: 1.5,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
                ),
              ),
              onPressed: _confirmLogout,
              icon: const Icon(Icons.logout_rounded, size: 22),
              label: Text(
                l10n.profileLogout,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(String text, ColorScheme scheme) => Padding(
    padding: const EdgeInsets.only(left: 4, bottom: AppSpacing.sm),
    child: Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.6,
        color: scheme.onSurfaceVariant,
      ),
    ),
  );
}

class _LangChip extends StatelessWidget {
  const _LangChip({
    required this.label,
    required this.selected,
    required this.accent,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? accent.withValues(alpha: 0.12) : scheme.surface,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? accent : scheme.outlineVariant,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? accent : scheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

/// A credential on the profile card — the accented one is what the dietician
/// qualified in, the plain one is the number the clinic files them under.
class _CredChip extends StatelessWidget {
  const _CredChip({required this.label, required this.accent});

  final String label;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final on = accent ?? scheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: on.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: on),
      ),
    );
  }
}
