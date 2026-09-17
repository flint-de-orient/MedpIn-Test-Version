import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/clinic_brand.dart';
import '../../../appointments/domain/clinic.dart';
import '../../../appointments/domain/clinic_status.dart';
import '../../../clinician/presentation/clinician_providers.dart';
import '../../../clinician/presentation/widgets/clinic_title.dart';
import '../../../clinician/presentation/widgets/clinician_notification_sheet.dart';
import '../../../clinician/presentation/widgets/inbox_states.dart';

/// Whose clinic this is, whether it is open, and a way to ask again.
class DeskHeader extends ConsumerWidget {
  const DeskHeader({super.key, required this.onRefresh});

  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final clinic = ref.watch(brandClinicProvider).valueOrNull;

    return Row(
      children: [
        Expanded(
          child: ClinicTitle(
            fallback: l10n.deskFrontDesk,
            subtitle: clinic == null ? null : DeskStatusLine(clinic: clinic),
          ),
        ),
        const SizedBox(width: T.s1),
        IconButton(
          tooltip: l10n.deskRefresh,
          onPressed: onRefresh,
          icon: const Icon(Icons.refresh_rounded, color: T.inkMuted),
        ),
        const DeskBell(),
      ],
    );
  }
}

/// "Front desk · Open · Closes 9:00 PM", from the clinic's own hours.
///
/// A receptionist is asked "are you open?" on the phone all day, so this is
/// read from the same weekly hours and one-off closures the booking engine
/// uses. A word always carries the state; the colour only repeats it.
///
/// One wrapping line of text rather than a row of pieces. As a row, the
/// closing time was the piece that got cut — "Closes 9:…" — at the first text
/// size above the default, and it is the one fact on the line that changes.
class DeskStatusLine extends StatelessWidget {
  const DeskStatusLine({super.key, required this.clinic});

  final Clinic clinic;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final status = clinicStatusAt(clinic, DateTime.now());

    final tail =
        status.open && status.closesAt != null
            ? l10n.deskClosesAt(clockTime(context, status.closesAt!))
            : !status.open && status.opensAt != null
            ? l10n.deskOpensAt(clockTime(context, status.opensAt!))
            : null;

    final muted = T.small.copyWith(color: T.inkMuted);
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: '${l10n.deskFrontDesk} · '),
          TextSpan(
            // "Closed", not "Closed today", when nothing opens later: the same
            // answer comes back for a clinic that never opened today and for
            // one whose last sitting ended an hour ago.
            text: status.open ? l10n.deskOpen : l10n.deskClosed,
            style: muted.copyWith(
              color: status.open ? T.success : T.inkMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (tail != null) TextSpan(text: ' · $tail'),
        ],
      ),
      style: muted,
    );
  }
}

/// The bell, counting what the sheet behind it lists.
///
/// The shared bell counts the doctor's overview: every open alert whatever its
/// severity, flagged reviews, and no appointment requests. The desk's sheet
/// lists the desk's feed — urgent reports, requests, messages — so the badge
/// read 5 above a sheet of 8, and never counted the requests that are most of
/// the desk's day. This one counts the feed the sheet shows, from the same
/// answer.
class DeskBell extends ConsumerStatefulWidget {
  const DeskBell({super.key});

  @override
  ConsumerState<DeskBell> createState() => _DeskBellState();
}

class _DeskBellState extends ConsumerState<DeskBell> {
  Timer? _settle;

  @override
  void dispose() {
    _settle?.cancel();
    super.dispose();
  }

  Future<void> _open() async {
    await showClinicianNotifications(context);
    // The sheet marks messages seen as it closes, fire-and-forget. Asking
    // again straight away can beat that write to the server and bring the old
    // number back, so the count is re-read a moment later instead.
    _settle?.cancel();
    _settle = Timer(const Duration(seconds: 2), () {
      if (mounted) ref.invalidate(clinicianNotificationsProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final count =
        ref.watch(clinicianNotificationsProvider).valueOrNull?.unread ?? 0;

    return Semantics(
      button: true,
      label: l10n.deskNotificationsWaiting(count),
      excludeSemantics: true,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          IconButton(
            onPressed: _open,
            icon: const Icon(
              Icons.notifications_none_rounded,
              color: T.inkMuted,
            ),
          ),
          if (count > 0)
            Positioned(
              right: T.s1,
              top: T.s1,
              child: IgnorePointer(
                child: Container(
                  constraints: const BoxConstraints(
                    minWidth: T.s5,
                    minHeight: T.s5,
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: T.s1),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: T.primary,
                    borderRadius: T.rFull,
                    border: Border.all(color: T.surfaceRaised, width: 2),
                  ),
                  child: Text(
                    // Past 99 the exact figure stops being actionable and
                    // starts breaking the circle.
                    count > 99 ? '99+' : '$count',
                    style: T.label.copyWith(
                      color: T.surfaceRaised,
                      letterSpacing: 0,
                      height: 1.2,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
