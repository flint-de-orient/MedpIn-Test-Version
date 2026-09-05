import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whose record the app is currently showing.
///
/// ---- Why this is one provider and not a parameter on twenty --------------
///
/// Priya's phone may carry her own record, her four-year-old's and her
/// mother-in-law's. Switching between them has to change *everything* — Home,
/// glucose, medicines, documents, reminders — and doing that by threading a
/// patient id through every provider means the day somebody adds a
/// twenty-first, one of them is missed and shows the wrong person's data under
/// the right person's name.
///
/// So there is one answer to "whose record is this", every repository reads it,
/// and switching is a single write that the rest of the app follows.
///
/// ---- Null is the answer, not the absence of one -------------------------
///
/// Null means the account holder — the login's own record. That is what every
/// patient has today and what the API means by `me`, so a phone with one person
/// on it never touches this and behaves exactly as it always has.
class ActivePatient extends Notifier<String?> {
  @override
  String? build() => null;

  /// Switch to somebody this login looks after.
  ///
  /// Passing null returns to the account holder. The caller is responsible for
  /// having checked that the login may act for this patient — the server checks
  /// again and refuses, so a mistake here is a 403 rather than a leak, but the
  /// UI should not offer a name it cannot open.
  void switchTo(String? patientId) {
    if (state == patientId) return;
    state = patientId;
  }
}

final activePatientProvider = NotifierProvider<ActivePatient, String?>(ActivePatient.new);

/// The path segment every patient-facing repository uses.
///
/// `me` for the account holder, the patient's id for anybody else. Reading it
/// through a provider rather than hardcoding `me` is the whole mechanism:
/// repositories that watch this re-fetch when it changes, and ones that do not
/// are the bugs this exists to make findable.
final patientPathProvider = Provider<String>((ref) => ref.watch(activePatientProvider) ?? 'me');
