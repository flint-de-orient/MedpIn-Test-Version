import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/widgets/notification_list_sheet.dart';
import '../../data/clinician_repository.dart';
import '../clinician_providers.dart';

/// The doctor's bell, opened.
///
/// Alerts, unread patient messages from both threads, and flagged
/// conversations — the things the overview endpoint was already counting while
/// the bell showed only the first of them.
Future<void> showClinicianNotifications(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => const _ClinicianNotificationSheet(),
  );
}

class _ClinicianNotificationSheet extends ConsumerStatefulWidget {
  const _ClinicianNotificationSheet();

  @override
  ConsumerState<_ClinicianNotificationSheet> createState() => _SheetState();
}

class _SheetState extends ConsumerState<_ClinicianNotificationSheet> {
  bool _marked = false;

  /// Captured while the sheet is alive, because the mark happens as it closes
  /// and `ref` is not usable once this State has been disposed.
  late final ClinicianRepository _repo = ref.read(clinicianRepositoryProvider);
  late final ProviderContainer _container = ProviderScope.containerOf(
    context,
    listen: false,
  );

  @override
  void dispose() {
    // On the way out, not on the way in. Marked on open, every row lost its
    // unread tint on the second frame — so the doctor reading the sheet could
    // no longer see which rows were the new ones, which is the only reason to
    // open it. The badge still clears because somebody looked; they just get
    // to finish looking first.
    if (!_marked) _markSeen();
    super.dispose();
  }

  /// Fire-and-forget: nothing here may touch this State again, since it is
  /// normally called on the way out.
  void _markSeen() {
    _marked = true;
    _repo
        .markNotificationsSeen()
        .then((_) => _container.invalidate(overviewProvider))
        // A badge that fails to clear is a nuisance. An error toast over a
        // sheet the doctor opened to read something else is worse.
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
    ref.invalidate(overviewProvider);
    ref.invalidate(clinicianNotificationsProvider);
  }

  /// Where each row leads. An alert opens the alerts screen, which is where it
  /// can be acted on; a message opens the patient it came from.
  void _open(PanelNotification item) {
    Navigator.of(context).pop();
    switch (item.kind) {
      case 'urgent':
      case 'alert':
        context.push('/clinician/alerts');
      case 'review':
        context.push('/clinician/chat-review');
      default:
        // The conversation, not the record: an unread message is answered in
        // the thread, and landing on the profile makes the doctor find it.
        if (item.patientId.isNotEmpty) {
          context.push('/clinician/patients/${item.patientId}/thread');
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(clinicianNotificationsProvider);
    final view = async.valueOrNull;

    return NotificationListSheet(
      items: view?.items ?? const [],
      unread: view?.unread ?? 0,
      loading: async.isLoading,
      failed: view == null && async.hasError,
      onRefresh: () => ref.invalidate(clinicianNotificationsProvider),
      onMarkAllRead: _markAllRead,
      onOpen: _open,
      emptyBody:
          'No open alerts, no unread messages, nothing flagged for review.',
    );
  }
}
