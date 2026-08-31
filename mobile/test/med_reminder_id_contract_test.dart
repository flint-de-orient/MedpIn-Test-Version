import 'package:flutter_test/flutter_test.dart';
import 'package:akd_care/shared/services/notification_service.dart';

/// The one number that must be identical in two languages.
///
/// The device arms a local alarm and the server pushes an FCM backstop at the
/// same dose time. They collapse into one notification only if both compute the
/// same id — otherwise the patient is reminded twice, every dose, and the
/// obvious "fix" is to switch one of them off.
void main() {
  test('Dart agrees with the Node implementation', () {
    // Produced by backend/src/utils/medReminderId.js for these exact inputs.
    const expected = {
      '66b1f2a4c9e11a0012345678|08:00': 748075,
      '66b1f2a4c9e11a0012345678|21:30': 701751,
      'aaaaaaaaaaaaaaaaaaaaaaaa|13:05': 725448,
      '5f9d1b|00:00': 758770,
    };
    for (final e in expected.entries) {
      final parts = e.key.split('|');
      expect(medDailyReminderId(parts[0], parts[1]), e.value, reason: e.key);
    }
  });
}
