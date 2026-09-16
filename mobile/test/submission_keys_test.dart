import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:medpin/core/network/submission_keys.dart';

/// The key that stops a retried consultation being written twice.
///
/// It has exactly two jobs, and each has a failure worth naming: the same
/// submission must produce the same key, or a retry after a timeout writes a
/// second prescription; and a corrected submission must produce a different
/// one, or the server answers the correction with the values it replaced.
void main() {
  final vitals = <String, dynamic>{'systolic': 150, 'diastolic': 95, 'glucoseMgDl': 212};

  test('tapping again with nothing changed gives the same key', () {
    final keys = SubmissionKeys();
    expect(keys.keyFor('vitals', vitals), keys.keyFor('vitals', Map.of(vitals)));
  });

  test('a corrected reading gives a new key, so the correction is recorded', () {
    final keys = SubmissionKeys();
    expect(
      keys.keyFor('vitals', vitals),
      isNot(keys.keyFor('vitals', {...vitals, 'systolic': 140})),
    );
  });

  test('the order a body was built in does not make it a different request', () {
    final keys = SubmissionKeys();
    final reordered = <String, dynamic>{'glucoseMgDl': 212, 'diastolic': 95, 'systolic': 150};
    expect(keys.keyFor('vitals', vitals), keys.keyFor('vitals', reordered));
  });

  test('vitals and the prescription from one consultation never share a key', () {
    final keys = SubmissionKeys();
    expect(keys.keyFor('vitals', vitals), isNot(keys.keyFor('prescription', vitals)));
  });

  test('the same consultation opened again is a new submission', () {
    expect(
      SubmissionKeys(random: Random(1)).keyFor('vitals', vitals),
      isNot(SubmissionKeys(random: Random(2)).keyFor('vitals', vitals)),
    );
  });

  test('every key is one the server accepts', () {
    final keys = SubmissionKeys();
    final prescription = {
      'items': [
        {'name': 'Metformin', 'strength': '500mg', 'frequency': '1-0-1'},
      ],
      'diagnosis': ['Type 2 diabetes mellitus'],
      'generalAdvice': 'Walk 30 minutes after dinner — রোজ',
    };
    final key = keys.keyFor('prescription', prescription);
    expect(RegExp(r'^[A-Za-z0-9._:-]{8,128}$').hasMatch(key), isTrue, reason: key);
  });
}
