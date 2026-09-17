/// The three surfaces every patient-facing screen is built from, and nothing
/// else.
///
/// The screen's worst habit was nesting: page → card → card → card, each with
/// its own border, until every individual fact sat in a box and none of the
/// boxes meant anything. Depth is information, and spending it on a single
/// number leaves nothing left to say "these things belong together".
///
/// So there are exactly three levels and they are declared here rather than
/// improvised per section:
///
///  1. the page — [GlassGround], a very light blue-grey;
///  2. [SectionCard] — white, 24px, one hairline, one soft shadow;
///  3. [InnerTile] — 16px, a faint wash, no shadow and barely a border.
///
/// A fourth level is deliberately not available. If something inside an
/// [InnerTile] needs to stand out, it does it with type or colour.
library;

import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// Level 2: a main section of the page.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(T.s5),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: padding,
      // Hard-clipped. A chart handed a degenerate range once painted a stray
      // path clean out of the card and up the page; whatever a section puts
      // inside itself, the card's own rectangle is the limit.
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF141B26) : Colors.white,
        borderRadius: BorderRadius.circular(T.rSection),
        border: Border.all(color: dark ? const Color(0x14FFFFFF) : T.line),
        boxShadow:
            dark
                ? null
                : const [
                  BoxShadow(
                    color: Color(0x0A0B1B3A),
                    blurRadius: 18,
                    offset: Offset(0, 6),
                  ),
                ],
      ),
      child: child,
    );
  }
}

/// Level 3: one metric, one meal, one shortcut — inside a [SectionCard].
class InnerTile extends StatelessWidget {
  const InnerTile({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(T.s3),
    this.tone,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  /// A semantic wash, used only where the tile itself carries a status. Most
  /// tiles pass nothing and take the neutral one.
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fill =
        tone ?? (dark ? const Color(0xFF1A2230) : const Color(0xFFF8FAFD));

    final box = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(T.rControl),
        border: Border.all(
          color: dark ? const Color(0x0FFFFFFF) : const Color(0xFFEEF2F8),
        ),
      ),
      child: child,
    );

    if (onTap == null) return box;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(T.rControl),
        onTap: onTap,
        child: box,
      ),
    );
  }
}

/// The heading of a [SectionCard]: a 36px tinted plate, the title, an optional
/// second line, and an optional action on the right.
///
/// One shape for every section is most of what makes the page read as a single
/// product. Before this, four sections had four different headings.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Wraps rather than ellipsises. A section called "Tests
        // ordered by the doct…" tells the reader less than the same
        // words on two lines, and costs the same room to say it.
        Text(
          title,
          style: T.title.copyWith(color: dark ? Colors.white : T.ink),
        ),
        if (subtitle != null)
          Text(
            subtitle!,
            style: T.label.copyWith(
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
              color: T.inkMuted,
            ),
          ),
      ],
    );
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: dark ? const Color(0x1F4890F0) : T.primaryTint,
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: 20,
            color: dark ? const Color(0xFF7FB0FF) : T.primary,
          ),
        ),
        const SizedBox(width: T.s3),
        Expanded(
          child:
              trailing == null
                  ? heading
                  // Beside the title when both fit on one line, under it when
                  // they do not. A Row pushed a "Change" button 16px off a
                  // phone at twice the text size, inside a padded card.
                  : OverflowBar(
                    alignment: MainAxisAlignment.spaceBetween,
                    overflowAlignment: OverflowBarAlignment.start,
                    spacing: T.s2,
                    overflowSpacing: T.s1,
                    children: [heading, trailing!],
                  ),
        ),
      ],
    );
  }
}

/// The one way this app says "go and see the rest of it".
///
/// There were four: "See all", "View all", "View full plan", "+ Add" — the
/// same meaning in four weights, three colours and two alignments. A reader
/// learns one affordance and then has to re-learn it in every card.
class ActionLink extends StatelessWidget {
  const ActionLink({
    super.key,
    required this.label,
    required this.onTap,
    this.leadingIcon,
  });

  final String label;
  final VoidCallback onTap;

  /// Only for "+ Add"-style actions, which add rather than navigate — the
  /// arrow is reserved for going somewhere.
  final IconData? leadingIcon;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tone = dark ? const Color(0xFF7FB0FF) : T.primary;
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Padding(
          // Padding, not a bare tap: the words alone are a 14px-tall target.
          padding: const EdgeInsets.symmetric(vertical: T.s2, horizontal: T.s1),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (leadingIcon != null) ...[
                Icon(leadingIcon, size: 16, color: tone),
                const SizedBox(width: T.s1),
              ],
              // Flexible so a long label wraps inside a narrow card at a large
              // text size instead of running 8px past its edge.
              Flexible(
                child: Text(
                  label,
                  style: T.small.copyWith(
                    fontWeight: FontWeight.w700,
                    color: tone,
                  ),
                ),
              ),
              if (leadingIcon == null) ...[
                const SizedBox(width: T.s1),
                Icon(Icons.arrow_forward_rounded, size: 15, color: tone),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// What a reading means, in words rather than a colour alone.
///
/// Colour is never the only carrier here: every tone ships with a label,
/// because this clinic's patients include people with diabetic retinopathy,
/// and red-green colour vision deficiency runs alongside diabetes often
/// enough that a red pill on its own would be a real omission.
enum Status {
  ok(T.success, T.successTint),
  watch(T.warning, T.warningTint),
  alert(T.danger, T.dangerTint),
  neutral(T.inkMuted, Color(0xFFF1F4F9));

  const Status(this.tone, this.tint);

  final Color tone;
  final Color tint;
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.status,
    this.icon,
  });

  final String label;
  final Status status;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: 3),
      decoration: BoxDecoration(color: status.tint, borderRadius: T.rFull),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: status.tone),
            const SizedBox(width: 3),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: T.label.copyWith(
                fontSize: 11,
                letterSpacing: 0,
                color: status.tone,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A figure and its unit set as one line, the unit smaller and lighter.
///
/// "217 mg/dL" in one weight makes the unit compete with the reading. The
/// reading is what the patient is looking for; the unit is only there so the
/// number means something.
class MetricValue extends StatelessWidget {
  const MetricValue({
    super.key,
    required this.value,
    this.unit,
    this.size = 26,
    this.color,
  });

  final String value;
  final String? unit;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = color ?? (dark ? Colors.white : T.ink);
    // Shrinks to fit rather than ellipsising. A truncated word is still
    // readable; a truncated reading is a different number — "148" cut to
    // "14…" is wrong, not short — so the one thing this must never do is
    // drop a digit.
    return FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.centerLeft,
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: value),
            if (unit != null)
              TextSpan(
                text: ' $unit',
                style: TextStyle(
                  fontSize: size * 0.48,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0,
                  color: T.inkMuted,
                ),
              ),
          ],
        ),
        maxLines: 1,
        style: T.metric.copyWith(fontSize: size, color: ink),
      ),
    );
  }
}
