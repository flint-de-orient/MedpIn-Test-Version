/// A test report the patient uploaded against a doctor-advised test.
class LabResult {
  const LabResult({
    required this.id,
    required this.testName,
    required this.note,
    this.photoUrl,
    this.createdAt,
    this.mimeType,
    this.originalName,
    this.sizeBytes,
    this.analysisStatus,
    this.analysisSummary,
    this.abnormal = const [],
  });

  final String id;
  final String testName;
  final String note;
  final String? photoUrl;
  final DateTime? createdAt;

  /// The stored file's type. `photoUrl` is a historical name — the upload sheet
  /// has always accepted PDFs and Office files too, and without this the screen
  /// drew every one of them as an image and got a broken thumbnail.
  final String? mimeType;
  final String? originalName;
  final int? sizeBytes;

  /// `pending` | `done` | `failed` | `unsupported`. Sent alongside the values
  /// so a report that could not be read says so, instead of looking like a
  /// report with nothing on it.
  final String? analysisStatus;
  final String? analysisSummary;

  /// Values the report itself marked out of range.
  final List<String> abnormal;

  bool get isReading => analysisStatus == 'pending';
  bool get couldNotRead =>
      analysisStatus == 'failed' || analysisStatus == 'unsupported';

  /// True when the report is something that can actually be shown as a picture.
  /// Unknown types are treated as documents: a file card that opens is a better
  /// wrong guess than an image box that cannot load.
  bool get isImage => mimeType?.startsWith('image/') ?? false;

  bool get hasFile => photoUrl != null && photoUrl!.isNotEmpty;

  factory LabResult.fromJson(Map<String, dynamic> j) => LabResult(
    id: j['id']?.toString() ?? '',
    testName: j['testName']?.toString() ?? '',
    note: j['note']?.toString() ?? '',
    photoUrl:
        (j['photoUrl'] == null || j['photoUrl'].toString().isEmpty)
            ? null
            : j['photoUrl'].toString(),
    createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal(),
    mimeType: j['mimeType']?.toString(),
    originalName: j['originalName']?.toString(),
    sizeBytes: (j['sizeBytes'] as num?)?.toInt(),
    analysisStatus:
        (j['analysis'] as Map<String, dynamic>?)?['status']?.toString(),
    analysisSummary:
        (j['analysis'] as Map<String, dynamic>?)?['summary']?.toString(),
    abnormal:
        ((j['analysis'] as Map<String, dynamic>?)?['abnormal'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        const [],
  );
}

/// The tests the doctor advised + the reports the patient has uploaded.
class LabTestsView {
  const LabTestsView({
    required this.advised,
    required this.results,
    this.reportedNames,
  });

  final List<String> advised;
  final List<LabResult> results;

  /// The advised tests the server says already have a report, verbatim as they
  /// appear in [advised].
  ///
  /// The decision belongs on the server: it is the same question the doctor's
  /// panel and the upload reminder answer, and three different answers to it
  /// is what had a patient nudged to upload a report they had already sent.
  /// Null when the server did not send the field at all — an older build.
  /// An *empty* set is a real answer ("none of them are reported yet") and
  /// must not be mistaken for silence.
  final Set<String>? reportedNames;

  /// True once a report has been uploaded for [test].
  bool hasResultFor(String test) {
    final fromServer = reportedNames;
    if (fromServer != null) return fromServer.contains(test);
    // An older server that does not send the per-test status yet. Exact match
    // is weak — it misses "Vitamin D" against a lab's "Vitamin D (25-Hydroxy)"
    // — but a wrong tick is worse than a missing one, so it stays strict.
    return results.any((r) => r.testName.toLowerCase() == test.toLowerCase());
  }

  factory LabTestsView.fromJson(Map<String, dynamic> j) => LabTestsView(
    advised:
        (j['advised'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    reportedNames:
        (j['advisedStatus'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .where((e) => e['reported'] == true)
            .map((e) => e['name'].toString())
            .toSet(),
    results:
        (j['results'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(LabResult.fromJson)
            .toList() ??
        const [],
  );
}
