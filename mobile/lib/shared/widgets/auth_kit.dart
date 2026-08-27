import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// The components the entry screens are built from.
///
/// Every value comes from [T]. The point of putting them here rather than in
/// each screen is that a button defined three times becomes three slightly
/// different buttons within a month.

/// The primary action. A full pill, not a rounded rectangle — that single
/// choice does more for the "finished" read than anything else on the screen,
/// and it is the shape a half-committed radius always fails to be.
class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      child: GestureDetector(
        onTap: enabled ? onPressed : null,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 120),
          opacity: enabled ? 1 : 0.55,
          child: Container(
            height: T.hControl,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: T.primary,
              borderRadius: T.rFull,
              boxShadow: enabled ? T.eAction : null,
            ),
            child:
                loading
                    ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(Colors.white),
                      ),
                    )
                    : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (icon != null) ...[
                          Icon(icon, size: 20, color: Colors.white),
                          const SizedBox(width: T.s2),
                        ],
                        Text(
                          label,
                          style: T.bodyStrong.copyWith(color: Colors.white),
                        ),
                      ],
                    ),
          ),
        ),
      ),
    );
  }
}

/// The secondary action: the same pill, hollow. Same height and radius as
/// [PillButton] so a stacked pair reads as one control with two options.
class PillButtonOutlined extends StatelessWidget {
  const PillButtonOutlined({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final Widget? icon;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        onTap: onPressed,
        child: Container(
          height: T.hControl,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: T.surfaceRaised,
            borderRadius: T.rFull,
            border: Border.all(color: T.line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[icon!, const SizedBox(width: T.s2)],
              Text(label, style: T.bodyStrong.copyWith(color: T.ink)),
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled field.
///
/// The label sits above the box rather than floating inside it. A floating
/// label moves, changes size and changes colour on focus — three animations to
/// tell you something a static label says for free, and it leaves the field
/// looking empty-but-busy at rest.
class AuthField extends StatelessWidget {
  const AuthField({super.key, required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: T.s2),
          child: Text(
            label,
            style: T.small.copyWith(color: T.ink, fontWeight: FontWeight.w600),
          ),
        ),
        child,
      ],
    );
  }

  /// The decoration every input on these screens shares. Passed to
  /// `InputDecoration` so validation, prefixes and suffixes still work.
  static InputDecoration decoration({
    String? hint,
    String? helper,
    Widget? prefix,
    Widget? suffix,
    String? prefixText,
  }) {
    OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(T.rCard),
      borderSide: BorderSide(color: c, width: w),
    );
    return InputDecoration(
      hintText: hint,
      hintStyle: T.body.copyWith(color: T.inkFaint),
      helperText: helper,
      helperStyle: T.small.copyWith(color: T.inkMuted),
      helperMaxLines: 2,
      // The country code is drawn as a leading widget, not as `prefixText`.
      //
      // Flutter hides prefixText while the field is empty and unfocused, so
      // "+91" appeared only once someone started typing — which is the one
      // moment they no longer need telling. Before that the box read "Enter
      // your 10-digit number" with nothing saying which country's ten digits,
      // on the screen where a patient decides whether to type their number
      // with a code or without one. A prefixIcon is always painted.
      prefixIcon:
          prefix ??
          (prefixText == null
              ? null
              : Padding(
                padding: const EdgeInsets.only(left: T.s4, right: T.s2),
                child: Text(
                  prefixText.trim(),
                  style: T.body.copyWith(color: T.ink),
                ),
              )),
      // Without this the code sits inside a 48px icon slot, pushed away from
      // the number it belongs to.
      prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
      suffixIcon: suffix,
      filled: true,
      fillColor: T.surfaceRaised,
      isDense: true,
      // Vertical padding rather than a fixed height: a field that has to grow
      // for an error message must be free to.
      contentPadding: const EdgeInsets.symmetric(
        horizontal: T.s4,
        vertical: T.s4,
      ),
      enabledBorder: border(T.line),
      focusedBorder: border(T.primary, 1.5),
      errorBorder: border(T.danger),
      focusedErrorBorder: border(T.danger, 1.5),
      errorStyle: T.small.copyWith(color: T.danger),
      counterText: '',
    );
  }
}

/// The thin step indicator across the top of a flow.
class StepBar extends StatelessWidget {
  const StepBar({super.key, required this.step, required this.total});

  final int step;
  final int total;

  @override
  Widget build(BuildContext context) {
    final fraction = total == 0 ? 0.0 : (step / total).clamp(0.0, 1.0);
    return Semantics(
      label: 'Step $step of $total',
      child: ClipRRect(
        borderRadius: T.rFull,
        child: LinearProgressIndicator(
          value: fraction,
          minHeight: T.s1,
          backgroundColor: T.line,
          valueColor: const AlwaysStoppedAnimation(T.primary),
        ),
      ),
    );
  }
}

/// The circular outlined back button.
class CircleBack extends StatelessWidget {
  const CircleBack({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Back',
      child: GestureDetector(
        onTap: onTap,
        // A 44px circle inside a 48px box: the ring stays the size the design
        // wants while the tap target stays the size a thumb wants.
        child: SizedBox(
          width: T.tap,
          height: T.tap,
          child: Center(
            child: Container(
              width: T.hCircle,
              height: T.hCircle,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: T.surfaceRaised,
                border: Border.all(color: T.line),
              ),
              child: const Icon(
                Icons.arrow_back_rounded,
                size: 20,
                color: T.ink,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A screen headline and its supporting line.
class ScreenHeading extends StatelessWidget {
  const ScreenHeading({
    super.key,
    required this.title,
    this.subtitle,
    this.center = false,
  });

  final String title;
  final String? subtitle;
  final bool center;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment:
          center ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      children: [
        Text(
          title,
          textAlign: center ? TextAlign.center : TextAlign.start,
          style: T.display.copyWith(color: T.ink),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: T.s2),
          Text(
            subtitle!,
            textAlign: center ? TextAlign.center : TextAlign.start,
            style: T.body.copyWith(color: T.inkMuted),
          ),
        ],
      ],
    );
  }
}

/// An inline error. Tinted, never a raw red slab.
class InlineError extends StatelessWidget {
  const InlineError({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(T.s3),
      decoration: T.tintedBox(T.danger, T.dangerTint),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded, size: 20, color: T.danger),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(message, style: T.small.copyWith(color: T.danger)),
          ),
        ],
      ),
    );
  }
}
