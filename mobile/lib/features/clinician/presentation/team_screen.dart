import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/team_member.dart';
import 'clinician_providers.dart';
import 'widgets/verified_phone_field.dart';

/// Everyone who works here.
///
/// ---- Why this replaces three screens ------------------------------------
///
/// Front desk, Clinic care and half of Practice answered one question between
/// them — who works at this practice and what may they do — and none of them
/// could show a department or a location, because a membership carried
/// neither. Each knew about one role, because the role was in the URL.
///
/// A practice could not add a doctor at all. There was no screen and no route:
/// hiring one meant asking the platform operator.
///
/// ---- Grouped by role, because that is how somebody looks ---------------
///
/// Nobody opens this asking "who is the eleventh person". They open it asking
/// "who is on the desk" or "which doctors are in", so the list is grouped and
/// the groups are ordered by how often that question is asked.
class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(teamProvider);
    final roster = async.valueOrNull;

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('People')),
      floatingActionButton: roster != null && roster.canManage
          ? FloatingActionButton.extended(
              onPressed: roster.atCap
                  ? () => _atCap(context, roster)
                  : () => _hire(context, ref, roster),
              icon: const Icon(Icons.person_add_alt_1_rounded),
              label: const Text('Add someone'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(teamProvider.future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => _Failed(onRetry: () => ref.invalidate(teamProvider)),
          data: (r) => _Roster(roster: r),
        ),
      ),
    );
  }
}

void _atCap(BuildContext context, TeamRoster roster) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(
        'This practice is at its limit of ${roster.staffCap} people. '
        'Remove somebody, or ask about a larger plan.',
      ),
    ),
  );
}

Future<void> _hire(BuildContext context, WidgetRef ref, TeamRoster roster) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _HireSheet(roster: roster),
  ).then((_) => ref.invalidate(teamProvider));
}

/// Doctors first, then the desk, then dieticians.
const _groups = <({String role, String plural, String blurb})>[
  (
    role: 'doctor',
    plural: 'Doctors',
    blurb: 'They see patients, prescribe, and hold their own caseload.',
  ),
  (
    role: 'staff',
    plural: 'Front desk',
    blurb: 'Register, book and take payment. They do not prescribe.',
  ),
  (
    role: 'dietician',
    plural: 'Dieticians',
    blurb: 'Write diet plans and review food logs.',
  ),
];

class _Roster extends ConsumerWidget {
  const _Roster({required this.roster});

  final TeamRoster roster;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        // Clear of the extended FAB.
        AppSpacing.xxl * 2,
      ),
      children: [
        if (roster.staffCap != null) ...[
          _Cap(roster: roster),
          const SizedBox(height: AppSpacing.lg),
        ],
        for (final g in _groups) ...[
          _Group(
            group: g,
            people: roster.items.where((m) => m.role == g.role).toList(),
            roster: roster,
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
        if (!roster.canManage)
          Text(
            // Said once, at the bottom, rather than as a disabled control on
            // every row. A greyed button per person is eleven reminders that
            // you cannot do something.
            'Only somebody who manages staff can add or change people here.',
            style: T.small.copyWith(color: T.inkMuted),
          ),
      ],
    );
  }
}

/// How close the practice is to its cap — shown only when there is one.
class _Cap extends StatelessWidget {
  const _Cap({required this.roster});

  final TeamRoster roster;

  @override
  Widget build(BuildContext context) {
    final cap = roster.staffCap!;
    final atCap = roster.atCap;

    return InnerTile(
      tone: atCap ? T.warningTint : null,
      child: Row(
        children: [
          Expanded(
            child: Text(
              // The numbers, not only a bar. Somebody who cannot separate
              // amber from grey still reads "11 of 12".
              '${roster.staffUsed} of $cap people',
              style: T.bodyStrong.copyWith(color: atCap ? T.warning : T.ink),
            ),
          ),
          if (atCap)
            Text('At the limit', style: T.small.copyWith(color: T.warning)),
        ],
      ),
    );
  }
}

class _Group extends ConsumerWidget {
  const _Group({required this.group, required this.people, required this.roster});

  final ({String role, String plural, String blurb}) group;
  final List<TeamMember> people;
  final TeamRoster roster;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(group.plural, style: T.title),
        const SizedBox(height: AppSpacing.xs),
        Text(
          // Empty is informative here, not noise: "no dietician" is a fact a
          // doctor should be able to see without counting rows.
          people.isEmpty ? 'Nobody yet. ${group.blurb}' : group.blurb,
          style: T.small.copyWith(color: T.inkMuted),
        ),
        for (final m in people) ...[
          const SizedBox(height: AppSpacing.sm),
          _Person(
            member: m,
            onTap: roster.canManage && !m.isOwner
                ? () => _editMember(context, ref, m, roster)
                : null,
          ),
        ],
      ],
    );
  }
}

Future<void> _editMember(
  BuildContext context,
  WidgetRef ref,
  TeamMember member,
  TeamRoster roster,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _MemberSheet(member: member, roster: roster),
  ).then((_) => ref.invalidate(teamProvider));
}

class _Person extends StatelessWidget {
  const _Person({required this.member, this.onTap});

  final TeamMember member;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final m = member;
    final gone = m.status != 'active';

    // Everything under the name, in one wrap so it reflows rather than
    // ellipsising. A department name and a location name on one line is wider
    // than a phone in Bengali at a raised text scale.
    final facts = <Widget>[
      if (m.isOwner) const _Tag(label: 'Owner', tone: _Tone.accent),
      // Every status carries a word. A greyed row is unreadable to somebody who
      // cannot separate two greys, and these readers are largely elderly.
      if (m.status == 'suspended') const _Tag(label: 'Suspended', tone: _Tone.warn),
      if (m.status == 'left') const _Tag(label: 'Left', tone: _Tone.muted),
      if (m.status == 'disabled') const _Tag(label: 'Account off', tone: _Tone.muted),
      if (m.department?.name != null)
        _Tag(label: m.department!.name!, tone: _Tone.muted),
      if (m.location?.name != null) _Tag(label: m.location!.name!, tone: _Tone.muted),
    ];

    return InnerTile(
      onTap: onTap,
      child: Row(
        children: [
          // Expanded, and no Spacer beside it — the two both take flex and
          // split the row, leaving the name ellipsised with blank space next
          // to it.
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  m.name,
                  style: T.bodyStrong.copyWith(color: gone ? T.inkMuted : T.ink),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(m.phone, style: T.small.copyWith(color: T.inkMuted)),
                if (facts.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.xs,
                    children: facts,
                  ),
                ],
              ],
            ),
          ),
          if (onTap != null) ...[
            const SizedBox(width: AppSpacing.sm),
            Icon(Icons.chevron_right_rounded, color: T.inkFaint),
          ],
        ],
      ),
    );
  }
}

enum _Tone { accent, warn, muted }

class _Tag extends StatelessWidget {
  const _Tag({required this.label, required this.tone});

  final String label;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final colour = switch (tone) {
      _Tone.accent => T.primary,
      _Tone.warn => T.warning,
      _Tone.muted => T.inkMuted,
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.12),
        borderRadius: T.rFull,
      ),
      child: Text(label, style: T.small.copyWith(color: colour)),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Could not load the team', style: T.title),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'The list is on the server. Nothing here has changed.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: AppSpacing.md),
              FilledButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- hiring

class _HireSheet extends ConsumerStatefulWidget {
  const _HireSheet({required this.roster});

  final TeamRoster roster;

  @override
  ConsumerState<_HireSheet> createState() => _HireSheetState();
}

class _HireSheetState extends ConsumerState<_HireSheet> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _password = TextEditingController();
  final _quals = TextEditingController();
  final _reg = TextEditingController();

  String _role = 'staff';
  String? _phoneToken;
  String? _departmentId;
  String? _locationId;

  /// Off by default, for everybody.
  ///
  /// A texted code is how people sign in. A password the doctor invents and
  /// reads out is a credential travelling by word of mouth, and one the doctor
  /// then knows — worth it only for a handset that lives on a counter with no
  /// personal phone to receive a code on.
  bool _setPassword = false;
  bool _obscure = true;

  bool _saving = false;
  String? _serverError;

  @override
  void dispose() {
    _name.dispose();
    _password.dispose();
    _quals.dispose();
    _reg.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final token = _phoneToken;
    if (!(_form.currentState?.validate() ?? false)) return;
    if (token == null) {
      setState(() => _serverError = 'Verify the phone number first.');
      return;
    }

    setState(() {
      _saving = true;
      _serverError = null;
    });
    try {
      await ref.read(clinicianRepositoryProvider).hire(
            role: _role,
            name: _name.text.trim(),
            phoneToken: token,
            password: _setPassword ? _password.text : null,
            departmentId: _departmentId,
            locationId: _locationId,
            qualifications: _role == 'doctor' ? _quals.text.trim() : null,
            registrationNo: _role == 'doctor' ? _reg.text.trim() : null,
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _serverError = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDoctor = _role == 'doctor';

    return _Sheet(
      title: 'Add someone',
      subtitle: 'They sign in with a code texted to this number.',
      child: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Segmented rather than a dropdown: three fixed options, all of
            // which should be visible. A filter you cannot see is one you do
            // not use, and the same is true of a role you did not know existed.
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'doctor', label: Text('Doctor')),
                ButtonSegment(value: 'staff', label: Text('Front desk')),
                ButtonSegment(value: 'dietician', label: Text('Dietician')),
              ],
              selected: {_role},
              onSelectionChanged: (s) => setState(() => _role = s.first),
              showSelectedIcon: false,
            ),
            const SizedBox(height: AppSpacing.md),

            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              maxLength: AuthValidators.maxNameLength,
              decoration: const InputDecoration(
                labelText: 'Full name',
                prefixIcon: Icon(Icons.person_outline_rounded),
                counterText: '',
              ),
              validator: (v) {
                final name = (v ?? '').trim();
                if (name.isEmpty) return 'Enter their name.';
                if (name.length < AuthValidators.minNameLength) {
                  return 'Name must be at least ${AuthValidators.minNameLength} characters.';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.md),

            VerifiedPhoneField(
              label: 'Their mobile number',
              onToken: (t) => setState(() => _phoneToken = t),
            ),

            if (isDoctor) ...[
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _quals,
                maxLength: 120,
                decoration: const InputDecoration(
                  labelText: 'Qualifications',
                  helperText: 'Optional — prints on prescriptions',
                  counterText: '',
                  hintText: 'MBBS, MD',
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _reg,
                maxLength: 60,
                decoration: const InputDecoration(
                  labelText: 'Registration number',
                  helperText: 'Optional — prints under their signature',
                  counterText: '',
                ),
              ),
            ],

            if (widget.roster.departments.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _Picker(
                label: 'Department',
                value: _departmentId,
                options: widget.roster.departments,
                onChanged: (v) => setState(() => _departmentId = v),
              ),
            ],
            if (widget.roster.locations.length > 1) ...[
              const SizedBox(height: AppSpacing.md),
              _Picker(
                label: 'Location',
                value: _locationId,
                options: widget.roster.locations,
                onChanged: (v) => setState(() => _locationId = v),
              ),
            ],

            const SizedBox(height: AppSpacing.sm),
            SwitchListTile.adaptive(
              value: _setPassword,
              onChanged: (v) => setState(() => _setPassword = v),
              contentPadding: EdgeInsets.zero,
              title: const Text('Set a password', style: TextStyle(fontSize: 15)),
              subtitle: Text(
                'Only for a shared handset with no personal phone. Otherwise '
                'they sign in with a code.',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ),
            if (_setPassword) ...[
              const SizedBox(height: AppSpacing.sm),
              TextFormField(
                controller: _password,
                obscureText: _obscure,
                maxLength: AuthValidators.maxPasswordLength,
                decoration: InputDecoration(
                  labelText: 'Password',
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  counterText: '',
                  helperText:
                      'At least ${AuthValidators.minPasswordLength} characters. '
                      'They can change it after signing in.',
                  helperMaxLines: 2,
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
                validator: (v) {
                  if (!_setPassword) return null;
                  final p = v ?? '';
                  if (p.length < AuthValidators.minPasswordLength) {
                    return 'At least ${AuthValidators.minPasswordLength} characters.';
                  }
                  return null;
                },
              ),
            ],

            if (_serverError != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _serverError!,
                style: T.small.copyWith(color: AppColors.dangerOn(context)),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Adding…' : 'Add to the practice'),
            ),
            TextButton(
              onPressed: _saving ? null : () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------- changing a job

class _MemberSheet extends ConsumerStatefulWidget {
  const _MemberSheet({required this.member, required this.roster});

  final TeamMember member;
  final TeamRoster roster;

  @override
  ConsumerState<_MemberSheet> createState() => _MemberSheetState();
}

class _MemberSheetState extends ConsumerState<_MemberSheet> {
  late String _role = widget.member.role;
  late String? _departmentId = widget.member.department?.id;
  late String? _locationId = widget.member.location?.id;
  late bool _suspended = widget.member.status == 'suspended';

  bool _saving = false;
  String? _serverError;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _serverError = null;
    });
    try {
      await ref.read(clinicianRepositoryProvider).updateMember(
            widget.member.id,
            role: _role == widget.member.role ? null : _role,
            departmentId: _departmentId,
            locationId: _locationId,
            status: _suspended ? 'suspended' : 'active',
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _serverError = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final m = widget.member;

    return _Sheet(
      title: m.name,
      subtitle: 'What they are here. Their name and number are theirs to edit.',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'doctor', label: Text('Doctor')),
              ButtonSegment(value: 'staff', label: Text('Front desk')),
              ButtonSegment(value: 'dietician', label: Text('Dietician')),
            ],
            selected: {_role},
            onSelectionChanged: (s) => setState(() => _role = s.first),
            showSelectedIcon: false,
          ),

          if (_role != m.role && m.usingPreset) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              // Said before it happens rather than discovered afterwards.
              'Their permissions will change to the defaults for a '
              '${_role == 'staff' ? 'front-desk account' : _role}.',
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ],
          if (_role != m.role && !m.usingPreset) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              // The opposite case, and the one that surprises: somebody with a
              // customised grant keeps it, so a promoted dietician could be a
              // doctor who cannot prescribe.
              'Their permissions were set by hand and will not change with the '
              'role. Check them after saving.',
              style: T.small.copyWith(color: T.warning),
            ),
          ],

          if (widget.roster.departments.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _Picker(
              label: 'Department',
              value: _departmentId,
              options: widget.roster.departments,
              onChanged: (v) => setState(() => _departmentId = v),
            ),
          ],
          if (widget.roster.locations.length > 1) ...[
            const SizedBox(height: AppSpacing.md),
            _Picker(
              label: 'Location',
              value: _locationId,
              options: widget.roster.locations,
              onChanged: (v) => setState(() => _locationId = v),
            ),
          ],

          const SizedBox(height: AppSpacing.sm),
          SwitchListTile.adaptive(
            value: _suspended,
            onChanged: (v) => setState(() => _suspended = v),
            contentPadding: EdgeInsets.zero,
            title: const Text('Suspended', style: TextStyle(fontSize: 15)),
            subtitle: Text(
              // What it does and what it does not, because "suspended" alone
              // reads as deletion to somebody worried about losing records.
              'They cannot sign in. Everything they have already written stays '
              'exactly where it is.',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),

          if (_serverError != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              _serverError!,
              style: T.small.copyWith(color: AppColors.dangerOn(context)),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save'),
          ),
          TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ shared

class _Picker extends StatelessWidget {
  const _Picker({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final String? value;
  final List<({String id, String name})> options;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String?>(
      // Without this the field sizes itself to its widest item and clips away
      // to nothing where the parent is narrower — a chevron over an empty box.
      isExpanded: true,
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        const DropdownMenuItem(value: null, child: Text('Not set')),
        for (final o in options)
          DropdownMenuItem(value: o.id, child: Text(o.name)),
      ],
      onChanged: onChanged,
    );
  }
}

class _Sheet extends StatelessWidget {
  const _Sheet({required this.title, required this.subtitle, required this.child});

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // The keyboard, or the fields sit under it.
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(T.rSection),
          ),
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: T.title),
              const SizedBox(height: AppSpacing.xs),
              Text(subtitle, style: T.small.copyWith(color: T.inkMuted)),
              const SizedBox(height: AppSpacing.lg),
              child,
            ],
          ),
        ),
      ),
    );
  }
}
