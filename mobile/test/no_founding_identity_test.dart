import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// No screen introduces a practice as the founding clinic.
///
/// The app's own strings named Dr. Amit Kumar Dey: the chat tab's title was
/// "Dr. Dey's Clinic" in all three languages, the assistant's label on every
/// reply was "Dr. Dey's Clinic · assistant", the feedback form asked patients to
/// "Tell Dr. Dey", and the letterhead form showed his name as the example for
/// every other doctor to follow. Each is shown to people who are not his
/// patients.
///
/// This reads the source rather than rendering it, because the leak is a string
/// literal wherever it sits. Comments are skipped — they may describe the
/// history, and a comment is not shown to anybody.
void main() {
  final founding = RegExp(r"Dr\.? ?(Amit|A\. ?K\.)|Dey's|Dr\.? Dey|অমিত|ডাঃ দে|अमित|डॉ\. डे");

  test('no localised string names the founding doctor', () {
    for (final lang in ['en', 'bn', 'hi']) {
      final arb = File('lib/l10n/app_$lang.arb').readAsStringSync();
      expect(founding.hasMatch(arb), isFalse, reason: 'app_$lang.arb names the founding doctor');
    }
  });

  test('no string in the app’s code names the founding doctor', () {
    final offenders = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final trimmed = lines[i].trimLeft();
        if (trimmed.startsWith('//')) continue;
        if (founding.hasMatch(lines[i])) offenders.add('${entity.path}:${i + 1}  $trimmed');
      }
    }
    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });
}
