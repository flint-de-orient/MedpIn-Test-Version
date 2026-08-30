import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../data/medications_repository.dart';
import '../../domain/medication.dart';
import '../../domain/strength.dart';

/// Scan a paper prescription into medicines: take a photo or pick one from the
/// gallery, the server reads it, and the medicines it finds are added with their
/// reminder times set automatically.
///
/// Returns `true` if any medicine was added.
Future<bool?> showScanPrescriptionSheet(BuildContext context) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => const _ScanPrescriptionSheet(),
  );
}

enum _Phase { choose, scanning, result }

class _ScanPrescriptionSheet extends ConsumerStatefulWidget {
  const _ScanPrescriptionSheet();

  @override
  ConsumerState<_ScanPrescriptionSheet> createState() =>
      _ScanPrescriptionSheetState();
}

class _ScanPrescriptionSheetState
    extends ConsumerState<_ScanPrescriptionSheet> {
  _Phase _phase = _Phase.choose;
  PrescriptionScanResult? _result;

  /// Rows the patient has unticked, by index into the scanned list.
  ///
  /// Excluded rather than included, so the default is to keep everything the
  /// prescription says — unticking is a deliberate act and forgetting to tick
  /// cannot quietly drop a medicine.
  final Set<int> _excluded = {};
  bool _saving = false;

  List<ScannedMedicine> get _keeping {
    final items = _result?.items ?? const <ScannedMedicine>[];
    return [
      for (var i = 0; i < items.length; i++)
        if (!_excluded.contains(i)) items[i],
    ];
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref
          .read(medicationsRepositoryProvider)
          .confirmScannedMedicines(
            items: _keeping,
            prescriber: _result?.prescriber,
          );
      navigator.pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _pick(ImageSource source) async {
    final XFile? file = await ImagePicker().pickImage(
      source: source,
      // A prescription is text-dense; keep enough resolution for the OCR to read
      // small handwriting, but not so large the upload drags.
      maxWidth: 2000,
      imageQuality: 90,
    );
    if (file == null || !mounted) return;

    setState(() => _phase = _Phase.scanning);
    try {
      final res = await ref
          .read(medicationsRepositoryProvider)
          .scanPrescription(path: file.path, filename: file.name);
      if (!mounted) return;
      setState(() {
        _result = res;
        _phase = _Phase.result;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _phase = _Phase.choose);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        0,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      child: switch (_phase) {
        _Phase.choose => _chooser(),
        _Phase.scanning => _scanning(),
        _Phase.result => _resultView(),
      },
    );
  }

  Widget _chooser() {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Scan prescription',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          "Take a clear photo of Dr.'s prescription — we'll read the medicines and set your daily reminders automatically.",
          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14),
        ),
        const SizedBox(height: AppSpacing.lg),
        Row(
          children: [
            Expanded(
              child: _SourceButton(
                icon: Icons.photo_camera_outlined,
                label: 'Take photo',
                onTap: () => _pick(ImageSource.camera),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: _SourceButton(
                icon: Icons.photo_library_outlined,
                label: 'From gallery',
                onTap: () => _pick(ImageSource.gallery),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Icon(
              Icons.lightbulb_outline,
              size: 16,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                'Good light and a flat, in-focus photo help us read it accurately.',
                style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _scanning() {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppSpacing.xxl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 40,
            height: 44,
            child: CircularProgressIndicator(strokeWidth: 3),
          ),
          SizedBox(height: AppSpacing.lg),
          Text(
            'Reading your prescription…',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 4),
          Text('This takes a few seconds', style: TextStyle(fontSize: 12)),
        ],
      ),
    );
  }

  Widget _resultView() {
    final res = _result!;
    final scheme = Theme.of(context).colorScheme;

    if (!res.readable || res.items.isEmpty) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.image_not_supported_outlined,
            size: 40,
            color: AppColors.warningOn(context),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            "Couldn't read that photo",
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            res.note ??
                'Make sure the whole prescription is in frame, in focus, and well lit — then try again.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton.icon(
              onPressed: () => setState(() => _phase = _Phase.choose),
              icon: const Icon(Icons.refresh),
              label: const Text('Try another photo'),
            ),
          ),
        ],
      );
    }

    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // A question, not a receipt.
          //
          // This said "Added 4 medicines" over a list that was already saved
          // and already ringing. Nothing here is written until the button at
          // the foot is pressed, so the heading has to ask rather than report —
          // and the times are shown because the time is the thing most likely
          // to be wrong and the thing that wakes somebody at the wrong hour.
          Row(
            children: [
              Icon(
                Icons.fact_check_outlined,
                color: AppColors.primary,
                size: 26,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Check before we set reminders',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Read off your prescription. Uncheck anything that looks wrong — '
            'nothing is saved until you tap the button below.',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (var i = 0; i < res.items.length; i++)
            _ReviewRow(
              med: res.items[i],
              included: !_excluded.contains(i),
              onToggle:
                  () => setState(() {
                    if (!_excluded.remove(i)) _excluded.add(i);
                  }),
            ),
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton.icon(
              onPressed: _keeping.isEmpty || _saving ? null : _save,
              icon:
                  _saving
                      ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                      : const Icon(Icons.notifications_active_outlined),
              label: Text(
                _saving
                    ? 'Saving…'
                    : _keeping.isEmpty
                    ? 'Nothing selected'
                    : 'Set reminders for ${_keeping.length}',
              ),
              style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
            ),
          ),
        ],
      ),
    );
  }
}

class _SourceButton extends StatelessWidget {
  const _SourceButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Column(
          children: [
            Icon(icon, size: 30, color: AppColors.accentOn(context)),
            const SizedBox(height: AppSpacing.sm),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

/// One proposed medicine, with a tick.
///
/// Shows the time first among the details, because the time is the field most
/// likely to be wrong and the only one that wakes somebody at the wrong hour.
class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    required this.med,
    required this.included,
    required this.onToggle,
  });

  final ScannedMedicine med;
  final bool included;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final times = med.schedule.map((s) => s.time).where((t) => t.isNotEmpty);
    final detail = [
      if ((med.strength ?? '').isNotEmpty) med.strength!,
      if ((med.dose ?? '').isNotEmpty) med.dose!,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color:
            included
                ? scheme.surfaceContainerLow
                : scheme.surfaceContainerLow.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
        child: InkWell(
          onTap: onToggle,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  included
                      ? Icons.check_box_rounded
                      : Icons.check_box_outline_blank_rounded,
                  color:
                      included ? AppColors.primary : scheme.onSurfaceVariant,
                  size: 22,
                ),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Opacity(
                    opacity: included ? 1 : 0.5,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          med.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15.5,
                            height: 1.25,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (detail.isNotEmpty)
                          Text(
                            detail,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13.5,
                              height: 1.3,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        const SizedBox(height: 5),
                        Row(
                          children: [
                            Icon(
                              Icons.alarm_rounded,
                              size: 15,
                              color:
                                  times.isEmpty
                                      ? AppColors.warningOn(context)
                                      : AppColors.primary,
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                // No time is a real answer — an as-needed
                                // medicine has none — and saying so is better
                                // than showing an hour nobody chose.
                                times.isEmpty
                                    ? 'No reminder — take as directed'
                                    : times.join(', '),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w700,
                                  color:
                                      times.isEmpty
                                          ? AppColors.warningOn(context)
                                          : AppColors.primary,
                                ),
                              ),
                            ),
                          ],
                        ),
                        // What the doctor wrote about when, under the hour it
                        // was turned into.
                        //
                        // An hour on its own is unverifiable: a patient looking
                        // at "13:30" has no way to tell whether that is what
                        // their prescription says. "1 tab each AF Lunch" beside
                        // it is a sentence they can hold against the paper,
                        // which is the only thing that makes this a review
                        // rather than a formality.
                        for (final line in {
                          if ((med.whenText ?? '').isNotEmpty) med.whenText!,
                          if ((med.instructions ?? '').isNotEmpty)
                            med.instructions!,
                        }) ...[
                          const SizedBox(height: 3),
                          Text(
                            line,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12.5,
                              height: 1.3,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
