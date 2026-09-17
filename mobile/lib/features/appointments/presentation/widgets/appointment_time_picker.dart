import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../data/clinic_repository.dart';
import '../../domain/clinic.dart';
import '../appointment_providers.dart';
import '../../../../shared/widgets/surfaces.dart';

/// When an appointment is, and where. [clinic] is null at a practice with no
/// open location, where the appointment is at no location at all.
typedef PickedTime = ({Clinic? clinic, DateTime at});

/// Choose a time for an appointment, asking only what the practice's locations
/// make a question.
///
/// ---- Location is optional -------------------------------------------------
///
/// This was a slot picker that needed at least one open location, and every
/// caller refused to go further without one: "No active clinic to book into.
/// Add one in Profile." A solo doctor who sees patients in their own rooms has
/// no location to add, and was told to invent one before they could give a
/// patient a time. So:
///
///   none open   → a day and a time, chosen freely — there are no published
///                 hours to choose from, and the server checks the doctor's own
///                 diary instead
///   one         → that location's free slots, with nothing to pick between
///   several     → the same, with the locations to choose from
///
/// Counted among the locations the reader runs (`managedByYou`), so a
/// receptionist who runs one branch of two is not asked which.
///
/// Returns null when the reader backs out, or when every open location is
/// somebody else's — which it says, rather than opening a picker the server
/// will refuse. A failure to read the locations is thrown, for the caller to
/// show where it shows its other errors.
Future<PickedTime?> pickAppointmentTime(
  BuildContext context,
  WidgetRef ref, {
  DateTime? initialDay,
  String? preferClinicId,
  String? title,
}) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);

  final all = await ref.read(clinicRepositoryProvider).list();
  if (!context.mounted) return null;

  final (:open, :choice) = locationChoice(all);
  if (choice == LocationChoice.none && all.any((c) => c.isActive)) {
    messenger.showSnackBar(
      SnackBar(content: Text(l10n.deskNoClinicYouManage)),
    );
    return null;
  }

  return showModalBottomSheet<PickedTime>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder:
        (_) =>
            choice == LocationChoice.none
                ? FreeTimePicker(initialDay: initialDay, title: title)
                : SlotPicker(
                  clinics: open,
                  initialDay: initialDay,
                  initialClinicId: preferClinicId,
                  title: title,
                ),
  );
}

/// A request for a day that has since passed opens on today rather than in the
/// past, where there is nothing to offer.
DateTime _atLeastToday(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final asked = DateTime(d.year, d.month, d.day);
  return asked.isBefore(today) ? today : asked;
}

/// Location, day, and one of the free slots the schedule actually offers.
class SlotPicker extends ConsumerStatefulWidget {
  const SlotPicker({
    super.key,
    required this.clinics,
    this.initialDay,
    this.initialClinicId,
    this.title,
  });

  /// The open locations the reader runs. At least one.
  final List<Clinic> clinics;
  final DateTime? initialDay;

  /// Where the picker opens — the location an appointment being moved is at.
  final String? initialClinicId;

  /// What the sheet is for. Defaults to giving a request a time.
  final String? title;

  @override
  ConsumerState<SlotPicker> createState() => _SlotPickerState();
}

class _SlotPickerState extends ConsumerState<SlotPicker> {
  late Clinic _clinic = widget.clinics.firstWhere(
    (c) => c.id == widget.initialClinicId,
    orElse: () => widget.clinics.first,
  );
  late DateTime _day = _atLeastToday(widget.initialDay ?? DateTime.now());

  String get _dayKey => DateFormat('yyyy-MM-dd').format(_day);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();
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
            padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s6),
            children: [
              Text(widget.title ?? l10n.deskGiveTime, style: T.title),
              const SizedBox(height: T.s1),
              Text(
                l10n.deskOnlyAvailable,
                style: T.small.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: T.s4),

              // Several locations are a choice. One is only named: there is
              // nothing to pick between, and a row of one chip reads as a
              // question with a single answer.
              if (widget.clinics.length > 1)
                Wrap(
                  spacing: T.s2,
                  runSpacing: T.s2,
                  children: [
                    for (final c in widget.clinics)
                      ChoiceChip(
                        label: Text(c.name),
                        selected: c.id == _clinic.id,
                        onSelected: (_) => setState(() => _clinic = c),
                      ),
                  ],
                )
              else
                Row(
                  children: [
                    Icon(
                      Icons.location_on_outlined,
                      size: 20,
                      color: scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: T.s2),
                    Expanded(child: Text(_clinic.name, style: T.bodyStrong)),
                  ],
                ),
              const SizedBox(height: T.s4),

              _DayRow(
                label: DateFormat('EEEE, d MMMM', locale).format(_day),
                action: l10n.deskChange,
                onPick: (d) => setState(() => _day = d),
                initial: _day,
              ),
              const SizedBox(height: T.s2),

              slots.when(
                loading:
                    () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: T.s8),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                error:
                    (_, _) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: T.s8),
                      child: Text(
                        l10n.deskCouldNotLoadTimes,
                        style: T.body.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                data: (day) {
                  final free = day.slots.where((s) => s.available).toList();
                  if (free.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: T.s6),
                      child: Column(
                        children: [
                          Icon(
                            Icons.event_busy_outlined,
                            size: 40,
                            color: scheme.outlineVariant,
                          ),
                          const SizedBox(height: T.s2),
                          Text(
                            l10n.deskNoFreeTimes,
                            textAlign: TextAlign.center,
                            style: T.bodyStrong.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            l10n.deskTryAnotherDay,
                            textAlign: TextAlign.center,
                            style: T.small.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  return Wrap(
                    spacing: T.s2,
                    runSpacing: T.s2,
                    children: [
                      for (final s in free)
                        ActionChip(
                          label: Text(s.time),
                          onPressed:
                              () => Navigator.pop<PickedTime>(ctx, (
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

/// A day and a time, at a practice where no location publishes hours.
///
/// Nothing here is checked against a schedule, because there is none; the
/// server refuses a time the doctor is already committed to, and this refuses
/// only a time that has already gone.
class FreeTimePicker extends StatefulWidget {
  const FreeTimePicker({super.key, this.initialDay, this.title});

  final DateTime? initialDay;
  final String? title;

  @override
  State<FreeTimePicker> createState() => _FreeTimePickerState();
}

class _FreeTimePickerState extends State<FreeTimePicker> {
  late DateTime _day = _atLeastToday(widget.initialDay ?? DateTime.now());
  TimeOfDay? _time;

  DateTime? get _at =>
      _time == null
          ? null
          : DateTime(
            _day.year,
            _day.month,
            _day.day,
            _time!.hour,
            _time!.minute,
          );

  bool get _passed => _at != null && !_at!.isAfter(DateTime.now());

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked != null && mounted) setState(() => _time = picked);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final locale = Localizations.localeOf(context).toString();

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          T.s4,
          0,
          T.s4,
          T.s4 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title ?? l10n.deskGiveTime, style: T.title),
            const SizedBox(height: T.s1),
            Text(
              l10n.deskNoPublishedHours,
              style: T.small.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: T.s4),
            _DayRow(
              label: DateFormat('EEEE, d MMMM', locale).format(_day),
              action: l10n.deskChange,
              onPick: (d) => setState(() => _day = d),
              initial: _day,
            ),
            const SizedBox(height: T.s2),
            InnerTile(
              onTap: _pickTime,
              child: Row(
                children: [
                  Icon(Icons.schedule_rounded, color: scheme.onSurfaceVariant),
                  const SizedBox(width: T.s3),
                  Expanded(
                    child: Text(
                      _time == null ? l10n.deskPickTime : _time!.format(context),
                      style: T.bodyStrong,
                    ),
                  ),
                  Text(
                    l10n.deskChange,
                    style: T.small.copyWith(
                      color: T.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            // Said in words, beside the disabled button, so the reason it does
            // not work is not left to the colour of a button.
            if (_passed) ...[
              const SizedBox(height: T.s2),
              Text(
                l10n.deskTimeInPast,
                style: T.small.copyWith(color: T.danger),
              ),
            ],
            const SizedBox(height: T.s4),
            FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(T.hControl),
              ),
              onPressed:
                  _at == null || _passed
                      ? null
                      : () => Navigator.pop<PickedTime>(context, (
                        clinic: null,
                        at: _at!,
                      )),
              child: Text(l10n.deskUseThisTime),
            ),
          ],
        ),
      ),
    );
  }
}

/// The chosen day, and the way to choose another.
class _DayRow extends StatelessWidget {
  const _DayRow({
    required this.label,
    required this.action,
    required this.onPick,
    required this.initial,
  });

  final String label;
  final String action;
  final ValueChanged<DateTime> onPick;
  final DateTime initial;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InnerTile(
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: initial,
          firstDate: DateTime(now.year, now.month, now.day),
          lastDate: now.add(const Duration(days: 120)),
        );
        if (picked != null) onPick(picked);
      },
      child: Row(
        children: [
          Icon(Icons.calendar_today_rounded, color: scheme.onSurfaceVariant),
          const SizedBox(width: T.s3),
          Expanded(child: Text(label, style: T.bodyStrong)),
          Text(
            action,
            style: T.small.copyWith(
              color: T.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
