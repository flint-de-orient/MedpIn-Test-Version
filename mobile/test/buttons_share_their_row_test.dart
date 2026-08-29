import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// A button that shares a Row must set its own minimum size.
///
/// AppTheme gives every FilledButton, ElevatedButton and OutlinedButton
/// `minimumSize: Size.fromHeight(52)`. That reads as "52 tall" and means
/// `Size(double.infinity, 52)` — a minimum *width* of infinity. It is right for
/// a button that owns its row, and ruinous for one sharing it: the button
/// claims the whole width and whatever sits beside it gets nothing.
///
/// It has shipped three times.
///
///  * The registration form's phone field rendered one character wide, its
///    label running down the screen a letter at a time, beside a Verify button.
///  * The desk's Today header did the same to the date and the desk name.
///  * The nutrition-care sheet's save button was in a Row with a Spacer, and an
///    overflowing Row drops its last child silently — so picking a dietician
///    appeared to do nothing, because the button to confirm it was not drawn.
///
/// Read as source rather than rendered. The failure is a *missing* line, and
/// only some of these screens can be pumped without a live server; a test that
/// renders the two it can reach would leave the rest armed.
void main() {
  /// Every Dart file under lib/.
  Iterable<File> sources() sync* {
    for (final e in Directory('lib').listSync(recursive: true)) {
      if (e is File && e.path.endsWith('.dart')) yield e;
    }
  }

  /// The button constructors the theme gives an infinite minimum width to.
  const themed = ['FilledButton', 'ElevatedButton', 'OutlinedButton'];

  test('a themed button inside a Row declares its own minimumSize', () {
    final offenders = <String>[];

    for (final file in sources()) {
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        final isButton = themed.any(
          (b) => line.contains('$b(') || line.contains('$b.icon('),
        );
        if (!isButton) continue;
        // styleFrom lines mention the same names; only the constructor counts.
        if (line.contains('styleFrom')) continue;

        // Walk back for the nearest layout that decides this button's width.
        // A Row shares it; anything that hands down a tight width does not.
        var sharesARow = false;
        for (var j = i - 1; j >= 0 && j > i - 14; j--) {
          final up = lines[j];
          if (up.contains('SizedBox(') ||
              up.contains('Expanded(') ||
              up.contains('width: double.infinity') ||
              up.contains('CrossAxisAlignment.stretch')) {
            break;
          }
          if (up.contains('Row(')) {
            sharesARow = true;
            break;
          }
        }
        if (!sharesARow) continue;

        // Does its own style pin a width? Look forward through the call.
        final window = lines.skip(i).take(16).join('\n');
        if (window.contains('minimumSize')) continue;

        offenders.add('${file.path}:${i + 1}');
      }
    }

    expect(
      offenders,
      isEmpty,
      reason:
          'these buttons share a Row and inherit a minimum width of infinity, '
          'which collapses whatever is beside them:\n  ${offenders.join('\n  ')}',
    );
  });
}
