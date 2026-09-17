import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';
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
String medicineLabel(Medication m) => keepUnitsTogether(
  [m.name, formatStrength(m.strength)].where((s) => s.isNotEmpty).join(' '),
);

String _day(BuildContext context, DateTime d) =>
    DateFormat('d MMM y', Localizations.localeOf(context).toString()).format(d);

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
Future<void> stopTakingFlow(
  BuildContext context,
  WidgetRef ref,
  Medication m,
) async {
  final l10n = AppLocalizations.of(context);
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
              ? l10n.ptYouStoppedTaking(medicineLabel(m))
              : l10n.ptYouStoppedTakingDoctorSees(medicineLabel(m)),
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

  /// Offered as one tap each: typing is hard for many of the people using
  /// this. In the patient's own language, because the reason is theirs.
  static List<String> reasons(AppLocalizations l10n) => [
    l10n.ptReasonSideEffects,
    l10n.ptReasonRanOut,
    l10n.ptReasonFeelingBetter,
    l10n.ptReasonDoctorTold,
  ];

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
    final l10n = AppLocalizations.of(context);
    final m = widget.medication;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.ptStopTakingQuestion(medicineLabel(m)),
                style: T.title.copyWith(color: T.ink),
              ),
              const SizedBox(height: T.s2),
              Text(
                m.patientOwned
                    ? l10n.ptStopPatientOwnedBody
                    : l10n.ptStopPrescribedBody,
                style: T.body.copyWith(color: T.ink),
              ),
              if (!m.patientOwned) ...[
                const SizedBox(height: T.s2),
                Text(
                  l10n.ptStopSideEffectNote,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
              const SizedBox(height: T.s4),
              Wrap(
                spacing: T.s2,
                runSpacing: T.s2,
                children: [
                  for (final r in StopTakingSheet.reasons(l10n))
                    ActionChip(
                      label: Text(r),
                      onPressed: () => setState(() => _reason.text = r),
                    ),
                ],
              ),
              const SizedBox(height: T.s3),
              TextField(
                controller: _reason,
                maxLength: 300,
                minLines: 1,
                maxLines: 3,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(labelText: l10n.ptWhyStopping),
              ),
              const SizedBox(height: T.s3),
              // Keeping it is the safe answer, so it is the filled one; the
              // stop is said in the danger colour, with its word.
              PrimaryAction(
                label: l10n.ptKeepTaking,
                onPressed: () => Navigator.of(context).pop(),
              ),
              const SizedBox(height: T.s2),
              SecondaryAction(
                label: l10n.ptStopTaking,
                tone: T.danger,
                onPressed:
                    () => Navigator.of(
                      context,
                    ).pop((reason: _reason.text.trim())),
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
/// Drawn by the Medicines tab only when there are some: an empty "Stopped by
/// you" is noise.
class StoppedByYouList extends ConsumerStatefulWidget {
  const StoppedByYouList({super.key, required this.medicines});

  final List<Medication> medicines;

  @override
  ConsumerState<StoppedByYouList> createState() => _StoppedByYouListState();
}

class _StoppedByYouListState extends ConsumerState<StoppedByYouList> {
  /// The medicine being started again, so its button cannot be pressed twice.
  String? _resuming;

  Future<void> _resume(Medication m) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _resuming = m.id);
    try {
      await ref.read(medicationsRepositoryProvider).resumeTaking(m.id);
      refreshMedicineLists(ref);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.ptRemindersBackOn(medicineLabel(m)))),
      );
      await refreshAndScheduleMedicationReminders(ref);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
      refreshMedicineLists(ref);
    } finally {
      if (mounted) setState(() => _resuming = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, m) in widget.medicines.indexed) ...[
          if (i > 0) const Divider(height: 1, color: T.line),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: T.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(medicineLabel(m), style: T.bodyStrong.copyWith(color: T.ink)),
                StatusWord(
                  label:
                      m.stoppedTaking?.at == null
                          ? l10n.ptYouStopped
                          : l10n.ptYouStoppedOn(_day(context, m.stoppedTaking!.at!)),
                  status: Status.neutral,
                  icon: Icons.pause_circle_outline_rounded,
                ),
                if ((m.stoppedTaking?.reason ?? '').isNotEmpty)
                  Text(
                    m.stoppedTaking!.reason!,
                    style: T.small.copyWith(color: T.inkMuted),
                  ),
                const SizedBox(height: T.s2),
                SecondaryAction(
                  label: l10n.ptStartAgain,
                  icon: Icons.play_arrow_rounded,
                  expand: false,
                  onPressed: _resuming == null ? () => _resume(m) : null,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Ended
// ---------------------------------------------------------------------------

/// What happened to a medicine that is no longer prescribed, in words.
String endedText(BuildContext context, Medication m) {
  final l10n = AppLocalizations.of(context);
  switch (m.prescriptionState) {
    case 'completed':
      return m.completedAt == null
          ? l10n.ptCourseFinished
          : l10n.ptCourseFinishedOn(_day(context, m.completedAt!));
    case 'stopped_by_doctor':
      return m.stoppedByDoctor?.at == null
          ? l10n.ptStoppedByDoctor
          : l10n.ptStoppedByDoctorOn(_day(context, m.stoppedByDoctor!.at!));
    case 'cancelled':
      return m.cancelled?.at == null
          ? l10n.ptCancelledByDoctor
          : l10n.ptCancelledByDoctorOn(_day(context, m.cancelled!.at!));
    default:
      return l10n.ptNoLongerTaken;
  }
}

/// The doctor's reason for ending it, when they gave one.
String? _endedReason(Medication m) {
  final reason = switch (m.prescriptionState) {
    'stopped_by_doctor' => m.stoppedByDoctor?.reason,
    'cancelled' => m.cancelled?.reason,
    _ => null,
  };
  return (reason ?? '').isEmpty ? null : reason;
}

/// Whether [medicines] holds a course that finished recently — the patient most
/// likely to look for it on the active list, where it used to stay.
bool hasRecentlyFinishedCourse(List<Medication> medicines, DateTime now) =>
    medicines.any(
      (m) =>
          m.prescriptionState == 'completed' &&
          (m.completedAt == null ||
              now.difference(m.completedAt!) <= const Duration(days: 60)),
    );

/// The medicines that have ended — finished, stopped by the doctor, cancelled.
/// Kept, because a course that finished is still part of what was taken.
class PastMedicinesList extends StatelessWidget {
  const PastMedicinesList({super.key, required this.medicines});

  final List<Medication> medicines;

  static const int shown = 3;

  static Widget _row(BuildContext context, Medication m) {
    final reason = _endedReason(m);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(medicineLabel(m), style: T.bodyStrong.copyWith(color: T.ink)),
          Text(endedText(context, m), style: T.small.copyWith(color: T.inkMuted)),
          if (reason != null)
            Text(reason, style: T.small.copyWith(color: T.inkMuted)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, m) in medicines.take(shown).indexed) ...[
          if (i > 0) const Divider(height: 1, color: T.line),
          _row(context, m),
        ],
        if (medicines.length > shown)
          Align(
            alignment: Alignment.centerLeft,
            child: ActionLink(
              label: l10n.ptViewAllCount(medicines.length),
              onTap:
                  () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    showDragHandle: true,
                    builder:
                        (sheet) => DraggableScrollableSheet(
                          expand: false,
                          initialChildSize: 0.7,
                          builder:
                              (_, controller) => ListView(
                                controller: controller,
                                padding: const EdgeInsets.fromLTRB(
                                  T.s5,
                                  0,
                                  T.s5,
                                  T.s6,
                                ),
                                children: [
                                  Text(
                                    l10n.ptPastMedicines,
                                    style: T.title.copyWith(color: T.ink),
                                  ),
                                  for (final (i, m) in medicines.indexed) ...[
                                    if (i > 0)
                                      const Divider(height: 1, color: T.line),
                                    _row(sheet, m),
                                  ],
                                ],
                              ),
                        ),
                  ),
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
    final l10n = AppLocalizations.of(context);
    final others = medication.alsoOnList;
    if (others.isEmpty) return const SizedBox.shrink();
    final elsewhere = others.any((o) => !o.samePractice);
    final strengths = others
        .map((o) => formatStrength(o.strength))
        .where((s) => s.isNotEmpty)
        .toSet()
        .join(', ');
    final what =
        strengths.isEmpty ? medication.name : '${medication.name} $strengths';
    return Padding(
      padding: const EdgeInsets.only(top: T.s2),
      child: NoticeTile(
        status: Status.watch,
        icon: Icons.warning_amber_rounded,
        message:
            elsewhere
                ? l10n.ptAlsoPrescribedElsewhere(what)
                : l10n.ptAlsoOnYourList(what),
      ),
    );
  }
}
