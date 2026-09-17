/// The caseload panels a general physician, a cardiologist and a diabetologist
/// open onto.
///
/// Mirrors `routes/panels.js`. Every number here is a count the server made
/// from records this practice may read — never a score it invented — and each
/// panel says how many patients it could not speak for, so an empty band reads
/// as "nobody measured" rather than "everybody is fine".
library;

import 'ecg_report.dart';

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
num? _num(Object? v) => v is num ? v : null;
List<Map<String, dynamic>> _rows(Object? v) =>
    v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];

/// One patient a panel names, and why.
class PanelPatient {
  const PanelPatient({
    required this.id,
    required this.name,
    this.at,
    this.detail,
    this.flag,
  });

  final String id;

  /// Null when the server could not resolve a name — shown as "A patient".
  final String? name;
  final DateTime? at;

  /// The reading or date that put them here, already worded.
  final String? detail;

  /// The band or impression the server put them in, as its API key —
  /// `hypertensive_crisis`, `abnormal` — so the panel can say it as a word
  /// beside the reading rather than folded into the same grey line.
  final String? flag;
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
            detail: '${r['systolic']}/${r['diastolic']} mmHg',
            flag: r['band'] as String?,
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

// ---------------------------------------------------------------------------

/// A patient whose latest ECG was read as abnormal or borderline.
class FlaggedEcg {
  const FlaggedEcg({required this.patient, required this.impression});
  final PanelPatient patient;
  final EcgImpression impression;
}

class EcgPanel {
  const EcgPanel({
    required this.days,
    required this.withEcg,
    required this.withoutEcg,
    required this.impressions,
    required this.flagged,
    required this.flaggedTotal,
  });

  final int days;
  final int withEcg;
  final int withoutEcg;
  final Map<EcgImpression, int> impressions;
  final List<FlaggedEcg> flagged;
  final int flaggedTotal;

  factory EcgPanel.fromJson(Map<String, dynamic> j) {
    final raw = j['impressions'] is Map ? j['impressions'] as Map : const {};
    return EcgPanel(
      days: _int(j['days']),
      withEcg: _int(j['withEcg']),
      withoutEcg: _int(j['withoutEcg']),
      impressions: {for (final i in EcgImpression.values) i: _int(raw[i.api])},
      flagged: [
        for (final r in _rows(j['flagged']))
          FlaggedEcg(
            impression: EcgImpression.fromApi(r['impression']),
            patient: PanelPatient(
              id: '${r['patientId']}',
              name: r['name'] as String?,
              at: _date(r['recordedOn']),
              detail: [
                ecgRhythmLabel(r['rhythm']),
                if (r['heartRate'] is num) '${(r['heartRate'] as num).round()} bpm',
              ].join(' · '),
              flag: r['impression'] as String?,
            ),
          ),
      ],
      flaggedTotal: _int(j['flaggedTotal']),
    );
  }
}

// ---------------------------------------------------------------------------

/// A lab value as a clinician writes it: whole numbers without a decimal point.
String labValue(num v) => v == v.roundToDouble() ? '${v.round()}' : v.toStringAsFixed(1);

// ---------------------------------------------------------------------------

/// One patient's lows, or one patient's very highs, over the window.
class GlucoseExcursion {
  const GlucoseExcursion({
    required this.patient,
    required this.count,
    required this.serious,
    required this.extreme,
  });

  final PanelPatient patient;

  /// How many readings in the window crossed the line.
  final int count;

  /// How many crossed the second line: below 54, or above 400.
  final int serious;

  /// The lowest low, or the highest high, in mg/dL.
  final num extreme;
}

/// Lows and very highs across the caseload, from `GET /doctor/panels/glucose`.
class GlucoseFlags {
  const GlucoseFlags({
    required this.days,
    required this.low,
    required this.severeLow,
    required this.veryHigh,
    required this.criticalHigh,
    required this.rangeLow,
    required this.rangeHigh,
    required this.caseload,
    required this.withReadings,
    required this.withoutReadings,
    required this.readings,
    required this.inRange,
    required this.lows,
    required this.lowsTotal,
    required this.highs,
    required this.highsTotal,
  });

  final int days;

  /// The triage engine's own lines, sent by the server so no number here is
  /// written twice: below [low] is a low, below [severeLow] a severe one, above
  /// [veryHigh] very high and above [criticalHigh] critical.
  final int low;
  final int severeLow;
  final int veryHigh;
  final int criticalHigh;

  /// The band the practice's glucose chart calls "in range".
  final int rangeLow;
  final int rangeHigh;

  final int caseload;
  final int withReadings;
  final int withoutReadings;
  final int readings;
  final int inRange;
  final List<GlucoseExcursion> lows;
  final int lowsTotal;
  final List<GlucoseExcursion> highs;
  final int highsTotal;

  /// The share of readings in range, rounded — or null when there were none.
  ///
  /// Null, not zero. "0% in range" for a fortnight nobody logged a sugar is a
  /// statement about control that nothing measured.
  int? get inRangePercent => readings == 0 ? null : (inRange * 100 / readings).round();

  static List<GlucoseExcursion> _excursions(Object? v, {required String serious, required String extreme}) => [
        for (final r in _rows(v))
          GlucoseExcursion(
            patient: PanelPatient(
              id: '${r['patientId']}',
              name: r['name'] as String?,
              at: _date(r['lastAt']),
            ),
            count: _int(r['count']),
            serious: _int(r[serious]),
            extreme: _num(r[extreme]) ?? 0,
          ),
      ];

  factory GlucoseFlags.fromJson(Map<String, dynamic> j) {
    final t = j['thresholds'] is Map ? j['thresholds'] as Map : const {};
    int limit(String key, int fallback) => t[key] is num ? (t[key] as num).toInt() : fallback;
    return GlucoseFlags(
      days: _int(j['days']),
      low: limit('low', 70),
      severeLow: limit('severeLow', 54),
      veryHigh: limit('veryHigh', 250),
      criticalHigh: limit('criticalHigh', 400),
      rangeLow: limit('rangeLow', 70),
      rangeHigh: limit('rangeHigh', 180),
      caseload: _int(j['caseload']),
      withReadings: _int(j['withReadings']),
      withoutReadings: _int(j['withoutReadings']),
      readings: _int(j['readings']),
      inRange: _int(j['inRange']),
      lows: _excursions(j['lows'], serious: 'severe', extreme: 'lowest'),
      lowsTotal: _int(j['lowsTotal']),
      highs: _excursions(j['highs'], serious: 'critical', extreme: 'highest'),
      highsTotal: _int(j['highsTotal']),
    );
  }
}

// ---------------------------------------------------------------------------

/// A patient whose latest HbA1c is above their own target.
class Hba1cAbove {
  const Hba1cAbove({
    required this.patient,
    required this.percentage,
    required this.target,
    required this.poorControl,
  });

  final PanelPatient patient;
  final num percentage;

  /// Their target, which is not always the practice's default.
  final num target;

  /// At or above the poor-control line, whatever their target.
  final bool poorControl;
}

/// A patient with no HbA1c in the window, and the last one this practice may
/// read if there is one.
class Hba1cUntested {
  const Hba1cUntested({required this.patient, this.lastTestedOn, this.lastPercentage});

  final PanelPatient patient;
  final DateTime? lastTestedOn;
  final num? lastPercentage;
}

/// HbA1c control across the caseload, from `GET /doctor/panels/hba1c`.
class Hba1cControl {
  const Hba1cControl({
    required this.days,
    required this.defaultTarget,
    required this.poorControlLine,
    required this.caseload,
    required this.withResult,
    required this.atTarget,
    required this.aboveTarget,
    required this.poorControl,
    required this.above,
    required this.aboveTotal,
    required this.untested,
    required this.untestedTotal,
  });

  final int days;
  final num defaultTarget;
  final num poorControlLine;
  final int caseload;
  final int withResult;
  final int atTarget;

  /// Above their target and below the poor-control line.
  final int aboveTarget;
  final int poorControl;
  final List<Hba1cAbove> above;
  final int aboveTotal;
  final List<Hba1cUntested> untested;
  final int untestedTotal;

  factory Hba1cControl.fromJson(Map<String, dynamic> j) {
    final target = j['target'] is Map ? j['target'] as Map : const {};
    final fallback = _num(target['default']) ?? 7;
    return Hba1cControl(
      days: _int(j['days']),
      defaultTarget: fallback,
      poorControlLine: _num(target['poorControl']) ?? 9,
      caseload: _int(j['caseload']),
      withResult: _int(j['withResult']),
      atTarget: _int(j['atTarget']),
      aboveTarget: _int(j['aboveTarget']),
      poorControl: _int(j['poorControl']),
      above: [
        for (final r in _rows(j['above']))
          Hba1cAbove(
            patient: PanelPatient(
              id: '${r['patientId']}',
              name: r['name'] as String?,
              at: _date(r['testedOn']),
            ),
            percentage: _num(r['percentage']) ?? 0,
            target: _num(r['target']) ?? fallback,
            poorControl: r['poorControl'] == true,
          ),
      ],
      aboveTotal: _int(j['aboveTotal']),
      untested: [
        for (final r in _rows(j['untested']))
          Hba1cUntested(
            patient: PanelPatient(id: '${r['patientId']}', name: r['name'] as String?),
            lastTestedOn: _date(r['lastTestedOn']),
            lastPercentage: _num(r['lastPercentage']),
          ),
      ],
      untestedTotal: _int(j['untestedTotal']),
    );
  }
}

class LipidControl {
  const LipidControl({
    required this.days,
    required this.unit,
    required this.high,
    required this.withResult,
    required this.withoutResult,
    required this.atOrBelow,
    required this.above,
    required this.aboveTotal,
  });

  final int days;
  final String? unit;

  /// The catalog's upper limit for LDL. Null only if the server did not say,
  /// and then the card names no number rather than inventing one.
  final num? high;
  final int withResult;
  final int withoutResult;
  final int atOrBelow;
  final List<PanelPatient> above;
  final int aboveTotal;

  /// "100 mg/dL", or "target" when the server did not send one.
  String get limit => high == null ? 'target' : [labValue(high!), if (unit != null) unit].join(' ');

  factory LipidControl.fromJson(Map<String, dynamic> j) {
    final target = j['target'] is Map ? j['target'] as Map : const {};
    final unit = target['unit'] as String?;
    return LipidControl(
      days: _int(j['days']),
      unit: unit,
      high: target['high'] is num ? target['high'] as num : null,
      withResult: _int(j['withResult']),
      withoutResult: _int(j['withoutResult']),
      atOrBelow: _int(j['atOrBelow']),
      above: [
        for (final r in _rows(j['above']))
          PanelPatient(
            id: '${r['patientId']}',
            name: r['name'] as String?,
            at: _date(r['testedOn']),
            detail: r['ldl'] is num
                ? ['LDL ${labValue(r['ldl'] as num)}', if (unit != null) unit].join(' ')
                : null,
          ),
      ],
      aboveTotal: _int(j['aboveTotal']),
    );
  }
}
