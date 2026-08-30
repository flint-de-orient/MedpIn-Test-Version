import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';

/// First-run state. The suggestion cards double as a demonstration: the first
/// one visibly produces real guidance, which teaches patients this is worth
/// opening when something is actually wrong.
///
/// Sized against the space it is actually given rather than against fixed
/// numbers. The first version used an 88px badge, a 32px title and four 64px
/// cards, which came to more than a short phone has once the disclaimer banner,
/// the composer and the bottom bar have taken their share — so the screen
/// scrolled and cut the fourth suggestion in half. A first-run screen that
/// arrives already clipped reads as a broken screen, and this one is the first
/// thing a new patient sees.
///
/// It still scrolls when it genuinely cannot fit — at large system text scales
/// there is no honest way to show four cards at once, and clipping text to
/// avoid a scrollbar would be the worse failure.
class ChatEmptyState extends StatelessWidget {
  const ChatEmptyState({super.key, required this.onSuggestionTap});

  final ValueChanged<String> onSuggestionTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    final suggestions = [
      (icon: Icons.water_drop_outlined, text: l10n.chatSuggestionSugar),
      (icon: Icons.restaurant_outlined, text: l10n.chatSuggestionDiet),
      (icon: Icons.directions_walk_rounded, text: l10n.chatSuggestionFeet),
      (icon: Icons.visibility_outlined, text: l10n.chatSuggestionEye),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        // 0 on a short screen, 1 on a tall one. Everything below reads from
        // this, so the layout tightens as one piece instead of one element
        // shrinking while the gaps around it stay wide.
        final room = constraints.maxHeight;
        final t = ((room - 360) / 260).clamp(0.0, 1.0);
        double lerp(double compact, double roomy) =>
            compact + (roomy - compact) * t;

        // What yields, and in what order.
        //
        // A badge, a headline, a subtitle and four cards do not fit inside 360
        // points however hard the type is squeezed, and squeezing type until
        // they do would leave a patient reading 11-point text. So two things
        // give way instead, cheapest first: the illustration, which says
        // nothing the headline does not, and then the subtitle, which the four
        // cards demonstrate far better than a sentence can. The cards never go
        // — they are the screen, and the one that gets cut is always the last
        // one, which is how "Help me understand my eye report" ended up sliced
        // in half on the device this was reported from.
        final showBadge = room >= 560;
        final showBody = room >= 440;
        final badge = lerp(52, 68);
        final pad = lerp(AppSpacing.sm, AppSpacing.md);

        return SingleChildScrollView(
          padding: EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: pad,
          ),
          child: ConstrainedBox(
            // Fills the viewport so the content sits centred, and grows past it
            // only when the content is genuinely taller — which is the one case
            // that should scroll.
            constraints: BoxConstraints(
              minHeight: math.max(0, room - pad * 2),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (showBadge) ...[
                  Container(
                    width: badge,
                    height: badge,
                    decoration: BoxDecoration(
                      // Flat mint rather than a tint of primary: a translucent
                      // green over the dotted background picked up the dots and
                      // looked dirty.
                      color: AppColors.accentSoftOn(context),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.medical_services_outlined,
                      color: AppColors.accentOn(context),
                      size: badge * 0.45,
                    ),
                  ),
                  SizedBox(height: lerp(AppSpacing.sm + 2, AppSpacing.md)),
                ],
                Text(
                  l10n.chatEmptyTitle,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: lerp(20, 26),
                    fontWeight: FontWeight.w700,
                    height: 1.18,
                    letterSpacing: -0.4,
                  ),
                ),
                if (showBody) ...[
                  SizedBox(height: lerp(AppSpacing.xs, AppSpacing.sm)),
                  Text(
                    l10n.chatEmptyBody,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: lerp(12.5, 13.5),
                      height: 1.3,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
                SizedBox(height: lerp(AppSpacing.sm + 2, AppSpacing.md + 2)),
                for (var i = 0; i < suggestions.length; i++) ...[
                  if (i > 0) SizedBox(height: lerp(6, 9)),
                  _SuggestionCard(
                    icon: suggestions[i].icon,
                    text: suggestions[i].text,
                    fontSize: lerp(13, 14.5),
                    verticalPadding: lerp(7, 9.5),
                    onTap: () => onSuggestionTap(suggestions[i].text),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({
    required this.icon,
    required this.text,
    required this.fontSize,
    required this.verticalPadding,
    required this.onTap,
  });

  final IconData icon;
  final String text;
  final double fontSize;
  final double verticalPadding;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final radius = BorderRadius.circular(16);

    return Material(
      color: scheme.surface,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: scheme.outlineVariant),
          ),
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: 12,
              vertical: verticalPadding,
            ),
            child: Row(
              children: [
                // The icon sits on its own soft tile rather than loose on the
                // card. It gives the four rows a common left edge to line up
                // against, which is what makes the group read as a set.
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: AppColors.accentSoftOn(context),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    icon,
                    size: 18,
                    color: AppColors.accentOn(context),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Text(
                    text,
                    style: TextStyle(
                      fontSize: fontSize,
                      height: 1.3,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: scheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
