import 'package:flutter_test/flutter_test.dart';

import 'package:akd_care/features/clinician/presentation/widgets/desk_appointment_row.dart';

/// Phone numbers on the front-desk screen.
///
/// A receptionist's handset is read over their shoulder — by the next patient
/// in the queue, by whoever is leaning on the counter. A full number printed on
/// every row all day is somebody's personal detail on display to the room, and
/// the desk does not need it: they need enough digits to recognise the right
/// person and read a couple back. The whole number is one tap away on the call
/// button, which is what they actually want it for.
void main() {
  group('masking a patient phone number', () {
    test('keeps the country code, the head and the last two', () {
      expect(maskPhone('+919330414463'), '+91 93304 •••• 63');
    });

    test('reads the same however the number was typed', () {
      // Punctuation is presentation, not identity. A number stored with spaces
      // must mask to the same string as one stored without, or two rows for the
      // same patient look like two different people.
      expect(maskPhone('+91 93304 14463'), '+91 93304 •••• 63');
      expect(maskPhone('+91-93304-14463'), '+91 93304 •••• 63');
    });

    test('a bare ten-digit number needs no country code', () {
      expect(maskPhone('9330414463'), '93304 •••• 63');
    });

    test('something too short to mask is left alone', () {
      // Hiding four digits of a six-digit number leaves nothing to recognise,
      // which defeats the point of showing it at all.
      expect(maskPhone('123456'), '123456');
    });

    test('nothing in, nothing out', () {
      expect(maskPhone(null), '');
      expect(maskPhone(''), '');
      expect(maskPhone('   '), '');
    });

    test('never leaks the middle digits', () {
      // The actual guarantee, stated as itself rather than as a format: the
      // four digits between the head and the tail must not appear.
      final masked = maskPhone('+919330414463');
      expect(masked.contains('1446'), isFalse);
      expect(masked.contains('••••'), isTrue);
    });
  });
}
