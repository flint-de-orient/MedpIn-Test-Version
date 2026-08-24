import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../dietician_providers.dart';
import 'notification_sheet.dart';

/// Unread patient messages, on the bell, wherever the dietician happens to be.
///
/// It used to live only in the Home header. A dietician working down their
/// patient list or sitting in Profile therefore had no sign at all that a
/// patient had written — the one place the count matters is while you are doing
/// something else.
///
/// It also keeps itself current rather than depending on whichever screen it is
/// mounted in, for the same reason the doctor's does: a badge that silently
/// stops updating is worse than no badge, because it is still believed.
class DieticianBell extends ConsumerStatefulWidget {
  const DieticianBell({super.key});

  @override
  ConsumerState<DieticianBell> createState() => _DieticianBellState();
}

class _DieticianBellState extends ConsumerState<DieticianBell>
    with WidgetsBindingObserver {
  Timer? _poll;
  static const _interval = Duration(seconds: 30);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(_interval, (_) => _tick());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Returning from the background is when the count is most likely stale.
    if (state == AppLifecycleState.resumed) _tick();
  }

  void _tick() {
    if (mounted) ref.invalidate(dietDashboardProvider);
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = AppColors.accentOn(context);
    final count =
        ref.watch(dietDashboardProvider).valueOrNull?.unreadMessages ?? 0;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          onPressed: () => showDieticianNotifications(context),
          icon: const Icon(Icons.notifications_none_rounded),
          color: scheme.onSurface,
          tooltip: count == 0 ? 'No new messages' : '$count unread',
        ),
        if (count > 0)
          Positioned(
            right: 4,
            top: 5,
            child: IgnorePointer(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 5,
                  vertical: 1.5,
                ),
                constraints: const BoxConstraints(minWidth: 18),
                decoration: BoxDecoration(
                  // Blue, not red: these are questions waiting, not
                  // emergencies, and a red badge that appears every time
                  // somebody says thank you teaches the reader to ignore red.
                  color: accent,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: scheme.surface, width: 1.5),
                ),
                child: Text(
                  count > 99 ? '99+' : '$count',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    height: 1.25,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
