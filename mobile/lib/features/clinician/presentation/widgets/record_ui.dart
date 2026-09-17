/// The building blocks of the doctor's patient screens: how a reading is
/// worded, how a date is said, and the few shapes a fact is drawn in.
///
/// ---- Why one file ---------------------------------------------------------
///
/// The patient record, the consultation and the prescription list each grew
/// their own way of saying the same things. Blood pressure was "High" on the
/// record and "Stage 2" on the doctor's home for the same reading; one HbA1c of
/// 8.4% was red in a tile and amber in the list beside it, because the two
/// used different thresholds. A reader who meets two answers to one number
/// stops trusting either. So the wording lives here once, taken from the
/// thresholds the server triages by (backend `services/triage/thresholds.js`,
/// signed off by the clinic), and every screen asks this file.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../domain/clinician_models.dart';
import '../../domain/patient_summary.dart';

// ---- words --------------------------------------------------------------------

/// A reading's meaning: the word a reader sees and the tone that goes with it.
/// The word is the carrier; the colour only repeats it.
typedef Reading = ({String word, Status status});

/// Blood pressure, in the bands the server files readings under and the
/// doctor's home counts — so one reading is called one thing everywhere.
/// Checked in the server's order: a crisis before a low, a low before a stage.
Reading bpReading(int systolic, int diastolic) {
  if (systolic >= 180 || diastolic >= 120) {
    return (word: 'Crisis', status: Status.alert);
  }
  if (systolic < 90 || diastolic < 60) {
    return (word: 'Low', status: Status.alert);
  }
  if (systolic >= 140 || diastolic >= 90) {
    return (word: 'Stage 2', status: Status.alert);
  }
  if (systolic >= 130 || diastolic >= 80) {
    return (word: 'Stage 1', status: Status.watch);
  }
  if (systolic >= 120) return (word: 'Elevated', status: Status.watch);
  return (word: 'Normal', status: Status.ok);
}

/// HbA1c against the clinic's target (7.0%) and its poor-control line (9.0%).
Reading hba1cReading(num percent) {
  if (percent >= 9) return (word: 'Poor control', status: Status.alert);
  if (percent >= 7) return (word: 'Above target', status: Status.watch);
  return (word: 'At target', status: Status.ok);
}

/// A fasting glucose against the fasting target (80–130 mg/dL) and the
/// hypoglycaemia lines (70, and 54 for clinically significant).
Reading fastingReading(int mgDl) {
  if (mgDl < 54) return (word: 'Very low', status: Status.alert);
  if (mgDl < 70) return (word: 'Low', status: Status.alert);
  if (mgDl < 80) return (word: 'Below target', status: Status.watch);
  if (mgDl <= 130) return (word: 'In target', status: Status.ok);
  if (mgDl < 250) return (word: 'Above target', status: Status.watch);
  return (word: 'High', status: Status.alert);
}

/// A pulse is only worded outside the limits the server raises alerts at.
/// Inside them it is a number, not a verdict.
Reading? pulseReading(int bpm) {
  if (bpm < 50) return (word: 'Slow', status: Status.alert);
  if (bpm > 120) return (word: 'Fast', status: Status.alert);
  return null;
}

/// Oxygen saturation, worded only below the server's alert line.
Reading? spo2Reading(int percent) =>
    percent < 92 ? (word: 'Low', status: Status.alert) : null;

/// Body-mass index in the WHO bands.
Reading bmiReading(double bmi) {
  if (bmi < 18.5) return (word: 'Underweight', status: Status.watch);
  if (bmi < 25) return (word: 'Normal', status: Status.ok);
  if (bmi < 30) return (word: 'Overweight', status: Status.watch);
  return (word: 'Obese', status: Status.alert);
}

/// The risk band as a phrase, or null when there is nothing true to say.
///
/// A band the server never worked out is the schema's default "low" — not a
/// finding — so it is not shown. Neither is a missing one.
Reading? riskReading(String? band, {required bool computed}) {
  return switch (band) {
    'critical' => (word: 'Critical risk', status: Status.alert),
    'high' => (word: 'High risk', status: Status.alert),
    'moderate' => (word: 'Moderate risk', status: Status.watch),
    'low' when computed => (word: 'Low risk', status: Status.ok),
    _ => null,
  };
}

/// Where a prescription stands, in the record lifecycle's words
/// (backend models/plugins/clinicalRecord.js).
///
/// A server that sends only the old `isActive` flag can say that a
/// prescription ended but not how, and this says exactly that much. One that
/// sends neither gets no word at all rather than a guess.
Reading? prescriptionStatus(PrescriptionSummary rx) {
  final state = rx.recordState;
  if (state == 'voided') return (word: 'Voided', status: Status.alert);
  if (state == 'corrected') return (word: 'Corrected', status: Status.watch);
  if (state == 'superseded') {
    return (word: 'Superseded', status: Status.neutral);
  }
  // A row switched off by the old flag while its state still says current is
  // one the backfill has not reached; the flag is the truer of the two.
  if (rx.isActive == false) {
    return (word: 'No longer current', status: Status.neutral);
  }
  if (state == 'current' || rx.isActive == true) {
    return (word: 'Current', status: Status.ok);
  }
  return null;
}

/// What was diagnosed, in words — the diabetes type first, then the rest.
List<String> conditionLabels(PatientSummary p) {
  final diabetes = switch (p.diabetesType) {
    'type1' => 'Type 1 diabetes',
    'type2' => 'Type 2 diabetes',
    'gestational' => 'Gestational diabetes',
    'prediabetes' => 'Prediabetes',
    _ => null,
  };
  final out = <String>[if (diabetes != null) diabetes];
  for (final c in p.details.comorbidities) {
    final label = switch (c) {
      'hypertension' => 'Hypertension',
      'dyslipidaemia' => 'Dyslipidaemia',
      'ckd' => 'Chronic kidney disease',
      'retinopathy' => 'Retinopathy',
      'neuropathy' => 'Neuropathy',
      'cad' => 'Coronary artery disease',
      'thyroid' => 'Thyroid disorder',
      'obesity' => 'Obesity',
      // "Other" names nothing a reader can act on.
      _ => null,
    };
    if (label != null && !out.contains(label)) out.add(label);
  }
  return out;
}

/// "58 years · Female", from whatever of the two is known.
String ageAndSex(PatientSummary p) {
  final sex = (p.gender ?? '').trim();
  return [
    if (p.age != null) '${p.age} ${p.age == 1 ? 'year' : 'years'}',
    if (sex.isNotEmpty) sex[0].toUpperCase() + sex.substring(1),
  ].join(' · ');
}

/// A name with its title taken off, for drawing an initial.
///
/// "Dr Anirban Dey" drew a "D" in every avatar, which is the title's initial
/// and nobody's. The name itself is shown unchanged everywhere it is read.
String nameForInitial(String name) {
  final words = name.trim().split(RegExp(r'\s+'));
  const titles = {
    'dr',
    'dr.',
    'prof',
    'prof.',
    'mr',
    'mr.',
    'mrs',
    'mrs.',
    'ms',
    'ms.',
    'smt',
    'smt.',
    'shri',
    'shri.',
    'sri',
    'sri.',
  };
  while (words.length > 1 && titles.contains(words.first.toLowerCase())) {
    words.removeAt(0);
  }
  return words.join(' ');
}

// ---- dates ----------------------------------------------------------------------

/// When something happened, the way a person says it: "today", "3 days ago",
/// "4 Sep", "4 Sep 2025".
///
/// Relative close up, where "4 Sep" would make the reader do arithmetic, and
/// absolute further out, where "112 days ago" would.
String whenLabel(DateTime at, {DateTime? now}) {
  final clock = now ?? DateTime.now();
  final today = DateTime(clock.year, clock.month, clock.day);
  final day = DateTime(at.year, at.month, at.day);
  final days = today.difference(day).inDays;
  if (days < 0) {
    final ahead = -days;
    if (ahead == 1) return 'tomorrow';
    if (ahead < 7) return 'in $ahead days';
    if (ahead < 28) {
      final weeks = ahead ~/ 7;
      return weeks == 1 ? 'in 1 week' : 'in $weeks weeks';
    }
    return day.year == today.year
        ? DateFormat('d MMM').format(at)
        : DateFormat('d MMM y').format(at);
  }
  if (days == 0) return 'today';
  if (days == 1) return 'yesterday';
  if (days < 7) return '$days days ago';
  if (days < 28) {
    final weeks = days ~/ 7;
    return weeks == 1 ? '1 week ago' : '$weeks weeks ago';
  }
  return day.year == today.year
      ? DateFormat('d MMM').format(at)
      : DateFormat('d MMM y').format(at);
}

/// Whether [whenLabel] said something relative ("in 2 weeks") rather than
/// repeating a date — so a line never reads "5 Oct · 5 Oct".
bool isRelativeWhen(String label) =>
    label == 'today' ||
    label == 'yesterday' ||
    label == 'tomorrow' ||
    label.startsWith('in ') ||
    label.endsWith(' ago');

/// A date as short as it can be while staying unambiguous: "8 Aug" this year,
/// "Aug 2025" before it.
String shortDate(DateTime at, {DateTime? now}) {
  final year = (now ?? DateTime.now()).year;
  return at.year == year
      ? DateFormat('d MMM').format(at)
      : DateFormat('MMM y').format(at);
}

/// The same, capitalised to start a line.
String whenSentence(DateTime at, {DateTime? now}) {
  final s = whenLabel(at, now: now);
  return s[0].toUpperCase() + s.substring(1);
}

/// A figure without trailing noise: 71.0 → "71", 71.5 → "71.5".
String figure(num v, {int decimals = 1}) =>
    v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(decimals);

// ---- shapes -----------------------------------------------------------------

/// A main section of a patient screen: the house card and heading, and the
/// same gap under the heading every time.
class RecordCard extends StatelessWidget {
  const RecordCard({
    super.key,
    required this.icon,
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(T.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: icon,
            title: title,
            subtitle: subtitle,
            trailing: trailing,
          ),
          const SizedBox(height: T.s4),
          child,
        ],
      ),
    );
  }
}

/// One fact: what it is, its figure, what the figure means, and when.
///
/// [value] null draws [statement] if there is one — a fact that is a sentence
/// rather than a number, "Checked 40 days ago" — and otherwise [emptyText]: a
/// statement that nothing is on record, never a zero or a dash standing in
/// for one.
class FactTile extends StatelessWidget {
  const FactTile({
    super.key,
    required this.label,
    this.value,
    this.unit,
    this.statement,
    this.reading,
    this.details = const [],
    this.emptyText = 'Nothing on record',
    this.onTap,
    this.semanticsHint,
  });

  final String label;
  final String? value;
  final String? unit;
  final String? statement;
  final Reading? reading;

  /// Quieter lines under the figure: when, from how much, compared with what.
  final List<String> details;
  final String emptyText;
  final VoidCallback? onTap;

  /// What tapping does, for a screen reader — "Opens the dose breakdown".
  final String? semanticsHint;

  @override
  Widget build(BuildContext context) {
    final tile = InnerTile(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: T.tap),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: T.label.copyWith(color: T.inkMuted),
                  ),
                ),
                if (onTap != null)
                  const Icon(
                    Icons.chevron_right_rounded,
                    size: T.s5,
                    color: T.inkMuted,
                  ),
              ],
            ),
            const SizedBox(height: T.s1),
            if (value != null)
              MetricValue(value: value!, unit: unit)
            else if (statement != null)
              Text(statement!, style: T.bodyStrong.copyWith(color: T.ink))
            else
              Text(emptyText, style: T.body.copyWith(color: T.inkMuted)),
            if (reading != null) ...[
              const SizedBox(height: T.s2),
              StatusPill(label: reading!.word, status: reading!.status),
            ],
            for (final d in details) ...[
              const SizedBox(height: T.s1),
              Text(d, style: T.small.copyWith(color: T.inkMuted)),
            ],
          ],
        ),
      ),
    );
    if (onTap == null) return tile;
    return Semantics(button: true, hint: semanticsHint, child: tile);
  }
}

/// Tiles two to a row on a phone, one to a row where two would crush them.
///
/// Rows share a height, so a tile with a status word does not leave its
/// neighbour looking short. Sized from the space it is given, never from a
/// ratio — a ratio that fits one text size clips at the next.
class FactGrid extends StatelessWidget {
  const FactGrid({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        // Two columns need room for a figure and its unit side by side at the
        // reader's text size; below that, one.
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final twoUp = constraints.maxWidth >= 280 * scale;
        if (!twoUp) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const SizedBox(height: T.s2),
                children[i],
              ],
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < children.length; i += 2) ...[
              if (i > 0) const SizedBox(height: T.s2),
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: children[i]),
                    const SizedBox(width: T.s2),
                    Expanded(
                      child:
                          i + 1 < children.length
                              ? children[i + 1]
                              : const SizedBox.shrink(),
                    ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// A sentence that says nothing is here, where that is itself worth knowing.
class RecordNote extends StatelessWidget {
  const RecordNote({
    super.key,
    required this.text,
    this.icon = Icons.info_outline_rounded,
  });

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 24, the height of one line of body text, so the icon sits on the
        // first line without a nudge.
        Icon(icon, size: T.s6, color: T.inkMuted),
        const SizedBox(width: T.s2),
        Expanded(child: Text(text, style: T.body.copyWith(color: T.inkMuted))),
      ],
    );
  }
}

/// A condition or a tag — neutral, because a diagnosis is not a warning.
class RecordTag extends StatelessWidget {
  const RecordTag({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: T.s3, vertical: T.s1),
      decoration: BoxDecoration(
        color: Status.neutral.tint,
        borderRadius: T.rFull,
      ),
      child: Text(label, style: T.small.copyWith(color: T.ink)),
    );
  }
}

/// A grey block standing where content is loading, the shape of what is to
/// come — so the screen does not jump when it arrives, and does not read as
/// empty while it is on its way.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, this.width, this.height = T.s4});

  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: T.line,
        borderRadius: BorderRadius.circular(T.s1),
      ),
    );
  }
}

/// Quiet actions sharing one row equally — or, when the reader's text size
/// leaves no room for a label beside its icon, one under another. Never a row
/// of two and a row of one.
class QuietActionRow extends StatelessWidget {
  const QuietActionRow({super.key, required this.actions});

  final List<QuietAction> actions;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final scaler = MediaQuery.textScalerOf(context);
        // Measured in the face the label is drawn in, which the theme sets —
        // the token alone names no family.
        final style = DefaultTextStyle.of(context).style.merge(T.bodyStrong);
        var widest = 0.0;
        for (final a in actions) {
          final painter = TextPainter(
            text: TextSpan(text: a.label, style: style),
            textScaler: scaler,
            textDirection: Directionality.of(context),
            maxLines: 1,
          )..layout();
          if (painter.width > widest) widest = painter.width;
          painter.dispose();
        }
        final gaps = T.s2 * (actions.length - 1);
        final each = (constraints.maxWidth - gaps) / actions.length;
        // Label, icon, the gap between them and the button's own padding.
        final needed = widest + T.s5 + T.s2 + T.s4 * 2;
        if (needed <= each) {
          return Row(
            children: [
              for (var i = 0; i < actions.length; i++) ...[
                if (i > 0) const SizedBox(width: T.s2),
                Expanded(child: actions[i]),
              ],
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < actions.length; i++) ...[
              if (i > 0) const SizedBox(height: T.s2),
              actions[i],
            ],
          ],
        );
      },
    );
  }
}

/// A quiet way to act: an outlined control that sizes to its label and wraps
/// with its neighbours instead of truncating when the text is raised.
class QuietAction extends StatelessWidget {
  const QuietAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        // The theme gives outlined buttons an infinite minimum width; in a
        // Wrap that is a button the width of the screen.
        minimumSize: const Size(0, T.tap),
        padding: const EdgeInsets.symmetric(horizontal: T.s4),
        foregroundColor: T.primary,
        side: const BorderSide(color: T.line),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
      icon: Icon(icon, size: T.s5),
      label: Text(label),
    );
  }
}
