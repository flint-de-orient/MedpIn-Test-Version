import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../medications/domain/med_shorthand.dart';
import '../domain/lab_catalog.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../medications/domain/medication.dart';
import '../data/clinician_repository.dart';
import '../domain/patient_summary.dart';
import 'clinician_providers.dart';
import 'widgets/panel_ui.dart';
import 'patient_detail_screen.dart' show PatientRecordSections;
import '../../medications/domain/strength.dart';
import '../../../shared/widgets/strength_field.dart';

/// The doctor's working screen for one patient: who they are at the top, and
/// everything the doctor might do about it underneath.
///
/// The prescribing form lives here rather than behind a second navigation step,
/// because writing the prescription IS the consultation — making the doctor
/// open another screen to do the main thing is a tap between them and the work.
/// The full clinical record sits one tap away in the overflow menu.
class PatientProfileScreen extends ConsumerStatefulWidget {
  const PatientProfileScreen({super.key, required this.patientId});

  final String patientId;

  @override
  ConsumerState<PatientProfileScreen> createState() =>
      _PatientProfileScreenState();
}

class _PatientProfileScreenState extends ConsumerState<PatientProfileScreen> {
  final List<_MedDraft> _meds = [_MedDraft()];
  final _diagnosis = TextEditingController();
  final _advice = TextEditingController();
  final _labSearch = TextEditingController();

  final Set<String> _selectedTests = {};

  /// Every panel in the catalog, plus anything typed in by hand.
  void _selectAllTests() {
    for (final panels in labCatalogByCategory().values) {
      for (final p in panels) {
        _selectedTests.add(p.name);
      }
    }
    _selectedTests.addAll(_customTests);
  }

  bool _categoryFullySelected(List<dynamic> panels) =>
      panels.isNotEmpty && panels.every((p) => _selectedTests.contains(p.name));

  /// All of them, or none — whichever the category is not already.
  void _toggleCategory(List<dynamic> panels) {
    if (_categoryFullySelected(panels)) {
      for (final p in panels) {
        _selectedTests.remove(p.name);
      }
    } else {
      for (final p in panels) {
        _selectedTests.add(p.name);
      }
    }
  }

  final List<String> _customTests = [];

  DateTime? _followUp;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    // Deferred past the first frame: it calls setState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _restoreDraft();
    });
  }

  @override
  void dispose() {
    for (final m in _meds) {
      m.dispose();
    }
    _diagnosis.dispose();
    _advice.dispose();
    _labSearch.dispose();
    super.dispose();
  }

  void _addCustomTest() {
    final text = _labSearch.text.trim();
    if (text.isEmpty) return;
    setState(() {
      // If it's a known panel, order it by its canonical catalog name.
      final panel = labPanelFor(text);
      final name = panel?.name ?? text;
      if (panel == null &&
          !_customTests.any((t) => t.toLowerCase() == text.toLowerCase())) {
        _customTests.add(text);
      }
      _selectedTests.add(name);
      _labSearch.clear();
    });
  }

  Future<void> _pickFollowUp() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _followUp ?? now.add(const Duration(days: 14)),
      firstDate: now,
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _followUp = picked);
  }

  /// Where an unsent prescription is parked, per patient.
  String get _draftKey => 'rx_draft_${widget.patientId}';

  /// Saves the form as it stands so an interrupted consultation can be picked
  /// up later.
  ///
  /// Deliberately local to this device rather than a server draft: a
  /// half-written prescription is not a clinical record, and putting one on the
  /// server would make it visible to anything that reads prescriptions. It
  /// survives closing the app, which is what "I was interrupted" actually
  /// needs.
  Future<void> _saveDraft() async {
    final messenger = ScaffoldMessenger.of(context);
    final draft = <String, dynamic>{
      'meds':
          _meds
              .where((m) => m.name.text.trim().isNotEmpty)
              .map(
                (m) => {
                  'name': m.name.text.trim(),
                  'dosage': m.dosage.text.trim(),
                  // Stored by enum name, not by index: an index would
                  // silently remap every saved draft the day a new frequency is
                  // added to the middle of the enum.
                  'frequency': m.frequency.name,
                  'duration': m.duration.text.trim(),
                },
              )
              .toList(),
      // The diagnosis was missing from here while the form collected it, so
      // "Save draft" quietly kept everything except the one line the doctor
      // had actually reasoned their way to.
      'diagnosis': _diagnosis.text.trim(),
      'advice': _advice.text.trim(),
      'tests': _selectedTests.toList(),
      'customTests': _customTests,
      'followUp': _followUp?.toIso8601String(),
      'savedAt': DateTime.now().toIso8601String(),
    };
    await ref
        .read(sharedPreferencesProvider)
        .setString(_draftKey, jsonEncode(draft));
    if (!mounted) return;
    messenger.showSnackBar(
      const SnackBar(content: Text('Draft saved on this device')),
    );
  }

  /// Restores a saved draft when the screen opens.
  void _restoreDraft() {
    final raw = ref.read(sharedPreferencesProvider).getString(_draftKey);
    if (raw == null) return;
    try {
      final d = jsonDecode(raw) as Map<String, dynamic>;
      final meds =
          (d['meds'] as List?)?.whereType<Map<String, dynamic>>().toList() ??
          const [];
      // Anything at all, not just medicines or advice. The old guard threw
      // away a draft consisting of a diagnosis, three ordered tests and a
      // follow-up date, because neither of the two fields it happened to check
      // was filled in — and it did so silently, on open, so the doctor met an
      // empty form and no explanation.
      final hasAnything =
          meds.isNotEmpty ||
          (d['diagnosis']?.toString().trim().isNotEmpty ?? false) ||
          (d['advice']?.toString().trim().isNotEmpty ?? false) ||
          ((d['tests'] as List?)?.isNotEmpty ?? false) ||
          ((d['customTests'] as List?)?.isNotEmpty ?? false) ||
          (d['followUp']?.toString().isNotEmpty ?? false);
      if (!hasAnything) return;

      setState(() {
        if (meds.isNotEmpty) {
          for (final m in _meds) {
            m.dispose();
          }
          _meds
            ..clear()
            ..addAll(
              meds.map((m) {
                final draft = _MedDraft();
                draft.name.text = m['name']?.toString() ?? '';
                draft.dosage.text = m['dosage']?.toString() ?? '';
                draft.duration.text = m['duration']?.toString() ?? '';
                final freq = m['frequency']?.toString();
                if (freq != null) {
                  draft.frequency = DoseFrequency.values.firstWhere(
                    (f) => f.name == freq,
                    orElse: () => draft.frequency,
                  );
                }
                return draft;
              }),
            );
        }
        _diagnosis.text = d['diagnosis']?.toString() ?? '';
        _advice.text = d['advice']?.toString() ?? '';
        _selectedTests
          ..clear()
          ..addAll((d['tests'] as List?)?.map((e) => e.toString()) ?? const []);
        _customTests
          ..clear()
          ..addAll(
            (d['customTests'] as List?)?.map((e) => e.toString()) ?? const [],
          );
        _followUp = DateTime.tryParse(d['followUp']?.toString() ?? '');
      });
    } catch (_) {
      // A draft that will not parse is not worth surfacing — the form simply
      // opens empty, which is where the doctor would have started anyway.
    }
  }

  Future<void> _send() async {
    final items =
        _meds
            .where((m) => m.name.text.trim().isNotEmpty)
            .map(
              (m) => <String, dynamic>{
                'name': m.name.text.trim(),
                if (m.dosage.text.trim().isNotEmpty)
                  'strength': m.dosage.text.trim(),
                'frequency': m.frequency.apiFrequency,
                'relationToMeal':
                    m.frequency.takesMealRelation ? m.relation.api : 'any',
                'route': m.route.api,
                if (int.tryParse(m.duration.text.trim()) != null)
                  'durationDays': int.parse(m.duration.text.trim()),
              },
            )
            .toList();

    final messenger = ScaffoldMessenger.of(context);
    if (items.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Add at least one medicine (a name is required).'),
        ),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .createPrescription(
            patientId: widget.patientId,
            items: items,
            // Each non-empty line is a diagnosis item — matches how the AI context
            // and the prescription PDF list them.
            diagnosis:
                _diagnosis.text
                    .split('\n')
                    .map((s) => s.trim())
                    .where((s) => s.isNotEmpty)
                    .toList(),
            labTestsAdvised: _selectedTests.toList(),
            generalAdvice:
                _advice.text.trim().isEmpty ? null : _advice.text.trim(),
            followUpOn: _followUp,
          );
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Prescription sent — added to the patient’s tracker'),
        ),
      );
      // Clear rather than pop: the doctor stays with the patient they are
      // seeing, and the record behind this form has just changed.
      setState(() {
        for (final m in _meds) {
          m.dispose();
        }
        _meds
          ..clear()
          ..add(_MedDraft());
        _diagnosis.clear();
        _advice.clear();
        _selectedTests.clear();
        _followUp = null;
        _saving = false;
      });
      // Sent, so the parked copy is no longer a draft of anything.
      await ref.read(sharedPreferencesProvider).remove(_draftKey);
      ref.invalidate(patientSummaryProvider(widget.patientId));
      // The list above this form has just gained what was written into it.
      ref.invalidate(patientMedicationsProvider(widget.patientId));
      // Today's consultation now shows in the record's history.
      ref.invalidate(patientPrescriptionsProvider(widget.patientId));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(patientSummaryProvider(widget.patientId));

    return Scaffold(
      // No overflow menu: the two secondary destinations sit at the foot of the
      // screen instead, after the primary action, where secondary actions
      // belong. Dropping them entirely would leave the clinical record — HbA1c,
      // reports, alerts, dietician — with no route to it at all.
      appBar: AppBar(title: const Text('Patient Profile')),
      // The record is made of other people's actions: the patient logs a
      // reading, the dietician sends a plan, the server finishes reading a
      // report. A doctor with the record open should be looking at what is
      // true now, not at what was true when they opened it.
      body: AutoRefresh(
        onTick: (ref) {
          ref.invalidate(patientSummaryProvider(widget.patientId));
          ref.invalidate(patientPrescriptionsProvider(widget.patientId));
          ref.invalidate(patientMedicationsProvider(widget.patientId));
        },
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load patient'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      onPressed:
                          () => ref.invalidate(
                            patientSummaryProvider(widget.patientId),
                          ),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          data:
              (p) => ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.md,
                  AppSpacing.md,
                  AppSpacing.xl,
                ),
                children: [
                  _ProfileHeader(patient: p),
                  const SizedBox(height: AppSpacing.lg),

                  // The read side of the record — health metrics, the trend graph,
                  // HbA1c history, uploaded reports, alerts and the dietician
                  // assignment — above the actions so the doctor sees the patient's
                  // status before prescribing. (This whole block was orphaned by an
                  // earlier refactor; the data was fetched but never shown.)
                  PatientRecordSections(
                    summary: p,
                    patientId: widget.patientId,
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // The one filled surface on the record. Everything above it is
                  // read-only — who this patient is and how they are doing — and
                  // everything below it is the doctor writing. The colour marks
                  // that boundary, so the eye lands on the point of the visit
                  // rather than on another grey heading among grey headings.
                  PanelFeatureCard(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      AppSpacing.md,
                      AppSpacing.md,
                      AppSpacing.md,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(
                            Icons.edit_document,
                            size: 21,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Clinical Actions',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.2,
                                ),
                              ),
                              SizedBox(height: 0),
                              Text(
                                'Draft and send a new prescription.',
                                style: TextStyle(
                                  color: Color(0xCCFFFFFF),
                                  fontSize: 14,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  _ActionCard(
                    icon: Icons.assignment_outlined,
                    title: 'Medication',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // What the patient is already on, before the box for what to
                        // add. Prescribing without it is prescribing blind — a repeat
                        // or an interaction is invisible until the patient reports it.
                        _CurrentMedicines(patientId: widget.patientId),
                        _Collapsible(
                          title: 'Add medication',
                          subtitle: 'Prescribe a new medicine',
                          icon: Icons.add_circle_outline_rounded,
                          children: [
                            for (var i = 0; i < _meds.length; i++)
                              _MedFields(
                                draft: _meds[i],
                                onChanged: () => setState(() {}),
                                onRemove:
                                    _meds.length > 1
                                        ? () => setState(
                                          () => _meds.removeAt(i).dispose(),
                                        )
                                        : null,
                              ),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  foregroundColor: AppColors.primary,
                                ),
                                onPressed:
                                    () =>
                                        setState(() => _meds.add(_MedDraft())),
                                icon: const Icon(
                                  Icons.add_circle_outline_rounded,
                                  size: 20,
                                ),
                                label: const Text(
                                  'Add another medication',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  _ActionCard(
                    icon: Icons.biotech_outlined,
                    title: 'Lab Tests',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Already ordered, and already come back. Without these the
                        // doctor re-ordered tests that were outstanding and could not
                        // see the report the patient had already uploaded.
                        _TestHistory(summary: p),
                        _Collapsible(
                          title: 'Add tests',
                          subtitle: 'Order from the catalog or type your own',
                          icon: Icons.add_circle_outline_rounded,
                          children: [
                            // Now a real search. It used to be an add-only
                            // control — the comment here said a magnifier
                            // "would promise a lookup that does not exist" —
                            // so a doctor typing "ldl" got nothing and added a
                            // duplicate custom test the catalog already
                            // covered as Lipid Profile. Free text still works;
                            // it is just no longer the only thing that does.
                            Row(
                              children: [
                                Expanded(
                                  child: _LabSearchField(
                                    controller: _labSearch,
                                    onPanelPicked: (panel) {
                                      setState(() {
                                        _selectedTests.add(panel.name);
                                        _labSearch.clear();
                                      });
                                    },
                                    onSubmitted: _addCustomTest,
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                IconButton.filledTonal(
                                  onPressed: _addCustomTest,
                                  icon: const Icon(Icons.add_rounded),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            // Whole-catalog controls. Ordering every panel at
                            // once is not usually good medicine, so "Select
                            // all" is offered but never the default — what it
                            // is really for is the annual review, where the
                            // alternative is fourteen taps.
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    _selectedTests.isEmpty
                                        ? 'No tests selected'
                                        : '${_selectedTests.length} selected',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                      color:
                                          Theme.of(
                                            context,
                                          ).colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                                _TestBulkAction(
                                  label: 'Select all',
                                  onTap: () => setState(_selectAllTests),
                                ),
                                if (_selectedTests.isNotEmpty) ...[
                                  const SizedBox(width: AppSpacing.sm),
                                  _TestBulkAction(
                                    label: 'Clear',
                                    onTap: () => setState(_selectedTests.clear),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            // The diabetes lab catalog, grouped by category. The doctor
                            // orders at the PANEL level; each panel's sub-tests are shown
                            // beneath the selection so "what the report includes" is clear.
                            for (final entry
                                in labCatalogByCategory().entries) ...[
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: 0,
                                  bottom: 4,
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        entry.key.toUpperCase(),
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 0.5,
                                          color:
                                              Theme.of(
                                                context,
                                              ).colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                    // Per category, because this is the one
                                    // that gets used: "all the lipids" is a
                                    // real clinical thought, "everything in
                                    // the catalog" mostly is not.
                                    _TestBulkAction(
                                      label:
                                          _categoryFullySelected(entry.value)
                                              ? 'Clear'
                                              : 'Select all',
                                      onTap:
                                          () => setState(
                                            () => _toggleCategory(entry.value),
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                              Wrap(
                                spacing: AppSpacing.sm,
                                runSpacing: AppSpacing.sm,
                                children: [
                                  for (final panel in entry.value)
                                    _TestChip(
                                      label: panel.name,
                                      selected: _selectedTests.contains(
                                        panel.name,
                                      ),
                                      onTap:
                                          () => setState(() {
                                            if (!_selectedTests.remove(
                                              panel.name,
                                            ))
                                              _selectedTests.add(panel.name);
                                          }),
                                    ),
                                ],
                              ),
                              const SizedBox(height: AppSpacing.sm),
                            ],
                            if (_customTests.isNotEmpty)
                              Wrap(
                                spacing: AppSpacing.sm,
                                runSpacing: AppSpacing.sm,
                                children: [
                                  for (final test in _customTests)
                                    _TestChip(
                                      label: test,
                                      selected: _selectedTests.contains(test),
                                      onTap:
                                          () => setState(() {
                                            if (!_selectedTests.remove(test))
                                              _selectedTests.add(test);
                                          }),
                                    ),
                                ],
                              ),
                            // Sub-tests under each selected panel, as pills of
                            // the same shape the rest of this card uses. Run
                            // together as "A · B · C" behind a name and a
                            // colon, they read as one long test name rather
                            // than as the six things the panel measures.
                            for (final t in _selectedTests)
                              if ((labPanelFor(t)?.analytes ?? const [])
                                  .isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '$t includes',
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          color:
                                              Theme.of(
                                                context,
                                              ).colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Wrap(
                                        spacing: 6,
                                        runSpacing: 4,
                                        children: [
                                          for (final a
                                              in labPanelFor(t)!.analytes)
                                            _StatusPill(
                                              label: a,
                                              color:
                                                  Theme.of(context)
                                                      .colorScheme
                                                      .onSurfaceVariant,
                                            ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  _ActionCard(
                    icon: Icons.edit_note_rounded,
                    title: 'Clinical Advice',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Previous diagnoses + advice for this patient, tap to reuse —
                        // the reference the Clinical Advice card was missing (Medication
                        // has "currently on", Lab Tests has its history; this is the
                        // equivalent for advice).
                        _PreviousAdvice(
                          patientId: widget.patientId,
                          onReuseDiagnosis:
                              (t) => setState(() => _diagnosis.text = t),
                          onReuseAdvice:
                              (t) => setState(() => _advice.text = t),
                        ),
                        const _FieldLabel('Diagnosis'),
                        const SizedBox(height: 4),
                        TextField(
                          controller: _diagnosis,
                          minLines: 1,
                          maxLines: 4,
                          maxLength: 600,
                          textCapitalization: TextCapitalization.sentences,
                          decoration: const InputDecoration(
                            hintText:
                                'e.g. Type 2 DM, Hypertension (one per line)',
                            counterText: '',
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        const _FieldLabel('General advice'),
                        const SizedBox(height: 4),
                        TextField(
                          controller: _advice,
                          minLines: 3,
                          maxLines: 8,
                          maxLength: 2000,
                          textCapitalization: TextCapitalization.sentences,
                          decoration: const InputDecoration(
                            hintText:
                                'Diet, lifestyle and general instructions...',
                            counterText: '',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  _ActionCard(
                    icon: Icons.calendar_month_outlined,
                    title: 'Follow-up',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _FieldLabel('Next Visit'),
                        const SizedBox(height: 4),
                        _DateField(
                          date: _followUp,
                          onTap: _pickFollowUp,
                          onClear: () => setState(() => _followUp = null),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Two actions, one line. Draft is the quieter of the pair — a
                  // tonal fill against the brand one — because sending is what a
                  // consultation is for and saving is the escape hatch when the
                  // doctor is interrupted mid-form.
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: AppSpacing.minTapTarget + 12,
                          child: FilledButton.tonalIcon(
                            onPressed: _saving ? null : _saveDraft,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.accentSoftOn(context),
                              foregroundColor: AppColors.accentOn(context),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            icon: const Icon(
                              Icons.bookmark_outline_rounded,
                              size: 20,
                            ),
                            label: const Text(
                              'Save draft',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: SizedBox(
                          height: AppSpacing.minTapTarget + 12,
                          child: FilledButton.icon(
                            onPressed: _saving ? null : _send,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            icon:
                                _saving
                                    ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.4,
                                        color: Colors.white,
                                      ),
                                    )
                                    : const Icon(Icons.send_rounded, size: 20),
                            label: const Text(
                              'Send',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
        ),
      ),
    );
  }
}

// ---- Header ---------------------------------------------------------------

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.patient});

  final PatientSummary patient;

  static String _cap(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  static String? _diabetesLabel(String? t) => switch (t) {
    'type1' => 'Type 1 DM',
    'type2' => 'Type 2 DM',
    'gestational' => 'Gestational',
    'prediabetes' => 'Prediabetes',
    'none' => 'Non-diabetic',
    null => null,
    _ => t,
  };

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final scheme = Theme.of(context).colorScheme;
    final band = p.riskBand ?? 'low';
    final atRisk = band == 'high' || band == 'critical';
    // No patient ID here. The design showed one, but the only id available is a
    // truncation of the record id — not guaranteed unique, yet it reads like an
    // official number. The day someone quotes it on a lab form, a collision is
    // patient misidentification. A real clinic number would have to be stored,
    // sequential and unique; until it is, showing nothing is safer than showing
    // something that looks official and is not.
    final meta = [
      if (p.age != null) '${p.age} Yrs',
      if (p.gender != null) _cap(p.gender!),
      p.phone,
    ].where((s) => s.isNotEmpty).join('  •  ');
    final email = (p.email ?? '').trim();
    final diabetes = _diabetesLabel(p.diabetesType);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.55),
        ),
        boxShadow:
            Theme.of(context).brightness == Brightness.dark
                ? null
                : [
                  BoxShadow(
                    color: const Color(0xFF0B1B33).withValues(alpha: 0.06),
                    blurRadius: 16,
                    offset: const Offset(0, 5),
                  ),
                ],
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                name: p.name,
                avatarUrl: p.avatarUrl,
                accent: AppColors.accentOn(context),
                size: 62,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p.name,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      meta,
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (email.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(
                            Icons.mail_outline_rounded,
                            size: 14,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              email,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    if ((p.address ?? '').trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.home_outlined,
                            size: 14,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              p.address!.trim(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                height: 1.3,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: AppSpacing.sm),
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: 4,
                      children: [
                        _HeaderPill(
                          // The warning triangle appears only when the band
                          // earns it — a permanent icon stops being a warning.
                          icon: atRisk ? Icons.warning_amber_rounded : null,
                          label: '${_cap(band)} Risk',
                          fg: atRisk ? AppColors.danger : AppColors.primary,
                          bg:
                              atRisk
                                  ? AppColors.dangerBgOn(context)
                                  : Colors.white,
                        ),
                        if (diabetes != null)
                          _HeaderPill(
                            label: diabetes,
                            fg: AppColors.primary,
                            bg: AppColors.accentSoftOn(context),
                          ),
                        // One pill per allergy. Joined into a single label,
                        // four of them made one pill wider than the phone —
                        // and a Wrap cannot shrink a child that does not fit,
                        // it only lets it overflow.
                        for (final a in p.details.allergies)
                          _HeaderPill(
                            icon: Icons.block_rounded,
                            label: a,
                            fg: Colors.white,
                            bg: AppColors.danger,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // Three quiet ways to reach the patient, then the one thing the visit
          // is actually for. Four identical filled buttons in a 2x2 block gave
          // no hint which mattered — every option shouting equally is the same
          // as none of them shouting.
          Row(
            children: [
              _QuietAction(
                icon: Icons.call_rounded,
                label: 'Call',
                onTap: () => launchUrl(Uri(scheme: 'tel', path: p.phone)),
              ),
              const SizedBox(width: AppSpacing.sm),
              _QuietAction(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Message',
                onTap:
                    () => context.push(
                      '/clinician/patients/${p.id}/thread',
                      extra: p.name,
                    ),
              ),
              const SizedBox(width: AppSpacing.sm),
              // "Prescriptions", not "History". The screen behind it shows
              // every prescription in full — medicines, tests, advice — and
              // offers the PDF, but nobody looking for "view the
              // prescription" thinks to press a button marked History.
              _QuietAction(
                icon: Icons.description_outlined,
                label: 'Prescriptions',
                onTap:
                    () => context.push(
                      '/clinician/patients/${p.id}/prescriptions',
                      extra: p.name,
                    ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed:
                  () => context.push(
                    '/clinician/patients/${p.id}/consult',
                    extra: p.name,
                  ),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              icon: const Icon(Icons.medical_services_outlined, size: 20),
              label: const Text(
                'Start consultation',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
            ),
          ),
          if ((p.chiefComplaint ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap:
                    () =>
                        _showComplaintSheet(context, p.chiefComplaint!.trim()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.assignment_outlined,
                        size: 16,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              const TextSpan(
                                text: 'Complaint   ',
                                style: TextStyle(fontWeight: FontWeight.w800),
                              ),
                              TextSpan(text: p.chiefComplaint!.trim()),
                            ],
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14,
                            height: 1.35,
                            color: Colors.black87,
                          ),
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 18,
                        color: AppColors.primary,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

void _showComplaintSheet(BuildContext context, String text) {
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder:
        (ctx) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.xl,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.assignment_outlined, color: AppColors.primary),
                    const SizedBox(width: 8),
                    const Text(
                      'Presenting complaint',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Text(text, style: const TextStyle(fontSize: 14, height: 1.5)),
              ],
            ),
          ),
        ),
  );
}

class _QuietAction extends StatelessWidget {
  const _QuietAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Material(
        // A tinted plate on the card's white, so each action reads as a
        // target without needing a border round it.
        color: AppColors.accentSoftOn(context),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 20, color: AppColors.primary),
                const SizedBox(height: 4),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HeaderPill extends StatelessWidget {
  const _HeaderPill({
    required this.label,
    required this.fg,
    required this.bg,
    this.icon,
  });

  final String label;
  final Color fg;
  final Color bg;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      // Never wider than the screen it sits on. A pill carrying a value nobody
      // predicted — a long condition name, a hyphenated allergy — used to grow
      // until it ran off the edge.
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width - 64,
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: fg),
              const SizedBox(width: 4),
            ],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Action cards ---------------------------------------------------------

/// A collapsible sub-section inside an action card — the same ExpansionTile
/// treatment as the "Assistant context" card on the record screen, so the
/// prescribing form's inputs and the reference history tuck away until wanted.
class _Collapsible extends StatelessWidget {
  const _Collapsible({
    required this.title,
    this.subtitle,
    required this.children,
    this.icon,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
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
          leading:
              icon == null
                  ? null
                  : Icon(icon, size: 20, color: scheme.onSurfaceVariant),
          title: Text(
            title,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          subtitle:
              subtitle == null
                  ? null
                  : Text(
                    subtitle!,
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
          children: children,
        ),
      ),
    );
  }
}

/// Past diagnoses and general advice for this patient, newest first — a
/// collapsible reference (like the Assistant-context card) shown inside the
/// Clinical Advice section. Tapping an entry drops it into the field, so the
/// doctor reuses what they wrote before instead of retyping it.
class _PreviousAdvice extends ConsumerWidget {
  const _PreviousAdvice({
    required this.patientId,
    required this.onReuseDiagnosis,
    required this.onReuseAdvice,
  });

  final String patientId;
  final ValueChanged<String> onReuseDiagnosis;
  final ValueChanged<String> onReuseAdvice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list =
        ref.watch(patientPrescriptionsProvider(patientId)).valueOrNull ??
        const [];
    final withAdvice =
        list
            .where(
              (rx) =>
                  rx.diagnosis.isNotEmpty ||
                  (rx.generalAdvice?.trim().isNotEmpty ?? false),
            )
            .toList();
    if (withAdvice.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: _Collapsible(
        title: 'Previous advice',
        subtitle: 'Tap an entry to reuse it',
        icon: Icons.history_rounded,
        children: [
          for (final rx in withAdvice.take(8))
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rx.issuedOn != null
                        ? DateFormat('d MMM yyyy').format(rx.issuedOn!)
                        : '—',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (rx.diagnosis.isNotEmpty)
                    _ReuseLine(
                      label: 'Dx',
                      text: rx.diagnosis.join(', '),
                      onTap: () => onReuseDiagnosis(rx.diagnosis.join('\n')),
                    ),
                  if (rx.generalAdvice?.trim().isNotEmpty ?? false)
                    _ReuseLine(
                      label: 'Advice',
                      text: rx.generalAdvice!.trim(),
                      onTap: () => onReuseAdvice(rx.generalAdvice!.trim()),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// One tappable previous-advice line: a small label chip, the text, and a "＋"
/// that says tapping fills the field with it.
class _ReuseLine extends StatelessWidget {
  const _ReuseLine({
    required this.label,
    required this.text,
    required this.onTap,
  });

  final String label;
  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 0, right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
              decoration: BoxDecoration(
                color: AppColors.accentSoftOn(context),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.accentOn(context),
                ),
              ),
            ),
            Expanded(
              child: Text(
                text,
                style: const TextStyle(fontSize: 14, height: 1.35),
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.add_circle_outline_rounded,
              size: 16,
              color: AppColors.accentOn(context),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 21, color: scheme.onSurface),
              const SizedBox(width: AppSpacing.sm),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Divider(
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.7),
          ),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}

/// The patient's running medication list, with a way to stop any of them.
///
/// Stopping is a soft stop on the server: the medicine is marked inactive with
/// an end date rather than deleted, so the doses already logged against it — and
/// the adherence figure built from them — stay interpretable.
class _CurrentMedicines extends ConsumerWidget {
  const _CurrentMedicines({required this.patientId});

  final String patientId;

  Future<void> _stop(
    BuildContext context,
    WidgetRef ref,
    Medication med,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text('Stop ${med.name}?'),
            content: const Text(
              'The patient stops being reminded about it from now on. Doses already '
              'recorded are kept.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Stop it'),
              ),
            ],
          ),
    );
    if (confirmed != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .stopMedication(patientId, med.id);
      ref.invalidate(patientMedicationsProvider(patientId));
      messenger.showSnackBar(SnackBar(content: Text('${med.name} stopped')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(patientMedicationsProvider(patientId));

    return async.when(
      loading:
          () => const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.md),
            child: LinearProgressIndicator(minHeight: 2),
          ),
      // A failure here must not read as "no medicines" — that is the one
      // wrong answer a prescribing screen can give.
      error:
          (_, _) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Row(
              children: [
                Icon(
                  Icons.error_outline_rounded,
                  size: 17,
                  color: AppColors.dangerOn(context),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Could not load current medicines.',
                    style: TextStyle(
                      fontSize: 14,
                      color: AppColors.dangerOn(context),
                    ),
                  ),
                ),
                TextButton(
                  onPressed:
                      () =>
                          ref.invalidate(patientMedicationsProvider(patientId)),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
      data: (meds) {
        final active = meds.where((m) => m.isActive).toList();
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'CURRENTLY ON',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${active.length}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: AppColors.accentOn(context),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              if (active.isEmpty)
                Text(
                  'Nothing prescribed yet.',
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                )
              else
                for (final med in active)
                  Container(
                    margin: const EdgeInsets.only(bottom: 4),
                    padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: scheme.outlineVariant.withValues(alpha: 0.6),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                [
                                  med.name,
                                  formatStrength(med.strength),
                                ].where((s) => s.isNotEmpty).join(' '),
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 0),
                              Text(
                                [
                                  if (med.dose.isNotEmpty) med.dose,
                                  med.doseSummary,
                                  if (med.schedule.isNotEmpty)
                                    med.schedule.map((s) => s.time).join(', '),
                                ].join(' · '),
                                style: TextStyle(
                                  fontSize: 14,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                              // Shown where the strength disagrees with what
                              // the clinic's brand list records. A statement of
                              // both figures, not a correction: the record is
                              // left exactly as the doctor wrote it, and only a
                              // person changes a dose.
                              if (med.hasStrengthMismatch) ...[
                                const SizedBox(height: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 9,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppColors.warningOn(
                                      context,
                                    ).withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Icon(
                                        Icons.warning_amber_rounded,
                                        size: 15,
                                        color: AppColors.warningOn(context),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          med.strength.trim().isEmpty
                                              ? 'No strength recorded. '
                                                  '${med.strengthExpected} per our records'
                                                  '${(med.strengthComposition ?? '').isEmpty ? '' : ' (${med.strengthComposition})'}.'
                                              : 'Recorded as ${med.strengthExpected}'
                                                  '${(med.strengthComposition ?? '').isEmpty ? '' : ' (${med.strengthComposition})'}.',
                                          style: TextStyle(
                                            fontSize: 12.5,
                                            height: 1.35,
                                            color: scheme.onSurface,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.dangerOn(context),
                            visualDensity: VisualDensity.compact,
                          ),
                          onPressed: () => _stop(context, ref, med),
                          child: const Text(
                            'Stop',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        );
      },
    );
  }
}

/// What has already been ordered for this patient, and what has come back.
class _TestHistory extends StatefulWidget {
  const _TestHistory({required this.summary});

  final PatientSummary summary;

  @override
  State<_TestHistory> createState() => _TestHistoryState();
}

class _TestHistoryState extends State<_TestHistory> {
  /// Four each, like the HbA1c history on the record screen. Eleven ordered
  /// tests above ten uploaded reports filled the card several times over, and
  /// everything under it — the advice, the follow-up — went below the fold.
  static const _cap = 4;
  bool _allOrdered = false;
  bool _allUploaded = false;

  @override
  Widget build(BuildContext context) {
    final summary = widget.summary;
    final scheme = Theme.of(context).colorScheme;
    final advised = summary.advisedTests;
    final reports = summary.labResults;
    if (advised.isEmpty && reports.isEmpty) return const SizedBox.shrink();

    // A test counts as back when a report carries its name. Matched loosely,
    // because the patient types the name when they upload against "Other".
    bool sameTest(String a, String b) =>
        a.trim().toLowerCase() == b.trim().toLowerCase();
    LabReport? reportFor(String test) {
      for (final r in reports) {
        if (sameTest(r.testName, test)) return r;
      }
      return null;
    }

    // Ordered and received, in one list rather than two.
    //
    // Split apart, the doctor had to read a name in the first block, find the
    // same name in the second, and work out for themselves whether the report
    // that came back was the test they asked for. Each ordered test now
    // carries its own state, and its report where it has one.
    final unmatched =
        reports
            .where((r) => !advised.any((t) => sameTest(t, r.testName)))
            .toList();

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (advised.isNotEmpty) ...[
            Row(
              children: [
                Expanded(
                  child: _MicroHeading('TESTS ORDERED', count: advised.length),
                ),
                if (advised.length > _cap)
                  TextButton(
                    onPressed: () => setState(() => _allOrdered = !_allOrdered),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    child: Text(
                      _allOrdered
                          ? 'Show less'
                          : 'View all (${advised.length})',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            for (final t in (_allOrdered ? advised : advised.take(_cap)))
              _LabTestRow(test: t, report: reportFor(t)),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (unmatched.isNotEmpty) ...[
            // Reports the patient uploaded against nothing the clinic ordered.
            // Worth surfacing on their own — an outside test the doctor never
            // asked for is exactly the sort of thing that goes unread.
            Row(
              children: [
                Expanded(
                  child: _MicroHeading(
                    'ALSO UPLOADED',
                    count: unmatched.length,
                  ),
                ),
                if (unmatched.length > _cap)
                  TextButton(
                    onPressed:
                        () => setState(() => _allUploaded = !_allUploaded),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    child: Text(
                      _allUploaded
                          ? 'Show less'
                          : 'View all (${unmatched.length})',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            for (final r in (_allUploaded ? unmatched : unmatched.take(_cap)))
              _LabTestRow(test: r.testName, report: r),
            const SizedBox(height: AppSpacing.sm),
          ],
          Divider(
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ],
      ),
    );
  }
}

/// One ordered test and whatever has come back for it.
///
/// Awaiting or received is the whole question the doctor is asking of this
/// card, so it is a pill on the row rather than something to be inferred from
/// which of two lists the name appears in.
class _LabTestRow extends StatelessWidget {
  const _LabTestRow({required this.test, required this.report});

  final String test;
  final LabReport? report;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final r = report;
    final back = r != null;
    final analytes = labPanelFor(test)?.analytes ?? const <String>[];

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (back && r.hasFile && r.isImage)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: AuthedImage(
                path: r.photoUrl!,
                width: 40,
                height: 40,
                radius: 8,
              ),
            )
          else
            Container(
              width: 40,
              height: 40,
              margin: const EdgeInsets.only(right: AppSpacing.sm),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                back
                    ? Icons.description_outlined
                    : Icons.hourglass_empty_rounded,
                size: 19,
                color:
                    back
                        ? scheme.onSurfaceVariant
                        : AppColors.warningOn(context),
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        test,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    _StatusPill(
                      label: back ? 'Received' : 'Awaiting',
                      color:
                          back
                              ? AppColors.successOn(context)
                              : AppColors.warningOn(context),
                    ),
                  ],
                ),
                if (back && r.createdAt != null)
                  Text(
                    DateFormat('d MMM yyyy').format(r.createdAt!),
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  )
                else if (analytes.isNotEmpty)
                  // What the report will include, in the same pill shape the
                  // catalogue above uses. Run together as "A · B · C" the
                  // sub-tests read as one long name for the panel.
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        for (final a in analytes)
                          _StatusPill(label: a, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A small outlined pill. One shape for every sub-metric and status on this
/// card, so nothing on it has to be read twice to work out what kind of thing
/// it is.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

class _MicroHeading extends StatelessWidget {
  const _MicroHeading(this.text, {this.count});

  final String text;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          text,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: scheme.onSurfaceVariant,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 4),
          Text(
            '$count',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: AppColors.accentOn(context),
            ),
          ),
        ],
      ],
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Text(
      text,
      style: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: scheme.onSurfaceVariant,
      ),
    );
  }
}

/// A plain text field. Deliberately no magnifier anywhere on this screen: there
/// is no lookup behind these fields, and a search icon over a field that only
/// accepts what you type is a promise the form cannot keep — the doctor types
/// three letters, waits for a dropdown, and nothing comes.
class _PlainField extends StatelessWidget {
  const _PlainField({
    required this.controller,
    required this.hint,
    this.icon,
    this.textInputAction = TextInputAction.next,
    this.onSubmitted,
    this.focusNode,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final String hint;
  final IconData? icon;
  final TextInputAction textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      focusNode: focusNode,
      textCapitalization: TextCapitalization.words,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(
        hintText: hint,
        isDense: true,
        prefixIcon:
            icon == null
                ? null
                : Icon(icon, size: 20, color: scheme.onSurfaceVariant),
        prefixIconConstraints: const BoxConstraints(minWidth: 42),
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
      ),
    );
  }
}

// ---- Medication -----------------------------------------------------------

/// One medicine being written. The doctor picks in medical shorthand
/// (frequency + meal relation + route); the composed short form ("BDPC") and the
/// patient's plain phrase ("Twice a day, after food") both come from
/// [med_shorthand], so the two can never drift.
class _MedDraft {
  final name = TextEditingController();
  final dosage = TextEditingController();
  final duration = TextEditingController();
  DoseFrequency frequency = DoseFrequency.bd;
  MealRelation relation = MealRelation.after;
  MedRoute route = MedRoute.oral;

  String get shorthand =>
      composeShorthand(frequency: frequency, relation: relation, route: route);
  String get plain =>
      expandToPlain(frequency: frequency, relation: relation, route: route);

  void dispose() {
    name.dispose();
    dosage.dispose();
    duration.dispose();
  }
}

class _MedFields extends StatelessWidget {
  const _MedFields({
    required this.draft,
    required this.onChanged,
    required this.onRemove,
  });

  final _MedDraft draft;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: _FieldLabel('Medicine Name')),
              if (onRemove != null)
                InkWell(
                  onTap: onRemove,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      Icons.close_rounded,
                      size: 18,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          _PlainField(controller: draft.name, hint: 'e.g. Metformin'),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _FieldLabel('Dosage'),
                    const SizedBox(height: 4),
                    StrengthField(controller: draft.dosage, label: ''),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _FieldLabel('Duration (days)'),
                    const SizedBox(height: 4),
                    TextField(
                      controller: draft.duration,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        hintText: 'e.g. 14',
                        isDense: true,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              const _FieldLabel('Frequency'),
              const Spacer(),
              // Live composed medical shorthand, e.g. "BDPC" / "TDS AC" / "HS".
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.accentSoftOn(context),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  draft.shorthand,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.accentOn(context),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final f in DoseFrequency.values)
                _ShChip(
                  label: f.code,
                  selected: draft.frequency == f,
                  onTap: () {
                    draft.frequency = f;
                    onChanged();
                  },
                ),
            ],
          ),
          if (draft.frequency.takesMealRelation) ...[
            const SizedBox(height: AppSpacing.sm),
            const _FieldLabel('Timing'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                for (final r in MealRelation.values)
                  _ShChip(
                    label: _relLabel(r),
                    selected: draft.relation == r,
                    onTap: () {
                      draft.relation = r;
                      onChanged();
                    },
                  ),
              ],
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          const _FieldLabel('Route'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final rt in MedRoute.values)
                _ShChip(
                  label: rt.code,
                  selected: draft.route == rt,
                  onTap: () {
                    draft.route = rt;
                    onChanged();
                  },
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Patient sees: ${draft.plain}',
            style: TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

String _relLabel(MealRelation r) => switch (r) {
  MealRelation.anytime => 'Any',
  MealRelation.before => 'AC',
  MealRelation.withFood => 'With',
  MealRelation.after => 'PC',
};

/// A small selectable shorthand chip (frequency / timing / route).
class _ShChip extends StatelessWidget {
  const _ShChip({
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
    return Material(
      color:
          selected
              ? AppColors.accentSoftOn(context)
              : scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color:
                  selected
                      ? AppColors.primary.withValues(alpha: 0.45)
                      : scheme.outlineVariant,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: selected ? AppColors.primary : scheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

// ---- Lab tests ------------------------------------------------------------

class _TestChip extends StatelessWidget {
  const _TestChip({
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
    return Material(
      color:
          selected
              ? AppColors.accentSoftOn(context)
              : scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color:
                  selected
                      ? AppColors.primary.withValues(alpha: 0.45)
                      : scheme.outlineVariant,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? AppColors.primary : scheme.onSurface,
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 4),
                Icon(
                  Icons.close_rounded,
                  size: 15,
                  color: AppColors.accentOn(context),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---- Follow-up ------------------------------------------------------------

class _DateField extends StatelessWidget {
  const _DateField({
    required this.date,
    required this.onTap,
    required this.onClear,
  });

  final DateTime? date;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                date == null
                    ? 'dd/mm/yyyy'
                    : DateFormat('EEE, d MMM yyyy').format(date!),
                style: TextStyle(
                  fontSize: 16,
                  color:
                      date == null ? scheme.onSurfaceVariant : scheme.onSurface,
                ),
              ),
            ),
            if (date != null)
              InkWell(
                onTap: onClear,
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Icon(
                    Icons.close_rounded,
                    size: 19,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            Icon(
              Icons.calendar_today_outlined,
              size: 20,
              color: scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

/// A small text action beside a group of test chips.
///
/// Text rather than another chip: it sits in a field of chips and has to be
/// clearly not one of them, or a doctor in a hurry orders "Select all" as
/// though it were a test.
class _TestBulkAction extends StatelessWidget {
  const _TestBulkAction({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = AppColors.accentOn(context);
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: accent,
            ),
          ),
        ),
      ),
    );
  }
}

/// The lab-test field, with the catalog behind it.
///
/// Matches the medicine field's behaviour on the same screen — type, pick,
/// done — so the two prescribing inputs work the same way. Anything not in the
/// catalog is still accepted verbatim on submit: the clinic orders tests this
/// list has never heard of, and a picker that refused them would be worse than
/// the plain field it replaced.
class _LabSearchField extends StatefulWidget {
  const _LabSearchField({
    required this.controller,
    required this.onPanelPicked,
    required this.onSubmitted,
  });

  final TextEditingController controller;
  final ValueChanged<LabPanel> onPanelPicked;
  final VoidCallback onSubmitted;

  @override
  State<_LabSearchField> createState() => _LabSearchFieldState();
}

class _LabSearchFieldState extends State<_LabSearchField> {
  // Owned and disposed here. RawAutocomplete needs a node whose life matches
  // the field's; one built inside build() is a fresh node every frame, which
  // drops focus mid-typing and leaks the old one.
  final FocusNode _focus = FocusNode();

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<LabPanel>(
      textEditingController: widget.controller,
      focusNode: _focus,
      // Local, so it answers on the first keystroke with no network and no
      // spinner — the catalog ships with the app.
      optionsBuilder: (value) => searchLabPanels(value.text),
      displayStringForOption: (p) => p.name,
      onSelected: widget.onPanelPicked,
      fieldViewBuilder:
          (context, textController, focusNode, onFieldSubmit) => _PlainField(
            controller: textController,
            focusNode: focusNode,
            hint: 'Search or add a test',
            icon: Icons.search_rounded,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => widget.onSubmitted(),
          ),
      optionsViewBuilder: (context, onSelected, options) {
        final scheme = Theme.of(context).colorScheme;
        final q = widget.controller.text;
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 3,
            borderRadius: BorderRadius.circular(12),
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260, maxWidth: 420),
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: options.length,
                itemBuilder: (context, i) {
                  final p = options.elementAt(i);
                  return ListTile(
                    dense: true,
                    title: Text(
                      p.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    // Why this one surfaced. Typing "ldl" and being offered
                    // "Lipid Profile" looks like a misfire until the row says
                    // "Includes LDL".
                    subtitle: Text(
                      labMatchReason(p, q),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    onTap: () => onSelected(p),
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
