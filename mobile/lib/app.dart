import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
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
      // The lock gate sits above every route, so it covers the whole app when
      // locked. `child` is the router's current page.
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        // One uniform, slightly-smaller text size across the whole app. Trimmed
        // ~13% and capped at 1.0 so a device set to large fonts can't blow the
        // layout up, while staying comfortably readable (not tiny).
        final scale = (mq.textScaler.scale(1) * 0.87).clamp(0.83, 1.0);
        return MediaQuery(
          data: mq.copyWith(textScaler: TextScaler.linear(scale)),
          child: AppLockGate(child: child ?? const SizedBox.shrink()),
        );
      },
    );
  }
}
