import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
import '../../domain/care_summary.dart';

/// What the clinic has on file: the condition, the latest measurements, and
/// any allergy — last on Home, because none of it asks anything of today.
///
/// Only what is recorded is drawn. It was a row of Weight · Height · BMI tiles
/// that, for a new patient, read "— — —" under a greyed "Condition not set":
/// a dashboard of blanks, which looks like a screen that failed.
class HealthSummaryCard extends StatelessWidget {
  const HealthSummaryCard({super.key, required this.profile});

  final CareProfile profile;

  static String _trim(num v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = profile;
    final condition = conditionLabel(l10n, p.diabetesType);
    final bp = p.bloodPressure;

    final rows = <(String, String, (Status, String)?)>[
      if (condition != null) (l10n.ptCondition, condition, null),
      if (p.weightKg != null) (l10n.ptWeight, '${_trim(p.weightKg!)} kg', null),
      if (p.heightCm != null) (l10n.ptHeight, '${p.heightCm} cm', null),
      if (p.bmi != null) (l10n.ptBmi, _trim(p.bmi!), null),
      if (bp != null && bp.systolic > 0)
        (
          l10n.ptBloodPressure,
          '${bp.label} mmHg',
          bp.isHigh ? (Status.watch, l10n.ptAboveYourTarget) : null,
        ),
    ];

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.person_outline_rounded,
            title: l10n.ptHealthDetailsTitle,
          ),
          const SizedBox(height: T.s4),
          if (rows.isEmpty && p.allergies.isEmpty)
            Text(
              l10n.ptNothingOnFile,
              style: T.body.copyWith(color: T.inkMuted),
            )
          else
            InnerTile(
              padding: const EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s1),
              child: Column(
                children: [
                  for (final (i, r) in rows.indexed) ...[
                    if (i > 0) const Divider(height: 1, color: T.line),
                    _Row(label: r.$1, value: r.$2, status: r.$3),
                  ],
                  // An allergy is the one fact here that exists to stop
                  // something happening, so it is said in the alert colour and
                  // with a word, never as a coloured pill alone.
                  if (p.allergies.isNotEmpty) ...[
                    if (rows.isNotEmpty) const Divider(height: 1, color: T.line),
                    _Row(
                      label: l10n.healthAllergies,
                      value: p.allergies.join(', '),
                      status: (Status.alert, l10n.ptAllergyWarning),
                    ),
                  ],
                ],
              ),
            ),
          const SizedBox(height: T.s2),
          ActionLink(
            label: l10n.commonEdit,
            onTap: () => context.push('/profile/health'),
          ),
        ],
      ),
    );
  }
}

/// "Type 2 diabetes", in the patient's language, or null when none is set.
String? conditionLabel(AppLocalizations l10n, String? type) => switch (type) {
  'type1' => l10n.ptConditionType1,
  'type2' => l10n.ptConditionType2,
  'gestational' => l10n.ptConditionGestational,
  'prediabetes' => l10n.ptConditionPrediabetes,
  'none' => l10n.ptConditionNone,
  _ => null,
};

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value, this.status});

  final String label;
  final String value;
  final (Status, String)? status;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: T.s3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(label, style: T.body.copyWith(color: T.inkMuted)),
          ),
          const SizedBox(width: T.s3),
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  value,
                  textAlign: TextAlign.right,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                if (status != null)
                  StatusWord(label: status!.$2, status: status!.$1),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
