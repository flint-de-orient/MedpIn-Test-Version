import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../shared/providers/app_lock_provider.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../appointments/domain/clinic.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../profile/presentation/widgets/profile_section.dart';
import '../../profile/presentation/widgets/theme_selector.dart';
import '../../../shared/widgets/authed_image.dart';
import 'widgets/panel_ui.dart';
import '../../../shared/providers/theme_provider.dart';
import 'widgets/clinician_notification_sheet.dart';
import '../../../shared/widgets/language_picker.dart';

/// Full profile for doctor and staff — the clinician counterpart of the patient
/// [ProfileScreen]: avatar, edit details, appearance, language, app lock, a
/// shortcut to clinical alerts, and sign-out.
class ClinicianMoreScreen extends ConsumerStatefulWidget {
  const ClinicianMoreScreen({super.key});

  @override
  ConsumerState<ClinicianMoreScreen> createState() =>
      _ClinicianMoreScreenState();
}

class _ClinicianMoreScreenState extends ConsumerState<ClinicianMoreScreen> {
  bool _uploadingAvatar = false;
  bool _uploadingSignature = false;

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

  /// Upload (or replace) the doctor's signature image. Embedded into every
  /// prescription PDF the server generates.
  Future<void> _changeSignature() async {
    final messenger = ScaffoldMessenger.of(context);
    final source = await _pickImageSource();
    if (source == null) return;

    final XFile? file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1200,
      maxHeight: 600,
      imageQuality: 90,
    );
    if (file == null) return;

    setState(() => _uploadingSignature = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: file.path,
            filename: file.name,
            kind: UploadKind.signature,
          );
      final user = await ref
          .read(authRepositoryProvider)
          .updateMe(signatureAssetId: asset.id);
      ref.read(authControllerProvider.notifier).replaceUser(user);
      messenger.showSnackBar(const SnackBar(content: Text('Signature saved')));
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not upload the signature')),
      );
    } finally {
      if (mounted) setState(() => _uploadingSignature = false);
    }
  }

  /// Edit the letterhead credentials printed at the top of every prescription.
  Future<void> _editProfessionalDetails() async {
    final user = ref.read(authControllerProvider).user;
    final quals = TextEditingController(text: user?.qualifications ?? '');
    final specialty = TextEditingController(text: user?.specialty ?? '');
    final reg = TextEditingController(text: user?.registrationNo ?? '');
    final messenger = ScaffoldMessenger.of(context);

    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Professional details'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: quals,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Qualifications',
                      hintText: 'MBBS, MD',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: specialty,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Specialty',
                      hintText: 'Consultant Physician & Diabetologist',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: reg,
                    decoration: const InputDecoration(
                      labelText: 'Registration no.',
                      hintText: 'WBMC-XXXXX',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Save'),
              ),
            ],
          ),
    );
    if (ok != true || !mounted) return;
    try {
      final updated = await ref
          .read(authRepositoryProvider)
          .updateMe(
            qualifications: quals.text.trim(),
            specialty: specialty.text.trim(),
            registrationNo: reg.text.trim(),
          );
      ref.read(authControllerProvider.notifier).replaceUser(updated);
      messenger.showSnackBar(const SnackBar(content: Text('Details saved')));
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not save the details')),
      );
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

  Future<void> _changeLanguage(String code) async {
    await ref.read(localeControllerProvider.notifier).setLanguage(code);
    ref.read(authControllerProvider.notifier).updateLocalUserLanguage(code);
    try {
      await ref.read(authRepositoryProvider).updateMe(language: code);
    } on ApiException {
      // Local preference still applies.
    }
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
      if (!await controller.enable(l10n.appLockPrompt)) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.appLockUnavailable)),
        );
      }
    } else {
      await controller.disable();
    }
  }

  Future<void> _confirmLogout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Log out?'),
            content: const Text(
              'You will need to log in again to access the clinic dashboard.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Log out'),
              ),
            ],
          ),
    );
    if (ok == true) await ref.read(authControllerProvider.notifier).logout();
  }

  /// Reads and updates the clinic's public phone number — the one every
  /// "Call clinic" button dials — right here, without a separate screen.
  Future<void> _editClinicNumber() async {
    final messenger = ScaffoldMessenger.of(context);
    final repo = ref.read(clinicRepositoryProvider);

    final List<Clinic> clinics;
    try {
      clinics = await repo.list();
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Could not load the clinic. Check your connection.'),
        ),
      );
      return;
    }
    if (!mounted) return;

    final Clinic? clinic = clinics.isNotEmpty ? clinics.first : null;
    final controller = TextEditingController(text: clinic?.phone ?? '');
    final saved = await showDialog<String?>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Clinic phone number'),
            content: TextField(
              controller: controller,
              keyboardType: TextInputType.phone,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Number patients call',
                hintText: '+91 98300 00000',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                child: const Text('Save'),
              ),
            ],
          ),
    );
    if (saved == null || saved.isEmpty || !mounted) return;

    try {
      if (clinic != null) {
        await repo.update(clinic.id, {'phone': saved});
      } else {
        await repo.create({'name': 'Clinic', 'phone': saved});
      }
      ref.invalidate(clinicPhoneProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('Clinic number updated')),
      );
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Could not update the number. Please try again.'),
        ),
      );
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
    final roleLabel = user?.role == 'doctor' ? 'Doctor' : 'Clinic staff';
    final clinicPhone =
        ref.watch(clinicPhoneProvider).valueOrNull ??
        AppConfig.clinicPhoneNumber;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(
          'Profile',
          style: TextStyle(color: accent, fontWeight: FontWeight.w700),
        ),
        actions: [
          // The same counted bell as the other three tabs. A bell that shows a
          // number on Home and no number here reads as "nothing waiting" on
          // whichever screen the doctor happens to be looking at.
          PanelNotificationBell(
            onTap: () => showClinicianNotifications(context),
          ),
          const SizedBox(width: 4),
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
          // ---- Header --------------------------------------------------
          Column(
            children: [
              Semantics(
                button: true,
                label: l10n.profileChangePhoto,
                child: GestureDetector(
                  onTap: _uploadingAvatar ? null : _changeAvatar,
                  onLongPress:
                      user?.avatarUrl != null
                          ? () => FullscreenPhoto.show(context, user!.avatarUrl)
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
                            child: ColoredBox(
                              color: Colors.black.withValues(alpha: 0.45),
                              child: const Center(
                                child: SizedBox(
                                  width: 24,
                                  height: 26,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.6,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: accent,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: scheme.surface,
                              width: 2.5,
                            ),
                          ),
                          child: const Icon(
                            Icons.photo_camera_rounded,
                            size: 15,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                user?.name ?? roleLabel,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 0),
              Text(
                user?.phone ?? '',
                style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.sm),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  roleLabel,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: accent,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xl),

          // ---- Account -------------------------------------------------
          ProfileSection(
            label: l10n.profileAccount,
            children: [
              ProfileRow(
                icon: Icons.person_outline_rounded,
                title: l10n.profileEditProfile,
                showDivider: false,
                onTap: () => context.push('/clinician/more/edit'),
              ),
            ],
          ),

          // ---- Appearance ----------------------------------------------
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

          // ---- Language ------------------------------------------------
          // In a card, like every other group on this screen. Loose chips
          // floating on the background read as a strip of content that had
          // escaped its section rather than as a setting.
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

          // ---- Clinic tools --------------------------------------------
          ProfileSection(
            label: 'Clinic tools',
            children: [
              // Messages deliberately absent: it is the first tab. A duplicate
              // here pointed at the retired DirectMessage inbox, so the same
              // word opened different data depending on where you tapped it.
              // Every row carries a subtitle or none of them do. Three
              // explained and three bare made the bare ones look like
              // afterthoughts, and left the reader guessing which of "Chat
              // review" and "Patient feedback" held the thing they wanted.
              ProfileRow(
                icon: Icons.notification_important_outlined,
                title: 'Clinical alerts',
                subtitle: 'Readings and symptoms that need a look',
                onTap: () => context.push('/clinician/alerts'),
              ),
              ProfileRow(
                icon: Icons.restaurant_menu_outlined,
                title: 'Clinic care',
                subtitle: 'Dieticians, invites and food-log review',
                onTap: () => context.push('/clinician/dieticians'),
              ),
              ProfileRow(
                icon: Icons.ios_share_rounded,
                title: 'Export data',
                subtitle: 'Patients, alerts and figures as CSV or JSON',
                onTap: () => context.push('/clinician/export'),
              ),
              ProfileRow(
                icon: Icons.reviews_outlined,
                title: 'Chat review',
                subtitle: 'What the assistant has been telling patients',
                onTap: () => context.push('/clinician/chat-review'),
              ),
              ProfileRow(
                icon: Icons.menu_book_outlined,
                title: 'Knowledge base',
                subtitle: 'Clinic answers the assistant draws on',
                onTap: () => context.push('/clinician/knowledge'),
              ),
              ProfileRow(
                icon: Icons.rate_review_outlined,
                title: 'Patient feedback',
                subtitle: 'Ratings and comments patients have sent',
                showDivider: false,
                onTap: () => context.push('/clinician/feedback'),
              ),
            ],
          ),

          // ---- Prescription letterhead (doctor only) -------------------
          if (user?.role == 'doctor')
            ProfileSection(
              label: 'Prescription letterhead',
              children: [
                ProfileRow(
                  icon: Icons.badge_outlined,
                  title: 'Professional details',
                  // Always says what the row is for; what is currently set
                  // goes in `value`, on the right, where every other row on
                  // this screen puts its current state. Putting the saved
                  // qualifications in the subtitle slot meant the row
                  // described itself on an empty profile and stopped
                  // describing itself the moment it was filled in.
                  subtitle: 'Qualifications, specialty & registration no.',
                  value:
                      (user?.qualifications?.isNotEmpty ?? false)
                          ? 'Set'
                          : 'Not set',
                  onTap: _editProfessionalDetails,
                ),
                ProfileRow(
                  icon: Icons.draw_outlined,
                  title: 'Digital signature',
                  subtitle: 'Printed on every prescription',
                  value:
                      _uploadingSignature
                          ? 'Uploading…'
                          : (user?.signatureUrl != null ? 'Set' : 'Not set'),
                  showDivider: user?.signatureUrl != null,
                  onTap: _uploadingSignature ? null : _changeSignature,
                ),
                // The signature as it will actually print. "Set" told the
                // doctor a file existed, not whether it was the right one, the
                // right way up, or legible — and the first place they would
                // otherwise find out is a prescription already sent.
                if (user?.signatureUrl != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      AppSpacing.sm,
                      AppSpacing.md,
                      AppSpacing.md,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'PREVIEW',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.6,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            vertical: 16,
                            horizontal: 20,
                          ),
                          decoration: BoxDecoration(
                            // White, always — the signature is cut out on
                            // transparency and prints onto white paper, so
                            // previewing it on a themed surface would show the
                            // doctor something the prescription never looks
                            // like. In dark mode especially, near-black ink on
                            // a dark card would look like nothing at all.
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: scheme.outlineVariant.withValues(
                                alpha: 0.7,
                              ),
                            ),
                          ),
                          // Sized to the card, not to a thumbnail. A signature
                          // is checked by reading it — whether it is the right
                          // one, the right way up, legible — and none of that
                          // is possible at 56px.
                          child: SizedBox(
                            width: double.infinity,
                            height: 110,
                            child: AuthedImage(
                              path: user!.signatureUrl!,
                              width: double.infinity,
                              height: 110,
                              radius: 0,
                              fit: BoxFit.contain,
                              // No plate behind it. The signature is cut out on
                              // transparency, so anything but white here would
                              // show through the ink and stop it reading as a
                              // signature on paper.
                              background: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'The paper background is removed automatically, so this prints as ink on the prescription.',
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.35,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),

          // ---- Security ------------------------------------------------
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

          // ---- Clinic --------------------------------------------------
          _label(l10n.profileClinic, scheme),
          _ClinicPhoneCard(phone: clinicPhone, onEdit: _editClinicNumber),
          const SizedBox(height: AppSpacing.lg),

          // ---- App -----------------------------------------------------
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

          // ---- Logout --------------------------------------------------
          // Set apart from the settings above it. Sitting flush under the last
          // card, "Log out" read as one more row of the App group — and it is
          // the only control on this screen that ends the session.
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
          const SizedBox(height: AppSpacing.md),
          Center(
            child: Text(
              'MedPin v${AppConfig.appVersion}',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
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
        fontSize: 14,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.8,
        color: scheme.onSurfaceVariant,
      ),
    ),
  );
}

/// A premium, tappable card for the clinic's public phone number — the one
/// every "Call clinic" button dials. The number is the hero, set beside an
/// emerald identity chip with an Edit affordance; tapping anywhere edits it.
class _ClinicPhoneCard extends StatelessWidget {
  const _ClinicPhoneCard({required this.phone, required this.onEdit});

  final String phone;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = isDark ? AppColors.primaryDark : AppColors.primary;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.22)),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onEdit,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            children: [
              // Tinted icon tile in the app's own settings-icon style (the same
              // treatment as the App lock and menu rows), not a loud gradient.
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.11),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.phone_outlined, color: accent, size: 23),
              ),
              const SizedBox(width: AppSpacing.md),
              // Label + the number as the hero.
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'CLINIC PHONE NUMBER',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.7,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      phone,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        height: 1.1,
                        color: scheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'The number patients call',
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Edit affordance.
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.edit_rounded, size: 15, color: accent),
                    const SizedBox(width: 4),
                    Text(
                      'Edit',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: accent,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
