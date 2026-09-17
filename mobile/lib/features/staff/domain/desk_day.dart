import '../../appointments/domain/appointment.dart';
import '../../../shared/widgets/notification_list_sheet.dart';

/// The front desk's day, sorted into the questions the desk asks of it.
///
/// Worked out here, away from the widgets, because every number on the Today
/// screen is a claim somebody at the counter acts on — "nobody else is booked
/// this evening", "three people are waiting for a time" — and a claim is worth
/// testing on its own rather than by reading pixels.
///
/// ---- What it will not say ----------------------------------------------
///
/// Nothing in here counts a status this app does not record. Arrivals are
/// shown when the server reports a check-in, and never counted as zero when it
/// does not: the clinic may be marking arrivals somewhere else entirely, and a
/// tile reading "0 arrived" on a full waiting room is the lie the old screen
/// told.
class DeskDay {
  DeskDay._({
    required this.comingIn,
    required this.inClinic,
    required this.booked,
    required this.seen,
    required this.didNotCome,
    required this.cancelled,
  });

  /// Sorts today's diary.
  ///
  /// [today] is every appointment with a time today, cancellations included.
  /// [now] is passed in rather than read, so a test can stand at any hour.
  factory DeskDay.from(List<Appointment> today, {required DateTime now}) {
    final live = today.where((a) => a.scheduledFor != null).toList();

    // Still to come: a confirmed booking whose slot has not ended. Someone five
    // minutes late for a 6:30 is still expected at 6:35, and dropping them
    // from the list the moment their time passes is how a desk turns away a
    // patient who is walking in through the door.
    final comingIn =
        live.where((a) {
            if (a.status != 'confirmed') return false;
            final ends = a.scheduledFor!.add(
              Duration(
                minutes: a.durationMinutes <= 0 ? 15 : a.durationMinutes,
              ),
            );
            return ends.isAfter(now);
          }).toList()
          ..sort((a, b) => a.scheduledFor!.compareTo(b.scheduledFor!));

    // In the building, as far as the server knows. Token order when there are
    // tokens, because that is the order the room is called in.
    final inClinic =
        live
            .where(
              (a) => a.status == 'checked_in' || a.status == 'in_consultation',
            )
            .toList()
          ..sort((a, b) {
            // With the doctor first: that is who the room is waiting on.
            final aIn = a.status == 'in_consultation' ? 0 : 1;
            final bIn = b.status == 'in_consultation' ? 0 : 1;
            if (aIn != bIn) return aIn - bIn;
            final at = a.queueNumber;
            final bt = b.queueNumber;
            if (at != null && bt != null) return at.compareTo(bt);
            return a.scheduledFor!.compareTo(b.scheduledFor!);
          });

    int count(bool Function(Appointment) test) => live.where(test).length;

    return DeskDay._(
      comingIn: comingIn,
      inClinic: inClinic,
      booked: count((a) => a.status != 'cancelled' && a.status != 'requested'),
      seen: count((a) => a.status == 'completed'),
      didNotCome: count((a) => a.status == 'no_show'),
      cancelled: count((a) => a.status == 'cancelled'),
    );
  }

  /// Confirmed and still expected today, earliest first.
  final List<Appointment> comingIn;

  /// Checked in or with the doctor, as reported by the server.
  final List<Appointment> inClinic;

  /// Everything with a time today that was not called off.
  final int booked;
  final int seen;
  final int didNotCome;
  final int cancelled;

  bool get nothingBooked => booked == 0 && cancelled == 0;

  /// The appointment the desk should be ready for, if there is one.
  Appointment? get next => comingIn.isEmpty ? null : comingIn.first;
}

/// Requests with no time yet, longest-waiting first.
///
/// A request from last Tuesday that nobody answered is more urgent than one
/// from this morning, not less — so it goes to the top of the pile, and the
/// pile is never filtered by date.
List<Appointment> requestsLongestWaitingFirst(List<Appointment> requests) {
  final sorted = [...requests];
  sorted.sort((a, b) {
    final at = a.createdAt;
    final bt = b.createdAt;
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return at.compareTo(bt);
  });
  return sorted;
}

/// One patient's unread messages, collapsed into one row.
class UnreadThread {
  const UnreadThread({
    required this.patientId,
    required this.patientName,
    required this.avatarUrl,
    required this.latest,
    required this.at,
    required this.count,
    required this.nutrition,
  });

  final String patientId;
  final String patientName;
  final String? avatarUrl;

  /// The newest thing they wrote.
  final String latest;
  final DateTime? at;

  /// How many of their messages are in the feed. Never more than the feed
  /// holds, which is capped server-side; the section's own total comes from
  /// the server's count, not from adding these up.
  final int count;

  /// Written in the dietician's thread rather than the care thread.
  final bool nutrition;
}

/// The desk's feed, sorted: who reported something urgent, and who wrote in.
class DeskFeed {
  DeskFeed._({required this.urgent, required this.threads});

  factory DeskFeed.from(List<PanelNotification> items) {
    final urgent =
        items.where((i) => i.kind == 'urgent').toList()
          ..sort((a, b) => _newestFirst(a.at, b.at));

    final messages =
        items
            .where((i) => i.kind == 'message' || i.kind == 'nutrition')
            .toList()
          ..sort((a, b) => _newestFirst(a.at, b.at));

    // One row per patient and thread, newest message on top. Six messages from
    // one anxious patient are one conversation to answer, not six rows pushing
    // everybody else off the screen.
    final byKey = <String, List<PanelNotification>>{};
    for (final m in messages) {
      final key = '${m.patientId}|${m.kind}';
      byKey.putIfAbsent(key, () => []).add(m);
    }
    final threads = [
      for (final group in byKey.values)
        UnreadThread(
          patientId: group.first.patientId,
          patientName: group.first.patientName,
          avatarUrl: group.first.avatarUrl,
          latest: group.first.text,
          at: group.first.at,
          count: group.length,
          nutrition: group.first.kind == 'nutrition',
        ),
    ]..sort((a, b) => _newestFirst(a.at, b.at));

    return DeskFeed._(urgent: urgent, threads: threads);
  }

  /// Urgent and emergency reports, newest first.
  final List<PanelNotification> urgent;

  /// Unread messages, one row per patient, newest first.
  final List<UnreadThread> threads;
}

int _newestFirst(DateTime? a, DateTime? b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b.compareTo(a);
}
