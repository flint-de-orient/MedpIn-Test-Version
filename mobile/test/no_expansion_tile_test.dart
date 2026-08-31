import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// ExpansionTile does not render on this clinic's phones.
///
/// Not "renders oddly" — comes back as a flat grey rectangle, once its card has
/// been scrolled out of a list's cache extent and rebuilt. Take a patient record
/// to the bottom, come back up, and the doctor's advice is a grey block until
/// the screen is left and re-entered.
///
/// It took four attempts to find, because nothing in the widget tree is wrong.
/// The tile brings a stack of layer-making machinery to animate a disclosure —
/// Offstage, a ClipRect over an Align heightFactor, an AnimatedBuilder, a
/// ListTile with its own ink — and under Impeller on these handsets that
/// composition returns blank. It is invisible in a simulator, invisible in
/// review, and only visible on the phones the clinic actually owns.
///
/// One site was fixed where it was reported and five were left, including the
/// consult screen — the doctor's main workflow, where a grey block is found
/// mid-consultation. This is the guard that stops the sixth being written.
///
/// Use `DisclosureTile` (lib/shared/widgets/disclosure_tile.dart). Its API is
/// deliberately the same, so a site converts by changing a name.
void main() {
  test('no screen uses ExpansionTile', () {
    final offenders = <String>[];

    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      // The replacement's own doc comment names it, as does this test.
      if (entity.path.endsWith('disclosure_tile.dart')) continue;

      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i += 1) {
        final line = lines[i];
        // Constructor calls only. The name appears in prose explaining why it
        // is not used, and those comments are the point rather than a problem.
        if (line.contains('ExpansionTile(')) {
          offenders.add('  ${entity.path}:${i + 1}');
        }
      }
    }

    expect(
      offenders,
      isEmpty,
      reason:
          'ExpansionTile renders blank on the clinic phones. Use '
          'DisclosureTile instead — same API.\n${offenders.join('\n')}',
    );
  });
}
