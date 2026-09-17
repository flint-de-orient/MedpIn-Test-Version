import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/services/notification_service.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
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
/// a card nobody reads on the day it matters. When it does draw, it brings its
/// own space below it, so an absent card leaves no gap.
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
    final l10n = AppLocalizations.of(context);
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
        messenger.showSnackBar(SnackBar(content: Text(l10n.ptRemindersSet)));
      } else {
        // Told plainly rather than left looking like it worked. On these
        // handsets the usual remaining cause is the battery manager, which no
        // app can change on its own.
        messenger.showSnackBar(
          SnackBar(
            content: Text(l10n.ptRemindersStillOff(l10n.appName)),
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _repairing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final h = _health;
    if (h == null || h.healthy) return const SizedBox.shrink();

    // Red for silence, amber for degraded. A reminder that will fire a few
    // minutes late is a different thing from one that will not fire at all,
    // and colouring them the same wastes the red.
    final status = h.silent ? Status.alert : Status.watch;

    final String title;
    final String body;
    if (h.silent) {
      title = l10n.ptRemindersOffTitle;
      body = l10n.ptRemindersOffBody(h.expected);
    } else if (!h.notificationsAllowed) {
      title = l10n.ptNotificationsBlockedTitle;
      body = l10n.ptNotificationsBlockedBody;
    } else {
      title = l10n.ptRemindersLateTitle;
      body = l10n.ptRemindersLateBody;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: kSectionGap),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            StatusWord(
              label: title,
              status: status,
              icon:
                  h.silent
                      ? Icons.notifications_off_outlined
                      : Icons.warning_amber_rounded,
            ),
            const SizedBox(height: T.s1),
            Text(body, style: T.body.copyWith(color: T.ink)),
            const SizedBox(height: T.s3),
            // Outlined, in the status colour: the day's dose is still the
            // screen's one filled action, and this card is loud enough.
            SecondaryAction(
              label: l10n.ptTurnRemindersOn,
              icon: Icons.notifications_active_outlined,
              tone: status.tone,
              onPressed: _repairing ? null : _repair,
            ),
          ],
        ),
      ),
    );
  }
}
