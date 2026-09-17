import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';

class MarkDoseResult {
  const MarkDoseResult({required this.status, this.skipReason});
  final String status; // taken | skipped
  final String? skipReason;
}

/// Asks whether one dose was taken.
///
/// [detail] is the dose's own line — "8:30 PM · 1 tablet · After meal" — so a
/// patient holding two strips answers for the right one.
Future<MarkDoseResult?> showMarkDoseSheet(
  BuildContext context,
  String medicationName, {
  String? detail,
}) {
  return showModalBottomSheet<MarkDoseResult>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder:
        (context) => _MarkDoseSheet(medicationName: medicationName, detail: detail),
  );
}

class _MarkDoseSheet extends StatelessWidget {
  const _MarkDoseSheet({required this.medicationName, this.detail});

  final String medicationName;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.ptDidYouTakeThisDose,
              style: T.small.copyWith(color: T.inkMuted),
            ),
            const SizedBox(height: T.s1),
            // The medicine, large. The sheet used to open on a bare line of
            // text; at arm's length that is easy to answer for the wrong one.
            Text(medicationName, style: T.title.copyWith(color: T.ink)),
            if (detail != null && detail!.isNotEmpty)
              Text(detail!, style: T.body.copyWith(color: T.inkMuted)),
            const SizedBox(height: T.s5),

            // Taken is the answer nearly every time, so it is the filled
            // button and it comes first. Skipped is deliberately quieter — not
            // hidden, because an honest "no" is what makes the record worth
            // showing the doctor.
            PrimaryAction(
              label: l10n.ptYesTookIt,
              icon: Icons.check_rounded,
              onPressed:
                  () => Navigator.of(
                    context,
                  ).pop(const MarkDoseResult(status: 'taken')),
            ),
            const SizedBox(height: T.s3),
            SecondaryAction(
              label: l10n.ptNoSkippedIt,
              icon: Icons.close_rounded,
              tone: T.ink,
              onPressed: () async {
                final reason = await _pickSkipReason(context);
                if (reason == null || !context.mounted) return;
                Navigator.of(context).pop(
                  MarkDoseResult(
                    status: 'skipped',
                    skipReason: reason.isEmpty ? null : reason,
                  ),
                );
              },
            ),
            const SizedBox(height: T.s4),
            // Said plainly, because a patient who thinks a skip gets them told
            // off simply taps "taken" — and then the record is fiction.
            Text(
              l10n.ptSkipHonestyNote,
              style: T.small.copyWith(color: T.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}

/// The reason for a skip, or '' for none. Null only when the dialog was
/// dismissed, which leaves the dose unanswered.
///
/// The left-hand button used to say "Cancel" and recorded the skip anyway,
/// without a reason. It now says what it does.
Future<String?> _pickSkipReason(BuildContext context) async {
  final l10n = AppLocalizations.of(context);
  // Not disposed here: the dialog's closing animation still draws the field
  // after the future completes.
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder:
        (ctx) => AlertDialog(
          title: Text(l10n.medsSkipReasonTitle, style: T.title),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, ''),
              child: Text(l10n.ptNoReason),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: Text(l10n.commonSave),
            ),
          ],
        ),
  );
}
