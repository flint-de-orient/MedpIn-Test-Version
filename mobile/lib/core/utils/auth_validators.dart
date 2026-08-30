/// Client-side mirrors of the auth rules the backend enforces in
/// `backend/src/routes/auth.js`. Keeping them in one place is the only way
/// the two stay in sync — a client rule that is *looser* than the server's
/// turns into an opaque `VALIDATION_ERROR` after the round trip, which the
/// patient reads as "Please check the details you entered" with no idea
/// which field is wrong.
class AuthValidators {
  AuthValidators._();

  /// Server: `z.string().min(8).max(128)`.
  static const int minPasswordLength = 8;
  static const int maxPasswordLength = 128;

  /// Server: `z.string().trim().min(2).max(120)`.
  static const int minNameLength = 2;
  static const int maxNameLength = 120;

  /// Server: `z.enum([...]).optional()` — see [diabetesTypes].
  ///
  /// It used to carry `.default('type2')`, and this comment used to explain why
  /// that made an explicit choice essential: a Type 1 patient who skipped the
  /// field was stored as Type 2, which changes how their risk is scored and
  /// what the assistant tells them. The default is gone; records created while
  /// it stood still carry it, and nothing in the app can tell those apart from
  /// a patient who genuinely answered Type 2.
  ///
  /// Which is why it is now editable in Health details rather than merely
  /// displayed. Unset shows as "Not set", because not knowing is a true answer
  /// and guessing is what caused this.
  static const List<String> diabetesTypes = [
    'type1',
    'type2',
    'gestational',
    'prediabetes',
    'none',
  ];

  /// Server: `z.enum([...]).default('undisclosed')`.
  static const List<String> genders = ['male', 'female', 'other', 'undisclosed'];

  /// Oldest date of birth the picker will accept. Beyond this the entry is
  /// almost certainly a mis-scroll rather than a real patient.
  static const int maxAgeYears = 110;

  /// Youngest. Guards against today's date being submitted by accident.
  static const int minAgeYears = 1;

  /// True when [dob] is a plausible date of birth for a patient.
  static bool isPlausibleDateOfBirth(DateTime dob, {DateTime? now}) {
    final today = now ?? DateTime.now();
    final youngest = DateTime(today.year - minAgeYears, today.month, today.day);
    final oldest = DateTime(today.year - maxAgeYears, today.month, today.day);
    return !dob.isAfter(youngest) && !dob.isBefore(oldest);
  }

  /// The app is for a single clinic in India, so every account is a +91
  /// mobile number. The UI shows this as a fixed prefix and the patient types
  /// only the 10 national digits.
  static const String countryCode = '+91';

  /// Indian mobile numbers are exactly 10 digits and begin 6-9.
  static final RegExp _indianMobile = RegExp(r'^[6-9]\d{9}$');
  static final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  /// Keeps only digits from whatever the field holds — defensive against a
  /// pasted "+91 98300 12345" or stray spaces sneaking past the formatter.
  static String digitsOnly(String raw) => raw.replaceAll(RegExp(r'\D'), '');

  /// True when the field holds a valid 10-digit Indian mobile number.
  static bool isValidPhone(String rawTenDigits) => _indianMobile.hasMatch(digitsOnly(rawTenDigits));

  /// Combines the fixed +91 with the 10 typed digits into the E.164 form the
  /// backend stores (`+919830012345`). This is what gets sent on submit.
  static String toE164(String rawTenDigits) => '$countryCode${digitsOnly(rawTenDigits)}';

  static bool isValidEmail(String raw) => _emailPattern.hasMatch(raw.trim());
}
