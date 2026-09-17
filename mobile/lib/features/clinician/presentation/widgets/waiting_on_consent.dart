import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/tokens.dart';
import '../../domain/patient_registration.dart';
import '../clinician_providers.dart';
import 'consent_code_dialog.dart';

/// Who the practice has registered and is still waiting on.
///
/// ---- Why this sits on the patient list ----------------------------------
///
/// Because the patient list is the screen somebody opens when a person they
/// just registered is not on it.
///
/// Registering somebody who already uses MedPin does not enrol them: the
/// practice is reaching for a record it did not create, so the enrolment is
/// written PENDING, a code goes to the patient's own handset, and the row
/// grants nothing until they read it back. Every clinical list is scoped to
/// active enrolments, so the patient is correctly absent.
///
/// It was absent from everything else too. The row existed and nothing in the
/// product admitted it, so a desk that did not get the code read back on the
/// spot had a patient in limbo with no way back except remembering the phone
/// number and typing it in again.
///
/// Hidden entirely when nobody is waiting. A permanent empty banner on a screen
/// a doctor opens all day is a standing reminder of a state that is not
/// happening.
class WaitingOnConsent extends ConsumerWidget {
  const WaitingOnConsent({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final waiting = ref.watch(pendingEnrolmentsProvider).valueOrNull ?? const [];
    if (waiting.isEmpty) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Material(
        color: AppColors.warningBgOn(context),
        borderRadius: BorderRadius.circular(T.rControl),
        child: InkWell(
          borderRadius: BorderRadius.circular(T.rControl),
          onTap: () => _openList(context, ref, waiting),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.hourglass_top_rounded,
                  size: T.s5,
                  color: AppColors.warningOn(context),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        waiting.length == 1
                            ? '1 patient is waiting on their code'
                            : '${waiting.length} patients are waiting on their code',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      // Says why they are missing, on the screen they are
                      // missing from. Colour is not carrying this: the words
                      // are the whole message.
                      Text(
                        'They already use MedPin, so they will not appear here '
                        'until the code is read back.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: scheme.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openList(
    BuildContext context,
    WidgetRef ref,
    List<PendingEnrolment> waiting,
  ) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                'Waiting on a code',
                style: Theme.of(sheet).textTheme.titleMedium,
              ),
            ),
            for (final person in waiting)
              ListTile(
                contentPadding: EdgeInsets.zero,
                // What the desk typed, never the name on the account: the
                // account's owner has not agreed to this practice knowing it.
                title: Text(person.label),
                // The number the code went to. Two people with one name is the
                // ordinary case at a counter, and a mistyped digit is the
                // commonest reason no code ever arrived.
                subtitle: Text(
                  person.name == null ? 'Name not recorded when this was asked' : person.phone ?? 'no number on file',
                ),
                trailing: FilledButton.tonal(
                  onPressed: () async {
                    Navigator.of(sheet).pop();
                    await _confirm(context, ref, person);
                  },
                  child: const Text('Enter code'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirm(
    BuildContext context,
    WidgetRef ref,
    PendingEnrolment person,
  ) async {
    final sentTo = person.phone ?? 'their phone';
    final confirmation = await showConsentCodeDialog(
      context,
      enrollmentId: person.id,
      title: person.label,
      message: 'Ask them to read out the code sent to $sentTo.',
    );
    if (confirmation == null) return;

    // Both lists move: one person leaves the waiting list and joins the roll.
    ref.invalidate(pendingEnrolmentsProvider);
    ref.invalidate(patientsProvider);

    if (context.mounted) {
      // The patient's own name only now, with their agreement — and what the
      // practice will not see.
      final who = confirmation.patientName ?? person.label;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$who is enrolled. ${confirmation.sharingSummary}')),
      );
    }
  }
}
