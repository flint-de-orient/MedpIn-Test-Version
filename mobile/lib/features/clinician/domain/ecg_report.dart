/// An electrocardiogram as the server files it: the tracing, and what the
/// clinician who read it wrote down.
///
/// Mirrors `models/EcgReport.js`. Nothing here is interpreted by the app or the
/// platform — every rhythm, interval and impression was entered by a person.
library;

/// The impression the clinician who read the tracing gave it.
///
/// In the order a clinician scans for: what is wrong first.
enum EcgImpression {
  abnormal('abnormal', 'Abnormal'),
  borderline('borderline', 'Borderline'),
  normal('normal', 'Normal'),
  unknown('unknown', 'Not yet read');

  const EcgImpression(this.api, this.label);
  final String api;
  final String label;

  static EcgImpression fromApi(Object? v) {
    for (final i in values) {
      if (i.api == v) return i;
    }
    return unknown;
  }
}

/// The rhythms the server accepts, worded for a clinician, in `ECG_RHYTHMS`
/// order.
const Map<String, String> ecgRhythmLabels = {
  'sinus': 'Sinus rhythm',
  'atrial_fibrillation': 'Atrial fibrillation',
  'atrial_flutter': 'Atrial flutter',
  'supraventricular_tachycardia': 'Supraventricular tachycardia',
  'ventricular_tachycardia': 'Ventricular tachycardia',
  'heart_block': 'Heart block',
  'paced': 'Paced rhythm',
  'other': 'Other rhythm',
  'unknown': 'Rhythm not recorded',
};

String ecgRhythmLabel(Object? api) => ecgRhythmLabels[api] ?? 'Rhythm not recorded';

/// The limits the server validates against, so the form refuses the same
/// values before a round trip does.
abstract final class EcgLimits {
  static const heartRate = (min: 20, max: 300);
  static const prIntervalMs = (min: 40, max: 600);
  static const qrsDurationMs = (min: 20, max: 300);
  static const qtcMs = (min: 200, max: 800);
  static const findings = 2000;
  static const readBy = 160;
}

class EcgFile {
  const EcgFile({required this.id, required this.url, this.mimeType});

  final String id;

  /// Server-relative, e.g. `/api/v1/uploads/<id>/raw`.
  final String url;
  final String? mimeType;

  bool get isImage => mimeType == null || mimeType!.startsWith('image/');
}

class EcgReport {
  const EcgReport({
    required this.id,
    required this.recordedOn,
    required this.rhythm,
    required this.impression,
    this.files = const [],
    this.heartRate,
    this.prIntervalMs,
    this.qrsDurationMs,
    this.qtcMs,
    this.findings,
    this.readBy,
  });

  final String id;
  final DateTime? recordedOn;
  final String rhythm;
  final EcgImpression impression;
  final List<EcgFile> files;
  final num? heartRate;
  final num? prIntervalMs;
  final num? qrsDurationMs;
  final num? qtcMs;
  final String? findings;
  final String? readBy;

  /// The measured values, worded — only the ones somebody measured.
  String? get measurements {
    final parts = [
      if (heartRate != null) '${heartRate!.round()} bpm',
      if (prIntervalMs != null) 'PR ${prIntervalMs!.round()} ms',
      if (qrsDurationMs != null) 'QRS ${qrsDurationMs!.round()} ms',
      if (qtcMs != null) 'QTc ${qtcMs!.round()} ms',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  factory EcgReport.fromJson(Map<String, dynamic> j) {
    final files = j['files'] is List ? j['files'] as List : const [];
    return EcgReport(
      id: '${j['id']}',
      recordedOn: j['recordedOn'] is String ? DateTime.tryParse(j['recordedOn'] as String)?.toLocal() : null,
      rhythm: j['rhythm'] as String? ?? 'unknown',
      impression: EcgImpression.fromApi(j['impression']),
      files: [
        for (final f in files.whereType<Map<String, dynamic>>())
          EcgFile(id: '${f['id']}', url: '${f['url']}', mimeType: f['mimeType'] as String?),
      ],
      heartRate: j['heartRate'] as num?,
      prIntervalMs: j['prIntervalMs'] as num?,
      qrsDurationMs: j['qrsDurationMs'] as num?,
      qtcMs: j['qtcMs'] as num?,
      findings: j['findings'] as String?,
      readBy: j['readBy'] as String?,
    );
  }
}

/// What the form sends. Absent values are left out, never sent as zero.
class EcgDraft {
  const EcgDraft({
    required this.recordedOn,
    required this.rhythm,
    required this.impression,
    this.fileIds = const [],
    this.heartRate,
    this.prIntervalMs,
    this.qrsDurationMs,
    this.qtcMs,
    this.findings,
    this.readBy,
  });

  final DateTime recordedOn;
  final String rhythm;
  final EcgImpression impression;
  final List<String> fileIds;
  final int? heartRate;
  final int? prIntervalMs;
  final int? qrsDurationMs;
  final int? qtcMs;
  final String? findings;
  final String? readBy;

  Map<String, dynamic> toJson() => {
        'recordedOn': recordedOn.toUtc().toIso8601String(),
        'rhythm': rhythm,
        'impression': impression.api,
        if (fileIds.isNotEmpty) 'files': fileIds,
        if (heartRate != null) 'heartRate': heartRate,
        if (prIntervalMs != null) 'prIntervalMs': prIntervalMs,
        if (qrsDurationMs != null) 'qrsDurationMs': qrsDurationMs,
        if (qtcMs != null) 'qtcMs': qtcMs,
        if (findings != null && findings!.trim().isNotEmpty) 'findings': findings!.trim(),
        if (readBy != null && readBy!.trim().isNotEmpty) 'readBy': readBy!.trim(),
      };
}
