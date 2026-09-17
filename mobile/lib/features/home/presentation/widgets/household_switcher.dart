import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/care_summary.dart';
import '../../../../shared/providers/active_patient.dart';

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
class HouseholdSwitcher extends ConsumerWidget {
  const HouseholdSwitcher({super.key, required this.members});

  final List<HouseholdMember> members;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (members.length < 2) return const SizedBox.shrink();

    // Null is the account holder, and the server sorts them first — so the
    // fallback is the first row rather than a sentinel the list may not hold.
    final active = ref.watch(activePatientProvider);
    final selected = active ?? members.first.id;

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
                  // One write. Every repository reads the active patient
                  // through a provider, so Riverpod re-fetches whatever
                  // depends on it — Home, glucose, medicines, documents — and
                  // nothing has to be invalidated by hand. A list of manual
                  // invalidations is a list somebody eventually adds to
                  // incompletely.
                  onTap: () => ref.read(activePatientProvider.notifier).switchTo(
                        // The account holder is `null`, not their own id, so
                        // the path stays `me` and reads exactly as it did
                        // before anybody was added to this phone.
                        m.isSelf ? null : m.id,
                      ),
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
