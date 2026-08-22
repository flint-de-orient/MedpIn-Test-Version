import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../core/utils/vitals_validators.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../shared/widgets/error_view.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../medications/domain/med_shorthand.dart';
import '../data/clinician_repository.dart';
import '../domain/advice_catalog.dart';
import '../domain/clinician_models.dart';
import '../domain/diagnosis_catalog.dart';
import '../domain/lab_catalog.dart';
import 'clinician_providers.dart';
import '../../medications/domain/strength.dart';
import '../../../shared/widgets/strength_field.dart';
import '../data/medicine_brand_repository.dart';

/// The consultation flow: Vitals → Diagnosis → Clinical advice, ending in a
/// generated prescription. Vitals are recorded to the patient's history and the
/// complaint is carried onto the prescription; the diagnosis is a structured
/// pick-list; medicines use the clinic's shorthand and the labs its catalog.
class ConsultScreen extends ConsumerStatefulWidget {
  const ConsultScreen({super.key, required this.patientId, this.patientName});

  final String patientId;
  final String? patientName;

  @override
  ConsumerState<ConsultScreen> createState() => _ConsultScreenState();
}

class _ConsultScreenState extends ConsumerState<ConsultScreen> {
  static const _steps = ['Vitals', 'Diagnosis', 'Advice'];
  int _step = 0;

  // Vitals + complaint
  final _height = TextEditingController();
  final _weight = TextEditingController();
  final _waist = TextEditingController();
  final _systolic = TextEditingController();
  final _diastolic = TextEditingController();
  final _pulse = TextEditingController();
  final _sugar = TextEditingController();
  final _spo2 = TextEditingController();
  final _complaint = TextEditingController();

  // Diagnosis (stored labels) + free-text add
  final Set<String> _diagnoses = {};
  final _customDx = TextEditingController();

  // Medicines
  final List<_MedDraft> _meds = [_MedDraft()];

  // Labs + free-text add
  final Set<String> _labs = {};
  final _customTest = TextEditingController();

  // Advice + follow-up
  final _advice = TextEditingController();
  DateTime? _followUp;

  final _vitalsFormKey = GlobalKey<FormState>();
  AutovalidateMode _vitalsAutovalidate = AutovalidateMode.disabled;
  final _diagFormKey = GlobalKey<FormState>();
  AutovalidateMode _diagAutovalidate = AutovalidateMode.disabled;

  /// Whether the presenting complaint is printed on the prescription.
  bool _showComplaintOnRx = true;

  bool _uploadingSignature = false;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [
      _height,
      _weight,
      _waist,
      _systolic,
      _diastolic,
      _pulse,
      _sugar,
      _spo2,
      _complaint,
      _customDx,
      _customTest,
      _advice,
    ]) {
      c.dispose();
    }
    for (final m in _meds) {
      m.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.trim());
  double? _double(TextEditingController c) => double.tryParse(c.text.trim());

  bool get _hasMedicine => _meds.any((m) => m.name.text.trim().isNotEmpty);

  /// Checks each medicine's strength against the recorded composition of its
  /// brand, and asks about any that disagree.
  ///
  /// Returns false when the doctor chose to go back and change something.
  /// Brands the clinic has not recorded raise nothing at all — an unknown
  /// product is unknown, and inventing a warning about it would teach the
  /// prescriber to dismiss warnings.
  Future<bool> _confirmStrengths() async {
    final repo = ref.read(medicineBrandRepositoryProvider);
    final mismatches = <({String name, String typed, String expected, String composition})>[];

    for (final m in _meds) {
      final name = m.name.text.trim();
      final typed = m.strength.text.trim();
      if (name.isEmpty || typed.isEmpty) continue;

      MedicineBrand? brand;
      try {
        brand = await repo.lookup(name);
      } catch (_) {
        // A lookup that fails must not block prescribing. The check is an aid,
        // and an aid that stops the clinic working is worse than no aid.
        continue;
      }
      if (brand == null || brand.strengthLabel.isEmpty) continue;

      // Compare the figures only, so "500/1" and "500/1 mg" agree.
      String figures(String v) => v.replaceAll(RegExp(r'[^0-9./]'), '');
      if (figures(typed) == figures(brand.strengthWithUnit)) continue;

      mismatches.add((
        name: name,
        typed: typed,
        expected: brand.strengthWithUnit,
        composition: brand.compositionLabel,
      ));
    }

    if (mismatches.isEmpty || !mounted) return true;

    final proceed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          mismatches.length == 1 ? 'Check this strength' : 'Check these strengths',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final m in mismatches) ...[
              Text(m.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(
                'You wrote ${m.typed}. Our records have this as ${m.expected} '
                '(${m.composition}).',
                style: const TextStyle(fontSize: 14, height: 1.4),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            Text(
              'Issue it as written, or go back and change it.',
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(ctx).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Go back'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Issue as written'),
          ),
        ],
      ),
    );

    if (proceed != true) {
      if (mounted) setState(() => _step = 2);
      return false;
    }
    return true;
  }

  Future<void> _generate() async {
    // Bad vitals (out of range, or a diastolic ≥ systolic) block generation and
    // send the doctor back to the Vitals step to fix them.
    if (!(_vitalsFormKey.currentState?.validate() ?? true)) {
      setState(() {
        _step = 0;
        _vitalsAutovalidate = AutovalidateMode.onUserInteraction;
      });
      return;
    }
    if (!(_diagFormKey.currentState?.validate() ?? true)) {
      setState(() {
        _step = 1;
        _diagAutovalidate = AutovalidateMode.onUserInteraction;
      });
      return;
    }
    // Every medicine checked against the clinic's own brand list before the
    // prescription is issued. This is what "Gluconorm G1 500/50" needed: the
    // brand is metformin 500 with glimepiride 1, so its strength is 500/1, and
    // 500/50 belongs to a different product entirely.
    //
    // A warning, never a correction. The doctor prescribes; if they mean to
    // override the list they say so once and it is issued exactly as written.
    // Software that silently rewrites a dose is worse than software that shows
    // an inconsistency, because the inconsistency is visible and gets caught.
    if (!await _confirmStrengths()) return;

    // A prescription without medicines is legitimate — a visit can end in tests,
    // diet advice or reassurance and nothing to dispense. It is also the shape a
    // half-finished form takes, so it is confirmed rather than blocked: the
    // doctor is asked once, and an accidental empty prescription is caught
    // without an intentional one being impossible.
    if (!_hasMedicine) {
      final proceed = await showDialog<bool>(
        context: context,
        builder:
            (ctx) => AlertDialog(
              title: const Text('No medicines added'),
              content: const Text(
                'You are about to generate a prescription without any medicine. '
                'Please confirm to continue.',
              ),
              // The weight goes on the ordinary answer, not the override. A
              // filled "Confirm" beside a quiet "Go back" invites a reflexive
              // tap on the one action that skips medication entry — and in a
              // clinic the common case is a doctor who has not added the drug
              // yet, not one who means to prescribe nothing.
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  style: TextButton.styleFrom(
                    foregroundColor: Theme.of(ctx).colorScheme.onSurfaceVariant,
                  ),
                  // Named for its consequence. "Confirm" does not say what is
                  // being confirmed, which is the whole risk in a hurried tap.
                  child: const Text('Generate without medicines'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Add a medicine'),
                ),
              ],
            ),
      );
      if (proceed != true) {
        // Back to the medicines step, since that is what they came back for.
        if (mounted) setState(() => _step = 2);
        return;
      }
      if (!mounted) return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });

    final complaint = _complaint.text.trim();
    final items = <Map<String, dynamic>>[];
    for (final m in _meds) {
      final name = m.name.text.trim();
      if (name.isEmpty) continue;
      items.add({
        'name': name,
        if (m.strength.text.trim().isNotEmpty)
          'strength': m.strength.text.trim(),
        'frequency': m.frequency.apiFrequency,
        'relationToMeal': m.relation.api,
        'route': m.route.api,
        if (_int(m.duration) != null) 'durationDays': _int(m.duration),
        if (m.instructions.text.trim().isNotEmpty)
          'instructions': m.instructions.text.trim(),
      });
    }

    final labs = <String>{..._labs};
    final customTest = _customTest.text.trim();
    if (customTest.isNotEmpty) labs.add(customTest);

    try {
      final repo = ref.read(clinicianRepositoryProvider);
      // Vitals first, so the measurements land in the record even if the doctor
      // backs out; then the prescription that references the complaint.
      await repo.recordConsultVitals(
        patientId: widget.patientId,
        complaint: complaint,
        heightCm: _double(_height),
        weightKg: _double(_weight),
        waistCm: _double(_waist),
        systolic: _int(_systolic),
        diastolic: _int(_diastolic),
        pulse: _int(_pulse),
        spo2: _int(_spo2),
        glucoseMgDl: _int(_sugar),
      );
      await repo.createPrescription(
        patientId: widget.patientId,
        items: items,
        // Recorded to the profile above regardless; only printed on the Rx when
        // the doctor left the checkbox ticked.
        complaint:
            (complaint.isEmpty || !_showComplaintOnRx) ? null : complaint,
        diagnosis: _diagnoses.toList(),
        labTestsAdvised: labs.toList(),
        generalAdvice: _advice.text.trim(),
        followUpOn: _followUp,
      );
      // The record, the medicine tracker and the history all just changed.
      ref.invalidate(patientPrescriptionsProvider(widget.patientId));
      ref.invalidate(patientSummaryProvider(widget.patientId));
      ref.invalidate(patientMedicationsProvider(widget.patientId));
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Prescription created')));
      // Land on the prescription list so the doctor can download the PDF.
      context.pushReplacement(
        '/clinician/patients/${widget.patientId}/prescriptions',
        extra: widget.patientName,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = ErrorView.messageFor(context, e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Consult'),
        bottom:
            widget.patientName == null
                ? null
                : PreferredSize(
                  preferredSize: const Size.fromHeight(20),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      widget.patientName!,
                      style: TextStyle(
                        fontSize: 14,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
      ),
      // The nav bar lives here (not in the body Column) so Flutter always keeps
      // it pinned above the system bar and lifts it above the keyboard — the
      // Next/Generate action is never scrolled off or hidden behind a field.
      bottomNavigationBar: _navBar(),
      body: Column(
        children: [
          _StepBar(step: _step, labels: _steps),
          Expanded(
            child: IndexedStack(
              index: _step,
              children: [_vitalsStep(), _diagnosisStep(), _adviceStep()],
            ),
          ),
        ],
      ),
    );
  }

  // ---- Step 1: Vitals --------------------------------------------------
  Widget _vitalsStep() {
    return Form(
      key: _vitalsFormKey,
      autovalidateMode: _vitalsAutovalidate,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        children: [
          const _StepTitle('Vitals', 'Measured at this visit — all optional'),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: _num(_height, 'Height', 'cm', VitalsValidators.height),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _num(_weight, 'Weight', 'kg', VitalsValidators.weight),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: _num(
                  _systolic,
                  'BP systolic',
                  'mmHg',
                  VitalsValidators.systolic,
                  integer: true,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _num(
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
                child: _num(
                  _pulse,
                  'Heart rate',
                  'bpm',
                  VitalsValidators.pulse,
                  integer: true,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _num(
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
          _num(
            _sugar,
            'Blood sugar',
            'mg/dL',
            VitalsValidators.sugar,
            integer: true,
          ),
          const SizedBox(height: AppSpacing.lg),
          const _StepTitle('Complaint', 'Add the reason for this visit'),
          const SizedBox(height: AppSpacing.sm),
          TextFormField(
            controller: _complaint,
            textCapitalization: TextCapitalization.sentences,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Presenting complaint',
              alignLabelWithHint: true,
              hintText: 'e.g. increased thirst and fatigue for 2 weeks',
            ),
          ),
          CheckboxListTile(
            value: _showComplaintOnRx,
            onChanged: (v) => setState(() => _showComplaintOnRx = v ?? true),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            activeColor: AppColors.primary,
            title: const Text(
              'Show this complaint on the prescription',
              style: TextStyle(fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }

  /// The diagnosis from the patient's last prescription, as tap-to-reuse chips —
  /// so continuing the same diagnosis is one tap, not a re-hunt through the list.
  Widget _previousDiagnosisSection() {
    final list =
        ref.watch(patientPrescriptionsProvider(widget.patientId)).valueOrNull ??
        const [];
    final prev = list.where((rx) => rx.diagnosis.isNotEmpty).toList();
    if (prev.isEmpty) return const SizedBox.shrink();
    final diagnoses = prev.first.diagnosis;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _StepTitle('Previous diagnosis', 'Tap to reuse'),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final d in diagnoses)
              _SelectChip(
                label: d,
                selected: _diagnoses.contains(d),
                onTap:
                    () => setState(() {
                      _diagnoses.contains(d)
                          ? _diagnoses.remove(d)
                          : _diagnoses.add(d);
                    }),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  // ---- Step 2: Diagnosis ----------------------------------------------
  Widget _diagnosisStep() {
    final groups = diagnosisByCategory();
    return Form(
      key: _diagFormKey,
      autovalidateMode: _diagAutovalidate,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        children: [
          const _StepTitle(
            'Examination',
            'Waist circumference (belly), optional',
          ),
          const SizedBox(height: AppSpacing.sm),
          _num(_waist, 'Waist circumference', 'cm', VitalsValidators.waist),
          const SizedBox(height: AppSpacing.lg),
          _previousDiagnosisSection(),
          const _StepTitle(
            'Diagnosis',
            'Tap to select — printed on the prescription',
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final entry in groups.entries) ...[
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: 4),
              child: Text(
                entry.key,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final d in entry.value)
                  _SelectChip(
                    label: d.code,
                    selected: _diagnoses.contains(d.label),
                    onTap:
                        () => setState(() {
                          _diagnoses.contains(d.label)
                              ? _diagnoses.remove(d.label)
                              : _diagnoses.add(d.label);
                        }),
                  ),
              ],
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: _customDx,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Add another diagnosis',
                  ),
                  onSubmitted: (_) => _addCustomDx(),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              IconButton.filledTonal(
                onPressed: _addCustomDx,
                icon: const Icon(Icons.add),
              ),
            ],
          ),
          if (_diagnoses.any(
            (d) => kDiagnosisCatalog.every((o) => o.label != d),
          )) ...[
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final d in _diagnoses.where(
                  (d) => kDiagnosisCatalog.every((o) => o.label != d),
                ))
                  Chip(
                    label: Text(d),
                    onDeleted: () => setState(() => _diagnoses.remove(d)),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  void _addCustomDx() {
    final v = _customDx.text.trim();
    if (v.isEmpty) return;
    setState(() {
      _diagnoses.add(v);
      _customDx.clear();
    });
  }

  /// The patient's most recent prescription, collapsed — diagnosis, medicines,
  /// tests and advice — so the doctor can see what was last given.
  Widget _previousRxCard() {
    final list =
        ref.watch(patientPrescriptionsProvider(widget.patientId)).valueOrNull ??
        const [];
    if (list.isEmpty) return const SizedBox.shrink();
    final rx = list.first;
    final scheme = Theme.of(context).colorScheme;
    final date =
        rx.issuedOn != null
            ? DateFormat('d MMM yyyy').format(rx.issuedOn!)
            : '';
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 0,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          leading: Icon(Icons.history_rounded, color: scheme.onSurfaceVariant),
          title: const Text(
            'Last prescription',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            date,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          children: [
            if (rx.diagnosis.isNotEmpty)
              _refRow('Diagnosis', rx.diagnosis.join(', ')),
            if (rx.medicines.isNotEmpty)
              _refRow('Medicines', rx.medicines.join('\n')),
            if (rx.labTestsAdvised.isNotEmpty)
              _refRow('Tests advised', rx.labTestsAdvised.join(', ')),
            if (rx.generalAdvice != null && rx.generalAdvice!.isNotEmpty)
              _refRow('Advice', rx.generalAdvice!),
          ],
        ),
      ),
    );
  }

  Widget _refRow(String k, String v) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            k.toUpperCase(),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 0),
          Text(v, style: const TextStyle(fontSize: 14, height: 1.3)),
        ],
      ),
    );
  }

  /// The patient's most recent prescription, or null.
  PrescriptionSummary? _mostRecentRx() {
    final list =
        ref.watch(patientPrescriptionsProvider(widget.patientId)).valueOrNull ??
        const [];
    return list.isEmpty ? null : list.first;
  }

  /// Pre-fill a medicine row from a previous prescription item — replacing the
  /// first empty row if there is one, else appending.
  void _addPreviousMed(PrescribedItem it) {
    setState(() {
      final draft = _MedDraft();
      draft.name.text = it.name;
      draft.strength.text = it.strength ?? '';
      draft.duration.text = it.durationDays?.toString() ?? '';
      draft.frequency = DoseFrequencyX.fromApi(it.frequency);
      draft.relation = MealRelationX.fromApi(it.relationToMeal);
      draft.route = MedRouteX.fromApi(it.route);
      if (_meds.length == 1 && _meds.first.name.text.trim().isEmpty) {
        _meds.first.dispose();
        _meds[0] = draft;
      } else {
        _meds.add(draft);
      }
    });
  }

  /// Append a previous advice block, skipping lines already present.
  void _reuseAdvice(String text) {
    setState(() {
      final lines = _adviceLines;
      for (final line in text
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)) {
        if (!lines.any((e) => e.toLowerCase() == line.toLowerCase()))
          lines.add(line);
      }
      _advice.text = lines.join('\n');
    });
  }

  /// A small "From last prescription" label above a reuse row.
  Widget _reuseLabel() => Padding(
    padding: const EdgeInsets.only(top: 4, bottom: 4),
    child: Row(
      children: [
        Icon(
          Icons.history_rounded,
          size: 14,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: 4),
        Text(
          'From last prescription — tap to reuse',
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    ),
  );

  // ---- Step 3: Clinical advice ----------------------------------------
  Widget _adviceStep() {
    final labGroups = labCatalogByCategory();
    final lastRx = _mostRecentRx();
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        // The patient's last prescription, for reference while writing this one.
        _previousRxCard(),
        // A recap of what was diagnosed in step 2, so the doctor writes the
        // prescription with the diagnosis in view. Editable back in that step.
        _StepTitle(
          'Diagnosis',
          _diagnoses.isEmpty
              ? 'None selected — add it in the Diagnosis step'
              : 'From the Diagnosis step',
        ),
        const SizedBox(height: AppSpacing.sm),
        if (_diagnoses.isEmpty)
          Text(
            '—',
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final d in _diagnoses)
                Chip(
                  label: Text(d, style: const TextStyle(fontSize: 12)),
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
            ],
          ),
        const SizedBox(height: AppSpacing.lg),
        const _StepTitle('Medicines', 'The prescription — at least one needed'),
        const SizedBox(height: AppSpacing.sm),
        if (lastRx != null && lastRx.items.isNotEmpty) ...[
          _reuseLabel(),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final it in lastRx.items)
                ActionChip(
                  avatar: const Icon(Icons.add, size: 15),
                  label: Text(
                    (it.strength != null && it.strength!.isNotEmpty)
                        ? '${it.name} · ${formatStrength(it.strength)}'
                        : it.name,
                    style: const TextStyle(fontSize: 12),
                  ),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _addPreviousMed(it),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        for (var i = 0; i < _meds.length; i++)
          _MedCard(
            key: ObjectKey(_meds[i]),
            draft: _meds[i],
            index: i,
            onChanged: () => setState(() {}),
            onRemove:
                _meds.length == 1
                    ? null
                    : () => setState(() => _meds.removeAt(i)),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _meds.add(_MedDraft())),
            icon: const Icon(Icons.add),
            label: const Text('Add medicine'),
          ),
        ),

        const SizedBox(height: AppSpacing.md),
        const _StepTitle('Lab tests advised', 'Ordered with the prescription'),
        const SizedBox(height: AppSpacing.sm),
        for (final entry in labGroups.entries) ...[
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 4),
            child: Text(
              entry.key,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final p in entry.value)
                _SelectChip(
                  label: p.name,
                  selected: _labs.contains(p.name),
                  onTap:
                      () => setState(() {
                        _labs.contains(p.name)
                            ? _labs.remove(p.name)
                            : _labs.add(p.name);
                      }),
                ),
            ],
          ),
        ],
        if (lastRx != null && lastRx.labTestsAdvised.isNotEmpty) ...[
          _reuseLabel(),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in lastRx.labTestsAdvised)
                _SelectChip(
                  label: t,
                  selected: _labs.contains(t),
                  onTap:
                      () => setState(() {
                        _labs.contains(t) ? _labs.remove(t) : _labs.add(t);
                      }),
                ),
            ],
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _customTest,
                decoration: const InputDecoration(
                  labelText: 'Add another test',
                ),
                onSubmitted: (_) => _addCustomTest(),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            IconButton.filledTonal(
              onPressed: _addCustomTest,
              icon: const Icon(Icons.add),
            ),
          ],
        ),

        const SizedBox(height: AppSpacing.lg),
        const _StepTitle(
          'General advice',
          'Tap a common one, or type your own',
        ),
        const SizedBox(height: AppSpacing.sm),
        if (lastRx != null &&
            (lastRx.generalAdvice ?? '').trim().isNotEmpty) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: () => _reuseAdvice(lastRx.generalAdvice!),
              icon: const Icon(Icons.history_rounded, size: 16),
              label: const Text('Reuse last advice'),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        // Common advice the doctor writes repeatedly — tap to add to the text.
        for (final entry in adviceByCategory().entries) ...[
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 4),
            child: Text(
              entry.key,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in entry.value)
                _SelectChip(
                  label: a.text,
                  selected: _adviceHas(a.text),
                  onTap: () => _toggleAdvice(a.text),
                ),
            ],
          ),
          const SizedBox(height: 4),
        ],
        const SizedBox(height: AppSpacing.sm),
        TextField(
          controller: _advice,
          textCapitalization: TextCapitalization.sentences,
          minLines: 3,
          maxLines: 8,
          decoration: const InputDecoration(
            labelText: 'Advice',
            alignLabelWithHint: true,
            hintText: 'e.g. reduce refined sugar, walk 30 min daily',
          ),
        ),

        const SizedBox(height: AppSpacing.md),
        InkWell(
          onTap: _pickFollowUp,
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          child: InputDecorator(
            decoration: const InputDecoration(
              labelText: 'Follow-up date',
              prefixIcon: Icon(Icons.event_outlined),
            ),
            child: Text(
              _followUp == null
                  ? 'Not set'
                  : DateFormat('d MMM yyyy').format(_followUp!),
            ),
          ),
        ),
        if (_followUp != null)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => setState(() => _followUp = null),
              child: const Text('Clear'),
            ),
          ),

        const SizedBox(height: AppSpacing.lg),
        const _StepTitle(
          'Digital signature',
          'Signs the generated prescription',
        ),
        const SizedBox(height: AppSpacing.sm),
        _signatureRow(),

        if (_error != null) ...[
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: AppColors.dangerBgOn(context),
              borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
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
      ],
    );
  }

  void _addCustomTest() {
    final v = _customTest.text.trim();
    if (v.isEmpty) return;
    setState(() {
      _labs.add(v);
      _customTest.clear();
    });
  }

  /// Advice snippets are one-per-line; a chip is "selected" when its line is
  /// already present, and tapping it adds or removes that line.
  List<String> get _adviceLines =>
      _advice.text
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)
          .toList();

  bool _adviceHas(String text) =>
      _adviceLines.any((l) => l.toLowerCase() == text.toLowerCase());

  void _toggleAdvice(String text) {
    final lines = _adviceLines;
    setState(() {
      if (_adviceHas(text)) {
        lines.removeWhere((l) => l.toLowerCase() == text.toLowerCase());
      } else {
        lines.add(text);
      }
      _advice.text = lines.join('\n');
    });
  }

  Future<void> _pickFollowUp() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _followUp ?? now.add(const Duration(days: 15)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _followUp = picked);
  }

  /// The doctor's signature — stored once on their profile and reused on every
  /// prescription. Shown here so it can be set/changed without leaving the
  /// consult. When none is set the PDF still prints a signature line.
  Widget _signatureRow() {
    final scheme = Theme.of(context).colorScheme;
    final signatureUrl = ref.watch(authControllerProvider).user?.signatureUrl;
    final hasSig = signatureUrl != null;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.5)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                hasSig ? Icons.verified_rounded : Icons.draw_outlined,
                size: 22,
                color: hasSig ? AppColors.primary : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  hasSig
                      ? 'Signature added — it signs this prescription'
                      : 'No signature yet — a signature line is printed instead',
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.3,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              _uploadingSignature
                  ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: SizedBox(
                      width: 16,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                  : TextButton(
                    onPressed: _changeSignature,
                    child: Text(hasSig ? 'Change' : 'Upload'),
                  ),
            ],
          ),
          // The signature itself, immediately before it is committed to a
          // prescription. "Signature added" states that a file exists; it does
          // not say whether the right one is about to be printed under the
          // doctor's name, and this is the last screen before it is.
          if (hasSig) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              decoration: BoxDecoration(
                // White, because that is what the prescription is. The
                // signature is cut out on transparency, so a themed surface
                // behind it would show the doctor something the printed page
                // never looks like.
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.6),
                ),
              ),
              child: AuthedImage(
                path: signatureUrl,
                width: double.infinity,
                height: 74,
                radius: 0,
                fit: BoxFit.contain,
                background: Colors.white,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _changeSignature() async {
    final messenger = ScaffoldMessenger.of(context);
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: const Text('Camera'),
                  onTap: () => Navigator.pop(ctx, ImageSource.camera),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Gallery'),
                  onTap: () => Navigator.pop(ctx, ImageSource.gallery),
                ),
              ],
            ),
          ),
    );
    if (source == null) return;
    final file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1200,
      maxHeight: 600,
      imageQuality: 90,
    );
    if (file == null) return;
    setState(() => _uploadingSignature = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: file.path,
            filename: file.name,
            kind: UploadKind.signature,
          );
      final user = await ref
          .read(authRepositoryProvider)
          .updateMe(signatureAssetId: asset.id);
      ref.read(authControllerProvider.notifier).replaceUser(user);
      messenger.showSnackBar(const SnackBar(content: Text('Signature saved')));
    } catch (_) {
      if (mounted)
        messenger.showSnackBar(
          const SnackBar(content: Text('Could not upload the signature')),
        );
    } finally {
      if (mounted) setState(() => _uploadingSignature = false);
    }
  }

  /// Advance a step. Leaving the Vitals step first validates it, so a bad
  /// measurement is caught before the doctor moves on.
  void _next() {
    if (_step == 0 && !(_vitalsFormKey.currentState?.validate() ?? true)) {
      setState(() => _vitalsAutovalidate = AutovalidateMode.onUserInteraction);
      return;
    }
    if (_step == 1 && !(_diagFormKey.currentState?.validate() ?? true)) {
      setState(() => _diagAutovalidate = AutovalidateMode.onUserInteraction);
      return;
    }
    setState(() => _step += 1);
  }

  // ---- Nav + shared bits ----------------------------------------------
  Widget _navBar() {
    final last = _step == _steps.length - 1;
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      elevation: 12,
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          10,
          AppSpacing.md,
          12,
        ),
        child: Row(
          children: [
            if (_step > 0) ...[
              OutlinedButton(
                onPressed:
                    _submitting ? null : () => setState(() => _step -= 1),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 52),
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                ),
                child: const Text(
                  'Back',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 12),
            ],
            // Full-width primary action — impossible to miss or scroll past.
            Expanded(
              child: FilledButton.icon(
                onPressed: last ? (_submitting ? null : _generate) : _next,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(52),
                ),
                icon:
                    last
                        ? (_submitting
                            ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                            : const Icon(Icons.check_rounded))
                        : const Icon(Icons.arrow_forward_rounded, size: 18),
                label: Text(
                  last
                      ? (_submitting ? 'Generating…' : 'Generate prescription')
                      : 'Next',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _num(
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

/// A mutable medicine draft — controllers plus the shorthand enums.
class _MedDraft {
  final name = TextEditingController();
  final strength = TextEditingController();
  final duration = TextEditingController();
  final instructions = TextEditingController();
  DoseFrequency frequency = DoseFrequency.od;
  MealRelation relation = MealRelation.after;
  MedRoute route = MedRoute.oral;

  void dispose() {
    name.dispose();
    strength.dispose();
    duration.dispose();
    instructions.dispose();
  }
}

class _MedCard extends StatelessWidget {
  const _MedCard({
    super.key,
    required this.draft,
    required this.index,
    required this.onChanged,
    this.onRemove,
  });

  final _MedDraft draft;
  final int index;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final shorthand = composeShorthand(
      frequency: draft.frequency,
      relation: draft.relation,
      route: draft.route,
    );
    final plain = expandToPlain(
      frequency: draft.frequency,
      relation: draft.relation,
      route: draft.route,
    );

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                // Suggests from the clinic's own brand list and fills the
                // strength when one is picked, so the common case needs no
                // typing at all — and the strength that arrives is the one the
                // product actually has.
                child: _BrandField(
                  controller: draft.name,
                  label: 'Medicine ${index + 1}',
                  onBrandPicked: (b) {
                    if (b.strengthWithUnit.isNotEmpty) {
                      draft.strength.text = b.strengthWithUnit;
                    }
                  },
                ),
              ),
              if (onRemove != null)
                IconButton(
                  onPressed: onRemove,
                  icon: Icon(
                    Icons.close_rounded,
                    color: scheme.onSurfaceVariant,
                  ),
                  tooltip: 'Remove',
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: StrengthField(controller: draft.strength),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: draft.duration,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(3),
                  ],
                  decoration: const InputDecoration(
                    labelText: 'Days',
                    isDense: true,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<DoseFrequency>(
                  initialValue: draft.frequency,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Frequency',
                    isDense: true,
                  ),
                  items: [
                    for (final f in DoseFrequency.values)
                      DropdownMenuItem(
                        value: f,
                        child: Text(
                          '${f.code} · ${f.plain}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      draft.frequency = v;
                      onChanged();
                    }
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<MedRoute>(
                  initialValue: draft.route,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Route',
                    isDense: true,
                  ),
                  items: [
                    for (final r in MedRoute.values)
                      DropdownMenuItem(
                        value: r,
                        child: Text(r.code, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      draft.route = v;
                      onChanged();
                    }
                  },
                ),
              ),
            ],
          ),
          if (draft.frequency.takesMealRelation) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<MealRelation>(
              initialValue: draft.relation,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Meal relation',
                isDense: true,
              ),
              items: const [
                DropdownMenuItem(
                  value: MealRelation.after,
                  child: Text('After food (PC)'),
                ),
                DropdownMenuItem(
                  value: MealRelation.before,
                  child: Text('Before food (AC)'),
                ),
                DropdownMenuItem(
                  value: MealRelation.withFood,
                  child: Text('With food'),
                ),
                DropdownMenuItem(
                  value: MealRelation.anytime,
                  child: Text('Anytime'),
                ),
              ],
              onChanged: (v) {
                if (v != null) {
                  draft.relation = v;
                  onChanged();
                }
              },
            ),
          ],
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '$shorthand  ·  $plain',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepBar extends StatelessWidget {
  const _StepBar({required this.step, required this.labels});

  final int step;
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.sm,
      ),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++) ...[
            _dot(context, i),
            if (i < labels.length - 1)
              Expanded(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  color: i < step ? AppColors.primary : scheme.outlineVariant,
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _dot(BuildContext context, int i) {
    final scheme = Theme.of(context).colorScheme;
    final done = i < step;
    final active = i == step;
    final color =
        (done || active) ? AppColors.primary : scheme.surfaceContainerHighest;
    return Row(
      children: [
        Container(
          width: 26,
          height: 26,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child:
              done
                  ? const Icon(Icons.check, size: 15, color: Colors.white)
                  : Text(
                    '${i + 1}',
                    style: TextStyle(
                      color: active ? Colors.white : scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
        ),
        const SizedBox(width: 4),
        Text(
          labels[i],
          style: TextStyle(
            fontSize: 14,
            fontWeight: active ? FontWeight.w800 : FontWeight.w500,
            color: active ? scheme.onSurface : scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _StepTitle extends StatelessWidget {
  const _StepTitle(this.title, this.subtitle);

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 0),
        Text(
          subtitle,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _SelectChip extends StatelessWidget {
  const _SelectChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color:
              selected
                  ? AppColors.primary
                  : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color:
                selected
                    ? AppColors.primary
                    : scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected) ...[
              const Icon(Icons.check, size: 15, color: Colors.white),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? Colors.white : scheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The medicine name, with suggestions from the clinic's brand list.
///
/// Typing is still free — a product the list does not carry is prescribed
/// exactly as written, because a prescriber who has to fight an autocomplete
/// stops using it. Picking a suggestion fills the strength, which is the whole
/// value: the figure comes from a recorded composition rather than memory.
class _BrandField extends ConsumerWidget {
  const _BrandField({
    required this.controller,
    required this.label,
    required this.onBrandPicked,
  });

  final TextEditingController controller;
  final String label;
  final ValueChanged<MedicineBrand> onBrandPicked;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RawAutocomplete<MedicineBrand>(
      textEditingController: controller,
      focusNode: FocusNode(),
      optionsBuilder: (value) async {
        final q = value.text.trim();
        if (q.length < 2) return const Iterable<MedicineBrand>.empty();
        try {
          return await ref.read(medicineBrandRepositoryProvider).search(q);
        } catch (_) {
          // No suggestions is a fine outcome; a red error over a prescribing
          // form because a lookup timed out is not.
          return const Iterable<MedicineBrand>.empty();
        }
      },
      displayStringForOption: (b) => b.name,
      onSelected: onBrandPicked,
      fieldViewBuilder: (context, textController, focusNode, onSubmit) => TextField(
        controller: textController,
        focusNode: focusNode,
        textCapitalization: TextCapitalization.words,
        onSubmitted: (_) => onSubmit(),
        decoration: InputDecoration(labelText: label, isDense: true),
      ),
      optionsViewBuilder: (context, onSelected, options) {
        final scheme = Theme.of(context).colorScheme;
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 3,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260, maxWidth: 420),
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: options.length,
                itemBuilder: (context, i) {
                  final b = options.elementAt(i);
                  return ListTile(
                    dense: true,
                    title: Text(
                      b.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    // What is in it, so the right product is picked from a list
                    // of brands that differ by one character.
                    subtitle: Text(
                      b.compositionLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                    onTap: () => onSelected(b),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}
