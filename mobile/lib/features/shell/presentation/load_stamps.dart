/// When each patient data set last arrived from the server.
///
/// A refresh that fails keeps what was already on screen — dropping a list of
/// medicines to an error because a poll missed is how a patient is told they
/// have none. But data kept after a failure has to say how old it is, or it
/// claims a freshness it does not have. This is where that age comes from.
///
/// Stamped by the providers themselves, after a fetch succeeds, so the time is
/// the time the data really arrived — not the time a screen happened to look.
abstract final class LoadStamps {
  static final Map<String, DateTime> _at = {};

  static void mark(String what) => _at[what] = DateTime.now();

  static DateTime? of(String what) => _at[what];

  static const todaySchedule = 'todaySchedule';
  static const medications = 'medications';
  static const careSummary = 'careSummary';
}
