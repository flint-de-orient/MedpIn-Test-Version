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
import '../../../shared/providers/core_providers.dart';
import '../../medications/domain/strength.dart';
import '../domain/clinician_models.dart';
import 'clinician_providers.dart';

/// The patient's prescriptions, latest first — each a dated card with a summary
/// (diagnosis, medicine count, tests, follow-up), expandable to the full
/// prescription, with actions to open the server-generated PDF in the phone's
/// viewer or send it on.
class PrescriptionListScreen extends ConsumerWidget {
  const PrescriptionListScreen({
    super.key,
    required this.patientId,
    this.patientName,
  });

  final String patientId;
  final String? patientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
      body: RefreshIndicator(
        onRefresh:
            () async => ref.invalidate(patientPrescriptionsProvider(patientId)),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (e, _) => ListView(
                children: [
                  const SizedBox(height: 120),
                  Center(
                    child: Text(
                      'Could not load prescriptions',
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
          data: (items) {
            if (items.isEmpty) {
              return ListView(
                children: [
                  const SizedBox(height: 120),
                  Icon(
                    Icons.receipt_long_outlined,
                    size: 52,
                    color: scheme.outlineVariant,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Center(
                    child: Text(
                      'No prescriptions yet',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Center(
                    child: Text(
                      'A consultation will add one here',
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, i) => _PrescriptionCard(rx: items[i]),
            );
          },
        ),
      ),
    );
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
    final url = widget.rx.pdfUrl;
    if (url == null || url.isEmpty) return null;
    final dir = await getTemporaryDirectory();
    final name = '${widget.rx.referenceNo ?? widget.rx.id}.pdf'.replaceAll(
      RegExp(r'[^\w.\-]'),
      '_',
    );
    final cached = File('${dir.path}/rx_${url.hashCode}_$name');
    if (!await cached.exists() || await cached.length() == 0) {
      final bytes = await ref
          .read(apiClientProvider)
          .getBytes('${AppConfig.apiOrigin}$url');
      if (bytes.isEmpty) throw Exception('empty pdf download');
      await cached.writeAsBytes(bytes, flush: true);
    }
    return cached.path;
  }

  Future<void> _open() async {
    if (_busy || widget.rx.pdfUrl == null) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final path = await _fetchPdf();
      if (path == null) return;
      final res = await OpenFilex.open(path);
      if (res.type != ResultType.done) {
        messenger.showSnackBar(
          const SnackBar(content: Text('No app on this phone can open a PDF')),
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
    if (_busy || widget.rx.pdfUrl == null) return;
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
                  Icons.receipt_long_rounded,
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
                    if (rx.referenceNo != null) ...[
                      const SizedBox(height: 0),
                      Text(
                        rx.referenceNo!,
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (rx.diagnosis.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            _line(
              context,
              Icons.local_hospital_outlined,
              rx.diagnosis.join(', '),
            ),
          ],
          const SizedBox(height: 4),
          _line(
            context,
            Icons.medication_outlined,
            '${rx.itemCount} ${rx.itemCount == 1 ? 'medicine' : 'medicines'}'
            '${rx.labTestsAdvised.isNotEmpty ? '  ·  ${rx.labTestsAdvised.length} test${rx.labTestsAdvised.length == 1 ? '' : 's'} advised' : ''}',
          ),
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
          Row(
            children: [
              TextButton.icon(
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
              const Spacer(),
              if (rx.pdfUrl != null) ...[
                IconButton(
                  onPressed: _busy ? null : _share,
                  icon: const Icon(Icons.ios_share_rounded, size: 20),
                  tooltip: 'Share PDF',
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 2),
              ],
              OutlinedButton.icon(
                onPressed: _busy || rx.pdfUrl == null ? null : _open,
                icon:
                    _busy
                        ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                        // "Open", not "Download": the file goes straight to the
                        // phone's PDF viewer, and a button that promised a
                        // download and then launched another app was describing
                        // its mechanism rather than its effect.
                        : const Icon(Icons.picture_as_pdf_rounded, size: 18),
                label: Text(_busy ? 'Preparing…' : 'Open PDF'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                ),
              ),
            ],
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
