import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/providers/active_patient.dart';
import '../../domain/care_summary.dart';

/// Whose record this phone is showing.
///
/// ---- Only when there is a choice to make ---------------------------------
///
/// Rendered by [HomeScreen] only when the login holds more than one person. A
/// switcher above a single name is a control answering a question nobody asked,
/// and it would appear on every screen in the clinic that is running today.
///
/// ---- Why it sits above everything else ------------------------------------
///
/// Priya's phone may carry her own record, her four-year-old's and her
/// mother-in-law's, each with different doses. Every card below this answers
/// for one of them, so the choice comes before the answers — it used to sit
/// under the first two cards, after the patient had already read a dose that
/// might not have been theirs.
class HouseholdSwitcher extends ConsumerWidget {
  const HouseholdSwitcher({super.key, required this.members});

  final List<HouseholdMember> members;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (members.length < 2) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);

    // Null is the account holder, and the server sorts them first — so the
    // fallback is the first row rather than a sentinel the list may not hold.
    final active = ref.watch(activePatientProvider);
    final selected = active ?? members.first.id;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.ptWhoseRecord,
          style: T.small.copyWith(color: T.inkMuted, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: T.s2),
        // Wrap rather than a horizontal scroller: three names fit a phone,
        // and a row that scrolls hides people behind an edge.
        Wrap(
          spacing: T.s2,
          runSpacing: T.s2,
          children: [
            for (final m in members)
              _MemberChip(
                member: m,
                isSelected: m.id == selected,
                // One write. Every repository reads the active patient through
                // a provider, so everything that depends on it re-fetches.
                onTap:
                    () => ref
                        .read(activePatientProvider.notifier)
                        // The account holder is `null`, not their own id, so
                        // the path stays `me`.
                        .switchTo(m.isSelf ? null : m.id),
              ),
          ],
        ),
      ],
    );
  }
}

class _MemberChip extends StatelessWidget {
  const _MemberChip({required this.member, required this.isSelected, this.onTap});

  final HouseholdMember member;
  final bool isSelected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Semantics(
      button: true,
      selected: isSelected,
      child: Material(
        color: isSelected ? T.primaryTint : T.surfaceRaised,
        borderRadius: BorderRadius.circular(T.rControl),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(T.rControl),
          child: Container(
            constraints: const BoxConstraints(minHeight: T.tap),
            padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(T.rControl),
              border: Border.all(
                color: isSelected ? T.primary : T.line,
                width: isSelected ? 1.5 : 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isSelected) ...[
                  const Icon(Icons.check_rounded, size: 20, color: T.primary),
                  const SizedBox(width: T.s2),
                ],
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.name,
                      style: T.bodyStrong.copyWith(
                        color: isSelected ? T.primary : T.ink,
                      ),
                    ),
                    // "You" rather than "self": nobody calls themselves self.
                    Text(
                      member.isSelf
                          ? l10n.ptRelationYou
                          : switch (member.relationship) {
                            'child' => l10n.ptRelationChild,
                            'parent' => l10n.ptRelationParent,
                            'spouse' => l10n.ptRelationSpouse,
                            'self' => l10n.ptRelationYou,
                            _ => l10n.ptRelationFamily,
                          },
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
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
