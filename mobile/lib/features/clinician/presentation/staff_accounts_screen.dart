import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../domain/staff_member.dart';
import '../data/clinician_repository.dart';
import 'widgets/verified_phone_field.dart';

/// Who works the front desk.
///
/// There was no way to make one of these. Dieticians could be added from the
/// app and staff could not, so a new receptionist meant somebody opening a
/// shell on the server and running a seed script — which in practice means the
/// clinic waits for whoever knows how, and in the meantime shares an existing
/// login. A shared login is why an audit trail stops being able to answer who
/// did something.
///
/// Two ways in, because a clinic has both situations. The doctor creates the
/// account outright when the desk phone is a handset that lives on the counter.
/// Accounts are created here and nowhere else.
///
/// There was an invite code beside this: a shared string a receptionist typed
/// into the public registration form to become staff. It is gone. A code read
/// out over a counter cannot be un-shared, does not record who used it, and
/// works until somebody remembers to rotate it — and one of the clinic's was
/// used by an account nobody recognised.
///
/// Creating the account outright is slower by one screen and answers the
/// question the code could not: who this is. The old comment said the invite
/// on it themselves and never has a password read out to them.
class StaffAccountsScreen extends ConsumerStatefulWidget {
  const StaffAccountsScreen({super.key});

  @override
  ConsumerState<StaffAccountsScreen> createState() =>
      _StaffAccountsScreenState();
}

class _StaffAccountsScreenState extends ConsumerState<StaffAccountsScreen> {
  late Future<List<StaffMember>> _staff;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final repo = ref.read(clinicianRepositoryProvider);
    _staff = repo.staff();
  }

  Future<void> _refresh() async {
    setState(_load);
    await _staff;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Front desk')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _addStaff,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: const Text('Add staff'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            96,
          ),
          children: [
            Text(
              'A front-desk account can see every patient in the clinic, book '
              'and cancel appointments, and read the care inbox. It cannot '
              'prescribe, and it cannot resolve a clinical alert.',
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            const SizedBox(height: AppSpacing.lg),

            Text(
              'ACCOUNTS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.8,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),

            FutureBuilder<List<StaffMember>>(
              future: _staff,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(AppSpacing.lg),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snap.hasError) {
                  return ErrorView(
                    error: snap.error!,
                    onRetry: () => setState(_load),
                  );
                }
                final items = snap.data ?? const <StaffMember>[];
                if (items.isEmpty) {
                  return _Empty(scheme: scheme);
                }
                return Column(
                  children: [
                    for (final s in items)
                      _StaffTile(
                        member: s,
                        onRemove: _busy ? null : () => _removeStaff(s),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  // ---- actions ---------------------------------------------------------------

  Future<void> _removeStaff(StaffMember s) async {
    final ok = await _confirm(
      title: 'Close ${s.name}?',
      body:
          'They will not be able to sign in again. What they did stays on the '
          'record — the account is closed, not deleted.',
      action: 'Close account',
    );
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await ref.read(clinicianRepositoryProvider).removeStaff(s.id);
      if (mounted) setState(_load);
    } catch (e) {
      _say(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addStaff() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _AddStaffSheet(),
    );
    if (created == true && mounted) setState(_load);
  }

  Future<bool> _confirm({
    required String title,
    required String body,
    required String action,
  }) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(title),
            content: Text(body),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(action),
              ),
            ],
          ),
    );
    return ok ?? false;
  }

  void _say(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(ErrorView.messageFor(context, e))));
  }
}

class _StaffTile extends StatelessWidget {
  const _StaffTile({required this.member, required this.onRemove});

  final StaffMember member;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final last = member.lastLoginAt;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        children: [
          UserAvatar(
            name: member.name,
            avatarUrl: member.avatarUrl,
            accent: AppColors.primary,
            size: 42,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  member.name,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                // Every number that opens this account, not just the first.
                // A second line nobody can see here is a way in nobody is
                // counting.
                Text(
                  member.allPhones.join(' · '),
                  style: TextStyle(
                    fontSize: 13,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                Text(
                  last == null
                      ? 'Never signed in'
                      : 'Last signed in ${DateFormat('d MMM').format(last)}',
                  style: TextStyle(
                    fontSize: 12,
                    color:
                        last == null
                            ? AppColors.warningOn(context)
                            : scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onRemove,
            tooltip: 'Close this account',
            icon: const Icon(Icons.person_remove_outlined),
            color: AppColors.danger,
          ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.scheme});

  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        children: [
          Icon(Icons.badge_outlined, size: 32, color: scheme.onSurfaceVariant),
          const SizedBox(height: AppSpacing.sm),
          const Text(
            'No front-desk accounts yet',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            'Add one directly, or issue a code and let them register on their '
            'own phone.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// Creating an account outright, for a desk handset with no personal owner.
class _AddStaffSheet extends ConsumerStatefulWidget {
  const _AddStaffSheet();

  @override
  ConsumerState<_AddStaffSheet> createState() => _AddStaffSheetState();
}

class _AddStaffSheetState extends ConsumerState<_AddStaffSheet> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  /// Proof the number was answered, or null until it is.
  String? _phoneToken;
  final _password = TextEditingController();
  bool _setPassword = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final token = _phoneToken;
    if (token == null) {
      setState(
        () => _error = 'Verify their number before creating the account.',
      );
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .createStaff(
            name: _name.text.trim(),
            phoneToken: token,
            password: _setPassword ? _password.text : null,
          );
      if (mounted) Navigator.pop(context, true);
      return;
    } catch (e) {
      if (mounted) setState(() => _error = ErrorView.messageFor(context, e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.md,
          0,
          AppSpacing.md,
          MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
        ),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Add front-desk staff',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                'Name the desk, not the person, if two people share the shift '
                '— every action is recorded against this account.',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  hintText: 'Clinic Reception',
                  prefixIcon: Icon(Icons.badge_outlined),
                ),
                validator:
                    (v) =>
                        (v == null || v.trim().length < 2)
                            ? 'Enter a name'
                            : null,
              ),
              const SizedBox(height: AppSpacing.md),

              VerifiedPhoneField(
                label: 'Their mobile number',
                onToken: (t) => setState(() => _phoneToken = t),
              ),
              const SizedBox(height: AppSpacing.sm),

              // Off by default. A texted code is how everyone else signs in,
              // and a password the doctor invents and reads out is a
              // credential travelling by word of mouth. It is here because a
              // handset that lives on the counter has no personal phone to
              // receive a code on.
              SwitchListTile.adaptive(
                value: _setPassword,
                onChanged: (v) => setState(() => _setPassword = v),
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'Set a password',
                  style: TextStyle(fontSize: 15),
                ),
                subtitle: Text(
                  'Only for a shared desk handset. Otherwise they sign in with '
                  'a code texted to the number above.',
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              if (_setPassword) ...[
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Password',
                    prefixIcon: Icon(Icons.lock_outline_rounded),
                  ),
                  validator:
                      (v) =>
                          (!_setPassword || (v ?? '').length >= 8)
                              ? null
                              : 'At least 8 characters',
                ),
                const SizedBox(height: AppSpacing.sm),
              ],

              if (_error != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  _error!,
                  style: const TextStyle(fontSize: 13, color: AppColors.danger),
                ),
              ],

              const SizedBox(height: AppSpacing.md),
              FilledButton(
                onPressed: _saving ? null : _save,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                ),
                child:
                    _saving
                        ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.2,
                            color: Colors.white,
                          ),
                        )
                        : const Text('Create account'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
