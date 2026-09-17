/// What the record leads with, by who is reading it.
///
/// ---- Why the order changes and the content does not -----------------------
///
/// A diabetologist opens a record to see glucose control; a cardiologist to see
/// blood pressure, rhythm and cholesterol; a general physician to see the
/// vitals and when the patient is due back. The record used to open onto six
/// diabetes tiles for all three — so a cardiologist's first screen was four
/// dashes and a fasting sugar.
///
/// So the first card follows the reader's department. Nothing is hidden for
/// good: every section stays on the record for everyone, lower down, when it
/// has something to say.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/capabilities/capabilities.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/clinician_models.dart';
import '../../domain/lab_catalog.dart';
import '../../domain/patient_summary.dart';
import 'ecg_section.dart';
import 'record_ui.dart';

enum RecordFocus { diabetes, cardiology, general }

/// The reader's department first, then the practice's specialty, then — for a
/// practice that has said neither — whatever the patient's own record is about.
RecordFocus recordFocusFor(Capabilities caps, PatientSummary p) {
  final chosen =
      _focusForKey(caps.department?.key) ?? _focusForKey(caps.specialty);
  if (chosen != null) return chosen;
  return hasDiabetesRecord(p) ? RecordFocus.diabetes : RecordFocus.general;
}

/// Whether the patient's record is about diabetes at all.
bool hasDiabetesRecord(PatientSummary p) {
  const diabetic = {'type1', 'type2', 'gestational', 'prediabetes'};
  return diabetic.contains(p.diabetesType) ||
      p.hba1cHistory.isNotEmpty ||
      p.glucoseAverage != null ||
      p.lastFasting != null;
}

RecordFocus? _focusForKey(String? key) => switch (key?.trim().toLowerCase()) {
  'diabetology' || 'diabetes' || 'endocrinology' => RecordFocus.diabetes,
  'cardiology' => RecordFocus.cardiology,
  'general_physician' ||
  'general_medicine' ||
  'internal_medicine' ||
  'family_medicine' ||
  'general' => RecordFocus.general,
  _ => null,
};

// ---- needs attention ----------------------------------------------------------

Reading alertSeverity(String severity) => switch (severity) {
  'emergency' => (word: 'Emergency', status: Status.alert),
  'urgent' => (word: 'Urgent', status: Status.alert),
  'warning' => (word: 'Warning', status: Status.watch),
  _ => (word: 'For information', status: Status.neutral),
};

/// Open alerts, first on the record. Absent when there are none: a record
/// announcing "nothing needs attention" is a second sentence for a fact the
/// doctor already has.
class OpenAlertsCard extends StatelessWidget {
  const OpenAlertsCard({super.key, required this.alerts});

  final List<ClinicalAlert> alerts;

  @override
  Widget build(BuildContext context) {
    final open = alerts.where((a) => a.status == 'open').toList();
    if (open.isEmpty) return const SizedBox.shrink();
    return RecordCard(
      icon: Icons.notification_important_outlined,
      title: 'Needs attention',
      subtitle:
          open.length == 1 ? '1 open alert' : '${open.length} open alerts',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < open.length; i++) ...[
            if (i > 0) const SizedBox(height: T.s2),
            AlertRow(alert: open[i]),
          ],
        ],
      ),
    );
  }
}

/// One alert: what happened, how serious, and when.
class AlertRow extends StatelessWidget {
  const AlertRow({super.key, required this.alert});

  final ClinicalAlert alert;

  @override
  Widget build(BuildContext context) {
    final settled = alert.status == 'resolved' || alert.status == 'dismissed';
    // Severity says how bad it was; status says whether it still needs anyone.
    // A closed emergency in emergency red spends the loudest colour in the app
    // on something already dealt with.
    final reading =
        settled
            ? (
              word: alert.status == 'resolved' ? 'Resolved' : 'Dismissed',
              status: Status.neutral,
            )
            : alertSeverity(alert.severity);
    return InnerTile(
      tone: settled ? null : reading.status.tint,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(alert.title, style: T.bodyStrong.copyWith(color: T.ink)),
                if (alert.createdAt != null)
                  Text(
                    '${whenSentence(alert.createdAt!)}, '
                    '${DateFormat('h:mm a').format(alert.createdAt!)}',
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
              ],
            ),
          ),
          const SizedBox(width: T.s2),
          StatusPill(label: reading.word, status: reading.status),
        ],
      ),
    );
  }
}

// ---- the leading cards --------------------------------------------------------

/// Doses taken, as doses rather than a bare percentage, opening the breakdown.
///
/// Null when the patient has no medicines: there is nothing to take and
/// nothing to say.
Widget? adherenceTile(PatientSummary p, VoidCallback onOpen) {
  final pct = p.adherencePercent;
  if (pct == null) {
    if ((p.medicationCount ?? 0) == 0) return null;
    return FactTile(
      label: 'Doses taken',
      emptyText: 'None due in 30 days',
      onTap: onOpen,
      semanticsHint: 'Opens the dose breakdown',
    );
  }
  return FactTile(
    label: 'Doses taken',
    value: '$pct',
    unit: '%',
    details: [
      if (p.adherenceExpected != null && p.adherenceTaken != null)
        '${p.adherenceTaken} of ${p.adherenceExpected} in 30 days',
    ],
    onTap: onOpen,
    semanticsHint: 'Opens the dose breakdown',
  );
}

/// Glucose control: HbA1c, readings, doses taken, and the feet and eyes — what
/// a diabetes consultation turns on.
class GlucoseControlCard extends StatelessWidget {
  const GlucoseControlCard({
    super.key,
    required this.summary,
    required this.onOpenAdherence,
    required this.onOpenHba1c,
    this.leading = true,
  });

  final PatientSummary summary;
  final VoidCallback onOpenAdherence;
  final VoidCallback onOpenHba1c;

  /// Whether this card leads the record. Lower down, for a reader in another
  /// department, it leaves out what the leading card already says (doses) and
  /// what is only worth saying about a diabetic (an empty foot check).
  final bool leading;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final a1c = p.hba1cHistory.firstOrNull;
    final previous = p.hba1cHistory.length > 1 ? p.hba1cHistory[1] : null;
    final days = p.glucoseWindowDays ?? 90;
    final adherence = leading ? adherenceTile(p, onOpenAdherence) : null;
    final feet =
        p.lastFootScreeningAt ?? p.footAssessments.firstOrNull?.assessedAt;
    final footRisk =
        p.footAssessments.firstOrNull?.riskLevel ?? p.details.footRiskCategory;
    final eyes = p.lastEyeScreeningAt;
    // The rule the patient's own home screen follows (routes/dashboard.js):
    // a foot check every 90 days at low risk and every 14 otherwise, an eye
    // screening every year, and never checked counts as due.
    final footDue = _due(
      p.lastFootScreeningAt,
      (p.details.footRiskCategory ?? 'low') == 'low' ? 90 : 14,
    );
    final eyesDue = _due(eyes, 365);

    final nothing =
        a1c == null &&
        p.glucoseAverage == null &&
        p.lastFasting == null &&
        adherence == null &&
        feet == null &&
        eyes == null;

    return RecordCard(
      icon: Icons.bloodtype_outlined,
      title: 'Glucose control',
      subtitle: leading ? 'HbA1c, readings, doses, feet and eyes' : null,
      child:
          nothing
              ? const RecordNote(
                text:
                    'No HbA1c, glucose readings or screenings on record yet. '
                    'They appear here as soon as one is recorded.',
              )
              : FactGrid(
                children: [
                  FactTile(
                    label: 'HbA1c',
                    value: a1c == null ? null : figure(a1c.percentage),
                    unit: '%',
                    reading: a1c == null ? null : hba1cReading(a1c.percentage),
                    emptyText: 'No HbA1c on record',
                    details: [
                      if (a1c?.testedOn != null) whenSentence(a1c!.testedOn!),
                      if (previous != null)
                        'Was ${figure(previous.percentage)}%'
                            '${previous.testedOn == null ? '' : ' ${_onOrIn(previous.testedOn!)}'}',
                    ],
                    // The whole history is behind the figure it explains,
                    // rather than a second list of the same results.
                    onTap: p.hba1cHistory.length > 1 ? onOpenHba1c : null,
                    semanticsHint: 'Opens every HbA1c result',
                  ),
                  if (leading || p.glucoseAverage != null)
                    FactTile(
                      label: 'Average glucose',
                      value: p.glucoseAverage?.toString(),
                      unit: 'mg/dL',
                      emptyText: 'No readings in $days days',
                      details: [
                        if (p.timeInRangePercent != null)
                          '${p.timeInRangePercent}% in range, 70–180',
                        if ((p.glucoseReadingCount ?? 0) > 0)
                          '${p.glucoseReadingCount} '
                              '${p.glucoseReadingCount == 1 ? 'reading' : 'readings'}'
                              ' in $days days',
                        // An estimate is worth a line only where no HbA1c
                        // was measured; beside a real one it is a second
                        // figure for the same thing.
                        if (a1c == null && p.estimatedHba1c != null)
                          'Estimates an HbA1c of ${figure(p.estimatedHba1c!)}%',
                      ],
                    ),
                  if (p.lastFasting != null)
                    FactTile(
                      label: 'Fasting glucose',
                      value: '${p.lastFasting}',
                      unit: 'mg/dL',
                      reading: fastingReading(p.lastFasting!),
                      details: [
                        if (p.lastFastingAt != null)
                          whenSentence(p.lastFastingAt!),
                      ],
                    ),
                  if (adherence != null) adherence,
                  if (leading || feet != null)
                    FactTile(
                      label: 'Feet checked',
                      value: feet == null ? null : shortDate(feet),
                      emptyText: 'Not on record',
                      reading:
                          footDue
                              ? (word: 'Check due', status: Status.watch)
                              : null,
                      details: [
                        if (feet != null && isRelativeWhen(whenLabel(feet)))
                          whenSentence(feet),
                        if (_footRiskWords(footRisk) != null)
                          _footRiskWords(footRisk)!,
                      ],
                    ),
                  if (leading || eyes != null)
                    FactTile(
                      label: 'Eyes screened',
                      value: eyes == null ? null : shortDate(eyes),
                      emptyText: 'Not on record',
                      reading:
                          eyesDue
                              ? (word: 'Screening due', status: Status.watch)
                              : null,
                      details: [
                        if (eyes != null && isRelativeWhen(whenLabel(eyes)))
                          whenSentence(eyes),
                        if (p.details.comorbidities.contains('retinopathy'))
                          'Retinopathy recorded',
                      ],
                    ),
                ],
              ),
    );
  }

  /// "on 9 Jun" this year, "in Aug 2025" before it.
  static String _onOrIn(DateTime at) =>
      at.year == DateTime.now().year
          ? 'on ${DateFormat('d MMM').format(at)}'
          : 'in ${DateFormat('MMM y').format(at)}';

  static bool _due(DateTime? at, int days) =>
      at == null || DateTime.now().difference(at).inDays >= days;

  static String? _footRiskWords(String? risk) => switch (risk) {
    'low' => 'Low foot risk',
    'moderate' => 'Moderate foot risk',
    'high' => 'High foot risk',
    'urgent' => 'Urgent foot risk',
    _ => null,
  };
}

/// The newest LDL on the record, and the one before it.
({Analyte value, DateTime? at, Analyte? previous})? latestLdl(
  List<LabReport> reports,
) {
  final found = <({Analyte value, DateTime? at})>[];
  for (final r in reports) {
    for (final a in r.analytes) {
      if (a.code == 'ldl') found.add((value: a, at: r.testedOn ?? r.createdAt));
    }
  }
  if (found.isEmpty) return null;
  found.sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));
  return (
    value: found.first.value,
    at: found.first.at,
    previous: found.length > 1 ? found[1].value : null,
  );
}

/// Blood pressure, heart rate, oxygen, LDL and the ECGs — what a cardiology
/// consultation turns on.
class HeartCard extends StatelessWidget {
  const HeartCard({
    super.key,
    required this.summary,
    required this.onOpenAdherence,
  });

  final PatientSummary summary;
  final VoidCallback onOpenAdherence;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final ldl = latestLdl(p.labResults);
    final adherence = adherenceTile(p, onOpenAdherence);

    return RecordCard(
      icon: Icons.monitor_heart_outlined,
      title: 'Heart and blood pressure',
      subtitle:
          p.vitalsAt == null
              ? 'Blood pressure, rhythm and cholesterol'
              : 'Vitals measured ${whenLabel(p.vitalsAt!)}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FactGrid(
            children: [
              bloodPressureTile(p, dated: false),
              FactTile(
                label: 'Heart rate',
                value: p.pulse?.toString(),
                unit: 'bpm',
                reading: p.pulse == null ? null : pulseReading(p.pulse!),
                emptyText: 'No heart rate on record',
              ),
              if (p.spo2 != null)
                FactTile(
                  label: 'Oxygen saturation',
                  value: '${p.spo2}',
                  unit: '%',
                  reading: spo2Reading(p.spo2!),
                ),
              FactTile(
                label: 'LDL cholesterol',
                value: ldl == null ? null : figure(ldl.value.value),
                unit: ldl?.value.unit ?? 'mg/dL',
                emptyText: 'No LDL result on record',
                reading:
                    ldl == null
                        ? null
                        : switch (ldl.value.flag) {
                          'high' || 'critical' => (
                            word: 'Above limit',
                            status: Status.alert,
                          ),
                          'normal' => (word: 'Within limit', status: Status.ok),
                          _ => null,
                        },
                details: [
                  if (ldl != null && ldl.value.refHigh != null)
                    'Limit ${figure(ldl.value.refHigh!)} ${ldl.value.unit ?? 'mg/dL'}',
                  if (ldl?.at != null) 'Tested ${whenLabel(ldl!.at!)}',
                  if (ldl?.previous != null)
                    'Before that ${figure(ldl!.previous!.value)}',
                ],
              ),
              if (adherence != null) adherence,
            ],
          ),
          const SizedBox(height: T.s5),
          EcgSection(patientId: p.id),
        ],
      ),
    );
  }
}

/// The latest blood pressure, banded as the server bands it.
FactTile bloodPressureTile(PatientSummary p, {bool dated = true}) {
  final has = p.systolic != null && p.diastolic != null;
  return FactTile(
    label: 'Blood pressure',
    value: has ? '${p.systolic}/${p.diastolic}' : null,
    unit: 'mmHg',
    reading: has ? bpReading(p.systolic!, p.diastolic!) : null,
    emptyText: 'No blood pressure on record',
    details: [
      if (dated && has && p.vitalsAt != null)
        'Measured ${whenLabel(p.vitalsAt!)}',
    ],
  );
}

/// Blood pressure, weight, pulse and oxygen — what a general consultation
/// starts from. When the patient is due back is the card after this one.
class VitalsCard extends StatelessWidget {
  const VitalsCard({
    super.key,
    required this.summary,
    required this.onOpenAdherence,
  });

  final PatientSummary summary;
  final VoidCallback onOpenAdherence;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final bmi = p.bmi;
    final adherence = adherenceTile(p, onOpenAdherence);

    final nothing =
        p.systolic == null &&
        p.weightKg == null &&
        p.pulse == null &&
        p.spo2 == null &&
        adherence == null;
    if (nothing) {
      // Said once, rather than as a grid of tiles each saying "none".
      return const RecordCard(
        icon: Icons.favorite_outline_rounded,
        title: 'Vitals',
        child: RecordNote(
          text:
              'No blood pressure, weight or pulse recorded yet. They appear '
              'here once measured at a visit or at the desk.',
        ),
      );
    }

    return RecordCard(
      icon: Icons.favorite_outline_rounded,
      title: 'Vitals',
      subtitle:
          p.vitalsAt == null ? null : 'Measured ${whenLabel(p.vitalsAt!)}',
      child: FactGrid(
        children: [
          bloodPressureTile(p, dated: false),
          FactTile(
            label: 'Weight',
            value: p.weightKg == null ? null : figure(p.weightKg!),
            unit: 'kg',
            emptyText: 'No weight on record',
            reading: bmi == null ? null : bmiReading(bmi),
            details: [
              if (bmi != null) 'BMI ${bmi.toStringAsFixed(1)}',
              if (p.weightKg != null && p.weightMeasuredAt == null)
                'Given at registration',
            ],
          ),
          if (p.pulse != null)
            FactTile(
              label: 'Heart rate',
              value: '${p.pulse}',
              unit: 'bpm',
              reading: pulseReading(p.pulse!),
            ),
          if (p.spo2 != null)
            FactTile(
              label: 'Oxygen saturation',
              value: '${p.spo2}',
              unit: '%',
              reading: spo2Reading(p.spo2!),
            ),
          if (adherence != null) adherence,
        ],
      ),
    );
  }
}

/// The measurements the leading card did not already show.
class MeasurementsCard extends StatelessWidget {
  const MeasurementsCard({
    super.key,
    required this.summary,
    required this.focus,
  });

  final PatientSummary summary;
  final RecordFocus focus;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final bmi = p.bmi;
    final leadHasVitals = focus != RecordFocus.diabetes;
    final leadHasWeight = focus == RecordFocus.general;

    final tiles = <Widget>[
      if (!leadHasVitals && p.systolic != null && p.diastolic != null)
        bloodPressureTile(p, dated: false),
      if (!leadHasVitals && p.pulse != null)
        FactTile(
          label: 'Heart rate',
          value: '${p.pulse}',
          unit: 'bpm',
          reading: pulseReading(p.pulse!),
        ),
      if (!leadHasVitals && p.spo2 != null)
        FactTile(
          label: 'Oxygen saturation',
          value: '${p.spo2}',
          unit: '%',
          reading: spo2Reading(p.spo2!),
        ),
      if (!leadHasWeight && p.weightKg != null)
        FactTile(
          label: 'Weight',
          value: figure(p.weightKg!),
          unit: 'kg',
          reading: bmi == null ? null : bmiReading(bmi),
          details: [
            if (bmi != null) 'BMI ${bmi.toStringAsFixed(1)}',
            if (p.weightMeasuredAt == null) 'Given at registration',
          ],
        ),
      if (p.waistCm != null)
        FactTile(label: 'Waist', value: figure(p.waistCm!), unit: 'cm'),
      if (p.heightCm != null)
        FactTile(label: 'Height', value: figure(p.heightCm!), unit: 'cm'),
    ];
    if (tiles.isEmpty) return const SizedBox.shrink();

    return RecordCard(
      icon: Icons.straighten_rounded,
      title: 'Measurements',
      subtitle:
          p.vitalsAt == null
              ? null
              : 'Latest measured ${whenLabel(p.vitalsAt!)}',
      child: FactGrid(children: tiles),
    );
  }
}

// ---- tests --------------------------------------------------------------------

/// What has been ordered and whether it has come back.
///
/// Awaiting or received is the whole question here, so it is a word on each
/// row rather than something inferred from which of two lists a name is in.
/// The values themselves are in the test reports, once.
class OrderedTestsCard extends StatefulWidget {
  const OrderedTestsCard({super.key, required this.summary});

  final PatientSummary summary;

  @override
  State<OrderedTestsCard> createState() => _OrderedTestsCardState();
}

class _OrderedTestsCardState extends State<OrderedTestsCard> {
  static const _cap = 4;
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    final p = widget.summary;
    final ordered = p.advisedTests;
    if (ordered.isEmpty) return const SizedBox.shrink();

    final awaiting = ordered.where((t) => reportFor(p, t) == null).length;
    final shown = _all ? ordered : ordered.take(_cap).toList();

    return RecordCard(
      icon: Icons.science_outlined,
      title: 'Tests ordered',
      subtitle:
          awaiting == 0
              ? 'All results received'
              : '$awaiting of ${ordered.length} awaiting a result',
      trailing:
          ordered.length > _cap
              ? ActionLink(
                label: _all ? 'Show fewer' : 'View all',
                onTap: () => setState(() => _all = !_all),
              )
              : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const Divider(height: T.s5, color: T.line),
            _TestRow(test: shown[i], report: reportFor(p, shown[i])),
          ],
        ],
      ),
    );
  }
}

/// The report that came back for an ordered test, if one has. Matched loosely,
/// because the patient types the name when they upload against "Other".
LabReport? reportFor(PatientSummary p, String test) {
  final want = test.trim().toLowerCase();
  for (final r in p.labResults) {
    if (r.testName.trim().toLowerCase() == want) return r;
  }
  return null;
}

class _TestRow extends StatelessWidget {
  const _TestRow({required this.test, required this.report});

  final String test;
  final LabReport? report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final analytes = labPanelFor(test)?.analytes ?? const <String>[];
    final when = r == null ? null : (r.testedOn ?? r.createdAt);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(test, style: T.bodyStrong.copyWith(color: T.ink)),
              if (r == null && analytes.isNotEmpty)
                Text(
                  'Includes ${analytes.join(', ')}',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              if (when != null)
                Text(
                  'Result ${whenLabel(when)}',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
            ],
          ),
        ),
        const SizedBox(width: T.s2),
        StatusPill(
          label: r == null ? 'Awaiting' : 'Received',
          status: r == null ? Status.watch : Status.ok,
        ),
      ],
    );
  }
}
