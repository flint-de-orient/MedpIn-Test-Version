import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // FilteringTextInputFormatter, LengthLimitingTextInputFormatter
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/app_logo.dart';
import '../../../shared/widgets/auth_kit.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/otp_field.dart';
import '../data/auth_repository.dart';
import 'auth_controller.dart';

/// Signing in with a number and a texted code.
///
/// One screen with two faces rather than two routes: the number is typed, the
/// code is typed, and the second step keeps the first one's context on screen
/// ("we sent it to this number") instead of pushing a page that has forgotten
/// where it came from. Going back is a state change, so the number survives it.
///
/// No password. Patients and dieticians do not have one — a doctor does, and
/// takes the link at the bottom.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Phase { phone, code }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _resendKey = GlobalKey<OtpResendTimerState>();

  _Phase _phase = _Phase.phone;
  bool _isSubmitting = false;
  String? _errorMessage;

  /// Set when the failure is "there is no account here", which has a way out
  /// the other errors do not: go and make one.
  bool _offerRegister = false;

  /// What the server said about the code it sent, so the screen states the
  /// real cooldown rather than a number it made up.
  OtpSent? _sent;

  /// Hidden until the first submit attempt — see the note in
  /// `RegisterScreen`; the two forms behave identically.
  AutovalidateMode _autovalidateMode = AutovalidateMode.disabled;

  @override
  void dispose() {
    _phoneController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  String get _e164 => AuthValidators.toE164(_phoneController.text);

  /// Makes the account's stored language match the language the app is being
  /// used in.
  ///
  /// The first-run picker runs before login, so it can only set the local
  /// locale — the account keeps whatever language it was created with. Left
  /// alone, the two drift apart, and anything that reads `user.language`
  /// server-side (the doctor's dashboard, notification copy, the reply
  /// language when a client omits it) uses the stale value.
  ///
  /// Best-effort: a failure here must never block a successful login.
  Future<void> _reconcileLanguage() async {
    final appLanguage = ref.read(localeControllerProvider)?.languageCode;
    if (appLanguage == null || !supportedLanguageCodes.contains(appLanguage)) {
      return;
    }
    if (ref.read(authControllerProvider).user?.language == appLanguage) return;

    ref
        .read(authControllerProvider.notifier)
        .updateLocalUserLanguage(appLanguage);
    try {
      await ref.read(authRepositoryProvider).updateMe(language: appLanguage);
    } on ApiException {
      // Local state is already correct; the server copy will catch up on the
      // next successful profile update.
    }
  }

  // ---- step one: the number ------------------------------------------------

  Future<void> _sendCode({bool resend = false}) async {
    final l10n = AppLocalizations.of(context);
    if (!resend && !(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidateMode = AutovalidateMode.onUserInteraction);
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
      _offerRegister = false;
    });

    final result = await ref
        .read(authControllerProvider.notifier)
        .requestOtp(phone: _e164, purpose: 'login');

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    final error = result.error;
    if (error != null) {
      setState(() {
        // A number with no account is the one failure with somewhere to go.
        _offerRegister = error.code == 'NOT_FOUND';
        _errorMessage =
            _offerRegister
                ? l10n.authNotRegistered
                : ErrorView.messageFor(context, error);
      });
      return;
    }

    setState(() {
      _sent = result.sent;
      _codeController.clear();
      _phase = _Phase.code;
    });
    if (resend) {
      _resendKey.currentState?.restart(result.sent!.resendAfterSeconds);
    }
  }

  // ---- step two: the code --------------------------------------------------

  Future<void> _verify() async {
    final l10n = AppLocalizations.of(context);
    if (_codeController.text.length < 6) {
      setState(() => _errorMessage = l10n.authOtpIncomplete);
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final error = await ref
        .read(authControllerProvider.notifier)
        .verifyLoginOtp(phone: _e164, code: _codeController.text);

    if (error == null) await _reconcileLanguage();
    if (!mounted) return;
    setState(() => _isSubmitting = false);
    if (error != null) {
      setState(() => _errorMessage = ErrorView.messageFor(context, error));
    }
  }

  void _backToPhone() {
    setState(() {
      _phase = _Phase.phone;
      _errorMessage = null;
      _codeController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final onCode = _phase == _Phase.code;

    return Scaffold(
      backgroundColor: T.surface,
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: _autovalidateMode,
          child: Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(T.s5, T.s8, T.s5, T.s6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(child: AppLogo(size: 64)),
                      const SizedBox(height: T.s6),
                      ScreenHeading(
                        title: onCode ? l10n.authOtpTitle : AppConfig.appName,
                        subtitle:
                            onCode
                                ? l10n.authOtpSentTo(
                                  '${AuthValidators.countryCode} ${_phoneController.text}',
                                )
                                : l10n.authLoginSubtitle,
                        center: true,
                      ),
                      const SizedBox(height: T.s8),

                      if (!onCode) ...[
                        AuthField(
                          label: l10n.authPhoneLabel,
                          child: TextFormField(
                            controller: _phoneController,
                            keyboardType: TextInputType.phone,
                            autofillHints: const [
                              AutofillHints.telephoneNumber,
                            ],
                            style: T.body.copyWith(color: T.ink),
                            // +91 is fixed and the patient types only the 10
                            // national digits.
                            //
                            // Capped by a formatter rather than maxLength.
                            // maxLength enforces AFTER the formatters and
                            // rewrites the whole value, which resets the
                            // selection — so tapping into the middle of a full
                            // number and typing threw the cursor to the end.
                            // The formatter preserves the caret. Exactly one
                            // limiter, always: two of them fight and
                            // reintroduce the jump.
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(10),
                            ],
                            decoration: AuthField.decoration(
                              hint: l10n.authPhoneHint,
                              prefixText: '${AuthValidators.countryCode} ',
                            ),
                            onFieldSubmitted: (_) => _sendCode(),
                            validator: (value) {
                              if (value == null ||
                                  !AuthValidators.isValidPhone(value)) {
                                return l10n.authInvalidPhone;
                              }
                              return null;
                            },
                          ),
                        ),
                      ] else ...[
                        AuthField(
                          label: l10n.authOtpLabel,
                          child: OtpCodeField(
                            controller: _codeController,
                            hasError: _errorMessage != null,
                            enabled: !_isSubmitting,
                            onCompleted: (_) => _verify(),
                          ),
                        ),
                        const SizedBox(height: T.s5),
                        OtpResendTimer(
                          key: _resendKey,
                          seconds: _sent?.resendAfterSeconds ?? 45,
                          onResend: () => _sendCode(resend: true),
                          waitingLabel: l10n.authOtpResendIn,
                          resendLabel: l10n.authOtpResend,
                        ),
                        // Only ever true off production, where the server has
                        // no SMS credentials. Said plainly, because a tester
                        // who is not told sits waiting for a message that was
                        // never sent.
                        if (_sent?.simulated ?? false) ...[
                          const SizedBox(height: T.s4),
                          _Notice(message: l10n.authOtpSimulated),
                        ],
                      ],

                      if (_errorMessage != null) ...[
                        const SizedBox(height: T.s5),
                        InlineError(message: _errorMessage!),
                        if (_offerRegister) ...[
                          const SizedBox(height: T.s3),
                          Center(
                            child: TextButton(
                              onPressed: () => context.go('/register'),
                              style: TextButton.styleFrom(
                                foregroundColor: T.primary,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: T.s4,
                                  vertical: T.s3,
                                ),
                              ),
                              child: Text(
                                l10n.authGoToRegister,
                                style: T.small.copyWith(
                                  color: T.primary,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
              ),

              // The action sits against the bottom of the screen rather than
              // after the last field: it is always in the same place and
              // always in reach, whatever the form above it is doing.
              Padding(
                padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s4),
                child: Column(
                  children: [
                    PillButton(
                      label:
                          onCode
                              ? l10n.authOtpVerifyButton
                              : l10n.authOtpSendButton,
                      loading: _isSubmitting,
                      onPressed: onCode ? _verify : _sendCode,
                    ),
                    const SizedBox(height: T.s3),
                    if (onCode)
                      _LinkRow(
                        label: l10n.authOtpChangeNumber,
                        onTap: _backToPhone,
                      )
                    else ...[
                      // Wraps rather than a Row: two texts side by side fit
                      // in English and overflow in Hindi, where the same
                      // sentence is half again as long.
                      Wrap(
                        alignment: WrapAlignment.center,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            l10n.authNoAccount,
                            style: T.small.copyWith(color: T.inkMuted),
                          ),
                          const SizedBox(width: T.s1),
                          GestureDetector(
                            onTap: () => context.go('/register'),
                            child: Padding(
                              // Padding, not a bare tap: the words alone are a
                              // 16px-tall target.
                              padding: const EdgeInsets.symmetric(
                                vertical: T.s2,
                              ),
                              child: Text(
                                l10n.authGoToRegister,
                                style: T.small.copyWith(
                                  color: T.primary,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      // Quiet on purpose. One doctor uses this and every
                      // patient does not; giving it equal weight would put a
                      // password in front of everyone who has none.
                      _LinkRow(
                        label: l10n.authDoctorPasswordLink,
                        muted: true,
                        onTap: () => context.push('/login/password'),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A centred text link with a real tap target.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.label,
    required this.onTap,
    this.muted = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(
          foregroundColor: muted ? T.inkMuted : T.primary,
          padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: T.small.copyWith(
            color: muted ? T.inkMuted : T.primary,
            fontWeight: muted ? FontWeight.w600 : FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// A neutral aside — something true about the environment rather than
/// something the reader did wrong, so it does not take the error colour.
class _Notice extends StatelessWidget {
  const _Notice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(T.s3),
      decoration: BoxDecoration(
        color: T.warningTint,
        borderRadius: BorderRadius.circular(T.rControl),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, size: 18, color: T.warning),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(message, style: T.small.copyWith(color: T.warning)),
          ),
        ],
      ),
    );
  }
}
