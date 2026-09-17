import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // FilteringTextInputFormatter, LengthLimitingTextInputFormatter
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/auth_kit.dart';
import '../../../shared/widgets/error_view.dart';
import 'auth_controller.dart';

/// Password sign-in, for staff accounts that already have a password.
///
/// A separate screen rather than a second pair of fields on the main one.
/// Everyone else signs in with a texted code and has no password at all;
/// putting a password box in front of them is asking for something they were
/// never given. Reached from a quiet link on the sign-in screen.
///
/// ---- Kept, and not for anybody new ------------------------------------------
///
/// Passwords are no longer set for anybody: the People screen stopped offering
/// one and the server refuses a hire that carries one. Those that exist keep
/// working here until the product owner approves a date to retire them — a
/// counter handset signed in this way must not stop working the morning a
/// release lands. The plan for that date is in deploy/STAGING.md, under "Staff
/// passwords".
class DoctorPasswordLoginScreen extends ConsumerStatefulWidget {
  const DoctorPasswordLoginScreen({super.key});

  @override
  ConsumerState<DoctorPasswordLoginScreen> createState() =>
      _DoctorPasswordLoginScreenState();
}

class _DoctorPasswordLoginScreenState
    extends ConsumerState<DoctorPasswordLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isSubmitting = false;
  bool _obscurePassword = true;
  String? _errorMessage;
  AutovalidateMode _autovalidateMode = AutovalidateMode.disabled;

  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidateMode = AutovalidateMode.onUserInteraction);
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final error = await ref
        .read(authControllerProvider.notifier)
        .login(
          phone: AuthValidators.toE164(_phoneController.text),
          password: _passwordController.text,
        );

    if (!mounted) return;
    setState(() => _isSubmitting = false);
    if (error != null) {
      setState(() {
        _errorMessage =
            error.code == 'UNAUTHORIZED' || error.code == 'BAD_REQUEST'
                ? l10n.authInvalidCredentials
                : ErrorView.messageFor(context, error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      backgroundColor: T.surface,
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: _autovalidateMode,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s5, 0),
                child: Row(children: [CircleBack(onTap: () => context.pop())]),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(T.s5, T.s6, T.s5, T.s6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ScreenHeading(
                        title: l10n.authDoctorPasswordTitle,
                        subtitle: l10n.authDoctorPasswordSubtitle,
                      ),
                      const SizedBox(height: T.s8),

                      AuthField(
                        label: l10n.authPhoneLabel,
                        child: TextFormField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          autofillHints: const [AutofillHints.telephoneNumber],
                          style: T.body.copyWith(color: T.ink),
                          // See the note in LoginScreen: one limiter, and it
                          // is a formatter so the caret survives editing.
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(10),
                          ],
                          decoration: AuthField.decoration(
                            hint: l10n.authPhoneHint,
                            prefixText: '${AuthValidators.countryCode} ',
                          ),
                          validator: (value) {
                            if (value == null ||
                                !AuthValidators.isValidPhone(value)) {
                              return l10n.authInvalidPhone;
                            }
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(height: T.s5),

                      AuthField(
                        label: l10n.authPasswordLabel,
                        child: TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          autofillHints: const [AutofillHints.password],
                          style: T.body.copyWith(color: T.ink),
                          decoration: AuthField.decoration(
                            hint: l10n.authPasswordHint,
                            suffix: IconButton(
                              iconSize: 20,
                              color: T.inkMuted,
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                              tooltip: _obscurePassword ? 'Show' : 'Hide',
                              onPressed:
                                  () => setState(
                                    () => _obscurePassword = !_obscurePassword,
                                  ),
                            ),
                          ),
                          onFieldSubmitted: (_) => _submit(),
                          // Only checks that something was typed. Enforcing a
                          // length minimum here would be wrong twice over: the
                          // server accepts any non-empty password on login, and
                          // telling someone their *existing* password is "too
                          // short" reads as a rule about the account rather
                          // than a typo in the box.
                          validator:
                              (value) =>
                                  (value == null || value.isEmpty)
                                      ? l10n.authPasswordRequired
                                      : null,
                        ),
                      ),

                      if (_errorMessage != null) ...[
                        const SizedBox(height: T.s5),
                        InlineError(message: _errorMessage!),
                      ],
                    ],
                  ),
                ),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s4),
                child: Column(
                  children: [
                    PillButton(
                      label: l10n.authLoginButton,
                      loading: _isSubmitting,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: T.s3),
                    Center(
                      child: TextButton(
                        onPressed: () => context.pop(),
                        style: TextButton.styleFrom(
                          foregroundColor: T.primary,
                          padding: const EdgeInsets.symmetric(
                            horizontal: T.s4,
                            vertical: T.s3,
                          ),
                        ),
                        child: Text(
                          l10n.authUseOtpInstead,
                          textAlign: TextAlign.center,
                          style: T.small.copyWith(
                            color: T.primary,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
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
