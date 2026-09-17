import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/services/notification_service.dart';
import '../medications_providers.dart';

/// Says so when the medicine reminders are not going to fire.
///
/// ---- Why this exists ------------------------------------------------------
///
/// A patient could have seven medicines and zero alarms, and nothing anywhere
/// said so. `scheduleMedicationReminders` cancels the whole set and re-arms it
/// from scratch — which happens every time a dose is logged — and if the
/// re-arm fails, the only report was a `debugPrint` that reaches logcat and no
/// human being. The server-side push does not save it either: it is data-only,
/// so Android will not draw it and the app's own background handler must, which
/// a force-stopped app cannot do. Both tiers fail to the same cause, silently.
///
/// The failure is invisible from inside the app. The medicines are all still
/// listed, the times are all still shown, and the only symptom is that the
/// phone stays quiet — which looks exactly like a phone that has not reached
/// nine in the morning yet. Somebody notices a week later, if at all.
///
/// ---- What it does ---------------------------------------------------------
///
/// Reads the platform for the pending alarms rather than what the app remembers
/// arming, and offers the repair. Nothing else on this screen tells the truth
/// about that, because nothing else asks the platform.
///
/// It draws nothing when reminders are healthy. A card that is always there is
/// a card nobody reads on the day it matters.
class ReminderHealthCard extends ConsumerStatefulWidget {
  const ReminderHealthCard({super.key});

  @override
  ConsumerState<ReminderHealthCard> createState() => _ReminderHealthCardState();
}

class _ReminderHealthCardState extends ConsumerState<ReminderHealthCard> {
  ReminderHealth? _health;
  bool _repairing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    final meds = ref.read(medicationsListProvider).valueOrNull ?? const [];
    // The same count the arming path derives, from the same function, so this
    // cannot disagree with it about what "expected" means.
    final expected = buildUpcomingDoses(meds).length;
    final health = await NotificationService.instance.reminderHealth(
      expected: expected,
    );
    if (mounted) setState(() => _health = health);
  }

  Future<void> _repair() async {
    setState(() => _repairing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      // Ask for what is missing, then arm again. In that order: re-arming
      // before the permission is granted just fails again quietly.
      await NotificationService.instance.ensureAlarmPermissions();
      await refreshAndScheduleMedicationReminders(ref);
      await _check();

      final after = _health;
      if (after != null && after.healthy) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Reminders are set.')),
        );
      } else {
        // Told plainly rather than left looking like it worked. On these
        // handsets the usual remaining cause is the battery manager, which no
        // app can change on its own.
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'Still not set. Open Settings → Apps → MedPin and allow '
              'notifications, alarms, and background activity.',
            ),
            duration: Duration(seconds: 8),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _repairing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final h = _health;
    if (h == null || h.healthy) return const SizedBox.shrink();

    // Red for silence, amber for degraded. A reminder that will fire a few
    // minutes late is a different thing from one that will not fire at all,
    // and colouring them the same wastes the red.
    final severe = h.silent;
    final tone = severe ? AppColors.danger : AppColors.warning;

    final String title;
    final String body;
    if (h.silent) {
      title = 'Your medicine reminders are off';
      body =
          'You have ${h.expected} reminder${h.expected == 1 ? '' : 's'} set up, '
          'but this phone is not going to show any of them.';
    } else if (!h.notificationsAllowed) {
      title = 'Notifications are blocked';
      body = 'MedPin cannot show you anything until notifications are allowed.';
    } else {
      title = 'Reminders may arrive late';
      body =
          'Exact alarms are not permitted, so a reminder can arrive some '
          'minutes after the time you set.';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                severe
                    ? Icons.notifications_off_rounded
                    : Icons.warning_amber_rounded,
                color: tone,
                size: 20,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: tone,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      body,
                      style: const TextStyle(fontSize: 13, height: 1.35),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _repairing ? null : _repair,
              style: FilledButton.styleFrom(
                backgroundColor: tone,
                foregroundColor: Colors.white,
              ),
              child:
                  _repairing
                      ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                      : const Text('Turn reminders back on'),
            ),
          ),
        ],
      ),
    );
  }
}
