import 'dart:io';

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
import '../../../shared/widgets/edge_fade.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../../clinician/domain/patient_summary.dart';
import '../../foodlog/domain/food_log.dart';
import '../domain/diet_models.dart';
import '../data/dietician_repository.dart';
import 'dietician_patients_screen.dart' show dietRiskColor;
import 'dietician_providers.dart';
import 'widgets/plan_history_sheet.dart';
import '../../medications/domain/strength.dart';

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

class _DieticianPatientScreenState
    extends ConsumerState<DieticianPatientScreen> {
  /// Owned here so the fade can read the rail's position.
  final ScrollController _sectionRail = ScrollController();

  @override
  void dispose() {
    _sectionRail.dispose();
    super.dispose();
  }

  /// One anchor per section, so the bar above the record can jump to it.
  ///
  /// The record runs to eight sections — plan, vitals, medicines, advice,
  /// tests, reports, food log — and a dietician who opens it to check what the
  /// doctor prescribed was scrolling past all of it to find out. The bar
  /// stays put while the record scrolls under it.
  final _anchors = <String, GlobalKey>{};

  GlobalKey _anchor(String id) => _anchors.putIfAbsent(id, GlobalKey.new);

  Future<void> _jumpTo(String id) async {
    final ctx = _anchors[id]?.currentContext;
    if (ctx == null) return;
    await Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
      alignment: 0.02,
    );
  }

  @override
  Widget build(BuildContext context) {
    final patientId = widget.patientId;
    final patientName = widget.patientName;
    final scheme = Theme.of(context).colorScheme;
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
            // Only the sections this patient actually has. A jump bar offering
            // "Lab reports" on a record with none is a promise it cannot keep.
            final sections = <(String, String)>[
              ('plan', 'Diet plan'),
              if (o.vitals?.hasAny ?? false) ('vitals', 'Vitals'),
              if (o.medications.isNotEmpty) ('meds', 'Medicines'),
              if (o.advice.isNotEmpty) ('advice', 'Advice'),
              if (o.advisedTests.isNotEmpty || o.latestHba1c != null)
                ('tests', 'Tests'),
              if (o.labReports.isNotEmpty) ('reports', 'Reports'),
              ('food', 'Food log'),
            ];
            return Column(
              children: [
                if (sections.length > 2)
                  Container(
                    height: 44,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: scheme.surface,
                      border: Border(
                        bottom: BorderSide(
                          color: scheme.outlineVariant.withValues(alpha: 0.5),
                        ),
                      ),
                    ),
                    // Wrapped, not scrolled.
                    //
                    // A horizontal rail always slices whatever falls at the
                    // edge — "Advice · T" — and fading that edge only makes
                    // the cut prettier; the section is still hidden, and a
                    // jump-to control nobody can see is a jump-to control
                    // nobody uses. There are six of these and they are known
                    // at build time, so they can simply all be on screen. Two
                    // lines of chrome buys every section one tap away, which
                    // is the whole point of the bar.
                    // One scrolling row, faded at whichever end has more
                    // behind it. Wrapping these put two rows of chrome above
                    // every patient record; the record is what the screen is
                    // for.
                    child: SizedBox(
                      height: MediaQuery.textScalerOf(context).scale(46),
                      child: EdgeFade(
                        controller: _sectionRail,
                        child: ListView.separated(
                          controller: _sectionRail,
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                            vertical: 6,
                          ),
                          itemCount: sections.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 8),
                          itemBuilder: (context, i) {
                            final (id, label) = sections[i];
                            return ActionChip(
                              label: Text(label),
                              visualDensity: VisualDensity.compact,
                              onPressed: () => _jumpTo(id),
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh:
                        () async =>
                            ref.invalidate(dietOverviewProvider(patientId)),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.md,
                        AppSpacing.md,
                        AppSpacing.md,
                        110,
                      ),
                      children: [
                        _MedicalCard(overview: o),
                        const SizedBox(height: AppSpacing.lg),
                        // Above the medicines and the log on purpose: the plan is what the
                        // dietician is here to produce; everything below it is input.
                        KeyedSubtree(
                          key: _anchor('plan'),
                          child: _SectionTitle('Diet plan'),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        _DietPlanSection(
                          patientId: patientId,
                          patientName: patientName ?? o.name,
                        ),
                        if (o.vitals?.hasAny ?? false) ...[
                          const SizedBox(height: AppSpacing.lg),

                          const SizedBox(height: AppSpacing.sm),
                          KeyedSubtree(
                            key: _anchor('vitals'),
                            child: _VitalsSection(vitals: o.vitals!),
                          ),
                        ],
                        const SizedBox(height: AppSpacing.lg),
                        KeyedSubtree(
                          key: _anchor('meds'),
                          child: _SectionTitle(
                            'Current medicines',
                            trailing: '${o.medications.length}',
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        if (o.medications.isEmpty)
                          _emptyNote(
                            scheme,
                            'No medicines on record from the doctor yet.',
                          )
                        else
                          Container(
                            decoration: BoxDecoration(
                              color: scheme.surfaceContainerLowest,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: scheme.outlineVariant.withValues(
                                  alpha: 0.6,
                                ),
                              ),
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Column(
                              children: [
                                for (
                                  var i = 0;
                                  i < o.medications.length;
                                  i++
                                ) ...[
                                  if (i > 0)
                                    Divider(
                                      height: 1,
                                      indent: 56,
                                      color: scheme.outlineVariant.withValues(
                                        alpha: 0.4,
                                      ),
                                    ),
                                  _MedRow(med: o.medications[i]),
                                ],
                              ],
                            ),
                          ),
                        if (o.advice.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.lg),
                          KeyedSubtree(
                            key: _anchor('advice'),
                            child: _SectionTitle('Doctor’s advice'),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          _AdviceSection(advice: o.advice),
                        ],
                        if (o.advisedTests.isNotEmpty ||
                            o.latestHba1c != null) ...[
                          const SizedBox(height: AppSpacing.lg),
                          KeyedSubtree(
                            key: _anchor('tests'),
                            child: _SectionTitle('Tests ordered by the doctor'),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          _LabTests(overview: o),
                        ],
                        if (o.labReports.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.lg),
                          KeyedSubtree(
                            key: _anchor('reports'),
                            child: _SectionTitle(
                              'Lab reports',
                              trailing: '${o.labReports.length}',
                            ),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          _LabReportsSection(reports: o.labReports),
                        ],
                        const SizedBox(height: AppSpacing.lg),
                        KeyedSubtree(
                          key: _anchor('food'),
                          child: _FoodLogSection(patientId: patientId),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.all(AppSpacing.md),
        child: FilledButton.icon(
          onPressed:
              () => context.push(
                '/dietician/patients/$patientId/chat',
                extra: patientName,
              ),
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            backgroundColor: AppColors.primary,
          ),
          icon: const Icon(Icons.forum_rounded),
          label: const Text(
            'Message patient',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
        ),
      ),
    );
  }

  Widget _emptyNote(ColorScheme scheme, String text) => Container(
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {this.trailing});
  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          text,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 8),
          Text(
            trailing!,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

/// The plan at a glance, with the one thing that matters most about it: whether
/// the patient has actually been sent it. A finished-looking plan the patient
/// has never seen is a draft, and the card says so rather than looking done.
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
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
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
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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
                    // Grouped by the day they were eaten. A flat run of thirty
                    // meals gives no sense of whether the patient logged three
                    // days solidly or one day nine times.
                    for (final day
                        in _byDay(
                          _showAllEarlier
                              ? earlier.take(30).toList()
                              : earlier.take(_earlierCap).toList(),
                        ).entries) ...[
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        day.key,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.7,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      for (var i = 0; i < day.value.length; i++) ...[
                        if (i > 0) const SizedBox(height: AppSpacing.sm),
                        _FoodEntry(patientId: patientId, entry: day.value[i]),
                      ],
                    ],
                    if (earlier.length > _earlierCap) ...[
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
                                : 'View all ${earlier.length} meals',
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
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
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
    final scheme = Theme.of(context).colorScheme;
    final hba1c = overview.latestHba1c;
    // Awaiting first: those are the ones still outstanding, and a cap that
    // hides them behind results already in would hide the only actionable half.
    final ordered = [
      ...overview.advisedTests.where((t) => !t.reported),
      ...overview.advisedTests.where((t) => t.reported),
    ];
    final shown = _showAll ? ordered : ordered.take(_cap).toList();
    final hidden = ordered.length - shown.length;

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
          if (hba1c != null) ...[
            Row(
              children: [
                Icon(
                  Icons.science_outlined,
                  size: 19,
                  color: AppColors.accentOn(context),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'Last HbA1c  $hba1c%',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                if (overview.hba1cTestedOn != null)
                  Text(
                    DateFormat('MMM yyyy').format(overview.hba1cTestedOn!),
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            if (overview.advisedTests.isNotEmpty)
              const Divider(height: AppSpacing.lg),
          ],
          for (final test in shown)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
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
                  Expanded(
                    child: Text(
                      test.name,
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                  Text(
                    // "Result in" read as "result in three days" — the
                    // opposite of what it meant, on the one row where the
                    // difference is whether anyone still has to chase it.
                    test.reported ? 'Result received' : 'Awaiting result',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color:
                          test.reported ? AppColors.success : AppColors.warning,
                    ),
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
    final scheme = Theme.of(context).colorScheme;
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

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.55),
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      // A single column with rules between, not a two-across grid. Each row
      // carries a trend arrow on its right edge, and paired into columns those
      // arrows landed mid-card where they read as decoration rather than as the
      // end of a line.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                Icons.monitor_heart_rounded,
                size: 19,
                color: AppColors.accentOn(context),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Recent Vitals',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.accentOn(context),
                  ),
                ),
              ),
              Text(
                tiles.length == 1 ? '1 measure' : '${tiles.length} measures',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: 0),
          for (var i = 0; i < tiles.length; i++) ...[
            Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
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
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < advice.length; i++) ...[
            if (i > 0)
              Divider(
                height: 1,
                color: scheme.outlineVariant.withValues(alpha: 0.4),
              ),
            _AdviceTile(entry: advice[i]),
          ],
        ],
      ),
    );
  }
}

class _AdviceTile extends StatelessWidget {
  const _AdviceTile({required this.entry});

  final DietAdvice entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final date =
        entry.issuedOn != null
            ? DateFormat('d MMM yyyy').format(entry.issuedOn!)
            : '—';
    final dx = entry.diagnosis.join(', ');
    return Theme(
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
        title: Text(
          date,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          dx.isNotEmpty ? dx : (entry.doctorName ?? 'Advice on record'),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
        ),
        children: [
          if (entry.diagnosis.isNotEmpty)
            _kv(scheme, 'Diagnosis', entry.diagnosis.join(', ')),
          if (entry.generalAdvice.isNotEmpty)
            _kv(scheme, 'Advice', entry.generalAdvice),
          if (entry.followUpOn != null)
            _kv(
              scheme,
              'Follow-up',
              DateFormat('d MMM yyyy').format(entry.followUpOn!),
            ),
          if (entry.doctorName != null) _kv(scheme, 'By', entry.doctorName!),
        ],
      ),
    );
  }

  Widget _kv(ColorScheme scheme, String k, String v) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          k.toUpperCase(),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
            color: scheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 0),
        Text(v, style: const TextStyle(fontSize: 14, height: 1.35)),
      ],
    ),
  );
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

    return Column(
      children: [
        for (final r in shown)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
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

    final tile = Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
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
          Flexible(
            child: Text(
              '${analyte.label} ',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
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
    final note = await showModalBottomSheet<String?>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ReviewSheet(entry: widget.entry),
    );
    // null is a dismissal — the meal stays in the queue. An empty string is a
    // deliberate "reviewed, nothing to add".
    if (note == null) return;
    await _submit(reviewed: true, note: note);
  }

  Future<void> _submit({required bool reviewed, String? note}) async {
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
          TextField(
            controller: _note,
            autofocus: true,
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
                  onPressed: () => Navigator.of(context).pop(''),
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
                                : () => Navigator.of(
                                  context,
                                ).pop(_note.text.trim()),
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
