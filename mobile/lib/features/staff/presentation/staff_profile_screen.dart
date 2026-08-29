import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/data/upload_repository.dart';
import 'package:image_picker/image_picker.dart';

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
                  title: const Text('Take a photo'),
                  onTap: () => Navigator.pop(ctx, ImageSource.camera),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Choose from gallery'),
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
      messenger.showSnackBar(const SnackBar(content: Text('Photo updated')));
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

  @override
  Widget build(BuildContext context) {
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
            Row(
              children: [
                Semantics(
                  button: true,
                  label: 'Change profile photo',
                  child: GestureDetector(
                    onTap: _uploadingAvatar ? null : _changeAvatar,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        UserAvatar(
                          name: user?.name ?? '',
                          avatarUrl: user?.avatarUrl,
                          accent: AppColors.primary,
                          size: 56,
                        ),
                        if (_uploadingAvatar)
                          const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.4),
                          )
                        else
                          // A small camera badge on the corner, because an
                          // avatar that happens to be tappable looks exactly
                          // like one that is not.
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Container(
                              padding: const EdgeInsets.all(3),
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: scheme.surface,
                                  width: 2,
                                ),
                              ),
                              child: const Icon(
                                Icons.photo_camera_rounded,
                                size: 12,
                                color: Colors.white,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.name ?? '',
                        style: const TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        // Named for the desk rather than the person, because
                        // that is what this account is: the line, not whoever
                        // is holding it this afternoon.
                        'Clinic staff · ${user?.phone ?? ''}',
                        style: TextStyle(
                          fontSize: 13,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            _Group(
              title: 'The clinic',
              children: [
                _Tile(
                  icon: Icons.storefront_outlined,
                  title: primary?.name ?? 'Clinic details',
                  // One tile, because there was one destination.
                  //
                  // "Clinic details" and "Opening hours" pushed the same route
                  // — the same Edit clinic screen, which holds both. Two
                  // rows onto one screen is the lie the Patients and Messages
                  // tabs told: whoever taps both learns the list is not
                  // describing what sits behind it.
                  subtitle:
                      primary == null
                          ? 'Name, address, phones, logo and opening hours'
                          : [
                            if (primary.phones.isNotEmpty)
                              primary.phones.join(' · '),
                            if (primary.city != null) primary.city!,
                            'Opening hours',
                          ].join('  ·  '),
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

            const SizedBox(height: AppSpacing.md),
            _Group(
              title: 'This account',
              children: [
                _Tile(
                  icon: Icons.badge_outlined,
                  title: 'Your details',
                  subtitle: 'Name, photo and contact',
                  onTap: () => context.push('/staff/profile/edit'),
                ),
              ],
            ),

            const SizedBox(height: AppSpacing.lg),
            // Set apart, below a gap, so it is never the thing tapped by
            // accident on the way to something else.
            OutlinedButton.icon(
              onPressed: () => _confirmSignOut(context, ref),
              icon: const Icon(Icons.logout_rounded, size: 18),
              label: const Text('Sign out'),
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
            title: const Text('Sign out?'),
            content: const Text(
              'You will need the clinic number and the password, or a code sent '
              'by SMS, to sign in again.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Stay'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Sign out'),
              ),
            ],
          ),
    );
    if (ok == true) await ref.read(authControllerProvider.notifier).logout();
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
            title.toUpperCase(),
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(children: children),
        ),
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      onTap: onTap,
      leading: Icon(icon, color: AppColors.primary),
      title: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        subtitle,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
      ),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: scheme.onSurfaceVariant,
      ),
    );
  }
}
