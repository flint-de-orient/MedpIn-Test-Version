import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../domain/diet_models.dart';
import '../dietician_providers.dart';
import '../../../../shared/widgets/disclosure_tile.dart';

/// The plans this patient has been taken off.
///
/// Answers the question a dietician asks when a target has not been met: what
/// were we doing, and for how long. Read-only on purpose — history that can be
/// edited is not history, and the way to reuse an old plan is to read it and
/// write the new one, not to quietly resurrect it.
Future<void> showPlanHistory(BuildContext context, String patientId) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _PlanHistorySheet(patientId: patientId),
  );
}

class _PlanHistorySheet extends ConsumerWidget {
  const _PlanHistorySheet({required this.patientId});

  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(dietPlanHistoryProvider(patientId));
    final revisions = async.valueOrNull;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.94,
      builder:
          (context, controller) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  0,
                  AppSpacing.lg,
                  AppSpacing.sm,
                ),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Previous plans',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (revisions != null)
                      Text(
                        '${revisions.length}',
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
              Divider(
                height: 1,
                color: scheme.outlineVariant.withValues(alpha: 0.5),
              ),
              Expanded(
                child: switch ((revisions, async.isLoading)) {
                  (null, true) => const Center(
                    child: CircularProgressIndicator(),
                  ),
                  (null, _) => const _Note('Could not load the history.'),
                  (final r, _) when r!.isEmpty => const _Note(
                    'No previous plans. The one this patient is on now is the first '
                    'they have been given.',
                  ),
                  (final r, _) => ListView.separated(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      AppSpacing.md,
                      AppSpacing.md,
                      AppSpacing.xl,
                    ),
                    itemCount: r!.length,
                    separatorBuilder:
                        (_, _) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder:
                        (context, i) =>
                            _RevisionCard(revision: r[i], index: r.length - i),
                  ),
                },
              ),
            ],
          ),
    );
  }
}

/// One archived plan, collapsed to its goal until it is opened.
///
/// Collapsed because the useful first pass is "what were we aiming at, and
/// when" — five plans expanded into full meal lists is a wall nobody reads.
class _RevisionCard extends StatelessWidget {
  const _RevisionCard({required this.revision, required this.index});

  final DietPlanRevision revision;

  /// Counting from the oldest, so the labels stay stable as more are archived.
  final int index;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final plan = revision.plan;
    final days = revision.days;

    final period = [
      if (revision.startedAt != null)
        DateFormat('d MMM yyyy').format(revision.startedAt!),
      if (revision.replacedAt != null)
        DateFormat('d MMM yyyy').format(revision.replacedAt!),
    ].join(' – ');

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.55),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        // The default divider on an ExpansionTile draws a line across a card
        // that already has a border.
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: DisclosureTile(
          tilePadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 4,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          title: Text(
            plan.goal.trim().isNotEmpty ? plan.goal.trim() : 'Plan $index',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              [
                if (period.isNotEmpty) period,
                if (days != null) 'on it ${days == 1 ? '1 day' : '$days days'}',
                if (plan.dieticianName != null) plan.dieticianName!,
              ].join('  ·  '),
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),
          children: [
            for (final meal in plan.meals) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  [
                    meal.name,
                    if (meal.time.isNotEmpty) meal.time,
                  ].join('  ·  ').toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                    color: AppColors.accentOn(context),
                  ),
                ),
              ),
              const SizedBox(height: 4),
              for (final item in meal.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '•  ',
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                      Expanded(
                        child: Text(
                          item,
                          style: const TextStyle(fontSize: 14, height: 1.4),
                        ),
                      ),
                    ],
                  ),
                ),
              if (meal.notes.trim().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 0),
                  child: Text(
                    meal.notes.trim(),
                    style: TextStyle(
                      fontSize: 14,
                      fontStyle: FontStyle.italic,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              const SizedBox(height: AppSpacing.sm),
            ],
            if (plan.avoid.isNotEmpty) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'BEST AVOIDED',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                    color: AppColors.dangerOn(context),
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  for (final a in plan.avoid)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: AppColors.dangerOn(
                            context,
                          ).withValues(alpha: 0.45),
                        ),
                      ),
                      child: Text(
                        a,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.dangerOn(context),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
            if (plan.notes.trim().isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  plan.notes.trim(),
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.45,
                    color: scheme.onSurface,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14,
            height: 1.45,
            color: scheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
