import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../data/appointment_repository.dart';
import '../domain/appointment.dart';
import '../domain/clinic.dart';
import 'appointment_providers.dart';
import 'widgets/appointment_visuals.dart';

/// The patient's own appointments — upcoming and past — with booking, cancel
/// and reschedule. Replaces the Care → Appointments placeholder.
class MyAppointmentsScreen extends ConsumerWidget {
  const MyAppointmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(myAppointmentsProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.apptTitle),
          bottom: TabBar(
            tabs: [Tab(text: l10n.apptUpcoming), Tab(text: l10n.apptPast)],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => context.push('/care/appointments/book'),
          icon: const Icon(Icons.add_rounded),
          label: Text(l10n.apptBook),
        ),
        body: AutoRefresh(
          onTick: (r) => r.invalidate(myAppointmentsProvider),
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => _Retry(
                  onRetry: () => ref.invalidate(myAppointmentsProvider),
                ),
            data: (all) {
              final startOfToday = DateTime.now().copyWith(
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0,
                microsecond: 0,
              );
              final upcoming =
                  all
                      // A request belongs under Upcoming even with no time on
                      // it: the patient asked and is waiting for an answer.
                      .where(
                        (a) =>
                            a.isActive &&
                            (a.scheduledFor == null ||
                                !a.scheduledFor!.isBefore(startOfToday)),
                      )
                      .toList()
                    ..sort((a, b) => a.sortKey.compareTo(b.sortKey));
              final past =
                  all
                      .where(
                        (a) =>
                            !(a.isActive &&
                                (a.scheduledFor == null ||
                                    !a.scheduledFor!.isBefore(startOfToday))),
                      )
                      .toList()
                    ..sort((a, b) => b.sortKey.compareTo(a.sortKey));

              return TabBarView(
                children: [
                  _AppointmentList(
                    items: upcoming,
                    emptyIcon: Icons.event_available_outlined,
                    emptyTitle: l10n.apptNoUpcoming,
                    emptyBody: l10n.apptNoUpcomingBody,
                    onRefresh:
                        () async => ref.invalidate(myAppointmentsProvider),
                    showActions: true,
                  ),
                  _AppointmentList(
                    items: past,
                    emptyIcon: Icons.history_rounded,
                    emptyTitle: l10n.apptNoPast,
                    emptyBody: '',
                    onRefresh:
                        () async => ref.invalidate(myAppointmentsProvider),
                    showActions: false,
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _AppointmentList extends ConsumerWidget {
  const _AppointmentList({
    required this.items,
    required this.emptyIcon,
    required this.emptyTitle,
    required this.emptyBody,
    required this.onRefresh,
    required this.showActions,
  });

  final List<Appointment> items;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptyBody;
  final Future<void> Function() onRefresh;
  final bool showActions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    if (items.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.18),
            Icon(
              emptyIcon,
              size: 56,
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
            const SizedBox(height: AppSpacing.md),
            Center(
              child: Text(
                emptyTitle,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (emptyBody.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.xs),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                child: Text(
                  emptyBody,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.md,
          AppSpacing.md,
          96,
        ),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (context, i) {
          final a = items[i];
          return AppointmentCard(
            appointment: a,
            actions:
                showActions && a.isActive
                    ? [
                      TextButton(
                        onPressed: () => _reschedule(context, ref, a),
                        child: Text(l10n.apptReschedule),
                      ),
                      TextButton(
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.danger,
                        ),
                        onPressed: () => _cancel(context, ref, a),
                        child: Text(l10n.apptCancel),
                      ),
                    ]
                    : null,
          );
        },
      ),
    );
  }

  Future<void> _cancel(
    BuildContext context,
    WidgetRef ref,
    Appointment a,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(l10n.apptCancelConfirm),
            content: Text(l10n.apptCancelConfirmBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(l10n.commonNo),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(l10n.apptCancel),
              ),
            ],
          ),
    );
    if (ok != true) return;
    try {
      await ref.read(appointmentRepositoryProvider).cancel(a.id);
      ref.invalidate(myAppointmentsProvider);
      messenger.showSnackBar(SnackBar(content: Text(l10n.apptCancelled)));
    } on ApiException {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.commonSomethingWentWrong)),
      );
    }
  }

  Future<void> _reschedule(
    BuildContext context,
    WidgetRef ref,
    Appointment a,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (a.clinicId == null) return;
    final iso = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (_) => _RescheduleSheet(
            clinicId: a.clinicId!,
            clinicName: a.clinicName ?? '',
          ),
    );
    if (iso == null) return;
    try {
      await ref.read(appointmentRepositoryProvider).reschedule(a.id, iso);
      ref.invalidate(myAppointmentsProvider);
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileSaved)));
    } on ApiException catch (e) {
      final msg =
          e.code == 'BAD_REQUEST'
              ? l10n.apptSlotTaken
              : l10n.commonSomethingWentWrong;
      messenger.showSnackBar(SnackBar(content: Text(msg)));
    }
  }
}

/// Compact date + slot picker for rescheduling within the same clinic.
class _RescheduleSheet extends ConsumerStatefulWidget {
  const _RescheduleSheet({required this.clinicId, required this.clinicName});

  final String clinicId;
  final String clinicName;

  @override
  ConsumerState<_RescheduleSheet> createState() => _RescheduleSheetState();
}

class _RescheduleSheetState extends ConsumerState<_RescheduleSheet> {
  late DateTime _date;
  Slot? _slot;

  @override
  void initState() {
    super.initState();
    _date = DateTime.now();
  }

  String get _dateKey => DateFormat('yyyy-MM-dd').format(_date);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = isDark ? AppColors.primaryDark : AppColors.primary;
    final slotsAsync = ref.watch(
      slotDayProvider((clinicId: widget.clinicId, date: _dateKey)),
    );
    final today = DateTime.now();

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.md + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${l10n.apptReschedule} · ${widget.clinicName}',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 68,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: 14,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
              itemBuilder: (context, i) {
                final d = DateTime(today.year, today.month, today.day + i);
                final sel = d.day == _date.day && d.month == _date.month;
                return InkWell(
                  onTap:
                      () => setState(() {
                        _date = d;
                        _slot = null;
                      }),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    width: 52,
                    decoration: BoxDecoration(
                      color: sel ? accent : scheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: sel ? accent : scheme.outlineVariant,
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          DateFormat('EEE').format(d),
                          style: TextStyle(
                            fontSize: 12,
                            color: sel ? Colors.white : scheme.onSurfaceVariant,
                          ),
                        ),
                        Text(
                          '${d.day}',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: sel ? Colors.white : scheme.onSurface,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 220),
            child: slotsAsync.when(
              loading:
                  () => const Center(
                    child: Padding(
                      padding: EdgeInsets.all(AppSpacing.lg),
                      child: CircularProgressIndicator(),
                    ),
                  ),
              error: (_, _) => Text(l10n.commonSomethingWentWrong),
              data: (day) {
                if (!day.hasAvailability) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.md,
                    ),
                    child: Text(
                      day.slots.isEmpty
                          ? l10n.apptClosedThatDay
                          : l10n.apptNoSlots,
                    ),
                  );
                }
                return SingleChildScrollView(
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final s in day.slots.where((x) => x.available))
                        ChoiceChip(
                          label: Text(s.time),
                          selected: _slot?.time == s.time,
                          onSelected: (_) => setState(() => _slot = s),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton(
              onPressed:
                  _slot == null
                      ? null
                      : () => Navigator.pop(context, _slot!.iso),
              child: Text(l10n.apptReschedule),
            ),
          ),
        ],
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.commonSomethingWentWrong),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(onPressed: onRetry, child: Text(l10n.commonRetry)),
        ],
      ),
    );
  }
}
