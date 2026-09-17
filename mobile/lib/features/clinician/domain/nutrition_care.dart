/// Who looks after a patient's nutrition at the practice the doctor is working
/// in — as the server records it on that practice's enrolment.
///
/// ---- Why it is not a name and an id any more ------------------------------
///
/// The dietician used to be one field on the patient's profile, read here as
/// `assignedDieticianId` and `assignedDieticianName`. A patient two practices
/// care for could be held by one practice's dietician at a time, and a
/// dietician who had left still showed as the person looking after them.
///
/// So the server now sends the relationship: who holds it, whether they still
/// work here, whether anybody has decided at all, and who held it before.
/// Every one of those changes what the doctor should be told, and a name alone
/// could say none of them.
class NutritionCare {
  const NutritionCare({
    this.dietician,
    this.decided = false,
    this.source,
    this.since,
    this.decidedBy,
    this.activeDieticians = 0,
    this.history = const [],
    this.mayChange = false,
  });

  /// Who holds the patient here, or null for nobody.
  final CareDietician? dietician;

  /// Whether anybody has decided for this relationship. No dietician and
  /// `decided` means somebody deliberately left the patient without one.
  final bool decided;

  /// `auto` (the practice's only dietician, by default), `doctor`, or
  /// `migration` (carried over from before assignments were per practice).
  final String? source;
  final DateTime? since;

  /// The doctor who decided, when one did.
  final String? decidedBy;

  /// How many dieticians work here now — the choices the doctor has.
  final int activeDieticians;

  /// Everyone who held the patient here before, newest first.
  final List<CarePeriod> history;

  /// Whether this reader may change it. Told by the server so the screen never
  /// offers a button the server would refuse.
  final bool mayChange;

  /// Held by somebody who no longer works here.
  bool get heldByInactive => dietician != null && !dietician!.active;

  factory NutritionCare.fromJson(Map<String, dynamic> j) {
    final d = j['dietician'];
    return NutritionCare(
      dietician: d is Map<String, dynamic> ? CareDietician.fromJson(d) : null,
      decided: j['decided'] == true,
      source: j['source']?.toString(),
      since: DateTime.tryParse(j['since']?.toString() ?? ''),
      decidedBy: _name(j['decidedBy']),
      activeDieticians: (j['activeDieticians'] as num?)?.toInt() ?? 0,
      history:
          (j['history'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(CarePeriod.fromJson)
              .toList() ??
          const [],
      mayChange: j['mayChange'] == true,
    );
  }
}

class CareDietician {
  const CareDietician({required this.id, this.name, this.active = true});

  final String id;
  final String? name;

  /// Still works at this practice. False keeps the name on the record and
  /// means nobody is looking after the patient now.
  final bool active;

  factory CareDietician.fromJson(Map<String, dynamic> j) => CareDietician(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString(),
    active: j['active'] != false,
  );
}

/// One earlier period: who held the patient, from when, until when, and who
/// ended it.
class CarePeriod {
  const CarePeriod({
    this.dieticianName,
    this.source,
    this.since,
    this.until,
    this.endedBy,
  });

  /// Null for a period in which nobody held the patient.
  final String? dieticianName;
  final String? source;
  final DateTime? since;
  final DateTime? until;
  final String? endedBy;

  factory CarePeriod.fromJson(Map<String, dynamic> j) => CarePeriod(
    dieticianName: _name(j['dietician']),
    source: j['source']?.toString(),
    since: DateTime.tryParse(j['since']?.toString() ?? ''),
    until: DateTime.tryParse(j['until']?.toString() ?? ''),
    endedBy: _name(j['endedBy']),
  );
}

String? _name(Object? raw) =>
    raw is Map<String, dynamic> ? raw['name']?.toString() : null;
