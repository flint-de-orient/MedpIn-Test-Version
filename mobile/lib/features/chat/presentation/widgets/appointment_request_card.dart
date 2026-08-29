import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../appointments/presentation/request_appointment_sheet.dart';
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/chat_message.dart';

/// "Can I see the doctor on Tuesday?" — noticed, and offered a shortcut.
///
/// The patient already talks to the clinic in this thread, so it is where they
/// ask for appointments. Before this the assistant replied that it could not
/// book anything, and the sentence went nowhere: the desk's "Waiting for a
/// time" queue could only be fed from a screen most patients never open.
///
/// ---- Why it opens the sheet rather than sending ---------------------------
///
/// This drew its own day picker and posted the request itself, which made two
/// implementations of one act — and the sheet is the better of them: it has the
/// quick-day chips, the optional hour, and the note the desk reads. A second,
/// thinner copy of a form is how the two drift until they disagree about what a
/// request even contains.
///
/// So the card is a prompt, and the sheet is the form. The day read out of the
/// patient's sentence is carried in as a prefill, which is the whole value of
/// having noticed.
///
/// ---- Why noticing is allowed to be wrong ----------------------------------
///
/// Nothing is created here. A false positive is a card somebody ignores, and a
/// misread day is one they change in the sheet before sending. That is what
/// lets the detection behind it be generous — the alternative, creating
/// requests from sentences, puts phantoms on the desk's queue.
class AppointmentRequestCard extends ConsumerStatefulWidget {
  const AppointmentRequestCard({super.key, required this.action});

  final MessageAction action;

  @override
  ConsumerState<AppointmentRequestCard> createState() =>
      _AppointmentRequestCardState();
}

class _AppointmentRequestCardState
    extends ConsumerState<AppointmentRequestCard> {
  bool _sent = false;

  Future<void> _open() async {
    final messenger = ScaffoldMessenger.of(context);
    final sent = await showRequestAppointmentSheet(
      context,
      initialDay: widget.action.preferredFor,
    );
    if (!sent || !mounted) return;
    setState(() => _sent = true);
    messenger.showSnackBar(
      const SnackBar(
        content: Text(
          'Request sent. The clinic will confirm a time and let you know.',
        ),
        duration: Duration(seconds: 4),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // The patient's card, on the patient's screen.
    //
    // The doctor's chat-review opens these same threads with these same
    // bubbles, and a request takes its patient from the caller's own account —
    // so a clinician tapping this would be asking to see the doctor himself.
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
                // Sent, not booked. Saying "booked" here would have the app
                // promise something only the clinic can give.
                'Request sent. The clinic will reply with a time.',
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

    final day = widget.action.preferredFor;
    final time = widget.action.timePhrase;
    final detail = [
      if (day != null) DateFormat('EEEE, d MMM').format(day),
      if (time != null) 'around $time',
    ].join(' · ');

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
                  'Ask for an appointment',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          if (detail.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              detail,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.3,
                fontWeight: FontWeight.w600,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            height: 38,
            child: FilledButton(
              onPressed: _open,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text(
                'Request an appointment',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
              ),
            ),
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
