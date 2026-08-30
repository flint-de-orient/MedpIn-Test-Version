import 'clinic.dart';

/// Whether the clinic is open right now, and when that changes.
///
/// The front desk's header says "Open · Closes 8:00 PM", and that has to be
/// true — a receptionist reads it before telling a patient on the phone whether
/// to come in. So it is derived from the clinic's own schedule rather than
/// typed into a setting that would drift the first time the doctor changed a
/// Saturday.
///
/// [closesAt] is set only while open, [opensAt] only while closed and only when
/// there is still a window later the same day. Both null on a day the clinic
/// does not open at all, which the header says plainly rather than implying a
/// time that never comes.
typedef ClinicStatus = ({bool open, DateTime? closesAt, DateTime? opensAt});

/// Minutes past midnight for an 'HH:mm' string, or null if it is not one.
int? _minutes(String hhmm) {
  final parts = hhmm.split(':');
  if (parts.length != 2) return null;
  final h = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (h == null || m == null) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

String _isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

/// Today's opening windows, overrides taking precedence over the weekly rota.
///
/// An override exists exactly so a clinic can shut for Durga Puja or open late
/// for one Sunday, so when there is one for today it replaces the rota entirely
/// rather than adding to it.
List<({int start, int end})> _windowsFor(Clinic clinic, DateTime day) {
  final today = _isoDate(day);
  for (final o in clinic.overrides) {
    if (o.date != today) continue;
    if (o.isClosed) return const [];
    return [
      for (final w in o.windows)
        if (_minutes(w.start) case final s?)
          if (_minutes(w.end) case final e?)
            if (e > s) (start: s, end: e),
    ]..sort((a, b) => a.start.compareTo(b.start));
  }

  // Clinic.weeklyHours uses 0 = Sunday; DateTime.weekday uses 7 = Sunday.
  final dow = day.weekday % 7;
  return [
    for (final w in clinic.weeklyHours)
      if (w.dayOfWeek == dow)
        if (_minutes(w.start) case final s?)
          if (_minutes(w.end) case final e?)
            if (e > s) (start: s, end: e),
  ]..sort((a, b) => a.start.compareTo(b.start));
}

ClinicStatus clinicStatusAt(Clinic clinic, DateTime now) {
  final windows = _windowsFor(clinic, now);
  if (windows.isEmpty) return (open: false, closesAt: null, opensAt: null);

  final minutesNow = now.hour * 60 + now.minute;
  DateTime at(int minutes) =>
      DateTime(now.year, now.month, now.day).add(Duration(minutes: minutes));

  for (final w in windows) {
    if (minutesNow >= w.start && minutesNow < w.end) {
      return (open: true, closesAt: at(w.end), opensAt: null);
    }
  }

  // Shut for now. If a later window starts today — a clinic that breaks for
  // lunch, or an evening surgery — say when, because "Closed" alone sends the
  // desk hunting for the rota to answer a question on the phone.
  for (final w in windows) {
    if (w.start > minutesNow) {
      return (open: false, closesAt: null, opensAt: at(w.start));
    }
  }
  return (open: false, closesAt: null, opensAt: null);
}
