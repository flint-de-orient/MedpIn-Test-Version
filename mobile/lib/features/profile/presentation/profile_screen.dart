import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/update/app_update_section.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/hero_band.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../shared/providers/app_lock_provider.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/providers/preferences_provider.dart';
import '../../../shared/widgets/profile_photo_header.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../auth/presentation/auth_controller.dart';
import 'widgets/profile_section.dart';
import 'widgets/theme_selector.dart';
import '../../../shared/providers/theme_provider.dart';
import 'licenses_screen.dart';
import '../../../shared/widgets/language_picker.dart';
import '../../../core/update/version_gate.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _uploadingAvatar = false;

  Future<void> _changeLanguage(String code) async {
    await ref.read(localeControllerProvider.notifier).setLanguage(code);
    ref.read(authControllerProvider.notifier).updateLocalUserLanguage(code);
    // Best-effort sync: the UI has already switched, and the account copy
    // matters only for what the assistant replies in when the client omits it.
    try {
      await ref.read(authRepositoryProvider).updateMe(language: code);
    } on ApiException {
      // Non-fatal — the local preference still applies.
    }
  }

  /// Pick a photo, upload it as an `avatar` asset, then point the account at it.
  /// The returned user carries the new `avatarUrl`, so swapping it into auth
  /// state refreshes the avatar everywhere without a refetch.
  Future<void> _changeAvatar() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final source = await _pickImageSource();
    if (source == null) return;

    final XFile? file = await ImagePicker().pickImage(
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

  Future<ImageSource?> _pickImageSource() {
    final l10n = AppLocalizations.of(context);
    return showModalBottomSheet<ImageSource>(
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
  }

  Future<void> _pickGlucoseUnit() async {
    final l10n = AppLocalizations.of(context);
    final current = ref.read(glucoseUnitProvider);
    final chosen = await showModalBottomSheet<GlucoseUnit>(
      context: context,
      showDragHandle: true,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    0,
                    AppSpacing.md,
                    AppSpacing.sm,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      l10n.profileGlucoseUnit,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                for (final unit in GlucoseUnit.values)
                  // A tall row, and the whole row is the target. These
                  // patients are largely elderly and many have diabetic
                  // retinopathy; a default-height ListTile asks for a more
                  // accurate tap than that deserves.
                  ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                      vertical: AppSpacing.sm,
                    ),
                    minVerticalPadding: AppSpacing.sm,
                    title: Text(
                      unit.label,
                      style: const TextStyle(fontSize: 17),
                    ),
                    trailing:
                        unit == current
                            ? Icon(
                              Icons.check_circle_rounded,
                              color: Theme.of(ctx).colorScheme.primary,
                            )
                            : null,
                    onTap: () => Navigator.pop(ctx, unit),
                  ),
              ],
            ),
          ),
    );
    if (chosen != null && chosen != current) {
      await ref.read(appPreferencesProvider.notifier).setGlucoseUnit(chosen);
    }
  }

  /// About, as a dialog we control.
  ///
  /// Flutter's showAboutDialog splits its buttons to opposite corners. Material
  /// groups actions together on the trailing side so the eye finds them in one
  /// place, and so the quieter of the two reads as the alternative rather than
  /// as a separate feature.
  Future<void> _showAbout(BuildContext context) async {
    final scheme = Theme.of(context).colorScheme;
    await showDialog<void>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(AppConfig.appName),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Version $runningVersion',
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Your care, on your phone.',
                  style: const TextStyle(fontSize: 15, height: 1.4),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const LicensesScreen(),
                    ),
                  );
                },
                child: const Text('View licenses'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(AppLocalizations.of(context).commonClose),
              ),
            ],
          ),
    );
  }

  Future<void> _toggleAppLock(bool enable) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final controller = ref.read(appLockProvider.notifier);

    if (enable) {
      if (!await controller.canUse()) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.appLockUnavailable)),
        );
        return;
      }
      final ok = await controller.enable(l10n.appLockPrompt);
      if (!ok) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.appLockUnavailable)),
        );
      }
    } else {
      await controller.disable();
    }
  }

  Future<void> _callClinic() async {
    final phone =
        ref.read(clinicPhoneProvider).valueOrNull ??
        AppConfig.clinicPhoneNumber;
    await launchUrl(Uri(scheme: 'tel', path: phone));
  }

  Future<void> _confirmLogout() async {
    final l10n = AppLocalizations.of(context);
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
    final glucoseUnit = ref.watch(glucoseUnitProvider);
    final lockEnabled = ref.watch(appLockProvider).enabled;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: Text(
          l10n.profileTitle,
          style: TextStyle(color: accent, fontWeight: FontWeight.w700),
        ),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: AppSpacing.xl),
        children: [
          // A framed card rather than a full-bleed gradient fading into the
          // page. Edge to edge, the band had no bottom — identity and settings
          // ran into each other and the whole top of the screen read as
          // unfinished. Given a card it becomes one object you can point at.
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              0,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(T.rSection),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(T.rSection),
                  boxShadow: T.e1,
                ),
                child: HeroSurface(
                  child: ProfilePhotoHeader(
                    user: user,
                    accent: accent,
                    uploading: _uploadingAvatar,
                    onEditPhoto: _uploadingAvatar ? null : _changeAvatar,
                    roleLabel: l10n.profilePatient,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ---- Appearance -----------------------------------------------
                // Hidden while kDarkThemeEnabled is false: a control that
                // changes nothing is worse than no control.
                if (kDarkThemeEnabled) ...[
                  _SectionLabel(l10n.profileAppearance),
                  const ThemeSelector(),
                ],
                const SizedBox(height: AppSpacing.lg),

                // ---- Language --------------------------------------------------
                // In a card, like every other group on this screen. Bare chips
                // on the page background made the one section a first-time
                // user is most likely to touch the only one that did not look
                // like part of the app.
                ProfileSection(
                  label: l10n.profileLanguage,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: LanguagePicker(
                        selected: currentLocale?.languageCode,
                        onChanged: _changeLanguage,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),

                // ---- Preferences ----------------------------------------------
                ProfileSection(
                  label: l10n.profilePreferences,
                  children: [
                    ProfileRow(
                      icon: Icons.water_drop_outlined,
                      title: l10n.profileGlucoseUnit,
                      value: glucoseUnit.label,
                      onTap: _pickGlucoseUnit,
                    ),
                    // Here rather than under "your information": this is how the
                    // app behaves, not something the clinic holds about you.
                    ProfileRow(
                      icon: Icons.notifications_none_rounded,
                      title: l10n.profileNotifications,
                      showDivider: false,
                      onTap: () => context.push('/profile/notifications'),
                    ),
                  ],
                ),

                // ---- Your information ------------------------------------------
                //
                // Five unrelated destinations used to share one card: personal
                // details, health record, lab reports, notification switches and
                // a feedback form, separated only by hairlines. A list that long
                // is scanned rather than read, and the thing being looked for is
                // found by luck. Split by what each one is ABOUT — what the
                // clinic holds on you, how the app behaves, and how to reach a
                // person — so a heading answers the question before the rows do.
                ProfileSection(
                  label: 'Your information',
                  children: [
                    ProfileRow(
                      icon: Icons.person_outline_rounded,
                      title: l10n.profileEditProfile,
                      onTap: () => context.push('/profile/edit'),
                    ),
                    ProfileRow(
                      icon: Icons.favorite_outline_rounded,
                      title: l10n.profileHealthDetails,
                      onTap: () => context.push('/profile/health'),
                    ),
                    ProfileRow(
                      icon: Icons.biotech_outlined,
                      title: 'My tests & reports',
                      showDivider: false,
                      onTap: () => context.push('/profile/tests'),
                    ),
                  ],
                ),

                // ---- Security --------------------------------------------------
                _SectionLabel(l10n.profileSecurity),
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
                    subtitle: Text(
                      l10n.profileAppLockSub,
                      style: const TextStyle(fontSize: 14),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: 4,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),

                // ---- Clinic ----------------------------------------------------
                ProfileSection(
                  label: l10n.profileClinic,
                  children: [
                    ProfileRow(
                      icon: Icons.phone_outlined,
                      title: l10n.profileCallClinic,
                      trailingIcon: Icons.open_in_new_rounded,
                      onTap: _callClinic,
                    ),
                    // Beside the clinic's number, because both are the same
                    // question: how do I reach a person about this.
                    ProfileRow(
                      icon: Icons.rate_review_outlined,
                      title: l10n.profileFeedback,
                      subtitle: l10n.profileFeedbackSub,
                      onTap: () => context.push('/profile/feedback'),
                    ),
                    ProfileRow(
                      icon: Icons.info_outline_rounded,
                      title: l10n.profileAbout,
                      value: 'v${AppConfig.appVersion}',
                      showDivider: false,
                      onTap: () => _showAbout(context),
                    ),
                  ],
                ),

                // ---- App -------------------------------------------------------
                //
                // Above sign-out and below everything else, because it is the
                // last thing anyone reads and the first thing anyone is asked
                // for when a handset misbehaves.
                const SizedBox(height: AppSpacing.lg),
                const AppUpdateSection(),

                // ---- Logout ----------------------------------------------------
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
                        borderRadius: BorderRadius.circular(
                          AppSpacing.buttonRadius,
                        ),
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
                const SizedBox(height: AppSpacing.md),
                Center(
                  child: Text(
                    l10n.profileFooter,
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The small-caps section heading used for the inline (non-boxed) sections.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: AppSpacing.sm),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.8,
          color: scheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

