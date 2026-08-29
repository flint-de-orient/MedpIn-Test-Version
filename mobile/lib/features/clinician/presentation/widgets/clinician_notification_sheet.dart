import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/area.dart';

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

  /// Captured in initState, not lazily.
  ///
  /// The mark happens as the sheet closes, and both of these have to already
  /// exist by then: `late final` would have run its initialiser inside
  /// dispose() on the ordinary path — open the sheet, read it, swipe it away
  /// without tapping anything — and reading a provider or walking to the
  /// ProviderScope through a context that is being unmounted is exactly what
  /// Flutter asserts against. The badge would have quietly stopped clearing.
  late final ClinicianRepository _repo;
  late final ProviderContainer _container;

  @override
  void initState() {
    super.initState();
    _repo = ref.read(clinicianRepositoryProvider);
    _container = ProviderScope.containerOf(context, listen: false);
  }

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

  /// Where each row leads.
  ///
  /// An alert opens the alerts screen, which is where it can be acted on; a
  /// message opens the patient it came from; a request opens the desk's day,
  /// where a time is given.
  ///
  /// Every destination here was a literal, so the whole sheet was a dead end
  /// for the front desk: the bell counted, the list opened, and every row
  /// pushed into an area the router bounces staff out of. What a receptionist
  /// got for tapping a notification was a blank page with the wrong tab lit.
  ///
  /// The alert and review branches now cannot be reached by staff — the server
  /// stops sending them those rows — but they are still guarded, because the
  /// screens behind them do not exist under `/staff` and a silent bounce is
  /// exactly the failure this is fixing.
  void _open(PanelNotification item) {
    Navigator.of(context).pop();
    final area = areaPrefix(ref);
    final isDesk = area == '/staff';

    switch (item.kind) {
      case 'urgent':
      case 'alert':
        // The doctor gets the alerts screen, where an alert can be resolved.
        //
        // The desk gets the patient. There is no alerts screen in their half
        // of the app and there should not be — resolving an alert is a
        // clinical act. What a receptionist does with "chest pain" is ring the
        // patient or fetch the doctor, and both start from the thread, which
        // has the call button in its header.
        if (isDesk) {
          if (item.patientId.isNotEmpty) {
            context.push('$area/patients/${item.patientId}/thread');
          }
        } else {
          context.push('/clinician/alerts');
        }
      case 'review':
        // Never sent to the desk — a quality check on the assistant's answers
        // is not front-desk work — but guarded, because a silent bounce is the
        // failure this whole method exists to fix.
        if (!isDesk) context.push('/clinician/chat-review');
      case 'request':
        // The request lists live on the desk's Today. `go`, not `push`: it is
        // one of that shell's own tabs.
        context.go(isDesk ? '/staff/today' : '/clinician/appointments');
      default:
        // The conversation, not the record: an unread message is answered in
        // the thread, and landing on the profile makes the doctor find it.
        if (item.patientId.isNotEmpty) {
          context.push('$area/patients/${item.patientId}/thread');
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
