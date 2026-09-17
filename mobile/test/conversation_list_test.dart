import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/chat/data/chat_repository.dart';
import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/thread_group.dart';
import 'package:medpin/features/chat/presentation/chat_tab.dart';
import 'package:medpin/features/chat/presentation/widgets/thread_picker.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:medpin/shared/data/upload_repository.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';

/// The patient's Doctor tab, read like any messaging app: a face and a name,
/// the last thing said and when, and how many messages are waiting — and a
/// way back to that list from a conversation.

final _now = DateTime(2026, 9, 17, 18, 30);

Map<String, dynamic> _thread(
  String id, {
  required DateTime at,
  String role = 'clinician',
  String? sender = 'Dr Meera Sen',
  String text = 'Please come in on Monday.',
  int unread = 0,
  bool hasAssistant = true,
  bool deleted = false,
  String? attachment,
}) => {
  'id': id,
  'hasAssistant': hasAssistant,
  'messageCount': 4,
  'highestUrgency': 'routine',
  'lastMessageAt': at.toUtc().toIso8601String(),
  'unreadCount': unread,
  'lastMessage': {
    'role': role,
    'senderName': sender,
    'deleted': deleted,
    'text': text,
    'attachment': attachment,
    'at': at.toUtc().toIso8601String(),
  },
};

Map<String, dynamic> _practice(String id, String name, List<Map<String, dynamic>> threads, {String? doctor}) => {
  'practice': {'id': id, 'name': name, 'logoUrl': null},
  'doctor': doctor == null ? null : {'id': 'u-$id', 'name': doctor, 'avatarUrl': null},
  'enrollment': 'e-$id',
  'threads': threads,
  'newConversationHasAssistant': threads.isEmpty ? false : null,
};

ThreadList _twoPractices() => ThreadList.fromJson({
  'groups': [
    _practice('p1', 'Dey Diabetes Clinic', [
      _thread('t1', at: _now.subtract(const Duration(days: 3)), role: 'assistant', sender: null, text: 'Your sugar looks steady.'),
    ], doctor: 'Dr Anil Dey'),
    _practice('p2', 'Behala GP', [
      _thread('t2', at: DateTime(2026, 9, 17, 16, 5), unread: 3),
    ], doctor: 'Dr Meera Sen'),
    _practice('p3', 'Lake Town Heart Centre', []),
  ],
});

Widget _app(Widget child, {List<Override> overrides = const []}) => ProviderScope(
  overrides: [imageAuthHeaderProvider.overrideWith((ref) async => {}), ...overrides],
  child: MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: MediaQuery(
      data: const MediaQueryData(disableAnimations: true),
      child: Scaffold(body: child),
    ),
  ),
);

class _Chats extends ChatRepository {
  _Chats(this.list) : super(ApiClient(secureStore: SecureStore()));

  final ThreadList list;
  final reads = <(String, DateTime)>[];

  final _message = ChatMessage(
    id: 'm1',
    seq: 1,
    role: 'clinician',
    content: 'Please come in on Monday.',
    language: 'en',
    urgency: 'routine',
    createdAt: DateTime.utc(2026, 9, 17, 10, 35),
  );

  @override
  Future<ThreadList> getThreads() async => list;

  @override
  Future<Paged<ChatMessage>> getThread({String? sessionId, int page = 1, int limit = 200}) async =>
      Paged<ChatMessage>(items: [_message], page: 1, limit: limit, total: 1, hasMore: false);

  @override
  Future<void> markThreadRead(String sessionId, {required DateTime upTo}) async => reads.add((sessionId, upTo));
}

class _NoUploads extends UploadRepository {
  _NoUploads() : super(ApiClient(secureStore: SecureStore()));
}

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

void main() {
  group('what a row says', () {
    test('the time today, "Yesterday", the weekday, then the date', () {
      String stamp(DateTime at) => timeStampFor(at, _now, yesterday: 'Yesterday');
      // intl separates the hour from AM/PM with a narrow no-break space.
      expect(stamp(DateTime(2026, 9, 17, 16, 5)), '4:05 PM');
      expect(stamp(DateTime(2026, 9, 16, 23, 59)), 'Yesterday');
      expect(stamp(DateTime(2026, 9, 14, 9)), 'Mon');
      expect(stamp(DateTime(2026, 9, 1, 9)), '01/09/26');
    });

    test('who said it, unless the row is already named for them', () {
      ThreadPreview last(String role, [String? sender]) => ThreadPreview(role: role, senderName: sender);
      expect(senderPrefix(last('user'), conversationName: 'Dr Meera Sen'), 'You: ');
      expect(senderPrefix(last('assistant'), conversationName: 'Dr Meera Sen'), 'Assistant: ');
      expect(senderPrefix(last('clinician', 'Dr Meera Sen'), conversationName: 'Dr Meera Sen'), isNull);
      expect(senderPrefix(last('clinician', 'Dr Rahul Bose'), conversationName: 'Dr Meera Sen'), 'Dr Rahul Bose: ');
    });

    test('a conversation is named for the patient’s doctor, then the practice', () {
      final list = _twoPractices();
      expect(list.groups[1].threads.single.nameWithin(list.groups[1]), 'Dr Meera Sen');
      final unnamed = ThreadList.fromJson({
        'groups': [_practice('p9', 'Behala GP', [_thread('t9', at: _now)])],
      });
      expect(unnamed.groups.single.threads.single.nameWithin(unnamed.groups.single), 'Behala GP');
    });

    test('a server that does not send previews yet still parses', () {
      final t = ChatThread.fromJson({'id': 't1', 'messageCount': 2});
      expect(t.lastMessage, isNull);
      expect(t.unreadCount, 0);
    });

    test('messages still being sent do not count as read', () {
      final delivered = ChatMessage(id: 'm1', seq: 1, role: 'clinician', content: 'x', language: 'en', urgency: 'routine', createdAt: DateTime.utc(2026, 9, 17, 10));
      final sending = ChatMessage(id: '__temp_user__', seq: 2, role: 'user', content: 'y', language: 'en', urgency: 'routine', createdAt: DateTime.utc(2026, 9, 17, 11));
      expect(newestDeliveredAt([delivered, sending]), DateTime.utc(2026, 9, 17, 10));
      expect(newestDeliveredAt([sending]), isNull);
    });
  });

  testWidgets('the list shows face, name, last message, time and the unread number, newest first', (tester) async {
    final opened = <String>[];
    await tester.pumpWidget(
      _app(ThreadPicker(threads: _twoPractices(), now: _now, onOpen: (t, g) => opened.add(t.id), onStart: (_) {})),
    );
    await tester.pumpAndSettle();

    expect(find.text('Dr Meera Sen'), findsOneWidget);
    // Formatted as the screen formats it, under the app's own locale set-up.
    expect(find.text(timeStampFor(DateTime(2026, 9, 17, 16, 5), _now, yesterday: 'Yesterday')), findsOneWidget);
    expect(find.text('3'), findsOneWidget, reason: 'the unread number');
    expect(find.bySemanticsLabel(RegExp('3 unread messages')), findsOneWidget);
    // The doctor who wrote it names the row, so their message is not prefixed.
    expect(find.text('Please come in on Monday.'), findsOneWidget);
    expect(find.text('Assistant: Your sugar looks steady.'), findsOneWidget);
    expect(find.text('Mon'), findsOneWidget);
    // Initials stand in for a photo nobody uploaded.
    expect(find.text('M'), findsOneWidget);

    // The newest conversation is on top, whichever practice it is with.
    final gp = tester.getTopLeft(find.text('Dr Meera Sen')).dy;
    final dey = tester.getTopLeft(find.text('Dr Anil Dey')).dy;
    expect(gp, lessThan(dey));

    // A practice not written to yet is a row that says what tapping does.
    expect(find.text('Lake Town Heart Centre'), findsOneWidget);
    expect(find.text('Start a conversation'), findsOneWidget);

    await tester.tap(find.text('Dr Meera Sen'));
    expect(opened, ['t2']);
  });

  testWidgets('a deleted message says so and shows nothing it said', (tester) async {
    final list = ThreadList.fromJson({
      'groups': [
        _practice('p1', 'Behala GP', [_thread('t1', at: _now, deleted: true, text: '')], doctor: 'Dr Meera Sen'),
        _practice('p2', 'Dey Diabetes Clinic', [_thread('t2', at: _now, role: 'user', sender: null, text: '', attachment: 'photo')]),
      ],
    });
    await tester.pumpWidget(_app(ThreadPicker(threads: list, now: _now, onOpen: (_, _) {})));
    await tester.pumpAndSettle();

    expect(find.text('This message was deleted'), findsOneWidget);
    expect(find.textContaining('You: '), findsOneWidget);
    expect(find.textContaining('Photo'), findsOneWidget);
  });

  group('a conversation opened from the list', () {
    late _Chats chats;

    /// The patient app's shape: a tab router, the conversations in one tab.
    Future<void> pumpTabs(WidgetTester tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      chats = _Chats(_twoPractices());
      final router = GoRouter(
        initialLocation: '/chat',
        routes: [
          StatefulShellRoute.indexedStack(
            builder: (context, state, shell) => Scaffold(body: shell),
            branches: [
              StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const Text('Home tab'))]),
              StatefulShellBranch(routes: [GoRoute(path: '/chat', builder: (_, _) => const ChatTab())]),
            ],
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            imageAuthHeaderProvider.overrideWith((ref) async => {}),
            sharedPreferencesProvider.overrideWithValue(prefs),
            secureStoreProvider.overrideWithValue(_NoSession()),
            chatRepositoryProvider.overrideWithValue(chats),
            uploadRepositoryProvider.overrideWithValue(_NoUploads()),
            careContactProvider.overrideWith((ref) async => const CareContact(practiceName: 'Behala GP', phone: null)),
          ],
          child: MaterialApp.router(
            routerConfig: router,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Your conversations'), findsOneWidget);
      expect(find.byTooltip('Back'), findsNothing, reason: 'the list is the top of the tab');
    }

    Future<void> open(WidgetTester tester) async {
      await tester.tap(find.text('Dr Meera Sen'));
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Your conversations'), findsNothing);
      expect(
        find.descendant(of: find.byType(AppBar), matching: find.text('Dr Meera Sen')),
        findsOneWidget,
        reason: 'the conversation is titled for who it is with',
      );
    }

    Future<void> unmount(WidgetTester tester) async {
      // The screens' timers stop with them.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 1));
    }

    testWidgets('the arrow goes back to the list and marks what was on screen read', (tester) async {
      await pumpTabs(tester);
      await open(tester);

      final back = find.byTooltip('Back');
      expect(back, findsOneWidget, reason: 'no way back to the list');
      await tester.tap(back);
      await tester.pump();
      await tester.pump();

      expect(find.text('Your conversations'), findsOneWidget);
      expect(chats.reads.map((r) => r.$1), contains('t2'));
      expect(chats.reads.last.$2, DateTime.utc(2026, 9, 17, 10, 35), reason: 'read up to the newest message on screen');
      await unmount(tester);
    });

    testWidgets('so does the phone’s back button, instead of closing the app', (tester) async {
      await pumpTabs(tester);
      await open(tester);

      // What Android sends when back is pressed.
      await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
        'flutter/navigation',
        const JSONMethodCodec().encodeMethodCall(const MethodCall('popRoute')),
        (_) {},
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('Your conversations'), findsOneWidget, reason: 'back did not return to the list');
      await unmount(tester);
    });
  });
}
