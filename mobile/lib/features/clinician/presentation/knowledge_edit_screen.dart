import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/knowledge_chunk.dart';
import 'clinician_providers.dart';
import 'knowledge_screen.dart'
    show knowledgeCategoryLabel, knowledgeLanguageName, knowledgeStatus;
import 'widgets/inbox_states.dart';

/// Create or edit an assistant knowledge entry, and approve or retire it.
/// Saving sends it back to "waiting for approval" server-side — approved text
/// can never be silently rewritten and still served.
///
/// ---- What changed, and why -------------------------------------------------
///
/// Labels sat inside the fields and floated away on the first keystroke, so
/// a half-filled form no longer said what its empty boxes were for. Every
/// label is above its field now.
///
/// "Save as draft" was the secondary button on an entry waiting for approval,
/// and saving never makes a draft: the server puts every save back to
/// "waiting for approval". It says "Save", and the line above the buttons says
/// what saving does.
///
/// "Approve" approved what was stored, not what was on screen — an edit typed
/// and then approved was thrown away, and the old wording went to patients.
/// While there are unsaved changes, Approve waits for them to be saved.
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
    for (final field in _fields) {
      field.addListener(_onEdited);
    }
  }

  List<TextEditingController> get _fields => [
    _docId,
    _title,
    _section,
    _content,
    _source,
    _tags,
  ];

  void _onEdited() {
    if (mounted) setState(() {});
  }

  /// Whether what is on screen differs from what is stored.
  bool get _dirty {
    final c = widget.chunk;
    if (c == null) return true;
    return _docId.text != c.docId ||
        _title.text != c.title ||
        _section.text != (c.section ?? '') ||
        _content.text != c.content ||
        _source.text != (c.sourceCitation ?? '') ||
        _tags.text != c.tags.join(', ') ||
        _language != c.language ||
        _category != c.category;
  }

  @override
  void dispose() {
    for (final field in _fields) {
      field.removeListener(_onEdited);
      field.dispose();
    }
    super.dispose();
  }

  void _invalidateLists() {
    // Any status filter the list might be showing.
    ref.invalidate(knowledgeProvider);
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
        const SnackBar(
          content: Text('Saved. It waits for approval before it is used.'),
        ),
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
    setState(() => _saving = true);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .approveKnowledge(widget.chunk!.id);
      _invalidateLists();
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Approved. The assistant can now use it.'),
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
            title: const Text('Retire this entry?'),
            content: const Text(
              'The assistant will stop using it. You can approve it again '
              'later.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: T.danger),
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
    return Scaffold(
      backgroundColor: T.surface,
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
              tooltip: 'More',
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
          padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s8),
          children: [
            if (_readOnly) ...[
              const _SharedNotice(),
              const SizedBox(height: T.s4),
            ],
            if (_editing && !_readOnly) ...[
              _StatusLine(status: _status),
              const SizedBox(height: T.s4),
            ],
            SectionCard(
              padding: const EdgeInsets.all(T.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Labelled(
                    label: 'Title',
                    child: TextFormField(
                      controller: _title,
                      readOnly: _readOnly,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'e.g. Low sugar at night',
                      ),
                      validator:
                          (v) =>
                              (v == null || v.trim().isEmpty)
                                  ? 'Give the entry a title.'
                                  : null,
                    ),
                  ),
                  _Labelled(
                    label: 'Guidance',
                    help:
                        'What the assistant may say, in the words it should '
                        'use.',
                    child: TextFormField(
                      controller: _content,
                      readOnly: _readOnly,
                      minLines: 5,
                      maxLines: 14,
                      maxLength: 8000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText:
                            'If your sugar is below 70 at night, take fifteen '
                            'grams of fast sugar…',
                      ),
                      validator:
                          (v) =>
                              (v == null || v.trim().length < 20)
                                  ? 'Write at least 20 characters.'
                                  : null,
                    ),
                  ),
                  _Labelled(
                    label: 'Language',
                    child: ChoicePills<String>(
                      options: [
                        for (final code in const ['en', 'bn', 'hi'])
                          (code, knowledgeLanguageName(code)),
                      ],
                      selected: _language,
                      onSelected:
                          _readOnly
                              ? null
                              : (v) => setState(() => _language = v),
                    ),
                  ),
                  _Labelled(
                    label: 'Category',
                    child: DropdownButtonFormField<String>(
                      initialValue: _category,
                      isExpanded: true,
                      items: [
                        for (final c in KnowledgeChunk.categories)
                          DropdownMenuItem(
                            value: c,
                            child: Text(knowledgeCategoryLabel(c)),
                          ),
                      ],
                      onChanged:
                          _readOnly
                              ? null
                              : (v) =>
                                  setState(() => _category = v ?? 'general'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: T.s4),
            SectionCard(
              padding: const EdgeInsets.all(T.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Where it belongs',
                    style: T.bodyStrong.copyWith(color: T.ink),
                  ),
                  const SizedBox(height: T.s3),
                  // Stacked, never side by side: in half a phone's width the
                  // one field nobody can guess the format of showed
                  // "e.g. diet-basi…".
                  _Labelled(
                    label: 'Document ID',
                    help: 'Groups the sections of one document together.',
                    child: TextFormField(
                      controller: _docId,
                      readOnly: _readOnly,
                      decoration: const InputDecoration(
                        hintText: 'e.g. diet-basics-01',
                      ),
                      validator:
                          (v) =>
                              (v == null || v.trim().isEmpty)
                                  ? 'Give it a document ID.'
                                  : null,
                    ),
                  ),
                  _Labelled(
                    label: 'Section (optional)',
                    child: TextFormField(
                      controller: _section,
                      readOnly: _readOnly,
                      decoration: const InputDecoration(
                        hintText: 'e.g. Breakfast',
                      ),
                    ),
                  ),
                  _Labelled(
                    label: 'Source (optional)',
                    help: 'Where this guidance comes from.',
                    child: TextFormField(
                      controller: _source,
                      readOnly: _readOnly,
                      decoration: const InputDecoration(
                        hintText:
                            'e.g. RSSDI clinical practice guidelines, 2022',
                      ),
                    ),
                  ),
                  _Labelled(
                    label: 'Tags (optional)',
                    help: 'Separate with commas.',
                    last: true,
                    child: TextFormField(
                      controller: _tags,
                      readOnly: _readOnly,
                      decoration: const InputDecoration(
                        hintText: 'e.g. diet, breakfast',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      // Nothing to save, approve or retire on a shared entry.
      bottomNavigationBar: _readOnly ? null : _actions(context),
    );
  }

  Widget _actions(BuildContext context) {
    final canApprove = _editing && _status != 'approved';
    final dirty = _dirty;

    final String note;
    if (!_editing) {
      note = 'A new entry waits for approval before the assistant uses it.';
    } else if (canApprove && dirty) {
      note = 'Save your changes first. What is saved is what gets approved.';
    } else if (canApprove) {
      note = 'Approving lets the assistant use this entry.';
    } else {
      note =
          'The assistant uses this entry. Saving a change sends it back for '
          'approval.';
    }

    final save =
        canApprove && !dirty
            ? OutlinedButton(
              onPressed: _saving ? null : _save,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(T.hControl),
              ),
              child: const Text('Save'),
            )
            : FilledButton(
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(T.hControl),
              ),
              child: const Text('Save'),
            );

    return Padding(
      // Above the keyboard, not under it.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: T.surfaceRaised,
          border: Border(top: BorderSide(color: T.line)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(note, style: T.small.copyWith(color: T.inkMuted)),
                const SizedBox(height: T.s3),
                Row(
                  children: [
                    Expanded(child: save),
                    if (canApprove) ...[
                      const SizedBox(width: T.s2),
                      Expanded(
                        child:
                            dirty
                                ? OutlinedButton(
                                  onPressed: null,
                                  style: OutlinedButton.styleFrom(
                                    minimumSize: const Size.fromHeight(
                                      T.hControl,
                                    ),
                                  ),
                                  child: const Text('Approve'),
                                )
                                : FilledButton(
                                  onPressed: _saving ? null : _approve,
                                  style: FilledButton.styleFrom(
                                    minimumSize: const Size.fromHeight(
                                      T.hControl,
                                    ),
                                  ),
                                  child: const Text('Approve'),
                                ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A label above its field, an optional line of help under the label, and the
/// gap to the next field.
class _Labelled extends StatelessWidget {
  const _Labelled({
    required this.label,
    required this.child,
    this.help,
    this.last = false,
  });

  final String label;
  final String? help;
  final Widget child;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            label,
            style: T.small.copyWith(color: T.ink, fontWeight: FontWeight.w600),
          ),
          if (help != null)
            Text(help!, style: T.small.copyWith(color: T.inkMuted)),
          const SizedBox(height: T.s2),
          child,
        ],
      ),
    );
  }
}

/// Where the entry stands, and what that means for patients.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = knowledgeStatus(status);
    final meaning = switch (status) {
      'approved' => 'The assistant answers patients from this entry.',
      'pending_review' => 'The assistant does not use it until it is approved.',
      'retired' => 'The assistant no longer uses it.',
      _ => 'A draft. The assistant does not use it.',
    };

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TonePill(label: label, status: tone),
        const SizedBox(width: T.s2),
        Expanded(
          child: Text(meaning, style: T.small.copyWith(color: T.inkMuted)),
        ),
      ],
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
    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.public_rounded, color: T.inkMuted),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Shared with every practice',
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                Text(
                  'Every practice’s assistant draws on this guidance, so it '
                  'cannot be changed from here. You can add an entry of your '
                  'own alongside it.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
