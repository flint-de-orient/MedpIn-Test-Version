/// A front-desk account.
///
/// Named for the desk rather than the person on purpose: a reception account is
/// a line, not an individual, and two handsets often sign into one of them so
/// that a patient gets replies from "Clinic Reception" rather than from two
/// accounts that happen to be the same desk.
class StaffMember {
  const StaffMember({
    required this.id,
    required this.name,
    required this.phone,
    this.altPhones = const [],
    this.avatarUrl,
    this.lastLoginAt,
  });

  final String id;
  final String name;

  /// The number this account was created with.
  final String phone;

  /// Other numbers that also sign into this same account.
  ///
  /// Shown beside the first because "who can get into this" is the question
  /// the doctor's list exists to answer, and a second line that is invisible
  /// here is a way in nobody is counting.
  final List<String> altPhones;

  final String? avatarUrl;

  /// Null when the account has never been signed into.
  ///
  /// Worth showing: an account created months ago and never used is either a
  /// number typed wrong or somebody who left, and both are worth closing.
  final DateTime? lastLoginAt;

  /// Every number that opens this account.
  List<String> get allPhones => [phone, ...altPhones];

  factory StaffMember.fromJson(Map<String, dynamic> j) => StaffMember(
    id: j['id']?.toString() ?? '',
    name: j['name']?.toString() ?? '',
    phone: j['phone']?.toString() ?? '',
    altPhones:
        (j['altPhones'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    avatarUrl: j['avatarUrl']?.toString(),
    lastLoginAt:
        DateTime.tryParse(j['lastLoginAt']?.toString() ?? '')?.toLocal(),
  );
}
