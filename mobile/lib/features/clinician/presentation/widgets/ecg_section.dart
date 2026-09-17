import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../../../core/capabilities/capabilities.dart';
import '../../../../core/config/app_config.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/network/submission_keys.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/data/upload_repository.dart';
import '../../../../shared/providers/core_providers.dart';
import '../../../../shared/widgets/authed_image.dart';
import '../../../../shared/widgets/fullscreen_photo.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../data/clinician_repository.dart';
import '../../domain/ecg_report.dart';
import '../clinician_providers.dart';
import 'caseload_panels.dart';

/// The ECGs on a patient's record, and — for whoever may write the record —
/// the way to file one.
///
/// ---- Read by a person -------------------------------------------------------
///
/// Every rhythm, interval and impression here was entered by the clinician who
/// read the tracing (models/EcgReport.js). Nothing is interpreted by the app or
/// the platform, and the tile says who read it where the form was told.
///
/// ---- Empty is shown only to someone who can fill it -------------------------
///
/// Most patients of a diabetes clinic have no ECG, and "No ECGs" on every
/// record would be noise to somebody who cannot file one. To somebody who can,
/// the empty section is where filing starts, so it stays.
class EcgSection extends ConsumerWidget {
  const EcgSection({super.key, required this.patientId});

  final String patientId;

  static const int _shown = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mayFile = ref.watch(capabilitySetProvider).can(Perm.editRecord);
    final async = ref.watch(patientEcgsProvider(patientId));
    final items = async.valueOrNull;
    final failed = items == null && async.hasError;

    if (!mayFile && !failed && (items == null || items.isEmpty)) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text('ECGs', style: T.bodyStrong.copyWith(fontWeight: FontWeight.w700))),
            if (mayFile)
              TextButton.icon(
                onPressed: () => EcgFormSheet.show(context, patientId),
                icon: const Icon(Icons.add),
                label: const Text('File ECG'),
              ),
          ],
        ),
        if (failed)
          Row(
            children: [
              Expanded(child: Text('Could not load ECGs.', style: T.small.copyWith(color: T.inkMuted))),
              TextButton(
                onPressed: () => ref.invalidate(patientEcgsProvider(patientId)),
                child: const Text('Retry'),
              ),
            ],
          )
        else if (items == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: T.s4),
            child: Center(
              child: SizedBox(width: T.s5, height: T.s5, child: CircularProgressIndicator(strokeWidth: 2)),
            ),
          )
        else if (items.isEmpty)
          Text('No ECGs on this record.', style: T.small.copyWith(color: T.inkMuted))
        else ...[
          for (final r in items.take(_shown))
            Padding(padding: const EdgeInsets.only(top: T.s2), child: EcgTile(report: r)),
          if (items.length > _shown)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _showAll(context, items),
                child: Text('View all (${items.length})'),
              ),
            ),
        ],
      ],
    );
  }

  static Future<void> _showAll(BuildContext context, List<EcgReport> items) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.8,
          maxChildSize: 0.95,
          builder: (_, controller) => ListView.separated(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s6),
            itemCount: items.length + 1,
            separatorBuilder: (_, _) => const SizedBox(height: T.s2),
            itemBuilder: (_, i) => i == 0
                ? Text('ECGs (${items.length})', style: T.title)
                : EcgTile(report: items[i - 1]),
          ),
        ),
      );
}

/// One ECG: the impression in words, then what was measured and read.
class EcgTile extends ConsumerStatefulWidget {
  const EcgTile({super.key, required this.report});

  final EcgReport report;

  @override
  ConsumerState<EcgTile> createState() => _EcgTileState();
}

class _EcgTileState extends ConsumerState<EcgTile> {
  bool _opening = false;

  EcgReport get r => widget.report;

  /// A photograph opens full screen; a PDF is downloaded with the auth header
  /// and handed to the phone's viewer, as a lab report is.
  Future<void> _open(EcgFile file) async {
    if (file.isImage) {
      await FullscreenPhoto.show(context, file.url);
      return;
    }
    if (_opening) return;
    setState(() => _opening = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final dir = await getTemporaryDirectory();
      final cached = File('${dir.path}/ecg_${file.id}.pdf');
      if (!await cached.exists() || await cached.length() == 0) {
        final bytes = await ref.read(apiClientProvider).getBytes('${AppConfig.apiOrigin}${file.url}');
        if (bytes.isEmpty) throw Exception('empty tracing download');
        await cached.writeAsBytes(bytes, flush: true);
      }
      final result = await OpenFilex.open(cached.path);
      if (result.type != ResultType.done) {
        messenger.showSnackBar(const SnackBar(content: Text('No app on this phone can open that tracing')));
      }
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not open the tracing')));
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final photo = r.files.where((f) => f.isImage).firstOrNull;
    final documents = r.files.where((f) => !f.isImage).toList();
    return InnerTile(
      tone: RecentEcgsCard.toneFor(r.impression),
      onTap: photo == null ? null : () => _open(photo),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (photo != null)
            Padding(
              padding: const EdgeInsets.only(right: T.s3),
              child: Semantics(
                label: 'ECG tracing photo',
                image: true,
                child: AuthedImage(path: photo.url, width: T.s12, height: T.s12, radius: T.s3),
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text(r.impression.label, style: T.bodyStrong)),
                    if (r.recordedOn != null)
                      Text(DateFormat('d MMM y').format(r.recordedOn!), style: T.small.copyWith(color: T.inkMuted)),
                  ],
                ),
                Text(ecgRhythmLabel(r.rhythm), style: T.small.copyWith(color: T.ink)),
                if (r.measurements != null) Text(r.measurements!, style: T.small.copyWith(color: T.inkMuted)),
                if (r.findings != null && r.findings!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: T.s1),
                    child: Text(r.findings!, style: T.small.copyWith(color: T.ink)),
                  ),
                if (r.readBy != null && r.readBy!.isNotEmpty)
                  Text('Read by ${r.readBy}', style: T.small.copyWith(color: T.inkMuted)),
                for (final d in documents)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _opening ? null : () => _open(d),
                      icon: const Icon(Icons.picture_as_pdf_outlined),
                      label: const Text('Open tracing'),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Filing an ECG
// ---------------------------------------------------------------------------

/// A tracing attached to the form, uploaded as soon as it is chosen.
class _Attached {
  const _Attached({required this.id, required this.name, this.localImage});
  final String id;
  final String name;

  /// The picked photo on this phone, for the preview. Null for a PDF.
  final String? localImage;
}

class EcgFormSheet extends ConsumerStatefulWidget {
  const EcgFormSheet({super.key, required this.patientId});

  final String patientId;

  static Future<void> show(BuildContext context, String patientId) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => EcgFormSheet(patientId: patientId),
      );

  @override
  ConsumerState<EcgFormSheet> createState() => _EcgFormSheetState();
}

class _EcgFormSheetState extends ConsumerState<EcgFormSheet> {
  final _form = GlobalKey<FormState>();
  final _heartRate = TextEditingController();
  final _pr = TextEditingController();
  final _qrs = TextEditingController();
  final _qtc = TextEditingController();
  final _findings = TextEditingController();
  final _readBy = TextEditingController();

  /// One key per form. A retry of this same filing — the network dropped after
  /// the server wrote it — is answered with the ECG already filed.
  final _submission = SubmissionKeys();

  /// Fixed when the form opens, not when Save is pressed, so a retry sends the
  /// same values and is recognised as the same filing.
  final DateTime _openedAt = DateTime.now();
  late DateTime _recordedOn = _openedAt;

  String _rhythm = 'unknown';
  EcgImpression _impression = EcgImpression.unknown;
  final List<_Attached> _files = [];
  bool _uploading = false;
  bool _saving = false;

  static const int _maxFiles = 5;

  @override
  void dispose() {
    for (final c in [_heartRate, _pr, _qrs, _qtc, _findings, _readBy]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final today = DateTime(_openedAt.year, _openedAt.month, _openedAt.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _recordedOn,
      firstDate: DateTime(_openedAt.year - 10),
      lastDate: _openedAt,
      helpText: 'When was the ECG taken?',
    );
    if (picked == null) return;
    setState(() {
      // Today keeps the time the form was opened; an earlier day is filed at
      // midday, so no timezone turns it into the day before.
      _recordedOn = picked == today ? _openedAt : DateTime(picked.year, picked.month, picked.day, 12);
    });
  }

  Future<void> _attachPhoto(ImageSource source) async {
    final file = await ImagePicker().pickImage(source: source, maxWidth: 2400, maxHeight: 2400, imageQuality: 90);
    if (file == null) return;
    await _upload(path: file.path, name: file.name, isImage: true);
  }

  Future<void> _attachPdf() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf']);
    final picked = result?.files.single;
    if (picked?.path == null) return;
    await _upload(path: picked!.path!, name: picked.name, isImage: false);
  }

  Future<void> _upload({required String path, required String name, required bool isImage}) async {
    final messenger = ScaffoldMessenger.of(context);
    if (await File(path).length() > UploadRepository.maxBytes) {
      messenger.showSnackBar(const SnackBar(content: Text('That file is larger than 12 MB.')));
      return;
    }
    setState(() => _uploading = true);
    try {
      final asset = await ref.read(uploadRepositoryProvider).uploadImage(
            path: path,
            filename: name,
            kind: UploadKind.ecgTracing,
            // Owned by the patient, like every file on their record.
            patientId: widget.patientId,
          );
      if (!mounted) return;
      setState(() => _files.add(_Attached(id: asset.id, name: name, localImage: isImage ? path : null)));
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.message : 'Could not attach the tracing. Please try again.')),
      );
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (_saving || _uploading) return;
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref.read(clinicianRepositoryProvider).fileEcg(
            widget.patientId,
            EcgDraft(
              recordedOn: _recordedOn,
              rhythm: _rhythm,
              impression: _impression,
              fileIds: [for (final f in _files) f.id],
              heartRate: int.tryParse(_heartRate.text.trim()),
              prIntervalMs: int.tryParse(_pr.text.trim()),
              qrsDurationMs: int.tryParse(_qrs.text.trim()),
              qtcMs: int.tryParse(_qtc.text.trim()),
              findings: _findings.text,
              readBy: _readBy.text,
            ),
            submission: _submission,
          );
      ref.invalidate(patientEcgsProvider(widget.patientId));
      ref.invalidate(ecgPanelProvider(RecentEcgsCard.days));
      navigator.pop();
      messenger.showSnackBar(const SnackBar(content: Text('ECG filed.')));
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.message : 'Could not file the ECG. Please try again.')),
      );
    } finally {
      // In the `finally`: a failure must never leave the button spinning with
      // what was typed trapped behind it.
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Optional, whole numbers, inside what a tracing can show.
  String? Function(String?) _range(String name, String unit, ({int min, int max}) limit) => (value) {
        final text = value?.trim() ?? '';
        if (text.isEmpty) return null;
        final n = int.tryParse(text);
        if (n == null || n < limit.min || n > limit.max) {
          return '$name must be ${limit.min}–${limit.max} $unit';
        }
        return null;
      };

  Widget _number(TextEditingController c, String label, String unit, ({int min, int max}) limit) => TextFormField(
        controller: c,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
        validator: _range(label, unit, limit),
        autovalidateMode: AutovalidateMode.onUserInteraction,
        decoration: InputDecoration(labelText: label, suffixText: unit),
      );

  @override
  Widget build(BuildContext context) {
    const impressions = [
      EcgImpression.normal,
      EcgImpression.borderline,
      EcgImpression.abnormal,
      EcgImpression.unknown,
    ];
    final busy = _saving || _uploading;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s4),
          child: Form(
            key: _form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('File an ECG', style: T.title),
                const SizedBox(height: T.s1),
                Text(
                  'Enter what the person who read the tracing found. Leave blank what was not measured.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
                const SizedBox(height: T.s4),

                // When it was taken — the date the record is filed under.
                InnerTile(
                  onTap: busy ? null : _pickDate,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: T.tap - 2 * T.s3),
                    child: Row(
                      children: [
                        const Icon(Icons.event_outlined, color: T.primary),
                        const SizedBox(width: T.s3),
                        Expanded(child: Text('Taken on', style: T.body)),
                        Text(DateFormat('d MMM y').format(_recordedOn), style: T.bodyStrong),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: T.s4),

                Text('Impression', style: T.label.copyWith(color: T.inkMuted)),
                const SizedBox(height: T.s2),
                Wrap(
                  spacing: T.s2,
                  runSpacing: T.s2,
                  children: [
                    for (final i in impressions)
                      ChoiceChip(
                        label: Text(i.label),
                        selected: _impression == i,
                        onSelected: busy ? null : (_) => setState(() => _impression = i),
                      ),
                  ],
                ),
                const SizedBox(height: T.s4),

                DropdownButtonFormField<String>(
                  initialValue: _rhythm,
                  // Without this the field sizes to its widest rhythm and a
                  // narrow phone clips the selection away entirely.
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Rhythm'),
                  items: [
                    for (final e in ecgRhythmLabels.entries)
                      DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: busy ? null : (v) => setState(() => _rhythm = v ?? 'unknown'),
                ),
                const SizedBox(height: T.s3),

                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _number(_heartRate, 'Heart rate', 'bpm', EcgLimits.heartRate)),
                    const SizedBox(width: T.s3),
                    Expanded(child: _number(_pr, 'PR', 'ms', EcgLimits.prIntervalMs)),
                  ],
                ),
                const SizedBox(height: T.s3),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _number(_qrs, 'QRS', 'ms', EcgLimits.qrsDurationMs)),
                    const SizedBox(width: T.s3),
                    Expanded(child: _number(_qtc, 'QTc', 'ms', EcgLimits.qtcMs)),
                  ],
                ),
                const SizedBox(height: T.s3),

                TextFormField(
                  controller: _findings,
                  minLines: 2,
                  maxLines: 6,
                  maxLength: EcgLimits.findings,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Findings'),
                ),
                TextFormField(
                  controller: _readBy,
                  maxLength: EcgLimits.readBy,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Read by',
                    helperText: 'As they sign it — they may not work here.',
                  ),
                ),
                const SizedBox(height: T.s3),

                Text('Tracing', style: T.label.copyWith(color: T.inkMuted)),
                for (final f in _files)
                  Padding(
                    padding: const EdgeInsets.only(top: T.s2),
                    child: InnerTile(
                      child: Row(
                        children: [
                          if (f.localImage != null)
                            ClipRRect(
                              borderRadius: BorderRadius.circular(T.rControl),
                              child: Image.file(File(f.localImage!), width: T.s12, height: T.s12, fit: BoxFit.cover),
                            )
                          else
                            const Icon(Icons.picture_as_pdf_outlined, color: T.primary),
                          const SizedBox(width: T.s3),
                          Expanded(child: Text(f.name, style: T.small, overflow: TextOverflow.ellipsis)),
                          IconButton(
                            tooltip: 'Remove ${f.name}',
                            onPressed: busy ? null : () => setState(() => _files.remove(f)),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_uploading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: T.s3),
                    child: LinearProgressIndicator(),
                  )
                else if (_files.length < _maxFiles)
                  Wrap(
                    spacing: T.s2,
                    children: [
                      TextButton.icon(
                        onPressed: busy ? null : () => _attachPhoto(ImageSource.camera),
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: const Text('Take photo'),
                      ),
                      TextButton.icon(
                        onPressed: busy ? null : () => _attachPhoto(ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_outlined),
                        label: const Text('Choose photo'),
                      ),
                      TextButton.icon(
                        onPressed: busy ? null : _attachPdf,
                        icon: const Icon(Icons.picture_as_pdf_outlined),
                        label: const Text('Choose PDF'),
                      ),
                    ],
                  ),
                const SizedBox(height: T.s4),

                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _saving ? null : () => Navigator.of(context).pop(),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: T.s3),
                    // Expanded, not bare: the theme gives filled buttons an
                    // infinite minimum width, which collapses a Row neighbour.
                    Expanded(
                      child: FilledButton(
                        onPressed: busy ? null : _save,
                        child: _saving
                            ? const SizedBox(
                                width: T.s5,
                                height: T.s5,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('File ECG'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
