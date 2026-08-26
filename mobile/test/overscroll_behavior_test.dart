import 'package:akd_care/app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pull past the top of any list in this app and the content must still be
/// there.
///
/// Material 3's Android default, [StretchingOverscrollIndicator], puts the
/// whole scroll view behind a fragment-shader `ImageFiltered` while the finger
/// is down. On the clinic's phones that filter renders blank — a dietician
/// overscrolling a patient's Clinical tab watched the entire record turn into a
/// flat grey rectangle. So the rule is not "prefer glow", it is "never stretch",
/// and it is worth a test because the stretch comes back the moment anyone
/// drops [MaterialApp.scrollBehavior].
void main() {
  Widget scrollable(TargetPlatform platform) => MaterialApp(
    scrollBehavior: const AppScrollBehavior(),
    theme: ThemeData(platform: platform),
    home: Scaffold(
      body: ListView(
        children: List.generate(
          40,
          (i) => SizedBox(height: 40, child: Text('$i')),
        ),
      ),
    ),
  );

  testWidgets('Android overscroll glows, never stretches', (tester) async {
    await tester.pumpWidget(scrollable(TargetPlatform.android));
    expect(find.byType(StretchingOverscrollIndicator), findsNothing);
    expect(find.byType(GlowingOverscrollIndicator), findsOneWidget);
  });

  testWidgets('a real overscroll leaves the list on screen', (tester) async {
    await tester.pumpWidget(scrollable(TargetPlatform.android));
    // Drag past the top, the gesture that produced the grey rectangle, and
    // hold there while the frame is built.
    final gesture = await tester.startGesture(const Offset(200, 300));
    await gesture.moveBy(const Offset(0, 260));
    await tester.pump();

    expect(find.text('0'), findsOneWidget);
    expect(find.byType(StretchingOverscrollIndicator), findsNothing);

    await gesture.up();
    await tester.pumpAndSettle();
  });

  testWidgets('iOS keeps its own bounce, with no indicator bolted on', (
    tester,
  ) async {
    await tester.pumpWidget(scrollable(TargetPlatform.iOS));
    expect(find.byType(GlowingOverscrollIndicator), findsNothing);
    expect(find.byType(StretchingOverscrollIndicator), findsNothing);
  });
}
