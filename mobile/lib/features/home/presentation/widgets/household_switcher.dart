import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/care_summary.dart';

/// Whose record this phone is showing.
///
/// ---- Only when there is a choice to make ---------------------------------
///
/// Rendered by [HomeScreen] only when the login holds more than one person. A
/// switcher above a single name is a control answering a question nobody asked,
/// and it would appear on every screen in the clinic that is running today.
///
/// ---- Why the name is the point ------------------------------------------
///
/// Priya's phone may carry her own record, her four-year-old's and her
/// mother-in-law's. Every one of them has medicines with different doses, and
/// the failure this guards against is a reminder that says "time for your
/// medicine" on a handset holding three people's prescriptions. So the name is
/// the largest thing here, and the relationship is the caption under it.
class HouseholdSwitcher extends StatelessWidget {
  const HouseholdSwitcher({
    super.key,
    required this.members,
    this.selectedId,
    this.onSelect,
  });

  final List<HouseholdMember> members;

  /// Null selects the account holder, who the server sorts first.
  final String? selectedId;
  final ValueChanged<HouseholdMember>? onSelect;

  @override
  Widget build(BuildContext context) {
    if (members.length < 2) return const SizedBox.shrink();

    final selected = selectedId ?? members.first.id;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Whose record', style: T.label.copyWith(color: T.inkMuted)),
          const SizedBox(height: T.s3),
          // Wrap rather than a horizontal scroller: three names fit a phone,
          // and a row that scrolls hides people behind an edge with no
          // indication that it does.
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              for (final m in members)
                _MemberChip(
                  member: m,
                  isSelected: m.id == selected,
                  onTap: onSelect == null ? null : () => onSelect!(m),
                ),
            ],
          ),
        ],
      ),
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
    return Material(
      color: isSelected ? T.primaryTint : T.surface,
      borderRadius: BorderRadius.circular(T.rControl),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(T.rControl),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(T.rControl),
            border: Border.all(color: isSelected ? T.primary : T.line),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                member.name,
                style: T.bodyStrong.copyWith(color: isSelected ? T.primary : T.ink),
              ),
              // "You" rather than "self": the label is read by the person it
              // describes, and nobody calls themselves self.
              Text(
                member.isSelf ? 'You' : _relationshipLabel(member.relationship),
                style: T.label.copyWith(color: T.inkMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _relationshipLabel(String raw) => switch (raw) {
    'child' => 'Child',
    'parent' => 'Parent',
    'spouse' => 'Spouse',
    'self' => 'You',
    _ => 'Family',
  };
}
