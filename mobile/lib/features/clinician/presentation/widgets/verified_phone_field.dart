import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/utils/auth_validators.dart';
import '../../../auth/presentation/auth_controller.dart';

/// A phone number, and proof that somebody answered it.
///
/// ---- Why a clinical account needs this ------------------------------------
///
/// The doctor used to type a colleague's number into a plain field, and the
/// server checked it against a regex — which tests the shape of a phone number
/// and nothing about who holds it. One mistyped digit produced a working
/// clinical account bound to a stranger's handset, and because login sends a
/// code to whatever number is on the account, that stranger could sign in. A
/// dietician with no explicit assignments reads every patient record in the
/// clinic.
///
/// That was survivable while an invite code existed alongside it. It is not
/// now: creating an account here is the only way a clinical login comes into
/// being, so the whole question of who gets into this clinic rested on ten
/// digits being typed correctly.
///
/// The colleague is in front of the doctor, or on the phone. Their handset
/// buzzes, they read out six digits, and a typo fails as "no code arrived"
/// instead of succeeding silently against somebody else's number.
///
/// ---- One widget, three sheets ---------------------------------------------
///
/// Adding a dietician, adding a receptionist, and adding a dietician from
/// inside a patient's record all need exactly this. Written three times it
/// would drift three ways, and the half that drifts is the half that decides
/// whether the number was checked at all.
class VerifiedPhoneField extends ConsumerStatefulWidget {
  const VerifiedPhoneField({super.key, required this.onToken, this.label});

  /// The proof, or null whenever the number is not (or no longer) verified.
  ///
  /// Null on every edit, deliberately: a token belongs to the number it was
  /// issued for, and a form that keeps one while the field is retyped would
  /// create the account against the old number.
  final ValueChanged<String?> onToken;

  final String? label;

  @override
  ConsumerState<VerifiedPhoneField> createState() => _VerifiedPhoneFieldState();
}

class _VerifiedPhoneFieldState extends ConsumerState<VerifiedPhoneField> {
  final _phone = TextEditingController();
  final _code = TextEditingController();

  bool _sending = false;
  bool _verifying = false;
  bool _sent = false;
  bool _verified = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String get _e164 => '${AuthValidators.countryCode}${_phone.text.trim()}';

  Future<void> _send() async {
    final digits = _phone.text.trim();
    if (!AuthValidators.isValidPhone(digits)) {
      setState(() => _error = 'Enter a 10-digit number.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      // `register`, not a purpose of its own. It is the right one: it refuses
      // a number that already has an account — which is the other way this
      // form goes wrong — and it ends in the phone token the server wants.
      await ref
          .read(authRepositoryProvider)
          .requestOtp(phone: _e164, purpose: 'register');
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      setState(() {
        _error =
            e is ApiException
                ? e.message
                : 'Could not send the code. Please try again.';
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      final token = await ref
          .read(authRepositoryProvider)
          .verifyRegisterOtp(phone: _e164, code: _code.text.trim());
      widget.onToken(token);
      if (mounted) setState(() => _verified = true);
    } catch (e) {
      setState(() {
        _error =
            e is ApiException ? e.message : 'That code did not work.';
      });
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  void _change() {
    // The token goes with the number it belonged to.
    widget.onToken(null);
    setState(() {
      _verified = false;
      _sent = false;
      _code.clear();
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (_verified) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.success.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.success.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.verified_rounded,
              size: 18,
              color: AppColors.success,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _e164,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            TextButton(onPressed: _change, child: const Text('Change')),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _phone,
          enabled: !_sent,
          keyboardType: TextInputType.phone,
          maxLength: 10,
          decoration: InputDecoration(
            labelText: widget.label ?? 'Their phone number',
            prefixText: '${AuthValidators.countryCode} ',
            counterText: '',
            helperText:
                _sent
                    ? null
                    : 'They will get a code to read back to you.',
          ),
        ),
        if (_sent) ...[
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Code from their phone',
              counterText: '',
            ),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(
            _error!,
            style: TextStyle(fontSize: 12.5, color: AppColors.dangerOn(context)),
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            if (_sent)
              // Expanded, not bare. The theme gives filled buttons a minimum
              // width of infinity, and one of those in a Row flattens whatever
              // it shares the row with.
              Expanded(
                child: TextButton(
                  onPressed: _sending || _verifying ? null : _change,
                  child: const Text('Change number'),
                ),
              ),
            Expanded(
              child: FilledButton(
                onPressed:
                    _sending || _verifying ? null : (_sent ? _verify : _send),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
                child:
                    _sending || _verifying
                        ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.2,
                            color: Colors.white,
                          ),
                        )
                        : Text(_sent ? 'Verify' : 'Send code'),
              ),
            ),
          ],
        ),
        if (!_sent)
          Text(
            'The account is created against the number that answers.',
            style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
          ),
      ],
    );
  }
}
