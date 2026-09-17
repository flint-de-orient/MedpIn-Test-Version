import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../domain/knowledge_chunk.dart';
import 'clinician_providers.dart';
import 'widgets/inbox_states.dart';

/// What a knowledge status means, as a word and a tone.
///
/// Approved is the only status the assistant uses, so it is the one that reads
/// as good; waiting for approval is the one that needs the doctor; draft and
/// retired are neither. Retired was red, which said "danger" about an entry
/// somebody deliberately stopped using.
(String, Status) knowledgeStatus(String status) => switch (status) {
  'approved' => ('Approved', Status.ok),
  'pending_review' => ('Waiting for approval', Status.watch),
  'retired' => ('Retired', Status.neutral),
  'draft' => ('Draft', Status.neutral),
  _ => (status, Status.neutral),
};

/// A category key as a reader would write it: `sick_day_rules` as
/// "Sick day rules".
String knowledgeCategoryLabel(String key) {
  final words = key.replaceAll('_', ' ').trim();
  if (words.isEmpty) return key;
  return words[0].toUpperCase() + words.substring(1);
}

/// A language code as the language's own name, which is what the person who
/// chose it picked from. "HI" beside a clinical note reads as a greeting.
String knowledgeLanguageName(String code) => switch (code.toLowerCase()) {
  'en' => 'English',
  'bn' => 'বাংলা',
  'hi' => 'हिन्दी',
  _ => code.toUpperCase(),
};

/// The doctor-approved knowledge the assistant answers from. Only approved
/// entries are ever served to patients — this is where they are curated.
///
/// ---- What changed, and why -------------------------------------------------
///
/// An empty knowledge base said "No entries" and nothing else, which neither
/// explained what an entry is for nor what to do next. It now says both.
///
/// The status filter was a horizontal rail inside the app bar, and "Retired"
/// sat off the right edge of a phone. It wraps now, in the page.
class KnowledgeScreen extends ConsumerStatefulWidget {
  const KnowledgeScreen({super.key});

  @override
  ConsumerState<KnowledgeScreen> createState() => _KnowledgeScreenState();
}

class _KnowledgeScreenState extends ConsumerState<KnowledgeScreen> {
  String? _status;
  final _loadedAt = LoadedAt();

  static const _statuses = <(String?, String)>[
    (null, 'All'),
    ('approved', 'Approved'),
    ('pending_review', 'Waiting for approval'),
    ('draft', 'Drafts'),
    ('retired', 'Retired'),
  ];

  KnowledgeQuery get _query => (
    status: _status,
    category: null,
    language: null,
  );

  void _reload() => ref.invalidate(knowledgeProvider(_query));

  void _add() => context.push('/clinician/knowledge/new');

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(knowledgeProvider(_query));
    _loadedAt.note(_query, async);

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(title: const Text('Knowledge base')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        backgroundColor: T.primary,
        foregroundColor: T.surfaceRaised,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add entry'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: ListView(
          // Clear of the floating button, which otherwise sits on the last
          // entry.
          padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, T.s12 * 2),
          children: [
            Text(
              'What the assistant may tell patients. It only uses entries a '
              'doctor has approved.',
              style: T.small.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s3),
            ChoicePills<String?>(
              options: _statuses,
              selected: _status,
              onSelected: (v) => setState(() => _status = v),
            ),
            const SizedBox(height: T.s4),
            ..._results(async),
          ],
        ),
      ),
    );
  }

  List<Widget> _results(AsyncValue<Paged<KnowledgeChunk>> async) {
    if (!async.hasValue) {
      if (async.hasError) {
        return [
          if (refusedForRole(async.error))
            const NotYourRole(what: 'the knowledge base')
          else
            LoadFailed(what: 'the knowledge base', onRetry: _reload),
        ];
      }
      return const [ListSkeleton(rows: 3, avatar: false)];
    }

    final items = async.value!.items;
    return [
      if (async.hasError) ...[
        StaleNotice.english(
          context: context,
          what: 'the knowledge base',
          loadedAt: _loadedAt[_query],
          onRetry: _reload,
        ),
        const SizedBox(height: T.s4),
      ],
      if (items.isEmpty)
        _empty()
      else
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: T.s1),
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0) const Divider(height: 1, color: T.line),
                _ChunkRow(
                  chunk: items[i],
                  onTap:
                      () => context.push(
                        '/clinician/knowledge/edit',
                        extra: items[i],
                      ),
                ),
              ],
            ],
          ),
        ),
    ];
  }

  Widget _empty() {
    if (_status == null) {
      return InboxEmpty(
        icon: Icons.menu_book_outlined,
        title: 'No entries yet',
        body:
            'The assistant answers patients from entries a doctor has approved '
            'here. Add the clinic’s own guidance — what to eat, what to do on '
            'a sick day — and approve it once it reads right.',
        action: FilledButton(
          onPressed: _add,
          child: const Text('Add the first entry'),
        ),
      );
    }
    final (label, _) = knowledgeStatus(_status!);
    return InboxEmpty(
      icon: Icons.filter_list_rounded,
      title: 'Nothing is ${label.toLowerCase()}',
      body: switch (_status) {
        'approved' =>
          'The assistant has no approved entries to answer from. Approve an '
              'entry to let it use one.',
        'pending_review' =>
          'Every entry has been approved or put aside. New entries and edited '
              'ones wait here.',
        'draft' => 'No entry is being drafted.',
        _ => 'No entry has been retired.',
      },
      action: OutlinedButton(
        onPressed: () => setState(() => _status = null),
        child: const Text('Show all entries'),
      ),
    );
  }
}

class _ChunkRow extends StatelessWidget {
  const _ChunkRow({required this.chunk, required this.onTap});

  final KnowledgeChunk chunk;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = chunk;
    final (label, status) = knowledgeStatus(c.status);
    // The consequence rather than the mechanism: an approved entry with no
    // embedding is one the assistant cannot find.
    final unsearchable = c.isApproved && !c.hasEmbedding;

    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(T.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Wraps: two entries often differ only at the end of the
                  // title.
                  Expanded(
                    child: Text(
                      c.title,
                      style: T.bodyStrong.copyWith(color: T.ink),
                    ),
                  ),
                  const SizedBox(width: T.s2),
                  TonePill(label: label, status: status),
                ],
              ),
              const SizedBox(height: T.s1),
              Text(
                c.content,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: T.s2),
              Text(
                [
                  knowledgeCategoryLabel(c.category),
                  knowledgeLanguageName(c.language),
                  'Version ${c.version}',
                  // Why tapping it opens something that cannot be changed.
                  if (c.isShared) 'Shared with every practice',
                ].join(' · '),
                style: T.label.copyWith(color: T.inkMuted, letterSpacing: 0),
              ),
              if (unsearchable) ...[
                const SizedBox(height: T.s2),
                Row(
                  children: [
                    const Icon(
                      Icons.search_off_rounded,
                      size: T.s4,
                      color: T.warning,
                    ),
                    const SizedBox(width: T.s1),
                    Expanded(
                      child: Text(
                        'Approved, but the assistant cannot find it yet',
                        style: T.small.copyWith(color: T.warning),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
