import 'package:medpin/core/utils/auth_validators.dart';
import 'package:flutter_test/flutter_test.dart';

/// These cases mirror `registerSchema` in `backend/src/routes/auth.js`. If the
/// server rules change, this test should fail before a patient meets an
/// opaque VALIDATION_ERROR on the register screen.
void main() {
  group('phone', () {
    // The field shows a fixed +91 prefix and holds only the 10 national
    // digits, so validation runs against those 10 digits alone.
    test('accepts a 10-digit Indian mobile number', () {
      expect(AuthValidators.isValidPhone('9830012345'), isTrue);
      expect(
        AuthValidators.isValidPhone('6000000000'),
        isTrue,
        reason: 'starts with 6',
      );
      expect(
        AuthValidators.isValidPhone('98300 12345'),
        isTrue,
        reason: 'spaces tolerated',
      );
    });

    test('rejects anything that is not a valid 10-digit mobile', () {
      expect(
        AuthValidators.isValidPhone('983001234'),
        isFalse,
        reason: '9 digits',
      );
      expect(
        AuthValidators.isValidPhone('98300123456'),
        isFalse,
        reason: '11 digits',
      );
      expect(
        AuthValidators.isValidPhone('5830012345'),
        isFalse,
        reason: 'starts below 6',
      );
      expect(
        AuthValidators.isValidPhone('0830012345'),
        isFalse,
        reason: 'leading zero',
      );
      expect(
        AuthValidators.isValidPhone('98300abcde'),
        isFalse,
        reason: 'not digits',
      );
      expect(AuthValidators.isValidPhone(''), isFalse);
    });

    test('builds the E.164 form the backend stores', () {
      expect(AuthValidators.toE164('9830012345'), '+919830012345');
      // Robust against a pasted, pre-formatted value.
      expect(AuthValidators.toE164('98300 12345'), '+919830012345');
    });

    test('country code is +91', () {
      expect(AuthValidators.countryCode, '+91');
    });
  });

  group('password', () {
    test('minimum matches the server', () {
      expect(AuthValidators.minPasswordLength, 8);
    });
  });

  group('email', () {
    test('accepts real addresses and rejects garbage', () {
      expect(AuthValidators.isValidEmail('r@x.com'), isTrue);
      expect(AuthValidators.isValidEmail('rahul.das@clinic.co.in'), isTrue);
      expect(AuthValidators.isValidEmail('rahul'), isFalse);
      expect(AuthValidators.isValidEmail('rahul@x'), isFalse);
      expect(AuthValidators.isValidEmail('r ahul@x.com'), isFalse);
    });
  });
}
