// The clinic's inboxes on an ordinary busy day: patients writing to the care
// team, the assistant answering, a flagged thread, the dietician's threads.
import 'package:akd_care/features/clinician/domain/chat_review.dart';
import 'package:akd_care/features/clinician/domain/chat_summary.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/shared/models/paged.dart';

DateTime _ago(Duration d) => DateTime.now().subtract(d);
String _iso(Duration d) => _ago(d).toUtc().toIso8601String();

String get clinicToday {
  final n = DateTime.now();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${n.year}-${two(n.month)}-${two(n.day)}';
}

Map<String, dynamic> _summary(
  String name, {
  String urgency = 'routine',
  List<String> reasons = const [],
  bool reviewed = false,
  String source = 'rules',
  String overview = '2 messages from the patient; the assistant replied.',
  List<(String, String)> points = const [],
}) => {
  'id': 'sum-$name',
  'patient': {'id': 'patient-$name', 'name': name},
  'day': clinicToday,
  'highestUrgency': urgency,
  'needsDoctor': reasons.isNotEmpty,
  'reasons': reasons,
  'overview': overview,
  'points': [
    for (final (kind, text) in points)
      {
        'kind': kind,
        'text': text,
        'messageIds': ['m1'],
      },
  ],
  'source': source,
  'reviewed': reviewed,
};

ChatSummaryDay summaryDay(List<Map<String, dynamic>> items) =>
    ChatSummaryDay.fromJson({
      'day': clinicToday,
      'scope': 'mine',
      'kind': 'care',
      'counts': {
        'patients': items.length,
        'needsDoctor': items.where((i) => i['needsDoctor'] == true).length,
        'reviewed': items.where((i) => i['reviewed'] == true).length,
      },
      'items': items,
    });

ChatSummaryDay busySummaries() => summaryDay([
  _summary(
    'Raj Dhara',
    urgency: 'urgent',
    reasons: ['Urgent by triage: chest pain with sweating'],
    source: 'ai',
    overview:
        '3 messages from the patient this morning; the assistant advised '
        'calling the clinic.',
    points: [
      ('symptom', 'Chest pain since the morning, with sweating'),
      ('assistant_answer', 'Told to call the clinic or an ambulance now'),
    ],
  ),
  _summary(
    'Kalyani Bandyopadhyay',
    reasons: ['Stopped metformin on her own', '1 message with no reply'],
    source: 'ai',
    points: [
      ('medication', 'Stopped metformin three days ago because of nausea'),
      ('reading', 'Fasting sugar 182 and 176 on the last two mornings'),
      ('question', 'Should she restart at half the dose?'),
    ],
  ),
  _summary(
    'Sunita Sharma',
    reviewed: true,
    points: [
      ('question', 'Can she take metformin before tomorrow’s blood test?'),
    ],
  ),
  _summary(
    'Arjun Mehta',
    overview: '1 message from the patient; the assistant replied.',
    points: [('diet', 'Asked whether jaggery is safer than sugar')],
  ),
]);

MessagePreview _last(String role, String text, Duration ago, {String? media}) =>
    MessagePreview(preview: text, role: role, at: _ago(ago), mediaType: media);

ChatReviewSession session(
  String id,
  String name, {
  String urgency = 'routine',
  bool flagged = false,
  int unread = 0,
  DateTime? reviewedAt,
  MessagePreview? last,
  String kind = 'care',
}) => ChatReviewSession(
  id: id,
  title: 'Conversation',
  highestUrgency: urgency,
  patientId: 'patient-$name',
  patientName: name,
  flaggedForReview: flagged,
  unreadCount: unread,
  reviewedAt: reviewedAt,
  lastMessage: last,
  lastMessageAt: last?.at,
  kind: kind,
);

Paged<ChatReviewSession> pagedSessions(
  List<ChatReviewSession> items, {
  bool hasMore = false,
}) => Paged(
  items: items,
  page: 1,
  limit: 100,
  total: hasMore ? items.length + 60 : items.length,
  hasMore: hasMore,
);

/// A long practice list: every urgency, read and unread, names long and short,
/// messages long and short.
List<ChatReviewSession> manySessions(int count) {
  const names = [
    'Soumitra Chattopadhyay Bandyopadhyay',
    'Rina Paul',
    'Mohammed Abdul Kalam Azad Siddiqui',
    'Anu',
    'Kalyani Bandyopadhyay',
    'Tapas Kumar Ghosh',
  ];
  const messages = [
    'My sugar was 312 after dinner and I feel very thirsty and tired, should '
        'I take an extra dose of insulin tonight or wait until the morning?',
    'Thank you doctor',
    'Voice message',
    'Is it safe to fast for Navratri with my tablets?',
  ];
  const urgencies = ['routine', 'routine', 'advice', 'urgent', 'emergency'];
  const roles = ['user', 'assistant', 'clinician', 'user'];
  return [
    for (var i = 0; i < count; i++)
      session(
        'm$i',
        names[i % names.length],
        urgency: urgencies[i % urgencies.length],
        flagged: i % 4 == 0,
        unread: i % 3 == 0 ? (i % 7) + 1 : 0,
        reviewedAt:
            i % 4 == 1 ? DateTime.now().subtract(Duration(days: i)) : null,
        last: _last(
          roles[i % roles.length],
          messages[i % messages.length],
          Duration(hours: i * 5),
          media: i % messages.length == 2 ? 'voice' : null,
        ),
      ),
  ];
}

List<ChatReviewSession> flaggedSessions() => [
  session(
    's1',
    'Raj Dhara',
    urgency: 'emergency',
    flagged: true,
    unread: 3,
    last: _last(
      'user',
      'The pain is going to my left arm now',
      const Duration(minutes: 4),
    ),
  ),
  session(
    's2',
    'Kalyani Bandyopadhyay',
    urgency: 'urgent',
    flagged: true,
    unread: 1,
    last: _last(
      'assistant',
      'Please do not restart metformin until the doctor has seen your '
          'readings. I have let the clinic know.',
      const Duration(hours: 1),
    ),
  ),
  session(
    's3',
    'Soumitra Chattopadhyay Bandyopadhyay',
    urgency: 'advice',
    flagged: true,
    last: _last(
      'clinician',
      'Bring the report on Friday',
      const Duration(days: 1),
    ),
  ),
  session(
    's4',
    'Mitali Das',
    flagged: true,
    last: _last(
      'user',
      'Voice message',
      const Duration(days: 3),
      media: 'voice',
    ),
  ),
];

List<ChatReviewSession> nutritionSessions() => [
  session(
    'n1',
    'Anwar Hossain',
    kind: 'nutrition',
    unread: 2,
    urgency: 'urgent',
    last: _last(
      'user',
      'Felt shaky and sweaty after skipping lunch',
      const Duration(minutes: 18),
    ),
  ),
  session(
    'n2',
    'Kavita Mukherjee',
    kind: 'nutrition',
    unread: 1,
    last: _last('user', 'Photo', const Duration(hours: 2), media: 'photo'),
  ),
  session(
    'n3',
    'Bina Sen',
    kind: 'nutrition',
    last: _last(
      'dietician',
      'Swap the white rice at dinner for two rotis',
      const Duration(hours: 5),
    ),
  ),
  session(
    'n4',
    'Paresh Roy',
    kind: 'nutrition',
    last: _last(
      'assistant',
      'Half a cup of cooked oats is about 30 g of carbohydrate.',
      const Duration(days: 2),
    ),
  ),
];

/// One flagged conversation, with every kind of turn the review screen draws.
ChatReviewDetail flaggedDetail() => ChatReviewDetail.fromJson({
  'session': {
    'id': 's2',
    'title': 'Conversation',
    'highestUrgency': 'urgent',
    'patientId': 'patient-kalyani',
    'patientName': 'Kalyani Bandyopadhyay',
    'flaggedForReview': true,
    'kind': 'care',
  },
  'messages': [
    {
      'id': 'm1',
      'seq': 1,
      'role': 'user',
      'content':
          'I stopped my metformin three days ago because it made me feel '
          'sick. Now my morning sugar is 182.',
      'urgency': 'routine',
      'createdAt': _iso(const Duration(hours: 2)),
    },
    {
      'id': 'm2',
      'seq': 2,
      'role': 'assistant',
      'content':
          'Thank you for telling us. **Please do not restart metformin on '
          'your own** until the doctor has seen your readings. Keep checking '
          'your fasting sugar each morning.',
      'urgency': 'urgent',
      'ruleDriven': true,
      'citations': [
        {'title': 'Metformin side effects'},
        {'title': 'High fasting sugar'},
      ],
      'latencyMs': 2400,
      'createdAt': _iso(const Duration(hours: 2)),
    },
    {
      'id': 'm3',
      'seq': 3,
      'role': 'user',
      'content': 'Should I take half a tablet instead?',
      'urgency': 'routine',
      'flaggedByPatient': true,
      'createdAt': _iso(const Duration(hours: 1, minutes: 50)),
    },
    {
      'id': 'm4',
      'seq': 4,
      'role': 'clinician',
      'senderName': 'Dr. Amit Dey',
      'content':
          'Please come in on Friday evening and bring your sugar diary. Take '
          'half a tablet after dinner until then.',
      'urgency': 'routine',
      'pinned': true,
      'createdAt': _iso(const Duration(minutes: 40)),
    },
    {
      'id': 'm5',
      'seq': 5,
      'role': 'user',
      'content': '',
      'deletedForEveryone': true,
      'urgency': 'routine',
      'createdAt': _iso(const Duration(minutes: 30)),
    },
  ],
});

/// The same exchange as the patient thread sees it.
Map<String, dynamic> threadJson({bool empty = false}) => {
  'patient': {'name': 'Kalyani Bandyopadhyay', 'phone': '+919830044444'},
  'items':
      empty
          ? const []
          : [
            {
              'id': 't1',
              'seq': 1,
              'role': 'user',
              'content':
                  'I stopped my metformin three days ago because it made me '
                  'feel sick. Now my morning sugar is 182.',
              'createdAt': _iso(const Duration(hours: 2)),
            },
            {
              'id': 't2',
              'seq': 2,
              'role': 'assistant',
              'content':
                  'Thank you for telling us. Please do not restart metformin '
                  'on your own until the doctor has seen your readings.',
              'urgency': 'urgent',
              'createdAt': _iso(const Duration(hours: 2)),
            },
            {
              'id': 't3',
              'seq': 3,
              'role': 'clinician',
              'senderName': 'Dr. Amit Dey',
              'senderRole': 'doctor',
              'content':
                  'Please come in on Friday evening and bring your sugar diary.',
              'createdAt': _iso(const Duration(minutes: 40)),
            },
          ],
};
