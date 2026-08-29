import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/data/upload_repository.dart';
import 'package:image_picker/image_picker.dart';
import '../../profile/presentation/widgets/theme_selector.dart';
import '../../profile/presentation/widgets/profile_section.dart';
import '../../../shared/providers/app_lock_provider.dart';
import '../../../shared/providers/theme_provider.dart';
import '../../../core/config/app_config.dart';
import '../../../shared/widgets/profile_photo_header.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/language_picker.dart';
import '../../../shared/providers/locale_provider.dart';

/// The desk's own settings.
///
/// Deliberately short, and defined as much by what is absent. The doctor's
/// Profile carries the prescription letterhead, his professional details, his
/// digital signature and the knowledge base; staff landed on all of it, and
/// none of it is theirs. What is here is the clinic's own record — the name,
/// the numbers and the logo patients see — their own account, and the way out.
///
/// The clinic details are editable by the desk on purpose: a phone number
/// changing is exactly the sort of thing reception knows about first, and
/// making the doctor do it is how a wrong number stays on a letterhead for a
/// year.
class StaffProfileScreen extends ConsumerStatefulWidget {
  const StaffProfileScreen({super.key});

  @override
  ConsumerState<StaffProfileScreen> createState() => _StaffProfileScreenState();
}

class _StaffProfileScreenState extends ConsumerState<StaffProfileScreen> {
  bool _uploadingAvatar = false;

  /// Change the photo on this account.
  ///
  /// Every other panel already had this — the doctor's, the dietician's and
  /// the patient's all upload an avatar from their own profile. The desk's
  /// showed the picture and offered no way to set one, so the account was
  /// stuck with an initial for good.
  Future<void> _changeAvatar() async {
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
                  title: Text(AppLocalizations.of(context).deskTakePhoto),
                  onTap: () => Navigator.pop(ctx, ImageSource.camera),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: Text(
                    AppLocalizations.of(context).deskChooseFromGallery,
                  ),
                  onTap: () => Navigator.pop(ctx, ImageSource.gallery),
                ),
                const SizedBox(height: AppSpacing.sm),
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
      final updated = await ref
          .read(authRepositoryProvider)
          .updateMe(avatarAssetId: asset.id);
      ref.read(authControllerProvider.notifier).replaceUser(updated);
      messenger.showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).deskPhotoUpdated)),
      );
    } catch (e) {
      // The reason, not just the fact — a picture too large and an expired
      // session are different problems with different answers.
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorView.messageFor(context, e))),
      );
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _changeLanguage(String code) async {
    await ref.read(localeControllerProvider.notifier).setLanguage(code);
    ref.read(authControllerProvider.notifier).updateLocalUserLanguage(code);
    // Best-effort. The interface has already switched; the account copy only
    // decides what the assistant answers in when a client omits it.
    try {
      await ref.read(authRepositoryProvider).updateMe(language: code);
    } catch (_) {
      // Non-fatal — the local preference still applies.
    }
  }

  Future<void> _toggleAppLock(bool enable) async {
    final messenger = ScaffoldMessenger.of(context);
    final controller = ref.read(appLockProvider.notifier);
    final unavailable = AppLocalizations.of(context).deskNoDeviceLock;

    if (enable) {
      if (!await controller.canUse()) {
        messenger.showSnackBar(SnackBar(content: Text(unavailable)));
        return;
      }
      final ok = await controller.enable(
        AppLocalizations.of(context).appLockPrompt,
      );
      if (!ok) {
        messenger.showSnackBar(SnackBar(content: Text(unavailable)));
      }
    } else {
      await controller.disable();
    }
  }

  Future<void> _showAbout() async {
    final scheme = Theme.of(context).colorScheme;
    await showDialog<void>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(AppConfig.appName),
            content: Text(
              'Version ${AppConfig.appVersion}',
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(AppLocalizations.of(context).commonClose),
              ),
            ],
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(authControllerProvider).user;
    final clinics = ref.watch(clinicsProvider).valueOrNull ?? const [];
    final primary = clinics.where((c) => c.isActive).firstOrNull;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            96,
          ),
          children: [
            // The same photograph block the patient's profile has, because it
            // is the same screen answering the same question. This had grown a
            // smaller, plainer copy — a 56px avatar in a row, no ring, no
            // shadow, a hard blue dot for a badge — which was not wrong so much
            // as a second thing to learn.
            ProfilePhotoHeader(
              user: user,
              accent: AppColors.primary,
              uploading: _uploadingAvatar,
              onEditPhoto: _uploadingAvatar ? null : _changeAvatar,
              // Named for the desk rather than the person, because that is what
              // this account is: the line, not whoever is holding it this
              // afternoon.
              roleLabel: l10n.deskClinicStaff,
            ),
            const SizedBox(height: AppSpacing.lg),

            // Appearance and language first, then what this account is,
            // then what it can reach.
            //
            // Shaped like the patient's profile because it is the same kind of
            // screen and a reader should not have to learn it twice — but not
            // a copy of it. Glucose units, health details and lab reports are a
            // patient's; medication reminders are a patient's; "call the
            // clinic" is absurd on the account that answers the phone. What is
            // left is what a desk actually has.
            if (kDarkThemeEnabled) ...[
              _SectionLabel(l10n.profileAppearance),
              const ThemeSelector(),
              const SizedBox(height: AppSpacing.lg),
            ],

            // The picker, and now something for it to change.
            //
            // It was here, doing almost nothing, because every screen on the
            // clinic side was written in English in the source rather than
            // through the localisations — so বাংলা switched the app locale, moved
            // the date format, and left every visible word where it was.
            //
            // The desk's own screens are through the localisations now, dates
            // included. What is still English is the care inbox the middle tab
            // opens, which is shared with the doctor's panel and comes next.
            ProfileSection(
              label: l10n.profileLanguage,
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: LanguagePicker(
                    selected: ref.watch(localeControllerProvider)?.languageCode,
                    onChanged: _changeLanguage,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            ProfileSection(
              label: l10n.deskTheClinic,
              children: [
                ProfileRow(
                  icon: Icons.storefront_outlined,
                  title: primary?.name ?? l10n.deskClinicDetails,
                  // One row, because there is one destination.
                  //
                  // "Clinic details" and "Opening hours" pushed the same route
                  // — the same Edit clinic screen, which holds both. Two rows
                  // onto one screen is the lie the Patients and Messages tabs
                  // told: whoever taps both learns the list is not describing
                  // what sits behind it.
                  subtitle:
                      primary == null
                          ? l10n.deskClinicDetailsSub
                          : [
                            if (primary.phones.isNotEmpty)
                              primary.phones.join('   '),
                            if (primary.city != null) primary.city!,
                            l10n.deskOpeningHours,
                          ].join('    '),
                  showDivider: false,
                  onTap:
                      () =>
                          primary == null
                              ? context.push('/staff/clinics/new')
                              : context.push(
                                '/staff/clinics/${primary.id}',
                                extra: primary,
                              ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            ProfileSection(
              label: l10n.deskThisAccount,
              children: [
                ProfileRow(
                  icon: Icons.badge_outlined,
                  title: l10n.deskYourDetails,
                  subtitle: l10n.deskYourDetailsSub,
                  showDivider: false,
                  onTap: () => context.push('/staff/profile/edit'),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            // Security matters more here than anywhere else in the app: this
            // is the one account that lives on a shared handset, left on a
            // counter, in reach of whoever is standing at it.
            _SectionLabel(l10n.profileSecurity),
            Container(
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                border: Border.all(color: scheme.outlineVariant),
              ),
              clipBehavior: Clip.antiAlias,
              child: SwitchListTile.adaptive(
                value: ref.watch(appLockProvider).enabled,
                onChanged: _toggleAppLock,
                activeThumbColor: AppColors.primary,
                secondary: const Icon(
                  Icons.lock_outline_rounded,
                  color: AppColors.primary,
                ),
                title: Text(
                  l10n.profileAppLock,
                  style: const TextStyle(fontSize: 16),
                ),
                subtitle: Text(
                  l10n.deskAppLockSub,
                  style: const TextStyle(fontSize: 14),
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: 4,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            ProfileSection(
              label: l10n.deskAbout,
              children: [
                ProfileRow(
                  icon: Icons.info_outline_rounded,
                  title: l10n.profileAbout,
                  value: 'v${AppConfig.appVersion}',
                  showDivider: false,
                  onTap: _showAbout,
                ),
              ],
            ),

            const SizedBox(height: AppSpacing.lg),
            // Set apart, below a gap, so it is never the thing tapped by
            // accident on the way to something else.
            OutlinedButton.icon(
              onPressed: () => _confirmSignOut(context, ref),
              icon: const Icon(Icons.logout_rounded, size: 18),
              label: Text(l10n.deskSignOut),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(
                  color: AppColors.danger.withValues(alpha: 0.4),
                ),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(AppLocalizations.of(context).deskSignOutTitle),
            content: Text(AppLocalizations.of(context).deskSignOutBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(AppLocalizations.of(context).deskStay),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(AppLocalizations.of(context).deskSignOut),
              ),
            ],
          ),
    );
    if (ok == true) await ref.read(authControllerProvider.notifier).logout();
  }
}

/// A group heading, the same shape the patient's profile uses.
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
