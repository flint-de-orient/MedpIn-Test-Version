import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/submission_keys.dart';
import '../../../core/router/area.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';
import '../domain/patient_summary.dart';
import 'clinician_providers.dart';
import 'patient_detail_screen.dart' show PatientRecordSections;
import 'widgets/load_states.dart';
import 'widgets/record_ui.dart';
import 'widgets/sharing_notice.dart';

/// One patient's record: who they are, what this visit turns on, and the
/// history behind it — for the doctor, and for the front desk.
///
/// ---- One way to prescribe -------------------------------------------------
///
/// This screen used to end in its own prescribing form — medicines, tests,
/// advice, follow-up, Send — under a button that opened a second, fuller one:
/// the consultation, with vitals, a structured diagnosis, the doctor's
/// signature, a strength check against the clinic's medicine list, and a key
/// that stops a retried submit being written twice. Two ways to do the main
/// thing, one of them missing the safeguards, is the overlapping-actions
/// problem in its most expensive form. Start consultation is now the one way,
/// and the consultation picks up a draft saved from the old form.
///
/// ---- Keeping what is known -------------------------------------------------
///
/// The record refreshes itself every fifteen seconds. A refresh that cannot
/// reach the server keeps the record on screen and says how old it is; a
/// refusal — consent withdrawn, access ended — replaces it, because showing
/// what the practice may no longer see is the one thing a refusal is for.
class PatientProfileScreen extends ConsumerStatefulWidget {
  const PatientProfileScreen({super.key, required this.patientId});

  final String patientId;

  @override
  ConsumerState<PatientProfileScreen> createState() =>
      _PatientProfileScreenState();
}

class _PatientProfileScreenState extends ConsumerState<PatientProfileScreen> {
  PatientSummary? _last;
  DateTime? _loadedAt;

  void _refresh() {
    ref.invalidate(patientSummaryProvider(widget.patientId));
    ref.invalidate(patientPrescriptionsProvider(widget.patientId));
    ref.invalidate(patientMedicationsProvider(widget.patientId));
  }

  @override
  Widget build(BuildContext context) {
    final isDesk = areaPrefix(ref) == '/staff';
    final async = ref.watch(patientSummaryProvider(widget.patientId));
    const what = 'this patient’s record';

    final fresh = async.valueOrNull;
    if (fresh != null && !async.hasError && !identical(fresh, _last)) {
      _last = fresh;
      _loadedAt = DateTime.now();
    }
    final error = async.hasError && !async.isLoading ? async.error : null;
    final failure = error == null ? null : Failure.of(error, what: what);

    final Widget body;
    if (failure != null && (!failure.keepsData || fresh == null)) {
      body = FailurePanel(error: error!, what: what, onRetry: _refresh);
    } else if (fresh == null) {
      body = const _RecordSkeleton();
    } else {
      final caps = ref.watch(capabilitySetProvider);
      // The doctor's own act. Not hidden to keep a secret — the server refuses
      // a prescription from anyone without PRESCRIBE — but because a button
      // that always fails is worse than none.
      final canConsult =
          !isDesk && caps.can(Perm.prescribe) && caps.has(Cap.prescription);
      body = RefreshIndicator(
        onRefresh: () async => _refresh(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12),
          children: [
            if (error != null) ...[
              StaleNotice(
                error: error,
                what: 'this record',
                loadedAt: _loadedAt,
                onRetry: _refresh,
              ),
              const SizedBox(height: T.s3),
            ],
            _RecordHeader(
              patient: fresh,
              isDesk: isDesk,
              canConsult: canConsult,
            ),
            const SizedBox(height: T.s4),
            // What the patient has not shared with this practice, said before
            // the record below can be read as the whole of it (C8).
            SharingNotice(patientId: widget.patientId),
            PatientRecordSections(
              summary: fresh,
              patientId: widget.patientId,
              isDesk: isDesk,
            ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: T.surface,
      appBar: AppBar(
        backgroundColor: T.surface,
        title: const Text('Patient record'),
      ),
      body: AutoRefresh(
        // The record is made of other people's actions — a reading logged, a
        // report read, a plan sent — so it is kept current while it is open.
        onTick: (_) => _refresh(),
        child: body,
      ),
    );
  }
}

/// "+91 98300 11122" for an Indian mobile number, anything else as stored.
String displayPhone(String raw) {
  final digits = raw.replaceAll(RegExp(r'[^0-9+]'), '');
  final m = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(digits);
  return m == null ? raw : '+91 ${m.group(1)} ${m.group(2)}';
}

/// Who the patient is, what is known to be wrong, and what can be done.
class _RecordHeader extends ConsumerWidget {
  const _RecordHeader({
    required this.patient,
    required this.isDesk,
    required this.canConsult,
  });

  final PatientSummary patient;
  final bool isDesk;
  final bool canConsult;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = patient;
    final area = areaPrefix(ref);
    final ageSex = ageAndSex(p);
    final conditions = conditionLabels(p);
    final risk = riskReading(
      p.riskBand,
      computed: p.riskComputedAt != null || p.riskReasons.isNotEmpty,
    );
    final allergies =
        p.details.allergies
            .map((a) => a.trim())
            .where((a) => a.isNotEmpty)
            .toList();
    final complaint = (p.chiefComplaint ?? '').trim();

    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                name: nameForInitial(p.name),
                avatarUrl: p.avatarUrl,
                accent: T.primary,
                size: T.s12 + T.s2,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(
                        p.name,
                        style: T.title.copyWith(color: T.ink),
                      ),
                    ),
                    if (ageSex.isNotEmpty)
                      Text(ageSex, style: T.body.copyWith(color: T.inkMuted)),
                    if (p.phone.isNotEmpty)
                      Text(
                        displayPhone(p.phone),
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (risk != null) ...[
            const SizedBox(height: T.s3),
            Align(
              alignment: Alignment.centerLeft,
              child: StatusPill(label: risk.word, status: risk.status),
            ),
            // Why, in the server's words — only when it has said. Reasons the
            // app made up would be a second risk instrument nobody validated.
            if (p.riskReasons.isNotEmpty) ...[
              const SizedBox(height: T.s1),
              for (final reason in p.riskReasons)
                Padding(
                  padding: const EdgeInsets.only(top: T.s1),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('•  ', style: T.small.copyWith(color: T.inkMuted)),
                      Expanded(
                        child: Text(
                          reason,
                          style: T.small.copyWith(color: T.ink),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ],
          if (conditions.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [for (final c in conditions) RecordTag(label: c)],
            ),
          ],
          if (allergies.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              tone: T.dangerTint,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.block_rounded, color: T.danger),
                  const SizedBox(width: T.s2),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text:
                                allergies.length == 1
                                    ? 'Allergy: '
                                    : 'Allergies: ',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          TextSpan(text: allergies.join(', ')),
                        ],
                      ),
                      style: T.body.copyWith(color: T.danger),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (complaint.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Presenting complaint',
                    style: T.label.copyWith(color: T.inkMuted),
                  ),
                  Text(complaint, style: T.body.copyWith(color: T.ink)),
                ],
              ),
            ),
          ],
          const SizedBox(height: T.s4),
          if (canConsult)
            FilledButton.icon(
              onPressed:
                  () => context.push(
                    '$area/patients/${p.id}/consult',
                    extra: p.name,
                  ),
              style: FilledButton.styleFrom(
                backgroundColor: T.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(T.hControl),
              ),
              icon: const Icon(Icons.medical_services_outlined),
              label: const Text('Start consultation'),
            )
          else if (isDesk)
            // Height, weight and blood pressure are taken at the counter,
            // before the patient goes in: the desk's half of this visit.
            FilledButton.icon(
              onPressed: () => _DeskVitalsSheet.show(context, p.id),
              style: FilledButton.styleFrom(
                backgroundColor: T.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(T.hControl),
              ),
              icon: const Icon(Icons.monitor_weight_outlined),
              label: const Text('Record measurements'),
            ),
          if (canConsult || isDesk) const SizedBox(height: T.s2),
          // Two ways to reach the patient, sharing the row equally. The
          // prescriptions are opened from the last consultation, which is
          // where a reader looking for one already is — three quiet buttons
          // here wrapped two and one.
          QuietActionRow(
            actions: [
              QuietAction(
                icon: Icons.call_outlined,
                label: 'Call',
                onPressed:
                    p.phone.isEmpty
                        ? null
                        : () => launchUrl(Uri(scheme: 'tel', path: p.phone)),
              ),
              QuietAction(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Message',
                onPressed:
                    () => context.push(
                      '$area/patients/${p.id}/thread',
                      extra: p.name,
                    ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The shape of the record while it loads.
class _RecordSkeleton extends StatelessWidget {
  const _RecordSkeleton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading the patient record',
      child: ListView(
        padding: const EdgeInsets.all(T.s4),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          SectionCard(
            padding: const EdgeInsets.all(T.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: T.s12 + T.s2,
                      height: T.s12 + T.s2,
                      decoration: const BoxDecoration(
                        color: T.line,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: T.s3),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonLine(width: 180, height: T.s5),
                          SizedBox(height: T.s2),
                          SkeletonLine(width: 120),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: T.s4),
                const SkeletonLine(height: T.hControl),
              ],
            ),
          ),
          const SizedBox(height: T.s4),
          const SectionCard(
            padding: EdgeInsets.all(T.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonLine(width: 160, height: T.s5),
                SizedBox(height: T.s4),
                SkeletonLine(),
                SizedBox(height: T.s2),
                SkeletonLine(),
                SizedBox(height: T.s2),
                SkeletonLine(width: 200),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Height, weight, blood pressure, pulse and glucose, taken at the desk.
///
/// The server has always accepted these from a staff account, and
/// deliberately: the scale and the cuff are at the counter, and making the
/// doctor re-enter a measurement is how a consultation starts late.
///
/// Every field is optional and nothing is written for one left blank — a desk
/// that only had time for a weight records only a weight.
class _DeskVitalsSheet extends ConsumerStatefulWidget {
  const _DeskVitalsSheet({required this.patientId});

  final String patientId;

  static Future<void> show(BuildContext context, String patientId) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => _DeskVitalsSheet(patientId: patientId),
      );

  @override
  ConsumerState<_DeskVitalsSheet> createState() => _DeskVitalsSheetState();
}

class _DeskVitalsSheetState extends ConsumerState<_DeskVitalsSheet> {
  final _height = TextEditingController();
  final _weight = TextEditingController();
  final _waist = TextEditingController();
  final _systolic = TextEditingController();
  final _diastolic = TextEditingController();
  final _pulse = TextEditingController();
  final _glucose = TextEditingController();

  /// One key for this sheet: a save retried after a timeout is answered with
  /// what was already recorded, not written a second time.
  final _submission = SubmissionKeys();
  bool _saving = false;

  List<TextEditingController> get _all => [
    _height,
    _weight,
    _waist,
    _systolic,
    _diastolic,
    _pulse,
    _glucose,
  ];

  @override
  void dispose() {
    for (final c in _all) {
      c.dispose();
    }
    super.dispose();
  }

  double? _dbl(TextEditingController c) => double.tryParse(c.text.trim());
  int? _int(TextEditingController c) => int.tryParse(c.text.trim());

  bool get _anything => _all.any((c) => c.text.trim().isNotEmpty);

  Future<void> _save() async {
    if (!_anything || _saving) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .recordConsultVitals(
            patientId: widget.patientId,
            heightCm: _dbl(_height),
            weightKg: _dbl(_weight),
            waistCm: _dbl(_waist),
            systolic: _int(_systolic),
            diastolic: _int(_diastolic),
            pulse: _int(_pulse),
            glucoseMgDl: _int(_glucose),
            submission: _submission,
          );
      ref.invalidate(patientSummaryProvider(widget.patientId));
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(content: Text('Measurements recorded')),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException
                ? e.message
                : 'Could not save the measurements. Please try again.',
          ),
        ),
      );
    } finally {
      // In the `finally`: a failure must never leave the button spinning with
      // what was typed trapped behind it.
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Record measurements',
                style: T.title.copyWith(color: T.ink),
              ),
              Text(
                'Fill in only what you measured. It goes into the patient’s '
                'record and their trends.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: T.s4),
              _pair(
                _num(_height, 'Height', 'cm'),
                _num(_weight, 'Weight', 'kg'),
              ),
              const SizedBox(height: T.s3),
              _pair(
                _num(_systolic, 'Systolic', 'mmHg', integer: true),
                _num(_diastolic, 'Diastolic', 'mmHg', integer: true),
              ),
              const SizedBox(height: T.s3),
              _pair(
                _num(_pulse, 'Pulse', 'bpm', integer: true),
                _num(_waist, 'Waist', 'cm'),
              ),
              const SizedBox(height: T.s3),
              _num(_glucose, 'Glucose', 'mg/dL', integer: true),
              const SizedBox(height: T.s5),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed:
                          _saving ? null : () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, T.hControl),
                      ),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: FilledButton(
                      onPressed: _saving || !_anything ? null : _save,
                      style: FilledButton.styleFrom(
                        backgroundColor: T.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, T.hControl),
                      ),
                      child:
                          _saving
                              ? const SizedBox(
                                width: T.s5,
                                height: T.s5,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                              : const Text('Save'),
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

  /// Two fields side by side, or stacked when the text is too large for both.
  Widget _pair(Widget a, Widget b) {
    final big = MediaQuery.textScalerOf(context).scale(T.s4) > T.s4 * 1.4;
    if (big) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [a, const SizedBox(height: T.s3), b],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: a),
        const SizedBox(width: T.s3),
        Expanded(child: b),
      ],
    );
  }

  Widget _num(
    TextEditingController c,
    String label,
    String unit, {
    bool integer = false,
  }) => TextField(
    controller: c,
    keyboardType: TextInputType.numberWithOptions(decimal: !integer),
    inputFormatters: [
      integer
          ? FilteringTextInputFormatter.digitsOnly
          : FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
      LengthLimitingTextInputFormatter(6),
    ],
    onChanged: (_) => setState(() {}),
    decoration: InputDecoration(labelText: label, suffixText: unit),
  );
}
