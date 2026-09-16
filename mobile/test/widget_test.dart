// Smoke test: pumps the real app (with a mocked secure-storage channel and
// empty SharedPreferences) and verifies the widget tree builds without
// throwing. On a fresh install there is no stored token, so the router
// should settle on the language-picker screen without making any network
// calls.

import 'package:medpin/app.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const secureStorageChannel = MethodChannel(
    'plugins.it_nomads.com/flutter_secure_storage',
  );

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (call) async {
          switch (call.method) {
            case 'readAll':
              return <String, String>{};
            case 'read':
              return null;
            default:
              return null;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  testWidgets('App boots to the language picker on a fresh install', (
    WidgetTester tester,
  ) async {
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
        child: const App(),
      ),
    );

    // Splash frame, then let the auth bootstrap + router redirect settle.
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // No stored token and no chosen language yet -> language picker.
    expect(find.text('বাংলা'), findsOneWidget);
    expect(find.text('हिन्दी'), findsOneWidget);
  });
}
