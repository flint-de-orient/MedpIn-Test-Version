/// A phone number, in full and grouped so it can be read aloud.
///
/// It was masked to +91 93304 xxxx 63 for shoulder-surfing on a counter-top
/// handset. The clinic asked for the whole number back, which is their call to
/// make: the desk reads numbers out to patients and dictates them to couriers,
/// and half a number cannot be checked against the one somebody is reciting.
///
/// Grouped rather than run together, because +919330414463 is fourteen digits
/// with nothing for the eye to hold on to, and a receptionist copying it out
/// loses their place in the middle.
///
/// Shared, not kept beside the desk row where it started: the profile shows the
/// practice's number with the same grouping, and two formatters for one kind of
/// number is how the same number comes to look different on two screens.
String formatPhone(String? raw) {
  final s = (raw ?? '').trim();
  if (s.isEmpty) return '';
  final digits = s.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 10) return s;

  final local = digits.substring(digits.length - 10);
  final cc = digits.substring(0, digits.length - 10);
  final grouped = '${local.substring(0, 5)} ${local.substring(5)}';
  return cc.isEmpty ? grouped : '+$cc $grouped';
}
