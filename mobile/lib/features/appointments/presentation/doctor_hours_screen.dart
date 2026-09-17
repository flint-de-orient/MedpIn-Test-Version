import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/surfaces.dart';
import '../data/clinic_repository.dart';
import '../domain/clinic.dart';
import '../domain/doctor_hours.dart';
import 'appointment_providers.dart';

const _dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const _dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Monday first, as a week is read here.
const _weekOrder = [1, 2, 3, 4, 5, 6, 0];

const _slotChoices = [10, 15, 20, 30, 45, 60];

/// Each doctor's hours at one location.
///
/// ---- What this is for ------------------------------------------------------------
///
/// A location has opening hours, and until now those were every doctor's hours
/// there: a polyclinic's cardiologist was offered in the dermatologist's
/// sittings, and "Clinic A on Mondays and Wednesdays, Clinic B on Tuesday and
/// Thursday evenings" could not be entered at all. Here each doctor either keeps
/// the clinic's hours or has their own, and the slots patients and the desk book
/// from follow whichever it is.
///
/// Read by anybody at the practice; changed only where the reader manages the
/// location — the server refuses the rest, so this does not offer it.
class DoctorHoursScreen extends ConsumerWidget {
  const DoctorHoursScreen({super.key, required this.clinic});

  final Clinic clinic;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(locationHoursProvider(clinic.id));
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Doctors’ hours')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:
            (_, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(T.s6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Could not load the doctors’ hours.',
                      textAlign: TextAlign.center,
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: T.s3),
                    OutlinedButton(
                      onPressed: () => ref.invalidate(locationHoursProvider(clinic.id)),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            ),
        data:
            (hours) => RefreshIndicator(
              onRefresh: () async => ref.invalidate(locationHoursProvider(clinic.id)),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s8),
                children: [
                  Text(clinic.name, style: T.title),
                  const SizedBox(height: T.s1),
                  Text(
                    'A doctor without hours of their own here is booked in the clinic’s hours.',
                    style: T.small.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  if (!hours.managedByYou) ...[
                    const SizedBox(height: T.s3),
                    InnerTile(
                      child: Row(
                        children: [
                          Icon(Icons.visibility_outlined, color: scheme.onSurfaceVariant),
                          const SizedBox(width: T.s3),
                          Expanded(
                            child: Text(
                              'View only: you do not manage this clinic.',
                              style: T.small.copyWith(color: scheme.onSurfaceVariant),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: T.s4),
                  if (hours.doctors.isEmpty)
                    Text(
                      'No doctors at this practice yet.',
                      style: T.body.copyWith(color: scheme.onSurfaceVariant),
                    )
                  else
                    for (final d in hours.doctors) ...[
                      _DoctorRow(
                        hours: d,
                        onTap:
                            hours.managedByYou
                                ? () async {
                                  final changed = await Navigator.of(context).push<bool>(
                                    MaterialPageRoute(
                                      builder: (_) => DoctorHoursEditor(clinic: clinic, hours: d),
                                    ),
                                  );
                                  if (changed == true) {
                                    ref.invalidate(locationHoursProvider(clinic.id));
                                  }
                                }
                                : null,
                      ),
                      const SizedBox(height: T.s2),
                    ],
                ],
              ),
            ),
      ),
    );
  }
}

/// "Mon 09:00–13:00 · Wed 09:00–13:00", Monday first.
String describeSittings(List<WeeklyHour> sittings) {
  int order(WeeklyHour w) => _weekOrder.indexOf(w.dayOfWeek);
  final sorted = [...sittings]..sort((a, b) {
    final byDay = order(a).compareTo(order(b));
    return byDay != 0 ? byDay : a.start.compareTo(b.start);
  });
  return sorted.map((w) => '${_dayShort[w.dayOfWeek]} ${w.start}–${w.end}').join(' · ');
}

class _DoctorRow extends StatelessWidget {
  const _DoctorRow({required this.hours, required this.onTap});

  final DoctorHours hours;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status =
        hours.usesLocationHours
            ? 'Clinic’s hours'
            : hours.notHere
            ? 'Not at this clinic'
            : '${describeSittings(hours.weeklyHours)} · ${hours.slotMinutes} min';

    return Semantics(
      button: onTap != null,
      label: '${hours.doctorName}, $status',
      excludeSemantics: true,
      child: InnerTile(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: T.tap - T.s6),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(hours.doctorName, style: T.bodyStrong),
                    if ((hours.specialty ?? '').isNotEmpty)
                      Text(hours.specialty!, style: T.small.copyWith(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: T.s1),
                    Text(
                      status,
                      style: T.small.copyWith(
                        color: hours.usesLocationHours ? scheme.onSurfaceVariant : T.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              if (onTap != null) Icon(Icons.chevron_right_rounded, color: scheme.outline),
            ],
          ),
        ),
      ),
    );
  }
}

/// One doctor's own hours at one location: slot length and weekly sittings.
///
/// Returns true to the list when something was saved.
class DoctorHoursEditor extends ConsumerStatefulWidget {
  const DoctorHoursEditor({super.key, required this.clinic, required this.hours});

  final Clinic clinic;
  final DoctorHours hours;

  @override
  ConsumerState<DoctorHoursEditor> createState() => _DoctorHoursEditorState();
}

class _DoctorHoursEditorState extends ConsumerState<DoctorHoursEditor> {
  // A doctor keeping the clinic's hours starts from them, so "the same, but not
  // Fridays" is one tap rather than a week typed out again.
  late int _slotMinutes =
      widget.hours.usesLocationHours ? widget.clinic.slotMinutes : (widget.hours.slotMinutes ?? 15);
  late final List<WeeklyHour> _sittings = [
    ...(widget.hours.usesLocationHours ? widget.clinic.weeklyHours : widget.hours.weeklyHours),
  ];
  bool _saving = false;

  String _fmt(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _add(int day) async {
    final messenger = ScaffoldMessenger.of(context);
    final start = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 0),
      helpText: '${_dayNames[day]}: starts',
    );
    if (start == null || !mounted) return;
    final end = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: (start.hour + 4) % 24, minute: start.minute),
      helpText: '${_dayNames[day]}: ends',
    );
    if (end == null || !mounted) return;
    final s = _fmt(start);
    final e = _fmt(end);
    if (e.compareTo(s) <= 0) {
      messenger.showSnackBar(const SnackBar(content: Text('The end has to be after the start.')));
      return;
    }
    setState(() => _sittings.add(WeeklyHour(dayOfWeek: day, start: s, end: e)));
  }

  Future<void> _save() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);
    try {
      final saved = await ref
          .read(clinicRepositoryProvider)
          .setDoctorHours(
            widget.clinic.id,
            widget.hours.doctorId,
            slotMinutes: _slotMinutes,
            weeklyHours: _sittings,
          );
      if (!mounted) return;
      // Saved: nothing is in flight any more, so no spinner turns behind the
      // dialog below.
      setState(() => _saving = false);
      if (saved.overlaps.isNotEmpty) {
        // Said, not refused: the doctor may be at either on a given day, and it
        // is the bookings that cannot overlap.
        await showDialog<void>(
          context: context,
          builder:
              (ctx) => AlertDialog(
                title: const Text('Saved. The same hours elsewhere'),
                content: Text(
                  [
                    '${widget.hours.doctorName} also sits at:',
                    for (final o in saved.overlaps)
                      '${o.locationName}, ${_dayNames[o.dayOfWeek]} ${o.start}–${o.end}',
                    'They can be booked at only one of them at a time.',
                  ].join('\n'),
                ),
                actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
              ),
        );
      } else {
        messenger.showSnackBar(const SnackBar(content: Text('Hours saved')));
      }
      navigator.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _useClinicHours() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);
    try {
      await ref.read(clinicRepositoryProvider).useLocationHours(widget.clinic.id, widget.hours.doctorId);
      messenger.showSnackBar(const SnackBar(content: Text('Now booked in the clinic’s hours')));
      navigator.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text(widget.hours.doctorName)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s8),
        children: [
          Text('At ${widget.clinic.name}', style: T.title),
          const SizedBox(height: T.s1),
          Text(
            _sittings.isEmpty
                ? 'No sittings: this doctor will not be offered at this clinic.'
                : 'Patients and the desk are offered this doctor only in these hours here.',
            style: T.small.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: T.s6),
          Text('Slot length', style: T.bodyStrong),
          const SizedBox(height: T.s2),
          Wrap(
            spacing: T.s2,
            runSpacing: T.s2,
            children: [
              for (final m in _slotChoices)
                ChoiceChip(
                  label: Text('$m min'),
                  selected: _slotMinutes == m,
                  onSelected: _saving ? null : (_) => setState(() => _slotMinutes = m),
                ),
            ],
          ),
          const SizedBox(height: T.s6),
          Text('Weekly sittings', style: T.bodyStrong),
          const SizedBox(height: T.s2),
          for (final day in _weekOrder) ...[
            _DaySittings(
              day: day,
              sittings:
                  _sittings.where((w) => w.dayOfWeek == day).toList()..sort((a, b) => a.start.compareTo(b.start)),
              onAdd: _saving ? null : () => _add(day),
              onRemove: _saving ? null : (w) => setState(() => _sittings.remove(w)),
            ),
            const SizedBox(height: T.s2),
          ],
          const SizedBox(height: T.s4),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(T.hControl)),
            onPressed: _saving ? null : _save,
            child:
                _saving
                    ? const SizedBox(
                      width: T.s5,
                      height: T.s5,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                    : const Text('Save hours'),
          ),
          if (!widget.hours.usesLocationHours) ...[
            const SizedBox(height: T.s2),
            TextButton(
              style: TextButton.styleFrom(minimumSize: const Size.fromHeight(T.tap)),
              onPressed: _saving ? null : _useClinicHours,
              child: const Text('Use the clinic’s hours instead'),
            ),
          ],
        ],
      ),
    );
  }
}

class _DaySittings extends StatelessWidget {
  const _DaySittings({
    required this.day,
    required this.sittings,
    required this.onAdd,
    required this.onRemove,
  });

  final int day;
  final List<WeeklyHour> sittings;
  final VoidCallback? onAdd;
  final ValueChanged<WeeklyHour>? onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_dayNames[day], style: T.bodyStrong),
                const SizedBox(height: T.s1),
                if (sittings.isEmpty)
                  Text('Not here', style: T.small.copyWith(color: scheme.onSurfaceVariant))
                else
                  Wrap(
                    spacing: T.s2,
                    runSpacing: T.s2,
                    children: [
                      for (final w in sittings)
                        InputChip(
                          label: Text('${w.start}–${w.end}'),
                          onDeleted: onRemove == null ? null : () => onRemove!(w),
                          deleteButtonTooltipMessage: 'Remove ${_dayNames[day]} ${w.start}–${w.end}',
                        ),
                    ],
                  ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Add hours on ${_dayNames[day]}',
            onPressed: onAdd,
            icon: const Icon(Icons.add_circle_outline_rounded),
            color: T.primary,
          ),
        ],
      ),
    );
  }
}
