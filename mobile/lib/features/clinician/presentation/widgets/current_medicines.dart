import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../medications/domain/medication.dart';
import '../../../medications/domain/strength.dart';
import '../../data/clinician_repository.dart';
import '../clinician_providers.dart';
import 'load_states.dart';
import 'record_ui.dart';

/// What the patient is on, what they have stopped on their own, and where two
/// prescriptions name the same medicine — with a way for the doctor to stop
/// one.
///
/// ---- One list, in two places ----------------------------------------------
///
/// It used to live inside the prescribing form at the foot of the record, below
/// five screens of history, so the doctor met it last. The record now shows it
/// with what matters for the visit, and the consultation shows the same widget
/// where the new prescription is written — prescribing without it is
/// prescribing blind, and two copies of it would drift.
///
/// Stopping is a soft stop on the server: the medicine is marked stopped with
/// a date and a reason rather than deleted, so the doses already logged
/// against it — and the adherence built from them — stay readable.
class MedicinesCard extends ConsumerWidget {
  const MedicinesCard({
    super.key,
    required this.patientId,
    required this.allowStop,
  });

  final String patientId;

  /// Whether this reader may stop a prescription. The server refuses the desk
  /// whatever is drawn; a button that always fails is worse than none.
  final bool allowStop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meds = ref.watch(patientMedicationsProvider(patientId)).valueOrNull;
    final active = meds?.where((m) => m.isActive).length;
    final stopped = meds?.where(_stoppedByPatient).length;
    // Counts only when there is something to count: an empty list says so
    // in its body, once.
    final subtitle =
        meds == null || (active == 0 && (stopped ?? 0) == 0)
            ? null
            : [
              if (active! > 0) '$active current',
              if ((stopped ?? 0) > 0) '$stopped stopped by the patient',
            ].join(' · ');

    return RecordCard(
      icon: Icons.medication_outlined,
      title: 'Medicines',
      subtitle: subtitle,
      child: CurrentMedicinesList(patientId: patientId, allowStop: allowStop),
    );
  }
}

bool _stoppedByPatient(Medication m) =>
    m.prescriptionStands && m.stoppedByPatient;

/// The list itself, without a card round it.
class CurrentMedicinesList extends ConsumerWidget {
  const CurrentMedicinesList({
    super.key,
    required this.patientId,
    required this.allowStop,
  });

  final String patientId;
  final bool allowStop;

  Future<void> _stop(
    BuildContext context,
    WidgetRef ref,
    Medication med,
  ) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => StopPrescriptionDialog(medication: med),
    );
    if (reason == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .stopPrescribedMedicine(patientId, med.id, reason: reason);
      ref.invalidate(patientMedicationsProvider(patientId));
      messenger.showSnackBar(SnackBar(content: Text('${med.name} stopped')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(patientMedicationsProvider(patientId));
    void retry() => ref.invalidate(patientMedicationsProvider(patientId));
    const what = 'the current medicines';

    // Read by hand rather than through `when`, which draws the error the
    // moment a refresh fails even with the list already loaded. A failure to
    // reach the server keeps the list and says so; a refusal replaces it.
    final loaded = async.valueOrNull;
    final error = async.hasError ? async.error! : null;
    final refused = error != null && !Failure.of(error, what: what).keepsData;

    if (loaded == null || refused) {
      if (error != null) {
        // A failure must never read as "no medicines" — that is the one
        // wrong answer a prescribing screen can give.
        return FailureNotice(error: error, what: what, onRetry: retry);
      }
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SkeletonLine(width: 200),
          SizedBox(height: T.s2),
          SkeletonLine(width: 140),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (error != null) ...[
          StaleNotice(error: error, what: 'this list', onRetry: retry),
          const SizedBox(height: T.s3),
        ],
        _body(context, ref, loaded),
      ],
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, List<Medication> meds) {
    final active = meds.where((m) => m.isActive).toList();
    // Still prescribed, and the patient has stopped taking them. Listed
    // apart, with the patient's reason: the prescription says one thing
    // and the patient is doing another, which is the conversation to have.
    final stopped = meds.where(_stoppedByPatient).toList();
    final paper =
        ref
            .watch(patientPrescriptionsProvider(patientId))
            .valueOrNull
            ?.firstOrNull
            ?.isScanned ??
        false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (active.isEmpty)
          RecordNote(
            icon:
                paper
                    ? Icons.document_scanner_outlined
                    : Icons.medication_outlined,
            // A paper prescription has no typed medicines, so an empty
            // list after one means "not entered", never "none".
            text:
                paper
                    ? 'The last prescription was written on paper and its '
                        'medicines were not typed in. Open it from '
                        'Prescriptions to read them.'
                    : 'No medicines prescribed.',
          )
        else
          for (var i = 0; i < active.length; i++) ...[
            if (i > 0) const Divider(height: T.s6, color: T.line),
            _MedicineRow(
              medication: active[i],
              onStop:
                  allowStop && active[i].changeableByYou != false
                      ? () => _stop(context, ref, active[i])
                      : null,
            ),
          ],
        for (final med in active)
          if (med.alsoOnList.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: T.s3),
              child: SameMedicineNote(medication: med),
            ),
        if (stopped.isNotEmpty) ...[
          const SizedBox(height: T.s4),
          Text(
            'Stopped by the patient',
            style: T.label.copyWith(color: T.warning),
          ),
          const SizedBox(height: T.s2),
          for (final med in stopped)
            Padding(
              padding: const EdgeInsets.only(bottom: T.s2),
              child: InnerTile(
                tone: T.warningTint,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(medicineName(med), style: T.bodyStrong),
                    Text(
                      [
                        med.stoppedTaking?.at == null
                            ? 'The patient stopped taking it.'
                            : 'The patient stopped taking it on '
                                '${DateFormat('d MMM').format(med.stoppedTaking!.at!)}.',
                        if ((med.stoppedTaking?.reason ?? '').trim().isNotEmpty)
                          'Reason: ${med.stoppedTaking!.reason!.trim()}',
                      ].join(' '),
                      style: T.small.copyWith(color: T.ink),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ],
    );
  }
}

/// "Metformin 500 mg" — the name and the strength as they are printed.
String medicineName(Medication m) =>
    [m.name, formatStrength(m.strength)].where((s) => s.isNotEmpty).join(' ');

/// One current medicine, and the Stop beside it when there is one to offer.
class _MedicineRow extends StatelessWidget {
  const _MedicineRow({required this.medication, required this.onStop});

  final Medication medication;
  final VoidCallback? onStop;

  @override
  Widget build(BuildContext context) {
    final med = medication;
    final days = med.daysOfWeek;
    final dosing = [
      if (med.dose.isNotEmpty) med.dose,
      med.doseSummary,
      // A weekly tablet read "Once a day" without this.
      if (days.isNotEmpty) 'on ${days.map(_day).join(', ')}',
      if (med.schedule.isNotEmpty && !med.asNeeded && !med.stat)
        med.schedule.map((s) => s.time).join(', '),
    ].where((s) => s.isNotEmpty).join(' · ');

    // Whose it is, when it is not this practice's to change. Said as a
    // sentence under the name rather than squeezed into a column beside it.
    final owner =
        med.changeableByYou == false
            ? (med.patientOwned
                ? 'Added by the patient'
                : 'Prescribed at another practice')
            : null;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(medicineName(med), style: T.bodyStrong),
              if (dosing.isNotEmpty)
                Text(dosing, style: T.small.copyWith(color: T.inkMuted)),
              if (owner != null)
                Text(owner, style: T.small.copyWith(color: T.inkMuted)),
              // Where the strength disagrees with the clinic's brand list. A
              // statement of both figures, not a correction: the record stays
              // as the doctor wrote it, and only a person changes a dose.
              if (med.hasStrengthMismatch) ...[
                const SizedBox(height: T.s1),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      size: T.s5,
                      color: T.warning,
                    ),
                    const SizedBox(width: T.s1),
                    Expanded(
                      child: Text(
                        _mismatch(med),
                        style: T.small.copyWith(color: T.ink),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        if (onStop != null) ...[
          const SizedBox(width: T.s2),
          TextButton(
            onPressed: onStop,
            style: TextButton.styleFrom(
              foregroundColor: T.danger,
              minimumSize: const Size(T.tap, T.tap),
            ),
            child: Semantics(
              label: 'Stop ${med.name}',
              excludeSemantics: true,
              child: const Text('Stop'),
            ),
          ),
        ],
      ],
    );
  }

  static String _mismatch(Medication med) {
    final composition =
        (med.strengthComposition ?? '').isEmpty
            ? ''
            : ' (${med.strengthComposition})';
    return med.strength.trim().isEmpty
        ? 'No strength written. The clinic’s medicine list has '
            '${med.strengthExpected}$composition.'
        : 'Written as ${formatStrength(med.strength)}. The clinic’s medicine '
            'list has ${med.strengthExpected}$composition.';
  }

  static String _day(String d) {
    final t = d.trim();
    if (t.length <= 3) return t[0].toUpperCase() + t.substring(1);
    return t[0].toUpperCase() + t.substring(1, 3);
  }
}

/// Asks the doctor why, before a prescription is stopped. The reason is the
/// record's: "stopped" alone tells the next reader nothing.
class StopPrescriptionDialog extends StatefulWidget {
  const StopPrescriptionDialog({super.key, required this.medication});

  final Medication medication;

  @override
  State<StopPrescriptionDialog> createState() => _StopPrescriptionDialogState();
}

class _StopPrescriptionDialogState extends State<StopPrescriptionDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _reason.text.trim().length >= 5;
    return AlertDialog(
      title: Text('Stop ${widget.medication.name}?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'The patient stops being reminded about it from now on. Doses '
            'already recorded are kept, and the prescription is recorded as '
            'stopped by you.',
          ),
          const SizedBox(height: T.s3),
          TextField(
            controller: _reason,
            autofocus: true,
            maxLength: 500,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Why is it being stopped?',
              helperText: 'At least five characters',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: T.danger,
            minimumSize: const Size(T.tap, T.tap),
          ),
          onPressed:
              ready ? () => Navigator.pop(context, _reason.text.trim()) : null,
          child: const Text('Stop it'),
        ),
      ],
    );
  }
}

/// A note that another prescription for the same medicine stands.
class SameMedicineNote extends StatelessWidget {
  const SameMedicineNote({super.key, required this.medication});

  final Medication medication;

  @override
  Widget build(BuildContext context) {
    final others = [
      for (final o in medication.alsoOnList)
        [
          formatStrength(o.strength),
          o.samePractice ? '(this practice)' : '(another practice)',
        ].where((s) => s.isNotEmpty).join(' '),
    ];
    return InnerTile(
      tone: T.warningTint,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.content_copy_rounded, size: T.s5, color: T.warning),
          const SizedBox(width: T.s2),
          Expanded(
            child: Text(
              '${medicineName(medication)} is also prescribed as '
              '${others.join('; ')}. Both are on the patient’s list and both '
              'remind them.',
              style: T.small.copyWith(color: T.ink),
            ),
          ),
        ],
      ),
    );
  }
}
