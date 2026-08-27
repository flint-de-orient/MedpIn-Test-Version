import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/tokens.dart';

/// The six boxes a texted code is typed into.
///
/// One real [TextField], drawn as six boxes. The field is transparent and
/// stretched across the row rather than six separate fields with focus hopping
/// between them, because Android's autofill fills a *field* — six of them and
/// the code lands in the first box alone, which is the failure mode every
/// hand-rolled OTP row has.
///
/// On the fill mechanism: `AutofillHints.oneTimeCode` is what the platform
/// offers from the SMS notification or the keyboard suggestion bar. Filling
/// with no tap at all — Google's SMS Retriever — needs an 11-character app
/// hash appended to the message body, and these templates are registered with
/// India's DLT registry without one. Getting that would mean re-registering
/// both templates. This is the version that works with the templates as
/// approved.
class OtpCodeField extends StatefulWidget {
  const OtpCodeField({
    super.key,
    required this.controller,
    this.length = 6,
    this.enabled = true,
    this.hasError = false,
    this.autofocus = true,
    this.onCompleted,
  });

  final TextEditingController controller;
  final int length;
  final bool enabled;

  /// Turns the boxes red. The message itself belongs to the screen, next to
  /// everything else that went wrong, not under the row.
  final bool hasError;

  final bool autofocus;

  /// Fired once the last digit lands, so a filled code submits itself rather
  /// than waiting for a tap on a button the patient has to go and find.
  final ValueChanged<String>? onCompleted;

  @override
  State<OtpCodeField> createState() => _OtpCodeFieldState();
}

class _OtpCodeFieldState extends State<OtpCodeField> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChanged);
    _focus.dispose();
    super.dispose();
  }

  String _last = '';

  void _onChanged() {
    final text = widget.controller.text;
    if (text == _last) return;
    _last = text;
    setState(() {});
    if (text.length == widget.length) widget.onCompleted?.call(text);
  }

  @override
  Widget build(BuildContext context) {
    final code = widget.controller.text;
    // Which box the next digit goes in, so exactly one box is highlighted and
    // it is the one being typed into.
    final cursor = code.length.clamp(0, widget.length - 1);
    final focused = _focus.hasFocus;

    return Semantics(
      label: 'Verification code, ${widget.length} digits',
      textField: true,
      child: Stack(
        children: [
          Row(
            children: [
              for (var i = 0; i < widget.length; i++) ...[
                if (i > 0) const SizedBox(width: T.s2),
                Expanded(child: _box(i, code, cursor, focused)),
              ],
            ],
          ),

          // The real field, over the boxes and invisible. It keeps its own
          // hit area so a tap anywhere on the row opens the keyboard.
          Positioned.fill(
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              enabled: widget.enabled,
              autofocus: widget.autofocus,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(widget.length),
              ],
              // Invisible, not offstage: an offstage field cannot be filled.
              style: const TextStyle(color: Colors.transparent, fontSize: 1),
              cursorColor: Colors.transparent,
              showCursor: false,
              enableInteractiveSelection: false,
              decoration: const InputDecoration(
                border: InputBorder.none,
                focusedBorder: InputBorder.none,
                enabledBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                counterText: '',
              ),
              onTap: () => setState(() {}),
            ),
          ),
        ],
      ),
    );
  }

  Widget _box(int i, String code, int cursor, bool focused) {
    final filled = i < code.length;
    final active = focused && i == cursor && code.length < widget.length;

    final border =
        widget.hasError
            ? T.danger
            : active
            ? T.primary
            : filled
            ? T.primaryLight
            : T.line;

    return Container(
      // Comfortably past the 48px floor: this is the one control on the
      // screen, and these patients are largely elderly.
      height: MediaQuery.textScalerOf(context).scale(56),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: widget.hasError ? T.dangerTint : T.surfaceRaised,
        borderRadius: BorderRadius.circular(T.rControl),
        border: Border.all(color: border, width: active || filled ? 1.6 : 1),
      ),
      child: Text(
        filled ? code[i] : '',
        style: T.metric.copyWith(
          fontSize: 24,
          color: widget.hasError ? T.danger : T.ink,
        ),
      ),
    );
  }
}

/// The wait before another code can be asked for.
///
/// Counts down from [seconds] and then offers the resend. The number is the
/// point: "Send it again" greyed out with no reason reads as broken, and a
/// patient who has not received the SMS will tap it until something happens.
class OtpResendTimer extends StatefulWidget {
  const OtpResendTimer({
    super.key,
    required this.seconds,
    required this.onResend,
    required this.waitingLabel,
    required this.resendLabel,
  });

  final int seconds;
  final VoidCallback onResend;

  /// Takes the remaining seconds.
  final String Function(int) waitingLabel;
  final String resendLabel;

  @override
  State<OtpResendTimer> createState() => OtpResendTimerState();
}

class OtpResendTimerState extends State<OtpResendTimer> {
  late int _left = widget.seconds;

  @override
  void initState() {
    super.initState();
    _tick();
  }

  /// Restarts the countdown — called by the screen after a resend so the wait
  /// reflects the code that was actually just sent.
  void restart(int seconds) {
    if (!mounted) return;
    setState(() => _left = seconds);
    _tick();
  }

  bool _ticking = false;

  Future<void> _tick() async {
    if (_ticking) return;
    _ticking = true;
    while (mounted && _left > 0) {
      await Future<void>.delayed(const Duration(seconds: 1));
      if (!mounted) return;
      setState(() => _left -= 1);
    }
    _ticking = false;
  }

  @override
  Widget build(BuildContext context) {
    if (_left > 0) {
      return Text(
        widget.waitingLabel(_left),
        textAlign: TextAlign.center,
        style: T.small.copyWith(color: T.inkMuted),
      );
    }
    return Center(
      child: TextButton(
        onPressed: widget.onResend,
        style: TextButton.styleFrom(
          foregroundColor: T.primary,
          // Padding rather than a bare label: the words alone are a 16px
          // target.
          padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        ),
        child: Text(
          widget.resendLabel,
          style: T.small.copyWith(
            color: T.primary,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
