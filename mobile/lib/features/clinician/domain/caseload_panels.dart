/// The caseload panels a general physician and a cardiologist open onto.
///
/// Mirrors `routes/panels.js`. Every number here is a count the server made
/// from records this practice may read — never a score it invented — and each
/// panel says how many patients it could not speak for, so an empty band reads
/// as "nobody measured" rather than "everybody is fine".
library;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
List<Map<String, dynamic>> _rows(Object? v) =>
    v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];

/// One patient a panel names, and why.
class PanelPatient {
  const PanelPatient({required this.id, required this.name, this.at, this.detail});

  final String id;

  /// Null when the server could not resolve a name — shown as "A patient".
  final String? name;
  final DateTime? at;

  /// The reading or date that put them here, already worded.
  final String? detail;
}

// ---------------------------------------------------------------------------

/// Blood pressure bands, in the order a clinician reads them.
enum BpBand {
  hypertensiveCrisis('hypertensive_crisis', 'Crisis'),
  stage2('stage2', 'Stage 2'),
  stage1('stage1', 'Stage 1'),
  elevated('elevated', 'Elevated'),
  normal('normal', 'Normal'),
  hypotension('hypotension', 'Low');

  const BpBand(this.api, this.label);
  final String api;
  final String label;

  static BpBand? fromApi(String? v) {
    for (final b in values) {
      if (b.api == v) return b;
    }
    return null;
  }
}

class BpControl {
  const BpControl({
    required this.days,
    required this.caseload,
    required this.withReading,
    required this.withoutReading,
    required this.bands,
    required this.attention,
    required this.attentionTotal,
  });

  final int days;
  final int caseload;
  final int withReading;
  final int withoutReading;
  final Map<BpBand, int> bands;
  final List<PanelPatient> attention;
  final int attentionTotal;

  factory BpControl.fromJson(Map<String, dynamic> j) {
    final raw = j['bands'] is Map ? j['bands'] as Map : const {};
    return BpControl(
      days: _int(j['days']),
      caseload: _int(j['caseload']),
      withReading: _int(j['withReading']),
      withoutReading: _int(j['withoutReading']),
      bands: {for (final b in BpBand.values) b: _int(raw[b.api])},
      attention: [
        for (final r in _rows(j['attention']))
          PanelPatient(
            id: '${r['patientId']}',
            name: r['name'] as String?,
            at: _date(r['recordedAt']),
            detail: '${r['systolic']}/${r['diastolic']} · ${BpBand.fromApi(r['band'] as String?)?.label ?? ''}',
          ),
      ],
      attentionTotal: _int(j['attentionTotal']),
    );
  }
}

// ---------------------------------------------------------------------------

class FollowUps {
  const FollowUps({
    required this.days,
    required this.overdue,
    required this.overdueTotal,
    required this.due,
    required this.dueTotal,
  });

  final int days;
  final List<PanelPatient> overdue;
  final int overdueTotal;
  final List<PanelPatient> due;
  final int dueTotal;

  static List<PanelPatient> _people(Object? v) => [
        for (final r in _rows(v))
          PanelPatient(
            id: '${r['patientId']}',
            name: r['name'] as String?,
            at: _date(r['followUpOn']),
            detail: r['doctorName'] as String?,
          ),
      ];

  factory FollowUps.fromJson(Map<String, dynamic> j) => FollowUps(
        days: _int(j['days']),
        overdue: _people(j['overdue']),
        overdueTotal: _int(j['overdueTotal']),
        due: _people(j['due']),
        dueTotal: _int(j['dueTotal']),
      );
}

// ---------------------------------------------------------------------------

class ConditionCount {
  const ConditionCount({required this.key, required this.name, required this.count});
  final String key;
  final String name;
  final int count;
}

class ConditionRegister {
  const ConditionRegister({
    required this.caseload,
    required this.conditions,
    required this.withoutCondition,
  });

  final int caseload;
  final List<ConditionCount> conditions;
  final int withoutCondition;

  factory ConditionRegister.fromJson(Map<String, dynamic> j) => ConditionRegister(
        caseload: _int(j['caseload']),
        conditions: [
          for (final r in _rows(j['conditions']))
            ConditionCount(key: '${r['key']}', name: '${r['name']}', count: _int(r['count'])),
        ],
        withoutCondition: _int(j['withoutCondition']),
      );
}

// ---------------------------------------------------------------------------

class HeartRateFlags {
  const HeartRateFlags({
    required this.days,
    required this.lowLimit,
    required this.highLimit,
    required this.withReading,
    required this.withoutReading,
    required this.low,
    required this.lowTotal,
    required this.high,
    required this.highTotal,
  });

  final int days;
  final int lowLimit;
  final int highLimit;
  final int withReading;
  final int withoutReading;
  final List<PanelPatient> low;
  final int lowTotal;
  final List<PanelPatient> high;
  final int highTotal;

  static List<PanelPatient> _people(Object? v) => [
        for (final r in _rows(v))
          PanelPatient(
            id: '${r['patientId']}',
            name: r['name'] as String?,
            at: _date(r['recordedAt']),
            detail: '${r['pulse']} bpm',
          ),
      ];

  factory HeartRateFlags.fromJson(Map<String, dynamic> j) {
    final limits = j['limits'] is Map ? j['limits'] as Map : const {};
    return HeartRateFlags(
      days: _int(j['days']),
      lowLimit: _int(limits['low']),
      highLimit: _int(limits['high']),
      withReading: _int(j['withReading']),
      withoutReading: _int(j['withoutReading']),
      low: _people(j['low']),
      lowTotal: _int(j['lowTotal']),
      high: _people(j['high']),
      highTotal: _int(j['highTotal']),
    );
  }
}
