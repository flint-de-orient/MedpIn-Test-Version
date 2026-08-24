import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/widgets/edge_fade.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/diet_models.dart';
import 'dietician_providers.dart';
import 'widgets/dietician_bell.dart';

Color dietRiskColor(String band) => switch (band) {
  'critical' => AppColors.danger,
  'high' => const Color(0xFFEA580C),
  'moderate' => AppColors.warning,
  _ => AppColors.success,
};

/// The dietician's home: the patients a doctor has assigned to them, with the
/// ones whose food log is due for review surfaced first.
class DieticianPatientsScreen extends ConsumerStatefulWidget {
  const DieticianPatientsScreen({super.key, this.initialFilter});

  /// Which worklist to open on, when the dashboard sent them here.
  final String? initialFilter;

  @override
  ConsumerState<DieticianPatientsScreen> createState() =>
      _DieticianPatientsScreenState();
}

class _DieticianPatientsScreenState
    extends ConsumerState<DieticianPatientsScreen> {
  /// Owned here so the fade can read its position.
  final ScrollController _filterRail = ScrollController();

  final _search = TextEditingController();
  String _query = '';

  /// all | critical | high | review | noplan — the worklist on screen.
  late String _filterKey =
      const {
            'critical',
            'high',
            'review',
            'noplan',
          }.contains(widget.initialFilter)
          ? widget.initialFilter!
          : 'all';

  @override
  void dispose() {
    _filterRail.dispose();
    _search.dispose();
    super.dispose();
  }

  /// Name, phone or condition. A dietician covering every patient in the clinic
  /// scrolls a list of hundreds otherwise, and the one they want is the one who
  /// just messaged them.
  List<DietPatient> _search_(List<DietPatient> all) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return all;
    return all
        .where(
          (p) =>
              p.name.toLowerCase().contains(q) ||
              p.phone.toLowerCase().contains(q) ||
              (p.diabetesType ?? '').toLowerCase().contains(q),
        )
        .toList();
  }

  List<DietPatient> _byBand(List<DietPatient> all, String key) => switch (key) {
    'critical' => all.where((p) => p.riskBand == 'critical').toList(),
    'high' => all.where((p) => p.riskBand == 'high').toList(),
    'review' => all.where((p) => p.reviewDue).toList(),
    // Waiting for a first plan. The list endpoint does not carry a plan flag,
    // so this stands in on what it does carry: nobody has reviewed them yet.
    'noplan' => all.where((p) => p.lastReviewAt == null).toList(),
    _ => all,
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(dietPatientsProvider);
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        titleSpacing: AppSpacing.md,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'My Patients',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.accentOn(context),
              ),
            ),
            Text(
              'Worklist sorted by review priority.',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
        actions: [
          // The same counted bell as Home. A message arriving while the
          // dietician works down this list was invisible before.
          const DieticianBell(),
          // `go`, not `push`: Profile is one of this shell's own tabs, so
          // pushing it would stack a second copy over the Patients tab with a
          // back arrow instead of simply switching to it.
          GestureDetector(
            onTap: () => context.go('/dietician/profile'),
            child: UserAvatar(
              name: user?.name ?? '',
              avatarUrl: user?.avatarUrl,
              accent: AppColors.accentOn(context),
              size: 38,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(116),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.sm,
            ),
            child: Column(
              children: [
                TextField(
                  controller: _search,
                  onChanged: (v) => setState(() => _query = v),
                  style: const TextStyle(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Search patients, number, or condition…',
                    prefixIcon: Icon(
                      Icons.search_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                    suffixIcon:
                        _query.isEmpty
                            ? null
                            : IconButton(
                              icon: const Icon(Icons.close_rounded),
                              onPressed:
                                  () => setState(() {
                                    _search.clear();
                                    _query = '';
                                  }),
                            ),
                    filled: true,
                    fillColor: scheme.surfaceContainerHigh.withValues(
                      alpha: 0.55,
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(20),
                      borderSide: BorderSide.none,
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(20),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(20),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                // Counted, and counted against what the search has already
                // narrowed to — a chip reading "Critical (5)" over a list of
                // two is a chip that lies.
                SizedBox(
                  height: 32,
                  child: Builder(
                    builder: (context) {
                      final all = _search_(
                        async.valueOrNull ?? const <DietPatient>[],
                      );
                      final chips = <(String, String, int)>[
                        ('all', 'All Patients', all.length),
                        (
                          'critical',
                          'Critical',
                          _byBand(all, 'critical').length,
                        ),
                        ('high', 'High Risk', _byBand(all, 'high').length),
                        ('review', 'Review Due', _byBand(all, 'review').length),
                        (
                          'noplan',
                          'Waiting for Plan',
                          _byBand(all, 'noplan').length,
                        ),
                      ];
                      return EdgeFade(
                        controller: _filterRail,
                        child: ListView.separated(
                          controller: _filterRail,
                          scrollDirection: Axis.horizontal,
                          itemCount: chips.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 8),
                          itemBuilder: (context, i) {
                            final (key, label, count) = chips[i];
                            final selected = _filterKey == key;
                            return _FilterChip(
                              label: '$label ($count)',
                              selected: selected,
                              // An empty worklist is still worth tapping — it
                              // tells you there is nothing there — but it should
                              // not compete with the ones that hold work.
                              empty: count == 0,
                              onTap: () => setState(() => _filterKey = key),
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      // The worklist is made of other people's actions — a doctor assigning a
      // patient, a review date passing, a plan going out. Waiting for a pull
      // showed a caseload that had already moved on, and the dashboard's counts
      // and this list would disagree until the dietician thought to refresh.
      body: AutoRefresh(
        onTick: (ref) => ref.invalidate(dietPatientsProvider),
        interval: const Duration(seconds: 30),
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(dietPatientsProvider),
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.3),
                    const Center(child: Text('Could not load patients')),
                    const SizedBox(height: AppSpacing.sm),
                    Center(
                      child: OutlinedButton(
                        onPressed: () => ref.invalidate(dietPatientsProvider),
                        child: const Text('Retry'),
                      ),
                    ),
                  ],
                ),
            data: (patients) {
              if (patients.isEmpty) {
                return ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.22),
                    Icon(
                      Icons.restaurant_menu_rounded,
                      size: 54,
                      color: scheme.outlineVariant,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    const Center(
                      child: Text(
                        'No patients assigned yet',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Center(
                      child: Text(
                        'A doctor will assign patients to you.',
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                );
              }
              final matched = _byBand(_search_(patients), _filterKey);
              if (matched.isEmpty) {
                return ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.22),
                    Icon(
                      Icons.search_off_rounded,
                      size: 54,
                      color: scheme.outlineVariant,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Center(
                      child: Text(
                        _query.trim().isEmpty
                            ? 'Nothing in this list'
                            : 'No patient matches “${_query.trim()}”',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    // Reachable by tapping an empty filter, where quoting a
                    // search the dietician never typed was simply wrong.
                    if (_filterKey != 'all') ...[
                      const SizedBox(height: AppSpacing.md),
                      Center(
                        child: OutlinedButton(
                          onPressed: () => setState(() => _filterKey = 'all'),
                          child: const Text('Show all patients'),
                        ),
                      ),
                    ],
                  ],
                );
              }
              final sorted = [...matched]..sort(
                (a, b) => (b.reviewDue ? 1 : 0).compareTo(a.reviewDue ? 1 : 0),
              );
              return ListView.separated(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: sorted.length,
                separatorBuilder:
                    (_, _) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, i) => _PatientCard(patient: sorted[i]),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _PatientCard extends StatelessWidget {
  const _PatientCard({required this.patient});

  final DietPatient patient;

  static String _condition(DietPatient p) => switch (p.diabetesType) {
    'type1' => 'Type 1 Diabetes',
    'type2' => 'Type 2 Diabetes',
    'gestational' => 'Gestational DM',
    'prediabetes' => 'Prediabetes',
    _ => '',
  };

  /// When the next review falls, said the way a person would say it.
  static (String, bool) _reviewText(DietPatient p) {
    final days = p.daysUntilReview;
    // The pill on the left of this row already says "Review Due". Repeating
    // those two words on the right of the same row told the dietician nothing
    // the pill had not, and made the card look like it was insisting. The
    // right-hand text is for *when* — it stays quiet when it has no date.
    if (days == null) return ('', p.reviewDue);
    if (days < 0) {
      final n = -days;
      return ('$n ${n == 1 ? 'DAY' : 'DAYS'} OVERDUE', true);
    }
    if (days == 0) return ('TODAY', false);
    return ('IN $days ${days == 1 ? 'DAY' : 'DAYS'}', false);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final p = patient;
    final risk = AppColors.toneOn(context, dietRiskColor(p.riskBand));
    final critical = p.riskBand == 'critical';
    final (status, overdue) = _reviewText(p);
    final condition = _condition(p);

    return Material(
      color: scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => context.push('/dietician/patients/${p.id}', extra: p.name),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.55),
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF0B1B33).withValues(alpha: 0.04),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Risk as a rail down the edge. A whole card tinted by risk
                // makes every card shout; a rail lets the eye run down the list
                // and stop at the red one.
                Container(width: 5, color: risk),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      12,
                      AppSpacing.md,
                      10,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Stack(
                              clipBehavior: Clip.none,
                              children: [
                                UserAvatar(
                                  name: p.name,
                                  avatarUrl: p.avatarUrl,
                                  accent: AppColors.accentOn(context),
                                  size: 48,
                                ),
                                // The one risk band that should stop the eye
                                // before it has read anything.
                                if (critical)
                                  Positioned(
                                    right: -2,
                                    bottom: -2,
                                    child: Container(
                                      width: 19,
                                      height: 19,
                                      decoration: BoxDecoration(
                                        color: AppColors.dangerOn(context),
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: scheme.surfaceContainerLowest,
                                          width: 2,
                                        ),
                                      ),
                                      child: const Icon(
                                        Icons.priority_high_rounded,
                                        size: 11,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    p.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w800,
                                      height: 1.2,
                                    ),
                                  ),
                                  const SizedBox(height: 0),
                                  Text(
                                    [
                                      if (p.phone.isNotEmpty) p.phone,
                                      if (p.age != null) '${p.age} yrs',
                                    ].join('  •  '),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(
                                    spacing: 4,
                                    runSpacing: 4,
                                    children: [
                                      _pill(
                                        '${p.riskBand[0].toUpperCase()}${p.riskBand.substring(1)} Risk',
                                        risk,
                                      ),
                                      if (condition.isNotEmpty)
                                        _pill(
                                          condition,
                                          scheme.onSurfaceVariant,
                                          neutral: true,
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        if (status.isNotEmpty || p.reviewDue) ...[
                          const SizedBox(height: 12),
                          Divider(
                            height: 1,
                            color: scheme.outlineVariant.withValues(
                              alpha: 0.55,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              if (p.reviewDue)
                                _statusPill(
                                  context,
                                  icon: Icons.schedule_rounded,
                                  label: 'Review Due',
                                  color: const Color(0xFFB45309),
                                  bg: AppColors.warningOn(
                                    context,
                                  ).withValues(alpha: 0.13),
                                  border: AppColors.warningOn(
                                    context,
                                  ).withValues(alpha: 0.4),
                                )
                              else
                                _statusPill(
                                  context,
                                  icon: Icons.event_available_rounded,
                                  label: 'Scheduled',
                                  color: scheme.onSurfaceVariant,
                                  bg: scheme.surfaceContainerHighest.withValues(
                                    alpha: 0.7,
                                  ),
                                  border: null,
                                ),
                              const Spacer(),
                              Text(
                                status,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.3,
                                  color:
                                      overdue
                                          ? AppColors.dangerOn(context)
                                          : scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statusPill(
    BuildContext context, {
    required IconData icon,
    required String label,
    required Color color,
    required Color bg,
    required Color? border,
  }) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(20),
      border: border == null ? null : Border.all(color: border),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: color,
          ),
        ),
      ],
    ),
  );

  Widget _pill(String text, Color color, {bool neutral = false}) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: neutral ? 0.10 : 0.13),
      borderRadius: BorderRadius.circular(12),
      border: neutral ? null : Border.all(color: color.withValues(alpha: 0.35)),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
    ),
  );
}

/// One worklist filter. Filled navy when it is the list being shown, hairline
/// when it is not — the same two states the design draws.
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.empty = false,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  /// Nothing in this worklist. Drawn back so the eye goes to the filters that
  /// hold work — five chips at equal weight over four empty lists is five
  /// invitations to a dead end.
  final bool empty;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);
    final dim = empty && !selected;

    return Material(
      color: selected ? accent : scheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
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
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: dim ? FontWeight.w500 : FontWeight.w700,
              color:
                  selected
                      ? Colors.white
                      : dim
                      ? scheme.onSurfaceVariant.withValues(alpha: 0.65)
                      : scheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}
