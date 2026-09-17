import '../../glucose/domain/glucose_trends.dart';

/// What Home asks of the patient beyond their doses (those are in
/// `medications/domain/today_doses.dart`): a sugar check when one is due, and
/// the diet plan's calorie target.
///
/// Pure: `now` is always passed in, so the rules are pinned by plain tests.

/// How long after the last reading a check-in falls due.
///
/// The same interval the on-device check-in reminder is armed with
/// (`NotificationService.scheduleCheckInReminder`, `intervalDays = 3`): Home
/// asks for a reading on the day the phone would have nudged for one, not on a
/// schedule of its own.
const int kCheckInIntervalDays = 3;

/// When the patient last logged a reading in [trends], or null for none in
/// the window.
DateTime? lastReadingAt(GlucoseTrends trends) =>
    latestReading(trends)?.at?.toLocal();

/// The most recent reading in the window, or null.
GlucoseTrendPoint? latestReading(GlucoseTrends trends) {
  GlucoseTrendPoint? latest;
  for (final p in trends.series) {
    if (p.at == null) continue;
    if (latest == null || p.at!.isAfter(latest.at!)) latest = p;
  }
  return latest;
}

/// Whether a sugar check is due: nothing logged in the window, or the last
/// reading is [kCheckInIntervalDays] days old.
bool checkInDue(GlucoseTrends trends, DateTime now) {
  final last = lastReadingAt(trends);
  if (last == null) return true;
  return now.difference(last) >= const Duration(days: kCheckInIntervalDays);
}

/// Whole days since [at], counted by calendar day rather than by 24-hour
/// periods: a reading at 9 PM yesterday was "yesterday" at 8 AM today.
int daysSince(DateTime at, DateTime now) {
  final a = DateTime(at.year, at.month, at.day);
  final b = DateTime(now.year, now.month, now.day);
  return b.difference(a).inDays;
}

/// The daily calorie target, out of whatever prose the dietician wrote it
/// into, or null when they did not write one.
///
/// It used to read "600 kcal" out of "about 1,600 kcal a day": the pattern
/// wanted three digits before an optional thousands group, so it skipped the
/// "1," and matched from the 6. A target a thousand calories short is not a
/// rounding error, so thousands separators are read whole now, and anything
/// outside a plausible day is refused rather than shown.
int? calorieTarget(String text) {
  final match = RegExp(
    r'(?<![\d,.])(\d{1,2},\d{3}|\d{3,5})\s*-?\s*(?:k\s*cal|calories?|cal)\b',
    caseSensitive: false,
  ).firstMatch(text);
  if (match == null) return null;
  final n = int.tryParse(match.group(1)!.replaceAll(',', ''));
  if (n == null || n < 500 || n > 6000) return null;
  return n;
}
