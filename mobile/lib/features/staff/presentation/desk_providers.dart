import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../appointments/data/appointment_repository.dart';
import '../../appointments/presentation/appointment_providers.dart';

/// How many appointments match [AppointmentQuery], as the server counts them.
///
/// The week's tally used to be worked out by filtering a list the diary caps
/// at a hundred rows. A clinic seeing forty people a day passes a hundred by
/// Wednesday, and from then on the tally quietly under-reported every figure
/// on it. The server's own count for the same filter has no cap, so this asks
/// for one row and reads the total.
final deskCountProvider = FutureProvider.autoDispose
    .family<int, AppointmentQuery>((ref, q) async {
      final page = await ref
          .watch(appointmentRepositoryProvider)
          .list(
            from: q.from,
            to: q.to,
            status: q.status,
            clinicId: q.clinicId,
            limit: 1,
          );
      return page.total;
    });

/// Monday of this week at midnight, to the end of today.
///
/// Not a rolling seven days: "this week" is the week the clinic is in, and a
/// Monday-morning total that still counts last Wednesday answers a different
/// question.
({DateTime from, DateTime to}) weekSoFar(DateTime now) {
  final start = DateTime(now.year, now.month, now.day);
  return (
    from: start.subtract(Duration(days: start.weekday - 1)),
    to: start.add(const Duration(days: 1)),
  );
}
