import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Every patient-facing path follows the active patient.
///
/// ---- Two failures this catches, both silent ------------------------------
///
/// A hardcoded `/patients/me/` no longer follows the household switcher, so
/// switching to a child would leave that one screen showing the account
/// holder's data under the child's name. Nothing errors; the screen is simply
/// wrong about whose medicines those are.
///
/// And an *escaped* interpolation — `'/patients/\$_patient/x'` — is perfectly
/// valid Dart that sends the literal characters `$_patient` as a URL segment.
/// The analyser cannot see it, the app compiles, and every request 404s. Three
/// files shipped that way for the length of one build.
void main() {
  final lib = Directory('lib');

  List<File> dartFiles() => lib
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  test('no patient path is hardcoded to the account holder', () {
    final offenders = <String>[];

    for (final file in dartFiles()) {
      final src = file.readAsStringSync();
      src.split('\n').asMap().forEach((i, line) {
        // Comments describing the endpoint are fine; only code that builds one.
        final code = line.trimLeft();
        if (code.startsWith('//') || code.startsWith('///')) return;
        if (line.contains("/patients/me/")) {
          offenders.add('${file.path}:${i + 1}  ${line.trim()}');
        }
      });
    }

    expect(
      offenders,
      isEmpty,
      reason:
          '\nThese still address the account holder directly, so they will not\n'
          'follow the household switcher:\n\n  ${offenders.join('\n  ')}\n',
    );
  });

  test('no patient path escapes its interpolation', () {
    // `'\$_patient'` is valid Dart and sends the literal text. Nothing but a
    // test can find it: it compiles, analyses clean, and fails at runtime as a
    // 404 that looks like a routing problem.
    final offenders = <String>[];

    for (final file in dartFiles()) {
      final src = file.readAsStringSync();
      src.split('\n').asMap().forEach((i, line) {
        if (line.contains(r'/patients/\$')) {
          offenders.add('${file.path}:${i + 1}  ${line.trim()}');
        }
      });
    }

    expect(
      offenders,
      isEmpty,
      reason:
          '\nAn escaped dollar sends the variable name as a URL segment:\n\n'
          '  ${offenders.join('\n  ')}\n',
    );
  });

  test('no source file is empty', () {
    // A normalisation script emptied three files by opening them for writing
    // in the same expression that read them — 'wb' truncates first, so the read
    // returned nothing. They were committed that way and only a Gradle build
    // noticed.
    final empty = dartFiles().where((f) => f.lengthSync() == 0).map((f) => f.path).toList();
    expect(empty, isEmpty, reason: '\nEmpty source files:\n\n  ${empty.join('\n  ')}\n');
  });
}
