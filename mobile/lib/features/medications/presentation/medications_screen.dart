import 'dart:async';

import 'package:flutter/material.dart';

import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/providers/preferences_provider.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/health_ring.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/medications_repository.dart';
import '../domain/medication.dart';
import 'medications_providers.dart';
import 'reminder_setup_sheet.dart';
import 'widgets/scan_prescription_sheet.dart';
import 'widgets/mark_dose_sheet.dart';
import 'widgets/medication_slot_tile.dart';
import '../domain/strength.dart';
import '../../../shared/widgets/clinic_brand.dart';

/// The patient's medicines: the windows their reminders fire in, what they are
/// currently prescribed, and today's outstanding doses.
class MedicationsScreen extends ConsumerStatefulWidget {
  const MedicationsScreen({super.key});

  @override
  ConsumerState<MedicationsScreen> createState() => _MedicationsScreenState();
}

class _MedicationsScreenState extends ConsumerState<MedicationsScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  /// Prescriptions and their times are the doctor's to change, not the
  /// patient's. Waiting for a pull-to-refresh meant a retimed dose kept showing
  /// the old hour — and, because the reminder scheduler is driven by this
  /// list, kept ringing at it too.
  static const _pollInterval = Duration(seconds: 30);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_pollInterval, (_) => _refreshFromServer());
    // One-time: if reminders are on but the OS could sleep them, offer the
    // reliability fix. Post-frame so a sheet has a mounted context to open in.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) maybePromptReminderSetup(context, ref);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshFromServer();
  }

  void _refreshFromServer() {
    if (mounted) _refreshAll(ref);
  }

  void _refreshAll(WidgetRef ref) {
    // Reloads everything a new medicine affects. Invalidating the list also
    // re-fires the reminder scheduler via the listener in build().
    ref.invalidate(todayScheduleProvider);
    ref.invalidate(medicationAdherenceProvider);
    ref.invalidate(medicationsListProvider);
  }

  /// Patients add medicines by scanning Dr.'s prescription only — typing them
  /// in is the doctor's side (the prescription form). This keeps the patient's
  /// medicine list faithful to what was actually prescribed.
  Future<void> _onScan(BuildContext context, WidgetRef ref) async {
    final added = await showScanPrescriptionSheet(context);
    if (added == true) _refreshAll(ref);
  }

  Future<void> _handleTap(
    BuildContext context,
    WidgetRef ref,
    TodaySchedule schedule,
    MedicationScheduleSlot slot,
  ) async {
    final result = await showMarkDoseSheet(context, slot.name);
    if (result == null) return;

    final datePart =
        schedule.date.isNotEmpty
            ? schedule.date
            : DateTime.now().toIso8601String().substring(0, 10);
    final scheduledFor =
        DateTime.tryParse('${datePart}T${slot.time}:00') ?? DateTime.now();

    await ref
        .read(medicationsRepositoryProvider)
        .logDose(
          medicationId: slot.medicationId,
          scheduledFor: scheduledFor,
          status: result.status,
          skipReason: result.skipReason,
        );
    ref.invalidate(todayScheduleProvider);
    ref.invalidate(medicationAdherenceProvider);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final medsAsyncRaw = ref.watch(medicationsListProvider);
    // Hold the last list while a background poll is in flight, or the screen
    // would drop to a spinner every thirty seconds.
    final medsLoaded = medsAsyncRaw.valueOrNull;
    final medsAsync =
        medsLoaded != null
            ? AsyncData<List<Medication>>(medsLoaded)
            : medsAsyncRaw;
    final scheduleAsync = ref.watch(todayScheduleProvider);
    final meals = ref.watch(mealTimesProvider).valueOrNull;

    // Keep on-device reminders in step with the live medication list: whenever
    // it (re)loads — after a scan, a manual add, or a doctor's prescription —
    // the daily reminders are rebuilt.
    ref.listen<AsyncValue<List<Medication>>>(medicationsListProvider, (
      _,
      next,
    ) {
      if (ref.read(appPreferencesProvider).medicationReminders) {
        next.whenData(
          (meds) => syncMedicationReminders(
            meds,
            today: ref.read(todayScheduleProvider).valueOrNull,
          ),
        );
      }
    });

    // Re-arm when today's statuses change too — so marking a dose taken cancels
    // today's alarm for that slot (the refetched schedule shows it taken, and
    // the rebuild leaves it out) instead of nagging for a dose already taken.
    ref.listen<AsyncValue<TodaySchedule>>(todayScheduleProvider, (_, next) {
      if (ref.read(appPreferencesProvider).medicationReminders) {
        next.whenData(
          (today) => syncMedicationReminders(
            ref.read(medicationsListProvider).valueOrNull ?? const [],
            today: today,
          ),
        );
      }
    });

    return Scaffold(
      // Transparent so the shell's ground runs unbroken behind this
      // screen and the navigation bar alike. An opaque page here left a
      // visible band of ground around the pill and nowhere else.
      backgroundColor: Colors.transparent,
      // No floating button. An extended FAB over a scrolling list means every
      // bottom-anchored thing on the screen becomes a special case, and here it
      // sat on top of the last prescription card and the day's final dose row.
      // Scanning is the primary action, so it gets a full-width button at the
      // top of the content instead — more prominent than the FAB was, and it
      // covers nothing.
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const _BrandHeader(),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  _refreshAll(ref);
                  ref.invalidate(mealTimesProvider);
                },
                child: medsAsync.when(
                  loading:
                      () => const Center(child: CircularProgressIndicator()),
                  error:
                      (error, _) => ListView(
                        children: [
                          SizedBox(
                            height: 400,
                            child: ErrorView(
                              error: error,
                              onRetry:
                                  () => ref.invalidate(medicationsListProvider),
                            ),
                          ),
                        ],
                      ),
                  data: (meds) {
                    final active = meds.where((m) => m.isActive).toList();

                    // Zero padding so the band reaches both edges; the rest
                    // is padded on its own. See HeroBand.
                    return ListView(
                      padding: const EdgeInsets.only(bottom: T.s8),
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                            T.s6,
                            T.s2,
                            T.s6,
                            0,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _DoseRing(schedule: scheduleAsync.valueOrNull),
                              const SizedBox(height: T.s4),
                              _ScanAction(onTap: () => _onScan(context, ref)),
                            ],
                          ),
                        ),
                        const SizedBox(height: T.s6),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: T.s6),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // Side by side, as the design draws them. Stacked
                              // full-width they read as two more rows in a list of
                              // rows; as a pair they read as the two places to go.
                              Row(
                                children: [
                                  Expanded(
                                    child: _HubCard(
                                      icon: Icons.history_rounded,
                                      title: 'Dose history',
                                      subtitle: 'Taken & missed',
                                      onTap:
                                          () => context.push(
                                            '/medications/history',
                                          ),
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: _HubCard(
                                      icon: Icons.description_rounded,
                                      title: 'Prescriptions',
                                      subtitle: 'View & share',
                                      onTap:
                                          () => context.push(
                                            '/medications/prescriptions',
                                          ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: T.s8),

                              const _MicroLabel('Reminder windows'),
                              const SizedBox(height: T.s3),
                              _ReminderWindows(
                                meals: meals,
                                onTap:
                                    () =>
                                        context.push('/medications/reminders'),
                              ),
                              const SizedBox(height: T.s8),

                              const _MicroLabel('Active prescriptions'),
                              const SizedBox(height: T.s3),
                              if (active.isEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(
                                    top: AppSpacing.lg,
                                  ),
                                  child: EmptyView(
                                    icon: Icons.medication_outlined,
                                    title: l10n.medsEmptyTitle,
                                    body: l10n.medsEmptyBody,
                                  ),
                                )
                              else
                                for (final med in active)
                                  _PrescriptionCard(
                                    medication: med,
                                    meals: meals,
                                  ),

                              // Kept below the design's content rather than dropped:
                              // ticking a dose is what produces the adherence figure
                              // the doctor sees, and there is nowhere else to do it.
                              scheduleAsync.when(
                                loading: () => const SizedBox.shrink(),
                                error: (_, _) => const SizedBox.shrink(),
                                data:
                                    (schedule) =>
                                        schedule.slots.isEmpty
                                            ? const SizedBox.shrink()
                                            : Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.stretch,
                                              children: [
                                                const SizedBox(
                                                  height: AppSpacing.lg,
                                                ),
                                                _MicroLabel(
                                                  l10n.medsTodaySchedule,
                                                ),
                                                const SizedBox(
                                                  height: AppSpacing.sm,
                                                ),
                                                for (final slot
                                                    in schedule.slots)
                                                  MedicationSlotTile(
                                                    slot: slot,
                                                    onTap:
                                                        () => _handleTap(
                                                          context,
                                                          ref,
                                                          schedule,
                                                          slot,
                                                        ),
                                                  ),
                                              ],
                                            ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.sm,
        AppSpacing.md,
      ),
      // No rule underneath. The cards below carry their own edges, and a hard
      // line across the top of a page of soft-edged cards is the one element
      // that makes the whole screen look like a form.
      child: Row(
        children: [
          const Expanded(child: ClinicWordmark()),
          const SizedBox(width: AppSpacing.sm),
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => context.push('/profile/notifications'),
            icon: Icon(
              Icons.notifications_none_rounded,
              size: 26,
              color: scheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}

/// One of the two destinations above the schedule: an icon, what it is, and
/// what you will find there.
class _HubCard extends StatelessWidget {
  const _HubCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      padding: const EdgeInsets.all(T.s4),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: T.primaryTint,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 20, color: T.primary),
          ),
          const SizedBox(height: T.s3),
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: T.bodyStrong.copyWith(fontWeight: FontWeight.w700),
          ),
          Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: T.label.copyWith(
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
              color: T.inkMuted,
            ),
          ),
        ],
      ),
    );
  }
}

/// The heading above a group of cards. Sentence case at reading size rather
/// than tracked-out capitals: the all-caps micro label is a device for a label
/// nobody needs to read, and these name the three things the tab is for.
class _MicroLabel extends StatelessWidget {
  const _MicroLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: T.title.copyWith(color: T.ink));
}

// ---- Reminder windows -----------------------------------------------------

class _ReminderWindows extends StatelessWidget {
  const _ReminderWindows({required this.meals, required this.onTap});

  final ({String breakfast, String lunch, String dinner})? meals;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Tints kept to about 6% so they read as a time of day rather than as a
    // status. Anything stronger and three coloured tiles start competing with
    // the alerts elsewhere on the screen, which do mean something.
    final windows =
        <({IconData icon, String label, String time, Color tint, Color tone})>[
          (
            icon: Icons.wb_twilight_rounded,
            label: 'Breakfast',
            time: meals?.breakfast ?? '—',
            tint: const Color(0xFFFDF4E7),
            tone: const Color(0xFFB4761B),
          ),
          (
            icon: Icons.wb_sunny_outlined,
            label: 'Lunch',
            time: meals?.lunch ?? '—',
            tint: const Color(0xFFEAF4FE),
            tone: const Color(0xFF1B6FB4),
          ),
          (
            icon: Icons.nightlight_round,
            label: 'Dinner',
            time: meals?.dinner ?? '—',
            tint: const Color(0xFFEDEDFB),
            tone: const Color(0xFF4B4BA8),
          ),
        ];

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < windows.length; i++) ...[
            if (i > 0) const SizedBox(width: T.s3),
            Expanded(child: _WindowCard(window: windows[i], onTap: onTap)),
          ],
        ],
      ),
    );
  }
}

/// One reminder window.
///
/// The three were identical but for their icon, so a patient checking "when
/// does the evening one fire" had to read all three. Each now carries the
/// light of its own time of day — warm for breakfast, bright for midday, cool
/// for night — which is recognisable before the words are.
class _WindowCard extends StatelessWidget {
  const _WindowCard({required this.window, required this.onTap});

  final ({IconData icon, String label, String time, Color tint, Color tone})
  window;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InnerTile(
      padding: const EdgeInsets.symmetric(vertical: T.s4, horizontal: T.s2),
      tone: window.tint,
      onTap: onTap,
      child: Column(
        children: [
          Icon(window.icon, size: 24, color: window.tone),
          const SizedBox(height: T.s2),
          Text(
            window.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: T.small.copyWith(fontWeight: FontWeight.w700),
          ),
          Text(
            window.time,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: T.small.copyWith(color: T.inkMuted),
          ),
        ],
      ),
    );
  }
}

// ---- Prescription card ----------------------------------------------------

class _PrescriptionCard extends StatelessWidget {
  const _PrescriptionCard({required this.medication, required this.meals});

  final Medication medication;
  final ({String breakfast, String lunch, String dinner})? meals;

  /// Splits "500 mg" into the number and its unit, so the amount can carry
  /// the weight and the unit sit quietly beside it.
  ///
  /// A combination strength stays whole. "500/50" is one dose of a two-drug
  /// tablet — the old pattern took the leading number and left "/50" behind as
  /// the unit, so the card rendered "500 /50", which reads as a count of
  /// tablets remaining rather than as a strength.
  static (String, String) _splitStrength(String raw) {
    // Through the formatter first, so a bare "500/50" arrives as "500/50 mg"
    // and the unit half of this split is no longer empty.
    raw = formatStrength(raw);
    final match = RegExp(
      r'^\s*([\d.]+(?:\s*/\s*[\d.]+)*)\s*(.*)$',
    ).firstMatch(raw);
    if (match == null) return (raw.trim(), '');
    final amount = (match.group(1) ?? raw).replaceAll(RegExp(r'\s*/\s*'), '/');
    return (amount, (match.group(2) ?? '').trim());
  }

  /// Which meal window a dose time falls closest to. Uses the patient's own
  /// meal times, so "1x Dinner" means their dinner, not a generic evening.
  String _windowFor(String time) {
    int minutes(String hhmm) {
      final parts = hhmm.split(':');
      if (parts.length != 2) return -1;
      return (int.tryParse(parts[0]) ?? 0) * 60 + (int.tryParse(parts[1]) ?? 0);
    }

    final t = minutes(time);
    if (t < 0 || meals == null) return '';

    final windows = <String, int>{
      'Breakfast': minutes(meals!.breakfast),
      'Lunch': minutes(meals!.lunch),
      'Dinner': minutes(meals!.dinner),
    };

    var best = '';
    var bestDelta = 1 << 30;
    windows.forEach((label, m) {
      final delta = (t - m).abs();
      if (m >= 0 && delta < bestDelta) {
        bestDelta = delta;
        best = label;
      }
    });
    return best;
  }

  ({IconData icon, String label}) _schedule() {
    // The label is the shared plain-language dosing phrase ("Twice a day, after
    // food") — the same expansion the doctor's shorthand produces.
    final summary = medication.doseSummary;
    final times =
        medication.schedule
            .map((s) => s.time)
            .where((t) => t.isNotEmpty)
            .toList();
    if (times.isEmpty) return (icon: Icons.schedule_rounded, label: summary);

    final windows = times.map(_windowFor).where((w) => w.isNotEmpty).toList();
    if (times.length == 1) {
      final w = windows.isNotEmpty ? windows.first : times.first;
      return (
        icon: switch (w) {
          'Breakfast' => Icons.wb_twilight_rounded,
          'Lunch' => Icons.wb_sunny_outlined,
          'Dinner' => Icons.nightlight_round,
          _ => Icons.schedule_rounded,
        },
        label: summary,
      );
    }
    return (icon: Icons.autorenew_rounded, label: summary);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (amount, unit) = _splitStrength(medication.strength);
    final schedule = _schedule();

    return Padding(
      padding: const EdgeInsets.only(bottom: T.s3),
      child: SectionCard(
        padding: const EdgeInsets.all(T.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        medication.name,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          height: 1.2,
                        ),
                      ),
                      // The doctor's own note about this medicine. No invented
                      // "what it's for" line: the record does not hold one, and a
                      // guessed indication is a clinical claim.
                      if (medication.instructions?.isNotEmpty == true) ...[
                        const SizedBox(height: 4),
                        Text(
                          medication.instructions!,
                          style: TextStyle(
                            fontSize: 14,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                const StatusPill(label: 'Active', status: Status.ok),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.7),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                if (amount.isNotEmpty)
                  Expanded(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          amount,
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w800,
                            color: AppColors.accentOn(context),
                          ),
                        ),
                        if (unit.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          // Flexible, and clipped when it has to be.
                          //
                          // This was a bare Text, which takes whatever width it
                          // wants and paints outside its parent when that is
                          // more than there is. Most strengths are "mg" and it
                          // never showed — but a scanned prescription can put a
                          // whole line in this field ("T (TD 12.5) + ADB 1 tab
                          // each 10 AM"), and that ran straight over the "Once
                          // a day" chip beside it, leaving two sentences
                          // printed on top of each other.
                          Flexible(
                            child: Text(
                              unit,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                height: 1.25,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  )
                else
                  const Spacer(),
                const SizedBox(width: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHigh.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(schedule.icon, size: 18, color: scheme.onSurface),
                      const SizedBox(width: 8),
                      Text(
                        schedule.label,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// How much of today is already done, as a ring.
///
/// This was a figure and a linear bar. A bar that fills left to right is a
/// download; a ring that closes is a day completed, and closing it is the only
/// reward this screen has to offer for taking a tablet on time. The number
/// stays in the middle because "2 of 3" is the fact, and the ring is how far
/// off it is at a glance.
class _DoseRing extends StatelessWidget {
  const _DoseRing({required this.schedule});

  final TodaySchedule? schedule;

  @override
  Widget build(BuildContext context) {
    final slots = schedule?.slots ?? const <MedicationScheduleSlot>[];
    final total = slots.length;
    final taken = slots.where((s) => s.status == 'taken').length;
    final missed = slots.where((s) => s.status == 'missed').length;
    final left = slots.where((s) => s.status == 'pending').length;

    final (status, label) = switch (0) {
      _ when missed > 0 => (Status.alert, '$missed missed'),
      _ when left == 0 => (Status.ok, 'All done'),
      _ => (Status.watch, '$left to go'),
    };

    final today = DateFormat('EEEE, d MMMM').format(DateTime.now());

    if (total == 0) {
      return SectionCard(
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(
                color: T.primaryTint,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.event_available_rounded,
                size: 22,
                color: T.primary,
              ),
            ),
            const SizedBox(width: T.s4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Nothing scheduled',
                    style: T.title.copyWith(color: T.ink),
                  ),
                  Text(today, style: T.small.copyWith(color: T.inkMuted)),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final next = slots.where((s) => s.status == 'pending').firstOrNull;

    return SectionCard(
      child: Row(
        children: [
          HealthRing(
            value: taken / total * 100,
            color: status.tone,
            size: 92,
            strokeWidth: 10,
            centerLabel: '$taken/$total',
            centerSubLabel: total == 1 ? 'dose' : 'doses',
          ),
          const SizedBox(width: T.s5),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Today', style: T.title.copyWith(color: T.ink)),
                Text(
                  today,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
                const SizedBox(height: T.s3),
                StatusPill(
                  label: label,
                  status: status,
                  icon:
                      status == Status.ok
                          ? Icons.check_rounded
                          : status == Status.alert
                          ? Icons.warning_amber_rounded
                          : Icons.schedule_rounded,
                ),
                if (next != null) ...[
                  const SizedBox(height: T.s2),
                  Text(
                    'Next at ${next.time}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.small.copyWith(color: T.inkMuted),
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

/// Scanning a prescription, as a full-width button rather than a thing
/// floating over the list. See the note where the FAB used to be.
class _ScanAction extends StatelessWidget {
  const _ScanAction({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: T.hControl,
    child: FilledButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.document_scanner_outlined, size: 20),
      label: const Text('Scan prescription'),
      style: FilledButton.styleFrom(
        backgroundColor: T.primary,
        foregroundColor: Colors.white,
        textStyle: T.bodyStrong.copyWith(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(T.rControl),
        ),
      ),
    ),
  );
}
