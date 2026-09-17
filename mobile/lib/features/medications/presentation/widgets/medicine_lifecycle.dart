import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../data/medications_repository.dart';
import '../../domain/medication.dart';
import '../../domain/strength.dart';
import '../medications_providers.dart';

/// A patient stopping a medicine, starting it again, and the medicines that
/// have ended — kept apart from the doctor's prescription throughout.
///
/// ---- Whose stop it is ---------------------------------------------------------
///
/// The patient's Stop does not end the prescription. The doctor's prescription
/// stays as it was written, the reminders stop, and the doctor sees that the
/// patient stopped and why. The sheet says exactly that, because "Stop" on a
/// list of prescribed medicines otherwise reads as "delete what the doctor
/// wrote" — which is what it used to do.

/// "Metformin 500 mg".
String medicineLabel(Medication m) =>
    [m.name, formatStrength(m.strength)].where((s) => s.isNotEmpty).join(' ');

String _day(DateTime? d) => d == null ? '' : DateFormat('d MMM y').format(d);

/// Everything that shows medicines, refreshed after one changes.
void refreshMedicineLists(WidgetRef ref) {
  ref.invalidate(medicationsListProvider);
  ref.invalidate(allMedicationsProvider);
  ref.invalidate(todayScheduleProvider);
  ref.invalidate(medicationAdherenceProvider);
}

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

/// Asks, then stops taking [m]. Re-arms the reminders so its alarms go at once.
Future<void> stopTakingFlow(BuildContext context, WidgetRef ref, Medication m) async {
  final answer = await showModalBottomSheet<({String? reason})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => StopTakingSheet(medication: m),
  );
  if (answer == null || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  final repo = ref.read(medicationsRepositoryProvider);
  try {
    try {
      await repo.stopTaking(m.id, reason: answer.reason);
    } on ApiException catch (e) {
      // A server from before stop-taking existed: its Stop is the only one.
      if (e.statusCode != 404) rethrow;
      await repo.stopMedication(m.id);
    }
    refreshMedicineLists(ref);
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          m.patientOwned
              ? 'You stopped taking ${medicineLabel(m)}.'
              : 'You stopped taking ${medicineLabel(m)}. Your doctor will see this.',
        ),
      ),
    );
    await refreshAndScheduleMedicationReminders(ref);
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

class StopTakingSheet extends StatefulWidget {
  const StopTakingSheet({super.key, required this.medication});

  final Medication medication;

  /// Offered as one tap each: typing is hard for many of the people using this.
  static const reasons = ['Side effects', 'Ran out', 'Feeling better', 'My doctor told me to'];

  @override
  State<StopTakingSheet> createState() => _StopTakingSheetState();
}

class _StopTakingSheetState extends State<StopTakingSheet> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.medication;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Stop taking ${medicineLabel(m)}?', style: T.title),
              const SizedBox(height: T.s2),
              Text(
                m.patientOwned
                    ? 'Its reminders stop. You can start it again later.'
                    : 'Its reminders stop. Your doctor’s prescription stays as they wrote it, '
                        'and they will see that you stopped. You can start again later.',
                style: T.body.copyWith(color: T.ink),
              ),
              if (!m.patientOwned) ...[
                const SizedBox(height: T.s2),
                Text(
                  'If a side effect is worrying you, contact your clinic.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
              const SizedBox(height: T.s4),
              Wrap(
                spacing: T.s2,
                runSpacing: T.s2,
                children: [
                  for (final r in StopTakingSheet.reasons)
                    ActionChip(label: Text(r), onPressed: () => setState(() => _reason.text = r)),
                ],
              ),
              const SizedBox(height: T.s3),
              TextField(
                controller: _reason,
                maxLength: 300,
                minLines: 1,
                maxLines: 3,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Why are you stopping? (optional)'),
              ),
              const SizedBox(height: T.s3),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Keep taking it'),
                    ),
                  ),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: T.danger, foregroundColor: T.surface),
                      onPressed: () => Navigator.of(context).pop((reason: _reason.text.trim())),
                      child: const Text('Stop taking'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stopped by the patient
// ---------------------------------------------------------------------------

/// The medicines the patient stopped while their prescription still stands.
///
/// Hidden when there are none: an empty "Stopped by you" is noise.
class StoppedByYouList extends ConsumerWidget {
  const StoppedByYouList({super.key, required this.medicines});

  final List<Medication> medicines;

  Future<void> _resume(BuildContext context, WidgetRef ref, Medication m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(medicationsRepositoryProvider).resumeTaking(m.id);
      refreshMedicineLists(ref);
      messenger.showSnackBar(SnackBar(content: Text('Reminders for ${medicineLabel(m)} are back on.')));
      await refreshAndScheduleMedicationReminders(ref);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
      refreshMedicineLists(ref);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final m in medicines)
          Padding(
            padding: const EdgeInsets.only(bottom: T.s2),
            child: InnerTile(
              tone: T.warningTint,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(medicineLabel(m), style: T.bodyStrong),
                        Text(
                          [
                            'You stopped taking this${m.stoppedTaking?.at == null ? '' : ' on ${_day(m.stoppedTaking!.at)}'}.',
                            if ((m.stoppedTaking?.reason ?? '').isNotEmpty) m.stoppedTaking!.reason!,
                          ].join(' '),
                          style: T.small.copyWith(color: T.inkMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: T.s2),
                  TextButton(
                    onPressed: () => _resume(context, ref, m),
                    child: const Text('Start again'),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Ended
// ---------------------------------------------------------------------------

/// What happened to a medicine that is no longer prescribed, in words.
String endedText(Medication m) {
  String reason(String? r) => (r ?? '').isEmpty ? '' : ': $r';
  switch (m.prescriptionState) {
    case 'completed':
      return 'Course finished${m.completedAt == null ? '' : ' on ${_day(m.completedAt)}'}.';
    case 'stopped_by_doctor':
      return 'Stopped by your doctor${m.stoppedByDoctor?.at == null ? '' : ' on ${_day(m.stoppedByDoctor!.at)}'}${reason(m.stoppedByDoctor?.reason)}.';
    case 'cancelled':
      return 'Cancelled by your doctor${m.cancelled?.at == null ? '' : ' on ${_day(m.cancelled!.at)}'}${reason(m.cancelled?.reason)}.';
    default:
      return 'No longer taken.';
  }
}

/// The medicines that have ended — finished, stopped by the doctor, cancelled.
/// Kept, because a course that finished is still part of what was taken.
class PastMedicinesList extends StatelessWidget {
  const PastMedicinesList({super.key, required this.medicines});

  final List<Medication> medicines;

  static const int shown = 3;

  static Widget _row(Medication m) => Padding(
        padding: const EdgeInsets.only(bottom: T.s2),
        child: InnerTile(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(medicineLabel(m), style: T.bodyStrong),
              Text(endedText(m), style: T.small.copyWith(color: T.inkMuted)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final m in medicines.take(shown)) _row(m),
        if (medicines.length > shown)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => DraggableScrollableSheet(
                  expand: false,
                  initialChildSize: 0.7,
                  builder: (_, controller) => ListView(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s6),
                    children: [
                      Text('Past medicines (${medicines.length})', style: T.title),
                      const SizedBox(height: T.s3),
                      for (final m in medicines) _row(m),
                    ],
                  ),
                ),
              ),
              child: Text('View all (${medicines.length})'),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// The same medicine twice
// ---------------------------------------------------------------------------

/// Said on a medicine that has another prescription for the same drug beside it.
///
/// Never resolved for the patient: which to take is their doctor's call. But
/// two metformins on one list, each with its own alarm, is how a double dose
/// happens, and the patient is the one person certain to see both.
class AlsoOnListNote extends StatelessWidget {
  const AlsoOnListNote({super.key, required this.medication});

  final Medication medication;

  @override
  Widget build(BuildContext context) {
    final others = medication.alsoOnList;
    if (others.isEmpty) return const SizedBox.shrink();
    final elsewhere = others.any((o) => !o.samePractice);
    final strengths = others
        .map((o) => formatStrength(o.strength))
        .where((s) => s.isNotEmpty)
        .toSet()
        .join(', ');
    final what = strengths.isEmpty ? medication.name : '${medication.name} $strengths';
    return Padding(
      padding: const EdgeInsets.only(top: T.s3),
      child: InnerTile(
        tone: T.warningTint,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.warning_amber_rounded, color: T.warning),
            const SizedBox(width: T.s2),
            Expanded(
              child: Text(
                elsewhere
                    ? 'Also prescribed by another clinic: $what. Ask your doctor before taking both.'
                    : 'Also on your list: $what. Ask your doctor before taking both.',
                style: T.small.copyWith(color: T.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
