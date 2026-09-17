/// The handful of pieces every patient tab is built from, beside the three
/// surfaces in `shared/widgets/surfaces.dart`.
///
/// They live here rather than in shared/ because the patient panel is the only
/// place that uses them today. Each is a candidate to promote once a second
/// panel wants the same thing — and each exists because the patient screens
/// had drifted into one version per screen:
///
///  * five headers — a greeting, a wordmark, three different app bars;
///  * status as a coloured icon on one screen, an 11px pill on the next, and a
///    bare colour on a third;
///  * clock times as "20:30" on Home and "8:30 PM" in the same patient's chat;
///  * buttons whose label style was handed a token with no font family, so
///    Android drew them in Roboto beside Inter.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/// The side gutter on every patient screen: 16, the margin the token scale
/// declares, so a card is the same width on every tab.
const EdgeInsets kPatientGutter = EdgeInsets.symmetric(horizontal: T.s4);

/// The space between two sections of a screen.
const double kSectionGap = T.s4;

/// The title row of a patient tab.
///
/// One shape on every tab: the screen's name on the left, set in the title
/// style, and at most two controls on the right. Home is the one exception —
/// it greets a person rather than naming a place — and it still uses this row,
/// with the greeting as its title.
class PatientTabHeader extends StatelessWidget {
  const PatientTabHeader({
    super.key,
    required this.title,
    this.eyebrow,
    this.titleStyle = T.display,
    this.trailing = const [],
  });

  final String title;

  /// A quieter line above the title — the greeting over a name.
  final String? eyebrow;

  /// [T.display] for a place, [T.name] for a person.
  final TextStyle titleStyle;

  final List<Widget> trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s2, T.s2),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: T.tap),
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (eyebrow != null)
                      Text(eyebrow!, style: T.small.copyWith(color: T.inkMuted)),
                    // Wraps rather than ellipsising: a name cut to "Ra…" at a
                    // larger text size is the patient's own name cut off.
                    Text(title, style: titleStyle.copyWith(color: T.ink)),
                  ],
                ),
              ),
            ),
            ...trailing,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status in words
// ---------------------------------------------------------------------------

/// A status as an icon and a word, in the status's colour.
///
/// Colour is never the only carrier: diabetic retinopathy is common in these
/// patients, and red-green deficiency runs alongside diabetes. The word wraps
/// rather than ellipsising — "Taken la…" is not a status.
class StatusWord extends StatelessWidget {
  const StatusWord({
    super.key,
    required this.label,
    required this.status,
    this.icon,
    this.strong = true,
  });

  final String label;
  final Status status;
  final IconData? icon;

  /// Semibold. Off for a secondary status sitting under a stronger one.
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final tone = status == Status.neutral ? T.inkMuted : status.tone;
    final style = T.small.copyWith(
      color: tone,
      fontWeight: strong ? FontWeight.w600 : FontWeight.w500,
    );
    // One paragraph with the icon inside it, so the icon sits on the first
    // line's middle and a wrapped second line runs back under it.
    return Text.rich(
      TextSpan(
        children: [
          if (icon != null)
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Padding(
                padding: const EdgeInsets.only(right: T.s1),
                child: Icon(
                  icon,
                  size: MediaQuery.textScalerOf(context).scale(T.s4),
                  color: tone,
                ),
              ),
            ),
          TextSpan(text: label),
        ],
      ),
      style: style,
    );
  }
}

/// A sentence the reader should notice, on a tinted tile: a warning, a note
/// that something could not be done, a fact that changes what they do next.
class NoticeTile extends StatelessWidget {
  const NoticeTile({
    super.key,
    required this.message,
    this.status = Status.watch,
    this.icon = Icons.info_outline_rounded,
    this.action,
  });

  final String message;
  final Status status;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final tone = status == Status.neutral ? T.inkMuted : status.tone;
    return InnerTile(
      tone: status == Status.neutral ? null : status.tint,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: tone),
          const SizedBox(width: T.s2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(message, style: T.small.copyWith(color: T.ink)),
                if (action != null) ...[const SizedBox(height: T.s1), action!],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A part of a screen that could not load, said in the patient's language.
///
/// The shared `LoadFailed` says the same thing in English only, which is the
/// one moment a Bengali reader most needs their own language. Distinct from an
/// empty state on purpose: "no readings" and "could not fetch the readings"
/// are different facts, and drawing the second as the first tells a patient
/// something false about their own record.
class SectionLoadFailed extends StatelessWidget {
  const SectionLoadFailed({
    super.key,
    required this.message,
    required this.onRetry,
  });

  /// What could not be loaded, as a whole sentence: "Could not load today's
  /// medicines."
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: T.s1),
            child: Icon(Icons.cloud_off_rounded, size: 20, color: T.inkMuted),
          ),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(message, style: T.body.copyWith(color: T.ink)),
                Text(
                  l10n.ptNothingLost,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: T.s2),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(
              foregroundColor: T.primary,
              minimumSize: const Size(T.tap, T.tap),
            ),
            child: Text(l10n.commonTryAgain),
          ),
        ],
      ),
    );
  }
}

/// Data kept on screen after a refresh failed, said as such.
///
/// Last-known data is never replaced by an error or an empty state because a
/// poll missed — but it is marked, with the time it actually arrived, so it
/// does not pass for current.
class StaleNotice extends StatelessWidget {
  const StaleNotice({super.key, required this.loadedAt, required this.onRetry});

  /// When the data on screen arrived. Null when that is not known.
  final DateTime? loadedAt;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final at = loadedAt;
    return NoticeTile(
      status: Status.watch,
      icon: Icons.cloud_off_rounded,
      message:
          at == null
              ? l10n.ptStaleShowingEarlier
              : l10n.ptStaleShowingLastLoaded(clockOf(context, at)),
      action: Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          onPressed: onRetry,
          style: TextButton.styleFrom(
            foregroundColor: T.primary,
            minimumSize: const Size(T.tap, T.tap),
            padding: const EdgeInsets.symmetric(horizontal: T.s2),
          ),
          child: Text(l10n.commonTryAgain),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/// The one filled action a screen offers.
///
/// Deliberately takes no text style of its own. The theme's button style
/// carries the Inter family; handing a button `T.bodyStrong` replaced it with a
/// style that has no family at all, and Android drew those labels in Roboto.
class PrimaryAction extends StatelessWidget {
  const PrimaryAction({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;

  /// Full width. Off only where the button shares a row.
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? const SizedBox(
            width: T.s5,
            height: T.s5,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
          )
        : _ButtonLabel(label: label, icon: icon);
    final button = FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: T.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size(T.tap, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s5, vertical: T.s3),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
      child: child,
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// A quieter action beside or below the primary one.
class SecondaryAction extends StatelessWidget {
  const SecondaryAction({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.expand = true,
    this.tone = T.primary,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool expand;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final button = OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: tone,
        minimumSize: const Size(T.tap, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s5, vertical: T.s3),
        side: const BorderSide(color: T.line, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
      child: _ButtonLabel(label: label, icon: icon),
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

class _ButtonLabel extends StatelessWidget {
  const _ButtonLabel({required this.label, this.icon});

  final String label;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: T.s2)],
        // Flexible so a long translated label wraps inside the button instead
        // of pushing past its edge.
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
  }
}

/// A round icon control with a full 48dp target and a spoken name.
class RoundIconAction extends StatelessWidget {
  const RoundIconAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: label,
      onPressed: onPressed,
      constraints: const BoxConstraints(minWidth: T.tap, minHeight: T.tap),
      icon: Icon(icon, size: 24, color: T.ink),
    );
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/// A grey block where a line of content will be. Still, not shimmering: this
/// is a waiting room, and motion in a waiting room reads as urgency.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, this.width, this.height = T.s4});

  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: T.line,
      borderRadius: BorderRadius.circular(T.rCard),
    ),
  );
}

/// A section card's worth of skeleton, labelled for a screen reader.
class SkeletonSection extends StatelessWidget {
  const SkeletonSection({super.key, this.lines = 3});

  final int lines;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Semantics(
      label: l10n.commonLoading,
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SkeletonLine(width: 140, height: T.s5),
            for (var i = 0; i < lines; i++) ...[
              const SizedBox(height: T.s3),
              SkeletonLine(width: i.isEven ? double.infinity : 200),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Rows and choices
// ---------------------------------------------------------------------------

/// A row that goes somewhere: an icon, what it is, a line about it, a chevron.
///
/// The whole row is the target, at least 64 tall — these readers tap with less
/// precision than a default list tile asks for.
class LinkRow extends StatelessWidget {
  const LinkRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.value,
    this.trailingIcon = Icons.chevron_right_rounded,
    this.tone = T.primary,
  });

  final IconData icon;
  final String title;
  final String? subtitle;

  /// A current setting, shown before the chevron: "mg/dL".
  final String? value;
  final VoidCallback? onTap;
  final IconData trailingIcon;

  /// The icon's colour — the danger tone for a row that removes something.
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: onTap != null,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: T.s12 + T.s4),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
            child: Row(
              children: [
                Container(
                  width: T.s8 + T.s1,
                  height: T.s8 + T.s1,
                  decoration: BoxDecoration(
                    color: tone == T.primary ? T.primaryTint : T.dangerTint,
                    borderRadius: BorderRadius.circular(T.rCard),
                  ),
                  child: Icon(icon, size: T.s5, color: tone),
                ),
                const SizedBox(width: T.s4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: T.body.copyWith(
                          color: tone == T.primary ? T.ink : tone,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                    ],
                  ),
                ),
                if (value != null) ...[
                  const SizedBox(width: T.s2),
                  Text(value!, style: T.small.copyWith(color: T.inkMuted)),
                ],
                if (onTap != null) ...[
                  const SizedBox(width: T.s1),
                  Icon(trailingIcon, size: 24, color: T.inkFaint),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A short, known set of choices, all visible, one selected.
///
/// Equal widths, so the set never wraps into two uneven lines; each label
/// wraps inside its own segment instead when the text is large.
class SegmentedChoice<V> extends StatelessWidget {
  const SegmentedChoice({
    super.key,
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onChanged,
  });

  final List<V> values;
  final V selected;
  final String Function(V) labelOf;
  final ValueChanged<V> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(T.s1),
      decoration: BoxDecoration(
        color: T.surface,
        borderRadius: BorderRadius.circular(T.rControl),
        border: Border.all(color: T.line),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final v in values)
              Expanded(
                child: Semantics(
                  button: true,
                  selected: v == selected,
                  child: InkWell(
                    onTap: () => onChanged(v),
                    borderRadius: BorderRadius.circular(T.rCard),
                    child: Container(
                      // The segment and its padding make the full 48 target.
                      constraints: const BoxConstraints(minHeight: T.tap - T.s2),
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(horizontal: T.s1),
                      decoration: BoxDecoration(
                        color: v == selected ? T.surfaceRaised : null,
                        borderRadius: BorderRadius.circular(T.rCard),
                        border: v == selected ? Border.all(color: T.line) : null,
                      ),
                      child: Text(
                        labelOf(v),
                        textAlign: TextAlign.center,
                        style: T.small.copyWith(
                          fontWeight:
                              v == selected ? FontWeight.w700 : FontWeight.w500,
                          color: v == selected ? T.primary : T.inkMuted,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/// "Metformin 500 mg" with the amount and its unit held on one line.
///
/// At a larger text size a medicine name wraps, and it wrapped between "500"
/// and "mg" — a strength split across two lines reads as two facts.
String keepUnitsTogether(String text) => text.replaceAllMapped(
  RegExp(
    r'(\d)\s+(mg|mcg|µg|g|ml|mL|IU|iu|units?|%)(?![A-Za-z])',
  ),
  (m) => '${m[1]} ${m[2]}',
);

/// The name with a leading title taken off, for an avatar's initial.
///
/// Every avatar in the app draws the first letter of the name it is given, so
/// "Dr. Amit Kumar Dey" became a "D" — the doctor's title, not the doctor.
String withoutHonorific(String name) {
  final trimmed = name.trim();
  final match = RegExp(
    r'^(dr|mr|mrs|ms|miss|prof|sri|shri|smt)\.?\s+',
    caseSensitive: false,
  ).firstMatch(trimmed);
  if (match == null) return trimmed;
  final rest = trimmed.substring(match.end).trim();
  return rest.isEmpty ? trimmed : rest;
}

// ---------------------------------------------------------------------------
// Time, said the way the patient says it
// ---------------------------------------------------------------------------

/// "8:30 PM" from the server's "20:30", in the app's language.
///
/// Every clock time a patient reads goes through here, so a dose at "20:30" on
/// one screen is not "8:30 PM" on the next. Anything that is not HH:mm comes
/// back as it arrived rather than as a guess.
String clockTime(BuildContext context, String hhmm) {
  final parts = hhmm.trim().split(':');
  if (parts.length != 2) return hhmm;
  final h = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (h == null || m == null || h > 23 || m > 59) return hhmm;
  return clockOf(context, DateTime(2000, 1, 1, h, m));
}

/// "8:30 PM" for an instant, in the app's language.
String clockOf(BuildContext context, DateTime at) =>
    DateFormat.jm(_locale(context)).format(at);

/// "Today", "Yesterday", "Tomorrow", or "Wed, 16 Sep".
String dayLabel(BuildContext context, DateTime at, {DateTime? now}) {
  final l10n = AppLocalizations.of(context);
  final n = now ?? DateTime.now();
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(at.year, at.month, at.day);
  final diff = day.difference(today).inDays;
  return switch (diff) {
    0 => l10n.apptToday,
    -1 => l10n.chatDateYesterday,
    1 => l10n.apptTomorrow,
    _ => DateFormat('EEE, d MMM', _locale(context)).format(at),
  };
}

/// "Today, 8:30 PM" / "Wed, 16 Sep, 8:30 PM".
String dayAndClock(BuildContext context, DateTime at, {DateTime? now}) =>
    '${dayLabel(context, at, now: now)}, ${clockOf(context, at)}';

/// "Wednesday, 16 September".
String longDate(BuildContext context, DateTime at) =>
    DateFormat('EEEE, d MMMM', _locale(context)).format(at);

String _locale(BuildContext context) =>
    Localizations.localeOf(context).toString();
