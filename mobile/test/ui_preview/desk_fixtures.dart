// A front desk's day, made up but shaped like the real one.
//
// Times are relative to the moment the test runs, because the screens read the
// clock directly: "next at 6:40 PM" has to be in the future whenever the
// preview is drawn, or the preview is of a different state from the one named.
import 'package:medpin/features/appointments/domain/appointment.dart';
import 'package:medpin/features/appointments/domain/clinic.dart';
import 'package:medpin/features/auth/domain/user.dart';
import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/widgets/notification_list_sheet.dart';

typedef DeskNotifications =
    ({
      int unread,
      int messages,
      int alerts,
      int requests,
      List<PanelNotification> items,
    });

DateTime get _now => DateTime.now();
DateTime _today(int hour, int minute) =>
    DateTime(_now.year, _now.month, _now.day, hour, minute);

/// Rounded to the next quarter hour, the way a diary books.
DateTime inMinutes(int minutes) {
  final t = _now.add(Duration(minutes: minutes));
  final q = (t.minute ~/ 15) * 15;
  return DateTime(t.year, t.month, t.day, t.hour, q);
}

/// Open 9 AM to 9 PM every day, so the header has hours to state.
final deskClinic = Clinic(
  id: 'clinic-1',
  name: 'Dr. Dey’s Diabetes Obesity & Metabolic Clinic',
  city: 'Kolkata',
  phone: '033 2466 1234',
  weeklyHours: [
    for (var d = 0; d < 7; d++)
      WeeklyHour(dayOfWeek: d, start: '09:00', end: '21:00'),
  ],
);

const deskUser = AppUser(
  id: 'u-desk',
  name: 'Rupa Ghosh',
  phone: '+919830011111',
  role: 'staff',
  language: 'en',
);

Paged<Appointment> paged(List<Appointment> items) => Paged(
  items: items,
  page: 1,
  limit: 100,
  total: items.length,
  hasMore: false,
);

Appointment booked(
  String id,
  String name,
  DateTime at, {
  String status = 'confirmed',
  String? reason,
  String mode = 'in_clinic',
  int? token,
  String? phone = '+919830022222',
}) => Appointment(
  id: id,
  scheduledFor: at,
  status: status,
  mode: mode,
  patientId: 'p-$id',
  patientName: name,
  patientPhone: phone,
  reason: reason,
  queueNumber: token,
  doctorName: 'Dr. Amit Dey',
  clinicName: deskClinic.name,
  createdAt: at.subtract(const Duration(days: 3)),
);

Appointment request(
  String id,
  String name, {
  required Duration askedAgo,
  DateTime? preferredFor,
  String? preferredTime,
  String? reason,
}) => Appointment(
  id: id,
  status: 'requested',
  mode: 'in_clinic',
  patientId: 'p-$id',
  patientName: name,
  patientPhone: '+919830033333',
  preferredFor: preferredFor,
  preferredTime: preferredTime,
  reason: reason,
  createdAt: _now.subtract(askedAgo),
);

/// A full afternoon: two seen, one in with the doctor, one waiting, four still
/// to come, and a cancellation.
List<Appointment> busyDay() => [
  booked('a1', 'Sunita Sharma', _today(10, 0), status: 'completed'),
  booked('a2', 'Paresh Roy', _today(11, 30), status: 'no_show'),
  booked(
    'a3',
    'Bina Sen',
    inMinutes(-40),
    status: 'in_consultation',
    token: 13,
  ),
  booked(
    'a4',
    'Mitali Das',
    inMinutes(-20),
    status: 'checked_in',
    token: 14,
    reason: 'Sugar review',
  ),
  booked(
    'a5',
    'Ayesha Rahman',
    inMinutes(15),
    reason: 'Fasting sugar 180 all week',
  ),
  booked('a6', 'Soumitra Chattopadhyay Bandyopadhyay', inMinutes(35)),
  booked('a7', 'Anwar Hossain', inMinutes(60), mode: 'teleconsult'),
  booked('a8', 'Rahul Das', inMinutes(75), status: 'cancelled'),
  booked('a9', 'Kavita Mukherjee', inMinutes(90), phone: null),
];

List<Appointment> waitingRequests() => [
  request(
    'r1',
    'Kalyani Bandyopadhyay',
    askedAgo: const Duration(days: 2, hours: 3),
    preferredFor: _now.add(const Duration(days: 1)),
    preferredTime: 'Evening',
    reason: 'Numbness in both feet is getting worse',
  ),
  request(
    'r2',
    'Arjun Mehta',
    askedAgo: const Duration(hours: 3),
    preferredFor: _now.add(const Duration(days: 3)),
  ),
  request('r3', 'Rina Paul', askedAgo: const Duration(minutes: 25)),
];

PanelNotification _note(
  String id,
  String kind,
  String name,
  String text,
  Duration ago,
) => PanelNotification(
  id: id,
  kind: kind,
  patientId: 'p-$name',
  patientName: name,
  text: text,
  at: _now.subtract(ago),
  unread: true,
);

DeskNotifications busyNotifications({bool urgent = true}) {
  final items = [
    if (urgent)
      _note(
        'n0',
        'urgent',
        'Raj Dhara',
        'Chest pain since the morning, sweating',
        const Duration(minutes: 12),
      ),
    for (final r in waitingRequests())
      _note(
        'request-${r.id}',
        'request',
        r.patientName!,
        'Asked for an appointment',
        _now.difference(r.createdAt!),
      ),
    _note(
      'n1',
      'message',
      'Sunita Sharma',
      'Can I take metformin before the blood test tomorrow?',
      const Duration(minutes: 6),
    ),
    _note(
      'n2',
      'message',
      'Sunita Sharma',
      'Also my sugar was 212 after lunch',
      const Duration(minutes: 5),
    ),
    _note(
      'n3',
      'message',
      'Ayesha Rahman',
      'Running ten minutes late, sorry',
      const Duration(minutes: 31),
    ),
    _note(
      'n4',
      'nutrition',
      'Mitali Das',
      'Sent an attachment',
      const Duration(hours: 2),
    ),
  ];
  return (
    unread: urgent ? 8 : 7,
    messages: 4,
    alerts: urgent ? 1 : 0,
    requests: 3,
    items: items,
  );
}

const DeskNotifications quietNotifications = (
  unread: 0,
  messages: 0,
  alerts: 0,
  requests: 0,
  items: <PanelNotification>[],
);

/// What the doctor's overview says, which the shared bell counts from.
ClinicOverview overview({int unread = 0, int alerts = 0}) => ClinicOverview(
  patientCount: 312,
  activeToday: 0,
  appointmentsToday: 0,
  completedToday: 0,
  pendingReviews: 0,
  unreadMessages: unread,
  emergencyAlerts: 0,
  urgentAlerts: alerts,
  warningAlerts: 0,
  totalOpenAlerts: alerts,
  riskLow: 0,
  riskModerate: 0,
  riskHigh: 0,
  riskCritical: 0,
);
