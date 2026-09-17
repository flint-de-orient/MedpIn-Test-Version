import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../core/utils/vitals_validators.dart';
import '../../../shared/widgets/error_view.dart';
import '../data/clinician_repository.dart';
import '../domain/patient_registration.dart';
import 'clinician_providers.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../auth/data/auth_repository.dart';
import '../../../shared/widgets/otp_field.dart';
import '../../../core/router/area.dart';
import 'widgets/consent_code_dialog.dart';

/// The receptionist's patient-intake form. Registers a walk-in at the desk:
/// mandatory demographics (name, age, gender, phone, address) plus an optional
/// vitals snapshot and presenting complaint, so the doctor opens a record that
/// is already populated. On success it opens the new patient's profile.
class AddPatientScreen extends ConsumerStatefulWidget {
  const AddPatientScreen({super.key});

  @override
  ConsumerState<AddPatientScreen> createState() => _AddPatientScreenState();
}

class _AddPatientScreenState extends ConsumerState<AddPatientScreen> {
  final _formKey = GlobalKey<FormState>();
  var _autovalidate = AutovalidateMode.disabled;

  final _name = TextEditingController();
  final _age = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _height = TextEditingController();
  final _weight = TextEditingController();
  final _systolic = TextEditingController();
  final _diastolic = TextEditingController();
  final _pulse = TextEditingController();
  final _sugar = TextEditingController();
  final _spo2 = TextEditingController();
  final _complaints = TextEditingController();
  final _code = TextEditingController();

  String? _gender;
  bool _submitting = false;

  // ---- proving the number ---------------------------------------------------
  //
  // The patient is standing at the desk, so the code goes to their phone and
  // they read it out. That is the point: sign-in is a code texted to this
  // number, so a digit mistyped here is an account the patient can never get
  // into — found out weeks later, by them, with nothing to say why.
  //
  // Not compulsory. A flat battery or no signal in the building must not stop
  // a patient being registered, and the clinical record is worth having even
  // when the app login is not yet usable. Unverified is allowed and said out
  // loud, never allowed silently.
  bool _codeSent = false;
  bool _verifying = false;
  String? _phoneToken;
  String? _phoneError;
  OtpSent? _sent;

  bool get _phoneVerified => _phoneToken != null;

  /// The number already has a MedPin account. Registering it texts the patient
  /// a code to add them to this practice; there is nothing to verify here.
  bool _existingAccount = false;

  /// The number the token was issued for, so editing the field after verifying
  /// drops the proof instead of carrying it onto a different patient.
  String? _verifiedNumber;
  String? _error;

  @override
  void dispose() {
    for (final c in [
      _name,
      _age,
      _phone,
      _address,
      _height,
      _weight,
      _systolic,
      _diastolic,
      _pulse,
      _sugar,
      _spo2,
      _complaints,
      _code,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.trim());
  double? _double(TextEditingController c) => double.tryParse(c.text.trim());

  Future<void> _sendCode({bool resend = false}) async {
    if (!AuthValidators.isValidPhone(_phone.text)) {
      setState(() => _phoneError = 'Enter a valid 10-digit number');
      return;
    }
    setState(() {
      _verifying = true;
      _phoneError = null;
    });

    final result = await ref
        .read(authControllerProvider.notifier)
        .requestOtp(
          phone: AuthValidators.toE164(_phone.text),
          purpose: 'register',
        );

    if (!mounted) return;
    setState(() => _verifying = false);

    final error = result.error;
    if (error != null) {
      setState(() {
        // An existing account is not a dead end. It told the doctor to open
        // the patient from their list — where somebody who signed up on their
        // own, or who belongs to another practice, is not.
        if (error.code == 'CONFLICT') {
          _existingAccount = true;
          _phoneError = null;
        } else {
          _phoneError = ErrorView.messageFor(context, error);
        }
      });
      return;
    }
    setState(() {
      _sent = result.sent;
      _code.clear();
      _codeSent = true;
    });
  }

  Future<void> _verifyCode() async {
    if (_code.text.length < 6) {
      setState(() => _phoneError = 'Enter all 6 digits');
      return;
    }
    setState(() {
      _verifying = true;
      _phoneError = null;
    });
    try {
      final token = await ref
          .read(authRepositoryProvider)
          .verifyRegisterOtp(
            phone: AuthValidators.toE164(_phone.text),
            code: _code.text,
          );
      if (!mounted) return;
      setState(() {
        _phoneToken = token;
        _verifiedNumber = _phone.text.trim();
        _codeSent = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _phoneError = ErrorView.messageFor(context, e));
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  /// Drops the proof when the number is edited after being verified.
  void _onPhoneChanged() {
    if (_existingAccount) setState(() => _existingAccount = false);
    if (!_phoneVerified && !_codeSent) return;
    if (_phone.text.trim() == _verifiedNumber) return;
    setState(() {
      _phoneToken = null;
      _verifiedNumber = null;
      _codeSent = false;
      _code.clear();
      _phoneError = null;
    });
  }

  /// Confirms before creating a patient whose number was never proved.
  ///
  /// Stated as the consequence rather than as a warning: "unverified" means
  /// nothing at a busy desk, "may not be able to sign in" is the thing the
  /// receptionist can act on.
  Future<bool> _confirmUnverified() async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Register without verifying?'),
            content: const Text(
              'The patient signs in with a code texted to this number. If it '
              'is wrong they will not be able to sign in, and nobody will know '
              'until they try.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Go back'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Register anyway'),
              ),
            ],
          ),
    );
    return ok ?? false;
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidate = AutovalidateMode.onUserInteraction);
      return;
    }
    // No "they may not be able to sign in" for an existing account: they
    // already can, and the patient confirms the number with the code.
    if (!_phoneVerified && !_existingAccount && !await _confirmUnverified()) return;
    if (!mounted) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(clinicianRepositoryProvider)
          .createPatient(
            name: _name.text.trim(),
            phone: AuthValidators.toE164(_phone.text),
            phoneToken: _phoneToken,
            age: _int(_age),
            gender: _gender,
            address: _address.text.trim(),
            complaints: _complaints.text.trim(),
            heightCm: _double(_height),
            weightKg: _double(_weight),
            systolic: _int(_systolic),
            diastolic: _int(_diastolic),
            pulse: _int(_pulse),
            spo2: _int(_spo2),
            glucoseMgDl: _int(_sugar),
          );
      // The directory must reflect the new patient the moment we return to it.
      ref.invalidate(patientsProvider);
      if (!mounted) return;

      /*
       * Registering a number that already has an account does not enrol it.
       *
       * The practice is reaching for a record it did not create, so the
       * enrolment is written PENDING and grants nothing until the patient
       * reads back a code sent to their own handset. Every clinical list is
       * scoped to active enrolments, so until then they are correctly
       * invisible — and this screen used to say "registered" and walk into
       * their record regardless, which from the counter is indistinguishable
       * from the registration having failed.
       *
       * Nor is the desk told whose account it is until then: the server sends
       * no id and no stored name, so the record to open comes from the
       * confirmation, with the patient's agreement.
       */
      var id = result.id;
      var sharingLine = '';
      if (result.consentRequired) {
        final confirmation = await _takeConsentCode(result);
        if (!mounted) return;
        if (confirmation == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                '${_name.text.trim()} is waiting on their code. They will not '
                'appear in the list until it is entered — register them again '
                'to send a fresh one.',
              ),
              duration: const Duration(seconds: 6),
            ),
          );
          context.pop();
          return;
        }
        // Confirmed: the enrolment is active and the lists can see them now.
        ref.invalidate(patientsProvider);
        ref.invalidate(pendingEnrolmentsProvider);
        id = confirmation.patientId ?? '';
        sharingLine = ' ${confirmation.sharingSummary}';
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${_name.text.trim()} registered.$sharingLine')),
      );
      // Replace the form with the freshly-created record, so Back lands on the
      // patient list rather than an empty form.
      if (id.isNotEmpty) {
        // Where the two roles part company. The doctor lands on the record he
        // has just opened, because his next act is clinical. The desk lands on
        // the roll with the new patient in it: their next act is the next
        // person at the counter, and a receptionist has no business being
        // dropped into somebody's HbA1c history.
        //
        // Sending the desk to /clinician bounced them back to Today with the
        // new patient nowhere in sight, which reads as the registration having
        // failed.
        // Both roles land on the record they just created. The desk used to
        // be dropped on the patient list instead, because /clinician was the
        // only patient route that existed and staff are bounced out of it —
        // so the one thing they had just made was the one thing they could
        // not see. There is a /staff/patients/:id now.
        context.pushReplacement(
          '${areaPrefix(ref)}/patients/$id',
          extra: _name.text.trim(),
        );
      } else {
        context.pop();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = ErrorView.messageFor(context, e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// The code the patient was texted, and their answers about what this clinic
  /// may see, taken at the counter. See [showConsentCodeDialog].
  ///
  /// Returns the confirmation once the enrolment is active, or null.
  Future<EnrolmentConfirmation?> _takeConsentCode(PatientRegistration result) async {
    final id = result.enrollmentId;
    // Nothing to confirm against. The server sends this whenever consent is
    // required, so its absence is a server that has changed shape — say so
    // rather than opening a dialog whose button cannot work.
    if (id == null || id.isEmpty) return null;

    return showConsentCodeDialog(
      context,
      enrollmentId: id,
      title: 'Ask them to read out the code',
      message: result.message.isEmpty
          ? 'This number already has a MedPin account. We have texted it a code — ask the '
              'patient to read it out.'
          : result.message,
    );
  }

  /// How many vitals have been typed. Shown on the collapsed header so a
  /// section that has been filled in does not look skipped.
  int get _vitalsFilled =>
      [
        _height,
        _weight,
        _systolic,
        _diastolic,
        _pulse,
        _spo2,
        _sugar,
      ].where((c) => c.text.trim().isNotEmpty).length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register patient')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: _autovalidate,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.xl,
            ),
            children: [
              const _SectionLabel('Patient details'),
              const SizedBox(height: AppSpacing.sm),
              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Full name',
                  prefixIcon: Icon(Icons.person_outline),
                ),
                validator:
                    (v) =>
                        (v == null || v.trim().length < 2)
                            ? 'Enter the patient\'s name'
                            : null,
              ),
              const SizedBox(height: AppSpacing.md),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _age,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(3),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Age',
                        prefixIcon: Icon(Icons.cake_outlined),
                      ),
                      validator: (v) {
                        final n = int.tryParse((v ?? '').trim());
                        if (n == null) return 'Required';
                        if (n < 0 || n > 120) return '0–120';
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _gender,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Gender',
                        prefixIcon: Icon(Icons.wc_outlined),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'male', child: Text('Male')),
                        DropdownMenuItem(
                          value: 'female',
                          child: Text('Female'),
                        ),
                        DropdownMenuItem(value: 'other', child: Text('Other')),
                      ],
                      validator: (v) => v == null ? 'Required' : null,
                      onChanged: (v) => setState(() => _gender = v),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                enabled: !_codeSent && !_phoneVerified,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                decoration: InputDecoration(
                  labelText: 'Phone',
                  prefixText: '+91 ',
                  prefixIcon: const Icon(Icons.phone_outlined),
                  // The tick is the whole point of this field now, so it lives
                  // in it rather than in a line of text underneath.
                  suffixIcon:
                      _phoneVerified
                          ? const Icon(
                            Icons.check_circle_rounded,
                            color: AppColors.success,
                          )
                          : null,
                ),
                onChanged: (_) => _onPhoneChanged(),
                validator:
                    (v) =>
                        AuthValidators.isValidPhone(v ?? '')
                            ? null
                            : 'Enter a valid 10-digit number',
              ),
              const SizedBox(height: AppSpacing.sm),
              _PhoneVerification(
                verified: _phoneVerified,
                codeSent: _codeSent,
                busy: _verifying,
                codeController: _code,
                error: _phoneError,
                note:
                    _existingAccount
                        ? 'This number already has a MedPin account. Tap Register '
                            'patient — we will text them a code to add them to '
                            'your clinic.'
                        : null,
                simulated: _sent?.simulated ?? false,
                onSend: _sendCode,
                onVerify: _verifyCode,
                onChangeNumber: () {
                  setState(() {
                    _existingAccount = false;
                    _phoneToken = null;
                    _verifiedNumber = null;
                    _codeSent = false;
                    _code.clear();
                    _phoneError = null;
                  });
                },
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _address,
                textCapitalization: TextCapitalization.sentences,
                minLines: 2,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Address',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.home_outlined),
                ),
                validator:
                    (v) =>
                        (v == null || v.trim().isEmpty)
                            ? 'Enter the address'
                            : null,
              ),

              const SizedBox(height: AppSpacing.lg),
              _OptionalSection(
                title: 'Vitals',
                subtitle: 'Height, weight, BP, pulse, SpO₂, blood sugar',
                filled: _vitalsFilled,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _numField(
                          _height,
                          'Height',
                          'cm',
                          VitalsValidators.height,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: _numField(
                          _weight,
                          'Weight',
                          'kg',
                          VitalsValidators.weight,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      Expanded(
                        child: _numField(
                          _systolic,
                          'BP systolic',
                          'mmHg',
                          VitalsValidators.systolic,
                          integer: true,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: _numField(
                          _diastolic,
                          'BP diastolic',
                          'mmHg',
                          (v) => VitalsValidators.diastolic(
                            v,
                            systolicText: _systolic.text,
                          ),
                          integer: true,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      Expanded(
                        child: _numField(
                          _pulse,
                          'Heart rate',
                          'bpm',
                          VitalsValidators.pulse,
                          integer: true,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: _numField(
                          _spo2,
                          'SpO₂',
                          '%',
                          VitalsValidators.spo2,
                          integer: true,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _numField(
                    _sugar,
                    'Blood sugar',
                    'mg/dL',
                    VitalsValidators.sugar,
                    integer: true,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              _OptionalSection(
                title: 'Complaints',
                subtitle: 'What brought them in today',
                filled: _complaints.text.trim().isEmpty ? 0 : 1,
                children: [
                  TextFormField(
                    controller: _complaints,
                    textCapitalization: TextCapitalization.sentences,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: 'Presenting complaint',
                      alignLabelWithHint: true,
                      hintText: 'e.g. increased thirst and fatigue for 2 weeks',
                    ),
                  ),
                ],
              ),

              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.dangerBgOn(context),
                    borderRadius: BorderRadius.circular(
                      AppSpacing.buttonRadius,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        color: AppColors.dangerOn(context),
                        size: 20,
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          _error!,
                          style: TextStyle(color: AppColors.dangerOn(context)),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: AppSpacing.lg),
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon:
                    _submitting
                        ? const SizedBox(
                          width: 16,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                        : const Icon(Icons.person_add_alt_1_rounded),
                label: Text(_submitting ? 'Registering…' : 'Register patient'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  backgroundColor: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// A numeric vitals field with a unit suffix. Optional — never validates,
  /// only constrains the keyboard and character set.
  Widget _numField(
    TextEditingController c,
    String label,
    String unit,
    String? Function(String?) validator, {
    bool integer = false,
  }) {
    return TextFormField(
      controller: c,
      keyboardType: TextInputType.numberWithOptions(decimal: !integer),
      inputFormatters: [
        integer
            ? FilteringTextInputFormatter.digitsOnly
            : FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
        LengthLimitingTextInputFormatter(6),
      ],
      decoration: InputDecoration(labelText: label, suffixText: unit),
      validator: validator,
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.2,
      ),
    );
  }
}

/// An optional part of the form, folded away until it is wanted.
///
/// Registering a walk-in needs a name, a phone number and a login. Vitals and
/// complaints are worth capturing when the desk has them and pure scrolling
/// when it does not — and the form was long enough that the Register button
/// sat well below the fold on every phone. Collapsed by default, with a count
/// on the header so a section somebody has already filled in never looks
/// skipped.
///
/// The children stay mounted while collapsed (Visibility keeps their state), so
/// a value typed and then folded away is still validated and still submitted —
/// hiding a field must never quietly drop what is in it.
class _OptionalSection extends StatefulWidget {
  const _OptionalSection({
    required this.title,
    required this.subtitle,
    required this.filled,
    required this.children,
  });

  final String title;
  final String subtitle;
  final int filled;
  final List<Widget> children;

  @override
  State<_OptionalSection> createState() => _OptionalSectionState();
}

class _OptionalSectionState extends State<_OptionalSection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Re-open on its own if something in here failed validation, otherwise the
    // form would refuse to submit and point at nothing the doctor can see.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => setState(() => _open = !_open),
            borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                widget.title,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              widget.filled > 0
                                  ? '${widget.filled} filled'
                                  : 'optional',
                              style: TextStyle(
                                fontSize: 12,
                                color:
                                    widget.filled > 0
                                        ? AppColors.primary
                                        : scheme.onSurfaceVariant,
                                fontWeight:
                                    widget.filled > 0
                                        ? FontWeight.w700
                                        : FontWeight.w400,
                                fontStyle:
                                    widget.filled > 0
                                        ? FontStyle.normal
                                        : FontStyle.italic,
                              ),
                            ),
                          ],
                        ),
                        if (!_open) ...[
                          const SizedBox(height: 2),
                          Text(
                            widget.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: Icon(
                      Icons.expand_more_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        Visibility(
          visible: _open,
          maintainState: true,
          child: Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: widget.children,
            ),
          ),
        ),
      ],
    );
  }
}

/// Proving the number the patient will sign in with.
///
/// The code goes to the patient's phone and they read it out across the desk.
/// That is what makes this worth doing at registration: sign-in is a code
/// texted to this number, so a digit mistyped here is an account nobody can
/// get into, and the person who finds out is the patient, weeks later, with
/// nothing to tell them why.
class _PhoneVerification extends StatelessWidget {
  const _PhoneVerification({
    required this.verified,
    required this.codeSent,
    required this.busy,
    required this.codeController,
    required this.error,
    this.note,
    required this.simulated,
    required this.onSend,
    required this.onVerify,
    required this.onChangeNumber,
  });

  final bool verified;
  final bool codeSent;
  final bool busy;
  final TextEditingController codeController;
  final String? error;

  /// Something to say about the number that is not an error.
  final String? note;

  /// The server has no SMS credentials and logged the code instead. Only ever
  /// true off production, and said plainly — a receptionist waiting for a
  /// message that was never sent will decide the feature is broken.
  final bool simulated;

  final VoidCallback onSend;
  final VoidCallback onVerify;
  final VoidCallback onChangeNumber;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (verified) {
      return Row(
        children: [
          const Icon(
            Icons.check_circle_rounded,
            size: 18,
            color: AppColors.success,
          ),
          const SizedBox(width: AppSpacing.sm),
          const Expanded(
            child: Text(
              'Number verified — the patient can sign in with it',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.success,
              ),
            ),
          ),
          TextButton(onPressed: onChangeNumber, child: const Text('Change')),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!codeSent) ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  'Send a code to this number and ask the patient to read it '
                  'out. It is how they will sign in.',
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.35,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              OutlinedButton(
                onPressed: busy ? null : onSend,
                // Its own minimum, because the theme gives every
                // OutlinedButton a minimum width of infinity — right for a
                // button that owns its row, ruinous for one sharing it.
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(96, AppSpacing.minTapTarget),
                ),
                child:
                    busy
                        ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2.2),
                        )
                        : const Text('Verify'),
              ),
            ],
          ),
        ] else ...[
          Text(
            'Ask the patient for the 6-digit code just texted to them.',
            style: TextStyle(
              fontSize: 12,
              height: 1.35,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          OtpCodeField(
            controller: codeController,
            enabled: !busy,
            hasError: error != null,
            // Not autofocused: the receptionist is still reading the number
            // back to the patient, and a keyboard over the form is in the way.
            autofocus: false,
            onCompleted: (_) => onVerify(),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              TextButton(
                onPressed: busy ? null : onChangeNumber,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                ),
                child: const Text('Wrong number?'),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Expanded and an explicit minimum, for the reason the whole
              // app has to keep relearning: the theme gives every FilledButton
              // a minimum width of infinity, and a Spacer beside one gets
              // nothing.
              Expanded(
                child: FilledButton(
                  onPressed: busy ? null : onVerify,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, AppSpacing.minTapTarget),
                  ),
                  child: const Text('Confirm'),
                ),
              ),
            ],
          ),
          if (simulated)
            Text(
              'SMS is not set up on this server, so no message was sent. The '
              'code is in the server log.',
              style: TextStyle(fontSize: 12, color: AppColors.warning),
            ),
        ],
        if (error != null || note != null) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            error ?? note!,
            style: TextStyle(
              fontSize: 12,
              color: error != null ? AppColors.danger : AppColors.primary,
            ),
          ),
        ],
      ],
    );
  }
}
