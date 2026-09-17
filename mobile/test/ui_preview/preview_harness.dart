// Renders real screens to PNGs so they can be looked at.
//
// A clean analyzer proves nothing about layout: three screens shipped broken
// here because nobody opened them. These helpers pump a screen at phone size
// with its providers faked (never the network), load the real fonts so text is
// not grey boxes, and write what was drawn to build/ui_previews/<area>/.
//
// build/ is gitignored. The PNGs are for looking at, never for committing.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:akd_care/app.dart' show AppScrollBehavior;
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/core/update/version_gate.dart';
import 'package:akd_care/features/auth/data/auth_repository.dart';
import 'package:akd_care/features/auth/domain/user.dart';
import 'package:akd_care/features/auth/presentation/auth_controller.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/providers/core_providers.dart' as core;
import 'package:akd_care/shared/widgets/authed_image.dart' as authed;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Inter and the Material icon font, once per file.
Future<void> loadPreviewFonts() async {
  final inter = FontLoader('Inter')
    ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
  await inter.load();

  // The SDK's own copy of the icon font. Without it every icon is a box.
  final path = [
    r'C:\flutter\bin\cache\artifacts\material_fonts\materialicons-regular.otf',
    '${Platform.environment['FLUTTER_ROOT'] ?? ''}/bin/cache/artifacts/material_fonts/materialicons-regular.otf',
  ].firstWhere((p) => File(p).existsSync(), orElse: () => '');
  if (path.isNotEmpty) {
    final icons = FontLoader('MaterialIcons')..addFont(
      Future.value(ByteData.view(File(path).readAsBytesSync().buffer)),
    );
    await icons.load();
  }
}

/// How large the text is drawn.
///
/// The app's own builder trims the device's scale by 13% and caps it at 1.0
/// (see app.dart), so [production] is what a phone at default settings shows.
/// [large] is 1.3 applied raw, past that cap, as a stress test: if a layout
/// holds there it holds for anyone who later lifts the cap.
enum PreviewScale {
  production(0.87),
  large(1.3);

  const PreviewScale(this.factor);
  final double factor;
}

/// A 360dp phone, 780dp tall unless [height] says otherwise.
void usePhone(WidgetTester tester, {double height = 780}) {
  tester.view.physicalSize = Size(360 * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// The boundary every preview is captured from.
final previewKey = GlobalKey(debugLabel: 'preview');

/// The overrides nearly every screen needs and none of them is about: no
/// token for photos (so faces fall back to initials rather than the network),
/// and no update on offer.
List<Override> baseOverrides() => [
  core.imageAuthHeaderProvider.overrideWith((ref) async => const {}),
  authed.imageAuthHeaderProvider.overrideWith((ref) async => const {}),
  versionStatusProvider.overrideWith(
    (ref) async => (
      mustUpdate: false,
      canUpdate: false,
      build: 0,
      latestBuild: 0,
      latestVersion: null,
      downloadUrl: null,
    ),
  ),
];

/// A signed-in account, without a secure store or a server.
List<Override> signedInAs(AppUser user) => [
  core.secureStoreProvider.overrideWithValue(_TokenStore()),
  authRepositoryProvider.overrideWithValue(_Me(user)),
];

class _TokenStore extends SecureStore {
  @override
  Future<String?> readAccessToken() async => 'preview-token';
}

class _Me implements AuthRepository {
  _Me(this.user);
  final AppUser user;

  @override
  Future<({AppUser user, String? diabetesType})> getMe() async => (
    user: user,
    diabetesType: null,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The app's theme, localisations, scroll behaviour and text scale around
/// [home], or around [router] when the screen needs one.
Widget previewApp({
  required List<Override> overrides,
  Widget? home,
  GoRouter? router,
  PreviewScale scale = PreviewScale.production,
}) {
  Widget scaled(BuildContext context, Widget? child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(scale.factor)),
    child: child ?? const SizedBox.shrink(),
  );

  final app =
      router != null
          ? MaterialApp.router(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            locale: const Locale('en'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            scrollBehavior: const AppScrollBehavior(),
            routerConfig: router,
            builder: scaled,
          )
          : MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            locale: const Locale('en'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            scrollBehavior: const AppScrollBehavior(),
            builder: scaled,
            home: home,
          );

  return RepaintBoundary(
    key: previewKey,
    child: ProviderScope(overrides: overrides, child: app),
  );
}

/// Writes what is on screen to build/ui_previews/[area]/[name].png.
///
/// With real shadows. The test binding replaces every elevation shadow with a
/// solid black outline, which drew a thick black ring round every floating
/// button and read as a defect that is not there. They are switched on for
/// the picture and back off before the test ends, because the binding checks.
Future<void> snap(WidgetTester tester, String area, String name) async {
  debugDisableShadows = false;
  unawaited(tester.binding.reassembleApplication());
  await tester.pump();
  try {
    await tester.runAsync(() async {
      final boundary =
          previewKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      final file = File('build/ui_previews/$area/$name.png');
      file.parent.createSync(recursive: true);
      file.writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  } finally {
    debugDisableShadows = true;
    unawaited(tester.binding.reassembleApplication());
    await tester.pump();
  }
}

/// The container behind a pumped screen, to change what a fake answers with
/// and ask again.
ProviderContainer containerOf(WidgetTester tester, Finder screen) =>
    ProviderScope.containerOf(tester.element(screen));

/// Pumps a few frames without waiting for a settle that timers would prevent.
Future<void> pumpFrames(WidgetTester tester, [int frames = 6]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
