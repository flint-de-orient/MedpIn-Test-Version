import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/widgets/notification_list_sheet.dart';
import '../../data/dietician_repository.dart';
import '../dietician_providers.dart';

/// The dietician's bell, opened.
///
/// Unread patient messages, lapsed reviews, and patients still without a plan.
///
/// The sheet itself is [NotificationListSheet], the same one the doctor's bell
/// opens. This file used to carry its own copy of the header, the rows and the
/// empty state; the two then drifted, and only one of them ever got a fix. What
/// genuinely differs between the panels is the data and where a row leads, and
/// that is all that is passed in here.
Future<void> showDieticianNotifications(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => const _NotificationSheet(),
  );
}

class _NotificationSheet extends ConsumerStatefulWidget {
  const _NotificationSheet();

  @override
  ConsumerState<_NotificationSheet> createState() => _NotificationSheetState();
}

class _NotificationSheetState extends ConsumerState<_NotificationSheet> {
  bool _marked = false;

  /// Captured while the sheet is alive, because the mark happens as it closes
  /// and `ref` is not usable once this State has been disposed.
  late final DieticianRepository _repo = ref.read(dieticianRepositoryProvider);
  late final ProviderContainer _container = ProviderScope.containerOf(
    context,
    listen: false,
  );

  @override
  void dispose() {
    // On the way out, not on the way in. Marked on open, every row lost its
    // unread tint on the second frame — so a dietician reading the sheet could
    // no longer see which of the twelve entries were the new ones, which is
    // the only reason to open it. The badge still clears because somebody
    // looked; they just get to finish looking first.
    if (!_marked) _markSeen();
    super.dispose();
  }

  /// Fire-and-forget: nothing here may touch this State again, since it is
  /// normally called on the way out.
  void _markSeen() {
    _marked = true;
    _repo
        .markNotificationsSeen()
        .then((_) => _container.invalidate(dietDashboardProvider))
        // A badge that fails to clear is a nuisance; an error toast over a
        // sheet the dietician opened to read something else is worse.
        .catchError((_) {});
  }

  /// Clear them now, while the sheet is still open, and show it happening.
  Future<void> _markAllRead() async {
    _marked = true;
    try {
      await _repo.markNotificationsSeen();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    ref.invalidate(dietDashboardProvider);
    ref.invalidate(dietNotificationsProvider);
  }

  /// Where each row leads. An unread message goes to the conversation; the
  /// other two are about the record, so they open it.
  void _open(PanelNotification item) {
    Navigator.of(context).pop();
    switch (item.kind) {
      case 'message':
        context.push(
          '/dietician/patients/${item.patientId}/chat',
          extra: item.patientName,
        );
      case 'plan':
        context.push(
          '/dietician/patients/${item.patientId}/diet',
          extra: item.patientName,
        );
      default:
        context.push(
          '/dietician/patients/${item.patientId}',
          extra: item.patientName,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(dietNotificationsProvider);
    final view = async.valueOrNull;

    return NotificationListSheet(
      items: [
        for (final n in view?.items ?? const [])
          PanelNotification(
            id: n.id,
            kind: n.kind,
            patientId: n.patientId,
            patientName: n.patientName,
            text: n.text,
            avatarUrl: n.avatarUrl,
            at: n.at,
            unread: n.unread,
          ),
      ],
      unread: view?.unread ?? 0,
      loading: async.isLoading,
      failed: view == null && async.hasError,
      onRefresh: () => ref.invalidate(dietNotificationsProvider),
      onMarkAllRead: _markAllRead,
      onOpen: _open,
      emptyBody:
          'No unread messages, no lapsed reviews, and every patient has a plan.',
    );
  }
}
