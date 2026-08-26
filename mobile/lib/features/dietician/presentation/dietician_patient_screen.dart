import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_exception.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/core_providers.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../clinician/domain/patient_summary.dart';
import '../../foodlog/domain/food_log.dart';
import '../domain/diet_models.dart';
import '../data/dietician_repository.dart';
import 'dietician_patients_screen.dart' show dietRiskColor;
import 'dietician_providers.dart';
import 'widgets/plan_history_sheet.dart';
import '../../medications/domain/strength.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';

/// What the dietician needs to recommend food safely: the patient's medical
/// status and the doctor's current medicine list. Food advice is given in the
/// care chat (the "Message" button), informed by the food log.
class DieticianPatientScreen extends ConsumerStatefulWidget {
  const DieticianPatientScreen({
    super.key,
    required this.patientId,
    this.patientName,
  });

  final String patientId;
  final String? patientName;

  @override
  ConsumerState<DieticianPatientScreen> createState() =>
      _DieticianPatientScreenState();
}

class _DieticianPatientScreenState extends ConsumerState<DieticianPatientScreen>
    with SingleTickerProviderStateMixin {
  /// Owned here rather than taken from a [DefaultTabController] because the
  /// bottom bar and the attention banner both move the view between tabs, and
  /// both are built in this class — above where an inherited controller could
  /// be read from.
  late final TabController _tabs = TabController(length: 4, vsync: this);

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final patientId = widget.patientId;
    final patientName = widget.patientName;
    final async = ref.watch(dietOverviewProvider(patientId));

    return Scaffold(
      appBar: AppBar(title: Text(patientName ?? 'Patient')),
      // Everything on this screen belongs to somebody else's actions: the
      // patient photographs a meal, the doctor changes a prescription, the
      // server finishes reading a report. A dietician who leaves the record
      // open while writing a plan should be looking at what is true now.
      body: AutoRefresh(
        onTick: (ref) {
          ref.invalidate(dietOverviewProvider(patientId));
          ref.invalidate(dietPlanProvider(patientId));
          ref.invalidate(dietFoodLogProvider(patientId));
        },
        interval: const Duration(seconds: 30),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (_, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load this patient'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      onPressed:
                          () => ref.invalidate(dietOverviewProvider(patientId)),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          data: (o) {
            // Four tabs, not one seven-section scroll.
            //
            // A dietician opens this record with one of four questions: how is
            // this patient doing, what have they been eating, what am I telling
            // them to eat, and what did the doctor say. The jump rail answered
            // that by scrolling faster — every section was still in the way,
            // and the position was still lost on each refresh. Tabs keep one
            // question's answer whole and the other three out of it.
            //
            // The identity block is the first thing in Overview rather than
            // pinned above the bar: the app bar already carries the name, and
            // a permanent header on a phone costs more room than it says.
            return Column(
              children: [
                _PatientTabBar(controller: _tabs),
                Expanded(
                  child: TabBarView(
                    controller: _tabs,
                    children: [
                      // ---- Overview: where this patient stands -------------
                      _TabBody(
                        storageKey: 'diet-tab-overview',
                        onRefresh: () => _refresh(patientId),
                        children: [
                          _MedicalCard(overview: o),
                          const SizedBox(height: AppSpacing.md),
                          _NutritionSnapshot(overview: o),
                          const SizedBox(height: AppSpacing.md),
                          _AttentionBanner(
                            patientId: patientId,
                            overview: o,
                            onReviewLogs: () => _tabs.animateTo(1),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          _AdherenceCard(patientId: patientId, overview: o),
                          if (o.labReports.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.lg),
                            _NutritionLabs(reports: o.labReports),
                          ],
                        ],
                      ),

                      // ---- Food logs: the dietician's actual queue ---------
                      _TabBody(
                        storageKey: 'diet-tab-food',
                        onRefresh: () => _refresh(patientId),
                        children: [_FoodLogSection(patientId: patientId)],
                      ),

                      // ---- Diet plan: what they are being told to eat ------
                      _TabBody(
                        storageKey: 'diet-tab-plan',
                        onRefresh: () => _refresh(patientId),
                        children: [
                          _DietPlanSection(
                            patientId: patientId,
                            patientName: patientName ?? o.name,
                          ),
                        ],
                      ),

                      // ---- Clinical: everything the doctor put on record ---
                      _TabBody(
                        storageKey: 'diet-tab-clinical',
                        onRefresh: () => _refresh(patientId),
                        children: [
                          if (o.vitals?.hasAny ?? false) ...[
                            _VitalsSection(vitals: o.vitals!),
                            const SizedBox(height: AppSpacing.md),
                          ],
                          _MedicinesSection(meds: o.medications),
                          if (o.advice.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.md),
                            _AdviceSection(advice: o.advice),
                          ],
                          if (o.advisedTests.isNotEmpty ||
                              o.latestHba1c != null) ...[
                            const SizedBox(height: AppSpacing.md),
                            _LabTests(overview: o),
                          ],
                          if (o.labReports.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.md),
                            _LabReportsSection(reports: o.labReports),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
      // Two actions, one of them clearly primary.
      //
      // Writing to the patient is what this page leads to, so it keeps the
      // filled button; sending the plan is the other thing a dietician does
      // from here and gets an outlined one. Two equally blue buttons would
      // make the reader choose before they had decided anything.
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            Expanded(
              flex: 3,
              child: FilledButton.icon(
                onPressed:
                    () => context.push(
                      '/dietician/patients/$patientId/chat',
                      extra: patientName,
                    ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  backgroundColor: AppColors.primary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(T.rControl),
                  ),
                ),
                icon: const Icon(Icons.forum_rounded, size: 20),
                label: const Text(
                  'Message patient',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              flex: 2,
              child: OutlinedButton.icon(
                onPressed: () => _tabs.animateTo(2),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  foregroundColor: AppColors.primary,
                  side: const BorderSide(color: T.line),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(T.rControl),
                  ),
                ),
                icon: const Icon(Icons.edit_note_rounded, size: 20),
                label: const Text(
                  'Diet plan',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Every provider this page reads, so a pull on any tab refreshes the whole
  /// record rather than the one slice that tab happens to show.
  Future<void> _refresh(String patientId) async {
    ref.invalidate(dietOverviewProvider(patientId));
    ref.invalidate(dietPlanProvider(patientId));
    ref.invalidate(dietFoodLogProvider(patientId));
  }
}

class _MedicalCard extends StatelessWidget {
  const _MedicalCard({required this.overview});

  final DietPatientOverview overview;

  static String _cap(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final o = overview;
    final risk = AppColors.toneOn(context, dietRiskColor(o.riskBand));
    final danger = AppColors.dangerOn(context);

    // No card around this one. It is the patient's identity, not a section of
    // their record — boxing it made the screen open with a panel and then a
    // stack of panels, with nothing saying which one was the person.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Text(
                o.name,
                style: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: risk.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '${_cap(o.riskBand)} Risk',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: risk,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),

        // Age, sex and height on one line with their marks. These three are
        // read together — they are what a calorie target is built from — so
        // they belong on one line rather than as three labelled cells.
        Wrap(
          spacing: 16,
          runSpacing: 8,
          children: [
            if (o.age != null)
              _bit(context, Icons.calendar_today_rounded, '${o.age} yrs'),
            if ((o.gender ?? '').isNotEmpty)
              _bit(context, Icons.person_outline_rounded, _cap(o.gender!)),
            if (o.heightCm != null)
              _bit(context, Icons.height_rounded, '${o.heightCm} cm'),
            if (o.diabetesType != null && o.diabetesType!.isNotEmpty)
              _bit(context, Icons.monitor_heart_outlined, o.diabetesType!),
          ],
        ),

        if (o.chiefComplaint != null) ...[
          const SizedBox(height: AppSpacing.md),
          _label(context, 'MAIN CONCERN'),
          const SizedBox(height: 4),
          Text(
            o.chiefComplaint!,
            style: const TextStyle(fontSize: 14, height: 1.4),
          ),
        ],

        if (o.allergies.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          _label(context, 'ALLERGIES'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in o.allergies)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    // Outlined rather than filled: an allergy is a hard stop
                    // when writing a meal plan, and an outline holds the eye
                    // where a soft wash blends into the page.
                    border: Border.all(color: danger.withValues(alpha: 0.55)),
                  ),
                  child: Text(
                    a,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: danger,
                    ),
                  ),
                ),
            ],
          ),
        ],

        const SizedBox(height: AppSpacing.md),
        Divider(height: 1, color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ],
    );
  }

  Widget _bit(BuildContext context, IconData icon, String text) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: scheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(
          text,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _label(BuildContext context, String text) => Text(
    text,
    style: TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.7,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    ),
  );
}

class _MedRow extends StatelessWidget {
  const _MedRow({required this.med});

  final DietMed med;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sub = [
      if (med.strength.isNotEmpty) formatStrength(med.strength),
      if (med.dose.isNotEmpty) med.dose,
      if (med.times.isNotEmpty) med.times.join(', '),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: 12,
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.accentOn(context).withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              Icons.medication_rounded,
              size: 18,
              color: AppColors.accentOn(context),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  med.name,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (sub.isNotEmpty) ...[
                  const SizedBox(height: 0),
                  Text(
                    sub,
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DietPlanSection extends ConsumerWidget {
  /// Files the current plan as history and opens the editor on a blank page.
  ///
  /// Confirmed first: this is not undoable from the app, and a dietician who
  /// meant to tweak a portion size should not lose the plan they were editing.
  Future<void> _startNewPlan(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Start a new plan?'),
            content: const Text(
              'The current plan is filed in this patient\'s history and you write the '
              'next one on a blank page. The patient keeps following the old plan '
              'until you send the new one.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Start new plan'),
              ),
            ],
          ),
    );
    if (ok != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(dieticianRepositoryProvider).startNewDietPlan(patientId);
      ref.invalidate(dietPlanProvider(patientId));
      ref.invalidate(dietPlanHistoryProvider(patientId));
      ref.invalidate(dietOverviewProvider(patientId));
      if (context.mounted) {
        context.push('/dietician/patients/$patientId/diet', extra: patientName);
      }
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  const _DietPlanSection({required this.patientId, required this.patientName});

  final String patientId;
  final String patientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(dietPlanProvider(patientId));

    void open() =>
        context.push('/dietician/patients/$patientId/diet', extra: patientName);

    return async.when(
      loading:
          () => const Padding(
            padding: EdgeInsets.all(AppSpacing.md),
            child: Center(child: CircularProgressIndicator()),
          ),
      error: (_, _) => _note(scheme, 'Could not load the diet plan.'),
      data: (plan) {
        if (plan == null || plan.isEmpty) {
          return Material(
            color: scheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: open,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: scheme.outlineVariant.withValues(alpha: 0.6),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.restaurant_menu_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'No plan yet',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 0),
                          Text(
                            'Write one so the advice survives the conversation.',
                            style: TextStyle(
                              fontSize: 14,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        return Material(
          color: scheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: open,
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color:
                      plan.hasUnsentChanges
                          ? AppColors.warning.withValues(alpha: 0.55)
                          : scheme.outlineVariant.withValues(alpha: 0.6),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          plan.goal.isNotEmpty
                              ? plan.goal
                              : '${plan.meals.length} meals planned',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            height: 1.35,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Icon(
                        Icons.edit_outlined,
                        size: 19,
                        color: scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: 4,
                    children: [
                      // Four, not five, and each one capped. A pill reading
                      // "Mid-morning snack · 11:00 AM" took a whole row on its
                      // own, so five of them wrapped into a ragged block three
                      // lines deep — and the card still did not say whether
                      // there were more meals than it was showing.
                      for (final meal in plan.meals.take(4))
                        Container(
                          constraints: const BoxConstraints(maxWidth: 168),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.accentSoftOn(context),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            meal.time.isNotEmpty
                                ? '${meal.name} · ${meal.time}'
                                : meal.name,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.accentOn(context),
                            ),
                          ),
                        ),
                      if (plan.meals.length > 4)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: scheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            '+${plan.meals.length - 4} more',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      if (plan.avoid.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.dangerOn(
                              context,
                            ).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            '${plan.avoid.length} to avoid',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.dangerOn(context),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      Icon(
                        plan.hasUnsentChanges
                            ? Icons.schedule_rounded
                            : Icons.check_circle_rounded,
                        size: 16,
                        color:
                            plan.hasUnsentChanges
                                ? AppColors.warning
                                : AppColors.primary,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          plan.sharedAt == null
                              ? 'Not sent to the patient yet'
                              : plan.hasUnsentChanges
                              ? 'Edited since it was last sent'
                              : 'Sent ${DateFormat('d MMM').format(plan.sharedAt!)}'
                                  '${plan.dieticianName != null ? ' · ${plan.dieticianName}' : ''}',
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Divider(
                    height: 1,
                    color: scheme.outlineVariant.withValues(alpha: 0.5),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      TextButton.icon(
                        onPressed: open,
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.accentOn(context),
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                        ),
                        icon: const Icon(Icons.edit_outlined, size: 17),
                        label: const Text(
                          'Edit plan',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      // History only when there is some. The endpoint returns
                      // an empty list otherwise and a button opening an empty
                      // sheet is a button that lies about there being something
                      // to see.
                      Consumer(
                        builder: (context, ref, _) {
                          final past =
                              ref
                                  .watch(dietPlanHistoryProvider(patientId))
                                  .valueOrNull;
                          if (past == null || past.isEmpty)
                            return const SizedBox.shrink();
                          return TextButton.icon(
                            onPressed:
                                () => showPlanHistory(context, patientId),
                            style: TextButton.styleFrom(
                              foregroundColor:
                                  Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                              ),
                            ),
                            icon: const Icon(Icons.history_rounded, size: 17),
                            label: Text(
                              past.length == 1
                                  ? '1 previous'
                                  : '${past.length} previous',
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          );
                        },
                      ),
                      const Spacer(),
                      // Only offered once the patient has actually been given
                      // this plan. Replacing a draft is just editing it, and
                      // filing drafts as history would make the record claim
                      // the patient was told something they never saw.
                      if (plan.sharedAt != null)
                        TextButton.icon(
                          onPressed: () => _startNewPlan(context, ref),
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.accentOn(context),
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                          ),
                          icon: const Icon(Icons.note_add_outlined, size: 17),
                          label: const Text(
                            'New plan',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
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
      },
    );
  }

  Widget _note(ColorScheme scheme, String text) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(AppSpacing.md),
    decoration: BoxDecoration(
      color: scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
    ),
  );
}

/// What the patient has eaten — the last day at a glance, then the history.
///
/// The day is drawn as the four meal slots rather than as a list of whatever
/// happened to be logged, because the useful question is usually the negative
/// one: which meal is missing. A list of three photographs cannot answer that;
/// a grid with an empty dinner slot answers it without being read.
class _FoodLogSection extends ConsumerStatefulWidget {
  const _FoodLogSection({required this.patientId});

  final String patientId;

  @override
  ConsumerState<_FoodLogSection> createState() => _FoodLogSectionState();
}

class _FoodLogSectionState extends ConsumerState<_FoodLogSection> {
  /// Four earlier meals, then the rest on request. A month of logging put
  /// thirty rows between the dietician and the bottom of the record, and the
  /// question this section answers — what has this patient been eating lately
  /// — is answered by the top of it.
  static const _earlierCap = 4;
  bool _showAllEarlier = false;

  /// Which meals the earlier list is showing. Once a patient has logged for a
  /// month, "find the ones I have not read" is the only question worth asking
  /// of thirty rows, and scrolling for it is not an answer.
  _MealFilter _filter = _MealFilter.all;

  String get patientId => widget.patientId;

  static const _slots = <String>['breakfast', 'lunch', 'snack', 'dinner'];

  static String _cap(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  /// Entries under a heading per day, newest day first, order preserved within
  /// each day.
  static Map<String, List<FoodLogEntry>> _byDay(List<FoodLogEntry> entries) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final out = <String, List<FoodLogEntry>>{};
    for (final e in entries) {
      final at = e.createdAt;
      final String key;
      if (at == null) {
        key = 'UNDATED';
      } else {
        final diff =
            today.difference(DateTime(at.year, at.month, at.day)).inDays;
        key = switch (diff) {
          0 => 'TODAY',
          1 => 'YESTERDAY',
          _ => DateFormat('EEEE, d MMMM').format(at).toUpperCase(),
        };
      }
      out.putIfAbsent(key, () => []).add(e);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(dietFoodLogProvider(patientId));

    return async.when(
      loading:
          () => const Padding(
            padding: EdgeInsets.all(AppSpacing.md),
            child: Center(child: CircularProgressIndicator()),
          ),
      error: (_, _) => _note(scheme, 'Could not load the food log.'),
      data: (entries) {
        final cutoff = DateTime.now().subtract(const Duration(hours: 24));
        final recent =
            entries
                .where(
                  (e) => e.createdAt != null && e.createdAt!.isAfter(cutoff),
                )
                .toList();
        final earlier =
            entries
                .where(
                  (e) => e.createdAt == null || !e.createdAt!.isAfter(cutoff),
                )
                .toList();

        // The newest entry for each slot, so a patient who logged lunch twice
        // shows the one they most recently sent.
        final bySlot = <String, FoodLogEntry>{};
        for (final e in recent) {
          final key = _slots.contains(e.mealType) ? e.mealType : 'snack';
          bySlot.putIfAbsent(key, () => e);
        }

        // Nothing at all, ever. Four dotted slots and a header spend most of a
        // screen saying "no", and the answer a dietician wants from an empty
        // food log — has this patient started logging? — fits on one line.
        // The grid earns its space by showing which meal is missing; with
        // nothing logged there is no missing meal to point at.
        if (entries.isEmpty) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.55),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.photo_camera_outlined,
                  size: 19,
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'No meals logged yet — nothing to review.',
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.55),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.photo_camera_rounded,
                        size: 19,
                        color: AppColors.accentOn(context),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Food Log (Last 24h)',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: AppColors.accentOn(context),
                          ),
                        ),
                      ),
                      if (entries.any((e) => e.needsReview))
                        _MarkAllReviewed(
                          patientId: patientId,
                          outstanding:
                              entries.where((e) => e.needsReview).length,
                        )
                      else if (entries.isNotEmpty)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.check_circle_rounded,
                              size: 14,
                              color: AppColors.success,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'All reviewed',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: AppColors.success,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  for (var row = 0; row < _slots.length; row += 2) ...[
                    if (row > 0) const SizedBox(height: AppSpacing.sm),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _SlotTile(
                            patientId: patientId,
                            slot: _slots[row],
                            entry: bySlot[_slots[row]],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: _SlotTile(
                            patientId: patientId,
                            slot: _slots[row + 1],
                            entry: bySlot[_slots[row + 1]],
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            if (earlier.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: scheme.outlineVariant.withValues(alpha: 0.55),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.history_rounded,
                          size: 19,
                          color: AppColors.accentOn(context),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Earlier Meals',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              color: AppColors.accentOn(context),
                            ),
                          ),
                        ),
                        Text(
                          '${earlier.length} logged',
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        for (final f in _MealFilter.values) ...[
                          if (f != _MealFilter.values.first)
                            const SizedBox(width: 6),
                          _FilterPill(
                            label: f.label,
                            // The count, so a filter that would show nothing
                            // says so before it is tapped.
                            count: earlier.where(f.matches).length,
                            selected: _filter == f,
                            onTap: () => setState(() => _filter = f),
                          ),
                        ],
                      ],
                    ),
                    // Grouped by the day they were eaten. A flat run of thirty
                    // meals gives no sense of whether the patient logged three
                    // days solidly or one day nine times.
                    for (final day
                        in _byDay(
                          _showAllEarlier
                              ? earlier.where(_filter.matches).take(30).toList()
                              : earlier
                                  .where(_filter.matches)
                                  .take(_earlierCap)
                                  .toList(),
                        ).entries) ...[
                      const SizedBox(height: AppSpacing.md),
                      // Indented onto the rail so the day reads as a stop on
                      // the timeline rather than a heading floating beside it.
                      Padding(
                        padding: const EdgeInsets.only(
                          left: _MealTimelineRow.gutter + AppSpacing.sm,
                        ),
                        child: Text(
                          day.key,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.7,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      // A dotted rail down the day, one dot per meal. The
                      // spacing between meals lives inside each row so the
                      // line runs through it unbroken.
                      for (var i = 0; i < day.value.length; i++)
                        _MealTimelineRow(
                          entry: day.value[i],
                          isFirst: i == 0,
                          isLast: i == day.value.length - 1,
                          child: _FoodEntry(
                            patientId: patientId,
                            entry: day.value[i],
                          ),
                        ),
                    ],
                    if (earlier.where(_filter.matches).length >
                        _earlierCap) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Center(
                        child: TextButton(
                          onPressed:
                              () => setState(
                                () => _showAllEarlier = !_showAllEarlier,
                              ),
                          child: Text(
                            _showAllEarlier
                                ? 'Show less'
                                : 'View all ${earlier.where(_filter.matches).length} meals',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.accentOn(context),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _note(ColorScheme scheme, String text) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(AppSpacing.md),
    decoration: BoxDecoration(
      color: scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.5)),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
    ),
  );
}

/// One meal slot in the day: the photograph if it was logged, a dashed outline
/// saying which meal is missing if it was not.
class _SlotTile extends ConsumerWidget {
  const _SlotTile({
    required this.patientId,
    required this.slot,
    required this.entry,
  });

  final String patientId;
  final String slot;
  final FoodLogEntry? entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final label = _FoodLogSectionState._cap(slot);
    final e = entry;

    if (e == null) {
      return AspectRatio(
        aspectRatio: 1.05,
        child: DottedBorderBox(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.help_outline_rounded,
                size: 19,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(height: 4),
              Text(
                'No $slot logged',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      );
    }

    return Material(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap:
            e.photoUrl == null
                ? null
                : () => FullscreenPhoto.show(context, e.photoUrl),
        child: AspectRatio(
          aspectRatio: 1.05,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (e.photoUrl != null)
                AuthedImage(path: e.photoUrl!, fit: BoxFit.cover)
              else
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Center(
                    child: Text(
                      e.note.isEmpty ? label : e.note,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: scheme.onSurface),
                    ),
                  ),
                ),
              // The tick, top-right, over the photograph.
              //
              // On the picture rather than beside it because the picture is
              // what is being judged, and a control in a caption bar under
              // four tiles is four controls in a row with nothing tying each
              // to its plate.
              Positioned(
                top: 6,
                right: 6,
                child: _ReviewTick(patientId: patientId, entry: e),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(8, 14, 8, 7),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        const Color(0xFF0B1B33).withValues(alpha: 0),
                        const Color(0xFF0B1B33).withValues(alpha: 0.72),
                      ],
                    ),
                  ),
                  child: Row(
                    children: [
                      if (e.createdAt != null) ...[
                        // "Logged", because that is what this time is: the
                        // moment the photograph was uploaded, not the moment
                        // the meal was eaten. Without the word, a dinner
                        // uploaded at 4:43am and a breakfast at 4:44am read as
                        // a patient eating dinner before breakfast, when what
                        // actually happened is somebody catching up on their
                        // diary in one sitting.
                        Text(
                          'Logged ${DateFormat('h:mm a').format(e.createdAt!)}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 4),
                      ],
                      Expanded(
                        child: Text(
                          label,
                          maxLines: 2,
                          textAlign: TextAlign.right,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A dashed placeholder. Flutter has no dashed border, so this paints one.
class DottedBorderBox extends StatelessWidget {
  const DottedBorderBox({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashPainter(Theme.of(context).colorScheme.outlineVariant),
      child: Center(child: child),
    );
  }
}

class _DashPainter extends CustomPainter {
  const _DashPainter(this.colour);

  final Color colour;

  @override
  void paint(Canvas canvas, Size size) {
    final paint =
        Paint()
          ..color = colour
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.3;
    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(0.65, 0.65, size.width - 1.3, size.height - 1.3),
      const Radius.circular(12),
    );

    // Walk the rounded rectangle and draw every other short run of it.
    for (final metric in (Path()..addRRect(rect)).computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        final end = (d + 5).clamp(0.0, metric.length);
        canvas.drawPath(metric.extractPath(d, end), paint);
        d += 9;
      }
    }
  }

  @override
  bool shouldRepaint(_DashPainter old) => old.colour != colour;
}

class _FoodEntry extends StatelessWidget {
  const _FoodEntry({required this.patientId, required this.entry});

  final String patientId;
  final FoodLogEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final meal =
        entry.mealType.isEmpty
            ? 'Meal'
            : '${entry.mealType[0].toUpperCase()}${entry.mealType.substring(1)}';
    // Sits inside the Earlier Meals card now, so it drops its own border and
    // takes a soft fill instead — a bordered box inside a bordered box read as
    // two frames around one meal.
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.photoUrl != null)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: AuthedImage(
                path: entry.photoUrl!,
                width: 52,
                height: 52,
                radius: 10,
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      meal,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.accentOn(context),
                      ),
                    ),
                    const Spacer(),
                    if (entry.createdAt != null)
                      Text(
                        'Logged ${DateFormat('h:mm a').format(entry.createdAt!)}',
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    // The dietician's own verdict, where they left one. Only
                    // ever shown when somebody actually judged the meal — an
                    // untagged plate says nothing rather than "on track".
                    if (entry.mealStatusLabel != null) ...[
                      const SizedBox(width: 6),
                      StatusPill(
                        label: entry.mealStatusLabel!,
                        status: switch (entry.mealStatus) {
                          'on_track' => Status.ok,
                          'concern' => Status.alert,
                          _ => Status.watch,
                        },
                      ),
                    ],
                  ],
                ),
                if (entry.note.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(entry.note, style: const TextStyle(fontSize: 14)),
                ],
              ],
            ),
          ),
          // Every meal is tickable, not just today's four.
          //
          // The tick started life only on the last-24h grid, which meant the
          // header could say "7 to review" while just four of them could be
          // ticked — and the grid keeps only the newest entry per slot, so a
          // patient who logged lunch twice had one meal with no way to review
          // it at all. Per-meal review that cannot reach every meal is not
          // per-meal review.
          _ReviewTick(patientId: patientId, entry: entry),
        ],
      ),
    );
  }
}

/// Lab work the doctor ordered, with whether a result is actually back.
///
/// The pending ones matter as much as the returned: a plan written while an
/// HbA1c is still outstanding is a plan resting on a number nobody has, and the
/// dietician should be able to see that before they write it.
class _LabTests extends StatefulWidget {
  const _LabTests({required this.overview});

  final DietPatientOverview overview;

  @override
  State<_LabTests> createState() => _LabTestsState();
}

class _LabTestsState extends State<_LabTests> {
  /// Eleven ordered tests filled the screen before the lab reports underneath
  /// them came into view at all. Four is enough to see what the doctor is
  /// waiting on; the rest are one tap away.
  static const _cap = 4;
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final overview = widget.overview;
    final hba1c = overview.latestHba1c;
    // Awaiting first: those are the ones still outstanding, and a cap that
    // hides them behind results already in would hide the only actionable half.
    final ordered = [
      ...overview.advisedTests.where((t) => !t.reported),
      ...overview.advisedTests.where((t) => t.reported),
    ];
    final shown = _showAll ? ordered : ordered.take(_cap).toList();
    final hidden = ordered.length - shown.length;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.science_outlined,
            title: 'Tests ordered',
            subtitle: 'By the doctor, and what has come back',
            trailing:
                ordered.isEmpty ? null : _CountBadge(count: ordered.length),
          ),
          if (hba1c != null) ...[
            const SizedBox(height: T.s4),
            InnerTile(
              // The one number the whole plan is judged on, so it gets a tile
              // of its own rather than a line in a list of orders.
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Last HbA1c',
                          style: T.label.copyWith(
                            letterSpacing: 0,
                            color: T.inkMuted,
                          ),
                        ),
                        const SizedBox(height: 2),
                        MetricValue(value: '$hba1c', unit: '%', size: 20),
                      ],
                    ),
                  ),
                  if (overview.hba1cTestedOn != null)
                    Text(
                      DateFormat('MMM yyyy').format(overview.hba1cTestedOn!),
                      style: T.small.copyWith(color: T.inkMuted),
                    ),
                ],
              ),
            ),
          ],
          if (shown.isNotEmpty) const SizedBox(height: T.s2),
          for (final test in shown)
            Padding(
              padding: const EdgeInsets.only(top: T.s3),
              child: Row(
                children: [
                  Icon(
                    test.reported
                        ? Icons.check_circle_rounded
                        : Icons.schedule_rounded,
                    size: 17,
                    color:
                        test.reported ? AppColors.success : AppColors.warning,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: Text(test.name, style: T.body)),
                  const SizedBox(width: T.s2),
                  // "Result in" read as "result in three days" — the opposite
                  // of what it meant, on the one row where the difference is
                  // whether anyone still has to chase it.
                  StatusPill(
                    label: test.reported ? 'Received' : 'Awaiting',
                    status: test.reported ? Status.ok : Status.watch,
                  ),
                ],
              ),
            ),
          if (hidden > 0 || _showAll)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() => _showAll = !_showAll),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                  foregroundColor: AppColors.accentOn(context),
                ),
                child: Text(
                  _showAll ? 'Show less' : 'View all ${ordered.length} tests',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The patient's latest real vitals & measurements — each its own most-recent
/// reading with the date it was taken. Only what was actually recorded shows;
/// a never-recorded measurement is simply absent, never a fabricated figure.
class _VitalsSection extends StatelessWidget {
  const _VitalsSection({required this.vitals});

  final DietVitals vitals;

  static String _n(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);

  static String _glucoseLabel(String? ctx) => switch (ctx) {
    'fasting' => 'Fasting sugar',
    'pre_meal' => 'Pre-meal sugar',
    'post_meal' => 'Post-meal sugar',
    'bedtime' => 'Bedtime sugar',
    'hypo_check' => 'Hypo check',
    _ => 'Blood sugar',
  };

  @override
  Widget build(BuildContext context) {
    final v = vitals;
    final tiles = <Widget>[
      if (v.bloodPressure != null)
        _MeasureTile(
          label: 'Blood pressure',
          value: v.bloodPressure!.label,
          unit: 'mmHg',
          at: v.bloodPressure!.at,
          danger: v.bloodPressure!.isHigh,
          trend: v.bloodPressure!.trend,
        ),
      if (v.glucose != null)
        _MeasureTile(
          label: _glucoseLabel(v.glucose!.context),
          value: _n(v.glucose!.valueMgDl),
          unit: 'mg/dL',
          at: v.glucose!.at,
          danger: v.glucose!.isAbnormal,
        ),
      if (v.weightKg != null)
        _MeasureTile(
          label: 'Weight',
          value: _n(v.weightKg!.value),
          unit: 'kg',
          at: v.weightKg!.at,
          trend: v.weightKg!.trend,
        ),
      if (v.bmi != null)
        _MeasureTile(label: 'BMI', value: _n(v.bmi!), unit: '', at: null),
      if (v.waistCm != null)
        _MeasureTile(
          label: 'Waist',
          value: _n(v.waistCm!.value),
          unit: 'cm',
          at: v.waistCm!.at,
          trend: v.waistCm!.trend,
        ),
      if (v.pulse != null)
        _MeasureTile(
          label: 'Pulse',
          value: _n(v.pulse!.value),
          unit: 'bpm',
          at: v.pulse!.at,
          trend: v.pulse!.trend,
        ),
      if (v.spo2 != null)
        _MeasureTile(
          label: 'SpO₂',
          value: _n(v.spo2!.value),
          unit: '%',
          at: v.spo2!.at,
          trend: v.spo2!.trend,
        ),
      if (v.temperatureC != null)
        _MeasureTile(
          label: 'Temp',
          value: _n(v.temperatureC!.value),
          unit: '°C',
          at: v.temperatureC!.at,
          trend: v.temperatureC!.trend,
        ),
    ];

    // A single column with rules between, not a two-across grid. Each row
    // carries a trend arrow on its right edge, and paired into columns those
    // arrows landed mid-card where they read as decoration rather than as the
    // end of a line.
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.monitor_heart_rounded,
            title: 'Recent vitals',
            subtitle: 'Last recorded reading of each',
            trailing: _CountBadge(count: tiles.length),
          ),
          for (var i = 0; i < tiles.length; i++) ...[
            const _HairRule(),
            tiles[i],
          ],
        ],
      ),
    );
  }
}

/// One measurement: what it is, what it read, and which way it is moving.
///
/// The arrow is drawn only when the record actually holds an earlier reading to
/// compare against. It says direction, not judgement — whether a falling weight
/// is good or bad depends on the patient, and that is the dietician's call.
class _MeasureTile extends StatelessWidget {
  const _MeasureTile({
    required this.label,
    required this.value,
    required this.unit,
    required this.at,
    this.danger = false,
    this.trend,
  });

  final String label;
  final String value;
  final String unit;
  final DateTime? at;
  final bool danger;
  final int? trend;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = danger ? AppColors.dangerOn(context) : scheme.onSurface;

    final (IconData icon, Color colour)? arrow = switch (trend) {
      1 => (Icons.trending_up_rounded, AppColors.dangerOn(context)),
      -1 => (Icons.trending_down_rounded, scheme.onSurfaceVariant),
      0 => (Icons.trending_flat_rounded, AppColors.accentOn(context)),
      _ => null,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      value,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: fg,
                      ),
                    ),
                    if (unit.isNotEmpty) ...[
                      const SizedBox(width: 4),
                      Text(
                        unit,
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    if (at != null) ...[
                      const SizedBox(width: 8),
                      Text(
                        DateFormat('d MMM').format(at!),
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          if (arrow != null) Icon(arrow.$1, size: 20, color: arrow.$2),
        ],
      ),
    );
  }
}

class _AdviceSection extends StatelessWidget {
  const _AdviceSection({required this.advice});

  final List<DietAdvice> advice;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.assignment_outlined,
            title: 'Doctor\u2019s advice',
            subtitle: 'The reasoning a plan should respect',
            trailing:
                advice.length < 2 ? null : _CountBadge(count: advice.length),
          ),
          for (final entry in advice) ...[
            const _HairRule(),
            _AdviceTile(entry: entry),
          ],
        ],
      ),
    );
  }
}

/// One visit's advice, opening to the detail.
///
/// Built from a GestureDetector and an `if`, not an ExpansionTile.
///
/// The Material widget renders as a flat grey rectangle on the clinic's
/// phones once its card has been scrolled out of the list's cache extent and
/// rebuilt — take a record to the bottom, come back up, and the doctor's
/// advice is a grey block until the screen is left and re-entered. It is the
/// only Material default left on a screen otherwise built from this app's own
/// surfaces, and it brought a stack of layer-making machinery (Offstage,
/// ClipRect over an Align heightFactor, an AnimatedBuilder, a ListTile with
/// its own ink) to animate a disclosure. Showing and hiding the rows outright
/// costs a reflow that nobody will notice and paints with nothing but text.
class _AdviceTile extends StatefulWidget {
  const _AdviceTile({required this.entry});

  final DietAdvice entry;

  @override
  State<_AdviceTile> createState() => _AdviceTileState();
}

class _AdviceTileState extends State<_AdviceTile> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    final date =
        e.issuedOn != null
            ? DateFormat('d MMM yyyy').format(e.issuedOn!)
            : 'Undated';
    final dx = e.diagnosis.join(', ');
    final detail = <(String, String)>[
      if (e.diagnosis.isNotEmpty) ('Diagnosis', dx),
      if (e.generalAdvice.isNotEmpty) ('Advice', e.generalAdvice),
      if (e.followUpOn != null)
        ('Follow-up', DateFormat('d MMM yyyy').format(e.followUpOn!)),
      if (e.doctorName != null) ('By', e.doctorName!),
    ];

    return Padding(
      padding: const EdgeInsets.only(top: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: detail.isNotEmpty,
            expanded: detail.isEmpty ? null : _open,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap:
                  detail.isEmpty ? null : () => setState(() => _open = !_open),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(date, style: T.bodyStrong.copyWith(color: T.ink)),
                        const SizedBox(height: 2),
                        Text(
                          dx.isNotEmpty
                              ? dx
                              : (e.doctorName ?? 'Advice on record'),
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                      ],
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(width: T.s2),
                    AnimatedRotation(
                      turns: _open ? 0.5 : 0,
                      duration: const Duration(milliseconds: 160),
                      child: const Icon(
                        Icons.expand_more_rounded,
                        size: 22,
                        color: T.inkMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_open && detail.isNotEmpty) ...[
            const SizedBox(height: T.s3),
            InnerTile(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var i = 0; i < detail.length; i++) ...[
                    if (i > 0) const SizedBox(height: T.s3),
                    Text(
                      detail[i].$1.toUpperCase(),
                      style: T.label.copyWith(color: T.inkMuted),
                    ),
                    const SizedBox(height: 2),
                    Text(detail[i].$2, style: T.body.copyWith(color: T.ink)),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The reports the patient actually uploaded, each with its transcribed values,
/// a red at-a-glance line for anything out of range, and the file to open.
class _LabReportsSection extends StatefulWidget {
  const _LabReportsSection({required this.reports});

  final List<LabReport> reports;

  @override
  State<_LabReportsSection> createState() => _LabReportsSectionState();
}

class _LabReportsSectionState extends State<_LabReportsSection> {
  /// Ten reports, each with a paragraph of summary, ran to several screens and
  /// pushed the food log — the thing a dietician came for — off the bottom.
  static const _cap = 4;
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    // Newest first, so the four on show are the four that just arrived.
    final sorted = [...widget.reports]..sort((a, b) {
      final at = a.createdAt, bt = b.createdAt;
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
    final shown = _showAll ? sorted : sorted.take(_cap).toList();
    final hidden = sorted.length - shown.length;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.description_outlined,
            title: 'Lab reports',
            subtitle: 'What the lab actually sent back',
            trailing: _CountBadge(count: sorted.length),
          ),
          for (final r in shown)
            Padding(
              padding: const EdgeInsets.only(top: T.s3),
              child: _DietLabReportRow(report: r),
            ),
          if (hidden > 0 || _showAll)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() => _showAll = !_showAll),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                  foregroundColor: AppColors.accentOn(context),
                ),
                child: Text(
                  _showAll ? 'Show less' : 'View all ${sorted.length} reports',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Mirrors the doctor's lab-report row so "out of range" and "open PDF" read
/// identically in both panels. A photo opens full-screen; a PDF/document is
/// downloaded with the auth header (an in-browser open would 403) and handed to
/// the phone's viewer.
class _DietLabReportRow extends ConsumerStatefulWidget {
  const _DietLabReportRow({required this.report});

  final LabReport report;

  @override
  ConsumerState<_DietLabReportRow> createState() => _DietLabReportRowState();
}

class _DietLabReportRowState extends ConsumerState<_DietLabReportRow> {
  bool _expanded = false;

  /// The summary with any name in it taken out.
  ///
  /// These are read off the uploaded document, and the name on the document is
  /// whatever the lab printed — a spelling, an initial, sometimes a relative
  /// who collected the sample. Shown inside the record of a patient it does not
  /// match, it reads as the wrong person's results, which is the one thing a
  /// clinical record must never suggest. The patient is already named at the
  /// top of this screen; the summary only needs to say what the test found.
  String _summary(String raw) {
    var out = raw;
    for (final re in [
      RegExp(
        r'^\s*(?:patient|name)\s*[:\-]\s*[^\n.]{1,60}[.\n]?\s*',
        caseSensitive: false,
      ),
      RegExp(
        r"^\s*(?:report|results?)\s+for\s+[^\n.]{1,60}[.\n]?\s*",
        caseSensitive: false,
      ),
    ]) {
      out = out.replaceFirst(re, '');
    }
    return out.trim();
  }

  bool _busy = false;

  LabReport get report => widget.report;

  IconData _fileIcon() {
    final m = report.mimeType ?? '';
    if (m == 'application/pdf') return Icons.picture_as_pdf_rounded;
    if (m.startsWith('image/')) return Icons.image_rounded;
    return Icons.description_rounded;
  }

  Future<void> _open() async {
    if (!report.hasFile || report.photoUrl == null) return;
    if (report.isImage) {
      FullscreenPhoto.show(context, report.photoUrl);
      return;
    }
    if (_busy) return;
    setState(() => _busy = true);
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
      if (res.type != ResultType.done && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No app on this phone can open that report'),
          ),
        );
      }
    } catch (_) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the report')),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final showThumb = report.hasFile && report.isImage;
    final abnormal = report.analytes.where((a) => a.abnormal).toList();

    final tile = InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child:
                showThumb
                    ? AuthedImage(
                      path: report.photoUrl!,
                      width: 52,
                      height: 52,
                      radius: 10,
                    )
                    : Container(
                      width: 52,
                      height: 52,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child:
                          _busy
                              ? const SizedBox(
                                width: 20,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.4,
                                ),
                              )
                              : Icon(
                                _fileIcon(),
                                color: scheme.onSurfaceVariant,
                                size: 24,
                              ),
                    ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        report.testName,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (report.createdAt != null)
                      Text(
                        DateFormat('d MMM').format(report.createdAt!),
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
                if (report.analysisSummary != null &&
                    report.analysisSummary!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    _summary(report.analysisSummary!),
                    // Three lines, then Read more. These summaries run to a
                    // paragraph, and eight of them turned a list of reports
                    // into a page of prose nobody scrolls to the end of.
                    maxLines: _expanded ? null : 3,
                    overflow:
                        _expanded ? TextOverflow.clip : TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, height: 1.3),
                  ),
                  if (_summary(report.analysisSummary!).length > 150)
                    GestureDetector(
                      onTap: () => setState(() => _expanded = !_expanded),
                      child: Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          _expanded ? 'Show less' : 'Read more',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.accentOn(context),
                          ),
                        ),
                      ),
                    ),
                ] else if (report.note.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(report.note, style: const TextStyle(fontSize: 14)),
                ],
                if (report.hasFile) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        showThumb
                            ? Icons.visibility_outlined
                            : Icons.open_in_new_rounded,
                        size: 13,
                        color: AppColors.accentOn(context),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        showThumb
                            ? 'Tap to view'
                            : (report.mimeType == 'application/pdf'
                                ? 'Tap to open PDF'
                                : 'Tap to open'),
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.accentOn(context),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
                if (abnormal.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.warning_amber_rounded,
                        size: 14,
                        color: AppColors.dangerOn(context),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Out of range: ${abnormal.map((a) => '${a.label} ${a.flag == 'low' ? '↓' : '↑'}').join(', ')}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.dangerOn(context),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                if (report.analytes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    children: [
                      for (final a in report.analytes) _AnalyteChip(analyte: a),
                    ],
                  ),
                ] else if (report.analysisStatus == 'failed' ||
                    report.analysisStatus == 'unsupported') ...[
                  const SizedBox(height: 4),
                  Text(
                    'Could not read automatically — needs a look',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.warningOn(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );

    if (!report.hasFile) return tile;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: _open,
      child: tile,
    );
  }
}

/// One transcribed value: "HbA1c 9.9 %" with a coloured border + arrow when it
/// is out of its reference range. Mirrors the doctor's chip.
class _AnalyteChip extends StatelessWidget {
  const _AnalyteChip({required this.analyte});

  final Analyte analyte;

  static String _fmt(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final abnormal = analyte.abnormal;
    final color = switch (analyte.flag) {
      'high' || 'critical' => AppColors.dangerOn(context),
      'low' => AppColors.warningOn(context),
      _ => AppColors.successOn(context),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color:
            abnormal
                ? color.withValues(alpha: 0.12)
                : scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color:
              abnormal
                  ? color.withValues(alpha: 0.4)
                  : scheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${analyte.label} ',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          Text(
            _fmt(analyte.value),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: abnormal ? color : scheme.onSurface,
            ),
          ),
          if (analyte.unit != null && analyte.unit!.isNotEmpty)
            Text(
              ' ${analyte.unit}',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          if (abnormal) ...[
            const SizedBox(width: 4),
            Icon(
              analyte.flag == 'low'
                  ? Icons.arrow_downward_rounded
                  : Icons.arrow_upward_rounded,
              size: 12,
              color: color,
            ),
          ],
        ],
      ),
    );
  }
}

/// The per-meal review control.
///
/// Two states and one tap between them, because a dietician working through a
/// week of plates should not have to open anything to say "that one's fine".
/// Reverting matters as much as setting: a mis-tap on a meal that actually
/// needed a conversation would otherwise quietly bury it.
class _ReviewTick extends ConsumerStatefulWidget {
  const _ReviewTick({required this.patientId, required this.entry});

  final String patientId;
  final FoodLogEntry entry;

  @override
  ConsumerState<_ReviewTick> createState() => _ReviewTickState();
}

class _ReviewTickState extends ConsumerState<_ReviewTick> {
  bool _busy = false;

  /// Reviewed meals untick straight away — a mis-tap has to be cheap to undo.
  /// An unreviewed one opens the sheet, because the useful thing to do with a
  /// plate you have just looked at is usually to say something about it.
  Future<void> _tap() async {
    if (_busy) return;
    if (!widget.entry.needsReview) {
      await _submit(reviewed: false);
      return;
    }
    final result = await showModalBottomSheet<_ReviewResult?>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ReviewSheet(entry: widget.entry),
    );
    // null is a dismissal — the meal stays in the queue. A result with an
    // empty note is a deliberate "reviewed, nothing to add".
    if (result == null) return;
    await _submit(reviewed: true, note: result.note, status: result.status);
  }

  Future<void> _submit({
    required bool reviewed,
    String? note,
    String? status,
  }) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref
          .read(dieticianRepositoryProvider)
          .reviewFoodLog(
            widget.patientId,
            widget.entry.id,
            reviewed: reviewed,
            note: note,
            status: status,
          );
      if (mounted && (note ?? '').trim().isNotEmpty) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Feedback sent to the patient')),
        );
      }
      // Both, because the tick changes two screens: this record and the
      // dashboard's attention list and "needs review" captions.
      ref.invalidate(dietFoodLogProvider(widget.patientId));
      ref.invalidate(dietDashboardProvider);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reviewed = !widget.entry.needsReview;
    return Semantics(
      button: true,
      label: reviewed ? 'Reviewed. Tap to undo' : 'Mark this meal reviewed',
      child: GestureDetector(
        onTap: _tap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          // A comfortable target over a small badge: the visible disc is 26px
          // and would be a miss on a moving thumb.
          width: 40,
          height: 40,
          child: Center(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                color:
                    reviewed
                        ? AppColors.success
                        : Colors.white.withValues(alpha: 0.92),
                shape: BoxShape.circle,
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x33000000),
                    blurRadius: 6,
                    offset: Offset(0, 2),
                  ),
                ],
              ),
              child:
                  _busy
                      ? const Padding(
                        padding: EdgeInsets.all(6),
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                      : Icon(
                        reviewed ? Icons.check_rounded : Icons.check,
                        size: 16,
                        color:
                            reviewed ? Colors.white : const Color(0xFF9AA4B2),
                      ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Clears everything outstanding on this record at once.
class _MarkAllReviewed extends ConsumerStatefulWidget {
  const _MarkAllReviewed({required this.patientId, required this.outstanding});

  final String patientId;
  final int outstanding;

  @override
  ConsumerState<_MarkAllReviewed> createState() => _MarkAllReviewedState();
}

class _MarkAllReviewedState extends ConsumerState<_MarkAllReviewed> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final n = await ref
          .read(dieticianRepositoryProvider)
          .reviewAllFoodLogs(widget.patientId);
      ref.invalidate(dietFoodLogProvider(widget.patientId));
      ref.invalidate(dietDashboardProvider);
      messenger.showSnackBar(
        SnackBar(
          content: Text('$n ${n == 1 ? 'meal' : 'meals'} marked reviewed'),
        ),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: _run,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.warning.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_busy)
                const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                const Icon(
                  Icons.done_all_rounded,
                  size: 14,
                  color: AppColors.warning,
                ),
              const SizedBox(width: 5),
              Text(
                '${widget.outstanding} to review',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.warning,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What a dietician does with a plate they have just looked at.
///
/// The tick alone was ambiguous — it toggled a clinical state with no word
/// attached, and the first question anyone asked of it was "what does the
/// green tick mean". So the act of reviewing now has a screen: the meal being
/// judged, and the one thing a dietician actually wants to do about it.
///
/// Feedback is optional and the sheet says so. Most plates need nothing said;
/// forcing a comment on every one is how a review queue becomes something to
/// clear rather than read.
class _ReviewSheet extends StatefulWidget {
  const _ReviewSheet({required this.entry});

  final FoodLogEntry entry;

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  final _note = TextEditingController();

  /// Left unset unless the dietician picks one. Reviewing a plate without a
  /// verdict is a normal thing to do — most meals need no comment — and
  /// demanding a category on every one turns the queue into something to
  /// clear rather than read.
  String? _status;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final e = widget.entry;
    final meal =
        e.mealType.isEmpty
            ? 'Meal'
            : '${e.mealType[0].toUpperCase()}${e.mealType.substring(1)}';

    return Padding(
      // The keyboard inset, so the field is never behind the keyboard on a
      // short phone.
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (e.photoUrl != null)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: AuthedImage(
                    path: e.photoUrl!,
                    width: 56,
                    height: 56,
                    radius: 12,
                  ),
                ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      meal,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (e.createdAt != null)
                      Text(
                        DateFormat('d MMM, h:mm a').format(e.createdAt!),
                        style: TextStyle(
                          fontSize: 13,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (e.note.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              e.note,
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          Text(
            'How was it?',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              for (final v in _MealVerdict.values) ...[
                if (v != _MealVerdict.values.first)
                  const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _VerdictChip(
                    verdict: v,
                    selected: _status == v.wire,
                    // Tapping the chosen one clears it: a verdict set by
                    // mistake must be removable without closing the sheet.
                    onTap:
                        () => setState(
                          () => _status = _status == v.wire ? null : v.wire,
                        ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            autofocus: false,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: 'Feedback (optional)',
              hintText: 'e.g. Good portion — try adding a vegetable.',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  // Empty string, not null: the meal is reviewed, there is
                  // simply nothing to say about it. null means the sheet was
                  // dismissed and the meal stays in the queue.
                  onPressed:
                      () => Navigator.of(
                        context,
                      ).pop(_ReviewResult(note: '', status: _status)),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text('Mark reviewed'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _note,
                  builder:
                      (context, value, _) => FilledButton.icon(
                        onPressed:
                            value.text.trim().isEmpty
                                ? null
                                : () => Navigator.of(context).pop(
                                  _ReviewResult(
                                    note: _note.text.trim(),
                                    status: _status,
                                  ),
                                ),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          backgroundColor: AppColors.accentOn(context),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        icon: const Icon(Icons.send_rounded, size: 18),
                        label: const Text('Send'),
                      ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The five-second read: where this patient is, and which way they are going.
///
/// Every figure here is measured. Weight and BMI come from the clinic's own
/// vitals, HbA1c from the lab record with the result before it, and the
/// logging count from the food log itself.
///
/// Three things the design asked for are deliberately absent — meal-plan
/// adherence, goal progress, and a per-meal verdict. Nothing in the model
/// defines adherence to a plan, no goal carries a target, and no code
/// classifies a meal nutritionally. A percentage nobody computed is worse on
/// a clinical screen than a gap, because it will be believed.
class _NutritionSnapshot extends StatelessWidget {
  const _NutritionSnapshot({required this.overview});

  final DietPatientOverview overview;

  @override
  Widget build(BuildContext context) {
    final v = overview.vitals;
    final weight = v?.weightKg;
    final hba1c = overview.latestHba1c;
    final delta = overview.hba1cDelta;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Nutrition snapshot',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              Text(
                'Logged ${overview.foodLogDaysThisWeek}/7 days',
                style: T.label.copyWith(
                  letterSpacing: 0,
                  fontWeight: FontWeight.w600,
                  color:
                      overview.foodLogDaysThisWeek >= 5 ? T.success : T.warning,
                ),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: _SnapshotCell(
                    value: weight == null ? '—' : '${weight.value}',
                    unit: weight == null ? null : 'kg',
                    label: 'Weight',
                    // Down is the direction this clinic is usually aiming for,
                    // so it is the encouraging colour — but only when there is
                    // a previous reading to have moved from.
                    delta:
                        (weight?.previous == null)
                            ? null
                            : weight!.value - weight.previous!,
                    goodWhenFalling: true,
                    unitForDelta: 'kg',
                  ),
                ),
                const _CellDivider(),
                Expanded(
                  child: _SnapshotCell(
                    value: v?.bmi == null ? '—' : v!.bmi!.toStringAsFixed(1),
                    label: 'BMI',
                    // The band, not a number nobody reads: 27.7 means little
                    // on its own and "Overweight" is the clinical reading of
                    // it. WHO cut-offs.
                    caption: _bmiBand(v?.bmi),
                  ),
                ),
                const _CellDivider(),
                Expanded(
                  child: _SnapshotCell(
                    value: hba1c == null ? '—' : '$hba1c',
                    unit: hba1c == null ? null : '%',
                    label: 'HbA1c',
                    delta: delta,
                    goodWhenFalling: true,
                    unitForDelta: '%',
                    caption:
                        overview.hba1cTestedOn == null
                            ? null
                            : DateFormat(
                              'd MMM yyyy',
                            ).format(overview.hba1cTestedOn!),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// WHO bands. Asian cut-offs are lower, and this clinic's population would
  /// arguably be better served by them — but the doctor's panel already
  /// classifies on WHO, and two screens disagreeing about one patient's BMI
  /// would be worse than either choice.
  static String? _bmiBand(num? bmi) {
    if (bmi == null) return null;
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Healthy';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  }
}

class _CellDivider extends StatelessWidget {
  const _CellDivider();

  @override
  Widget build(BuildContext context) => Container(
    width: 1,
    margin: const EdgeInsets.symmetric(horizontal: T.s2),
    color: const Color(0xFFEDF1F7),
  );
}

class _SnapshotCell extends StatelessWidget {
  const _SnapshotCell({
    required this.value,
    required this.label,
    this.unit,
    this.caption,
    this.delta,
    this.goodWhenFalling = true,
    this.unitForDelta,
  });

  final String value;
  final String label;
  final String? unit;
  final String? caption;
  final num? delta;
  final bool goodWhenFalling;
  final String? unitForDelta;

  @override
  Widget build(BuildContext context) {
    final d = delta;
    // Zero is not a direction. Rounded first, so a change too small to print
    // does not render as an arrow pointing at nothing.
    final shown = d == null ? null : num.parse(d.abs().toStringAsFixed(1));
    final hasDelta = shown != null && shown != 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        MetricValue(value: value, unit: unit, size: 22),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 2,
          style: T.label.copyWith(
            letterSpacing: 0,
            fontWeight: FontWeight.w600,
            color: T.inkMuted,
          ),
        ),
        if (hasDelta) ...[
          const SizedBox(height: 3),
          Row(
            children: [
              Icon(
                d! < 0
                    ? Icons.arrow_downward_rounded
                    : Icons.arrow_upward_rounded,
                size: 12,
                color: (d < 0) == goodWhenFalling ? T.success : T.warning,
              ),
              const SizedBox(width: 1),
              Flexible(
                child: Text(
                  '$shown${unitForDelta ?? ''}',
                  maxLines: 1,
                  style: T.label.copyWith(
                    fontSize: 10,
                    letterSpacing: 0,
                    color: (d < 0) == goodWhenFalling ? T.success : T.warning,
                  ),
                ),
              ),
            ],
          ),
        ] else if (caption != null) ...[
          const SizedBox(height: 3),
          Text(
            caption!,
            maxLines: 2,
            style: T.label.copyWith(
              fontSize: 10,
              letterSpacing: 0,
              color: T.inkFaint,
            ),
          ),
        ],
      ],
    );
  }
}

/// What needs doing about this patient, or that nothing does.
///
/// Placed directly under the snapshot so the dietician does not have to scroll
/// three sections to discover there is work — which is what the old ordering
/// asked of them.
///
/// The two reasons are the ones the data can actually support: meals nobody
/// has read yet, and a patient who has stopped logging. Both are counted from
/// the food log itself, so the banner cannot disagree with the section under
/// it.
class _AttentionBanner extends ConsumerWidget {
  const _AttentionBanner({
    required this.patientId,
    required this.overview,
    required this.onReviewLogs,
  });

  final String patientId;
  final DietPatientOverview overview;

  /// Moves the view to the food-log tab. The banner used to offer "Review food
  /// logs" and then scroll the page by nothing, because the log was a screen
  /// further down and the anchor rail was what actually moved it.
  final VoidCallback onReviewLogs;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logs = ref.watch(dietFoodLogProvider(patientId)).valueOrNull;
    // Nothing loaded yet: say nothing rather than flash "on track" and then
    // contradict it a moment later.
    if (logs == null) return const SizedBox.shrink();

    final unreviewed = logs.where((l) => l.needsReview).length;
    final missed = 7 - overview.foodLogDaysThisWeek;
    final last = logs.isEmpty ? null : logs.first.createdAt;

    if (unreviewed > 0) {
      return _Banner(
        tone: Status.alert,
        icon: Icons.rate_review_outlined,
        title:
            '$unreviewed meal${unreviewed == 1 ? '' : 's'} waiting for review',
        detail:
            last == null
                ? 'Newly logged and not yet read.'
                : 'Most recent: ${DateFormat('d MMM, h:mm a').format(last)}',
        action: 'Review food logs',
        onTap: onReviewLogs,
      );
    }

    if (missed >= 3) {
      return _Banner(
        tone: Status.watch,
        icon: Icons.event_busy_outlined,
        title: 'Low adherence · $missed missed ${missed == 1 ? 'day' : 'days'}',
        detail:
            last == null
                ? 'No meals logged in the last week.'
                : 'Last logged ${DateFormat('d MMM').format(last)}',
        action: 'Message patient',
        onTap:
            () => context.push(
              '/dietician/patients/$patientId/chat',
              extra: overview.name,
            ),
      );
    }

    return _Banner(
      tone: Status.ok,
      icon: Icons.check_circle_outline_rounded,
      title: 'On track',
      detail:
          'Logging ${overview.foodLogDaysThisWeek}/7 days and every meal reviewed.',
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.tone,
    required this.icon,
    required this.title,
    required this.detail,
    this.action,
    this.onTap,
  });

  final Status tone;
  final IconData icon;
  final String title;
  final String detail;
  final String? action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(T.s4),
      decoration: BoxDecoration(
        color: tone.tint,
        borderRadius: BorderRadius.circular(T.rSection),
        border: Border.all(color: tone.tone.withValues(alpha: 0.28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: tone.tone),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: T.bodyStrong.copyWith(color: tone.tone)),
                const SizedBox(height: 2),
                Text(detail, style: T.small.copyWith(color: T.inkMuted)),
                if (action != null && onTap != null) ...[
                  const SizedBox(height: T.s1),
                  ActionLink(label: action!, onTap: onTap!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Which meals the earlier list shows.
enum _MealFilter {
  all('All'),
  needsReview('Needs review'),
  reviewed('Reviewed');

  const _MealFilter(this.label);

  final String label;

  bool matches(FoodLogEntry e) => switch (this) {
    _MealFilter.all => true,
    _MealFilter.needsReview => e.needsReview,
    _MealFilter.reviewed => !e.needsReview,
  };
}

/// A filter with its count on it.
///
/// The count is the point: "Needs review 0" tells a dietician they are done
/// without them having to tap it and read an empty list to find out.
class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);
    final dim = count == 0 && !selected;

    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? accent : Colors.transparent,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color:
                  selected
                      ? accent
                      : scheme.outlineVariant.withValues(
                        alpha: dim ? 0.4 : 0.8,
                      ),
            ),
          ),
          child: Text(
            '$label $count',
            style: TextStyle(
              fontSize: 12,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color:
                  selected
                      ? Colors.white
                      : dim
                      ? scheme.onSurfaceVariant.withValues(alpha: 0.6)
                      : scheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

/// What the review sheet hands back.
class _ReviewResult {
  const _ReviewResult({required this.note, this.status});

  final String note;
  final String? status;
}

/// The three verdicts a dietician can put on a meal.
enum _MealVerdict {
  onTrack('on_track', 'On track', Icons.check_circle_outline_rounded),
  review('review', 'Review', Icons.error_outline_rounded),
  concern('concern', 'Concern', Icons.report_gmailerrorred_rounded);

  const _MealVerdict(this.wire, this.label, this.icon);

  final String wire;
  final String label;
  final IconData icon;

  /// The verdict a stored `mealStatus` stands for, or null when the meal has
  /// not been judged — including for any value a future server adds that this
  /// build does not know about.
  static _MealVerdict? of(String? wire) {
    for (final v in values) {
      if (v.wire == wire) return v;
    }
    return null;
  }

  Status get status => switch (this) {
    _MealVerdict.onTrack => Status.ok,
    _MealVerdict.review => Status.watch,
    _MealVerdict.concern => Status.alert,
  };
}

class _VerdictChip extends StatelessWidget {
  const _VerdictChip({
    required this.verdict,
    required this.selected,
    required this.onTap,
  });

  final _MealVerdict verdict;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = verdict.status.tone;
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
          decoration: BoxDecoration(
            color: selected ? verdict.status.tint : Colors.transparent,
            borderRadius: BorderRadius.circular(T.rControl),
            border: Border.all(
              color: selected ? tone : T.line,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(verdict.icon, size: 18, color: selected ? tone : T.inkMuted),
              const SizedBox(height: 3),
              Text(
                verdict.label,
                maxLines: 2,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: selected ? tone : T.inkMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// How well this patient is keeping to the plan, in the two figures the data
/// can actually support.
///
/// Food logging is presence per day over the last seven. Meal-plan adherence
/// is the share of *judged* meals a dietician marked on track — which is why
/// per-meal verdicts had to exist before this card could: it is a count of
/// their own decisions, not a guess about a photograph.
///
/// The design also asked for "goal progress". There is no goal in the model
/// and no target to progress towards, so that bar is absent rather than
/// invented. It becomes possible the day a nutrition goal carries a number.
class _AdherenceCard extends ConsumerWidget {
  const _AdherenceCard({required this.patientId, required this.overview});

  final String patientId;
  final DietPatientOverview overview;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logs = ref.watch(dietFoodLogProvider(patientId)).valueOrNull;
    if (logs == null) return const SizedBox.shrink();

    final judged = logs.where((l) => l.mealStatus != null).toList();
    final onTrack = judged.where((l) => l.mealStatus == 'on_track').length;
    final planPct =
        judged.isEmpty ? null : (onTrack / judged.length * 100).round();

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Nutrition adherence',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              Text(
                'This week',
                style: T.label.copyWith(letterSpacing: 0, color: T.inkMuted),
              ),
            ],
          ),
          const SizedBox(height: T.s4),
          _AdherenceBar(
            icon: Icons.event_available_rounded,
            label: 'Food logging',
            value: overview.foodLogDaysThisWeek / 7,
            readout: '${overview.foodLogDaysThisWeek}/7',
            caption:
                overview.foodLogDaysThisWeek == 0
                    ? 'Nothing logged in the last seven days'
                    : 'days logged in the last seven',
          ),
          const SizedBox(height: T.s4),
          _AdherenceBar(
            icon: Icons.restaurant_menu_rounded,
            label: 'Meal plan adherence',
            value: planPct == null ? null : planPct / 100,
            // A dash, not 0%. Nothing judged yet is not the same as nothing
            // on track, and a bar at zero would read as the second — so the
            // reason goes underneath in words.
            readout: planPct == null ? '—' : '$planPct%',
            caption:
                judged.isEmpty
                    ? 'No meals judged yet'
                    : 'from ${judged.length} judged ${judged.length == 1 ? 'meal' : 'meals'}',
          ),
        ],
      ),
    );
  }
}

class _AdherenceBar extends StatelessWidget {
  const _AdherenceBar({
    required this.icon,
    required this.label,
    required this.value,
    required this.readout,
    this.caption,
  });

  final IconData icon;
  final String label;

  /// 0..1, or null when there is nothing to measure yet.
  final double? value;

  /// The figure itself, kept to a few characters so it can sit on the label's
  /// line. Anything that needs a sentence belongs in [caption].
  final String readout;

  /// The line under the bar: where the figure came from, or why there isn't
  /// one. Wraps freely — it has the whole width of the card.
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final v = value;
    // Green only where it is earned. A bar that is always the same colour
    // reports a number; one that changes reports a judgement.
    final tone =
        v == null
            ? T.inkFaint
            : v >= 0.8
            ? T.success
            : v >= 0.5
            ? T.warning
            : T.danger;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: T.primaryTint,
            borderRadius: BorderRadius.circular(T.rCard),
          ),
          child: Icon(icon, size: 17, color: T.primary),
        ),
        const SizedBox(width: T.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: T.small.copyWith(
                        fontWeight: FontWeight.w600,
                        color: T.ink,
                      ),
                    ),
                  ),
                  const SizedBox(width: T.s2),
                  Text(
                    readout,
                    style: T.small.copyWith(
                      fontWeight: FontWeight.w800,
                      color: v == null ? T.inkFaint : T.ink,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 7),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: v ?? 0,
                  minHeight: 7,
                  backgroundColor: const Color(0xFFEDF1F7),
                  valueColor: AlwaysStoppedAnimation(tone),
                ),
              ),
              if (caption != null) ...[
                const SizedBox(height: 5),
                Text(
                  caption!,
                  style: T.label.copyWith(
                    fontSize: 11,
                    letterSpacing: 0,
                    fontWeight: FontWeight.w500,
                    color: T.inkMuted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// The lab values a dietician acts on, newest first, with the direction each
/// has moved.
///
/// Not every result — a full panel is thirty rows and most of them are the
/// doctor's business. These are the ones a diet plan is actually written
/// against, and everything else stays one tap away under the reports section.
///
/// The trend is computed by finding the same analyte in an older report. No
/// value carries its own previous, so a direction only appears where the
/// patient genuinely has two results to compare; a single report shows the
/// figure and no arrow.
class _NutritionLabs extends StatelessWidget {
  const _NutritionLabs({required this.reports});

  final List<LabReport> reports;

  /// Codes worth surfacing, in the order a dietician reads them. Matched
  /// loosely because labs name the same test half a dozen ways.
  static const _wanted = <(String, String)>[
    ('hba1c', 'HbA1c'),
    ('glucose', 'Glucose'),
    ('triglyceride', 'Triglycerides'),
    ('hdl', 'HDL cholesterol'),
    ('ldl', 'LDL cholesterol'),
    ('vitamin d', 'Vitamin D'),
  ];

  @override
  Widget build(BuildContext context) {
    // Newest first, so "the latest value" means what it says.
    final dated = [...reports.where((r) => r.createdAt != null)]
      ..sort((a, b) => b.createdAt!.compareTo(a.createdAt!));
    if (dated.isEmpty) return const SizedBox.shrink();

    final rows = <(String, Analyte, num?)>[];
    for (final (needle, label) in _wanted) {
      Analyte? latest;
      num? previous;
      for (final report in dated) {
        final hit = report.analytes.where(
          (a) =>
              a.code.toLowerCase().contains(needle) ||
              a.label.toLowerCase().contains(needle),
        );
        if (hit.isEmpty) continue;
        if (latest == null) {
          latest = hit.first;
        } else {
          previous = hit.first.value;
          break;
        }
      }
      if (latest != null) rows.add((label, latest, previous));
    }
    if (rows.isEmpty) return const SizedBox.shrink();

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Recent lab results',
                  style: T.title.copyWith(color: T.ink),
                ),
              ),
              Text(
                DateFormat('MMM yyyy').format(dated.first.createdAt!),
                style: T.label.copyWith(letterSpacing: 0, color: T.inkMuted),
              ),
            ],
          ),
          const SizedBox(height: T.s3),
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const Divider(height: T.s4, color: Color(0xFFEDF1F7)),
            _LabRow(
              label: rows[i].$1,
              analyte: rows[i].$2,
              previous: rows[i].$3,
            ),
          ],
        ],
      ),
    );
  }
}

class _LabRow extends StatelessWidget {
  const _LabRow({
    required this.label,
    required this.analyte,
    required this.previous,
  });

  final String label;
  final Analyte analyte;
  final num? previous;

  @override
  Widget build(BuildContext context) {
    final delta = previous == null ? null : analyte.value - previous!;
    final shown =
        delta == null ? null : num.parse(delta.abs().toStringAsFixed(1));
    final hasDelta = shown != null && shown != 0;

    // Out of range is the lab's own verdict, not ours — the flag comes off the
    // report. Only that colours the row; a direction is grey, because moving
    // is not by itself good or bad without knowing which way is which for the
    // analyte in question.
    final tone = analyte.abnormal ? T.warning : T.inkMuted;

    return Row(
      children: [
        Icon(
          analyte.abnormal
              ? Icons.warning_amber_rounded
              : Icons.science_outlined,
          size: 18,
          color: analyte.abnormal ? T.warning : T.primary,
        ),
        const SizedBox(width: T.s3),
        Expanded(child: Text(label, style: T.small.copyWith(color: T.ink))),
        MetricValue(
          value: '${analyte.value}',
          unit: analyte.unit,
          size: 17,
          color: analyte.abnormal ? T.warning : T.ink,
        ),
        if (hasDelta) ...[
          const SizedBox(width: T.s2),
          Icon(
            delta! < 0
                ? Icons.arrow_downward_rounded
                : Icons.arrow_upward_rounded,
            size: 12,
            color: tone,
          ),
          Text(
            '$shown',
            style: T.label.copyWith(
              fontSize: 10,
              letterSpacing: 0,
              color: tone,
            ),
          ),
        ],
      ],
    );
  }
}

/// The four tabs across the top of a patient record.
///
/// Hand-built rather than a bare [TabBar] so the labels sit on a solid surface
/// with a hairline under it: the content behind scrolls, and an indicator
/// floating over moving cards reads as part of them.
class _PatientTabBar extends StatelessWidget {
  const _PatientTabBar({required this.controller});

  final TabController controller;

  static const _labels = ['Overview', 'Food logs', 'Diet plan', 'Clinical'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          bottom: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
      child: TabBar(
        controller: controller,
        // Four short labels fit a phone; making them scroll would hide the
        // fourth behind an edge for no gain.
        isScrollable: false,
        labelColor: accent,
        unselectedLabelColor: scheme.onSurfaceVariant,
        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        unselectedLabelStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w500,
        ),
        indicatorColor: accent,
        indicatorWeight: 2.5,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: Colors.transparent,
        splashBorderRadius: BorderRadius.circular(T.rControl),
        tabs: [for (final l in _labels) Tab(height: 44, text: l)],
      ),
    );
  }
}

/// One tab's scrolling content.
///
/// Each tab keeps its own scroll position ([storageKey]) so switching away and
/// back does not dump the reader at the top, and each carries its own pull to
/// refresh — a gesture that works on three tabs out of four is worse than one
/// that works nowhere, because the reader stops trusting it.
class _TabBody extends StatelessWidget {
  const _TabBody({
    required this.storageKey,
    required this.onRefresh,
    required this.children,
  });

  final String storageKey;
  final Future<void> Function() onRefresh;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        key: PageStorageKey<String>(storageKey),
        // Always scrollable: a short tab still has to accept the pull.
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.md,
          AppSpacing.md,
          // Clear of the two-button bar pinned at the bottom.
          110,
        ),
        children: children,
      ),
    );
  }
}

/// One meal on the dotted rail.
///
/// The dot is not decoration: filled in the verdict's colour once a dietician
/// has judged the meal, a hollow ring until then. A day of hollow rings is a
/// day nobody has read, visible before a single card is.
class _MealTimelineRow extends StatelessWidget {
  const _MealTimelineRow({
    required this.entry,
    required this.isFirst,
    required this.isLast,
    required this.child,
  });

  /// Width of the rail column. Also used to indent the day label onto it.
  static const double gutter = 22;

  final FoodLogEntry entry;
  final bool isFirst;
  final bool isLast;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final verdict = _MealVerdict.of(entry.mealStatus);
    final tone =
        verdict == null
            ? T.inkFaint
            : AppColors.toneOn(context, verdict.status.tone);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: gutter,
            child: CustomPaint(
              painter: _TimelinePainter(
                tone: tone,
                filled: verdict != null,
                drawAbove: !isFirst,
                drawBelow: !isLast,
                background:
                    Theme.of(context).colorScheme.surfaceContainerLowest,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Padding(
              // Inside the row, not between rows, so the rail keeps drawing
              // across the gap.
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.sm),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

class _TimelinePainter extends CustomPainter {
  const _TimelinePainter({
    required this.tone,
    required this.filled,
    required this.drawAbove,
    required this.drawBelow,
    required this.background,
  });

  final Color tone;
  final bool filled;
  final bool drawAbove;
  final bool drawBelow;
  final Color background;

  /// Where the dot sits, measured to land on the first text line of the card
  /// beside it rather than in the middle of a card of unknown height.
  static const double _dotY = 20;
  static const double _radius = 5;

  @override
  void paint(Canvas canvas, Size size) {
    final x = size.width / 2;
    final line =
        Paint()
          ..color = tone.withValues(alpha: 0.45)
          ..strokeWidth = 1.5
          ..strokeCap = StrokeCap.round;

    // 2 on, 4 off — short enough to read as dotted at any density, long
    // enough not to shimmer when the list scrolls.
    void dots(double from, double to) {
      for (var y = from; y < to; y += 6) {
        canvas.drawLine(Offset(x, y), Offset(x, math.min(y + 2, to)), line);
      }
    }

    if (drawAbove) dots(0, _dotY - _radius - 3);
    if (drawBelow) dots(_dotY + _radius + 3, size.height);

    if (filled) {
      canvas.drawCircle(Offset(x, _dotY), _radius, Paint()..color = tone);
    } else {
      // Hollow: knocked out to the card colour so the dotted line does not
      // show through the middle of it.
      canvas.drawCircle(Offset(x, _dotY), _radius, Paint()..color = background);
      canvas.drawCircle(
        Offset(x, _dotY),
        _radius,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.8
          ..color = tone,
      );
    }
  }

  @override
  bool shouldRepaint(_TimelinePainter old) =>
      old.tone != tone ||
      old.filled != filled ||
      old.drawAbove != drawAbove ||
      old.drawBelow != drawBelow ||
      old.background != background;
}

/// The medicines the doctor has this patient on.
///
/// A dietician reads this list for one thing — whether a drug on it changes
/// what the plan can say — so it is a section in its own right rather than a
/// list appended to the vitals.
class _MedicinesSection extends StatelessWidget {
  const _MedicinesSection({required this.meds});

  final List<DietMed> meds;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.medication_rounded,
            title: 'Current medicines',
            subtitle: 'Prescribed by the doctor',
            trailing: meds.isEmpty ? null : _CountBadge(count: meds.length),
          ),
          if (meds.isEmpty) ...[
            const SizedBox(height: T.s4),
            Text(
              'Nothing on record from the doctor yet.',
              style: T.body.copyWith(color: T.inkMuted),
            ),
          ] else
            for (final m in meds) ...[const _HairRule(), _MedRow(med: m)],
        ],
      ),
    );
  }
}

/// A count on a section heading, as a plate rather than loose type.
///
/// "Lab reports 7" set as two pieces of text read as a title someone had
/// typed a number after. The number is a different kind of thing from the
/// title and now looks like one.
class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: T.primaryTint, borderRadius: T.rFull),
      child: Text(
        '$count',
        style: T.label.copyWith(
          letterSpacing: 0,
          fontWeight: FontWeight.w800,
          color: T.primary,
        ),
      ),
    );
  }
}

/// The rule between rows inside a [SectionCard].
///
/// One weight and one inset everywhere, because five sections had five —
/// some indented past an icon, some not, some a full-strength divider and
/// some a wash. A rule that varies reads as a mistake in whichever card is
/// the odd one out.
class _HairRule extends StatelessWidget {
  const _HairRule();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      height: 1,
      margin: const EdgeInsets.only(top: T.s3),
      color: dark ? const Color(0x14FFFFFF) : T.line,
    );
  }
}
