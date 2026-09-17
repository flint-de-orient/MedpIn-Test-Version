import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/config/app_config.dart';
import '../../../core/router/area.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/disclosure_tile.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinician_repository.dart';
import '../domain/patient_summary.dart';
import 'clinician_providers.dart';
import 'widgets/current_medicines.dart';
import 'widgets/ecg_section.dart';
import 'widgets/load_states.dart';
import 'widgets/record_focus.dart';
import 'widgets/record_ui.dart';
import 'widgets/sparkline.dart';

/// The patient record under its header: what needs attention, what this visit
/// turns on, then the history behind it.
///
/// ---- The order is the argument ----------------------------------------------
///
/// This was a stack of equal cards in the order they were built: six metric
/// tiles, measurements, the dietician, HbA1c history, every uploaded report,
/// ECGs, alerts, twelve past consultations and the assistant's context — and
/// only then, five screens down, the medicines the patient is on. A doctor
/// reads top-down and stops when the patient sits down, so the order has to
/// survive that:
///
///  1. open alerts, if there are any;
///  2. the card for the reader's department — glucose control, heart and blood
///     pressure, or vitals (see record_focus.dart);
///  3. medicines, the last consultation, tests ordered and what came back;
///  4. measurements the leading card did not show, and the other departments'
///     cards where the patient has something in them;
///  5. history and details, folded.
///
/// ---- One fact, one place ------------------------------------------------------
///
/// The old record said "3 active medicines" in a tile above a list of three
/// medicines, showed the latest HbA1c in a tile and again at the top of the
/// HbA1c history, and repeated every report's values under the tests ordered.
/// Each fact is now said once: the history of a figure opens from the figure,
/// and the values of a report live with the report.
class PatientRecordSections extends ConsumerWidget {
  const PatientRecordSections({
    super.key,
    required this.summary,
    required this.patientId,
    this.isDesk = false,
  });

  final PatientSummary summary;
  final String patientId;

  /// The front desk reads the record and changes no prescription.
  final bool isDesk;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = summary;
    final caps = ref.watch(capabilitySetProvider);
    final focus = recordFocusFor(caps, p);
    final canStop = !isDesk && caps.can(Perm.prescribe);

    void openAdherence() => _showAdherenceSheet(context, p);
    void openHba1c() => _showHba1cSheet(context, p.hba1cHistory);

    // Decided here rather than by each card shrinking itself, so the gaps
    // between cards stay even when one has nothing to say.
    final ecgs = ref.watch(patientEcgsProvider(patientId));
    final showEcgCard =
        focus != RecordFocus.cardiology &&
        (caps.can(Perm.editRecord) ||
            ecgs.hasError ||
            (ecgs.valueOrNull?.isNotEmpty ?? false));
    final hasOpenAlerts = p.alerts.any((a) => a.status == 'open');

    final alerts = hasOpenAlerts ? OpenAlertsCard(alerts: p.alerts) : null;
    final lead = switch (focus) {
      RecordFocus.diabetes => GlucoseControlCard(
        summary: p,
        onOpenAdherence: openAdherence,
        onOpenHba1c: openHba1c,
      ),
      RecordFocus.cardiology => HeartCard(
        summary: p,
        onOpenAdherence: openAdherence,
      ),
      RecordFocus.general => VitalsCard(
        summary: p,
        onOpenAdherence: openAdherence,
      ),
    };
    final medicines = MedicinesCard(patientId: patientId, allowStop: canStop);
    final lastVisit = _LastConsultationCard(
      patientId: patientId,
      patientName: p.name,
    );
    final tests = p.advisedTests.isEmpty ? null : OrderedTestsCard(summary: p);
    final reports =
        p.labResults.isEmpty ? null : _TestReportsCard(reports: p.labResults);
    final measurements =
        _hasMeasurements(p, focus)
            ? MeasurementsCard(summary: p, focus: focus)
            : null;
    final glucose =
        focus != RecordFocus.diabetes && hasDiabetesRecord(p)
            ? GlucoseControlCard(
              summary: p,
              onOpenAdherence: openAdherence,
              onOpenHba1c: openHba1c,
              leading: false,
            )
            : null;
    final ecg = showEcgCard ? EcgSection(patientId: patientId, framed: true) : null;
    // In a card of its own, so it sits on the record the way every other
    // section does. The section itself is unchanged.
    final dietician = SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: _DieticianSection(summary: p, patientId: patientId),
    );
    final history = _HistoryCard(summary: p);

    final ordered = switch (focus) {
      RecordFocus.diabetes => [
        alerts, lead, medicines, lastVisit, tests, reports, measurements, ecg,
        dietician, history,
      ],
      RecordFocus.cardiology => [
        alerts, lead, medicines, lastVisit, tests, reports, measurements,
        glucose, dietician, history,
      ],
      // A general consultation starts from the vitals and from what was
      // decided last time — the follow-up — and the recent results.
      RecordFocus.general => [
        alerts, lead, lastVisit, tests, reports, medicines, measurements,
        glucose, ecg, dietician, history,
      ],
    }.whereType<Widget>().toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < ordered.length; i++) ...[
          if (i > 0) const SizedBox(height: T.s4),
          ordered[i],
        ],
      ],
    );
  }

  static bool _hasMeasurements(PatientSummary p, RecordFocus focus) {
    final leadHasVitals = focus != RecordFocus.diabetes;
    final leadHasWeight = focus == RecordFocus.general;
    return (!leadHasVitals &&
            ((p.systolic != null && p.diastolic != null) ||
                p.pulse != null ||
                p.spo2 != null)) ||
        (!leadHasWeight && p.weightKg != null) ||
        p.waistCm != null ||
        p.heightCm != null;
  }

  /// Doses taken, by week, month or year, with the caveat about what the
  /// number can and cannot mean.
  static void _showAdherenceSheet(BuildContext context, PatientSummary p) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => _AdherenceSheet(
            patientId: p.id,
            // The summary's 30-day figures, so the sheet opens with an answer.
            initial: AdherenceReport(
              taken: p.adherenceTaken ?? 0,
              expected: p.adherenceExpected ?? 0,
              percentage: p.adherencePercent,
              perMed: p.adherencePerMed,
            ),
          ),
    );
  }

  /// Every HbA1c result, from the figure that opens it.
  static void _showHba1cSheet(BuildContext context, List<Hba1cPoint> points) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.6,
            maxChildSize: 0.9,
            builder:
                (ctx, controller) => ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s8),
                  children: [
                    Text('HbA1c results', style: T.title.copyWith(color: T.ink)),
                    Text(
                      points.length == 1
                          ? '1 result, newest first'
                          : '${points.length} results, newest first',
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                    const SizedBox(height: T.s4),
                    for (var i = 0; i < points.length; i++) ...[
                      if (i > 0) const Divider(height: T.s5, color: T.line),
                      _Hba1cRow(point: points[i]),
                    ],
                  ],
                ),
          ),
    );
  }
}

class _Hba1cRow extends StatelessWidget {
  const _Hba1cRow({required this.point});

  final Hba1cPoint point;

  @override
  Widget build(BuildContext context) {
    final reading = hba1cReading(point.percentage);
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: T.tap),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                MetricValue(value: figure(point.percentage), unit: '%'),
                if (point.testedOn != null)
                  Text(
                    'Tested ${DateFormat('d MMM y').format(point.testedOn!)}',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
              ],
            ),
          ),
          StatusPill(label: reading.word, status: reading.status),
        ],
      ),
    );
  }
}

// ---- the last consultation -----------------------------------------------------

/// What was decided at the last visit: the diagnosis, the tests, the advice,
/// and when the patient is due back.
///
/// A follow-up visit starts from here. It used to be the eleventh section of
/// twelve, as one of a dozen folded dates.
class _LastConsultationCard extends ConsumerWidget {
  const _LastConsultationCard({
    required this.patientId,
    required this.patientName,
  });

  final String patientId;
  final String patientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(patientPrescriptionsProvider(patientId));
    void retry() => ref.invalidate(patientPrescriptionsProvider(patientId));
    void openAll() => GoRouter.of(context).push(
      '${areaPrefix(ref)}/patients/$patientId/prescriptions',
      extra: patientName,
    );
    const what = 'the consultations';

    final list = async.valueOrNull;
    final error = async.hasError && !async.isLoading ? async.error : null;
    final refused =
        error != null && !Failure.of(error, what: what).keepsData;

    if (list == null || refused) {
      return RecordCard(
        icon: Icons.event_note_outlined,
        title: 'Last visit',
        child:
            error != null
                ? FailureNotice(error: error, what: what, onRetry: retry)
                : const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonLine(width: 220),
                    SizedBox(height: T.s2),
                    SkeletonLine(width: 160),
                  ],
                ),
      );
    }

    if (list.isEmpty) {
      return RecordCard(
        icon: Icons.event_note_outlined,
        title: 'Last visit',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (error != null) ...[
              StaleNotice(error: error, what: 'this card', onRetry: retry),
              const SizedBox(height: T.s3),
            ],
            const RecordNote(
              icon: Icons.event_note_outlined,
              text: 'No consultation or prescription on record yet.',
            ),
            const SizedBox(height: T.s3),
            // Where a prescription written on paper is filed, which is how a
            // practice starting on paper gets its first one onto the record.
            Align(
              alignment: Alignment.centerLeft,
              child: QuietAction(
                icon: Icons.document_scanner_outlined,
                label: 'File a paper prescription',
                onPressed: openAll,
              ),
            ),
          ],
        ),
      );
    }

    final rx = list.first;
    final status = prescriptionStatus(rx);
    final today = DateUtils.dateOnly(DateTime.now());
    final due = rx.followUpOn;
    final overdue = due != null && DateUtils.dateOnly(due).isBefore(today);
    final by = [
      if (rx.issuedOn != null) DateFormat('d MMM y').format(rx.issuedOn!),
      if (rx.isScanned)
        rx.uploadedByName == null
            ? 'written on paper'
            : 'written on paper, filed by ${rx.uploadedByName}'
      else if (rx.doctorName != null)
        rx.doctorName!,
    ].join(' · ');

    return RecordCard(
      icon: Icons.event_note_outlined,
      title: 'Last visit',
      subtitle: by.isEmpty ? null : by,
      // Every prescription, with its PDF — one tap from the latest.
      trailing: ActionLink(label: 'View all', onTap: openAll),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (error != null) ...[
            StaleNotice(error: error, what: 'this card', onRetry: retry),
            const SizedBox(height: T.s3),
          ],
          // Said only when it is not the ordinary answer: a last prescription
          // that was voided or replaced changes how everything under it reads.
          if (status != null && status.word != 'Current') ...[
            Align(
              alignment: Alignment.centerLeft,
              child: StatusPill(label: status.word, status: status.status),
            ),
            const SizedBox(height: T.s3),
          ],
          if (due != null) ...[
            InnerTile(
              tone: overdue ? T.warningTint : null,
              child: Row(
                children: [
                  Icon(
                    Icons.event_available_outlined,
                    color: overdue ? T.warning : T.primary,
                  ),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          overdue ? 'Follow-up was due' : 'Follow-up due',
                          style: T.label.copyWith(color: T.inkMuted),
                        ),
                        Text(
                          [
                            DateFormat('EEE d MMM y').format(due),
                            if (isRelativeWhen(whenLabel(due))) whenLabel(due),
                          ].join(' · '),
                          style: T.bodyStrong.copyWith(color: T.ink),
                        ),
                      ],
                    ),
                  ),
                  if (overdue)
                    const StatusPill(label: 'Overdue', status: Status.watch),
                ],
              ),
            ),
            const SizedBox(height: T.s3),
          ],
          if (rx.diagnosis.isNotEmpty)
            _Fact(label: 'Diagnosis', value: rx.diagnosis.join(', ')),
          if (rx.labTestsAdvised.isNotEmpty)
            _Fact(
              label: 'Tests advised',
              value: rx.labTestsAdvised.join(', '),
            ),
          if ((rx.generalAdvice ?? '').trim().isNotEmpty)
            _Fact(label: 'Advice', value: rx.generalAdvice!.trim()),
          if ((rx.endedReason ?? '').trim().isNotEmpty)
            _Fact(label: 'Why it ended', value: rx.endedReason!.trim()),
          // A paper prescription has nothing typed in to show here, which is
          // "not entered", never "nothing was decided".
          if (rx.isScanned &&
              rx.diagnosis.isEmpty &&
              rx.labTestsAdvised.isEmpty &&
              (rx.generalAdvice ?? '').trim().isEmpty)
            const RecordNote(
              icon: Icons.document_scanner_outlined,
              text:
                  'Written on paper, and not typed in. Open it from '
                  'Prescriptions to read it.',
            )
          else if (!rx.isScanned &&
              rx.diagnosis.isEmpty &&
              rx.labTestsAdvised.isEmpty &&
              (rx.generalAdvice ?? '').trim().isEmpty &&
              due == null)
            const RecordNote(
              text: 'No diagnosis, tests, advice or follow-up were written.',
            ),
        ],
      ),
    );
  }
}

/// A label over its value, the way the record states a fact in words.
class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: T.label.copyWith(color: T.inkMuted)),
          Text(value, style: T.body.copyWith(color: T.ink)),
        ],
      ),
    );
  }
}

// ---- doses taken ----------------------------------------------------------------

class _AdherenceSheet extends ConsumerStatefulWidget {
  const _AdherenceSheet({required this.patientId, required this.initial});
  final String patientId;
  final AdherenceReport initial;

  @override
  ConsumerState<_AdherenceSheet> createState() => _AdherenceSheetState();
}

class _AdherenceSheetState extends ConsumerState<_AdherenceSheet> {
  static const _periods = [
    (label: 'Week', days: 7, words: 'the last week'),
    (label: 'Month', days: 30, words: 'the last 30 days'),
    (label: 'Year', days: 365, words: 'the last year'),
  ];

  /// The period asked for, and the one whose figures are on screen. They
  /// differ while a period loads, and after one fails.
  int _asked = 30;
  int _shown = 30;
  late AdherenceReport _report = widget.initial;
  bool _loading = false;
  bool _failed = false;

  String _words(int days) =>
      _periods.firstWhere((p) => p.days == days).words;

  Future<void> _select(int days) async {
    setState(() {
      _asked = days;
      _loading = true;
      _failed = false;
    });
    try {
      final r = await ref
          .read(clinicianRepositoryProvider)
          .patientAdherence(widget.patientId, days: days);
      if (!mounted || _asked != days) return;
      setState(() {
        _report = r;
        _shown = days;
      });
    } catch (_) {
      // Said, not swallowed: the figures still on screen are another period's.
      if (mounted && _asked == days) setState(() => _failed = true);
    } finally {
      if (mounted && _asked == days) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _report;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.92,
      builder:
          (ctx, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s8),
            children: [
              Text('Doses taken', style: T.title.copyWith(color: T.ink)),
              const SizedBox(height: T.s3),
              Wrap(
                spacing: T.s2,
                runSpacing: T.s2,
                children: [
                  for (final period in _periods)
                    ChoiceChip(
                      label: Text(period.label),
                      selected: _asked == period.days,
                      onSelected: (_) => _select(period.days),
                      materialTapTargetSize: MaterialTapTargetSize.padded,
                    ),
                ],
              ),
              const SizedBox(height: T.s3),
              if (_loading)
                const LinearProgressIndicator()
              else if (_failed)
                InnerTile(
                  tone: T.warningTint,
                  child: Text(
                    'Could not load ${_words(_asked)}. Showing '
                    '${_words(_shown)}.',
                    style: T.small.copyWith(color: T.ink),
                  ),
                ),
              const SizedBox(height: T.s3),
              InnerTile(
                child:
                    r.expected == 0
                        ? Text(
                          'No scheduled doses came due in ${_words(_shown)}.',
                          style: T.body.copyWith(color: T.inkMuted),
                        )
                        : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _words(_shown)[0].toUpperCase() +
                                  _words(_shown).substring(1),
                              style: T.label.copyWith(color: T.inkMuted),
                            ),
                            MetricValue(
                              value: '${r.taken} of ${r.expected}',
                              unit: 'doses',
                            ),
                            if (r.percentage != null)
                              Text(
                                '${r.percentage}% marked taken',
                                style: T.body.copyWith(color: T.ink),
                              ),
                          ],
                        ),
              ),
              if (r.perMed.isNotEmpty) ...[
                const SizedBox(height: T.s5),
                Text('By medicine', style: T.label.copyWith(color: T.inkMuted)),
                const SizedBox(height: T.s2),
                for (final m in r.perMed) _AdherenceRow(med: m),
              ],
              const SizedBox(height: T.s4),
              const RecordNote(
                text:
                    'Counts only doses whose time has passed, and only those the '
                    'patient marked as taken in the app. A low figure can mean '
                    'doses were not logged, not necessarily that they were missed.',
              ),
            ],
          ),
    );
  }
}

class _AdherenceRow extends StatelessWidget {
  const _AdherenceRow({required this.med});
  final MedAdherence med;

  @override
  Widget build(BuildContext context) {
    final frac =
        med.expected > 0 ? (med.taken / med.expected).clamp(0.0, 1.0) : 0.0;
    return Padding(
      padding: const EdgeInsets.only(bottom: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(med.name, style: T.bodyStrong.copyWith(color: T.ink)),
              ),
              const SizedBox(width: T.s2),
              Text(
                med.expected == 0
                    ? 'None due'
                    : '${med.taken} of ${med.expected}'
                        '${med.percentage == null ? '' : ' · ${med.percentage}%'}',
                style: T.small.copyWith(
                  color: T.inkMuted,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s1),
          // One colour for every medicine: the figure beside the bar is the
          // reading, and a red bar with no word would be a verdict nobody
          // wrote down.
          ClipRRect(
            borderRadius: T.rFull,
            child: LinearProgressIndicator(
              value: frac,
              minHeight: T.s2,
              backgroundColor: T.line,
              color: T.primary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shows the patient's assigned dietician + food-log review cadence, and lets
/// the doctor assign, change, or clear it.
class _DieticianSection extends ConsumerWidget {
  const _DieticianSection({required this.summary, required this.patientId});

  final PatientSummary summary;
  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final name = summary.assignedDieticianName;
    // An explicit assignment is a *restriction*, not a grant: by default the
    // clinic dietician covers every patient (see the dietician panel's scope).
    final restricted = name != null && name.isNotEmpty;
    // Restricting only makes sense with 2+ dieticians — with one, it would cut
    // the sole dietician off from every other patient. So the action is offered
    // only when there's a choice to make (or to undo an existing restriction).
    final dieticianCount =
        ref.watch(clinicDieticiansProvider).valueOrNull?.length ?? 0;
    // Who covers a patient — and, in a clinic with two dieticians, who may see
    // them at all — is a clinical and an access decision. The server refuses it
    // from a desk account now; the button goes too, so the desk is not offered
    // a control that ends in a red toast.
    final canRestrict =
        (restricted || dieticianCount >= 2) && areaPrefix(ref) != '/staff';

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.accentOn(context).withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              Icons.restaurant_menu_rounded,
              size: 20,
              color: AppColors.accentOn(context),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'DIETICIAN',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 0),
                Text(
                  // Three states, not two.
                  //
                  // "Covered by clinic dietician" was the default for anyone
                  // without an explicit assignment, which was true while the
                  // clinic had one. With none on file it is a sentence the
                  // record states about every patient and nobody is behind —
                  // and it reads as reassurance, which is the worst way for a
                  // gap in cover to present itself.
                  restricted
                      ? name
                      : dieticianCount == 0
                      ? 'No dietician'
                      : 'Covered by clinic dietician',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  restricted
                      ? 'Restricted to this dietician only'
                      : dieticianCount == 0
                      ? 'Nobody is covering nutrition for this clinic'
                      : 'The clinic dietician covers this patient',
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          if (canRestrict)
            TextButton(
              onPressed: () => _openAssign(context, ref),
              child: Text(restricted ? 'Change' : 'Restrict'),
            ),
        ],
      ),
    );
  }

  Future<void> _openAssign(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final repo = ref.read(clinicianRepositoryProvider);

    List<({String id, String name})> options;
    try {
      options = await repo.dieticians();
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not load dieticians')),
      );
      return;
    }
    if (!context.mounted) return;

    String? selectedId = summary.assignedDieticianId;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => StatefulBuilder(
            builder: (ctx, setSheet) {
              final scheme = Theme.of(ctx).colorScheme;

              Future<void> save() async {
                try {
                  // Cadence is clinic-wide now, so the dead per-patient field
                  // is never set. A null dieticianId is the clinic default —
                  // the same call clears a restriction and applies one.
                  await repo.assignDietician(
                    patientId,
                    dieticianId: selectedId,
                    reviewIntervalDays: null,
                  );
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } catch (_) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(content: Text('Could not save')),
                    );
                  }
                }
              }

              // Scrollable, because this list grows with the clinic. With
              // three dieticians and the warning showing, the fixed column ran
              // past the bottom of the sheet and took the save button with it.
              return SafeArea(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                    AppSpacing.md,
                    0,
                    AppSpacing.md,
                    MediaQuery.of(ctx).viewInsets.bottom + AppSpacing.lg,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Nutrition care',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'By default every dietician in the clinic covers this '
                        'patient. Restrict to one only if this patient should '
                        'be handled by that person alone.',
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),

                      // One RadioGroup owns the selection, so each tile only
                      // declares its value. The per-tile groupValue/onChanged
                      // pair is deprecated, and it was also the shape that let
                      // two tiles disagree about what was selected.
                      RadioGroup<String?>(
                        groupValue: selectedId,
                        onChanged: (v) => setSheet(() => selectedId = v),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            // The default is an option in the list, not a
                            // separate button that appears only once a
                            // restriction exists. Without it there was no way
                            // back: pick a dietician on an unrestricted
                            // patient and the radio could not be cleared.
                            const RadioListTile<String?>(
                              contentPadding: EdgeInsets.zero,
                              value: null,
                              title: Text('Clinic dietician'),
                              subtitle: Text(
                                'Whoever is covering answers this patient',
                              ),
                            ),
                            for (final d in options)
                              RadioListTile<String?>(
                                contentPadding: EdgeInsets.zero,
                                value: d.id,
                                title: Text(d.name),
                              ),
                          ],
                        ),
                      ),
                      if (options.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Text(
                            // Not "below" any more. This sheet carried its own
                            // create form — a third implementation of one act,
                            // and the one that skipped verifying the number.
                            'No dieticians yet. Add one on the People screen.',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ),

                      if (selectedId != null) ...[
                        const SizedBox(height: AppSpacing.sm),
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.warningBgOn(ctx),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.info_outline_rounded,
                                size: 16,
                                color: AppColors.warningOn(ctx),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'This limits the chosen dietician to only '
                                  'the patients you restrict to them — they '
                                  'stop seeing the rest of the clinic by '
                                  'default.',
                                  style: TextStyle(
                                    fontSize: 12,
                                    height: 1.3,
                                    color: AppColors.warningOn(ctx),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],

                      const SizedBox(height: AppSpacing.lg),
                      // Full width and on its own line.
                      //
                      // This was a Row of [TextButton, Spacer, FilledButton].
                      // "Back to clinic default" beside "Restrict to this
                      // dietician" is wider than a phone, and an overflowing
                      // Row drops its last child without a word — so the save
                      // button was not there to press, and picking a dietician
                      // appeared to do nothing.
                      FilledButton(
                        onPressed: save,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(
                            AppSpacing.minTapTarget,
                          ),
                        ),
                        child: Text(
                          selectedId == null
                              ? 'Use the clinic default'
                              : 'Restrict to this dietician',
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
    );

    if (saved == true) {
      ref.invalidate(patientSummaryProvider(patientId));
      messenger.showSnackBar(
        const SnackBar(content: Text('Nutrition care updated')),
      );
    }
  }

  /// A small inline form to create a dietician account. Returns the new
  /// dietician (id + name), or null if cancelled.
}

// ---- test reports ----------------------------------------------------------------

/// What came back from the lab: each report's verdict in a line, its values
/// one tap below, and the trend of any value measured more than once.
class _TestReportsCard extends StatelessWidget {
  const _TestReportsCard({required this.reports});

  final List<LabReport> reports;

  static const _shown = 3;

  @override
  Widget build(BuildContext context) {
    final trended = _trendedAnalytes(reports);
    return RecordCard(
      icon: Icons.description_outlined,
      title: 'Test reports',
      subtitle:
          reports.length == 1 ? '1 uploaded' : '${reports.length} uploaded',
      trailing:
          reports.length > _shown
              ? ActionLink(
                label: 'View all',
                onTap: () => _showAll(context, reports),
              )
              : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < reports.length && i < _shown; i++) ...[
            if (i > 0) const Divider(height: T.s4, color: T.line),
            _ReportRow(report: reports[i]),
          ],
          if (trended.isNotEmpty) ...[
            const Divider(height: T.s4, color: T.line),
            DisclosureTile(
              tilePadding: const EdgeInsets.symmetric(vertical: T.s3),
              childrenPadding: EdgeInsets.zero,
              title: Text(
                'Trends across reports',
                style: T.bodyStrong.copyWith(color: T.ink),
              ),
              subtitle: Text(
                trended.length == 1
                    ? '1 value measured more than once'
                    : '${trended.length} values measured more than once',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              children: [
                for (var i = 0; i < trended.length; i++) ...[
                  if (i > 0) const Divider(height: T.s4, color: T.line),
                  _AnalyteTrendRow(readings: trended[i]),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  static void _showAll(BuildContext context, List<LabReport> reports) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.75,
            maxChildSize: 0.95,
            builder:
                (ctx, controller) => ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s8),
                  children: [
                    Text('Test reports', style: T.title.copyWith(color: T.ink)),
                    Text(
                      '${reports.length} uploaded, newest first',
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                    const SizedBox(height: T.s4),
                    for (var i = 0; i < reports.length; i++) ...[
                      if (i > 0) const Divider(height: T.s4, color: T.line),
                      _ReportRow(report: reports[i]),
                    ],
                  ],
                ),
          ),
    );
  }
}

/// Every value read off more than one report, oldest reading first.
List<List<Analyte>> _trendedAnalytes(List<LabReport> reports) {
  final sorted = [...reports]..sort(
    (a, b) => (a.testedOn ?? a.createdAt ?? DateTime(0)).compareTo(
      b.testedOn ?? b.createdAt ?? DateTime(0),
    ),
  );
  final series = <String, List<Analyte>>{};
  for (final r in sorted) {
    for (final a in r.analytes) {
      (series[a.code] ??= []).add(a);
    }
  }
  return series.values.where((s) => s.length >= 2).toList();
}

/// A report's verdict in words, before its values.
({String text, Status status})? _reportVerdict(LabReport r) {
  if (r.analytes.isNotEmpty) {
    final out = r.analytes.where((a) => a.abnormal).length;
    return out == 0
        ? (
          text:
              r.analytes.length == 1
                  ? 'In range'
                  : 'All ${r.analytes.length} values in range',
          status: Status.ok,
        )
        : (
          text:
              out == 1
                  ? '1 value out of range'
                  : '$out values out of range',
          status: Status.alert,
        );
  }
  return switch (r.analysisStatus) {
    'failed' || 'unsupported' => (
      text: 'Could not be read automatically — needs a look',
      status: Status.watch,
    ),
    'pending' => (text: 'Still being read', status: Status.neutral),
    _ => null,
  };
}

/// One report: its name, when, and its verdict; its values and file behind a
/// tap.
class _ReportRow extends ConsumerStatefulWidget {
  const _ReportRow({required this.report});

  final LabReport report;

  @override
  ConsumerState<_ReportRow> createState() => _ReportRowState();
}

class _ReportRowState extends ConsumerState<_ReportRow> {
  bool _open = false;
  bool _busy = false;

  LabReport get report => widget.report;

  /// A photo opens full-screen; a PDF is downloaded with the auth header — an
  /// in-browser open would be refused — and handed to the phone's viewer.
  Future<void> _openFile() async {
    if (!report.hasFile || report.photoUrl == null) return;
    if (report.isImage) {
      FullscreenPhoto.show(context, report.photoUrl);
      return;
    }
    if (_busy) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final dir = await getTemporaryDirectory();
      final ext = report.mimeType == 'application/pdf' ? 'pdf' : 'bin';
      final cached = File('${dir.path}/lab_${report.photoUrl.hashCode}.$ext');
      if (!await cached.exists() || await cached.length() == 0) {
        final bytes = await ref
            .read(apiClientProvider)
            .getBytes('${AppConfig.apiOrigin}${report.photoUrl}');
        if (bytes.isEmpty) throw Exception('empty report download');
        await cached.writeAsBytes(bytes, flush: true);
      }
      final res = await OpenFilex.open(cached.path);
      if (res.type != ResultType.done) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('No app on this phone can open that report'),
          ),
        );
      }
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not open the report')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = report;
    final verdict = _reportVerdict(r);
    final when = r.testedOn ?? r.createdAt;
    final canOpen = r.analytes.isNotEmpty || r.hasFile || r.note.isNotEmpty;

    final head = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (r.hasFile && r.isImage)
          AuthedImage(
            path: r.photoUrl!,
            width: T.s12,
            height: T.s12,
            radius: T.rCard,
          )
        else
          Container(
            width: T.s12,
            height: T.s12,
            decoration: BoxDecoration(
              color: T.primaryTint,
              borderRadius: BorderRadius.circular(T.rCard),
            ),
            child: Icon(
              r.mimeType == 'application/pdf'
                  ? Icons.picture_as_pdf_outlined
                  : Icons.description_outlined,
              color: T.primary,
            ),
          ),
        const SizedBox(width: T.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(r.testName, style: T.bodyStrong.copyWith(color: T.ink)),
              if (when != null)
                Text(
                  r.testedOn != null
                      ? 'Tested ${whenLabel(when)}'
                      : 'Uploaded ${whenLabel(when)}',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              if (verdict != null) ...[
                const SizedBox(height: T.s1),
                StatusPill(label: verdict.text, status: verdict.status),
              ],
            ],
          ),
        ),
        if (canOpen)
          Icon(
            _open ? Icons.expand_less_rounded : Icons.expand_more_rounded,
            color: T.inkMuted,
          ),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: canOpen,
          expanded: canOpen ? _open : null,
          child: InkWell(
            onTap: canOpen ? () => setState(() => _open = !_open) : null,
            borderRadius: BorderRadius.circular(T.rControl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: T.tap),
              child: head,
            ),
          ),
        ),
        if (_open) ...[
          if (r.note.isNotEmpty) ...[
            const SizedBox(height: T.s2),
            Text(r.note, style: T.body.copyWith(color: T.ink)),
          ],
          if (r.analytes.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            Wrap(
              spacing: T.s2,
              runSpacing: T.s2,
              children: [for (final a in r.analytes) _AnalyteChip(analyte: a)],
            ),
          ],
          if (r.hasFile) ...[
            const SizedBox(height: T.s3),
            Align(
              alignment: Alignment.centerLeft,
              child: QuietAction(
                icon:
                    r.isImage
                        ? Icons.image_outlined
                        : Icons.picture_as_pdf_outlined,
                label: _busy ? 'Opening…' : 'Open the report',
                onPressed: _busy ? null : _openFile,
              ),
            ),
          ],
        ],
      ],
    );
  }
}

/// A value read off a report: what, how much, and — when it is out of range —
/// which way, in a word.
class _AnalyteChip extends StatelessWidget {
  const _AnalyteChip({required this.analyte});

  final Analyte analyte;

  @override
  Widget build(BuildContext context) {
    final a = analyte;
    final (word, status) = switch (a.flag) {
      'critical' => ('critical', Status.alert),
      'high' => ('high', Status.alert),
      'low' => ('low', Status.watch),
      _ => (null, Status.neutral),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s1),
      decoration: BoxDecoration(color: status.tint, borderRadius: T.rFull),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: '${a.label} '),
            TextSpan(
              text: figure(a.value),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if ((a.unit ?? '').isNotEmpty) TextSpan(text: ' ${a.unit}'),
            if (word != null)
              TextSpan(
                text: ' · $word',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: status.tone,
                ),
              ),
          ],
        ),
        style: T.small.copyWith(color: T.ink),
      ),
    );
  }
}

/// One value across reports: its reference range, the line, and the latest.
class _AnalyteTrendRow extends StatelessWidget {
  const _AnalyteTrendRow({required this.readings});

  final List<Analyte> readings;

  @override
  Widget build(BuildContext context) {
    final latest = readings.last;
    final (word, status) = switch (latest.flag) {
      'critical' => ('Critical', Status.alert),
      'high' => ('High', Status.alert),
      'low' => ('Low', Status.watch),
      _ => (null, Status.neutral),
    };
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(latest.label, style: T.bodyStrong.copyWith(color: T.ink)),
              if (latest.rangeText.isNotEmpty)
                Text(
                  'Reference ${latest.rangeText}${latest.unit != null ? ' ${latest.unit}' : ''}',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              Text(
                readings.map((a) => figure(a.value)).join(' → '),
                style: T.small.copyWith(color: T.ink),
              ),
            ],
          ),
        ),
        const SizedBox(width: T.s2),
        // Drawn from the readings alone, without the glucose band: this is a
        // marker's own scale, and a 70–180 band behind an LDL would mean
        // nothing.
        Sparkline(
          values: [for (final a in readings) a.value.toDouble()],
          color: T.primary,
          width: T.s12 + T.s4,
          height: T.s6,
          showBand: false,
        ),
        const SizedBox(width: T.s3),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            MetricValue(value: figure(latest.value), unit: latest.unit, size: T.s5),
            if (word != null) StatusPill(label: word, status: status),
          ],
        ),
      ],
    );
  }
}

// ---- history and details -------------------------------------------------------

/// What is worth knowing and not worth a card: contact details and notes,
/// alerts already dealt with, and what the assistant is told. Folded, because
/// none of it is what a visit turns on.
class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.summary});

  final PatientSummary summary;

  static String? _language(String? code) => switch (code) {
    'en' => 'English',
    'bn' => 'Bengali',
    'hi' => 'Hindi',
    null || '' => null,
    _ => code,
  };

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final d = p.details;
    final settled =
        p.alerts.where((a) => a.status != 'open').toList(growable: false);
    final ai = (p.aiContext ?? '').trim();

    final about = <({String label, String value})>[
      if ((p.email ?? '').trim().isNotEmpty) (label: 'Email', value: p.email!.trim()),
      if ((p.address ?? '').trim().isNotEmpty)
        (label: 'Address', value: p.address!.trim()),
      if (_language(p.language) != null)
        (label: 'Language', value: _language(p.language)!),
      if (d.emergencyPhone != null)
        (
          label: 'Emergency contact',
          value: [
            [
              if ((d.emergencyName ?? '').isNotEmpty) d.emergencyName!,
              if ((d.emergencyRelation ?? '').isNotEmpty)
                '(${d.emergencyRelation})',
            ].join(' '),
            d.emergencyPhone!,
          ].where((s) => s.isNotEmpty).join(' · '),
        ),
      if (d.diagnosedOn != null)
        (
          label: 'Diagnosed',
          value: DateFormat('MMM y').format(d.diagnosedOn!),
        ),
      if (p.healthScore != null)
        (
          label: 'Health score',
          value:
              '${p.healthScore} of 100${_healthBand(p.healthBand)} — worked out '
              'from readings in range, doses, HbA1c, blood pressure and '
              'activity over 30 days',
        ),
      if ((d.notes ?? '').trim().isNotEmpty)
        (label: 'Notes', value: d.notes!.trim()),
    ];

    final folds = <Widget>[
      if (about.isNotEmpty)
        _Fold(
          title: 'About this patient',
          subtitle: 'Contact, emergency contact and notes',
          children: [
            for (final f in about) _Fact(label: f.label, value: f.value),
          ],
        ),
      if (settled.isNotEmpty)
        _Fold(
          title: 'Past alerts',
          subtitle:
              settled.length == 1
                  ? '1 resolved or dismissed'
                  : '${settled.length} resolved or dismissed',
          children: [
            for (var i = 0; i < settled.length; i++) ...[
              if (i > 0) const SizedBox(height: T.s2),
              AlertRow(alert: settled[i]),
            ],
          ],
        ),
      if (ai.isNotEmpty)
        _Fold(
          title: 'What the assistant is told',
          subtitle: 'The summary the assistant reads before it answers',
          children: [Text(ai, style: T.body.copyWith(color: T.ink))],
        ),
    ];
    if (folds.isEmpty) return const SizedBox.shrink();

    return RecordCard(
      icon: Icons.folder_open_outlined,
      title: 'History and details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < folds.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: T.line),
            folds[i],
          ],
        ],
      ),
    );
  }

  static String _healthBand(String? band) => switch (band) {
    'good' => ', good',
    'fair' => ', fair',
    'needs_attention' => ', needs attention',
    'poor' => ', poor',
    _ => '',
  };
}

class _Fold extends StatelessWidget {
  const _Fold({
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return DisclosureTile(
      tilePadding: const EdgeInsets.symmetric(vertical: T.s3),
      childrenPadding: const EdgeInsets.only(bottom: T.s3),
      title: Text(title, style: T.bodyStrong.copyWith(color: T.ink)),
      subtitle: Text(subtitle, style: T.small.copyWith(color: T.inkMuted)),
      children: children,
    );
  }
}
