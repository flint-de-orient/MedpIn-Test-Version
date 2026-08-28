import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../home/domain/care_summary.dart';
import '../../home/presentation/home_providers.dart';

/// The clinical profile fields the backend supports on `PATCH /auth/me/profile`
/// — height, diagnosis date, allergies, and an emergency contact. Weight is
/// deliberately absent; it is a tracked measurement (vitals), not a static
/// profile field.
class HealthDetailsScreen extends ConsumerStatefulWidget {
  const HealthDetailsScreen({super.key});

  @override
  ConsumerState<HealthDetailsScreen> createState() =>
      _HealthDetailsScreenState();
}

class _HealthDetailsScreenState extends ConsumerState<HealthDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _height = TextEditingController();
  final _complaint = TextEditingController();
  final _allergies = TextEditingController();
  final _contactName = TextEditingController();
  final _contactPhone = TextEditingController();
  final _contactRelation = TextEditingController();
  DateTime? _diagnosedOn;

  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _height.dispose();
    _complaint.dispose();
    _allergies.dispose();
    _contactName.dispose();
    _contactPhone.dispose();
    _contactRelation.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = await ref.read(authRepositoryProvider).getProfile();
      if (!mounted) return;
      _height.text = (p['heightCm'] as num?)?.toString() ?? '';
      _complaint.text = p['chiefComplaint']?.toString() ?? '';
      _allergies.text = (p['allergies'] as List?)?.join(', ') ?? '';
      final c = p['emergencyContact'];
      if (c is Map) {
        _contactName.text = c['name']?.toString() ?? '';
        _contactPhone.text = c['phone']?.toString() ?? '';
        _contactRelation.text = c['relation']?.toString() ?? '';
      }
      final d = p['diagnosedOn'];
      if (d != null) _diagnosedOn = DateTime.tryParse(d.toString());
    } on ApiException {
      // Leave the form blank; the patient can still fill it in.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDiagnosedOn() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _diagnosedOn ?? DateTime(now.year - 5, now.month, now.day),
      firstDate: DateTime(now.year - 80),
      lastDate: now,
    );
    if (picked != null) setState(() => _diagnosedOn = picked);
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);

    final allergies =
        _allergies.text
            .split(',')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
    final contactFilled =
        _contactName.text.trim().isNotEmpty ||
        _contactPhone.text.trim().isNotEmpty ||
        _contactRelation.text.trim().isNotEmpty;

    try {
      await ref
          .read(authRepositoryProvider)
          .updateProfile(
            heightCm: double.tryParse(_height.text.trim()),
            chiefComplaint: _complaint.text.trim(),
            diagnosedOn:
                _diagnosedOn == null
                    ? null
                    : '${_diagnosedOn!.year.toString().padLeft(4, '0')}-'
                        '${_diagnosedOn!.month.toString().padLeft(2, '0')}-'
                        '${_diagnosedOn!.day.toString().padLeft(2, '0')}',
            allergies: allergies,
            emergencyContact:
                contactFilled
                    ? {
                      'name': _contactName.text.trim(),
                      'phone': _contactPhone.text.trim(),
                      'relation': _contactRelation.text.trim(),
                    }
                    : null,
          );
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileSaved)));
      navigator.pop();
    } on ApiException {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.commonSomethingWentWrong)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = isDark ? AppColors.primaryDark : AppColors.primary;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.profileHealthDetails),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: TextButton(
              onPressed: _saving || _loading ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: accent,
                foregroundColor: Colors.white,
                disabledBackgroundColor: accent.withValues(alpha: 0.4),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: 8,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child:
                  _saving
                      ? const SizedBox(
                        width: 16,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                      : Text(
                        l10n.profileSave,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
            ),
          ),
        ],
      ),
      body:
          _loading
              ? const Center(child: CircularProgressIndicator())
              : Form(
                key: _formKey,
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  children: [
                    // What has been measured, before what can be typed.
                    //
                    // These are observations, not facts about the patient, and
                    // that is why they are read-only. A blood pressure from
                    // three weeks ago is not edited, it is superseded — and
                    // making it a text field would let the history the trends
                    // and the risk score are computed from be overwritten.
                    //
                    // BMI is never stored. It is weight over height squared,
                    // and a stored copy drifts out of step with the two numbers
                    // it came from the moment either changes.
                    _MeasurementsCard(summary: ref.watch(careSummaryProvider)),
                    const SizedBox(height: AppSpacing.lg),
                    _field(
                      controller: _height,
                      label: l10n.healthHeight,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                      ],
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return null;
                        final h = double.tryParse(v.trim());
                        if (h == null || h < 50 || h > 250) return '50–250';
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _field(
                      controller: _complaint,
                      label: l10n.healthMainConcern,
                      hint: l10n.healthMainConcernHint,
                      maxLines: 3,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    InkWell(
                      onTap: _pickDiagnosedOn,
                      borderRadius: BorderRadius.circular(
                        AppSpacing.buttonRadius,
                      ),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: l10n.healthDiagnosedOn,
                          prefixIcon: const Icon(Icons.event_outlined),
                        ),
                        child: Text(
                          _diagnosedOn == null
                              ? l10n.healthNotSet
                              : '${_diagnosedOn!.day.toString().padLeft(2, '0')}/'
                                  '${_diagnosedOn!.month.toString().padLeft(2, '0')}/${_diagnosedOn!.year}',
                          style: TextStyle(
                            color:
                                _diagnosedOn == null
                                    ? scheme.onSurfaceVariant
                                    : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _field(
                      controller: _allergies,
                      label: l10n.healthAllergies,
                      hint: l10n.healthAllergiesHint,
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Text(
                      l10n.healthEmergencyContact.toUpperCase(),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.8,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    _field(
                      controller: _contactName,
                      label: l10n.healthContactName,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _field(
                      controller: _contactPhone,
                      label: l10n.healthContactPhone,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _field(
                      controller: _contactRelation,
                      label: l10n.healthContactRelation,
                    ),
                  ],
                ),
              ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    String? hint,
    TextInputType? keyboardType,
    List<TextInputFormatter>? inputFormatters,
    String? Function(String?)? validator,
    int maxLines = 1,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      validator: validator,
      maxLines: maxLines,
      textCapitalization:
          maxLines > 1 ? TextCapitalization.sentences : TextCapitalization.none,
      style: const TextStyle(fontSize: 16),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        alignLabelWithHint: maxLines > 1,
        // The label floats from the start so the hint under it is visible while
        // the field is still empty. By default Material parks the label inside
        // the box and hides the hint until focus — which is exactly backwards:
        // the guidance is needed BEFORE tapping, and an empty box with no
        // example reads as broken rather than optional.
        floatingLabelBehavior: FloatingLabelBehavior.always,
      ),
    );
  }
}

/// The patient's latest measurements, and the diagnosis, both read-only.
///
/// Read from the same summary the Home tab uses rather than recomputed here:
/// two places deriving a BMI is two places to disagree about somebody's weight.
class _MeasurementsCard extends StatelessWidget {
  const _MeasurementsCard({required this.summary});

  final AsyncValue<CareSummary> summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = summary.valueOrNull?.profile;
    if (s == null) return const SizedBox.shrink();

    final rows = <(String, String)>[
      if (s.weightKg != null) ('Weight', '${s.weightKg} kg'),
      if (s.bmi != null) ('BMI', '${s.bmi}'),
      if (s.bloodPressure != null)
        (
          'Blood pressure',
          '${s.bloodPressure!.systolic}/${s.bloodPressure!.diastolic} mmHg',
        ),
    ];
    // Glucose is deliberately absent: the Home tab already carries the latest
    // reading with its trend, and a second copy here would be the same number
    // in two places, going stale in one of them.
    if (rows.isEmpty && s.conditionLabel == null)
      return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (s.conditionLabel != null) ...[
            Row(
              children: [
                Icon(
                  Icons.medical_information_outlined,
                  size: 18,
                  color: AppColors.accentOn(context),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    s.conditionLabel!,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            // Said plainly, because a patient who thinks they chose this would
            // wonder why they cannot change it. It follows the doctor's
            // diagnosis at each consultation.
            Text(
              'Set by your doctor from your diagnosis',
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
            if (rows.isNotEmpty) const Divider(height: AppSpacing.lg),
          ],
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Text(
                    value,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          if (rows.isNotEmpty)
            Text(
              'Your most recent readings. Record a new one to update them.',
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}
