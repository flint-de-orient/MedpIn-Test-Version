import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Rendering real screens to PNGs, so a layout can be looked at rather than
/// assumed.
///
/// A clean analyzer proves nothing about layout: three screens shipped broken
/// here because nobody opened them. These helpers pump the real widget with
/// fake data, then write what it drew to `build/ui_previews/<area>/<name>.png`
/// (build/ is ignored by git — the images are for looking at, not committing).
///
/// Not a test file on its own: it has no `main`, and `flutter test` only runs
/// files ending in `_test.dart`.

/// Inter and the Material icon font, so text is text and icons are icons
/// rather than grey boxes and tofu.
Future<void> loadPreviewFonts() async {
  final inter = FontLoader('Inter')
    ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
  await inter.load();

  final iconFile = File(
    r'C:\flutter\bin\cache\artifacts\material_fonts\materialicons-regular.otf',
  );
  if (iconFile.existsSync()) {
    final icons = FontLoader('MaterialIcons')
      ..addFont(
        Future.value(ByteData.view(iconFile.readAsBytesSync().buffer)),
      );
    await icons.load();
  }
}

/// A phone: 360 × [height] logical pixels at a density of three.
///
/// 780 is the first screenful of a common Android phone — what a doctor sees
/// without scrolling. A taller value lays the whole list out at once, for a
/// full-page render.
void usePhone(WidgetTester tester, {double height = 780}) {
  tester.view.physicalSize = Size(1080, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// Writes what [boundary] drew to `build/ui_previews/<area>/<name>.png`.
///
/// Inside `runAsync`, because encoding an image is real asynchronous work and
/// the test's fake clock would otherwise never let it finish.
Future<void> capture(
  WidgetTester tester,
  GlobalKey boundary, {
  required String area,
  required String name,
  double pixelRatio = 2,
}) async {
  await tester.runAsync(() async {
    final render =
        boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await render.toImage(pixelRatio: pixelRatio);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final dir = Directory('build/ui_previews/$area');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    File('${dir.path}/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

/// Captures the screen one screenful at a time, scrolling the tallest vertical
/// list between shots: `<name>_1.png`, `<name>_2.png`, …
///
/// A whole dashboard rendered as one image is ten thousand pixels tall and
/// unreadable once scaled to fit a viewer; a screenful is what a phone shows,
/// and each keeps the header and navigation bar, so every shot reads as the
/// real screen at that scroll position.
Future<int> captureScrolling(
  WidgetTester tester,
  GlobalKey boundary, {
  required String area,
  required String name,
  int maxShots = 8,
}) async {
  final lists = find.byWidgetPredicate(
    (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
  );
  ScrollPosition? position;
  for (final element in lists.evaluate()) {
    final state = (element as StatefulElement).state as ScrollableState;
    final p = state.position;
    if (position == null || p.maxScrollExtent > position.maxScrollExtent) {
      position = p;
    }
  }

  var shot = 0;
  var offset = 0.0;
  while (shot < maxShots) {
    shot++;
    if (position != null) {
      position.jumpTo(offset.clamp(0, position.maxScrollExtent));
      await tester.pump();
    }
    await capture(tester, boundary, area: area, name: '${name}_$shot');
    if (position == null || offset >= position.maxScrollExtent) break;
    // Overlap each shot with the last by a fifth, so nothing falls between.
    offset += position.viewportDimension * 0.8;
  }
  return shot;
}

/// Pumps a few frames without waiting for anything to settle.
///
/// `pumpAndSettle` never returns on a screen with a spinner on it, and the
/// loading state is one of the states worth looking at.
Future<void> settleFrames(WidgetTester tester, {int frames = 6}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}
