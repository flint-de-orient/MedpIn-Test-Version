import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../appointments/data/appointment_repository.dart';
import '../../../appointments/data/clinic_repository.dart';
import '../../../appointments/domain/appointment.dart';
import '../../../appointments/domain/clinic.dart';
import '../../../appointments/presentation/appointment_providers.dart';
import 'desk_geometry.dart';

/// A patient who asked for an appointment and has no time yet.
class RequestCard extends ConsumerStatefulWidget {
  const RequestCard({
    super.key,
    required this.appointment,
    required this.onConfirmed,
  });

  final Appointment appointment;
  final Future<void> Function() onConfirmed;

  @override
  ConsumerState<RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<RequestCard> {
  bool _busy = false;

  /// How long they have been waiting. A request nobody answered for four days
  /// is the one that costs the clinic a patient.
  /// Takes the localisations rather than reaching for a context: this is a
  /// getter on the state, and looking one up is the one thing a getter here
  /// cannot do.
  String _waitedIn(AppLocalizations l10n) {
    final at = widget.appointment.createdAt;
    if (at == null) return '';
    final d = DateTime.now().difference(at);
    if (d.inHours < 1) return l10n.deskAskedAgoMinutes(d.inMinutes);
    if (d.inHours < 24) return l10n.deskAskedAgoHours(d.inHours);
    return l10n.deskAskedAgoDays(d.inDays);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final waited = _waitedIn(l10n);
    final a = widget.appointment;
    final scheme = Theme.of(context).colorScheme;
    // The day name reads in the chosen language too — DateFormat with no
    // locale uses Intl's global default, which is not what MaterialApp sets.
    final locale = Localizations.localeOf(context).toString();
    final stale =
        (a.createdAt != null &&
            DateTime.now().difference(a.createdAt!).inDays >= 1);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: EdgeInsets.all(stale ? AppSpacing.sm + 2 : 0),
      // Only bordered once it has gone stale.
      //
      // The card now sits inside the queue card, so its own outline was a box
      // drawn inside a box — two frames around one patient. The amber border is
      // kept for the request nobody has answered in a day, because that is the
      // one that has to catch an eye scanning past. Not red: nobody is unwell,
      // somebody is unanswered.
      decoration:
          stale
              ? BoxDecoration(
                color: AppColors.warningBgOn(context),
                borderRadius: BorderRadius.circular(kInnerRadius),
                border: Border.all(
                  color: AppColors.warning.withValues(alpha: 0.5),
                ),
              )
              : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UserAvatar(
                name: a.patientName ?? '',
                avatarUrl: a.patientAvatarUrl,
                accent: AppColors.primary,
                size: 38,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      a.patientName ?? 'Patient',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    // How long they have waited, then what they asked for.
                    //
                    // Two lines, not one. Joined with spaces they read as "for
                    // Sun, 30 Aug, 11:00   asked 17h ago" and ran off the edge
                    // of a 360-point screen as "asked 17h…", losing the units
                    // from the only number on the row that decides whether this
                    // is urgent. They are also two different facts: how long we
                    // have kept them waiting, and what they wanted.
                    if (waited.isNotEmpty)
                      Text(
                        waited,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.25,
                          color:
                              stale
                                  ? AppColors.warningOn(context)
                                  : scheme.onSurfaceVariant,
                          fontWeight:
                              stale ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                    if (a.preferredFor != null)
                      Text(
                        // The hour goes with the day, because "Tuesday,
                        // evening" is one answer to one question. Absent when
                        // they said any time — which is most of them, and
                        // printing "any time" would be noise on every row.
                        [
                          'for ${DateFormat('EEE, d MMM', locale).format(a.preferredFor!)}',
                          if (a.preferredTime != null) a.preferredTime!,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.25,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                  ],
                ),
              ),
              if (a.patientPhone != null)
                IconButton(
                  tooltip: l10n.deskCallPatient(a.patientPhone ?? ''),
                  // It now actually calls. This was `onPressed: () {}` — a
                  // button drawn beside a phone number, on the screen where the
                  // desk's whole job is ringing people back, that did nothing
                  // at all when pressed.
                  onPressed:
                      () => launchUrl(
                        Uri(scheme: 'tel', path: a.patientPhone),
                      ),
                  icon: Icon(
                    Icons.call_outlined,
                    color: AppColors.primary,
                    size: 20,
                  ),
                ),
            ],
          ),
          if ((a.reason ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              a.reason!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, height: 1.35),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          // The same trap as the header, and worse here: a Row of
          // [TextButton, Spacer, FilledButton] where the filled one demands
          // infinite width leaves nothing for the Spacer, and an overflowing
          // Row drops its last child without a word — so "Give a time", the
          // only action on this card that matters, was the one at risk of not
          // being drawn at all.
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : _decline,
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onSurfaceVariant,
                  minimumSize: const Size(0, AppSpacing.minTapTarget),
                ),
                child: Text(l10n.deskDecline),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Expanded rather than a Spacer: the action takes the room that
              // is left instead of competing for it, and a longer label in
              // Hindi or Bengali makes the button wider, never the row.
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _pickTime,
                  icon:
                      _busy
                          ? const SizedBox(
                            width: 15,
                            height: 15,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                          : const Icon(Icons.event_available_rounded, size: 18),
                  label: Text(l10n.deskOfferTime),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, AppSpacing.minTapTarget),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(
                        AppSpacing.buttonRadius,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _decline() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: Text(l10n.deskDeclineTitle),
            // The name is not interpolated into the sentence any more: word
            // order round a subject differs by language, and a template with
            // the name welded to the front of an English clause cannot be
            // translated without rewriting it.
            content: Text(l10n.deskDeclineBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(l10n.deskKeepIt),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Decline'),
              ),
            ],
          ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .cancel(widget.appointment.id);
      await widget.onConfirmed();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Choose the clinic, the day and a free slot, then confirm.
  Future<void> _pickTime() async {
    final l10n = AppLocalizations.of(context);
    // Captured before the first await, with the messenger, for the same
    // reason: the sheet and the network call both sit between here and the
    // snackbar, and this widget may be gone by then.
    final locale = Localizations.localeOf(context).toString();
    final messenger = ScaffoldMessenger.of(context);
    final clinics = await ref.read(clinicRepositoryProvider).list();
    final open = clinics.where((c) => c.isActive).toList();
    if (!mounted) return;

    if (open.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.deskNoActiveClinic)));
      return;
    }

    final picked = await showModalBottomSheet<({Clinic clinic, DateTime at})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder:
          (ctx) => SlotPicker(
            clinics: open,
            // Their preferred day is where the picker opens — the desk is
            // answering a request, not booking from scratch.
            initialDay: widget.appointment.preferredFor,
          ),
    );
    if (picked == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await _confirm(picked, allowSameDay: false);
    } on ApiException catch (e) {
      // The patient already has a slot that day. Not refused — the desk is
      // shown the time they already have and decides, because a morning review
      // and an evening procedure on one day is something clinics do.
      final clash =
          e.statusCode == 409
              ? e.details
                  .where((d) => d.path == 'SAME_DAY_APPOINTMENT')
                  .firstOrNull
              : null;

      if (clash != null && mounted) {
        final existing = DateTime.tryParse(clash.message)?.toLocal();
        final goAhead = await showDialog<bool>(
          context: context,
          builder:
              (ctx) => AlertDialog(
                title: Text(l10n.deskAlreadyBookedTitle),
                content: Text(
                  existing == null
                      ? l10n.deskAlreadyBookedBody
                      : l10n.deskAlreadyBookedAt(
                        DateFormat('h:mm a', locale).format(existing),
                      ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: Text(l10n.commonCancel),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: Text(l10n.deskBookAnyway),
                  ),
                ],
              ),
        );

        if (goAhead == true) {
          try {
            await _confirm(picked, allowSameDay: true);
          } on ApiException catch (e2) {
            messenger.showSnackBar(SnackBar(content: Text(e2.message)));
          }
        }
      } else {
        // The server re-checks the slot, so "just taken" arrives here rather
        // than as a double booking.
        messenger.showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The confirm itself, so the retry after "book anyway" is the same call with
  /// one flag changed rather than a second copy of it.
  Future<void> _confirm(
    ({Clinic clinic, DateTime at}) picked, {
    required bool allowSameDay,
  }) async {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();
    final messenger = ScaffoldMessenger.of(context);

    await ref
        .read(appointmentRepositoryProvider)
        .confirmRequest(
          widget.appointment.id,
          clinicId: picked.clinic.id,
          scheduledFor: picked.at,
          allowSameDay: allowSameDay,
        );
    await widget.onConfirmed();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          '${l10n.deskConfirmedFor(DateFormat('EEE d MMM, h:mm a', locale).format(picked.at))} '
          '${l10n.deskPatientTold}',
        ),
      ),
    );
  }
}

/// Clinic, day, and one of the free slots the schedule actually offers.
class SlotPicker extends ConsumerStatefulWidget {
  const SlotPicker({super.key, required this.clinics, this.initialDay});

  final List<Clinic> clinics;
  final DateTime? initialDay;

  @override
  ConsumerState<SlotPicker> createState() => _SlotPickerState();
}

class _SlotPickerState extends ConsumerState<SlotPicker> {
  late Clinic _clinic = widget.clinics.first;
  late DateTime _day = _atLeastToday(widget.initialDay ?? DateTime.now());

  static DateTime _atLeastToday(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final asked = DateTime(d.year, d.month, d.day);
    // A request for a day that has since passed opens on today rather than in
    // the past, where there is nothing to offer.
    return asked.isBefore(today) ? today : asked;
  }

  String get _dayKey => DateFormat('yyyy-MM-dd').format(_day);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final slots = ref.watch(
      slotDayProvider((clinicId: _clinic.id, date: _dayKey)),
    );

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      maxChildSize: 0.95,
      builder:
          (ctx, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.lg,
            ),
            children: [
              Text(
                // The sheet keeps the descriptive phrase; the button that
                // opens it is one word, because it sits beside "Decline" and a
                // pair of actions reads fastest when they are the same length.
                l10n.deskGiveTime,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                l10n.deskOnlyAvailable,
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.md),

              if (widget.clinics.length > 1) ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final c in widget.clinics)
                      ChoiceChip(
                        label: Text(c.name),
                        selected: c.id == _clinic.id,
                        onSelected: (_) => setState(() => _clinic = c),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
              ],

              Row(
                children: [
                  Expanded(
                    child: Text(
                      DateFormat('EEEE, d MMMM').format(_day),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () async {
                      final now = DateTime.now();
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _day,
                        firstDate: DateTime(now.year, now.month, now.day),
                        lastDate: now.add(const Duration(days: 120)),
                      );
                      if (d != null) setState(() => _day = d);
                    },
                    icon: const Icon(Icons.calendar_today_rounded, size: 16),
                    label: Text(l10n.deskChange),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),

              slots.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Text(
                        l10n.deskCouldNotLoadTimes,
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    ),
                data: (day) {
                  final free = day.slots.where((s) => s.available).toList();
                  if (free.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 28),
                      child: Column(
                        children: [
                          Icon(
                            Icons.event_busy_outlined,
                            size: 40,
                            color: scheme.outlineVariant,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            l10n.deskNoFreeTimes,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            l10n.deskTryAnotherDay,
                            style: TextStyle(
                              fontSize: 13,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in free)
                        ActionChip(
                          label: Text(s.time),
                          onPressed:
                              () => Navigator.pop(ctx, (
                                clinic: _clinic,
                                at: DateTime.parse(s.iso).toLocal(),
                              )),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
    );
  }
}

/// One booked appointment in today's list.
