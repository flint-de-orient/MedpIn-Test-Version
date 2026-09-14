import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/core_providers.dart';

/// Who this person rings: their own practice, and its number when it has one.
///
/// ---- What this replaced -----------------------------------------------------
///
/// Every "Call clinic" button — the emergency card's included — dialled the
/// first location the clinic list returned that had a phone, and until that
/// list loaded, a number written into the app: '+913322345678', a placeholder
/// marked "swap before release". A patient of one practice could be put through
/// to another practice's desk, or to nobody at all, at the moment it mattered
/// most.
///
/// The server now answers from the practice the patient is enrolled at, by the
/// same rule the assistant uses when it names a number in emergency advice. No
/// number is a real answer, and the buttons that would dial it are not drawn.
@immutable
class CareContact {
  const CareContact({required this.practiceName, required this.phone});

  final String? practiceName;

  /// A number somebody can actually ring, or null. Never a placeholder.
  final String? phone;

  bool get canCall => phone != null;

  factory CareContact.fromJson(Map<String, dynamic> json) {
    final practice = json['practice'];
    final phone = json['phone']?.toString().trim();
    return CareContact(
      practiceName: practice is Map ? practice['name']?.toString() : null,
      phone: (phone == null || phone.isEmpty) ? null : phone,
    );
  }
}

/// The signed-in person's contact, fetched once per session.
///
/// Not auto-disposed: the emergency card reads it, and it should already be
/// there when the card appears rather than start loading at that moment.
/// Invalidate after a practice or location phone changes.
final careContactProvider = FutureProvider<CareContact>((ref) async {
  final json = await ref.watch(apiClientProvider).getJson('/auth/me/contact');
  return CareContact.fromJson(json);
});
