import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/router/area.dart';
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

Future<void> _hire(BuildContext context, WidgetRef ref, TeamRoster roster) async {
  final existing = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _HireSheet(roster: roster),
  );
  ref.invalidate(teamProvider);

  // Once the sheet has gone, on the screen that now lists them. The form read
  // as making an account, and for somebody who already uses MedPin it did
  // not: they sign in exactly as they did before.
  if (existing != true) return;
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    const SnackBar(
      content: Text(
        'They already use MedPin, so they keep their account and now work '
        'here too.',
      ),
    ),
  );
}

/// A heading on the roster, for everybody who holds [role].
typedef _RoleGroup = ({String role, String plural, String blurb, bool always});

/// Doctors first, then the desk, then dieticians, then the rest.
///
/// ---- Why every role is written out -------------------------------------
///
/// This held three. The server sends seven, and the other four were counted in
/// the "11 of 12 people" above the list while the list never drew them: a
/// laboratory technician added this morning was a number with no row. Anybody
/// whose role is not named here still gets a row, under Others, so a role the
/// server gains next month arrives as a person rather than as nobody.
///
/// The first three always show, with a sentence when nobody holds them — "no
/// dietician" is worth seeing. The rest show only when somebody does.
///
/// Each blurb is the role's permission preset in backend models/Membership.js,
/// put into words. None says a role prescribes unless its preset holds
/// PRESCRIBE.
const _groups = <_RoleGroup>[
  (
    role: 'doctor',
    plural: 'Doctors',
    blurb: 'They see patients, prescribe, and hold their own caseload.',
    always: true,
  ),
  (
    role: 'staff',
    plural: 'Front desk',
    blurb: 'Register, book and take payment. They do not prescribe.',
    always: true,
  ),
  (
    role: 'dietician',
    plural: 'Dieticians',
    blurb: 'Write diet plans and review food logs.',
    always: true,
  ),
  (
    role: 'doctor_assistant',
    plural: 'Doctor’s assistants',
    blurb: 'Work on the record beside a doctor. They do not prescribe.',
    always: false,
  ),
  (
    role: 'lab_manager',
    plural: 'Laboratory managers',
    blurb:
        'Run the laboratory’s work and results, and read the audit log. '
        'They do not prescribe.',
    always: false,
  ),
  (
    role: 'lab_technician',
    plural: 'Laboratory technicians',
    blurb: 'Record results at the bench. They do not prescribe.',
    always: false,
  ),
  (
    role: 'practice_manager',
    plural: 'Practice managers',
    blurb:
        'Run departments and billing, and read the audit log. They cannot '
        'open a patient’s record.',
    always: false,
  ),
];

const _othersPlural = 'Others';
const _othersBlurb =
    'This version of the app has no heading for their role, so it is named on '
    'each of them.';

/// What this screen calls a role, in every place it names one.
///
/// The profile's names from [roleLabels], except the desk: "Clinic staff"
/// there, "Front desk" here, where it sits beside six other kinds of staff. A
/// role neither knows is its own name made readable, never a blank.
String _roleLabel(String role) {
  if (role == 'staff') return 'Front desk';
  final known = roleLabels[role];
  if (known != null) return known;
  final words = role.replaceAll('_', ' ').trim();
  if (words.isEmpty) return 'No role';
  return words[0].toUpperCase() + words.substring(1);
}

/// The role mid-sentence: "a laboratory technician", "the front desk".
String _roleInSentence(String role) {
  if (role == 'staff') return 'the front desk';
  final label = _roleLabel(role).toLowerCase();
  return '${'aeiou'.contains(label[0]) ? 'an' : 'a'} $label';
}

class _Roster extends ConsumerWidget {
  const _Roster({required this.roster});

  final TeamRoster roster;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final named = {for (final g in _groups) g.role};
    final others = roster.items.where((m) => !named.contains(m.role)).toList();

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
        for (final g in _groups)
          if (g.always || roster.items.any((m) => m.role == g.role)) ...[
            _Group(
              title: g.plural,
              blurb: g.blurb,
              people: roster.items.where((m) => m.role == g.role).toList(),
              roster: roster,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        if (others.isNotEmpty) ...[
          _Group(
            title: _othersPlural,
            blurb: _othersBlurb,
            people: others,
            roster: roster,
            namesRoles: true,
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
  const _Group({
    required this.title,
    required this.blurb,
    required this.people,
    required this.roster,
    this.namesRoles = false,
  });

  final String title;
  final String blurb;
  final List<TeamMember> people;
  final TeamRoster roster;

  /// Names each person's role on their row — for Others, where the heading
  /// cannot.
  final bool namesRoles;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: T.title),
        const SizedBox(height: AppSpacing.xs),
        Text(
          // Empty is informative here, not noise: "no dietician" is a fact a
          // doctor should be able to see without counting rows.
          people.isEmpty ? 'Nobody yet. $blurb' : blurb,
          style: T.small.copyWith(color: T.inkMuted),
        ),
        for (final m in people) ...[
          const SizedBox(height: AppSpacing.sm),
          _Person(
            member: m,
            role: namesRoles ? _roleLabel(m.role) : null,
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
  const _Person({required this.member, this.role, this.onTap});

  final TeamMember member;

  /// Their role in words, when the heading above them does not already say it.
  final String? role;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final m = member;
    final role = this.role;
    final gone = m.status != 'active';

    // Everything under the name, in one wrap so it reflows rather than
    // ellipsising. A department name and a location name on one line is wider
    // than a phone in Bengali at a raised text scale.
    final facts = <Widget>[
      if (role != null) _Tag(label: role, tone: _Tone.muted),
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
      final existing = await ref.read(clinicianRepositoryProvider).hire(
            role: _role,
            name: _name.text.trim(),
            phoneToken: token,
            password: _setPassword ? _password.text : null,
            departmentId: _departmentId,
            locationId: _locationId,
            qualifications: _role == 'doctor' ? _quals.text.trim() : null,
            registrationNo: _role == 'doctor' ? _reg.text.trim() : null,
          );
      // Whether they already had an account goes back with the sheet, so the
      // screen can say so once the sheet is out of the way.
      if (mounted) Navigator.of(context).pop(existing);
    } catch (e) {
      if (mounted) {
        setState(
          () => _serverError = _problem(
            e,
            'Could not add them. Check the connection and try again.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDoctor = _role == 'doctor';
    final repository = ref.read(clinicianRepositoryProvider);

    return _Sheet(
      title: 'Add someone',
      subtitle: 'They sign in with a code texted to this number.',
      child: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _RolePicker(
              value: _role,
              onChanged: (r) => setState(() => _role = r),
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
              // The team's routes, not registration's. Registration refuses a
              // number that already has an account, and that is every doctor
              // or receptionist who already uses MedPin somewhere else — so
              // none of them could ever be added here.
              sendCode: repository.requestHireCode,
              verifyCode: repository.verifyHireCode,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'If they already use MedPin, they keep their account and sign in '
              'as before.',
              style: T.small.copyWith(color: T.inkMuted),
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
              title: const Text('Set a password', style: T.body),
              subtitle: Text(
                // "A new account" said here, beside the switch, because this is
                // where somebody adding a colleague who already uses MedPin
                // would think they were choosing that colleague's password.
                'Only for a new account, on a shared handset with no personal '
                'phone. Otherwise they sign in with a code.',
                style: T.small.copyWith(color: T.inkMuted),
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

  /// Out of this practice when the sheet opened: suspended, or left.
  ///
  /// ---- Why "left" counts ----------------------------------------------------
  ///
  /// Only `suspended` did, so somebody who had left opened with the switch off
  /// — reading as a person with access — and saving any other change sent
  /// `active` along with it, handing their access back without anybody asking
  /// for it. Neither can sign in here, so both open with the switch on.
  late final bool _wasOut = _isOut(widget.member.status);
  late bool _suspended = _wasOut;

  static bool _isOut(String status) =>
      status == 'suspended' || status == 'left';

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
            // Only when the switch was moved, so `active` goes only when it
            // was turned off. Re-sending the state it opened in is not
            // harmless: `active` is the server's cue to clear a left mark and
            // check the staff limit, and somebody shown as "Account off" may
            // have left as well — a department change must not bring them
            // back.
            status: _suspended == _wasOut
                ? null
                : (_suspended ? 'suspended' : 'active'),
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(
          () => _serverError = _problem(
            e,
            'Could not save. Check the connection and try again.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.member;

    return _Sheet(
      title: m.name,
      subtitle: 'What they are here. Their name and number are theirs to edit.',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _RolePicker(
            value: _role,
            onChanged: (r) => setState(() => _role = r),
          ),

          if (_role != m.role && m.usingPreset) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              // Said before it happens rather than discovered afterwards.
              'Their permissions will change to the defaults for '
              '${_roleInSentence(_role)}.',
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
            title: const Text('Suspended', style: T.body),
            subtitle: Text(
              // What it does and what it does not, because "suspended" alone
              // reads as deletion to somebody worried about losing records.
              'They cannot sign in. Everything they have already written stays '
              'exactly where it is.',
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ),
          if (m.status == 'left') ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              // The switch alone would call somebody who left "suspended", and
              // say nothing about what turning it off does.
              _suspended
                  ? 'They left this practice. Turn this off to give them their '
                      'access back.'
                  : 'They left this practice. Saving gives them their access '
                      'back.',
              style: T.small.copyWith(
                color: _suspended ? T.inkMuted : T.warning,
              ),
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

/// Every role a practice can hire into, as chips that wrap.
///
/// Three segments fitted a phone and seven do not, and a role that is cut off
/// or scrolled out of sight is a role nobody hires into — which is how the
/// laboratory roles came to exist on the server and be unreachable from here.
///
/// No run spacing: each chip already stands in a 48dp tap target, and that
/// puts the rows far enough apart.
class _RolePicker extends StatelessWidget {
  const _RolePicker({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // A name too long for one line wraps inside its chip instead of fading
        // out. A chip takes its height from the label measured at the full
        // width, then lays the label out in the narrower width its padding
        // leaves, capped at that height — so a label that only wraps in the
        // narrower width is cut, and with raised text on a 360dp phone
        // "Laboratory technician" lost its last letters. Holding the label
        // narrower than both, by more than the chip's padding at any text
        // size, makes the two passes agree on how many lines it needs.
        final labelWidth =
            constraints.hasBoundedWidth && constraints.maxWidth > T.s8
                ? constraints.maxWidth - T.s8
                : double.infinity;

        return Wrap(
          spacing: AppSpacing.sm,
          children: [
            for (final g in _groups)
              ChoiceChip(
                // No tick, as the segmented control before it had none. The
                // filled chip and its white label are the choice; a tick that
                // appears widens the chip and moves the row under the finger.
                showCheckmark: false,
                label: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: labelWidth),
                  child: Text(_roleLabel(g.role), softWrap: true, maxLines: 3),
                ),
                selected: value == g.role,
                onSelected: (_) => onChanged(g.role),
              ),
          ],
        );
      },
    );
  }
}

/// What went wrong, in the server's own sentence when the server sent one.
///
/// The refusals here are written for the person holding the phone — a
/// patient's number, somebody who already works here, a practice at its
/// limit — and printing the exception wrapped each in `ApiException(CONFLICT,
/// …)`. A failure the server did not answer gets [fallback] instead.
String _problem(Object error, String fallback) =>
    error is ApiException && error.statusCode != null ? error.message : fallback;

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
