import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/daily_report_repository.dart';
import '../domain/daily_report.dart';

/// `YYYY-MM-DD` for a calendar day, from its parts — never through a clock or
/// a timezone, which is how a day turns into the one before it.
String reportDate(DateTime day) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${day.year}-${two(day.month)}-${two(day.day)}';
}

/// The doctor's day: who they saw, what was found and what was prescribed.
///
/// ---- Preview first, then the doctor decides -------------------------------
///
/// The summary is read on screen before any file exists. Opening the PDF or
/// sharing it are separate, deliberate taps, and sharing goes through the
/// phone's own share sheet — the doctor picks the destination every time,
/// WhatsApp included, and nothing is ever sent from here on its own. The server
/// writes each preview, open and share into the audit log.
///
/// ---- What "seen" means ----------------------------------------------------
///
/// A checked-in or completed appointment with this doctor that day, or a
/// prescription they issued that day. Said on the screen, because a patient who
/// only had their blood pressure taken is not on the list and the doctor should
/// not have to guess why.
class DailyReportScreen extends ConsumerStatefulWidget {
  const DailyReportScreen({super.key});

  @override
  ConsumerState<DailyReportScreen> createState() => _DailyReportScreenState();
}

class _DailyReportScreenState extends ConsumerState<DailyReportScreen> {
  late DateTime _day;

  /// Which of the two file actions is running, so only that button spins.
  DailyReportPurpose? _busy;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _day = DateTime(now.year, now.month, now.day);
  }

  bool get _isToday {
    final now = DateTime.now();
    return _day.year == now.year && _day.month == now.month && _day.day == now.day;
  }

  Future<void> _pickDay() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: DateTime(today.year - 2, today.month, today.day),
      // A day that has not happened has nobody in it.
      lastDate: today,
      helpText: 'Report for',
    );
    if (picked != null && mounted) setState(() => _day = picked);
  }

  /// Fetches the PDF — one generation, logged with what it is for — and writes
  /// it where only this app and the share sheet can see it.
  Future<String> _fetch(DailyReportPurpose purpose) async {
    final date = reportDate(_day);
    final bytes = await ref.read(dailyReportRepositoryProvider).pdf(date, purpose);
    if (bytes.isEmpty) throw const ApiException(code: 'EMPTY', message: 'The report came back empty.');
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/daily-summary-$date.pdf');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  Future<void> _run(DailyReportPurpose purpose) async {
    if (_busy != null) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = purpose);
    try {
      final path = await _fetch(purpose);
      if (purpose == DailyReportPurpose.share) {
        // The phone's own sheet: the doctor chooses where it goes, or nowhere.
        await SharePlus.instance.share(
          ShareParams(
            files: [XFile(path, mimeType: 'application/pdf')],
            subject: 'Daily patient summary ${reportDate(_day)}',
          ),
        );
      } else {
        final result = await OpenFilex.open(path);
        if (result.type != ResultType.done) {
          messenger.showSnackBar(
            const SnackBar(content: Text('No app on this phone can open a PDF')),
          );
        }
      }
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not make the PDF. Try again.')),
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final date = reportDate(_day);
    final async = ref.watch(dailyReportProvider(date));
    final label = _isToday ? 'Today' : DateFormat('EEE, d MMM yyyy').format(_day);

    return Scaffold(
      appBar: AppBar(title: const Text('Daily report')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dailyReportProvider(date)),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s4, T.s12),
          children: [
            SectionCard(
              child: SectionHeader(
                icon: Icons.event_note_rounded,
                title: label,
                subtitle: 'The patients you saw',
                trailing: TextButton(
                  onPressed: _pickDay,
                  child: const Text('Change date'),
                ),
              ),
            ),
            const SizedBox(height: T.s4),
            ...async.when(
              loading: () => const [
                Padding(
                  padding: EdgeInsets.all(T.s8),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ],
              error: (error, _) => [_failure(error, date)],
              data: (report) => _body(report),
            ),
          ],
        ),
      ),
    );
  }

  /// A refusal says what the server said; a lost connection says that.
  Widget _failure(Object error, String date) {
    void retry() => ref.invalidate(dailyReportProvider(date));
    if (error is ApiException && !error.isNetworkError && error.code != 'TIMEOUT') {
      return SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('The report is not available', style: T.bodyStrong.copyWith(color: T.ink)),
            const SizedBox(height: T.s1),
            Text(error.message, style: T.small.copyWith(color: T.inkMuted)),
            const SizedBox(height: T.s2),
            TextButton(onPressed: retry, child: const Text('Retry')),
          ],
        ),
      );
    }
    return LoadFailed(what: 'the report', onRetry: retry);
  }

  List<Widget> _body(DailyReport report) {
    final seen = report.patients.length;
    return [
      Text(
        seen == 0
            ? 'No patients seen on this date.'
            : '$seen ${seen == 1 ? 'patient' : 'patients'} seen · '
                '${report.prescriptionCount} ${report.prescriptionCount == 1 ? 'prescription' : 'prescriptions'}',
        style: T.bodyStrong.copyWith(color: T.ink),
      ),
      const SizedBox(height: T.s1),
      Text(
        'Listed: a checked-in or completed appointment with you, or a '
        'prescription you issued, on this date.',
        style: T.small.copyWith(color: T.inkMuted),
      ),
      for (final patient in report.patients) ...[
        const SizedBox(height: T.s3),
        _PatientCard(patient: patient),
      ],
      if (seen > 0) ...[
        const SizedBox(height: T.s6),
        _ShareCard(busy: _busy, onRun: _run),
      ],
    ];
  }
}

class _PatientCard extends StatelessWidget {
  const _PatientCard({required this.patient});

  final DailyReportPatient patient;

  @override
  Widget build(BuildContext context) {
    final time = patient.seenAt == null ? null : DateFormat('h:mm a').format(patient.seenAt!);
    final vitals = [
      for (final v in patient.vitals)
        if (v.summary.isNotEmpty) '${_time(v.at)}${v.summary}',
      for (final g in patient.glucose)
        '${_time(g.at)}Glucose ${g.valueMgDl} mg/dL'
            '${g.context != null && g.context != 'random' ? ' (${g.context!.replaceAll('_', ' ')})' : ''}',
    ];
    final prescribed = [
      for (final rx in patient.prescriptions) ...[
        if (rx.items.isEmpty) 'No medicines prescribed.',
        for (final item in rx.items) '• ${item.line}',
        if (rx.investigations.isNotEmpty) 'Investigations: ${rx.investigations.join(', ')}',
        if (rx.scanned) 'Filed from a paper prescription.',
        if (!rx.standing) 'Since replaced by a later prescription.',
      ],
      if (patient.voidedPrescriptions > 0)
        '${patient.voidedPrescriptions == 1 ? 'A prescription' : '${patient.voidedPrescriptions} prescriptions'} '
            'issued in error and voided — not shown.',
    ];

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(patient.name, style: T.title.copyWith(fontSize: 16, color: T.ink)),
              ),
              if (time != null) ...[
                const SizedBox(width: T.s2),
                Text(time, style: T.small.copyWith(color: T.inkMuted)),
              ],
            ],
          ),
          if (patient.demographics.isNotEmpty)
            Text(patient.demographics, style: T.small.copyWith(color: T.inkMuted)),
          const SizedBox(height: T.s3),
          InnerTile(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Fact(
                  label: patient.complaintBooked ? 'Reason booked' : 'Complaint',
                  value: patient.complaint,
                  none: 'Not recorded',
                ),
                _Fact(
                  label: 'Diagnosis',
                  value: patient.diagnosis.isEmpty ? null : patient.diagnosis.join('; '),
                  none: 'Not recorded',
                ),
                _Fact(
                  label: 'Vitals',
                  value: vitals.isEmpty ? null : vitals.join('\n'),
                  none: 'None recorded this day',
                ),
                _Fact(
                  label: 'Prescription',
                  value: prescribed.isEmpty ? null : prescribed.join('\n'),
                  none: 'None issued',
                ),
                _Fact(label: 'Advice', value: patient.advice, none: 'None'),
                _Fact(
                  label: 'Follow-up',
                  value: patient.followUpOn == null
                      ? null
                      : DateFormat('d MMM yyyy').format(patient.followUpOn!),
                  none: 'None set',
                  last: true,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _time(DateTime? at) => at == null ? '' : '${DateFormat('h:mm a').format(at)}  ';
}

/// One labelled line of the summary. A missing value is said, not hidden — an
/// empty diagnosis on a clinical summary reads as "nothing wrong" otherwise.
class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value, required this.none, this.last = false});

  final String label;
  final String? value;
  final String none;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : T.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: T.label.copyWith(color: T.inkMuted)),
          const SizedBox(height: T.s1),
          Text(
            value ?? none,
            style: T.body.copyWith(color: value == null ? T.inkFaint : T.ink),
          ),
        ],
      ),
    );
  }
}

class _ShareCard extends StatelessWidget {
  const _ShareCard({required this.busy, required this.onRun});

  final DailyReportPurpose? busy;
  final Future<void> Function(DailyReportPurpose) onRun;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(
            icon: Icons.picture_as_pdf_outlined,
            title: 'Take it with you',
            subtitle: 'A PDF of the summary above',
          ),
          const SizedBox(height: T.s3),
          // Said before the buttons, not after. The file names the patients and
          // what was wrong with them, and sending it is a decision.
          InnerTile(
            tone: Status.watch.tint,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline_rounded, size: 20, color: Status.watch.tone),
                const SizedBox(width: T.s2),
                Expanded(
                  child: Text(
                    'It contains your patients’ names and clinical details. Nothing '
                    'is sent until you choose where it goes — and whoever receives it '
                    'can pass it on.',
                    style: T.small.copyWith(color: T.ink),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: T.s4),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              _ActionButton(
                label: 'Open PDF',
                icon: Icons.open_in_new_rounded,
                running: busy == DailyReportPurpose.view,
                enabled: busy == null,
                onPressed: () => onRun(DailyReportPurpose.view),
                filled: false,
              ),
              _ActionButton(
                label: 'Share PDF',
                icon: Icons.ios_share_rounded,
                running: busy == DailyReportPurpose.share,
                enabled: busy == null,
                onPressed: () => onRun(DailyReportPurpose.share),
                filled: true,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.label,
    required this.icon,
    required this.running,
    required this.enabled,
    required this.onPressed,
    required this.filled,
  });

  final String label;
  final IconData icon;
  final bool running;
  final bool enabled;
  final VoidCallback onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final glyph = running
        ? const SizedBox(width: T.s4, height: T.s4, child: CircularProgressIndicator(strokeWidth: 2))
        : Icon(icon);
    // A minimum, not a fixed height: a raised text size grows the button
    // rather than clipping its label.
    final style = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(T.tap, T.tap)),
      padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: T.s4, vertical: T.s3)),
    );
    return filled
        ? FilledButton.icon(
            onPressed: enabled ? onPressed : null,
            style: style,
            icon: glyph,
            label: Text(label),
          )
        : OutlinedButton.icon(
            onPressed: enabled ? onPressed : null,
            style: style,
            icon: glyph,
            label: Text(label),
          );
  }
}
