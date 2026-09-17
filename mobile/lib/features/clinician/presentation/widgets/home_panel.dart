import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';

/// The pieces every panel on the doctor's home is built from.
///
/// ---- Five states, and each one says which ---------------------------------
///
/// A panel is loading, failed, refused, not available here, or answered — and
/// an answered panel can be out of date. The home used to have two of those:
/// data, or the empty state. A request that failed was drawn as "Nobody needs
/// immediate attention" and "No open alerts", under a header that said
/// "Updated just now" with a green dot. That is the worst thing a clinical
/// screen can do, and every panel here goes through [HomePanel] so none of them
/// can do it again by accident.
///
/// ---- Why these live here and not in shared/widgets ------------------------
///
/// That folder is frozen while four screens are redesigned at once. These are
/// candidates to promote once the waves merge: [ViewAllButton] in particular
/// fixes the 36-point tap target of the shared `ActionLink`.

/// Why a request came back without data, in the reader's terms.
enum LoadProblem {
  /// The network, the server, a timeout: worth trying again.
  failed,

  /// The server said no. Trying again will not change it.
  denied,

  /// The server does not have it, or cannot answer for this account yet.
  unavailable,
}

/// Which of the three a thrown error is.
LoadProblem loadProblemOf(Object? error) {
  if (error is ApiException) {
    if (error.statusCode == 403) return LoadProblem.denied;
    if (error.statusCode == 404 ||
        error.statusCode == 409 ||
        error.statusCode == 501) {
      return LoadProblem.unavailable;
    }
  }
  return LoadProblem.failed;
}

/// The server's own sentence, when it wrote one for a person to read.
///
/// `NO_PRACTICE` and `PRACTICE_REQUIRED` explain themselves ("This account is
/// not part of a practice any more…"). A bare "You do not have access to this
/// resource" does not, and is replaced by the panel's own wording.
String? readableServerMessage(Object? error) {
  if (error is! ApiException) return null;
  const written = {'NO_PRACTICE', 'PRACTICE_REQUIRED'};
  return written.contains(error.code) ? error.message : null;
}

// ---- heading ----------------------------------------------------------------

/// "View all", with a 48-point target and one voice everywhere on the home.
class ViewAllButton extends StatelessWidget {
  const ViewAllButton({super.key, required this.onTap, this.semanticLabel});

  final VoidCallback onTap;

  /// What "all" is, for a screen reader: "View all patients".
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel ?? 'View all',
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(T.rControl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: T.tap, minWidth: T.tap),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: T.s2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'View all',
                  style: T.small.copyWith(
                    color: T.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: T.s1),
                const Icon(
                  Icons.arrow_forward_rounded,
                  size: T.s5,
                  color: T.primary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The heading of a home panel: an icon, the title, and an optional action.
///
/// The home had five heading treatments — a red icon plate, a bare title at
/// twenty, one at sixteen, one outside its card in extra-bold, one with a green
/// dot — and "Clinic snapshot" beside "Live Triage". One shape, sentence case.
class PanelHeading extends StatelessWidget {
  const PanelHeading({
    super.key,
    required this.icon,
    required this.title,
    this.onViewAll,
    this.viewAllLabel,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final VoidCallback? onViewAll;
  final String? viewAllLabel;

  /// Instead of "View all", when the panel's control is something else.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: T.s6, color: T.primary),
        const SizedBox(width: T.s3),
        Expanded(
          child: Semantics(
            header: true,
            child: Text(title, style: T.title.copyWith(color: T.ink)),
          ),
        ),
        if (trailing != null)
          trailing!
        else if (onViewAll != null)
          ViewAllButton(onTap: onViewAll!, semanticLabel: viewAllLabel),
      ],
    );
  }
}

// ---- the card and its states -----------------------------------------------

/// A panel on the doctor's home, in whichever of its states it is.
///
/// [value] is the request behind it. While it has never answered the panel
/// shows placeholders; when it fails before answering it says which kind of
/// failure; once it has answered, a later failure keeps what was shown and
/// says it is out of date — a refresh that fails must never turn a list of
/// patients into an error, or worse into an empty list.
class HomePanel<V> extends StatelessWidget {
  const HomePanel({
    super.key,
    required this.icon,
    required this.title,
    required this.value,
    required this.what,
    required this.onRetry,
    required this.builder,
    this.onViewAll,
    this.viewAllLabel,
    this.trailing,
    this.footer,
  });

  final IconData icon;
  final String title;
  final AsyncValue<V> value;

  /// Drawn in every state, below the body — for an action that does not depend
  /// on the panel's data arriving. Starting a consultation does not wait for
  /// the appointment list.
  final Widget? footer;

  /// What the panel holds, in the reader's words, for "Could not load …":
  /// "blood pressure readings", "today's appointments".
  final String what;
  final VoidCallback onRetry;
  final Widget Function(V value) builder;
  final VoidCallback? onViewAll;
  final String? viewAllLabel;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final v = value;
    final Widget body;
    if (v.hasValue) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          builder(v.requireValue),
          if (v.hasError) ...[
            const SizedBox(height: T.s3),
            StaleNote(onRetry: onRetry),
          ],
        ],
      );
    } else if (v.hasError) {
      body = PanelProblem(
        problem: loadProblemOf(v.error),
        what: what,
        serverMessage: readableServerMessage(v.error),
        onRetry: onRetry,
      );
    } else {
      body = PanelLoading(what: what);
    }

    return HomeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PanelHeading(
            icon: icon,
            title: title,
            // Nowhere to go until there is something there.
            onViewAll: v.hasValue ? onViewAll : null,
            viewAllLabel: viewAllLabel,
            trailing: trailing,
          ),
          const SizedBox(height: T.s2),
          body,
          if (footer != null) ...[const SizedBox(height: T.s4), footer!],
        ],
      ),
    );
  }
}

/// The home's card: [SectionCard] with the padding the home uses.
///
/// Sixteen, not the section default of twenty. The rows inside are tiles with
/// their own padding, and at 360 points the extra eight on each side is the
/// width a long patient name needs to stay on one line.
class HomeCard extends StatelessWidget {
  const HomeCard({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SectionCard(padding: const EdgeInsets.all(T.s4), child: child);
  }
}

/// Placeholders the shape of the rows that are coming, rather than a spinner.
///
/// A spinner in every card on a home screen is a screen of spinners; two quiet
/// bars say "this panel is on its way" and keep the layout from jumping when it
/// lands.
class PanelLoading extends StatelessWidget {
  const PanelLoading({super.key, required this.what});

  final String what;

  @override
  Widget build(BuildContext context) {
    Widget bar(double widthFactor) => FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: Container(
        height: T.s3,
        decoration: const BoxDecoration(color: T.line, borderRadius: T.rFull),
      ),
    );

    return Semantics(
      label: 'Loading $what',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: T.s2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            bar(0.8),
            const SizedBox(height: T.s3),
            bar(0.55),
          ],
        ),
      ),
    );
  }
}

/// A panel that has nothing to show, and the true reason why.
class PanelProblem extends StatelessWidget {
  const PanelProblem({
    super.key,
    required this.problem,
    required this.what,
    required this.onRetry,
    this.serverMessage,
  });

  final LoadProblem problem;
  final String what;
  final VoidCallback onRetry;
  final String? serverMessage;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, String headline, String? detail, bool retry) =
        switch (problem) {
          LoadProblem.failed => (
            Icons.cloud_off_rounded,
            'Could not load $what.',
            'The app could not reach the server. Nothing has been lost.',
            true,
          ),
          LoadProblem.denied => (
            Icons.lock_outline_rounded,
            serverMessage ?? 'Your role at this practice does not include $what.',
            serverMessage == null
                ? 'Whoever runs the practice can change what you may see.'
                : null,
            false,
          ),
          LoadProblem.unavailable => (
            Icons.info_outline_rounded,
            serverMessage ?? 'This server cannot show $what yet.',
            null,
            false,
          ),
        };

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: T.s1),
          child: Icon(icon, size: T.s5, color: T.inkMuted),
        ),
        const SizedBox(width: T.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(headline, style: T.body.copyWith(color: T.ink)),
              if (detail != null)
                Text(detail, style: T.small.copyWith(color: T.inkMuted)),
              // Under the sentence, not beside it: beside it, the sentence
              // was squeezed to a word a line.
              if (retry) RetryButton(onTap: onRetry),
            ],
          ),
        ),
      ],
    );
  }
}

/// The note under figures that are still on screen but did not refresh.
class StaleNote extends StatelessWidget {
  const StaleNote({super.key, required this.onRetry, this.since});

  final VoidCallback onRetry;

  /// When the figures above were last true, if the caller knows.
  final String? since;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      tone: T.warningTint,
      padding: const EdgeInsets.fromLTRB(T.s3, T.s1, T.s1, T.s1),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_rounded, size: T.s5, color: T.warning),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(
              since == null
                  ? 'Not refreshed. These are the last figures that loaded.'
                  : 'Not refreshed since $since.',
              style: T.small.copyWith(color: T.ink),
            ),
          ),
          RetryButton(onTap: onRetry),
        ],
      ),
    );
  }
}

/// "Retry", at the tap floor.
class RetryButton extends StatelessWidget {
  const RetryButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: T.primary,
        minimumSize: const Size(T.tap, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s2),
      ),
      // The style on the text, not the button's `textStyle`: a button text
      // style replaces the theme's and loses its typeface.
      child: Text('Retry', style: T.small.copyWith(fontWeight: FontWeight.w700)),
    );
  }
}

// ---- inside a panel ---------------------------------------------------------

/// What a status means, as a colour that always travels with a word.
enum Tone { danger, warning, success, info, neutral }

/// A status as a word on a tint — never a dot on its own.
class StatusWord extends StatelessWidget {
  const StatusWord({super.key, required this.label, required this.tone});

  final String label;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final (Color ink, Color tint) = switch (tone) {
      Tone.danger => (T.danger, T.dangerTint),
      Tone.warning => (T.warning, T.warningTint),
      Tone.success => (T.success, T.successTint),
      Tone.info => (T.primary, T.primaryTint),
      Tone.neutral => (T.inkMuted, T.surface),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s2, vertical: T.s1),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: T.rFull,
        border: tone == Tone.neutral ? Border.all(color: T.line) : null,
      ),
      child: Text(label, style: T.label.copyWith(color: ink)),
    );
  }
}

/// One patient in a panel, tappable to their record.
///
/// The row is the button. The old triage queue put a red "Review" button on
/// every row beside a tappable row — two targets doing one thing, and a column
/// of red that said nothing about which patient was worst.
class PanelPatientRow extends StatelessWidget {
  const PanelPatientRow({
    super.key,
    required this.patientId,
    required this.name,
    this.detail,
    this.status,
    this.trailing,
    this.leading,
    this.statusBelow = false,
  });

  final String patientId;

  /// Null when the server could not resolve one; drawn as "A patient".
  final String? name;
  final String? detail;
  final StatusWord? status;

  /// The status under the name rather than beside it — for rows whose status
  /// words are long ("In consultation") and whose names are long too, where
  /// side by side left a three-line name beside an empty half of the row.
  final bool statusBelow;

  /// A date or a value, right-aligned.
  final String? trailing;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final who = (name == null || name!.trim().isEmpty) ? 'A patient' : name!;
    final scale = MediaQuery.textScalerOf(context);

    return Padding(
      padding: const EdgeInsets.only(top: T.s2),
      child: Semantics(
        button: patientId.isNotEmpty,
        label: [
          who,
          if (detail != null) detail!,
          if (status != null) status!.label,
          if (trailing != null) trailing!,
        ].join('. '),
        excludeSemantics: true,
        child: InnerTile(
          onTap: patientId.isEmpty
              ? null
              : () => context.push('/clinician/patients/$patientId', extra: name),
          padding: const EdgeInsets.symmetric(
            horizontal: T.s3,
            vertical: T.s2,
          ),
          child: ConstrainedBox(
            // The tap floor less the tile's padding, grown with the text.
            constraints: BoxConstraints(
              minHeight: scale.scale(T.tap - 2 * T.s2),
            ),
            child: Row(
              children: [
                if (leading != null) ...[leading!, const SizedBox(width: T.s3)],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(who, style: T.bodyStrong.copyWith(color: T.ink)),
                      if (detail != null && detail!.isNotEmpty)
                        Text(
                          // Joined across the slash, so "mg/dL" and
                          // "186/122" never break over two lines.
                          detail!.replaceAll('/', '⁠/⁠'),
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                      if (statusBelow && status != null)
                        Padding(
                          padding: const EdgeInsets.only(top: T.s1),
                          child: status!,
                        ),
                    ],
                  ),
                ),
                if ((status != null && !statusBelow) || trailing != null) ...[
                  const SizedBox(width: T.s2),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (status != null && !statusBelow) status!,
                      if (trailing != null)
                        Padding(
                          padding: EdgeInsets.only(
                            top: status == null || statusBelow ? 0 : T.s1,
                          ),
                          child: Text(
                            trailing!,
                            style: T.small.copyWith(color: T.inkMuted),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A line of text inside a panel.
class PanelNote extends StatelessWidget {
  const PanelNote(
    this.text, {
    super.key,
    this.color = T.inkMuted,
    this.strong = false,
    this.top = T.s2,
  });

  final String text;
  final Color color;
  final bool strong;
  final double top;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: top),
      child: Text(
        text,
        style: (strong ? T.bodyStrong : T.small).copyWith(color: color),
      ),
    );
  }
}

/// A sentence of counts with the numbers in weight: "2 in crisis · 19 at
/// stage 2".
///
/// Number first, then the words. "Stage 2 19" was the old chip, and nobody can
/// tell which of those two numbers is the count.
class CountLine extends StatelessWidget {
  const CountLine({super.key, required this.parts, this.top = T.s2});

  final List<CountPart> parts;
  final double top;

  @override
  Widget build(BuildContext context) {
    final shown = parts.where((p) => p.count > 0).toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    // A wrap of counts rather than one sentence with dots between them: a
    // sentence breaks where it likes, and "· 3 seen" at the start of a line
    // reads as a fragment.
    return Padding(
      padding: EdgeInsets.only(top: top),
      child: Wrap(
        spacing: T.s4,
        runSpacing: T.s1,
        children: [
          for (final p in shown)
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${p.count}',
                    style: TextStyle(fontWeight: FontWeight.w700, color: p.color ?? T.ink),
                  ),
                  TextSpan(text: ' ${p.label}', style: TextStyle(color: p.color ?? T.inkMuted)),
                ],
              ),
              style: T.small.copyWith(color: T.inkMuted),
            ),
        ],
      ),
    );
  }
}

/// One count in a [CountLine].
class CountPart {
  const CountPart(this.count, this.label, {this.color});

  final int count;
  final String label;

  /// Only for a count whose meaning is a warning; words carry the rest.
  final Color? color;
}

/// "d MMM", without a locale lookup for a panel's short dates.
String shortDate(DateTime d) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${d.day} ${months[d.month - 1]}';
}

/// "3 patients", "1 patient".
String patients(int n) => '$n ${n == 1 ? 'patient' : 'patients'}';
