import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import 'widgets/load_states.dart';
import 'widgets/record_ui.dart';
import '../../../shared/providers/core_providers.dart';
import '../../medications/domain/strength.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../core/network/api_exception.dart';
import '../data/clinician_repository.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/widgets/fullscreen_photo.dart';
import '../domain/prescription_scan.dart';
import 'widgets/scan_review_sheet.dart';

/// The patient's prescriptions, latest first — each a dated card with a summary
/// (diagnosis, medicine count, tests, follow-up), expandable to the full
/// prescription, with actions to open the server-generated PDF in the phone's
/// viewer or send it on.
class PrescriptionListScreen extends ConsumerStatefulWidget {
  const PrescriptionListScreen({
    super.key,
    required this.patientId,
    this.patientName,
  });

  final String patientId;
  final String? patientName;

  @override
  ConsumerState<PrescriptionListScreen> createState() =>
      _PrescriptionListScreenState();
}

class _PrescriptionListScreenState
    extends ConsumerState<PrescriptionListScreen> {
  bool _filing = false;

  String get patientId => widget.patientId;
  String? get patientName => widget.patientName;

  /// Photograph the paper, or pick a PDF of it.
  ///
  /// Both, because both happen. A prescription written at the desk is
  /// photographed; one the doctor typed elsewhere and sent over arrives as a
  /// PDF, and telling the receptionist to photograph their own screen is how
  /// an unreadable record gets into a patient's file.
  Future<void> _file() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: const Text('Photograph the prescription'),
                  onTap: () => Navigator.pop(ctx, 'camera'),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Choose a photo'),
                  onTap: () => Navigator.pop(ctx, 'gallery'),
                ),
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined),
                  title: const Text('Choose a PDF'),
                  onTap: () => Navigator.pop(ctx, 'pdf'),
                ),
              ],
            ),
          ),
    );
    if (choice == null || !mounted) return;

    String? path;
    String? filename;
    if (choice == 'pdf') {
      final picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf'],
      );
      path = picked?.files.single.path;
      filename = picked?.files.single.name;
    } else {
      final shot = await ImagePicker().pickImage(
        source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery,
        // Bigger than a clinical photo needs to be, on purpose: this is
        // handwriting that has to stay legible after the server re-encodes it.
        maxWidth: 2400,
        maxHeight: 2400,
        imageQuality: 92,
      );
      path = shot?.path;
      filename = shot?.name;
    }
    if (path == null || filename == null || !mounted) return;

    setState(() => _filing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: path,
            filename: filename,
            kind: UploadKind.prescriptionPdf,
            // Owned by the patient, or the patient's own app gets a 403 on the
            // one document they most want to open.
            patientId: patientId,
          );

      // Read it before filing it.
      //
      // The desk used to be asked for the date first — while holding the paper
      // it is printed on — and then the photograph went onto the record as an
      // image and nothing else: no medicines, no tests, no advice, and no check
      // that the name on it was the patient whose chart was open.
      //
      // A failed read is not a failed filing. The image is the record; if the
      // server cannot read it the sheet says so and files it anyway, which is
      // what the pilot needs on a bad photograph at five to eight.
      PrescriptionScan scan;
      try {
        scan = await ref
            .read(clinicianRepositoryProvider)
            .readScannedPrescription(patientId: patientId, assetId: asset.id);
      } catch (_) {
        scan = const PrescriptionScan(
          readable: false,
          name: ScanNameCheck(verdict: 'unknown'),
        );
      }

      if (!mounted) return;
      setState(() => _filing = false);
      final choice = await ScanReviewSheet.show(context, scan);
      // Backed out. The upload stays — it is owned by the patient and appears
      // nowhere until a prescription points at it — and they can try again.
      if (choice == null || !mounted) return;
      setState(() => _filing = true);

      await ref
          .read(clinicianRepositoryProvider)
          .fileScannedPrescription(
            patientId: patientId,
            assetId: asset.id,
            issuedOn: choice.issuedOn,
            items: choice.keepDetail ? scan.items : null,
            diagnosis: choice.keepDetail ? scan.diagnosis : null,
            labTests: choice.keepDetail ? scan.labTests : null,
            advice: choice.keepDetail ? scan.advice : null,
          );
      ref.invalidate(patientPrescriptionsProvider(patientId));
      // The record's medicine list is built from prescriptions, so the screen
      // behind this one is stale the moment this succeeds.
      ref.invalidate(patientMedicationsProvider(patientId));
      ref.invalidate(patientSummaryProvider(patientId));
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            choice.keepDetail && scan.items.isNotEmpty
                ? 'Filed with ${scan.items.length} '
                    '${scan.items.length == 1 ? "medicine" : "medicines"}.'
                : 'Prescription filed.',
          ),
        ),
      );
    } catch (e) {
      // Caught wide, not just ApiException: a file picked from a cloud
      // provider can fail on read, and the busy flag has to come down either
      // way or the button stays dead until the screen is left.
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException
                ? 'Could not file it. ${e.message}'
                : 'Could not file it. Please try again.',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _filing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final async = ref.watch(patientPrescriptionsProvider(patientId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Prescriptions'),
        bottom:
            patientName == null
                ? null
                : PreferredSize(
                  preferredSize: const Size.fromHeight(22),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      patientName!,
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _filing ? null : _file,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon:
            _filing
                ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: Colors.white,
                  ),
                )
                : const Icon(Icons.document_scanner_outlined),
        // What it does, which is not what "Add prescription" says.
        //
        // This photographs a prescription the doctor has already written and
        // signed on paper, and files it against the patient — the clinic's
        // pilot runs on paper and this is how the app's prescription list stops
        // being empty. The desk is meant to do it, and the record keeps the two
        // roles apart: `doctor` is whose prescription it is, `uploadedBy` is
        // who filed it.
        //
        // But "Add prescription" reads as *write a new one*, which is a thing
        // no receptionist may do and the server refuses outright. A label that
        // describes a forbidden act, on a button that performs a permitted one,
        // is how a front desk ends up believing it can prescribe.
        label: Text(_filing ? 'Filing…' : 'Scan paper prescription'),
      ),
      body: RefreshIndicator(
        onRefresh:
            () async => ref.invalidate(patientPrescriptionsProvider(patientId)),
        child: _states(
          async,
          loading: () => const Center(child: CircularProgressIndicator()),
          failed:
              (e) => ListView(
                children: [
                  FailurePanel(
                    error: e,
                    what: 'the prescriptions',
                    onRetry:
                        () => ref.invalidate(
                          patientPrescriptionsProvider(patientId),
                        ),
                  ),
                ],
              ),
          data: (items) {
            if (items.isEmpty) {
              return ListView(
                padding: const EdgeInsets.all(T.s6),
                children: [
                  const SizedBox(height: T.s12),
                  const Icon(
                    Icons.receipt_long_outlined,
                    size: T.s12,
                    color: T.inkMuted,
                  ),
                  const SizedBox(height: T.s4),
                  Text(
                    'No prescriptions yet',
                    textAlign: TextAlign.center,
                    style: T.title.copyWith(color: T.ink),
                  ),
                  const SizedBox(height: T.s2),
                  Text(
                    'A consultation adds one here. A prescription written on '
                    'paper can be filed with Scan paper prescription.',
                    textAlign: TextAlign.center,
                    style: T.body.copyWith(color: T.inkMuted),
                  ),
                ],
              );
            }
            final stale = async.hasError && !async.isLoading;
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s12 * 2),
              itemCount: items.length + (stale ? 1 : 0),
              separatorBuilder: (_, _) => const SizedBox(height: T.s4),
              itemBuilder:
                  (_, i) =>
                      stale && i == 0
                          // A refresh that could not connect keeps the list.
                          ? StaleNotice(
                            error: async.error!,
                            what: 'the list',
                            onRetry:
                                () => ref.invalidate(
                                  patientPrescriptionsProvider(patientId),
                                ),
                          )
                          : _PrescriptionCard(rx: items[stale ? i - 1 : i]),
            );
          },
        ),
      ),
    );
  }

  /// Loading, failed and answered, told apart — and a refresh that could not
  /// connect answered with the list it already had rather than an error. A
  /// refusal is not kept: it replaces the list.
  Widget _states(
    AsyncValue<List<PrescriptionSummary>> async, {
    required Widget Function() loading,
    required Widget Function(Object error) failed,
    required Widget Function(List<PrescriptionSummary> items) data,
  }) {
    final items = async.valueOrNull;
    final error = async.hasError && !async.isLoading ? async.error : null;
    if (error != null) {
      final keeps = Failure.of(error, what: 'the prescriptions').keepsData;
      if (!keeps || items == null) return failed(error);
    }
    if (items == null) return loading();
    return data(items);
  }
}

class _PrescriptionCard extends ConsumerStatefulWidget {
  const _PrescriptionCard({required this.rx});

  final PrescriptionSummary rx;

  @override
  ConsumerState<_PrescriptionCard> createState() => _PrescriptionCardState();
}

class _PrescriptionCardState extends ConsumerState<_PrescriptionCard> {
  bool _busy = false;
  bool _expanded = false;

  /// Fetch the PDF to a cached file and return its path, or null.
  ///
  /// Split out of the open so sharing does not download a second copy — a
  /// prescription is immutable once issued, so whatever is on disk is current.
  Future<String?> _fetchPdf() async {
    // Whichever document this prescription is. A composed one has a PDF
    // generated from its items; a filed paper one has the photograph, and
    // nothing to generate a PDF from.
    final url = widget.rx.documentUrl;
    if (url == null || url.isEmpty) return null;
    final dir = await getTemporaryDirectory();
    final name =
        '${widget.rx.referenceNo ?? widget.rx.id}.${widget.rx.documentExtension}'
            .replaceAll(RegExp(r'[^\w.\-]'), '_');
    final cached = File('${dir.path}/rx_${url.hashCode}_$name');
    if (!await cached.exists() || await cached.length() == 0) {
      final bytes = await ref
          .read(apiClientProvider)
          .getBytes('${AppConfig.apiOrigin}$url');
      if (bytes.isEmpty) throw Exception('empty document download');
      await cached.writeAsBytes(bytes, flush: true);
    }
    return cached.path;
  }

  Future<void> _open() async {
    if (_busy || widget.rx.documentUrl == null) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final path = await _fetchPdf();
      if (path == null) return;
      final res = await OpenFilex.open(path);
      if (res.type != ResultType.done) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              'No app on this phone can open a '
              '${widget.rx.documentExtension.toUpperCase()} file',
            ),
          ),
        );
      }
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not open the prescription')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _share() async {
    if (_busy || widget.rx.documentUrl == null) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final path = await _fetchPdf();
      if (path == null) return;
      // The OS sheet is also where "save to Files" lives, so this covers
      // sending it on and keeping a copy both.
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(path, mimeType: 'application/pdf')],
          subject: 'Prescription ${widget.rx.referenceNo ?? ''}'.trim(),
        ),
      );
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not share the prescription')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// One prescribed medicine written the way it is printed.
  String _medLine(PrescribedItem it) {
    final parts = <String>[
      it.name,
      if ((it.strength ?? '').isNotEmpty) formatStrength(it.strength),
    ];
    final tail = <String>[
      if ((it.frequency ?? '').isNotEmpty) it.frequency!.toUpperCase(),
      if (it.relationToMeal != null && it.relationToMeal != 'any')
        switch (it.relationToMeal) {
          'before_meal' => 'before food',
          'with_meal' => 'with food',
          'after_meal' => 'after food',
          _ => '',
        },
      if (it.durationDays != null) '${it.durationDays} days',
    ].where((t) => t.isNotEmpty);
    return tail.isEmpty
        ? parts.join(' ')
        : '${parts.join(' ')} — ${tail.join(' · ')}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final rx = widget.rx;
    final date =
        rx.issuedOn == null
            ? '—'
            : DateFormat('d MMM yyyy, h:mm a').format(rx.issuedOn!);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  rx.isScanned
                      ? Icons.document_scanner_outlined
                      : Icons.receipt_long_rounded,
                  color: AppColors.primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      date,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (rx.referenceNo != null)
                      Text(
                        rx.referenceNo!,
                        style: T.small.copyWith(color: T.inkMuted),
                      ),
                    // Where it stands, in words: current, superseded, voided
                    // or corrected — or, from a server that only says it
                    // ended, that it is no longer current.
                    if (prescriptionStatus(rx) case final status?) ...[
                      const SizedBox(height: T.s1),
                      StatusPill(label: status.word, status: status.status),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if ((rx.endedReason ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: T.s2),
            Text(
              rx.endedAt == null
                  ? 'Why it ended: ${rx.endedReason!.trim()}'
                  : 'Ended ${DateFormat('d MMM y').format(rx.endedAt!)}: '
                      '${rx.endedReason!.trim()}',
              style: T.small.copyWith(color: T.ink),
            ),
          ],
          if (rx.diagnosis.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            _line(
              context,
              Icons.local_hospital_outlined,
              rx.diagnosis.join(', '),
            ),
          ],
          const SizedBox(height: 4),
          // A scanned prescription has no machine-readable items, so the
          // medicine count would read "0 medicines" — which is not "none
          // prescribed", it is "nobody typed them in". Saying so is the whole
          // difference between an empty record and an unread one.
          if (rx.isScanned)
            _line(
              context,
              Icons.photo_outlined,
              rx.uploadedByName == null
                  ? 'Written on paper · filed from a photo'
                  : 'Written on paper · filed by ${rx.uploadedByName}',
            )
          else
            _line(
              context,
              Icons.medication_outlined,
              '${rx.itemCount} ${rx.itemCount == 1 ? 'medicine' : 'medicines'}'
              '${rx.labTestsAdvised.isNotEmpty ? '  ·  ${rx.labTestsAdvised.length} test${rx.labTestsAdvised.length == 1 ? '' : 's'} advised' : ''}',
            ),
          // The page itself, right here. The desk photographs it and then has
          // to know it photographed the right one, and a patient asking "what
          // did he give me" wants to look at the paper, not download it.
          if (rx.isScanned &&
              rx.scanUrl != null &&
              !(rx.scanMimeType ?? '').contains('pdf')) ...[
            const SizedBox(height: AppSpacing.sm),
            GestureDetector(
              onTap: () => FullscreenPhoto.show(context, rx.scanUrl),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: AuthedImage(
                  path: rx.scanUrl!,
                  width: double.infinity,
                  height: 160,
                  radius: 10,
                  fit: BoxFit.cover,
                ),
              ),
            ),
          ],
          if (rx.followUpOn != null) ...[
            const SizedBox(height: 4),
            _line(
              context,
              Icons.event_outlined,
              'Follow-up ${DateFormat('d MMM yyyy').format(rx.followUpOn!)}',
            ),
          ],
          // The prescription itself, in the app. Checking what was given
          // otherwise meant downloading a PDF and leaving for another app —
          // a long way round for a question asked mid-consultation.
          if (_expanded) ...[
            const SizedBox(height: AppSpacing.md),
            Divider(
              height: 1,
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: AppSpacing.sm),
            if ((rx.complaint ?? '').isNotEmpty)
              _detail(context, 'Complaint', rx.complaint!),
            if (rx.items.isNotEmpty)
              _detail(
                context,
                'Medicines',
                [for (final it in rx.items) _medLine(it)].join('\n'),
              )
            else if (rx.medicines.isNotEmpty)
              _detail(context, 'Medicines', rx.medicines.join('\n'))
            else
              _detail(context, 'Medicines', 'None prescribed at this visit'),
            if (rx.labTestsAdvised.isNotEmpty)
              _detail(context, 'Tests advised', rx.labTestsAdvised.join(', ')),
            if ((rx.generalAdvice ?? '').isNotEmpty)
              _detail(context, 'Advice', rx.generalAdvice!),
            if (rx.doctorName != null)
              _detail(context, 'Issued by', rx.doctorName!),
          ],
          const SizedBox(height: AppSpacing.sm),
          // Two full-width halves, matching the patient panel exactly, rather
          // than a Row of a text button, a Spacer and two more.
          //
          // That Row was clipped on a phone: inside a shrink-wrapping parent
          // the Spacer collapsed to nothing, the children overflowed the
          // card's rounded clip, and "Open PDF" was simply not drawn — no
          // overflow stripe, no error, just a missing button. The doctor had
          // no way to open a prescription at all.
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy || rx.documentUrl == null ? null : _open,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(46),
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  icon:
                      _busy
                          ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: Colors.white,
                            ),
                          )
                          // "Open", not "Download": the file goes to the
                          // phone's PDF viewer, and a button promising a
                          // download then launching another app describes its
                          // mechanism rather than its effect.
                          : const Icon(Icons.picture_as_pdf_rounded, size: 18),
                  label: Text(_busy ? 'Preparing…' : 'Open PDF'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy || rx.documentUrl == null ? null : _share,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(46),
                    foregroundColor: AppColors.primary,
                    side: BorderSide(color: scheme.outlineVariant),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  // One word, because the OS sheet is where saving is chosen —
                  // "Share / Save" was two words for one action.
                  icon: const Icon(Icons.ios_share_rounded, size: 18),
                  label: const Text('Share'),
                ),
              ),
            ],
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _expanded = !_expanded),
              icon: Icon(
                _expanded
                    ? Icons.expand_less_rounded
                    : Icons.expand_more_rounded,
                size: 18,
              ),
              label: Text(_expanded ? 'Hide details' : 'View details'),
              style: TextButton.styleFrom(
                foregroundColor: scheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _detail(BuildContext context, String label, String value) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontSize: 14, height: 1.4)),
        ],
      ),
    );
  }

  Widget _line(BuildContext context, IconData icon, String text) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: scheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 14,
              height: 1.3,
              color: scheme.onSurface,
            ),
          ),
        ),
      ],
    );
  }
}
