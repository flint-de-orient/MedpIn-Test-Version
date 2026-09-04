import 'package:flutter/foundation.dart';

/// One thing the practice has not filled in, and what it costs.
///
/// [prints] is the point of this class. "Registration number: missing" is a
/// form validation message; "prints under the signature, where the council
/// number must appear" tells a doctor why they should stop and fix it. The
/// server supplies the sentence because the rule is clinical, not visual.
@immutable
class PracticeGap {
  const PracticeGap({
    required this.key,
    required this.label,
    required this.prints,
    required this.blocking,
  });

  final String key;
  final String label;
  final String prints;

  /// True when a prescription is not a valid document without it.
  final bool blocking;

  factory PracticeGap.fromJson(Map<String, dynamic> json) => PracticeGap(
    key: json['key'] as String? ?? '',
    label: json['label'] as String? ?? '',
    prints: json['prints'] as String? ?? '',
    blocking: json['blocking'] as bool? ?? false,
  );
}

/// One place the practice sees patients.
@immutable
class PracticeLocation {
  const PracticeLocation({
    required this.id,
    required this.name,
    required this.city,
    required this.isActive,
    required this.overridesBrand,
    required this.weeklyHourCount,
  });

  final String id;
  final String name;
  final String? city;
  final bool isActive;

  /// This location prints its own name or logo rather than the practice's.
  /// Surfaced so a doctor can tell why two branches look different.
  final bool overridesBrand;

  final int weeklyHourCount;

  factory PracticeLocation.fromJson(Map<String, dynamic> json) => PracticeLocation(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    city: json['city'] as String?,
    isActive: json['isActive'] as bool? ?? true,
    overridesBrand: json['overridesBrand'] as bool? ?? false,
    weeklyHourCount: (json['weeklyHourCount'] as num?)?.toInt() ?? 0,
  );
}

/// The practice, its readiness, its places and its people.
@immutable
class PracticeOverview {
  const PracticeOverview({
    required this.id,
    required this.name,
    required this.tagline,
    required this.doctorDisplayName,
    required this.registrationNo,
    required this.logoLightUrl,
    required this.verification,
    required this.gaps,
    required this.canPrintPrescription,
    required this.locations,
    required this.doctors,
    required this.staff,
    required this.dieticians,
  });

  final String id;
  final String name;
  final String? tagline;
  final String? doctorDisplayName;
  final String? registrationNo;
  final String? logoLightUrl;
  final String verification;

  final List<PracticeGap> gaps;
  final bool canPrintPrescription;
  final List<PracticeLocation> locations;
  final int doctors;
  final int staff;
  final int dieticians;

  bool get isComplete => gaps.isEmpty;

  /// The gaps that stop a prescription being valid, worst first.
  List<PracticeGap> get blockingGaps => gaps.where((g) => g.blocking).toList();
  List<PracticeGap> get minorGaps => gaps.where((g) => !g.blocking).toList();

  factory PracticeOverview.fromJson(Map<String, dynamic> json) {
    final p = json['practice'] as Map<String, dynamic>? ?? const {};
    final r = json['readiness'] as Map<String, dynamic>? ?? const {};
    final people = json['people'] as Map<String, dynamic>? ?? const {};

    return PracticeOverview(
      id: p['id'] as String? ?? '',
      name: p['name'] as String? ?? '',
      tagline: p['tagline'] as String?,
      doctorDisplayName: p['doctorDisplayName'] as String?,
      registrationNo: p['registrationNo'] as String?,
      logoLightUrl: p['logoLightUrl'] as String?,
      verification: p['verification'] as String? ?? 'unverified',
      gaps:
          (r['missing'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(PracticeGap.fromJson)
              .toList(),
      canPrintPrescription: r['canPrintPrescription'] as bool? ?? true,
      locations:
          (json['locations'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(PracticeLocation.fromJson)
              .toList(),
      doctors: (people['doctors'] as num?)?.toInt() ?? 0,
      staff: (people['staff'] as num?)?.toInt() ?? 0,
      dieticians: (people['dieticians'] as num?)?.toInt() ?? 0,
    );
  }
}
