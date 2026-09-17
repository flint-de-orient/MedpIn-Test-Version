import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/appointments/domain/clinic.dart';
import 'package:akd_care/features/auth/data/auth_repository.dart';
import 'package:akd_care/features/auth/domain/user.dart';
import 'package:akd_care/features/auth/presentation/auth_controller.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:akd_care/shared/providers/core_providers.dart';
import 'package:akd_care/shared/widgets/clinic_brand.dart';
import 'package:akd_care/shared/widgets/glass_surface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The rig the preview tests draw real screens with.
///
/// ---- Why these exist --------------------------------------------------------
///
/// A clean analyzer proves nothing about layout: three screens shipped broken
/// here because nobody looked at them. These pump the real screen, with the
/// providers it reads overridden by realistic data (never the network), at a
/// phone's size, in the app's own fonts, and write what was drawn to
/// `build/ui_previews/<area>/<name>.png` — which is gitignored, so the images
/// are for looking at and never for committing.
///
/// Every preview also asserts that nothing threw while laying out, so a
/// preview that renders an overflow stripe fails rather than quietly writing a
/// picture of it.

/// Inter and the Material icon font, so text is not grey boxes and icons are
/// not empty squares.
Future<void> loadPreviewFonts() async {
  final inter = FontLoader('Inter')
    ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
  await inter.load();
  final iconFile = File(
    r'C:\flutter\bin\cache\artifacts\material_fonts\materialicons-regular.otf',
  );
  if (iconFile.existsSync()) {
    final icons = FontLoader('MaterialIcons')
      ..addFont(Future.value(ByteData.view(iconFile.readAsBytesSync().buffer)));
    await icons.load();
  }
}

/// A phone [width] logical pixels wide — 360 is the common Android size, 320
/// the smallest still sold, 412 a large one — and [height] tall.
///
/// Tall views are how a long screen is captured whole: a list lays out what
/// its viewport shows, so the viewport is made as tall as the content.
void setPhone(WidgetTester tester, {double width = 360, double height = 780}) {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// The server's refusals and failures, as the app receives them.
const offline = ApiException(
  code: 'NETWORK_ERROR',
  message: 'No internet connection',
);
const refusedNotEnrolled = ApiException(
  code: 'FORBIDDEN',
  message: 'That patient is not enrolled at this practice',
  statusCode: 403,
);
const refusedNotConnected = ApiException(
  code: 'FORBIDDEN',
  message:
      'That patient is not connected to any practice yet. Add them to enrol them.',
  statusCode: 403,
);
const refusedNoAccess = ApiException(
  code: 'FORBIDDEN',
  message: 'You do not have permission to do that',
  statusCode: 403,
);
const practiceRequired = ApiException(
  code: 'PRACTICE_REQUIRED',
  message:
      'You work at more than one practice. Choose which one this request is for.',
  statusCode: 409,
);

/// Nobody's token, or somebody's.
class PreviewStore extends SecureStore {
  PreviewStore([this.token]);
  final String? token;

  @override
  Future<String?> readAccessToken() async => token;
}

/// Answers "who am I" with [user] and nothing else.
class PreviewAuth implements AuthRepository {
  PreviewAuth(this.user);
  final AppUser user;

  @override
  Future<({AppUser user, String? diabetesType})> getMe() async => (
    user: user,
    diabetesType: null,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AppUser previewDoctor({String? signatureUrl}) => AppUser(
  id: 'doc-1',
  name: 'Dr Anirban Dey',
  phone: '+919830012345',
  role: 'doctor',
  language: 'en',
  signatureUrl: signatureUrl,
);

AppUser previewDesk() => const AppUser(
  id: 'desk-1',
  name: 'Rina Paul',
  phone: '+919830054321',
  role: 'staff',
  language: 'en',
);

/// A practice whose doctor works in [department].
Capabilities previewCapabilities({String? department, String? specialty}) =>
    Capabilities(
      practiceType: 'clinic',
      specialty: specialty,
      plan: 'pro',
      practice: const {'PRESCRIPTION', 'LAB_RESULT', 'ADVANCED_REPORTS'},
      effective: const {'PRESCRIPTION', 'LAB_RESULT', 'ADVANCED_REPORTS'},
      role: 'doctor',
      isOwner: true,
      resolved: true,
      permissions: const {
        'VIEW_PATIENT',
        'EDIT_RECORD',
        'PRESCRIBE',
        'CHAT_READ',
        'CHAT_REPLY',
      },
      department:
          department == null
              ? null
              : DepartmentRef(key: department, name: department),
    );

/// The overrides every clinician screen needs: a signed-in [user], the
/// practice's name for the header, and preferences for anything that parks a
/// draft.
Future<List<Override>> baseOverrides({
  AppUser? user,
  Capabilities? capabilities,
  String clinicName = 'Dey Diabetes & Endocrine Clinic',
}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final signedIn = user ?? previewDoctor();
  return [
    sharedPreferencesProvider.overrideWithValue(prefs),
    secureStoreProvider.overrideWithValue(PreviewStore('preview-token')),
    authRepositoryProvider.overrideWithValue(PreviewAuth(signedIn)),
    brandClinicProvider.overrideWith(
      (ref) async => Clinic(id: 'c1', name: clinicName),
    ),
    capabilitiesProvider.overrideWith(
      (ref) async => capabilities ?? previewCapabilities(),
    ),
  ];
}

final previewBoundary = GlobalKey();

/// The screen inside the app's own theme, localisations and page ground.
Widget previewApp({
  required Widget home,
  required List<Override> overrides,
  double textScale = 1,
  bool ground = true,
}) {
  return ProviderScope(
    overrides: overrides,
    child: RepaintBoundary(
      key: previewBoundary,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder:
            (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(textScale)),
              child: ground ? GlassGround(child: child!) : child!,
            ),
        home: home,
      ),
    ),
  );
}

/// Writes what is on screen to `build/ui_previews/<area>/<name>.png`.
Future<void> capturePreview(
  WidgetTester tester,
  String area,
  String name, {
  double pixelRatio = 2,
}) async {
  // Tests draw every elevation as a solid black outline unless told
  // otherwise, which makes a floating button look ringed in ink. Real shadows
  // for the one frame that is captured, then the test default again — the
  // binding checks it was put back.
  //
  // A reassemble, not a plain pump: nothing is marked dirty by flipping a
  // global, so without it the frame is repainted from the layers already
  // recorded with the outlines in them.
  debugDisableShadows = false;
  unawaited(tester.binding.reassembleApplication());
  await tester.pump();
  try {
    await tester.runAsync(() async {
      final boundary =
          previewBoundary.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: pixelRatio);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      final file = File('build/ui_previews/$area/$name.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(bytes!.buffer.asUint8List());
    });
  } finally {
    debugDisableShadows = true;
    unawaited(tester.binding.reassembleApplication());
    await tester.pump();
  }
}

/// Lets the async providers answer and the first frames settle, without
/// waiting on the timers the screens poll with.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Takes the tree down, which cancels every poll a screen started.
Future<void> leave(WidgetTester tester) =>
    tester.pumpWidget(const SizedBox.shrink());
