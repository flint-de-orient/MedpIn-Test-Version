import 'package:flutter/material.dart';

import '../../core/theme/app_spacing.dart';

/// A heading you tap to show what is under it. Use this, never [ExpansionTile].
///
/// ---- Why not the Material one ---------------------------------------------
///
/// [ExpansionTile] renders as a flat grey rectangle on this clinic's phones
/// once its card has been scrolled out of a list's cache extent and rebuilt.
/// Take a patient record to the bottom, come back up, and the doctor's advice
/// is a grey block until the screen is left and re-entered. It was reported as
/// "why does it show gray" and took four attempts to find, because it is not a
/// layout bug and nothing in the widget tree is wrong: the tile brings a stack
/// of layer-making machinery to animate a disclosure — Offstage, a ClipRect
/// over an Align heightFactor, an AnimatedBuilder, a ListTile with its own ink —
/// and under Impeller on these handsets that composition comes back blank.
///
/// Showing and hiding the children outright costs a reflow nobody will notice
/// and paints with nothing but text.
///
/// ---- Why one widget rather than six fixes ---------------------------------
///
/// The first of these was converted by hand where it was reported, and five
/// were left. One of them is the consult screen, which is the doctor's main
/// workflow — a grey block there is found mid-consultation. Six separate
/// conversions is six chances to write it slightly differently and six places
/// the reason lives in a comment nobody reads. This is the one place, and the
/// API is deliberately ExpansionTile's so a site converts by changing a name.
class DisclosureTile extends StatefulWidget {
  const DisclosureTile({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.leading,
    this.initiallyExpanded = false,
    this.tilePadding,
    this.childrenPadding,
    this.crossAxisAlignment = CrossAxisAlignment.start,
  });

  final Widget title;
  final Widget? subtitle;
  final Widget? leading;
  final List<Widget> children;
  final bool initiallyExpanded;
  final EdgeInsetsGeometry? tilePadding;
  final EdgeInsetsGeometry? childrenPadding;
  final CrossAxisAlignment crossAxisAlignment;

  @override
  State<DisclosureTile> createState() => _DisclosureTileState();
}

class _DisclosureTileState extends State<DisclosureTile> {
  late bool _open = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        // A plain gesture detector over a Row. No InkWell: the ripple is the
        // other half of what ExpansionTile was compositing, and a disclosure
        // that is already animating its own contents does not need one.
        Semantics(
          button: true,
          expanded: _open,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding:
                  widget.tilePadding ??
                  const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: 14,
                  ),
              child: Row(
                children: [
                  if (widget.leading != null) ...[
                    widget.leading!,
                    const SizedBox(width: AppSpacing.md),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        widget.title,
                        if (widget.subtitle != null) widget.subtitle!,
                      ],
                    ),
                  ),
                  // Rotated rather than cross-faded between two icons, which
                  // is one less thing to composite.
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      Icons.expand_more_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        // An `if`, not an Offstage or a sized ClipRect. The children are in the
        // tree or they are not.
        if (_open)
          Padding(
            padding:
                widget.childrenPadding ??
                const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  0,
                  AppSpacing.md,
                  AppSpacing.md,
                ),
            child: Column(
              crossAxisAlignment: widget.crossAxisAlignment,
              mainAxisSize: MainAxisSize.min,
              children: widget.children,
            ),
          ),
      ],
    );
  }
}
