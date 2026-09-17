import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/care_summary.dart';
import '../../domain/today_plan.dart';

/// Today's plan as the meals to eat, not as paragraphs about eating.
///
/// A list, not a sideways rail: a day's plan is five or six meals, a known and
/// short set, and a rail cut the second meal off at the card's edge and set
/// every description in 11px type inside boxes of fixed height.
class DietPlanCard extends StatelessWidget {
  const DietPlanCard({super.key, required this.plan});

  final PatientDietPlan plan;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final kcal = calorieTarget('${plan.goal} ${plan.notes}');

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.restaurant_menu_rounded,
            title: l10n.ptDietPlanTitle,
            subtitle: [
              if (plan.dieticianName != null) l10n.ptFromName(plan.dieticianName!),
              if (plan.sharedAt != null)
                l10n.ptUpdatedOn(DateFormat('d MMM', locale).format(plan.sharedAt!)),
            ].join(' · '),
          ),
          if (kcal != null) ...[
            const SizedBox(height: T.s4),
            Text(
              l10n.ptDailyCalorieTarget(NumberFormat.decimalPattern(locale).format(kcal)),
              style: T.bodyStrong.copyWith(color: T.ink),
            ),
          ],
          if (plan.meals.isNotEmpty) ...[
            const SizedBox(height: T.s4),
            InnerTile(
              padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final (i, m) in plan.meals.indexed) ...[
                    if (i > 0) const Divider(height: 1, color: T.line),
                    _MealRow(meal: m),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s2),
          ActionLink(
            label: l10n.ptSeeFullPlan,
            onTap:
                () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => _FullPlanSheet(plan: plan),
                ),
          ),
        ],
      ),
    );
  }
}

class _MealRow extends StatelessWidget {
  const _MealRow({required this.meal});

  final PlanMeal meal;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: meal.name,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                if (meal.time.isNotEmpty)
                  TextSpan(
                    text: '  ${meal.time}',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
              ],
            ),
          ),
          if (meal.summary.isNotEmpty)
            Text(meal.summary, style: T.body.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }
}

/// The whole plan, including the avoid list and any closing note. A sheet
/// rather than a PDF: there is no document to open.
class _FullPlanSheet extends StatelessWidget {
  const _FullPlanSheet({required this.plan});

  final PatientDietPlan plan;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return DraggableScrollableSheet(
      initialChildSize: 0.8,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder:
          (context, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s8),
            children: [
              Text(l10n.ptDietPlanTitle, style: T.title.copyWith(color: T.ink)),
              if (plan.dieticianName != null)
                Text(
                  l10n.ptFromName(plan.dieticianName!),
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              if (plan.goal.isNotEmpty) ...[
                const SizedBox(height: T.s4),
                Text(plan.goal, style: T.body.copyWith(color: T.ink)),
              ],
              for (final meal in plan.meals) ...[
                const SizedBox(height: T.s5),
                Text(
                  meal.time.isEmpty ? meal.name : '${meal.name} · ${meal.time}',
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                for (final item in meal.items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: T.s1),
                    child: Text('•  $item', style: T.body.copyWith(color: T.ink)),
                  ),
                if (meal.notes.isNotEmpty)
                  Text(meal.notes, style: T.small.copyWith(color: T.inkMuted)),
              ],
              if (plan.avoid.isNotEmpty) ...[
                const SizedBox(height: T.s5),
                Text(
                  l10n.ptBestAvoided,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                for (final item in plan.avoid)
                  Padding(
                    padding: const EdgeInsets.only(bottom: T.s1),
                    child: Text('•  $item', style: T.body.copyWith(color: T.ink)),
                  ),
              ],
              if (plan.notes.isNotEmpty) ...[
                const SizedBox(height: T.s5),
                Text(plan.notes, style: T.body.copyWith(color: T.ink)),
              ],
            ],
          ),
    );
  }
}
