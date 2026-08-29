import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/app_spacing.dart';
import '../../core/theme/tokens.dart';
import '../../features/auth/domain/user.dart';
import '../../l10n/gen/app_localizations.dart';
import 'fullscreen_photo.dart';
import 'user_avatar.dart';

/// The photograph at the top of a profile, and the two lines under it.
///
/// One widget rather than one per panel. It began on the patient's profile and
/// the front desk grew a smaller, plainer copy: a 56px avatar in a row, no
/// ring, no shadow, a hard blue dot for a badge. Nothing was wrong with it
/// except that it was a different thing — the same screen, in the same app,
/// answering the same question, and a reader had to learn it twice.
///
/// The role pill is the one part that varies, so it is the one part passed in.

class ProfilePhotoHeader extends StatelessWidget {
  const ProfilePhotoHeader({
    super.key,
    required this.user,
    required this.accent,
    required this.uploading,
    required this.onEditPhoto,
    required this.roleLabel,
  });

  final AppUser? user;
  final Color accent;
  final bool uploading;
  final VoidCallback? onEditPhoto;

  /// What this account is: "Patient", "Clinic staff". Shown in the pill under
  /// the number, because on a shared handset the first question about an
  /// account is which one is signed in.
  final String roleLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final name = user?.name ?? '';

    return Column(
      children: [
        Semantics(
          button: true,
          label: l10n.profileChangePhoto,
          child: GestureDetector(
            onTap: onEditPhoto,
            // Hold to view the photo full-screen (only when one is set).
            onLongPress:
                user?.avatarUrl != null
                    ? () => FullscreenPhoto.show(context, user!.avatarUrl)
                    : null,
            child: Stack(
              children: [
                // A white ring and a soft shadow. Against a pale tinted
                // band the photo's own edge was the only thing separating it
                // from the background, so it sat *in* the band rather than on
                // it — the single biggest reason this header looked flat.
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x1F0B1B3A),
                        blurRadius: 16,
                        offset: Offset(0, 6),
                      ),
                    ],
                  ),
                  child: UserAvatar(
                    name: name,
                    avatarUrl: user?.avatarUrl,
                    accent: accent,
                    size: 96,
                  ),
                ),
                // Dim + spinner while the new photo is uploading.
                if (uploading)
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
                // Camera badge in the corner.
                // Frosted rather than a solid blue disc. At 96px the badge
                // is the second-brightest thing in the header and it was
                // winning against the face; a real backdrop blur keeps it
                // legible over whatever the photo puts behind it without
                // shouting. This is one of the two places in the app where a
                // blur has something detailed to work on and earns its cost.
                Positioned(
                  right: 2,
                  bottom: 2,
                  child: ClipOval(
                    child: BackdropFilter(
                      filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: const Color(
                            0xFF0B1B3A,
                          ).withValues(alpha: 0.55),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.55),
                            width: 1.2,
                          ),
                        ),
                        child: const Icon(
                          Icons.photo_camera_rounded,
                          size: 15,
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
          name,
          textAlign: TextAlign.center,
          style: T.title.copyWith(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 2),
        Text(
          user?.phone ?? '',
          style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            roleLabel,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}
