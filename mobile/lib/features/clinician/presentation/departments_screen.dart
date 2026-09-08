import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../domain/department.dart';
import '../data/clinician_repository.dart';
import 'clinician_providers.dart';

/// The specialties this practice runs.
///
/// ---- Two kinds in one list ---------------------------------------------
///
/// Shared rows belong to the platform — Cardiology means the same thing
/// everywhere, and one practice renaming it would rename it on every other
/// practice's letterhead. A practice's own rows are the ones it added, and
/// those it may rename or retire.
///
/// The list says which is which. Without that, the edit affordance is simply
/// missing on half the rows and nothing on screen explains why.
///
/// ---- Retired, not deleted ----------------------------------------------
///
/// A department with history behind it stays. A prescription written under
/// "Diabetic Foot Clinic" still says so after the clinic stops running one, and
/// deleting the row would leave that prescription pointing at nothing.
class DepartmentsScreen extends ConsumerWidget {
  const DepartmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(departmentsProvider);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Departments')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(context, ref, null),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add department'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(departmentsProvider.future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => _Failed(
            onRetry: () => ref.invalidate(departmentsProvider),
          ),
          data: (items) => _List(items: items, ref: ref),
        ),
      ),
    );
  }
}

/// Open the sheet to add one, or rename an existing one.
Future<void> _edit(BuildContext context, WidgetRef ref, Department? existing) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _DepartmentSheet(existing: existing),
  ).then((_) => ref.invalidate(departmentsProvider));
}

class _List extends StatelessWidget {
  const _List({required this.items, required this.ref});

  final List<Department> items;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    // Its own first, then the shared ones. A practice looking at this screen is
    // looking for what it added; the platform list is reference material and
    // belongs under it.
    final mine = items.where((d) => !d.isShared).toList()
      ..sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    final shared = items.where((d) => d.isShared).toList()
      ..sort((a, b) => a.name.compareTo(b.name));

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        // Clear of the extended FAB, which otherwise sits on the last row.
        AppSpacing.xxl * 2,
      ),
      children: [
        _Heading(
          title: 'This practice',
          hint: mine.isEmpty
              // Informative rather than noise: a practice with no departments
              // of its own runs as one list, which is the right shape for a
              // solo clinic and worth saying rather than showing a blank.
              ? 'None yet. The practice runs as a single list, which is the '
                  'right shape for a solo clinic.'
              : null,
        ),
        for (final d in mine) ...[
          const SizedBox(height: AppSpacing.sm),
          _Row(
            department: d,
            onRename: () => _edit(context, ref, d),
            onToggle: () => _toggle(context, ref, d),
          ),
        ],

        const SizedBox(height: AppSpacing.xl),
        const _Heading(
          title: 'Shared specialties',
          hint: 'Defined once for every practice. Yours to use, not to edit.',
        ),
        for (final d in shared) ...[
          const SizedBox(height: AppSpacing.sm),
          _Row(department: d),
        ],
      ],
    );
  }
}

Future<void> _toggle(BuildContext context, WidgetRef ref, Department d) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref
        .read(clinicianRepositoryProvider)
        .updateDepartment(d.id, isActive: !d.isActive);
    ref.invalidate(departmentsProvider);
    messenger.showSnackBar(
      SnackBar(content: Text(d.isActive ? 'Retired' : 'Back in use')),
    );
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('$e')));
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.title, this.hint});

  final String title;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: T.title),
        if (hint != null) ...[
          const SizedBox(height: AppSpacing.xs),
          Text(hint!, style: T.small.copyWith(color: T.inkMuted)),
        ],
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.department, this.onRename, this.onToggle});

  final Department department;
  final VoidCallback? onRename;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final d = department;
    final editable = onRename != null;

    return InnerTile(
      child: Row(
        children: [
          // Expanded, not Flexible beside a Spacer: the two both take flex and
          // split the row, which leaves the name ellipsised with blank space
          // next to it. See the note in the UI rules.
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  d.name,
                  style: T.bodyStrong.copyWith(
                    color: d.isActive ? T.ink : T.inkMuted,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.xs,
                  children: [
                    // Every status carries a word. A greyed row and nothing
                    // else is unreadable to somebody who cannot separate the
                    // two greys, and this clinic's readers are elderly.
                    if (!d.isActive)
                      _Tag(label: 'Retired', tone: T.inkMuted),
                    if (!d.hasAssistant)
                      _Tag(label: 'No assistant', tone: T.inkMuted),
                    // Only on rows this practice owns.
                    //
                    // The key is what the assistant scope and the seed data
                    // point at, and it is fixed at creation — so it is worth
                    // seeing on a department somebody here made and might
                    // rename. On a shared specialty it is an identifier for
                    // something they cannot edit, printed nine times under
                    // names that already say the same thing.
                    if (!d.isShared)
                      Text(
                        d.key,
                        style: T.small.copyWith(color: T.inkFaint),
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (editable) ...[
            const SizedBox(width: AppSpacing.sm),
            _IconAction(
              icon: Icons.edit_outlined,
              label: 'Rename ${d.name}',
              onTap: onRename!,
            ),
            _IconAction(
              icon: d.isActive
                  ? Icons.archive_outlined
                  : Icons.unarchive_outlined,
              label: d.isActive ? 'Retire ${d.name}' : 'Put ${d.name} back in use',
              onTap: onToggle!,
            ),
          ],
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label, required this.tone});

  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: T.rFull,
      ),
      child: Text(label, style: T.small.copyWith(color: tone)),
    );
  }
}

/// A 48px target with a name, not a bare icon on 14px of glyph.
class _IconAction extends StatelessWidget {
  const _IconAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(T.rControl),
        child: SizedBox(
          width: T.tap,
          height: T.tap,
          child: Icon(icon, size: 20, color: T.inkMuted),
        ),
      ),
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
              Text('Could not load the departments', style: T.title),
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

/// Add one, or rename one.
class _DepartmentSheet extends ConsumerStatefulWidget {
  const _DepartmentSheet({this.existing});

  final Department? existing;

  @override
  ConsumerState<_DepartmentSheet> createState() => _DepartmentSheetState();
}

class _DepartmentSheetState extends ConsumerState<_DepartmentSheet> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  bool _saving = false;
  String? _serverError;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  /// The stable identifier, derived from the name on creation only.
  ///
  /// Not editable and not shown as a field: it is what the assistant scope and
  /// the seed data key off, so a person typing one is a person who can break
  /// the link between a department and the knowledge written for it. Renaming
  /// the department later changes the label and leaves the key alone, which is
  /// the behaviour that keeps both working.
  String get _key => _name.text
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _serverError = null;
    });
    try {
      final repo = ref.read(clinicianRepositoryProvider);
      if (widget.existing == null) {
        await repo.createDepartment(key: _key, name: _name.text.trim());
      } else {
        await repo.updateDepartment(widget.existing!.id, name: _name.text.trim());
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _serverError = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final adding = widget.existing == null;

    return Padding(
      // The keyboard, or the sheet's own fields sit under it.
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(T.rSection),
          ),
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Form(
          key: _form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                adding ? 'New department' : 'Rename department',
                style: T.title,
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                adding
                    ? 'A specialty this practice runs. Only this practice sees it.'
                    : 'The label changes. Anything already filed under it stays where it is.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: AppSpacing.lg),
              TextFormField(
                controller: _name,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                maxLength: 80,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  counterText: '',
                  hintText: 'Diabetic Foot Clinic',
                ),
                validator: (v) {
                  final name = (v ?? '').trim();
                  if (name.length < 2) return 'Give it a name.';
                  // Only on creation: an existing row keeps the key it has.
                  if (adding && _key.length < 2) {
                    return 'Use at least two letters or digits.';
                  }
                  return null;
                },
                onChanged: (_) => setState(() {}),
              ),
              if (adding && _key.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Filed as $_key. That does not change if the name does.',
                  style: T.small.copyWith(color: T.inkFaint),
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
                child: Text(
                  _saving
                      ? 'Saving…'
                      : adding
                          ? 'Add department'
                          : 'Save',
                ),
              ),
              TextButton(
                onPressed: _saving ? null : () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
