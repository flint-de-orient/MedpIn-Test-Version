import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // FilteringTextInputFormatter, LengthLimitingTextInputFormatter
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../core/utils/vitals_validators.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers/locale_provider.dart';
import '../../../shared/widgets/auth_kit.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/otp_field.dart';
import '../data/auth_repository.dart';
import 'auth_controller.dart';

/// One registration screen that changes shape rather than two of them.
///
/// The order is the whole design. The number is verified first, because a
/// number that already has an account has to be caught before anyone fills in
/// a form they cannot submit. The invite code comes second, because it decides
/// which fields the rest of the screen is going to ask for — asked at the end,
/// as it used to be, it meant a dietician answered a page of clinical
/// questions that were never going to be stored.
///
/// No progress bar: this is one page, and a bar that only ever reads "1 of 2"
/// was measuring a wizard that no longer exists. No password either — the
/// account is opened by a texted code and signed into the same way, and a
/// credential nobody uses is a credential to lose.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _emailController = TextEditingController();
  final _addressController = TextEditingController();
  final _heightController = TextEditingController();
  final _weightController = TextEditingController();
  final _systolicController = TextEditingController();
  final _diastolicController = TextEditingController();
  final _pulseController = TextEditingController();
  final _spo2Controller = TextEditingController();
  final _sugarController = TextEditingController();
  final _complaintsController = TextEditingController();
  final _inviteController = TextEditingController();
  final _resendKey = GlobalKey<OtpResendTimerState>();

  /// Errors stay hidden until the first submit attempt. `onUserInteraction`
  /// validates the *whole* form as soon as any single field is touched, so
  /// typing the first character of a name turned every remaining field red
  /// while the patient was still filling it in. After a failed submit this
  /// flips to live validation so corrections clear as they are made.
  AutovalidateMode _autovalidateMode = AutovalidateMode.disabled;

  DateTime? _dateOfBirth;
  String? _gender;
  bool _isSubmitting = false;
  String? _errorMessage;

  // ---- phone verification --------------------------------------------------

  /// True once a code has been sent and the boxes are on screen.
  bool _codeSent = false;

  /// Set by the server when the code is spent. Its presence is what "this
  /// number is theirs" means from here on — the number itself is read out of
  /// the token server-side, so nothing on this screen can change it after the
  /// fact.
  String? _phoneToken;

  bool _sendingCode = false;
  String? _phoneError;
  OtpSent? _sent;

  bool get _phoneVerified => _phoneToken != null;

  // ---- invite code ---------------------------------------------------------

  bool _checkingInvite = false;
  String? _inviteError;

  /// The role the accepted code opens, or null while none has been accepted.
  ///
  /// The one thing that decides which form this is, and it comes from the
  /// server — never from anything the reader typed. The server decides again
  /// from the code itself when the account is made, so a client that lied here
  /// would only have lied to itself about which fields to show.
  String? _invitedRole;

  bool get _inviteVerified => _invitedRole != null;

  /// True for a dietician OR a receptionist: neither has a diabetes record, so
  /// neither is asked for one.
  bool get _isClinicRole => _invitedRole != null;

  String get _roleLabel => _invitedRole == 'staff' ? 'Front desk' : 'Dietician';

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _codeController.dispose();
    _emailController.dispose();
    _addressController.dispose();
    _heightController.dispose();
    _weightController.dispose();
    _systolicController.dispose();
    _diastolicController.dispose();
    _pulseController.dispose();
    _spo2Controller.dispose();
    _sugarController.dispose();
    _complaintsController.dispose();
    _inviteController.dispose();
    super.dispose();
  }

  String get _e164 => AuthValidators.toE164(_phoneController.text);

  Future<void> _pickDateOfBirth() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 45, now.month, now.day),
      firstDate: DateTime(now.year - 110),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateOfBirth = picked);
  }

  // ---- step one ------------------------------------------------------------

  Future<void> _sendCode({bool resend = false}) async {
    final l10n = AppLocalizations.of(context);
    if (!AuthValidators.isValidPhone(_phoneController.text)) {
      setState(() => _phoneError = l10n.authInvalidPhone);
      return;
    }
    setState(() {
      _sendingCode = true;
      _phoneError = null;
    });

    final result = await ref
        .read(authControllerProvider.notifier)
        .requestOtp(phone: _e164, purpose: 'register');

    if (!mounted) return;
    setState(() => _sendingCode = false);

    final error = result.error;
    if (error != null) {
      setState(() {
        // The one failure with somewhere to go: this number already has an
        // account, so the answer is to sign in rather than to try again.
        _phoneError =
            error.code == 'CONFLICT'
                ? l10n.authAlreadyRegistered
                : ErrorView.messageFor(context, error);
      });
      return;
    }

    setState(() {
      _sent = result.sent;
      _codeController.clear();
      _codeSent = true;
    });
    if (resend) {
      _resendKey.currentState?.restart(result.sent!.resendAfterSeconds);
    }
  }

  Future<void> _verifyCode() async {
    final l10n = AppLocalizations.of(context);
    if (_codeController.text.length < 6) {
      setState(() => _phoneError = l10n.authOtpIncomplete);
      return;
    }
    setState(() {
      _sendingCode = true;
      _phoneError = null;
    });

    try {
      final token = await ref
          .read(authRepositoryProvider)
          .verifyRegisterOtp(phone: _e164, code: _codeController.text);
      if (!mounted) return;
      setState(() {
        _phoneToken = token;
        _codeSent = false;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(
        () =>
            _phoneError =
                e is Exception
                    ? ErrorView.messageFor(context, e)
                    : l10n.commonSomethingWentWrong,
      );
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  /// Back to an unverified number. Drops the token with it — a token issued
  /// for one number must not travel to another.
  void _changeNumber() {
    setState(() {
      _phoneToken = null;
      _codeSent = false;
      _codeController.clear();
      _phoneError = null;
    });
  }

  // ---- step two ------------------------------------------------------------

  Future<void> _validateInvite() async {
    final l10n = AppLocalizations.of(context);
    final code = _inviteController.text.trim();
    if (code.isEmpty) return;

    setState(() {
      _checkingInvite = true;
      _inviteError = null;
    });
    try {
      final role = await ref
          .read(authRepositoryProvider)
          .validateInviteCode(code);
      if (!mounted) return;
      setState(() => _invitedRole = role);
    } on Object {
      if (!mounted) return;
      setState(() {
        _invitedRole = null;
        _inviteError = l10n.authInviteInvalid;
      });
    } finally {
      if (mounted) setState(() => _checkingInvite = false);
    }
  }

  void _clearInvite() {
    setState(() {
      _invitedRole = null;
      _inviteError = null;
      _inviteController.clear();
    });
  }

  // ---- submit --------------------------------------------------------------

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!_phoneVerified) {
      setState(() => _errorMessage = l10n.authVerifyFirst);
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) {
      // First failed submit: from here on, errors track typing so a corrected
      // field clears immediately instead of waiting for another submit.
      setState(() => _autovalidateMode = AutovalidateMode.onUserInteraction);
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    final language = ref.read(localeControllerProvider)?.languageCode ?? 'en';
    final error = await ref
        .read(authControllerProvider.notifier)
        .register(
          name: _nameController.text.trim(),
          phoneToken: _phoneToken!,
          email:
              _emailController.text.trim().isEmpty
                  ? null
                  : _emailController.text.trim(),
          language: language,
          // The clinical intake is a patient's. A dietician's account carries
          // none of it, and sending it would have the server store a diabetes
          // record against a clinician.
          dateOfBirth:
              _isClinicRole || _dateOfBirth == null
                  ? null
                  : '${_dateOfBirth!.year.toString().padLeft(4, '0')}-'
                      '${_dateOfBirth!.month.toString().padLeft(2, '0')}-'
                      '${_dateOfBirth!.day.toString().padLeft(2, '0')}',
          gender: _isClinicRole ? null : _gender,
          address:
              _isClinicRole || _addressController.text.trim().isEmpty
                  ? null
                  : _addressController.text.trim(),
          heightCm:
              _isClinicRole
                  ? null
                  : double.tryParse(_heightController.text.trim()),
          weightKg:
              _isClinicRole
                  ? null
                  : double.tryParse(_weightController.text.trim()),
          systolic:
              _isClinicRole
                  ? null
                  : int.tryParse(_systolicController.text.trim()),
          diastolic:
              _isClinicRole
                  ? null
                  : int.tryParse(_diastolicController.text.trim()),
          pulse:
              _isClinicRole ? null : int.tryParse(_pulseController.text.trim()),
          spo2:
              _isClinicRole ? null : int.tryParse(_spo2Controller.text.trim()),
          glucoseMgDl:
              _isClinicRole ? null : int.tryParse(_sugarController.text.trim()),
          complaints:
              _isClinicRole || _complaintsController.text.trim().isEmpty
                  ? null
                  : _complaintsController.text.trim(),
          inviteCode: _inviteVerified ? _inviteController.text.trim() : null,
          // Deliberately not sent from this screen — diabetes type is no
          // longer collected at signup. The server therefore applies its
          // `.default('type2')`, so it must be confirmed with the patient
          // before any type-dependent advice is relied on. The repository
          // still accepts the field for whichever screen collects it later.
        );
    if (!mounted) return;
    setState(() => _isSubmitting = false);
    if (error != null) {
      setState(() => _errorMessage = ErrorView.messageFor(context, error));
    }
  }

  /// An optional numeric vitals field with a unit suffix and a range validator.
  Widget _vital(
    TextEditingController c,
    String label,
    String unit,
    String? Function(String?) validator, {
    bool integer = false,
  }) {
    return AuthField(
      label: label,
      child: TextFormField(
        controller: c,
        keyboardType: TextInputType.numberWithOptions(decimal: !integer),
        style: T.body.copyWith(color: T.ink),
        inputFormatters: [
          integer
              ? FilteringTextInputFormatter.digitsOnly
              : FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
          LengthLimitingTextInputFormatter(6),
        ],
        decoration: AuthField.decoration(hint: unit),
        validator: validator,
      ),
    );
  }

  Widget _section(String title, {String? note}) => Padding(
    padding: const EdgeInsets.only(top: T.s8, bottom: T.s4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text(title, style: T.title.copyWith(color: T.ink)),
        if (note != null) ...[
          const SizedBox(width: T.s2),
          Text(note, style: T.small.copyWith(color: T.inkFaint)),
        ],
      ],
    ),
  );

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
                padding: const EdgeInsets.fromLTRB(T.s3, T.s2, T.s5, 0),
                child: Row(
                  children: [CircleBack(onTap: () => context.go('/login'))],
                ),
              ),

              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(T.s5, T.s4, T.s5, T.s8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ScreenHeading(
                        // Names itself once it knows what it is. Before the
                        // code is validated there is nothing to claim.
                        // Named for the role the code opened, so a
                        // receptionist is not told they are registering as a
                        // dietician.
                        title:
                            _isClinicRole
                                ? '$_roleLabel registration'
                                : l10n.authRegisterTitle,
                        subtitle:
                            _isClinicRole ? null : l10n.authRegisterSubtitle,
                      ),

                      // No section heading over either of these. Each holds
                      // one labelled field, so a heading above it said the
                      // same words twice — "Your phone number" over a field
                      // labelled "Phone number", and "Have an invite code?"
                      // over a field labelled "Have an invite code?".
                      const SizedBox(height: T.s8),
                      _phoneBlock(l10n),
                      const SizedBox(height: T.s8),
                      _inviteBlock(l10n),

                      // Everything below is a form nobody can submit until the
                      // number is theirs, so it stays out of the way until it
                      // is. The alternative — a full page of fields greyed out
                      // — reads as broken rather than as not-yet.
                      if (_phoneVerified) ...[
                        _section('Your details'),

                        AuthField(
                          label: l10n.authNameLabel,
                          child: TextFormField(
                            controller: _nameController,
                            textCapitalization: TextCapitalization.words,
                            style: T.body.copyWith(color: T.ink),
                            decoration: AuthField.decoration(hint: 'Full name'),
                            // The server enforces a 2-character minimum; mirror
                            // it here so a single-letter name fails locally
                            // instead of costing a round trip.
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return l10n.commonRequiredField;
                              }
                              if (v.trim().length <
                                  AuthValidators.minNameLength) {
                                return l10n.authNameTooShort;
                              }
                              if (v.trim().length >
                                  AuthValidators.maxNameLength) {
                                return l10n.authNameTooLong;
                              }
                              return null;
                            },
                          ),
                        ),
                        const SizedBox(height: T.s5),

                        AuthField(
                          label: l10n.authEmailLabel,
                          child: TextFormField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            style: T.body.copyWith(color: T.ink),
                            decoration: AuthField.decoration(hint: 'Optional'),
                            // Optional field — but if they typed something, the
                            // server will reject anything that is not real.
                            validator:
                                (v) =>
                                    (v == null ||
                                            v.trim().isEmpty ||
                                            AuthValidators.isValidEmail(v))
                                        ? null
                                        : l10n.authInvalidEmail,
                          ),
                        ),

                        // ---- patient-only from here ------------------------
                        if (!_isClinicRole) ...[
                          _section('About you'),

                          // A plain InkWell cannot participate in Form
                          // validation, so the date sits inside a FormField
                          // that owns the error state.
                          FormField<DateTime>(
                            initialValue: _dateOfBirth,
                            validator: (v) {
                              if (v == null) {
                                return l10n.authDateOfBirthRequired;
                              }
                              if (!AuthValidators.isPlausibleDateOfBirth(v)) {
                                return l10n.authDateOfBirthTooYoung;
                              }
                              return null;
                            },
                            builder:
                                (field) => AuthField(
                                  label: l10n.authDateOfBirthLabel,
                                  child: InkWell(
                                    onTap: () async {
                                      await _pickDateOfBirth();
                                      field.didChange(_dateOfBirth);
                                    },
                                    borderRadius: BorderRadius.circular(
                                      T.rCard,
                                    ),
                                    child: InputDecorator(
                                      decoration: AuthField.decoration(
                                        suffix: const Icon(
                                          Icons.calendar_today_outlined,
                                          size: 20,
                                          color: T.inkMuted,
                                        ),
                                      ).copyWith(errorText: field.errorText),
                                      child: Text(
                                        _dateOfBirth == null
                                            ? 'Select date'
                                            : '${_dateOfBirth!.day.toString().padLeft(2, '0')}'
                                                '/${_dateOfBirth!.month.toString().padLeft(2, '0')}'
                                                '/${_dateOfBirth!.year}',
                                        style: T.body.copyWith(
                                          color:
                                              _dateOfBirth == null
                                                  ? T.inkFaint
                                                  : T.ink,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                          ),
                          const SizedBox(height: T.s5),

                          AuthField(
                            label: l10n.authGenderLabel,
                            child: DropdownButtonFormField<String>(
                              initialValue: _gender,
                              // Sizes to the widest item without this, which
                              // on a narrow phone clips the child away and
                              // leaves a chevron over an empty box.
                              isExpanded: true,
                              style: T.body.copyWith(color: T.ink),
                              icon: const Icon(
                                Icons.keyboard_arrow_down_rounded,
                                color: T.inkMuted,
                              ),
                              decoration: AuthField.decoration(hint: 'Select'),
                              // The server also accepts 'undisclosed' (and
                              // defaults to it), but the form does not offer
                              // it — the field is required, so a patient always
                              // picks one of these three explicitly.
                              items: [
                                DropdownMenuItem(
                                  value: 'male',
                                  child: Text(l10n.authGenderMale),
                                ),
                                DropdownMenuItem(
                                  value: 'female',
                                  child: Text(l10n.authGenderFemale),
                                ),
                                DropdownMenuItem(
                                  value: 'other',
                                  child: Text(l10n.authGenderOther),
                                ),
                              ],
                              validator:
                                  (v) =>
                                      v == null
                                          ? l10n.authGenderRequired
                                          : null,
                              onChanged: (v) => setState(() => _gender = v),
                            ),
                          ),
                          const SizedBox(height: T.s5),

                          AuthField(
                            label: 'Address',
                            child: TextFormField(
                              controller: _addressController,
                              textCapitalization: TextCapitalization.sentences,
                              minLines: 2,
                              maxLines: 3,
                              style: T.body.copyWith(color: T.ink),
                              decoration: AuthField.decoration(
                                hint: 'Where you live',
                              ),
                              validator:
                                  (v) =>
                                      (v == null || v.trim().isEmpty)
                                          ? 'Enter your address'
                                          : null,
                            ),
                          ),

                          _section('Health details', note: 'optional'),

                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: _vital(
                                  _heightController,
                                  'Height',
                                  'cm',
                                  VitalsValidators.height,
                                ),
                              ),
                              const SizedBox(width: T.s3),
                              Expanded(
                                child: _vital(
                                  _weightController,
                                  'Weight',
                                  'kg',
                                  VitalsValidators.weight,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: T.s5),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: _vital(
                                  _systolicController,
                                  'BP systolic',
                                  'mmHg',
                                  VitalsValidators.systolic,
                                  integer: true,
                                ),
                              ),
                              const SizedBox(width: T.s3),
                              Expanded(
                                child: _vital(
                                  _diastolicController,
                                  'BP diastolic',
                                  'mmHg',
                                  (v) => VitalsValidators.diastolic(
                                    v,
                                    systolicText: _systolicController.text,
                                  ),
                                  integer: true,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: T.s5),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: _vital(
                                  _pulseController,
                                  'Heart rate',
                                  'bpm',
                                  VitalsValidators.pulse,
                                  integer: true,
                                ),
                              ),
                              const SizedBox(width: T.s3),
                              Expanded(
                                child: _vital(
                                  _spo2Controller,
                                  'SpO₂',
                                  '%',
                                  VitalsValidators.spo2,
                                  integer: true,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: T.s5),
                          _vital(
                            _sugarController,
                            'Blood sugar',
                            'mg/dL',
                            VitalsValidators.sugar,
                            integer: true,
                          ),

                          _section('Anything else', note: 'optional'),

                          AuthField(
                            label: 'Main complaint',
                            child: TextFormField(
                              controller: _complaintsController,
                              textCapitalization: TextCapitalization.sentences,
                              minLines: 2,
                              maxLines: 3,
                              style: T.body.copyWith(color: T.ink),
                              decoration: AuthField.decoration(
                                hint: 'What brings you to the clinic',
                              ),
                            ),
                          ),
                        ],
                      ],

                      if (_errorMessage != null) ...[
                        const SizedBox(height: T.s6),
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
                      label: l10n.authRegisterButton,
                      loading: _isSubmitting,
                      // Disabled until the number is theirs, and the section
                      // above says why rather than leaving a dead button to
                      // be worked out.
                      onPressed: _phoneVerified ? _submit : null,
                    ),
                    const SizedBox(height: T.s4),
                    // Wraps rather than a Row.
                    //
                    // Two texts side by side is a Row that fits in English and
                    // overflows in Hindi, where the same sentence is half again
                    // as long. A Wrap puts the link on its own line instead of
                    // running it off the edge.
                    Wrap(
                      alignment: WrapAlignment.center,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          l10n.authHaveAccount,
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                        const SizedBox(width: T.s1),
                        GestureDetector(
                          onTap: () => context.go('/login'),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: T.s2),
                            child: Text(
                              l10n.authGoToLogin,
                              style: T.small.copyWith(
                                color: T.primary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
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

  // ---- the two blocks at the top ------------------------------------------

  Widget _phoneBlock(AppLocalizations l10n) {
    if (_phoneVerified) {
      return _VerifiedRow(
        value: '${AuthValidators.countryCode} ${_phoneController.text}',
        badge: l10n.authPhoneVerified,
        actionLabel: l10n.authOtpChangeNumber,
        onAction: _changeNumber,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AuthField(
          label: l10n.authPhoneLabel,
          child: TextFormField(
            controller: _phoneController,
            enabled: !_codeSent,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            style: T.body.copyWith(color: T.ink),
            // One limiter, in the formatters. maxLength enforces after them
            // and rewrites the value, resetting the caret to the end mid-edit.
            // See the login screen.
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(10),
            ],
            decoration: AuthField.decoration(
              hint: l10n.authPhoneHint,
              prefixText: '${AuthValidators.countryCode} ',
            ),
          ),
        ),
        const SizedBox(height: T.s3),
        // Under the field, not beside it.
        //
        // Beside it, the field was an Expanded sharing a Row with a button
        // whose label is one word in English and three in Hindi — and the app
        // theme gives every OutlinedButton a minimum width of infinity, so the
        // button took the whole row and the field collapsed to the width of a
        // single character. Stacked, there is nothing to share and nothing to
        // lose, in any language and at any text size.
        Align(
          alignment: Alignment.centerRight,
          child: _InlineAction(
            label:
                _codeSent
                    ? l10n.authOtpVerifyButton
                    : l10n.authVerifyPhoneButton,
            busy: _sendingCode,
            onPressed: _codeSent ? _verifyCode : _sendCode,
          ),
        ),

        if (_codeSent) ...[
          const SizedBox(height: T.s4),
          Text(
            l10n.authOtpSentTo(
              '${AuthValidators.countryCode} ${_phoneController.text}',
            ),
            style: T.small.copyWith(color: T.inkMuted),
          ),
          const SizedBox(height: T.s3),
          OtpCodeField(
            controller: _codeController,
            hasError: _phoneError != null,
            enabled: !_sendingCode,
            onCompleted: (_) => _verifyCode(),
          ),
          const SizedBox(height: T.s4),
          OtpResendTimer(
            key: _resendKey,
            seconds: _sent?.resendAfterSeconds ?? 45,
            onResend: () => _sendCode(resend: true),
            waitingLabel: l10n.authOtpResendIn,
            resendLabel: l10n.authOtpResend,
          ),
          if (_sent?.simulated ?? false) ...[
            const SizedBox(height: T.s3),
            Text(
              l10n.authOtpSimulated,
              style: T.small.copyWith(color: T.warning),
            ),
          ],
        ],

        if (_phoneError != null) ...[
          const SizedBox(height: T.s4),
          InlineError(message: _phoneError!),
          // The number is taken. The way out is the login screen, so it is
          // offered here rather than left to be found.
          if (_phoneError == l10n.authAlreadyRegistered) ...[
            const SizedBox(height: T.s2),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => context.go('/login'),
                style: TextButton.styleFrom(
                  foregroundColor: T.primary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: T.s3,
                    vertical: T.s3,
                  ),
                ),
                child: Text(
                  l10n.authGoToLogin,
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
    );
  }

  Widget _inviteBlock(AppLocalizations l10n) {
    if (_inviteVerified) {
      return _VerifiedRow(
        value: _inviteController.text.trim(),
        badge: l10n.authInviteVerified,
        actionLabel: l10n.authInviteRemove,
        onAction: _clearInvite,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AuthField(
          label: l10n.authInviteLabel,
          child: TextFormField(
            controller: _inviteController,
            textCapitalization: TextCapitalization.characters,
            style: T.body.copyWith(color: T.ink),
            decoration: AuthField.decoration(hint: l10n.authInviteHint),
            onFieldSubmitted: (_) => _validateInvite(),
          ),
        ),
        const SizedBox(height: T.s2),
        Text(l10n.authInviteHelper, style: T.small.copyWith(color: T.inkFaint)),
        const SizedBox(height: T.s3),
        Align(
          alignment: Alignment.centerRight,
          child: _InlineAction(
            label: l10n.authInviteValidateButton,
            busy: _checkingInvite,
            onPressed: _validateInvite,
          ),
        ),
        if (_inviteError != null) ...[
          const SizedBox(height: T.s3),
          InlineError(message: _inviteError!),
        ],
      ],
    );
  }
}

/// The short action that belongs to the field above it.
///
/// Sets its own [ButtonStyle.minimumSize]. The app theme gives every
/// OutlinedButton `Size.fromHeight(52)`, which is `Size(double.infinity, 52)`
/// — a minimum *width* of infinity. That is right for a button that owns its
/// row and catastrophic for one that shares it: in a Row beside an Expanded
/// field, the button claimed the whole width and the field rendered one
/// character wide, its label running down the screen a letter at a time.
class _InlineAction extends StatelessWidget {
  const _InlineAction({
    required this.label,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: busy ? null : onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: T.primary,
        side: const BorderSide(color: T.primary),
        // Wide enough to read as a button, tall enough to hit, and shrink-
        // wrapping past that rather than filling whatever it is put in.
        minimumSize: const Size(112, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rCard),
        ),
      ),
      child:
          busy
              ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2.2),
              )
              : Text(
                label,
                style: T.small.copyWith(
                  color: T.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
    );
  }
}

/// A settled step: what was entered, a word saying it is confirmed, and the
/// way to undo it.
///
/// The word matters as much as the tick — this clinic's patients include
/// people with red-green colour deficiency, and a green check on its own says
/// nothing to them.
///
/// The undo sits under the value rather than beside it, for the same reason
/// the Verify button does: "Use a different number" is three words in English
/// and more in Hindi, and a Row cannot hold both without one of them losing.
class _VerifiedRow extends StatelessWidget {
  const _VerifiedRow({
    required this.value,
    required this.badge,
    required this.actionLabel,
    required this.onAction,
  });

  final String value;
  final String badge;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s2),
      decoration: BoxDecoration(
        color: T.successTint,
        borderRadius: BorderRadius.circular(T.rControl),
        border: Border.all(color: T.success.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.check_circle_rounded,
                size: 20,
                color: T.success,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(value, style: T.bodyStrong.copyWith(color: T.ink)),
                    const SizedBox(height: 2),
                    Text(badge, style: T.small.copyWith(color: T.success)),
                  ],
                ),
              ),
            ],
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: T.primary,
                padding: const EdgeInsets.symmetric(
                  horizontal: T.s3,
                  vertical: T.s3,
                ),
              ),
              child: Text(
                actionLabel,
                style: T.small.copyWith(
                  color: T.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
