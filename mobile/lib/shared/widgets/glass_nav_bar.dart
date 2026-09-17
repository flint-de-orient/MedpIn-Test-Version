import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// The bar's colours in the dark theme, named once.
const _darkBar = Color(0xFF141B26);
const _darkSelected = Color(0xFF7FB0FF);

/// A navigation bar that looks like it floats and behaves like it does not.
///
/// It was briefly a real frosted bar over `extendBody`, and that was a mistake
/// worth writing down. Once content runs underneath, every bottom-anchored
/// thing in every shell becomes a special case: four FloatingActionButtons
/// went behind it, and — worse — the chat composers in two of the five patient
/// tabs, so a text field a patient was meant to type into sat under the bar.
/// A navigation bar is not the place to spend that.
///
/// So: side margins, a full radius and a soft shadow give the floating
/// appearance, while the Scaffold reserves the bar's whole height — including
/// the safe-area inset it adds below itself — so nothing can hide behind it.
///
/// ---- And a gap above it ----------------------------------------------------
///
/// The body ended exactly where the pill began, so a card scrolled to the
/// bottom was cut on the pill's top edge and its sides showed in the pill's
/// rounded corners: it read as a card sliding under the bar. Eight points of
/// ground above the pill put the cut clear of it.
class GlassNavBar extends StatelessWidget {
  const GlassNavBar({
    super.key,
    required this.currentIndex,
    required this.onSelected,
    required this.items,
  });

  final int currentIndex;
  final ValueChanged<int> onSelected;
  final List<GlassNavItem> items;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // The full gesture inset, not a fraction of it. Two thirds of a gesture bar
    // is still a gesture bar, and the last tab row sat inside it.
    final inset = MediaQuery.viewPaddingOf(context).bottom;
    // Tall enough for the icon, its label at the reader's text size, and the
    // selected pill around both — rather than a fixed 62 that clipped the
    // label once text was turned up.
    final label = MediaQuery.textScalerOf(context).scale(T.label.fontSize! * 1.1);
    // Icon, gap, label, the pill's padding and its margin — and a little air.
    final content = T.s6 + T.s1 + label + 4 * T.s1 + T.s1;
    final height = content < T.s12 + T.s3 ? T.s12 + T.s3 : content;

    return Padding(
      padding: EdgeInsets.fromLTRB(T.s3, T.s2, T.s3, T.s2 + inset),
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: dark ? _darkBar : T.surfaceRaised,
          borderRadius: BorderRadius.circular(T.rNav),
          border: Border.all(color: dark ? T.inkMuted.withValues(alpha: 0.4) : T.line),
          boxShadow: T.e1,
        ),
        child: Row(
          children: [
            for (var i = 0; i < items.length; i++)
              Expanded(
                child: _Tab(
                  item: items[i],
                  selected: i == currentIndex,
                  onTap: () => onSelected(i),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class GlassNavItem {
  const GlassNavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    this.showDot = false,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;

  /// A small mark on the icon, for something waiting on this tab.
  ///
  /// A dot rather than a count, because what is worth marking here is not
  /// countable — an app update is one fact, not seven.
  final bool showDot;
}

class _Tab extends StatelessWidget {
  const _Tab({required this.item, required this.selected, required this.onTap});

  final GlassNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tone = selected
        ? (dark ? _darkSelected : T.primary)
        : (dark ? T.inkFaint : T.inkMuted);

    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            // Fills the cell rather than hugging its label. Hugging made every
            // pill a different width, and on a 360dp phone it left "Medicines"
            // about 48dp to live in, which clipped it to "Medici...".
            width: double.infinity,
            margin: const EdgeInsets.symmetric(horizontal: T.s1, vertical: T.s1),
            padding: const EdgeInsets.symmetric(vertical: T.s1),
            decoration: BoxDecoration(
              // The whole selected state, and nothing else changes shape.
              color: selected
                  ? (dark ? _darkSelected.withValues(alpha: 0.12) : T.primaryTint)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(T.rControl),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Icon(
                      selected ? item.selectedIcon : item.icon,
                      size: T.s6,
                      color: tone,
                    ),
                    if (item.showDot)
                      Positioned(
                        top: 0,
                        right: 0,
                        child: Container(
                          width: T.s2,
                          height: T.s2,
                          decoration: BoxDecoration(
                            color: T.primary,
                            shape: BoxShape.circle,
                            // Ringed in the bar's own ground so it reads as a
                            // mark placed on the icon rather than part of it.
                            border: Border.all(
                              color: dark ? _darkBar : T.surfaceRaised,
                              width: 1.5,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: T.s1),
                // Shrinks to its cell rather than being cut: a one-word tab
                // name is load-bearing, and "Medici…" is not a tab.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    item.label,
                    maxLines: 1,
                    softWrap: false,
                    style: T.label.copyWith(
                      height: 1.1,
                      letterSpacing: 0,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: tone,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
