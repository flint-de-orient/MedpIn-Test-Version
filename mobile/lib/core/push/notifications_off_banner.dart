import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/services/notification_service.dart';
import '../../shared/services/reminder_reliability.dart';
import '../theme/app_colors.dart';
import 'push_service.dart';

/// Whether this phone will show MedPin's notifications, and the two ways to
/// turn them on. A provider so a test can stand in for the phone.
class NotificationGate {
  const NotificationGate();

  Future<NotificationBlock?> whatBlocks() =>
      NotificationService.instance.whatBlocksMessages();

  /// Android's own prompt. True when notifications are allowed afterwards.
  Future<bool> ask() => NotificationService.instance.askToShowNotifications();

  Future<void> openSettings(NotificationBlock block) =>
      ReminderReliability.openNotificationSettings(
        channelId:
            block == NotificationBlock.channel
                ? NotificationService.updatesChannelId
                : null,
      );
}

final notificationGateProvider = Provider<NotificationGate>(
  (ref) => const NotificationGate(),
);

/// A strip across the top of every screen while this phone will not show
/// MedPin's notifications, for anyone signed in.
///
/// Nothing said so before. The only warning was on the patient's medicine
/// card, and a doctor or the front desk had none. A copy of the app whose
/// permission prompt was dismissed or refused (Android asks twice at most)
/// looked exactly like one that worked, and every message, reply and
/// emergency alert to it was dropped without a trace.
///
/// "Turn on" asks again where Android still allows it, and otherwise opens
/// the phone's notification settings. The strip checks again whenever the app
/// comes back to the foreground, so it goes away once notifications are on.
/// Closing it hides it until the app is next opened.
class NotificationsOffBanner extends ConsumerStatefulWidget {
  const NotificationsOffBanner({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<NotificationsOffBanner> createState() =>
      _NotificationsOffBannerState();
}

class _NotificationsOffBannerState extends ConsumerState<NotificationsOffBanner>
    with WidgetsBindingObserver {
  NotificationBlock? _block;
  bool _hidden = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (_signedIn) _check();
  }

  bool get _signedIn => ref.read(authControllerProvider).user != null;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _signedIn) _check();
  }

  Future<void> _check() async {
    final block = await ref.read(notificationGateProvider).whatBlocks();
    if (!mounted || block == _block) return;
    setState(() => _block = block);
  }

  Future<void> _turnOn() async {
    final block = _block;
    if (block == null) return;
    final gate = ref.read(notificationGateProvider);
    if (block == NotificationBlock.app && await gate.ask()) {
      await _check();
      // Registered now, not at the next launch.
      await ref.read(pushServiceProvider).refresh();
      return;
    }
    // Checked again when the person comes back from settings.
    await gate.openSettings(block);
  }

  @override
  Widget build(BuildContext context) {
    // Signing in is when the app asks for the permission, so check again then.
    ref.listen(authControllerProvider.select((s) => s.user?.id), (_, id) {
      if (id != null) _check();
    });
    final signedIn = ref.watch(
      authControllerProvider.select((s) => s.user != null),
    );
    final show = signedIn && _block != null && !_hidden;

    // The same shape whether or not the strip shows. [widget.child] is the
    // whole app's navigator, and moving it elsewhere in the tree would close
    // every open screen when the strip appeared or went away.
    return Column(
      children: [
        if (show)
          _Strip(
            onTurnOn: _turnOn,
            onHide: () => setState(() => _hidden = true),
          )
        else
          const SizedBox.shrink(),
        Expanded(
          key: const ValueKey('app'),
          child: MediaQuery.removePadding(
            context: context,
            // The strip already sits below the status bar.
            removeTop: show,
            // Its own semantics container. Every route puts a BlockSemantics
            // barrier in front of what came before it in the same container,
            // and without this the strip counted as "before", so a screen
            // reader never announced it.
            child: Semantics(container: true, child: widget.child),
          ),
        ),
      ],
    );
  }
}

class _Strip extends StatelessWidget {
  const _Strip({required this.onTurnOn, required this.onHide});

  final VoidCallback onTurnOn;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    // Material, because this sits above the navigator and outside any
    // Scaffold. No tooltips either: there is no Overlay up here to show one.
    return Material(
      color: AppColors.warningBg,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
          child: Row(
            children: [
              const Icon(
                Icons.notifications_off_rounded,
                color: AppColors.warning,
                size: 22,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      l10n.notifOffTitle,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.warningInk,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.notifOffBody,
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        color: AppColors.warningInk,
                      ),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: onTurnOn,
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.warning,
                  textStyle: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                child: Text(l10n.notifOffTurnOn),
              ),
              IconButton(
                onPressed: onHide,
                icon: Icon(
                  Icons.close_rounded,
                  size: 20,
                  color: AppColors.warningInk,
                  semanticLabel: l10n.notifOffNotNow,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
