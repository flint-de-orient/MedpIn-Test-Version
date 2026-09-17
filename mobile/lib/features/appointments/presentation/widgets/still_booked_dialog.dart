import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/tokens.dart';
import '../../domain/doctor_hours.dart';

/// Who is still booked at a clinic that has just closed.
///
/// Closing a clinic stops new bookings and cancels nothing, so these patients
/// still hold appointments at a door nobody will open. Nothing tells them; the
/// desk has to, by moving each one or calling it off. The server returns who
/// they are, and this shows them before the screen that closed the clinic goes.
Future<void> showStillBooked(BuildContext context, String clinicName, StillBooked still) {
  final locale = Localizations.localeOf(context).toString();
  const shown = 8;
  final more = still.total - still.items.take(shown).length;

  return showDialog<void>(
    context: context,
    builder:
        (ctx) => AlertDialog(
          title: Text(still.total == 1 ? '1 appointment still booked' : '${still.total} appointments still booked'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$clinicName is closed, and nobody booked there has been told or moved. '
                  'Move each to another clinic or time, or call it off, from Appointments.',
                  style: T.small,
                ),
                const SizedBox(height: T.s3),
                for (final a in still.items.take(shown))
                  Padding(
                    padding: const EdgeInsets.only(bottom: T.s1),
                    child: Text(
                      [
                        a.patientName ?? 'Patient',
                        if (a.scheduledFor != null)
                          DateFormat('EEE d MMM, h:mm a', locale).format(a.scheduledFor!),
                        if ((a.doctorName ?? '').isNotEmpty) a.doctorName!,
                      ].join(' · '),
                      style: T.bodyStrong,
                    ),
                  ),
                if (more > 0) Text('and $more more', style: T.small),
              ],
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
  );
}
