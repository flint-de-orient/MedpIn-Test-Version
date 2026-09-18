import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/chat/data/chat_repository.dart';
import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/chat_session.dart';
import 'package:medpin/features/chat/domain/send_message_result.dart';
import 'package:medpin/features/chat/domain/thread_group.dart';
import 'package:medpin/features/chat/presentation/chat_tab.dart';
import 'package:medpin/features/chat/presentation/widgets/generating_bubble.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:medpin/shared/data/upload_repository.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';

/// "MedPin is analyzing data…" is a promise that an assistant is writing a
/// reply. Under a banner saying the clinic replies here, it promised a reply that
/// was never coming — so it is shown only where an assistant answers.

class _Chats extends ChatRepository {
  _Chats({required this.hasAssistant}) : super(ApiClient(secureStore: SecureStore()));

  final bool hasAssistant;

  /// Never completes, so the send stays in flight for the test to look at.
  final pending = Completer<SendMessageResult>();

  @override
  Future<SendMessageResult> sendMessage({
    String? sessionId,
    String? practiceId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) => pending.future;

  @override
  Future<ThreadList> getThreads() async => ThreadList.fromJson({
    'groups': [
      {
        'practice': {'id': 'p1', 'name': 'Salt Lake Polyclinic', 'logoUrl': null},
        'doctor': null,
        'enrollment': 'e1',
        'threads': [
          {'id': 's1', 'hasAssistant': hasAssistant, 'messageCount': 0, 'unreadCount': 0},
        ],
      },
    ],
  });

  @override
  Future<Paged<ChatSession>> getSessions({int page = 1, int limit = 50}) async =>
      Paged<ChatSession>(items: const [], page: 1, limit: limit, total: 0, hasMore: false);

  @override
  Future<Paged<ChatMessage>> getThread({String? sessionId, int page = 1, int limit = 200}) async =>
      Paged<ChatMessage>(items: const [], page: 1, limit: limit, total: 0, hasMore: false);

  @override
  Future<void> markThreadRead(String sessionId, {required DateTime upTo}) async {}
}

class _NoUploads extends UploadRepository {
  _NoUploads() : super(ApiClient(secureStore: SecureStore()));
}

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

Future<void> _sendWhile(WidgetTester tester, _Chats chats) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final router = GoRouter(
    initialLocation: '/chat',
    routes: [GoRoute(path: '/chat', builder: (_, _) => const Scaffold(body: ChatTab()))],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        imageAuthHeaderProvider.overrideWith((ref) async => {}),
        sharedPreferencesProvider.overrideWithValue(prefs),
        secureStoreProvider.overrideWithValue(_NoSession()),
        chatRepositoryProvider.overrideWithValue(chats),
        uploadRepositoryProvider.overrideWithValue(_NoUploads()),
        careContactProvider.overrideWith((ref) async => const CareContact(practiceName: 'Salt Lake', phone: null)),
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
  await tester.enterText(find.byType(TextField).last, 'hi');
  await tester.pump();
  await tester.tap(find.byIcon(Icons.send_rounded));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('no "analyzing" bubble where the clinic replies and no assistant does', (tester) async {
    await _sendWhile(tester, _Chats(hasAssistant: false));
    expect(find.textContaining('currently unavailable for your care team'), findsOneWidget);
    expect(find.byType(GeneratingBubble), findsNothing, reason: 'the app promised a reply no assistant will send');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  });

  testWidgets('but it is still there where the assistant answers', (tester) async {
    await _sendWhile(tester, _Chats(hasAssistant: true));
    expect(find.byType(GeneratingBubble), findsWidgets);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  });
}
