import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../domain/knowledge_chunk.dart';
import 'clinician_providers.dart';
import 'widgets/clinician_visuals.dart';

Color knowledgeStatusColor(String status) => switch (status) {
  'approved' => AppColors.primary,
  'pending_review' => AppColors.warning,
  'retired' => AppColors.danger,
  _ => const Color(0xFF6B7280),
};

String knowledgeStatusLabel(String status) => switch (status) {
  'approved' => 'Approved',
  'pending_review' => 'Pending review',
  'retired' => 'Retired',
  'draft' => 'Draft',
  _ => status,
};

/// The doctor-approved knowledge the assistant answers from. Only `approved`
/// entries are ever served to patients — this is where they are curated.
class KnowledgeScreen extends ConsumerStatefulWidget {
  const KnowledgeScreen({super.key});

  @override
  ConsumerState<KnowledgeScreen> createState() => _KnowledgeScreenState();
}

class _KnowledgeScreenState extends ConsumerState<KnowledgeScreen> {
  String? _status;

  static const _statuses = [
    (null, 'All'),
    ('approved', 'Approved'),
    ('pending_review', 'Pending'),
    ('draft', 'Draft'),
    ('retired', 'Retired'),
  ];

  KnowledgeQuery get _query => (
    status: _status,
    category: null,
    language: null,
  );

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(knowledgeProvider(_query));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Knowledge base'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                itemCount: _statuses.length,
                separatorBuilder:
                    (_, _) => const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, i) {
                  final (value, label) = _statuses[i];
                  return ChoiceChip(
                    label: Text(label),
                    selected: _status == value,
                    onSelected: (_) => setState(() => _status = value),
                  );
                },
              ),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/clinician/knowledge/new'),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add entry'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(knowledgeProvider(_query)),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load knowledge base'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      onPressed:
                          () => ref.invalidate(knowledgeProvider(_query)),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          data: (paged) {
            if (paged.items.isEmpty) {
              return ListView(
                children: [
                  SizedBox(height: MediaQuery.of(context).size.height * 0.18),
                  Icon(
                    Icons.menu_book_outlined,
                    size: 56,
                    color: scheme.outlineVariant,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Center(
                    child: Text(
                      'No entries',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.md,
                AppSpacing.md,
                96,
              ),
              itemCount: paged.items.length,
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
              itemBuilder:
                  (context, i) => _ChunkRow(
                    chunk: paged.items[i],
                    onTap:
                        () => context.push(
                          '/clinician/knowledge/edit',
                          extra: paged.items[i],
                        ),
                  ),
            );
          },
        ),
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
    final scheme = Theme.of(context).colorScheme;
    final c = chunk;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color: scheme.outlineVariant.withValues(alpha: 0.6),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    c.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                MiniPill(
                  label: knowledgeStatusLabel(c.status),
                  color: knowledgeStatusColor(c.status),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              c.content,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                color: scheme.onSurfaceVariant,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: 4,
              children: [
                _tag(c.category.replaceAll('_', ' '), scheme),
                // Written out. "EN", "BN", "HI" and "v3" are how the record
                // stores itself, not how a doctor reads it — and "HI" beside a
                // clinical note reads as a greeting before it reads as Hindi.
                _tag(_languageName(c.language), scheme),
                _tag('Version ${c.version}', scheme),
                // Why tapping it opens something that cannot be edited.
                if (c.isShared) _tag('shared, read-only', scheme),
                // States the consequence rather than the mechanism: an entry
                // with no embedding is one the assistant cannot find, which is
                // the only part of it the doctor can act on.
                if (!c.hasEmbedding && c.isApproved)
                  _tag('not searchable yet', scheme),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Language code to the language's own name, since that is what the person
  /// choosing it picked from.
  String _languageName(String code) => switch (code.toLowerCase()) {
    'en' => 'English',
    'bn' => 'বাংলা',
    'hi' => 'हिन्दी',
    _ => code.toUpperCase(),
  };

  Widget _tag(String label, ColorScheme scheme) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
    decoration: BoxDecoration(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
    ),
  );
}
