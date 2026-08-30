/// Mirrors `GET /patients/:patientId/dashboard` exactly (API_CONTRACT.md §10).
class DashboardData {
  const DashboardData({
    required this.healthScore,
    required this.glucose,
    required this.adherence,
    required this.nextAppointment,
    required this.openAlerts,
    required this.recommendations,
    required this.reminders,
  });

  final HealthScore healthScore;
  final DashboardGlucose glucose;
  final DashboardAdherence adherence;
  final NextAppointment? nextAppointment;
  final List<DashboardAlert> openAlerts;
  final List<DashboardRecommendation> recommendations;
  final DashboardReminders reminders;

  factory DashboardData.fromJson(Map<String, dynamic> json) {
    return DashboardData(
      healthScore: HealthScore.fromJson(
        json['healthScore'] as Map<String, dynamic>? ?? const {},
      ),
      glucose: DashboardGlucose.fromJson(
        json['glucose'] as Map<String, dynamic>? ?? const {},
      ),
      adherence: DashboardAdherence.fromJson(
        json['adherence'] as Map<String, dynamic>? ?? const {},
      ),
      nextAppointment:
          json['nextAppointment'] == null
              ? null
              : NextAppointment.fromJson(
                json['nextAppointment'] as Map<String, dynamic>,
              ),
      openAlerts:
          (json['openAlerts'] as List<dynamic>? ?? const [])
              .map((e) => DashboardAlert.fromJson(e as Map<String, dynamic>))
              .toList(),
      recommendations:
          (json['recommendations'] as List<dynamic>? ?? const [])
              .map(
                (e) =>
                    DashboardRecommendation.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
      reminders: DashboardReminders.fromJson(
        json['reminders'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }
}

class HealthScore {
  const HealthScore({
    required this.score,
    required this.band,
    required this.confidence,
    required this.components,
  });

  final int score;
  final String band;
  final int confidence;
  final Map<String, HealthScoreComponent> components;

  factory HealthScore.fromJson(Map<String, dynamic> json) {
    final rawComponents =
        json['components'] as Map<String, dynamic>? ?? const {};
    return HealthScore(
      score: (json['score'] as num?)?.toInt() ?? 0,
      band: json['band']?.toString() ?? 'fair',
      confidence: (json['confidence'] as num?)?.toInt() ?? 0,
      components: rawComponents.map(
        (key, value) => MapEntry(
          key,
          HealthScoreComponent.fromJson(
            value as Map<String, dynamic>? ?? const {},
          ),
        ),
      ),
    );
  }
}

class HealthScoreComponent {
  const HealthScoreComponent({
    required this.value,
    required this.score,
    required this.hasData,
  });

  final num? value;
  final num? score;
  final bool hasData;

  factory HealthScoreComponent.fromJson(Map<String, dynamic> json) {
    return HealthScoreComponent(
      value: json['value'] as num?,
      score: json['score'] as num?,
      hasData: json['hasData'] as bool? ?? false,
    );
  }
}

class DashboardGlucose {
  const DashboardGlucose({
    required this.latest,
    required this.sevenDayAverage,
    required this.timeInRangePercent,
    required this.sparkline,
  });

  final GlucoseLatest? latest;
  final num? sevenDayAverage;
  final num? timeInRangePercent;
  final List<GlucoseSparklinePoint> sparkline;

  factory DashboardGlucose.fromJson(Map<String, dynamic> json) {
    return DashboardGlucose(
      latest:
          json['latest'] == null
              ? null
              : GlucoseLatest.fromJson(json['latest'] as Map<String, dynamic>),
      sevenDayAverage: json['sevenDayAverage'] as num?,
      timeInRangePercent: json['timeInRangePercent'] as num?,
      sparkline:
          (json['sparkline'] as List<dynamic>? ?? const [])
              .map(
                (e) =>
                    GlucoseSparklinePoint.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
    );
  }
}

class GlucoseLatest {
  const GlucoseLatest({
    required this.value,
    required this.context,
    required this.at,
    required this.flag,
  });

  final num value;
  final String context;
  final DateTime? at;
  final String flag;

  factory GlucoseLatest.fromJson(Map<String, dynamic> json) {
    return GlucoseLatest(
      value: json['value'] as num? ?? 0,
      context: json['context']?.toString() ?? '',
      at: json['at'] == null ? null : DateTime.tryParse(json['at'].toString()),
      flag: json['flag']?.toString() ?? 'in_range',
    );
  }
}

class GlucoseSparklinePoint {
  const GlucoseSparklinePoint({required this.at, required this.value});

  final DateTime? at;
  final num value;

  factory GlucoseSparklinePoint.fromJson(Map<String, dynamic> json) {
    return GlucoseSparklinePoint(
      at: json['at'] == null ? null : DateTime.tryParse(json['at'].toString()),
      value: json['value'] as num? ?? 0,
    );
  }
}

class DashboardAdherence {
  const DashboardAdherence({
    required this.percentage,
    required this.todayPending,
  });

  final num percentage;
  final int todayPending;

  factory DashboardAdherence.fromJson(Map<String, dynamic> json) {
    return DashboardAdherence(
      percentage: json['percentage'] as num? ?? 0,
      todayPending: (json['todayPending'] as num?)?.toInt() ?? 0,
    );
  }
}

class NextAppointment {
  const NextAppointment({
    required this.id,
    required this.scheduledFor,
    this.preferredFor,
    required this.mode,
    required this.status,
  });

  final String id;
  final DateTime? scheduledFor;

  /// The day asked for, on a request the clinic has not yet given a time to.
  /// Null on a real booking — the two are never both set.
  final DateTime? preferredFor;
  final String mode;
  final String status;

  factory NextAppointment.fromJson(Map<String, dynamic> json) {
    return NextAppointment(
      id: json['id']?.toString() ?? '',
      preferredFor:
          json['preferredFor'] == null
              ? null
              : DateTime.tryParse(json['preferredFor'].toString()),
      scheduledFor:
          json['scheduledFor'] == null
              ? null
              : DateTime.tryParse(json['scheduledFor'].toString()),
      mode: json['mode']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
    );
  }
}

class DashboardAlert {
  const DashboardAlert({
    required this.id,
    required this.severity,
    required this.type,
    required this.title,
    this.createdAt,
  });

  final String id;
  final String severity;
  final String type;
  final String title;
  final DateTime? createdAt;

  factory DashboardAlert.fromJson(Map<String, dynamic> json) {
    return DashboardAlert(
      id: json['id']?.toString() ?? '',
      severity: json['severity']?.toString() ?? 'routine',
      type: json['type']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      createdAt:
          json['createdAt'] == null
              ? null
              : DateTime.tryParse(json['createdAt'].toString()),
    );
  }
}

class DashboardRecommendation {
  const DashboardRecommendation({
    required this.code,
    required this.title,
    required this.body,
    required this.priority,
  });

  final String code;
  final String title;
  final String body;
  final String priority;

  factory DashboardRecommendation.fromJson(Map<String, dynamic> json) {
    return DashboardRecommendation(
      code: json['code']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      body: json['body']?.toString() ?? '',
      priority: json['priority']?.toString() ?? 'medium',
    );
  }
}

class DashboardReminders {
  const DashboardReminders({
    required this.footScreeningDue,
    required this.eyeScreeningDue,
    required this.hba1cDue,
  });

  final bool footScreeningDue;
  final bool eyeScreeningDue;
  final bool hba1cDue;

  factory DashboardReminders.fromJson(Map<String, dynamic> json) {
    return DashboardReminders(
      footScreeningDue: json['footScreeningDue'] as bool? ?? false,
      eyeScreeningDue: json['eyeScreeningDue'] as bool? ?? false,
      hba1cDue: json['hba1cDue'] as bool? ?? false,
    );
  }
}
