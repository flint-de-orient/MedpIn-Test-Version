import 'medication.dart';

/// What today's doses ask of the patient, worked out once and read by Home and
/// the Medicines tab alike, so the two can never disagree about whether a dose
/// is due, done or missed.
///
/// Pure: no widgets, no providers, and `now` is always passed in, which is what
/// lets the rules below be pinned by plain tests.

/// Where one of today's doses stands, from the patient's side of it.
enum DoseState {
  /// Recorded as taken, on time.
  taken,

  /// Recorded as taken, more than two hours after it was due — the server's
  /// judgement, carried on the slot as `late`.
  takenLate,

  /// The patient said they skipped it.
  skipped,

  /// The day moved past it with nothing recorded — the server's word.
  missed,

  /// Not recorded, and its time has come.
  due,

  /// Not recorded, and its time is still ahead.
  upcoming,
}

/// A dose is offered for recording from this long before its time.
///
/// Nobody takes an 8:30 PM tablet at exactly 8:30, and a patient holding the
/// strip at 8:10 should not have to hunt for a way to say so.
const Duration kDoseLogLead = Duration(minutes: 30);

/// The instant a slot is due: the server's own instant when it sent one, and
/// otherwise today's date at the slot's clock time. Null when neither exists.
DateTime? dueAt(MedicationScheduleSlot slot, DateTime now) {
  final server = slot.scheduledFor;
  if (server != null) return server.toLocal();
  final parts = slot.time.split(':');
  if (parts.length != 2) return null;
  final h = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (h == null || m == null || h > 23 || m > 59) return null;
  return DateTime(now.year, now.month, now.day, h, m);
}

DoseState doseStateOf(MedicationScheduleSlot slot, DateTime now) {
  switch (slot.status) {
    case 'taken':
      return slot.late ? DoseState.takenLate : DoseState.taken;
    case 'skipped':
      return DoseState.skipped;
    case 'missed':
      return DoseState.missed;
  }
  final due = dueAt(slot, now);
  if (due != null && !due.isAfter(now)) return DoseState.due;
  return DoseState.upcoming;
}

/// Today's doses, counted the way the patient would count them.
class TodayDoses {
  TodayDoses(List<MedicationScheduleSlot> slots, this.now)
    : slots = [...slots]
        ..sort((a, b) => _order(a, now).compareTo(_order(b, now)));

  /// In time order.
  final List<MedicationScheduleSlot> slots;
  final DateTime now;

  static DateTime _order(MedicationScheduleSlot s, DateTime now) =>
      dueAt(s, now) ?? DateTime(now.year, now.month, now.day, 23, 59);

  int get total => slots.length;
  bool get isEmpty => slots.isEmpty;

  int count(Set<DoseState> states) =>
      slots.where((s) => states.contains(doseStateOf(s, now))).length;

  /// Taken at all, late or not. A late dose still went down.
  int get taken => count({DoseState.taken, DoseState.takenLate});
  int get takenLate => count({DoseState.takenLate});
  int get missed => count({DoseState.missed});
  int get skipped => count({DoseState.skipped});

  /// Still to record, whether its time has come or not.
  int get open => count({DoseState.due, DoseState.upcoming});

  /// Every dose taken. Not the same as [finished]: a day with a missed dose is
  /// over, but it is not "all taken", and saying so would be the encouragement
  /// that teaches a patient to stop reading the screen.
  bool get allTaken => total > 0 && taken == total;

  /// Nothing left to record today.
  bool get finished => total > 0 && open == 0;

  /// The first dose still open — an overdue one first, because it comes first
  /// in time.
  MedicationScheduleSlot? get next {
    for (final s in slots) {
      final state = doseStateOf(s, now);
      if (state == DoseState.due || state == DoseState.upcoming) return s;
    }
    return null;
  }

  /// Whether [slot] should be offered for recording right now: its time has
  /// come, or comes within [kDoseLogLead].
  bool isLoggableNow(MedicationScheduleSlot slot) {
    final state = doseStateOf(slot, now);
    if (state == DoseState.due) return true;
    if (state != DoseState.upcoming) return false;
    final due = dueAt(slot, now);
    return due != null && !due.isAfter(now.add(kDoseLogLead));
  }
}
