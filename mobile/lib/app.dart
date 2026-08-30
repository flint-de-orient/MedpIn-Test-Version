import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
import 'core/update/update_available_banner.dart';
import 'core/update/update_required_screen.dart';
import 'core/update/version_gate.dart';
import 'core/theme/app_theme.dart';
import 'l10n/gen/app_localizations.dart';
import 'shared/providers/locale_provider.dart';
import 'shared/providers/preferences_provider.dart';
import 'core/push/push_service.dart';
import 'features/auth/presentation/auth_controller.dart';
import 'features/glucose/presentation/glucose_providers.dart';
import 'features/medications/presentation/medications_providers.dart';
import 'shared/providers/theme_provider.dart';
import 'shared/services/notification_service.dart';
import 'shared/widgets/app_lock_gate.dart';

class App extends ConsumerStatefulWidget {
  const App({super.key});

  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back to the app, pull the latest medications and rebuild the
    // reminders — so a medicine the doctor just prescribed starts reminding
    // without the patient having to open the Track screen.
    if (state == AppLifecycleState.resumed) _syncMedsIfPatient();
  }

  void _syncMedsIfPatient() {
    final user = ref.read(authControllerProvider).user;
    if (user?.role != 'patient') {
      // Cancel, don't just decline to schedule.
      //
      // This returned early for a clinician and left whatever was already on
      // the device armed — so a doctor signing in on a phone that had been a
      // patient's kept getting their dose alarms, hours after the fact. A
      // clinician has no dose reminders of their own, so anything scheduled
      // here belongs to somebody else and must go. Runs on every resume too,
      // which is what clears a leftover the next time the app is opened.
      NotificationService.instance.cancelAllOnSignOut();
      return;
    }
    if (ref.read(appPreferencesProvider).medicationReminders) {
      refreshAndScheduleMedicationReminders(ref).catchError((_) {});
    }
    // Re-arm the adaptive check-in nudge from the latest reading. Honours the
    // toggle internally, so it is safe to call unconditionally for a patient.
    syncCheckInReminder(ref).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    // Register this device for push once someone is signed in, and detach the
    // token on sign-out. A token is only meaningful when the server knows whose
    // device it is, and leaving it attached would send the next person to use a
    // shared phone the previous patient's clinical notifications.
    ref.listen(authControllerProvider, (previous, next) {
      // Keyed on WHO is signed in, not merely whether anyone is.
      //
      // Comparing presence alone missed an account switch: going from patient
      // straight to doctor without an unauthenticated frame in between left
      // both sides true, so neither branch ran — no token detach, and no
      // cancellation of the patient's alarms.
      final wasId = previous?.user?.id;
      final isId = next.user?.id;
      if (wasId == isId) return;

      final wasAuthed = wasId != null;
      final isAuthed = isId != null;
      if (wasAuthed && isAuthed) {
        // A different person on the same device. Tear the old session's
        // notifications down before arming the new one's.
        ref.read(pushServiceProvider).stop();
        NotificationService.instance.cancelAllOnSignOut();
        ref.read(pushServiceProvider).start();
        _syncMedsIfPatient();
      } else if (!wasAuthed && isAuthed) {
        ref.read(pushServiceProvider).start();
        _syncMedsIfPatient();
      } else if (wasAuthed && !isAuthed) {
        ref.read(pushServiceProvider).stop();
        // Everything, not just the dose and check-in reminders: a snoozed dose
        // is scheduled outside the range those sweep, and neither clears the
        // tray. On a shared phone that difference is the previous patient's
        // medicine names on someone else's lock screen.
        NotificationService.instance.cancelAllOnSignOut();
      }
    });

    final router = ref.watch(appRouterProvider);
    final locale = ref.watch(localeControllerProvider);
    // Watching both here is what makes appearance and language change across
    // every screen at once: MaterialApp rebuilds and the new theme and locale
    // propagate down the whole tree, including screens already on the stack.
    // Held to light while the dark palette is finished. The stored preference
    // is still read and written — turning [kDarkThemeEnabled] back on restores
    // whatever each user had chosen, rather than resetting everyone to light.
    final themeMode =
        kDarkThemeEnabled
            ? ref.watch(themeControllerProvider)
            : ThemeMode.light;

    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: kDarkThemeEnabled ? AppTheme.dark() : AppTheme.light(),
      themeMode: themeMode,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      routerConfig: router,
      scrollBehavior: const AppScrollBehavior(),
      // The lock gate sits above every route, so it covers the whole app when
      // locked. `child` is the router's current page.
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        // The phone's own bars, told what kind of app this is.
        //
        // The app is light-only, and nothing here said so to the system. On a
        // handset set to dark mode Android picks its icon colours from the
        // system theme rather than from the page, so the clock and the battery
        // came back white — on a white status bar. Invisible, on every screen,
        // for every user whose phone is in dark mode. The clinic's own phones
        // are, which is why the screenshots have a black bar along the bottom.
        //
        // Stated rather than inherited: this app has one appearance, so it
        // declares it instead of asking. See [kDarkThemeEnabled] for why there
        // is only one to declare.
        // One uniform, slightly-smaller text size across the whole app. Trimmed
        // ~13% and capped at 1.0 so a device set to large fonts can't blow the
        // layout up, while staying comfortably readable (not tiny).
        final scale = (mq.textScaler.scale(1) * 0.87).clamp(0.83, 1.0);
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: const SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            // "Dark" here names the icons, not the bar: dark markings, for a
            // light ground behind them.
            statusBarIconBrightness: Brightness.dark,
            statusBarBrightness: Brightness.light, // iOS spells it the other way
            systemNavigationBarColor: Colors.white,
            systemNavigationBarIconBrightness: Brightness.dark,
            systemNavigationBarDividerColor: Color(0x14000000),
          ),
          child: MediaQuery(
            data: mq.copyWith(textScaler: TextScaler.linear(scale)),
            child: _VersionGate(
              child: AppLockGate(child: child ?? const SizedBox.shrink()),
            ),
          ),
        );
      },
    );
  }
}

/// Overscroll that paints, on every device.
///
/// Material 3 on Android uses [StretchingOverscrollIndicator], which under
/// Impeller wraps the entire scroll view in an `ImageFiltered` built from a
/// fragment shader. On this clinic's phones that filter comes back blank: pull
/// past the top of a list and the whole scrollable area — every card, every
/// reading — turns into one flat grey rectangle until the finger lifts. A
/// record that disappears when a dietician overscrolls it is not a cosmetic
/// problem; the screen is for reading and it stops showing anything.
///
/// The glow indicator draws with ordinary canvas operations, no shader and no
/// image filter, so there is nothing to fail. Set here rather than per screen
/// because a scroll view that behaves differently from the rest of the app is
/// the next bug report.
class AppScrollBehavior extends MaterialScrollBehavior {
  const AppScrollBehavior();

  @override
  Widget buildOverscrollIndicator(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) {
    switch (getPlatform(context)) {
      case TargetPlatform.iOS:
      case TargetPlatform.linux:
      case TargetPlatform.macOS:
      case TargetPlatform.windows:
        return child;
      case TargetPlatform.android:
      case TargetPlatform.fuchsia:
        return GlowingOverscrollIndicator(
          axisDirection: details.direction,
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.35),
          child: child,
        );
    }
  }
}

/// Stops a build the server knows will misbehave, and nothing else.
///
/// Wraps the whole app rather than sitting on one screen, because the builds
/// this catches fail quietly wherever they are used — the point is that they
/// look like they are working.
///
/// While the check is in flight the app is shown as normal. A wall that appears
/// a second after launch on every cold start would be worse than the problem:
/// this is a floor almost nobody is below, and everybody else would pay for it
/// with a flash of the wrong screen.
class _VersionGate extends ConsumerWidget {
  const _VersionGate({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // valueOrNull, so loading and error both mean "carry on". Every failure
    // path in versionStatusProvider already returns all-clear; this is the
    // second half of the same promise — no signal must never mean locked out.
    final status = ref.watch(versionStatusProvider).valueOrNull;
    if (status == null || !status.mustUpdate) {
      // Not blocked. A newer build may still exist, which is a strip they can
      // dismiss rather than a wall — the banner decides for itself whether it
      // has anything to say.
      return UpdateAvailableBanner(child: child);
    }
    return UpdateRequiredScreen(status: status);
  }
}
