import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/shared/widgets/otp_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The six boxes a texted code is typed into.
///
/// Pumped with the real theme, always. This widget shipped with its digits
/// invisible — the app's inputDecorationTheme sets `filled: true` with a white
/// fillColor, so the transparent TextField laid over the boxes painted a solid
/// white rectangle across all six and only their bottom edge showed. A bare
/// MaterialApp renders it perfectly and proves nothing.
void main() {
  Widget harness(Widget child) => MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: Padding(padding: const EdgeInsets.all(16), child: child),
    ),
  );

  testWidgets('the typed code is visible', (tester) async {
    final controller = TextEditingController(text: '482913');
    addTearDown(controller.dispose);

    await tester.pumpWidget(harness(OtpCodeField(controller: controller)));
    await tester.pump();

    // One Text per digit, in order. If the field ever swallows them again
    // this is what goes missing.
    for (final digit in ['4', '8', '2', '9', '1', '3']) {
      expect(find.text(digit), findsOneWidget, reason: digit);
    }
  });

  testWidgets('the input paints nothing over the boxes', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await tester.pumpWidget(harness(OtpCodeField(controller: controller)));

    final field = tester.widget<TextField>(find.byType(TextField));
    final decoration = field.decoration!;
    // Each of these is something the theme would otherwise draw across the
    // row. `filled` is the one that actually shipped broken.
    expect(decoration.filled, isFalse);
    expect(decoration.border, InputBorder.none);
    expect(decoration.enabledBorder, InputBorder.none);
    expect(decoration.focusedBorder, InputBorder.none);
  });

  testWidgets('the boxes are drawn over the field, not under it', (
    tester,
  ) async {
    final controller = TextEditingController(text: '1');
    addTearDown(controller.dispose);

    await tester.pumpWidget(harness(OtpCodeField(controller: controller)));
    await tester.pump();

    // Paint order is child order within a Stack. The digit has to come after
    // the input or the next theme change buries it again.
    final stack = tester.widget<Stack>(find.byType(Stack).first);
    expect(stack.children.first, isA<Positioned>());
    expect(stack.children.last, isA<IgnorePointer>());
  });

  testWidgets('a box is big enough to read and to hit', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await tester.pumpWidget(harness(OtpCodeField(controller: controller)));
    await tester.pump();

    // 48 is the tap-target floor; these are the one control on the screen and
    // this clinic's patients are largely elderly, so they get more.
    final row = tester.getSize(find.byType(IgnorePointer).first);
    expect(row.height, greaterThanOrEqualTo(56));
  });

  testWidgets('a full code reports itself once', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    var completions = 0;

    await tester.pumpWidget(
      harness(
        OtpCodeField(
          controller: controller,
          onCompleted: (_) => completions += 1,
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '48291');
    await tester.pump();
    expect(completions, 0, reason: 'five digits is not a code');

    await tester.enterText(find.byType(TextField), '482913');
    await tester.pump();
    expect(completions, 1);
  });

  testWidgets('only digits get in', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await tester.pumpWidget(harness(OtpCodeField(controller: controller)));
    await tester.enterText(find.byType(TextField), '4a8b2c');
    await tester.pump();

    expect(controller.text, '482');
  });
}
