/// What came back from the lab, across the practice.
///
/// ---- What this deliberately does not model ------------------------------
///
/// Not a sample queue. This platform has no sample model, no ordering workflow
/// and no bench states, so there is nothing here called "pending" or
/// "processing" — four counts with nothing behind them would render as a
/// laboratory with no work in it rather than as a feature nobody has built.
///
/// What exists is the report and the flags on its values, which is a real and
/// genuinely different screen from a caseload: results that came back
/// abnormal, rather than people who are in the building.
class LabOverview {
  const LabOverview({
    required this.days,
    required this.critical,
    required this.recent,
    required this.flags,
  });

  /// The window the counts describe.
  ///
  /// Carried so the screen can say "last 30 days" rather than implying an
  /// all-time figure. A total since the practice opened only ever grows and
  /// says nothing about now.
  final int days;

  /// Reports holding at least one value flagged critical.
  final List<LabReportSummary> critical;

  /// The most recent reports, newest first, critical or not.
  final List<LabReportSummary> recent;

  final LabFlagCounts flags;

  static const empty = LabOverview(
    days: 30,
    critical: <LabReportSummary>[],
    recent: <LabReportSummary>[],
    flags: LabFlagCounts.zero,
  );

  factory LabOverview.fromJson(Map<String, dynamic> json) {
    List<LabReportSummary> read(String key) =>
        ((json[key] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(LabReportSummary.fromJson)
            .toList(growable: false);

    return LabOverview(
      days: (json['days'] as num?)?.toInt() ?? 30,
      critical: read('critical'),
      recent: read('recent'),
      flags: LabFlagCounts.fromJson(json['flags'] as Map<String, dynamic>?),
    );
  }
}

/// How many values came back at each flag, over the window.
class LabFlagCounts {
  const LabFlagCounts({
    required this.critical,
    required this.high,
    required this.low,
    required this.normal,
    required this.unflagged,
  });

  final int critical;
  final int high;
  final int low;
  final int normal;

  /// Values a report carried with no flag at all.
  ///
  /// Kept apart from [normal] rather than folded into it: an unflagged value
  /// has not been judged, and counting it as normal is the app deciding that
  /// it was.
  final int unflagged;

  static const zero = LabFlagCounts(
    critical: 0,
    high: 0,
    low: 0,
    normal: 0,
    unflagged: 0,
  );

  /// Everything the window holds, including what has not been judged.
  int get total => critical + high + low + normal + unflagged;

  /// The values that say something is wrong.
  int get abnormal => critical + high + low;

  factory LabFlagCounts.fromJson(Map<String, dynamic>? json) {
    int at(String key) => (json?[key] as num?)?.toInt() ?? 0;
    return LabFlagCounts(
      critical: at('critical'),
      high: at('high'),
      low: at('low'),
      normal: at('normal'),
      unflagged: at('unflagged'),
    );
  }
}

/// One report, and only the values that earned it a place on the screen.
class LabReportSummary {
  const LabReportSummary({
    required this.id,
    required this.title,
    required this.labName,
    required this.testedOn,
    required this.patientId,
    required this.patientName,
    required this.worstFlag,
    required this.abnormal,
  });

  final String id;
  final String title;
  final String? labName;
  final DateTime? testedOn;
  final String? patientId;
  final String? patientName;

  /// `critical`, `abnormal`, or `normal` — what makes this report worth
  /// surfacing at all.
  final String worstFlag;

  /// Only the values that are not normal. The server filters them, because a
  /// panel of forty normal results is a list nobody reads with the one
  /// abnormal value somewhere in the middle.
  final List<LabValue> abnormal;

  bool get isCritical => worstFlag == 'critical';

  factory LabReportSummary.fromJson(Map<String, dynamic> json) {
    final patient = json['patient'] as Map<String, dynamic>?;
    return LabReportSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      labName: json['labName'] as String?,
      testedOn: DateTime.tryParse(json['testedOn'] as String? ?? '')?.toLocal(),
      patientId: patient?['id'] as String?,
      patientName: patient?['name'] as String?,
      worstFlag: json['worstFlag'] as String? ?? 'normal',
      abnormal: ((json['abnormal'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LabValue.fromJson)
          .toList(growable: false),
    );
  }
}

/// One measured value on a report.
class LabValue {
  const LabValue({
    required this.label,
    required this.value,
    required this.textValue,
    required this.unit,
    required this.flag,
  });

  final String? label;
  final double? value;

  /// For results that are words rather than numbers — "Reactive", "Not
  /// detected". A lab report is not all arithmetic and a model that assumed so
  /// would drop half a serology panel.
  final String? textValue;
  final String? unit;
  final String flag;

  /// What to show, whichever kind of result this is.
  ///
  /// Null when the report carried neither, which is a row that says only that
  /// something was flagged — worth showing, because the flag is the part that
  /// matters, and the reader can open the report for the rest.
  String? get reading {
    if (textValue != null && textValue!.isNotEmpty) return textValue;
    if (value == null) return null;
    final n = value! % 1 == 0 ? value!.toStringAsFixed(0) : value!.toString();
    return unit == null || unit!.isEmpty ? n : '$n $unit';
  }

  factory LabValue.fromJson(Map<String, dynamic> json) {
    return LabValue(
      label: json['label'] as String?,
      value: (json['value'] as num?)?.toDouble(),
      textValue: json['textValue'] as String?,
      unit: json['unit'] as String?,
      flag: json['flag'] as String? ?? 'normal',
    );
  }
}
