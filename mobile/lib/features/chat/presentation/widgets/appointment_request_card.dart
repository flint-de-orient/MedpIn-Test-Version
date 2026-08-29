import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../appointments/data/appointment_repository.dart';
import '../../../appointments/presentation/appointment_providers.dart';
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/chat_message.dart';

/// "Can I see the doctor on Tuesday?" — answered, and acted on.
///
/// The patient already talks to the clinic here, so this is where they ask for
/// appointments. Before this, the assistant said it could not book anything and
/// the sentence went nowhere: the desk's "Waiting for a time" queue could only
/// be fed from a booking screen most patients never open.
///
/// ---- Why a card and not a booking --------------------------------------
///
/// Tapping this creates a *request*, not an appointment. The desk gives the
/// time, from the hours the doctor actually keeps. That is not a limitation
/// worked around — it is the point: a patient who books themselves into a slot
/// the doctor is not in has been told something false by their clinic's app.
///
/// ---- Why the day is shown, and changeable ------------------------------
///
/// The day is read out of the patient's own sentence, and "কাল" means both
/// yesterday and tomorrow. So it is printed in full where they cannot miss it,
/// and one tap changes it. A guess that is visible and correctable is a
/// different thing from a guess that is silently acted on.
class AppointmentRequestCard extends ConsumerStatefulWidget {
  const AppointmentRequestCard({super.key, required this.action});

  final MessageAction action;

  @override
  ConsumerState<AppointmentRequestCard> createState() =>
      _AppointmentRequestCardState();
}

class _AppointmentRequestCardState
    extends ConsumerState<AppointmentRequestCard> {
  DateTime? _day;
  bool _sending = false;
  bool _sent = false;

  @override
  void initState() {
    super.initState();
    _day = widget.action.preferredFor;
  }

  Future<void> _pickDay() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _day ?? now.add(const Duration(days: 1)),
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 120)),
    );
    if (picked != null) setState(() => _day = picked);
  }

  Future<void> _send() async {
    final day = _day;
    if (day == null || _sending) return;

    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .requestAppointment(
            preferredFor: day,
            // Their own words, not a parsed hour. The desk reads this beside
            // the request and offers a time near it if one is free.
            reason:
                widget.action.timePhrase == null
                    ? ''
                    : 'Asked for around ${widget.action.timePhrase}',
          );
      ref.invalidate(myAppointmentsProvider);
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException
                ? e.message
                : 'Could not send the request. Please try again.',
          ),
        ),
      );
    } finally {
      // In the `finally`: a narrow catch that misses leaves the button
      // spinning with no way back except leaving the screen.
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // The patient's card, on the patient's screen.
    //
    // The doctor's chat-review opens these same threads with these same
    // bubbles, and the request endpoint takes the patient from the caller's
    // own account — so a clinician tapping this would either fail or, worse,
    // request an appointment with the doctor for the doctor.
    if (ref.watch(authControllerProvider).user?.role != 'patient') {
      return const SizedBox.shrink();
    }

    if (_sent) {
      return _Shell(
        child: Row(
          children: [
            const Icon(
              Icons.check_circle_rounded,
              size: 18,
              color: AppColors.success,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                // Sent, not booked. Saying "booked" here would be the app
                // promising something only the clinic can give.
                'Request sent. The clinic will give you a time.',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final day = _day;
    final when =
        day == null
            ? 'No day chosen yet'
            : DateFormat('EEEE, d MMM').format(day);
    final time = widget.action.timePhrase;

    return _Shell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.event_available_rounded,
                size: 18,
                color: AppColors.primary,
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Request an appointment',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          InkWell(
            onTap: _sending ? null : _pickDay,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      time == null ? when : '$when  ·  around $time',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                        color:
                            day == null
                                ? scheme.onSurfaceVariant
                                : scheme.onSurface,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    day == null ? 'Choose a day' : 'Change',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            height: 40,
            child: FilledButton(
              onPressed: _sending || day == null ? null : _send,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child:
                  _sending
                      ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                      : const Text(
                        'Send request',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'The clinic will reply with a time.',
            style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _Shell extends StatelessWidget {
  const _Shell({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.28)),
      ),
      child: child,
    );
  }
}
