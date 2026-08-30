import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Every screen must be reachable from somewhere.
///
/// This exists because a whole feature folder was dead and nothing said so.
/// `features/dashboard/presentation/dashboard_screen.dart` was the patient's
/// home once; the home was rebuilt as `features/home` and the old tree stayed
/// behind, still compiling, still analysing clean, still passing every test —
/// and an appointments section was added to it, released, and could not be
/// found on the device, because no route had built that file for months.
///
/// The analyser cannot catch this: an unreferenced public class is not an
/// error, it is a library. So the check has to be asked for.
///
/// Deliberately about *screens* rather than every widget. A screen that nothing
/// can open is always a mistake; a widget nothing uses yet may be half of a
/// change in progress.
void main() {
  test('no screen class is referenced only by its own file', () {
    final lib = Directory('lib');
    final dartFiles = lib
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList();

    // Generated localisations are not hand-written code and hold no screens.
    final sources = {
      for (final f in dartFiles)
        if (!f.path.replaceAll(r'\', '/').contains('/l10n/gen/'))
          f.path.replaceAll(r'\', '/'): f.readAsStringSync(),
    };

    final orphans = <String>[];

    sources.forEach((path, src) {
      if (!path.endsWith('_screen.dart')) return;

      for (final m in RegExp(
        r'^class ([A-Z][A-Za-z0-9_]*Screen)\b',
        multiLine: true,
      ).matchAll(src)) {
        final name = m.group(1)!;
        final referenced = sources.entries.any(
          (e) =>
              e.key != path &&
              RegExp('\\b$name\\b').hasMatch(e.value),
        );
        if (!referenced) orphans.add('$name  ($path)');
      }
    });

    expect(
      orphans,
      isEmpty,
      reason:
          'These screens are built by nothing — no route, no push, no other '
          'file mentions them. Either wire them up or delete them; a screen '
          'that cannot be opened is a trap for the next person who edits it:\n'
          '${orphans.join('\n')}',
    );
  });
}

extension on RegExp {
  Iterable<RegExpMatch> matchAll(String input) => allMatches(input);
}
