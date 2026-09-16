import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/shared/utils/phone_format.dart';

/// Phone numbers on the front-desk screen.
///
/// These were briefly masked to +91 93304 •••• 63, for reading over a
/// receptionist's shoulder at a counter. The clinic asked for the whole number
/// back — theirs to decide, and the better call for the job: the desk reads
/// numbers out to patients and dictates them to couriers, and half a number
/// cannot be checked against one somebody is reciting.
///
/// So the guarantee is now the opposite one, and worth pinning just as firmly:
/// every digit is shown, and grouped so it can be read aloud without losing
/// your place.
void main() {
  group('a patient phone number on the desk screen', () {
    test('shows every digit, grouped', () {
      expect(formatPhone('+919330414463'), '+91 93304 14463');
    });

    test('reads the same however the number was stored', () {
      // Punctuation is presentation, not identity. Two rows for one patient
      // must not look like two different people.
      expect(formatPhone('+91 93304 14463'), '+91 93304 14463');
      expect(formatPhone('+91-93304-14463'), '+91 93304 14463');
    });

    test('a bare ten-digit number needs no country code', () {
      expect(formatPhone('9330414463'), '93304 14463');
    });

    test('nothing is ever hidden', () {
      // The actual promise, stated as itself rather than as a format.
      final shown = formatPhone('+919330414463');
      for (final digit in '9330414463'.split('')) {
        expect(shown.contains(digit), isTrue);
      }
      expect(shown.contains('•'), isFalse);
      expect(
        shown.replaceAll(RegExp(r'\D'), ''),
        '919330414463',
        reason: 'every digit that went in comes out',
      );
    });

    test('something too short to group is left exactly as given', () {
      expect(formatPhone('123456'), '123456');
    });

    test('nothing in, nothing out', () {
      expect(formatPhone(null), '');
      expect(formatPhone(''), '');
      expect(formatPhone('   '), '');
    });
  });
}
