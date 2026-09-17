/// A recurring weekly availability window, e.g. Monday 10:00–14:00.
class WeeklyHour {
  const WeeklyHour({
    required this.dayOfWeek,
    required this.start,
    required this.end,
  });

  /// 0 = Sunday … 6 = Saturday (matches the backend and Dart's DateTime.weekday
  /// modulo 7).
  final int dayOfWeek;
  final String start; // 'HH:mm'
  final String end; // 'HH:mm'

  factory WeeklyHour.fromJson(Map<String, dynamic> j) => WeeklyHour(
    dayOfWeek: (j['dayOfWeek'] as num?)?.toInt() ?? 0,
    start: j['start']?.toString() ?? '00:00',
    end: j['end']?.toString() ?? '00:00',
  );

  Map<String, dynamic> toJson() => {
    'dayOfWeek': dayOfWeek,
    'start': start,
    'end': end,
  };
}

/// A date-specific exception to the weekly pattern — a holiday closure or
/// special one-off hours.
class ClinicOverride {
  const ClinicOverride({
    required this.date,
    required this.isClosed,
    this.windows = const [],
    this.note,
  });

  final String date; // 'YYYY-MM-DD'
  final bool isClosed;
  final List<({String start, String end})> windows;
  final String? note;

  factory ClinicOverride.fromJson(Map<String, dynamic> j) => ClinicOverride(
    date: j['date']?.toString() ?? '',
    isClosed: j['isClosed'] == true,
    windows:
        (j['windows'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(
              (w) => (
                start: w['start']?.toString() ?? '',
                end: w['end']?.toString() ?? '',
              ),
            )
            .toList() ??
        const [],
    note: j['note']?.toString(),
  );

  Map<String, dynamic> toJson() => {
    'date': date,
    'isClosed': isClosed,
    'windows': [
      for (final w in windows) {'start': w.start, 'end': w.end},
    ],
    if (note != null) 'note': note,
  };
}

/// A physical location where the doctor consults, with its schedule.
class Clinic {
  const Clinic({
    required this.id,
    required this.name,
    this.addressLine,
    this.city,
    this.phone,
    this.altPhone,
    this.mapUrl,
    this.tagline,
    this.doctorDisplayName,
    this.registrationNo,
    this.logoLightUrl,
    this.logoDarkUrl,
    this.logoNeedsDarkChip = false,
    this.slotMinutes = 15,
    this.weeklyHours = const [],
    this.overrides = const [],
    this.isActive = true,
    this.sortIndex = 0,
    this.managedByYou,
  });

  final String id;
  final String name;
  final String? addressLine;
  final String? city;
  final String? phone;

  /// A second line patients can ring. A clinic usually publishes more than one,
  /// and somebody who cannot get through on the first should not have to hunt.
  final String? altPhone;
  final String? mapUrl;

  // ---- Brand ---------------------------------------------------------------
  //
  // What a patient meets: on the chat header, on the prescription letterhead,
  // in an appointment confirmation. MedPin is the product; this is the clinic.

  /// The line under the name — "Diabetes Obesity & Metabolic Clinic".
  final String? tagline;

  /// The doctor's name as it should be printed, which is not always the name on
  /// their account.
  final String? doctorDisplayName;

  /// Printed under the signature on a prescription.
  final String? registrationNo;

  /// Two logos, never one inverted into the other.
  ///
  /// Inversion is a per-channel complement, so this clinic's teal comes back a
  /// muddy orange — and colour is the part of a logo that carries the brand.
  /// The app is light-only, so [logoLightUrl] is what it draws.
  final String? logoLightUrl;
  final String? logoDarkUrl;

  /// The only artwork supplied was drawn for a dark background.
  ///
  /// Measured on upload from the mean luminance of the non-transparent pixels.
  /// When true the app paints the mark on a dark chip rather than inverting it:
  /// brand colours survive and it stays legible on a white card.
  final bool logoNeedsDarkChip;
  final int slotMinutes;
  final List<WeeklyHour> weeklyHours;
  final List<ClinicOverride> overrides;
  final bool isActive;
  final int sortIndex;

  /// Whether the reader runs this location: may book, confirm, move and edit
  /// here. The server says so for staff and leaves it out for a patient, so
  /// null is "not a question for this reader", never "no".
  final bool? managedByYou;

  /// Open, and somewhere this reader may put an appointment.
  bool get takesWorkFromYou => isActive && managedByYou != false;

  /// Every number the clinic publishes, in the order it publishes them.
  List<String> get phones => [
    if (phone != null && phone!.isNotEmpty) phone!,
    if (altPhone != null && altPhone!.isNotEmpty) altPhone!,
  ];

  /// "DD-24, Salt Lake City · Kolkata" — a one-line location summary.
  String get locationLine {
    final parts = [
      if (addressLine != null && addressLine!.isNotEmpty) addressLine,
      if (city != null && city!.isNotEmpty) city,
    ];
    return parts.join(' · ');
  }

  factory Clinic.fromJson(Map<String, dynamic> j) => Clinic(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    addressLine: j['addressLine']?.toString(),
    city: j['city']?.toString(),
    phone: j['phone']?.toString(),
    altPhone: j['altPhone']?.toString(),
    mapUrl: j['mapUrl']?.toString(),
    tagline: j['tagline']?.toString(),
    doctorDisplayName: j['doctorDisplayName']?.toString(),
    registrationNo: j['registrationNo']?.toString(),
    logoLightUrl: j['logoLightUrl']?.toString(),
    logoDarkUrl: j['logoDarkUrl']?.toString(),
    logoNeedsDarkChip: j['logoNeedsDarkChip'] == true,
    slotMinutes: (j['slotMinutes'] as num?)?.toInt() ?? 15,
    weeklyHours:
        (j['weeklyHours'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(WeeklyHour.fromJson)
            .toList() ??
        const [],
    overrides:
        (j['overrides'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(ClinicOverride.fromJson)
            .toList() ??
        const [],
    isActive: j['isActive'] != false,
    sortIndex: (j['sortIndex'] as num?)?.toInt() ?? 0,
    managedByYou: j['managedByYou'] is bool ? j['managedByYou'] as bool : null,
  );
}

/// How many places an appointment could be put, which decides what to ask.
///
/// Location is optional. With none there is nothing to choose and no published
/// hours — the time is the doctor's to give. With one there is nothing to
/// choose either, so no picker is drawn. Only two or more is a question.
enum LocationChoice { none, one, several }

/// The locations this reader may put an appointment at, and what that means
/// for the screen. Counted among the ones they run, so a receptionist who runs
/// one branch of two is not asked which.
({List<Clinic> open, LocationChoice choice}) locationChoice(
  List<Clinic> all,
) {
  final open = all.where((c) => c.takesWorkFromYou).toList();
  return (
    open: open,
    choice: switch (open.length) {
      0 => LocationChoice.none,
      1 => LocationChoice.one,
      _ => LocationChoice.several,
    },
  );
}

/// One bookable slot returned by `GET /clinics/:id/slots`.
class Slot {
  const Slot({required this.time, required this.iso, required this.available});

  final String time; // 'HH:mm' clinic-local
  final String iso; // absolute ISO instant to send back when booking
  final bool available;

  factory Slot.fromJson(Map<String, dynamic> j) => Slot(
    time: j['time']?.toString() ?? '',
    iso: j['iso']?.toString() ?? '',
    available: j['available'] == true,
  );
}

/// The slot listing for a clinic on one date.
class SlotDay {
  const SlotDay({
    required this.clinicId,
    required this.date,
    required this.slotMinutes,
    required this.slots,
    this.isActive = true,
  });

  final String clinicId;
  final String date;
  final int slotMinutes;
  final List<Slot> slots;

  /// False for a closed location, whose empty list means closed rather than
  /// fully booked. Older servers do not send it, and read as open.
  final bool isActive;

  bool get hasAvailability => slots.any((s) => s.available);

  factory SlotDay.fromJson(Map<String, dynamic> j) => SlotDay(
    clinicId: j['clinicId']?.toString() ?? '',
    date: j['date']?.toString() ?? '',
    isActive: j['isActive'] != false,
    slotMinutes: (j['slotMinutes'] as num?)?.toInt() ?? 15,
    slots:
        (j['slots'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(Slot.fromJson)
            .toList() ??
        const [],
  );
}
