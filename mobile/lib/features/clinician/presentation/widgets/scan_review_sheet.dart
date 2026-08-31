import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../domain/prescription_scan.dart';

/// What was read off the paper, before it is filed.
///
/// The desk photographs a handwritten prescription and this shows them what the
/// server made of it: whose name is printed, the date, the medicines, the tests
/// advised, the advice. They confirm, and it is written.
///
/// ---- The name is why this exists ------------------------------------------
///
/// Filing one patient's slip onto another's chart is the mistake here that
/// harms somebody, and it is invisible afterwards — a misfiled prescription
/// looks exactly as correct as a right one. During a pilot where fifty are
/// photographed in a fortnight, with two Rahuls in the waiting room, it is also
/// not a hypothetical.
///
/// So a mismatch is not a warning tucked under the fold. It is red, it names
/// both people, and it holds the button until somebody ticks a box saying they
/// have looked.
///
/// ---- What it does not do --------------------------------------------------
///
/// It does not let the desk edit the medicines. They are a transcription of a
/// doctor's handwriting, and a receptionist correcting a drug name from memory
/// is a worse record than an imperfect one that is plainly marked as scanned.
/// What they can do is file it without the detail — the photograph alone —
/// which is the honest option when the reading looks wrong.
class ScanReviewSheet extends StatefulWidget {
  const ScanReviewSheet({super.key, required this.scan});

  final PrescriptionScan scan;

  /// Returns the outcome, or null if the desk backed out.
  static Future<ScanReviewResult?> show(
    BuildContext context,
    PrescriptionScan scan,
  ) => showModalBottomSheet<ScanReviewResult>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => ScanReviewSheet(scan: scan),
  );

  @override
  State<ScanReviewSheet> createState() => _ScanReviewSheetState();
}

/// What the desk chose. [keepDetail] false files the photograph alone.
class ScanReviewResult {
  const ScanReviewResult({required this.issuedOn, required this.keepDetail});

  final DateTime issuedOn;
  final bool keepDetail;
}

class _ScanReviewSheetState extends State<ScanReviewSheet> {
  late DateTime _issued;
  bool _confirmedPerson = false;

  @override
  void initState() {
    super.initState();
    // The date off the page. Only when it carries none does the desk get asked
    // — which was the first thing it used to ask, while they were holding the
    // paper it was printed on.
    _issued = widget.scan.issuedOn ?? DateTime.now();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _issued,
      firstDate: now.subtract(const Duration(days: 730)),
      lastDate: now,
      helpText: 'Date on the prescription',
    );
    if (picked != null) setState(() => _issued = picked);
  }

  bool get _blocked => widget.scan.name.mustConfirm && !_confirmedPerson;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = widget.scan;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Check before filing',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            s.readable
                ? 'This is what was read off the photograph.'
                : 'The photograph could not be read. It can still be filed.',
            style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.md),

          _NameCheck(
            check: s.name,
            confirmed: _confirmedPerson,
            onConfirmed: (v) => setState(() => _confirmedPerson = v),
          ),

          const SizedBox(height: AppSpacing.md),
          _Row(
            icon: Icons.event_outlined,
            label: 'Date',
            value: DateFormat('EEEE, d MMMM yyyy').format(_issued),
            hint:
                s.issuedOn == null
                    ? 'Not printed on the page — please set it'
                    : 'Read from the prescription',
            onTap: _pickDate,
          ),

          if (s.prescriberName != null) ...[
            const SizedBox(height: AppSpacing.sm),
            _Row(
              icon: Icons.badge_outlined,
              label: 'Written by',
              value: s.prescriberName!,
            ),
          ],

          if (s.items.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            _Heading('Medicines', count: s.items.length),
            for (final m in s.items)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '•  ${m.summary}',
                  style: const TextStyle(fontSize: 14, height: 1.35),
                ),
              ),
          ],

          if (s.diagnosis.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _Heading('Diagnosis', count: s.diagnosis.length),
            Text(
              s.diagnosis.join(', '),
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],

          if (s.labTests.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _Heading('Tests advised', count: s.labTests.length),
            Text(
              s.labTests.join(', '),
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],

          if ((s.advice ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            const _Heading('Advice'),
            Text(
              s.advice!,
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],

          if (s.note != null && s.note!.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              s.note!.trim(),
              style: TextStyle(
                fontSize: 12.5,
                height: 1.35,
                fontStyle: FontStyle.italic,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],

          if (s.readable && !s.hasDetail) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              'Nothing could be read from the page beyond the image itself. '
              'Filing it keeps the photograph on the record.',
              style: TextStyle(
                fontSize: 13,
                height: 1.35,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],

          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed:
                  _blocked
                      ? null
                      : () => Navigator.pop(
                        context,
                        ScanReviewResult(
                          issuedOn: _issued,
                          keepDetail: s.hasDetail,
                        ),
                      ),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: Text(
                s.hasDetail ? 'File this prescription' : 'File the photograph',
              ),
            ),
          ),

          if (s.hasDetail) ...[
            const SizedBox(height: 4),
            SizedBox(
              width: double.infinity,
              child: TextButton(
                // The honest escape hatch when the reading looks wrong: keep
                // the photograph, drop the transcription. Better than a
                // receptionist correcting a drug name from memory.
                onPressed:
                    _blocked
                        ? null
                        : () => Navigator.pop(
                          context,
                          ScanReviewResult(
                            issuedOn: _issued,
                            keepDetail: false,
                          ),
                        ),
                child: const Text('File the photograph only'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Stateless, and the tick is held by the sheet.
///
/// It kept its own `_confirmed` at first, which looked right and was not: the
/// sheet's file button reads the sheet's flag, so the box ticked, nothing
/// happened, and the button stayed dead with no way to find out why.
class _NameCheck extends StatelessWidget {
  const _NameCheck({
    required this.check,
    required this.confirmed,
    required this.onConfirmed,
  });

  final ScanNameCheck check;
  final bool confirmed;
  final ValueChanged<bool> onConfirmed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final c = check;

    final (Color tone, IconData icon, String title, String body) = switch (c
        .verdict) {
      'exact' => (
        AppColors.success,
        Icons.verified_rounded,
        'Name matches',
        '${c.onPaper ?? ''} — the same patient as this record.',
      ),
      'partial' => (
        AppColors.warning,
        Icons.help_outline_rounded,
        'Check this is the same person',
        'The paper says "${c.onPaper}". This record is "${c.onFile}". '
            'They share a name but are not the same words.',
      ),
      'different' => (
        AppColors.danger,
        Icons.report_problem_rounded,
        'This looks like a different patient',
        'The paper says "${c.onPaper}". This record is "${c.onFile}".',
      ),
      _ => (
        scheme.onSurfaceVariant,
        Icons.info_outline_rounded,
        'No name on the page',
        'Nothing legible to check against "${c.onFile ?? 'this record'}". '
            'Make sure you have the right patient open.',
      ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tone.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: tone),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
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
          if (c.mustConfirm)
            // A tick, not a second button. The desk has to state that they
            // looked, and the file button stays dead until they do.
            CheckboxListTile(
              value: confirmed,
              onChanged: (v) => onConfirmed(v ?? false),
              contentPadding: EdgeInsets.zero,
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                'I have checked — this prescription belongs to this patient',
                style: TextStyle(fontSize: 13, height: 1.3),
              ),
            ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text, {this.count});

  final String text;
  final int? count;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Text(
      count == null ? text : '$text  ($count)',
      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.label,
    required this.value,
    this.hint,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final String? hint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.sm),
          child: Row(
            children: [
              Icon(icon, size: 18, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      value,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (hint != null)
                      Text(
                        hint!,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
              if (onTap != null)
                Icon(
                  Icons.edit_calendar_outlined,
                  size: 18,
                  color: scheme.onSurfaceVariant,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
