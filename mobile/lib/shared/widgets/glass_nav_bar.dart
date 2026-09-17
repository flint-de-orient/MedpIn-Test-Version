import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

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

  /// The pill itself. Trimmed from 68: with the selected item now carrying its
  /// own pill, the bar no longer needs height to signal where you are.
  static const double _barHeight = 62;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // The full gesture inset, not a fraction of it. Two thirds of a gesture bar
    // is still a gesture bar, and the last tab row sat inside it.
    final inset = MediaQuery.viewPaddingOf(context).bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(T.s3, 0, T.s3, T.s2 + inset),
      child: Container(
        height: _barHeight,
        decoration: BoxDecoration(
          color: dark ? const Color(0xFF141B26) : Colors.white,
          borderRadius: BorderRadius.circular(T.rNav),
          border: Border.all(color: dark ? const Color(0x1FFFFFFF) : T.line),
          boxShadow: const [
            BoxShadow(
              color: Color(0x140B1B3A),
              blurRadius: 24,
              offset: Offset(0, 8),
            ),
          ],
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
  /// countable — an app update is one fact, not seven. It exists so a tab can
  /// say there is something inside it without anything having to interrupt the
  /// screen the reader is actually on, which is the whole reason the update
  /// notice stopped being a strip that floated over the app.
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
    final tone =
        selected
            ? (dark ? const Color(0xFF7FB0FF) : T.primary)
            : (dark ? const Color(0xFF8A94A6) : T.inkMuted);

    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
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
            margin: const EdgeInsets.symmetric(horizontal: T.s1),
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
            decoration: BoxDecoration(
              // The whole selected state, and nothing else changes shape. A
              // tint this faint is still unmistakable because it is the only
              // fill in the bar.
              color:
                  selected
                      ? (dark ? const Color(0x1F4890F0) : T.primaryTint)
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
                      size: 22,
                      color: tone,
                    ),
                    if (item.showDot)
                      Positioned(
                        top: -1,
                        right: -2,
                        child: Container(
                          width: 9,
                          height: 9,
                          decoration: BoxDecoration(
                            color: T.primary,
                            shape: BoxShape.circle,
                            // Ringed in the bar's own ground so it reads as a
                            // mark placed on the icon rather than part of it.
                            border: Border.all(
                              color:
                                  dark
                                      ? const Color(0xFF141B26)
                                      : Colors.white,
                              width: 1.6,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.1,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: tone,
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
