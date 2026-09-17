import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/capabilities/capabilities.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';

/// The states a clinic inbox has besides "here are the conversations", and the
/// small controls the inboxes share.
///
/// Four states used to look alike. A list still on its way, a list that could
/// not be fetched, a list that is genuinely empty and a list this person is not
/// allowed to read were all, on one screen or another, a blank space under the
/// filter chips — or "Could not load conversations" for a laboratory technician
/// whose role simply does not include them, which sends somebody to check the
/// wifi about a permission.
///
/// Candidates for lib/shared/widgets once the redesign settles: [ChoicePills],
/// [TonePill], [StaleNotice], [NotYourRole], [InboxEmpty], [ListSkeleton].

/// True when the server refused because of this person's role, rather than
/// because it could not be reached.
bool refusedForRole(Object? error) =>
    error is ApiException &&
    (error.statusCode == 403 || error.code == 'FORBIDDEN');

/// Whether this person may read patients' conversations, as far as is known
/// before asking.
///
/// Said "no" only when it is known: the capabilities have arrived, there is a
/// membership, and its grant leaves conversations out. [Capabilities.can] is
/// not enough on its own, because it reads an account with no membership as
/// holding nothing — and the server lets exactly that account through ("no
/// membership is no evidence"), so a doctor the backfill has not reached would
/// have been told conversations are not part of their role. Anything short of
/// a known refusal asks the server, and the server's own refusal is caught by
/// [refusedForRole].
bool mayReadConversations(Capabilities caps) => _holds(caps, Perm.chatRead);

/// Whether this person may answer in a conversation, on the same terms.
bool mayReplyInConversations(Capabilities caps) => _holds(caps, Perm.chatReply);

bool _holds(Capabilities caps, String permission) =>
    !caps.resolved ||
    caps.role == null ||
    caps.permissions.contains(permission);

/// A name as it should be drawn in an initial: "Dr. Amit Dey" as "Amit Dey".
///
/// The avatar takes the first letter it is given, and every doctor's first
/// letter was the D of their title — a panel of doctors all wearing "D". Only
/// the initial is changed; wherever the name is printed, it is printed as the
/// person wrote it.
String nameForInitial(String name) {
  final trimmed = name.trim();
  final stripped = trimmed.replaceFirst(
    RegExp(r'^(dr|prof|mr|mrs|ms|smt|shri|sri)\.?\s+', caseSensitive: false),
    '',
  );
  return stripped.isEmpty ? trimmed : stripped;
}

/// A bounded set of choices, all of them visible.
///
/// Wraps onto a second line rather than scrolling: a filter that has slid off
/// the edge of the screen is a filter nobody uses. Every pill is a full tap
/// target and says whether it is selected to a screen reader as well as by its
/// fill.
///
/// Drawn here rather than with [ChoiceChip], whose label style carries no font
/// family and so fell back to the platform face beside Inter everywhere else.
class ChoicePills<V> extends StatelessWidget {
  const ChoicePills({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<(V, String)> options;
  final V selected;

  /// Null options are drawn but cannot be chosen.
  final void Function(V value)? onSelected;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: T.s2,
      runSpacing: T.s2,
      children: [
        for (final (value, label) in options)
          _Pill(
            label: label,
            selected: value == selected,
            onTap: onSelected == null ? null : () => onSelected!(value),
          ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.selected, this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      child: Material(
        color: selected ? T.primary : T.surfaceRaised,
        shape: StadiumBorder(
          side: BorderSide(color: selected ? T.primary : T.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: T.tap),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: T.s4,
                vertical: T.s2,
              ),
              child: Center(
                widthFactor: 1,
                child: Text(
                  label,
                  style: T.small.copyWith(
                    fontWeight: FontWeight.w600,
                    color:
                        selected
                            ? T.surfaceRaised
                            : enabled
                            ? T.ink
                            : T.inkFaint,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A word with a tone: "Urgent", "3 unread", "Approved".
///
/// The word is the message and the tint repeats it. Twelve points, on the type
/// scale — the shared status pill is eleven.
class TonePill extends StatelessWidget {
  TonePill({
    super.key,
    required this.label,
    Status status = Status.neutral,
    this.icon,
  }) : tone = status.tone,
       tint = status.tint;

  /// The panel's own blue, for something to look at rather than a warning:
  /// "3 unread", "Current".
  const TonePill.info({super.key, required this.label, this.icon})
    : tone = T.primary,
      tint = T.primaryTint;

  final String label;
  final Color tone;
  final Color tint;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s1),
      decoration: BoxDecoration(color: tint, borderRadius: T.rFull),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: T.s3 + T.s1, color: tone),
            const SizedBox(width: T.s1),
          ],
          Flexible(
            child: Text(
              label,
              style: T.label.copyWith(color: tone, letterSpacing: 0),
            ),
          ),
        ],
      ),
    );
  }
}

/// A refresh failed and what is on screen is the last answer that arrived.
///
/// Kept, not replaced. A dropped connection used to swap a full inbox for an
/// error or a blank list, which reads as every conversation having vanished.
/// The conversations are still true as of when they loaded, and the reader is
/// told exactly how old that is and offered another try.
class StaleNotice extends StatelessWidget {
  const StaleNotice({
    super.key,
    required this.title,
    required this.detail,
    required this.onRetry,
    this.retryLabel = 'Retry',
  });

  /// The English sentence pair, for the clinic's English-only screens.
  factory StaleNotice.english({
    Key? key,
    required BuildContext context,
    required String what,
    required DateTime? loadedAt,
    required VoidCallback onRetry,
  }) {
    final at = loadedAt;
    return StaleNotice(
      key: key,
      title: 'Could not refresh $what',
      detail:
          at == null
              ? 'Showing what loaded earlier.'
              : 'Showing what loaded at ${clockTime(context, at)}.',
      onRetry: onRetry,
    );
  }

  final String title;
  final String detail;
  final VoidCallback onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(T.s3, T.s2, T.s1, T.s2),
      decoration: BoxDecoration(
        color: T.warningTint,
        borderRadius: BorderRadius.circular(T.rControl),
        border: Border.all(color: T.warning.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          const Icon(Icons.sync_problem_rounded, color: T.warning),
          const SizedBox(width: T.s2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: T.small.copyWith(
                    color: T.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(detail, style: T.small.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          TextButton(onPressed: onRetry, child: Text(retryLabel)),
        ],
      ),
    );
  }
}

/// How wide [text] is on one line, and how wide its widest word is, as this
/// context would draw it — text scaler included.
///
/// For deciding a layout before committing to it: a name whose longest word
/// does not fit beside a time stamp is drawn under it instead, because the
/// alternative is "Chattopadh" and "yay" on two lines.
({double line, double word}) textWidths(
  BuildContext context,
  String text,
  TextStyle style,
) {
  final scaler = MediaQuery.textScalerOf(context);
  final direction = Directionality.of(context);
  final resolved = DefaultTextStyle.of(context).style.merge(style);
  double widthOf(String s) {
    final painter = TextPainter(
      text: TextSpan(text: s, style: resolved),
      textDirection: direction,
      textScaler: scaler,
      maxLines: 1,
    )..layout();
    final width = painter.width;
    painter.dispose();
    return width;
  }

  var word = 0.0;
  for (final w in text.split(RegExp(r'\s+'))) {
    if (w.isEmpty) continue;
    final x = widthOf(w);
    if (x > word) word = x;
  }
  return (line: widthOf(text), word: word);
}

/// A clock time in the reader's locale, kept on one line: "6:30 PM" split
/// across two lines as "6:30" and "PM" reads as two facts.
String clockTime(BuildContext context, DateTime at) => DateFormat.jm(
  Localizations.localeOf(context).toString(),
).format(at).replaceAll(' ', ' ');

/// What someone whose role has no access sees instead of the list.
///
/// Said as a fact about the role, with who can change it. An empty inbox would
/// tell them nobody has written; an error would tell them the app is broken.
/// Both are false.
class NotYourRole extends StatelessWidget {
  const NotYourRole({super.key, required this.what});

  /// What is being withheld: "patients’ conversations".
  final String what;

  @override
  Widget build(BuildContext context) {
    return InboxEmpty(
      icon: Icons.lock_outline_rounded,
      title: 'Not available to your role',
      body:
          'Your role at this practice does not include $what. Whoever runs '
          'the practice can change what your role allows, under People.',
    );
  }
}

/// An empty state that says what the emptiness means, and offers the next
/// step when there is one.
///
/// Left-aligned in the page's own type, on the page's own card — not a grey
/// icon floating mid-screen over one bold word.
class InboxEmpty extends StatelessWidget {
  const InboxEmpty({
    super.key,
    required this.title,
    required this.body,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String title;
  final String body;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: T.inkMuted),
          const SizedBox(height: T.s3),
          Text(title, style: T.title.copyWith(color: T.ink)),
          const SizedBox(height: T.s2),
          Text(body, style: T.body.copyWith(color: T.inkMuted)),
          if (action != null) ...[const SizedBox(height: T.s4), action!],
        ],
      ),
    );
  }
}

/// The shape of a list whose answer has not arrived: rows of grey bars.
///
/// Not a zero, not an empty sentence and not a spinner in the middle of the
/// page — each of those is a claim, and the one thing known while loading is
/// that nothing is known yet.
class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.rows = 4, this.avatar = true});

  final int rows;
  final bool avatar;

  @override
  Widget build(BuildContext context) {
    Widget bar(double widthFactor) => FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: Container(
        height: T.s3,
        decoration: BoxDecoration(
          color: T.line,
          borderRadius: BorderRadius.circular(T.s1),
        ),
      ),
    );

    return Semantics(
      label: 'Loading',
      child: SectionCard(
        padding: const EdgeInsets.all(T.s4),
        child: Column(
          children: [
            for (var i = 0; i < rows; i++) ...[
              if (i > 0) const SizedBox(height: T.s5),
              Row(
                children: [
                  if (avatar) ...[
                    Container(
                      width: T.s8 + T.s2,
                      height: T.s8 + T.s2,
                      decoration: const BoxDecoration(
                        color: T.line,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: T.s3),
                  ],
                  Expanded(
                    child: Column(
                      children: [
                        bar(i.isEven ? 0.55 : 0.4),
                        const SizedBox(height: T.s2),
                        bar(i.isEven ? 0.85 : 0.7),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Remembers when each answer last arrived, so a failed refresh can say how
/// old the one on screen is.
///
/// Owned by a screen's State and fed from its build. A new answer is a new
/// object, so the time moves only when one actually arrives — a rebuild for any
/// other reason, or a failed reload still carrying the old answer, leaves it
/// where it was.
class LoadedAt {
  final _at = <Object, DateTime>{};
  final _seen = <Object, Object?>{};

  void note(Object key, AsyncValue<Object?> value) {
    if (value is! AsyncData) return;
    final answer = value.value;
    if (_seen.containsKey(key) && identical(_seen[key], answer)) return;
    _seen[key] = answer;
    _at[key] = DateTime.now();
  }

  DateTime? operator [](Object key) => _at[key];
}
