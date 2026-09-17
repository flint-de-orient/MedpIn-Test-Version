import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/authed_image.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
import '../../domain/care_summary.dart';

/// The last few meals the patient logged, as they logged them.
///
/// It was a rail of photo tiles, and most meals have no photo — so it was a
/// row of grey boxes each holding a fork, with the words the patient actually
/// wrote ("rice, fish curry, salad") nowhere on it. A short list shows the
/// note, and the photo beside it when there is one.
class RecentMealsCard extends StatelessWidget {
  const RecentMealsCard({super.key, required this.items});

  final List<CareFoodLog> items;

  /// Three is a glance; the rest is one tap away.
  static const int shown = 3;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.photo_camera_outlined,
            title: l10n.ptRecentMeals,
          ),
          const SizedBox(height: T.s4),
          if (items.isEmpty) ...[
            Text(
              l10n.ptNoMealsLogged,
              style: T.bodyStrong.copyWith(color: T.ink),
            ),
            Text(
              l10n.ptNoMealsLoggedBody,
              style: T.small.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s3),
            SecondaryAction(
              label: l10n.ptLogAMeal,
              icon: Icons.add_a_photo_outlined,
              onPressed: () => context.go('/food-log'),
            ),
          ] else
            for (final (i, log) in items.take(shown).indexed) ...[
              if (i > 0) const SizedBox(height: T.s2),
              _MealRow(log: log),
            ],
          if (items.isNotEmpty) ...[
            const SizedBox(height: T.s2),
            ActionLink(
              label: l10n.apptViewAll,
              onTap: () => context.push('/food-log/history'),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Breakfast", "Lunch" — the log's meal type in the patient's language.
String mealTypeLabel(AppLocalizations l10n, String type) => switch (type) {
  'breakfast' => l10n.ptMealBreakfast,
  'lunch' => l10n.ptMealLunch,
  'dinner' => l10n.ptMealDinner,
  'snack' => l10n.ptMealSnack,
  _ => l10n.ptMealOther,
};

class _MealRow extends StatelessWidget {
  const _MealRow({required this.log});

  final CareFoodLog log;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final at = log.createdAt;
    return InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (log.photoUrl != null) ...[
            AuthedImage(
              path: log.photoUrl!,
              width: T.s12 + T.s4,
              height: T.s12 + T.s4,
              radius: T.rCard,
            ),
            const SizedBox(width: T.s3),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: mealTypeLabel(l10n, log.mealType),
                        style: T.bodyStrong.copyWith(color: T.ink),
                      ),
                      if (at != null)
                        TextSpan(
                          text: '  ${dayAndClock(context, at)}',
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                    ],
                  ),
                ),
                if (log.note.isNotEmpty)
                  Text(log.note, style: T.body.copyWith(color: T.inkMuted))
                else if (log.photoUrl != null)
                  Text(
                    l10n.ptPhotoOnly,
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
