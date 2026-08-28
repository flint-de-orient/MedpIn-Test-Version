import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../auth/presentation/auth_controller.dart';

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
class StaffProfileScreen extends ConsumerWidget {
  const StaffProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                UserAvatar(
                  name: user?.name ?? '',
                  avatarUrl: user?.avatarUrl,
                  accent: AppColors.primary,
                  size: 56,
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
                  subtitle:
                      primary == null
                          ? 'Name, address, phone numbers and logo'
                          : [
                            if (primary.phones.isNotEmpty)
                              primary.phones.join(' · '),
                            if (primary.city != null) primary.city!,
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
                _Tile(
                  icon: Icons.schedule_rounded,
                  title: 'Opening hours',
                  subtitle: 'When the doctor is available to be booked',
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
