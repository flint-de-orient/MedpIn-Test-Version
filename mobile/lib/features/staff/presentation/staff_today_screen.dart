import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../appointments/data/appointment_repository.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../appointments/domain/appointment.dart';
import '../../appointments/domain/clinic.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../auth/presentation/auth_controller.dart';

/// The front desk's day.
///
/// Two lists, in the order the desk works them. Requests first, because
/// somebody is waiting on an answer and nothing happens until the desk gives
/// them one; then today's booked appointments, which are the room in front of
/// them. Everything else a receptionist does — registering a walk-in, finding
/// a patient, answering a message — lives on the other tabs.
class StaffTodayScreen extends ConsumerStatefulWidget {
  const StaffTodayScreen({super.key});

  @override
  ConsumerState<StaffTodayScreen> createState() => _StaffTodayScreenState();
}

class _StaffTodayScreenState extends ConsumerState<StaffTodayScreen> {
  /// Everything asked for and not yet given a time, whatever day it is for.
  /// A request from last Tuesday that nobody answered is more urgent than one
  /// from this morning, not less, so it is never filtered out by date.
  AppointmentQuery get _requests => (
    from: null,
    to: null,
    status: 'requested',
    clinicId: null,
  );

  AppointmentQuery get _today {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    return (
      from: start,
      to: start.add(const Duration(days: 1)),
      status: null,
      clinicId: null,
    );
  }

  Future<void> _refresh() async {
    ref.invalidate(appointmentDiaryProvider(_requests));
    ref.invalidate(appointmentDiaryProvider(_today));
  }

  @override
  Widget build(BuildContext context) {
    final requests =
        ref.watch(appointmentDiaryProvider(_requests)).valueOrNull?.items ??
        const <Appointment>[];
    // Requests are already excluded from the day: they have no scheduledFor, so
    // a date-ranged query cannot match them. Cancelled ones are dropped because
    // the desk is looking at who is coming.
    final today =
        (ref.watch(appointmentDiaryProvider(_today)).valueOrNull?.items ??
                const <Appointment>[])
            .where((a) => a.status != 'cancelled')
            .toList()
          ..sort((a, b) => a.sortKey.compareTo(b.sortKey));

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.sm,
              AppSpacing.md,
              96,
            ),
            children: [
              const _DeskHeader(),
              const SizedBox(height: AppSpacing.lg),

              if (requests.isNotEmpty) ...[
                _SectionTitle(
                  'Waiting for a time',
                  count: requests.length,
                  tone: AppColors.warning,
                ),
                const SizedBox(height: AppSpacing.sm),
                for (final a in requests)
                  _RequestCard(appointment: a, onConfirmed: _refresh),
                const SizedBox(height: AppSpacing.lg),
              ],

              _SectionTitle('Today', count: today.length),
              const SizedBox(height: AppSpacing.sm),
              if (today.isEmpty)
                const _Empty(
                  icon: Icons.event_available_outlined,
                  title: 'Nothing booked today',
                  body: 'Appointments confirmed for today appear here.',
                )
              else
                for (final a in today) _DayRow(appointment: a),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeskHeader extends ConsumerWidget {
  const _DeskHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(authControllerProvider).user;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                DateFormat('EEEE, d MMMM').format(DateTime.now()),
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 2),
              Text(
                user?.name ?? 'Front desk',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        // Registering a walk-in is the thing a desk does most, so it is on the
        // screen rather than behind a tab.
        FilledButton.icon(
          onPressed: () => context.push('/staff/patients/new'),
          icon: const Icon(Icons.person_add_alt_1_rounded, size: 18),
          label: const Text('Register'),
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {required this.count, this.tone});

  final String text;
  final int count;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          text,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        const SizedBox(width: 8),
        if (count > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: (tone ?? scheme.onSurfaceVariant).withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: tone ?? scheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

/// A patient who asked for an appointment and has no time yet.
class _RequestCard extends ConsumerStatefulWidget {
  const _RequestCard({required this.appointment, required this.onConfirmed});

  final Appointment appointment;
  final Future<void> Function() onConfirmed;

  @override
  ConsumerState<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<_RequestCard> {
  bool _busy = false;

  /// How long they have been waiting. A request nobody answered for four days
  /// is the one that costs the clinic a patient.
  String get _waited {
    final at = widget.appointment.createdAt;
    if (at == null) return '';
    final d = DateTime.now().difference(at);
    if (d.inHours < 1) return 'asked ${d.inMinutes}m ago';
    if (d.inHours < 24) return 'asked ${d.inHours}h ago';
    return 'asked ${d.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.appointment;
    final scheme = Theme.of(context).colorScheme;
    final stale =
        (a.createdAt != null &&
            DateTime.now().difference(a.createdAt!).inDays >= 1);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          // Amber once it has been sitting a day. Not red: nobody is unwell,
          // somebody is unanswered.
          color:
              stale
                  ? AppColors.warning.withValues(alpha: 0.55)
                  : scheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UserAvatar(
                name: a.patientName ?? '',
                avatarUrl: null,
                accent: AppColors.primary,
                size: 38,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      a.patientName ?? 'Patient',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      [
                        if (a.preferredFor != null)
                          'for ${DateFormat('EEE, d MMM').format(a.preferredFor!)}',
                        if (_waited.isNotEmpty) _waited,
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color:
                            stale ? AppColors.warning : scheme.onSurfaceVariant,
                        fontWeight: stale ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
              if (a.patientPhone != null)
                IconButton(
                  tooltip: 'Call ${a.patientPhone}',
                  onPressed: () {},
                  icon: Icon(
                    Icons.call_outlined,
                    color: scheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
            ],
          ),
          if ((a.reason ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              a.reason!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : _decline,
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onSurfaceVariant,
                ),
                child: const Text('Decline'),
              ),
              const Spacer(),
              FilledButton.icon(
                onPressed: _busy ? null : _pickTime,
                icon:
                    _busy
                        ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                        : const Icon(Icons.event_available_rounded, size: 18),
                label: const Text('Give a time'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _decline() async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Decline this request?'),
            content: Text(
              '${widget.appointment.patientName ?? 'The patient'} will be told '
              'the clinic could not offer a time. Message them first if there '
              'is a reason they should know.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Keep it'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Decline'),
              ),
            ],
          ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .cancel(widget.appointment.id);
      await widget.onConfirmed();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Choose the clinic, the day and a free slot, then confirm.
  Future<void> _pickTime() async {
    final messenger = ScaffoldMessenger.of(context);
    final clinics = await ref.read(clinicRepositoryProvider).list();
    final open = clinics.where((c) => c.isActive).toList();
    if (!mounted) return;

    if (open.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('No active clinic to book into. Add one in Profile.'),
        ),
      );
      return;
    }

    final picked = await showModalBottomSheet<({Clinic clinic, DateTime at})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => _SlotPicker(
            clinics: open,
            // Their preferred day is where the picker opens — the desk is
            // answering a request, not booking from scratch.
            initialDay: widget.appointment.preferredFor,
          ),
    );
    if (picked == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .confirmRequest(
            widget.appointment.id,
            clinicId: picked.clinic.id,
            scheduledFor: picked.at,
          );
      await widget.onConfirmed();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'Confirmed for ${DateFormat('EEE d MMM, h:mm a').format(picked.at)}. '
            'The patient has been told.',
          ),
        ),
      );
    } on ApiException catch (e) {
      // The server re-checks the slot, so "just taken" arrives here rather
      // than as a double booking.
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// Clinic, day, and one of the free slots the schedule actually offers.
class _SlotPicker extends ConsumerStatefulWidget {
  const _SlotPicker({required this.clinics, this.initialDay});

  final List<Clinic> clinics;
  final DateTime? initialDay;

  @override
  ConsumerState<_SlotPicker> createState() => _SlotPickerState();
}

class _SlotPickerState extends ConsumerState<_SlotPicker> {
  late Clinic _clinic = widget.clinics.first;
  late DateTime _day = _atLeastToday(widget.initialDay ?? DateTime.now());

  static DateTime _atLeastToday(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final asked = DateTime(d.year, d.month, d.day);
    // A request for a day that has since passed opens on today rather than in
    // the past, where there is nothing to offer.
    return asked.isBefore(today) ? today : asked;
  }

  String get _dayKey => DateFormat('yyyy-MM-dd').format(_day);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final slots = ref.watch(
      slotDayProvider((clinicId: _clinic.id, date: _dayKey)),
    );

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      maxChildSize: 0.95,
      builder:
          (ctx, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.lg,
            ),
            children: [
              const Text(
                'Give a time',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 2),
              Text(
                'Only times the doctor is actually available are offered.',
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.md),

              if (widget.clinics.length > 1) ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final c in widget.clinics)
                      ChoiceChip(
                        label: Text(c.name),
                        selected: c.id == _clinic.id,
                        onSelected: (_) => setState(() => _clinic = c),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
              ],

              Row(
                children: [
                  Expanded(
                    child: Text(
                      DateFormat('EEEE, d MMMM').format(_day),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () async {
                      final now = DateTime.now();
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _day,
                        firstDate: DateTime(now.year, now.month, now.day),
                        lastDate: now.add(const Duration(days: 120)),
                      );
                      if (d != null) setState(() => _day = d);
                    },
                    icon: const Icon(Icons.calendar_today_rounded, size: 16),
                    label: const Text('Change'),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),

              slots.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Text(
                        'Could not load the times for this day.',
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    ),
                data: (day) {
                  final free = day.slots.where((s) => s.available).toList();
                  if (free.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 28),
                      child: Column(
                        children: [
                          Icon(
                            Icons.event_busy_outlined,
                            size: 40,
                            color: scheme.outlineVariant,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            'Nothing free on this day',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Try another day, or another clinic.',
                            style: TextStyle(
                              fontSize: 13,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in free)
                        ActionChip(
                          label: Text(s.time),
                          onPressed:
                              () => Navigator.pop(ctx, (
                                clinic: _clinic,
                                at: DateTime.parse(s.iso).toLocal(),
                              )),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
    );
  }
}

/// One booked appointment in today's list.
class _DayRow extends ConsumerWidget {
  const _DayRow({required this.appointment});

  final Appointment appointment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;
    final (label, tone) = switch (a.status) {
      'checked_in' => ('Checked in', AppColors.success),
      'in_consultation' => ('With the doctor', AppColors.primary),
      'completed' => ('Done', scheme.onSurfaceVariant),
      'no_show' => ('No show', AppColors.danger),
      _ => ('Confirmed', scheme.onSurfaceVariant),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 62,
            child: Text(
              a.scheduledFor == null
                  ? '--'
                  : DateFormat('h:mm a').format(a.scheduledFor!),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  a.patientName ?? 'Patient',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(label, style: TextStyle(fontSize: 12.5, color: tone)),
              ],
            ),
          ),
          // Checking somebody in is the desk's move, and the only one offered
          // here: starting a consultation is the doctor's.
          if (a.status == 'confirmed')
            TextButton(
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                try {
                  await ref
                      .read(appointmentRepositoryProvider)
                      .setStatus(a.id, 'checked_in');
                  ref.invalidate(appointmentDiaryProvider);
                } on ApiException catch (e) {
                  messenger.showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
              child: const Text('Check in'),
            ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36),
      child: Column(
        children: [
          Icon(icon, size: 46, color: scheme.outlineVariant),
          const SizedBox(height: AppSpacing.sm),
          Text(
            title,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
