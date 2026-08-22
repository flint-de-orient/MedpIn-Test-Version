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
import 'clinician_providers.dart';

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
  final _password = TextEditingController();

  String? _gender;
  bool _obscure = true;
  bool _submitting = false;
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
      _password,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.trim());
  double? _double(TextEditingController c) => double.tryParse(c.text.trim());

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidate = AutovalidateMode.onUserInteraction);
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final id = await ref
          .read(clinicianRepositoryProvider)
          .createPatient(
            name: _name.text.trim(),
            phone: AuthValidators.toE164(_phone.text),
            password: _password.text.trim(),
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${_name.text.trim()} registered')),
      );
      // Replace the form with the freshly-created record, so Back lands on the
      // patient list rather than an empty form.
      if (id.isNotEmpty) {
        context.pushReplacement(
          '/clinician/patients/$id',
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
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                decoration: const InputDecoration(
                  labelText: 'Phone',
                  prefixText: '+91 ',
                  prefixIcon: Icon(Icons.phone_outlined),
                ),
                validator:
                    (v) =>
                        AuthValidators.isValidPhone(v ?? '')
                            ? null
                            : 'Enter a valid 10-digit number',
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
              const _SectionLabel('Patient app login'),
              const SizedBox(height: AppSpacing.sm),
              TextFormField(
                controller: _password,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: 'Set a password',
                  helperText:
                      'The patient signs in with their phone number and this password — share it with them.',
                  helperMaxLines: 2,
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                    tooltip: _obscure ? 'Show password' : 'Hide password',
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator:
                    (v) =>
                        ((v ?? '').trim().length < 8)
                            ? 'At least 8 characters'
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
