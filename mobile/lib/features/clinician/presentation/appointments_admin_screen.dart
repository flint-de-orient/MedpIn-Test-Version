import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/auto_refresh.dart';
import '../../appointments/data/appointment_repository.dart';
import '../../appointments/domain/appointment.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../appointments/presentation/widgets/appointment_visuals.dart';

/// The clinic diary for doctor + staff: today or the full list, filterable by
/// status, with inline management (confirm, start, complete, cancel, no-show).
class AppointmentsAdminScreen extends ConsumerStatefulWidget {
  const AppointmentsAdminScreen({super.key});

  @override
  ConsumerState<AppointmentsAdminScreen> createState() =>
      _AppointmentsAdminScreenState();
}

class _AppointmentsAdminScreenState
    extends ConsumerState<AppointmentsAdminScreen> {
  // Default to Upcoming so a freshly-booked (future) appointment is visible
  // straight away, not hidden behind a "today only" filter.
  String _scope = 'upcoming'; // today | upcoming | all
  String? _status;

  static const _statuses = [
    (null, 'All'),
    ('requested', 'Requested'),
    ('confirmed', 'Confirmed'),
    ('completed', 'Completed'),
    ('cancelled', 'Cancelled'),
  ];

  bool get _ascending => _scope != 'all';

  AppointmentQuery get _query {
    switch (_scope) {
      case 'today':
        final b = todayBounds();
        return (from: b.from, to: b.to, status: _status, clinicId: null);
      case 'upcoming':
        return (
          from: todayBounds().from,
          to: null,
          status: _status,
          clinicId: null,
        );
      default:
        return (from: null, to: null, status: _status, clinicId: null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(appointmentDiaryProvider(_query));

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Appointments'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(96),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                child: SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'today', label: Text('Today')),
                    ButtonSegment(value: 'upcoming', label: Text('Upcoming')),
                    ButtonSegment(value: 'all', label: Text('All')),
                  ],
                  selected: {_scope},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => setState(() => _scope = s.first),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                  ),
                  itemCount: _statuses.length,
                  separatorBuilder:
                      (_, _) => const SizedBox(width: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final (value, label) = _statuses[i];
                    final sel = _status == value;
                    return ChoiceChip(
                      label: Text(label),
                      selected: sel,
                      onSelected: (_) => setState(() => _status = value),
                    );
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
      body: AutoRefresh(
        onTick: (r) => r.invalidate(appointmentDiaryProvider(_query)),
        child: RefreshIndicator(
          onRefresh:
              () async => ref.invalidate(appointmentDiaryProvider(_query)),
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error:
                (_, _) => Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load appointments'),
                      const SizedBox(height: AppSpacing.sm),
                      OutlinedButton(
                        onPressed:
                            () => ref.invalidate(
                              appointmentDiaryProvider(_query),
                            ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
            data: (paged) {
              final items = [...paged.items]..sort(
                (a, b) =>
                    _ascending
                        ? a.sortKey.compareTo(b.sortKey)
                        : b.sortKey.compareTo(a.sortKey),
              );
              if (items.isEmpty) {
                return ListView(
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.2),
                    Icon(
                      Icons.event_busy_outlined,
                      size: 56,
                      color: scheme.outlineVariant,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    const Center(
                      child: Text(
                        'No appointments',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: items.length,
                separatorBuilder:
                    (_, _) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, i) {
                  final a = items[i];
                  return AppointmentCard(
                    appointment: a,
                    clinicianView: true,
                    onTap: () => _manage(a),
                    trailing:
                        a.isActive
                            ? IconButton(
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(
                                Icons.more_vert_rounded,
                                size: 20,
                              ),
                              onPressed: () => _manage(a),
                            )
                            : null,
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _manage(Appointment a) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder:
          (_) => _ManageSheet(
            appointment: a,
            onAction: (
              targetStatus, {
              String? notes,
              bool cancel = false,
            }) async {
              final messenger = ScaffoldMessenger.of(context);
              Navigator.pop(context);
              try {
                if (cancel) {
                  await ref
                      .read(appointmentRepositoryProvider)
                      .cancel(a.id, reason: notes);
                } else {
                  await ref
                      .read(appointmentRepositoryProvider)
                      .setStatus(a.id, targetStatus!, consultationNotes: notes);
                }
                ref.invalidate(appointmentDiaryProvider(_query));
              } on ApiException {
                messenger.showSnackBar(
                  const SnackBar(
                    content: Text('Could not update. Please try again.'),
                  ),
                );
              }
            },
          ),
    );
  }
}

typedef _ActionCallback =
    Future<void> Function(String? targetStatus, {String? notes, bool cancel});

class _ManageSheet extends StatelessWidget {
  const _ManageSheet({required this.appointment, required this.onAction});

  final Appointment appointment;
  final _ActionCallback onAction;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;

    // Which transitions make sense from the current status.
    final actions = <_Action>[];
    switch (a.status) {
      case 'requested':
        actions.add(
          _Action(
            'Confirm',
            Icons.check_circle_outline_rounded,
            AppColors.success,
            status: 'confirmed',
          ),
        );
        actions.add(
          _Action(
            'Mark no-show',
            Icons.person_off_outlined,
            AppColors.warning,
            status: 'no_show',
          ),
        );
      case 'confirmed':
        actions.add(
          _Action(
            'Check in',
            Icons.login_rounded,
            AppColors.primary,
            status: 'checked_in',
          ),
        );
        actions.add(
          _Action(
            'Start consultation',
            Icons.play_circle_outline_rounded,
            AppColors.primary,
            status: 'in_consultation',
          ),
        );
        actions.add(
          _Action(
            'Mark no-show',
            Icons.person_off_outlined,
            AppColors.warning,
            status: 'no_show',
          ),
        );
      case 'checked_in':
        actions.add(
          _Action(
            'Start consultation',
            Icons.play_circle_outline_rounded,
            AppColors.primary,
            status: 'in_consultation',
          ),
        );
      case 'in_consultation':
        actions.add(
          _Action(
            'Complete',
            Icons.task_alt_rounded,
            AppColors.success,
            status: 'completed',
            notes: true,
          ),
        );
    }
    final canCancel = a.isActive;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          0,
          AppSpacing.md,
          AppSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              a.patientName ?? 'Patient',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            Text(
              a.scheduledFor != null
                  ? '${DateFormat('EEE, d MMM · h:mm a').format(a.scheduledFor!)}'
                      '  ·  ${a.clinicName ?? ''}'
                  // A request: the day they asked for, and no invented hour.
                  : a.preferredFor != null
                  ? 'Asked for ${DateFormat('EEE, d MMM').format(a.preferredFor!)}'
                      '  ·  needs a time'
                  : 'Needs a time',
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.md),
            for (final act in actions)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(act.icon, color: act.color),
                title: Text(act.label),
                onTap: () {
                  if (act.notes) {
                    _completeWithNotes(context, act.status!);
                  } else {
                    onAction(act.status);
                  }
                },
              ),
            if (canCancel)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  Icons.cancel_outlined,
                  color: AppColors.dangerOn(context),
                ),
                title: Text(
                  'Cancel appointment',
                  style: TextStyle(color: AppColors.dangerOn(context)),
                ),
                onTap: () => onAction(null, cancel: true),
              ),
            if (actions.isEmpty && !canCancel)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                child: Text(
                  'No actions available for a ${a.status} appointment.',
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _completeWithNotes(BuildContext context, String status) async {
    final controller = TextEditingController();
    final notes = await showDialog<String>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Consultation notes'),
            content: TextField(
              controller: controller,
              maxLines: 4,
              decoration: const InputDecoration(
                hintText: 'Optional notes for the record',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Skip'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                child: const Text('Complete'),
              ),
            ],
          ),
    );
    // Dialog dismissed entirely (back button) → do nothing; otherwise complete.
    if (context.mounted && notes != null) {
      await onAction(status, notes: notes.isEmpty ? null : notes);
    } else if (context.mounted) {
      await onAction(status);
    }
  }
}

class _Action {
  const _Action(
    this.label,
    this.icon,
    this.color, {
    this.status,
    this.notes = false,
  });
  final String label;
  final IconData icon;
  final Color color;
  final String? status;
  final bool notes;
}
