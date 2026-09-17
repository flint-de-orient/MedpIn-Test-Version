import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/network/submission_keys.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../data/appointment_repository.dart';
import 'appointment_providers.dart';

/// Ask the clinic for an appointment, without choosing a slot.
///
/// The other way to book is to pick a free time from the doctor's published
/// schedule, which confirms immediately. This is for the patient who does not
/// want to read a timetable — "can I see him on Tuesday?" — and it is the shape
/// most people actually ask in.
///
/// A day, an hour if they have one in mind, and why.
///
/// The hour is optional and stays optional. It was left out entirely at first,
/// reasoning that a patient deciding between four and half past would use the
/// slot picker — which is true of the patient who knows the clinic's hours, and
/// not of the one who simply cannot come before six. "Evening if possible" is
/// the commonest thing a receptionist is told on the phone, and there was
/// nowhere to say it.
///
/// It never becomes a booking. The desk picks from the hours the doctor
/// actually keeps; this only says which end of the day to look at first.
///
/// Returns true when a request was sent.
Future<bool> showRequestAppointmentSheet(
  BuildContext context, {
  /// Prefilled when the caller already knows the day — the assistant having
  /// recognised "can I come on Tuesday?" in the thread.
  DateTime? initialDay,
}) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _RequestSheet(initialDay: initialDay),
  );
  return sent == true;
}

class _RequestSheet extends ConsumerStatefulWidget {
  const _RequestSheet({this.initialDay});

  final DateTime? initialDay;

  @override
  ConsumerState<_RequestSheet> createState() => _RequestSheetState();
}

class _RequestSheetState extends ConsumerState<_RequestSheet> {
  /// One per sheet. "Send request" tapped again after a lost answer is the
  /// same request, and the clinic acknowledges it once.
  final _submission = SubmissionKeys();
  final _reason = TextEditingController();
  DateTime? _day;
  TimeOfDay? _time;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _day = widget.initialDay;
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  /// The next few days, offered directly. Most requests are for "soon", and a
  /// calendar for a decision between today and Thursday is three taps where
  /// one would do.
  List<DateTime> get _quickDays {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return [for (var i = 0; i < 5; i++) today.add(Duration(days: i))];
  }

  /// True for one of the three broad chips, so the "pick a time" chip shows a
  /// clock rather than repeating "Morning" back at the reader.
  bool _isPreset(TimeOfDay t) =>
      (t.hour == 10 || t.hour == 14 || t.hour == 18) && t.minute == 0;

  String _label(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final diff = d.difference(today).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Tomorrow';
    return DateFormat('EEE d MMM').format(d);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bottom = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          0,
          AppSpacing.md,
          AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Ask for an appointment',
              style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 2),
            Text(
              // Said plainly, because the difference matters to somebody
              // planning their week: this is a request, and the clinic answers
              // it. Booking a slot yourself is the other flow and is immediate.
              'The clinic will confirm a time and let you know.',
              style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.lg),

            const Text(
              'Which day suits you?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final d in _quickDays)
                  ChoiceChip(
                    label: Text(_label(d)),
                    selected: _day != null && DateUtils.isSameDay(_day, d),
                    onSelected: (_) => setState(() => _day = d),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.calendar_today_rounded, size: 15),
                  label: const Text('Another day'),
                  onPressed: () async {
                    final now = DateTime.now();
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _day ?? now,
                      firstDate: DateTime(now.year, now.month, now.day),
                      lastDate: now.add(const Duration(days: 120)),
                    );
                    if (picked != null) setState(() => _day = picked);
                  },
                ),
              ],
            ),

            const SizedBox(height: AppSpacing.lg),
            const Text(
              'Any particular time?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                // The default, and it is selectable rather than merely implied:
                // "any time" is the answer most people mean, and it should be
                // something they can choose on purpose.
                ChoiceChip(
                  label: const Text('Any time'),
                  selected: _time == null,
                  onSelected: (_) => setState(() => _time = null),
                ),
                // Three broad ones, because that is how it is said out loud.
                // Nobody rings a clinic asking for 10:00; they ask for morning.
                for (final slot in const [
                  ('Morning', TimeOfDay(hour: 10, minute: 0)),
                  ('Afternoon', TimeOfDay(hour: 14, minute: 0)),
                  ('Evening', TimeOfDay(hour: 18, minute: 0)),
                ])
                  ChoiceChip(
                    label: Text(slot.$1),
                    selected: _time == slot.$2,
                    onSelected: (_) => setState(() => _time = slot.$2),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.schedule_rounded, size: 15),
                  label: Text(
                    _time != null && !_isPreset(_time!)
                        ? _time!.format(context)
                        : 'Pick a time',
                  ),
                  onPressed: () async {
                    final picked = await showTimePicker(
                      context: context,
                      initialTime:
                          _time ?? const TimeOfDay(hour: 11, minute: 0),
                    );
                    if (picked != null) setState(() => _time = picked);
                  },
                ),
              ],
            ),

            const SizedBox(height: AppSpacing.lg),
            const Text(
              'What is it about?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _reason,
              textCapitalization: TextCapitalization.sentences,
              minLines: 2,
              maxLines: 4,
              maxLength: 600,
              decoration: const InputDecoration(
                hintText: 'e.g. my sugar readings have been high all week',
                // Optional on purpose. Making somebody explain themselves
                // before they can ask to see a doctor is a barrier in front of
                // the one thing this screen is for.
                helperText: 'Optional, but it helps the clinic prioritise.',
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _error!,
                style: TextStyle(fontSize: 13, color: AppColors.danger),
              ),
            ],

            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _day == null || _sending ? null : _send,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child:
                    _sending
                        ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                        : const Text('Send request'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref
          .read(appointmentRepositoryProvider)
          .requestAppointment(
            preferredFor: _day!,
            preferredTime:
                _time == null
                    ? null
                    : '${_time!.hour.toString().padLeft(2, '0')}:'
                        '${_time!.minute.toString().padLeft(2, '0')}',
            reason: _reason.text.trim(),
            submission: _submission,
          );
      // The patient's own list should show it straight away — a request that
      // does not appear anywhere reads as one that was not sent.
      ref.invalidate(myAppointmentsProvider);
      if (mounted) Navigator.pop(context, true);
      return;
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      // Anything that is not an ApiException — a payload in a shape the parser
      // did not expect, a connection dropped mid-request. The narrow catch let
      // those escape, and with no finally the sheet was left with _sending
      // raised: the Send button greyed out for good, on a sheet that had said
      // nothing about why. "The request does not work" is what that looks
      // like from the outside.
      if (mounted) {
        setState(
          () =>
              _error =
                  'Could not send the request. Please check your connection '
                  'and try again.',
        );
      }
    } finally {
      // Released on every path, including the ones nobody thought of.
      if (mounted) setState(() => _sending = false);
    }
  }
}
