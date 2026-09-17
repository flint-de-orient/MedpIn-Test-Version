import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../../shared/widgets/user_avatar.dart';
// The clinician's Appointment, not the patient-app one. There are two
// classes with that name and the provider below returns this one; importing
// the other made every field on it resolve to Object.
import '../../domain/appointment.dart';
import '../clinician_providers.dart';

/// The doctor's day, on the doctor's home screen.
///
/// It was not there. Patients requested, the desk gave them times, the clinic
/// filled up — and the one screen the doctor opens first said nothing about any
/// of it. He learned his own schedule by navigating to a separate Appointments
/// screen, which is a thing you do when you already suspect you have
/// appointments.
///
/// A version of this existed and was orphaned: [dashboard_screen.dart] still
/// holds an "Upcoming appointments" section that no route points at, stranded
/// when the panel was rebuilt. This is that idea, narrowed to today, because
/// the doctor's home is about the room in front of him — tomorrow arrives as
/// the 20:00 digest, in time to do something about it.
///
/// Placed after the triage queue and before the operational ones: who needs a
/// doctor now, then what the day holds, then everything else.
class TodaysClinic extends ConsumerWidget {
  const TodaysClinic({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(appointmentsTodayProvider);
    final all = async.valueOrNull;

    // Cancelled ones are not the day. Sorted because the answer to "what is
    // next" is only readable in order.
    final items =
        (all ?? const <Appointment>[]).where((a) => !a.isCancelled).toList()
          ..sort((a, b) {
            // Nulls last rather than crashing the sort: a confirmed
            // appointment always has a time, but the diary is a shared shape.
            final x = a.scheduledFor;
            final y = b.scheduledFor;
            if (x == null || y == null) return x == null ? 1 : -1;
            return x.compareTo(y);
          });

    final now = DateTime.now();
    final remaining =
        items.where((a) => (a.scheduledFor ?? now).isAfter(now)).length;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.event_note_rounded, size: 18, color: T.primary),
              const SizedBox(width: T.s2),
              Expanded(
                child: Text(
                  'Today at the clinic',
                  style: T.title.copyWith(fontSize: 16),
                ),
              ),
              if (items.isNotEmpty)
                TextButton(
                  onPressed: () => context.go('/clinician/appointments'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  child: const Text('View all'),
                ),
            ],
          ),

          if (async.isLoading && all == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: T.s5),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
              ),
            )
          else if (async.hasError && all == null)
            Padding(
              padding: const EdgeInsets.only(top: T.s2),
              child: Text(
                'Could not load today’s list.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            )
          else if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: T.s2),
              child: Text(
                // A statement about the day, not an error. The clinic is shut
                // on some days and quiet on others, and both are fine.
                'Nothing booked today.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            )
          else ...[
            Padding(
              padding: const EdgeInsets.only(bottom: T.s2),
              child: Text(
                remaining == 0
                    ? 'All ${items.length} seen.'
                    : '$remaining of ${items.length} still to come.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
            ),
            // Four, then a count. A doctor scanning his morning wants the next
            // few; the whole list has its own screen.
            for (final a in items.take(4)) _Row(appointment: a),
            if (items.length > 4)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: TextButton(
                  onPressed: () => context.go('/clinician/appointments'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                  ),
                  child: Text('+${items.length - 4} more'),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.appointment});

  final Appointment appointment;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final scheme = Theme.of(context).colorScheme;
    final at = a.scheduledFor;
    final past = at != null && at.isBefore(DateTime.now());

    final (String label, Color tone) = switch (a.status) {
      'checked_in' => ('Waiting', AppColors.success),
      'in_consultation' => ('In with you', T.primary),
      'completed' => ('Seen', scheme.onSurfaceVariant),
      'no_show' => ('No show', AppColors.danger),
      _ => ('', scheme.onSurfaceVariant),
    };

    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap:
          a.patientId.isEmpty
              ? null
              : () => context.push(
                '/clinician/patients/${a.patientId}',
                extra: a.patientName,
              ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            SizedBox(
              width: 62,
              child: Text(
                at == null ? '—' : DateFormat('h:mm a').format(at),
                style: T.small.copyWith(
                  fontWeight: FontWeight.w700,
                  // A time that has passed is context, not an instruction.
                  color: past ? scheme.onSurfaceVariant : T.primary,
                ),
              ),
            ),
            UserAvatar(
              name: a.patientName,
              // The diary does not carry a photo; the initial is the answer.
              avatarUrl: null,
              accent: T.primary,
              size: 30,
            ),
            const SizedBox(width: T.s2),
            Expanded(
              child: Text(
                a.patientName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (label.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: tone,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
