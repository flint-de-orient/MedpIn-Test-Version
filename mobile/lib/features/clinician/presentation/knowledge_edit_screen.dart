import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../data/clinician_repository.dart';
import '../domain/knowledge_chunk.dart';
import 'clinician_providers.dart';
import 'knowledge_screen.dart' show knowledgeStatusColor, knowledgeStatusLabel;

/// Create or edit an assistant knowledge entry, and approve/retire it. Editing
/// the content sends it back to "pending review" server-side — approved text
/// can never be silently rewritten and still served.
class KnowledgeEditScreen extends ConsumerStatefulWidget {
  const KnowledgeEditScreen({super.key, this.chunk});

  final KnowledgeChunk? chunk;

  @override
  ConsumerState<KnowledgeEditScreen> createState() =>
      _KnowledgeEditScreenState();
}

class _KnowledgeEditScreenState extends ConsumerState<KnowledgeEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _docId;
  late final TextEditingController _title;
  late final TextEditingController _section;
  late final TextEditingController _content;
  late final TextEditingController _source;
  late final TextEditingController _tags;

  String _language = 'en';
  String _category = 'general';
  String _status = 'draft';
  bool _saving = false;

  bool get _editing => widget.chunk != null;

  /// The platform's own passage, which every practice's assistant cites. It
  /// opens so the doctor can read what patients are being told, and offers
  /// nothing the server would refuse — see [KnowledgeChunk.isShared].
  bool get _readOnly => widget.chunk?.isShared ?? false;

  @override
  void initState() {
    super.initState();
    final c = widget.chunk;
    _docId = TextEditingController(text: c?.docId ?? '');
    _title = TextEditingController(text: c?.title ?? '');
    _section = TextEditingController(text: c?.section ?? '');
    _content = TextEditingController(text: c?.content ?? '');
    _source = TextEditingController(text: c?.sourceCitation ?? '');
    _tags = TextEditingController(text: c?.tags.join(', ') ?? '');
    _language = c?.language ?? 'en';
    _category = c?.category ?? 'general';
    _status = c?.status ?? 'draft';
  }

  @override
  void dispose() {
    _docId.dispose();
    _title.dispose();
    _section.dispose();
    _content.dispose();
    _source.dispose();
    _tags.dispose();
    super.dispose();
  }

  void _invalidateLists() {
    // Any status filter the list might be showing.
    for (final s in [null, 'approved', 'pending_review', 'draft', 'retired']) {
      ref.invalidate(
        knowledgeProvider((status: s, category: null, language: null)),
      );
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);

    final tags =
        _tags.text
            .split(',')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
    final body = {
      'docId': _docId.text.trim(),
      'title': _title.text.trim(),
      if (_section.text.trim().isNotEmpty) 'section': _section.text.trim(),
      'content': _content.text.trim(),
      'language': _language,
      'category': _category,
      'tags': tags,
      if (_source.text.trim().isNotEmpty) 'sourceCitation': _source.text.trim(),
    };

    try {
      final repo = ref.read(clinicianRepositoryProvider);
      final saved =
          _editing
              ? await repo.updateKnowledge(widget.chunk!.id, body)
              : await repo.createKnowledge(body);
      _invalidateLists();
      if (!mounted) return;
      setState(() => _status = saved.status);
      messenger.showSnackBar(
        const SnackBar(content: Text('Saved — pending review until approved')),
      );
      navigator.pop();
    } on ApiException catch (e) {
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _approve() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    // Approving approves what is stored. Unsaved edits on screen would be
    // discarded while the doctor believed they were approving them.
    final c = widget.chunk!;
    final edited =
        _title.text != c.title ||
        _content.text != c.content ||
        _section.text != (c.section ?? '') ||
        _source.text != (c.sourceCitation ?? '') ||
        _tags.text != c.tags.join(', ');
    if (edited) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Save your changes first, then approve.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .approveKnowledge(widget.chunk!.id);
      _invalidateLists();
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Approved — the assistant can now use it'),
        ),
      );
      navigator.pop();
    } on ApiException catch (e) {
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _retire() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Retire entry?'),
            content: const Text(
              'The assistant will stop using it. You can re-approve later.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Retire'),
              ),
            ],
          ),
    );
    if (ok != true) return;
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .retireKnowledge(widget.chunk!.id);
      _invalidateLists();
      navigator.pop();
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not retire. Please try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _readOnly
              ? 'Shared entry'
              : _editing
              ? 'Edit entry'
              : 'New entry',
        ),
        actions: [
          if (_editing && !_readOnly && _status != 'retired')
            PopupMenuButton<String>(
              onSelected: (v) => v == 'retire' ? _retire() : null,
              itemBuilder:
                  (_) => const [
                    PopupMenuItem(value: 'retire', child: Text('Retire entry')),
                  ],
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            // Clears the action bar, and a shared entry has none.
            _readOnly ? AppSpacing.md : 120,
          ),
          children: [
            if (_readOnly)
              const Padding(
                padding: EdgeInsets.only(bottom: AppSpacing.md),
                child: _SharedNotice(),
              ),
            if (_editing)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: knowledgeStatusColor(
                          _status,
                        ).withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        knowledgeStatusLabel(_status),
                        style: TextStyle(
                          color: knowledgeStatusColor(_status),
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            TextFormField(
              controller: _title,
              readOnly: _readOnly,
              decoration: const InputDecoration(labelText: 'Title'),
              validator:
                  (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: AppSpacing.md),
            // Stacked, not side by side. In half a phone's width the label
            // "Document ID" and the example under it both ran out of room, so
            // the one field on this form nobody can guess the format of was
            // the one showing "e.g. diet-basi…".
            TextFormField(
              controller: _docId,
              readOnly: _readOnly,
              decoration: const InputDecoration(
                labelText: 'Document ID',
                hintText: 'e.g. diet-basics-01',
                helperText: 'Groups the sections of one document together',
                helperMaxLines: 2,
              ),
              validator:
                  (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _section,
              readOnly: _readOnly,
              decoration: const InputDecoration(
                labelText: 'Section',
                hintText: 'Optional — e.g. Breakfast',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _content,
              readOnly: _readOnly,
              minLines: 5,
              maxLines: 14,
              maxLength: 8000,
              decoration: const InputDecoration(
                labelText: 'Content',
                alignLabelWithHint: true,
                hintText: 'The guidance the assistant may use…',
              ),
              validator:
                  (v) =>
                      (v == null || v.trim().length < 20)
                          ? 'At least 20 characters'
                          : null,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Language',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              children: [
                for (final l in const [
                  ('en', 'English'),
                  ('bn', 'বাংলা'),
                  ('hi', 'हिन्दी'),
                ])
                  ChoiceChip(
                    label: Text(l.$2),
                    selected: _language == l.$1,
                    onSelected:
                        _readOnly
                            ? null
                            : (_) => setState(() => _language = l.$1),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [
                for (final c in KnowledgeChunk.categories)
                  DropdownMenuItem(
                    value: c,
                    child: Text(c.replaceAll('_', ' ')),
                  ),
              ],
              onChanged:
                  _readOnly
                      ? null
                      : (v) => setState(() => _category = v ?? 'general'),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _source,
              readOnly: _readOnly,
              decoration: const InputDecoration(
                labelText: 'Source citation',
                hintText: 'Optional — where this guidance comes from',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _tags,
              readOnly: _readOnly,
              decoration: const InputDecoration(
                labelText: 'Tags',
                hintText: 'diet, breakfast',
                helperText: 'Separate with commas',
              ),
            ),
          ],
        ),
      ),
      // Nothing to save, approve or retire on a shared entry.
      bottomSheet: _readOnly ? null : Container(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.md,
          AppSpacing.md + MediaQuery.of(context).padding.bottom,
        ),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(top: BorderSide(color: scheme.outlineVariant)),
        ),
        // Whichever action finishes the job carries the weight. Approving is
        // the finish when there is something to approve; otherwise saving is,
        // and a lone outlined "Create" left the only button on the screen
        // looking like the one you were meant to skip.
        child: Builder(
          builder: (context) {
            final canApprove = _editing && _status != 'approved';
            return Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child:
                        canApprove
                            ? OutlinedButton(
                              onPressed: _saving ? null : _save,
                              // "Save", not "Save as draft": every save goes
                              // back to waiting for approval, which the
                              // confirmation says, and nothing here is a draft.
                              child: const Text('Save'),
                            )
                            : FilledButton(
                              style: FilledButton.styleFrom(
                                backgroundColor: AppColors.primary,
                              ),
                              onPressed: _saving ? null : _save,
                              child: Text(_editing ? 'Save' : 'Create'),
                            ),
                  ),
                ),
                if (canApprove) ...[
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: SizedBox(
                      height: 50,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                        ),
                        onPressed: _saving ? null : _approve,
                        icon: const Icon(Icons.verified_rounded, size: 18),
                        label: const Text('Approve'),
                      ),
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Why a shared entry opens with no way to change it.
///
/// Said on the screen rather than left to missing buttons: a doctor who finds
/// the controls gone assumes the app is broken, and one who is told whose
/// content this is knows what to do instead.
class _SharedNotice extends StatelessWidget {
  const _SharedNotice();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.public_rounded, color: scheme.onSurfaceVariant),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Shared with every practice',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  'Every practice’s assistant draws on this guidance, so it '
                  'cannot be changed from here. You can add an entry of your '
                  'own alongside it.',
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                    height: 1.35,
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
