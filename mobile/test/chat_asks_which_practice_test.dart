import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/chat/data/chat_repository.dart';
import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/chat_session.dart';
import 'package:medpin/features/chat/domain/send_message_result.dart';
import 'package:medpin/features/chat/domain/thread_group.dart';
import 'package:medpin/features/chat/presentation/chat_controller.dart';
import 'package:medpin/features/chat/presentation/chat_tab.dart';
import 'package:medpin/features/chat/presentation/widgets/emergency_card.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/care_contact.dart';
import 'package:medpin/shared/data/upload_repository.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';

/// A patient with more than one practice, writing where no practice is named.
///
/// The server refuses that send with a 409 rather than guess which doctor it
/// is for. The composer has cleared by then, so the app used to show a generic
/// "conflict" and the patient's words were gone. Now the message is held, the
/// patient is shown their conversations and asked, and it is sent to the one
/// they choose — naming the practice, or the conversation, the server wants.

/// One send, as the repository was asked for it.
typedef _Send = ({String? sessionId, String? practiceId, String text, List<String>? attachments});

class _Chats extends ChatRepository {
  _Chats({ThreadList? before, ThreadList? after, this.instructions})
    : _before = before ?? const ThreadList(groups: []),
      _after = after ?? const ThreadList(groups: []),
      super(ApiClient(secureStore: SecureStore()));

  /// What the server says to do, when it triaged the refused message as an
  /// emergency. Null for anything less.
  final String? instructions;

  /// What the list says before the server has asked, and after.
  final ThreadList _before;
  final ThreadList _after;
  int listReads = 0;

  final sends = <_Send>[];

  /// A 409 for every send that names neither, as the server answers a patient
  /// with more than one practice.
  @override
  Future<SendMessageResult> sendMessage({
    String? sessionId,
    String? practiceId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    sends.add((sessionId: sessionId, practiceId: practiceId, text: text, attachments: attachments));
    if (sessionId == null && practiceId == null) {
      // Parsed the way the client parses the real body, so the test covers it.
      throw ApiException.fromErrorBody({
        'code': 'CONFLICT',
        'message': 'You are with more than one practice. Choose which one this message is for.',
        'details': {
          'reason': 'CHOOSE_PRACTICE',
          'triage': {'urgency': instructions == null ? 'routine' : 'emergency'},
          'instructions': instructions,
        },
      }, statusCode: 409);
    }
    return SendMessageResult.fromJson({
      'sessionId': sessionId ?? 'opened-at-$practiceId',
      'userMessage': {
        'id': 'u${sends.length}',
        'seq': 1,
        'role': 'user',
        'content': text,
        'language': language,
        'urgency': 'routine',
        'createdAt': DateTime.utc(2026, 9, 18, 10).toIso8601String(),
      },
      'reply': null,
      'triage': <String, dynamic>{},
      'citations': <dynamic>[],
    });
  }

  @override
  Future<ThreadList> getThreads() async => listReads++ == 0 ? _before : _after;

  @override
  Future<Paged<ChatSession>> getSessions({int page = 1, int limit = 50}) async =>
      Paged<ChatSession>(items: const [], page: 1, limit: limit, total: 0, hasMore: false);

  @override
  Future<Paged<ChatMessage>> getThread({String? sessionId, int page = 1, int limit = 200}) async =>
      Paged<ChatMessage>(items: const [], page: 1, limit: limit, total: 0, hasMore: false);

  @override
  Future<void> markThreadRead(String sessionId, {required DateTime upTo}) async {}
}

class _Uploads extends UploadRepository {
  _Uploads() : super(ApiClient(secureStore: SecureStore()));

  @override
  Future<MediaAsset> uploadImage({
    required String path,
    required String filename,
    String kind = UploadKind.other,
    String? patientId,
  }) async => const MediaAsset(
    id: 'voice-1',
    kind: 'voice_note',
    mimeType: 'audio/m4a',
    sizeBytes: 1200,
    transcript: 'my sugar is 310',
  );
}

class _NoSession extends SecureStore {
  @override
  Future<String?> readAccessToken() async => null;
}

Map<String, dynamic> _practice(String id, String name, List<Map<String, dynamic>> threads, {String? doctor}) => {
  'practice': {'id': id, 'name': name, 'logoUrl': null},
  'doctor': doctor == null ? null : {'id': 'u-$id', 'name': doctor, 'avatarUrl': null},
  'enrollment': 'e-$id',
  'threads': threads,
  'newConversationHasAssistant': threads.isEmpty ? true : null,
};

Map<String, dynamic> _thread(String id) => {
  'id': id,
  'hasAssistant': true,
  'messageCount': 2,
  'highestUrgency': 'routine',
  'lastMessageAt': DateTime.utc(2026, 9, 17, 9).toIso8601String(),
  'unreadCount': 0,
  'lastMessage': {
    'role': 'clinician',
    'senderName': 'Dr Meera Sen',
    'deleted': false,
    'text': 'See you Monday.',
    'attachment': null,
    'at': DateTime.utc(2026, 9, 17, 9).toIso8601String(),
  },
};

void main() {
  group('the controller', () {
    ChatController controllerFor(_Chats chats) => ChatController(chats, _Uploads());

    test('holds a message the server asked about, instead of showing an error', () async {
      final chats = _Chats();
      final chat = controllerFor(chats);
      addTearDown(chat.dispose);

      await chat.send(text: 'my sugar is 310', language: 'bn');

      expect(chat.state.held?.text, 'my sugar is 310');
      expect(chat.state.held?.language, 'bn');
      expect(chat.state.error, isNull, reason: 'a generic "conflict" tells the patient nothing they can act on');
      expect(chat.state.messages, isEmpty, reason: 'the unsent bubble is taken back');
      expect(chat.state.isSending, isFalse);
    });

    test('sends it to the practice the patient then starts a conversation with', () async {
      final chats = _Chats();
      final chat = controllerFor(chats);
      addTearDown(chat.dispose);

      await chat.send(text: 'my sugar is 310', language: 'en', attachments: ['photo-1']);
      chat.startConversation('p3');
      expect(chat.state.held, isNotNull, reason: 'choosing a practice must not drop the message');
      await chat.sendHeld();

      final last = chats.sends.last;
      expect(last.practiceId, 'p3');
      expect(last.sessionId, isNull);
      expect(last.text, 'my sugar is 310');
      expect(last.attachments, ['photo-1'], reason: 'the photo goes with it');
      expect(chat.state.held, isNull);
      expect(chat.state.sessionId, 'opened-at-p3', reason: 'the reply names the conversation from then on');
    });

    test('or into the conversation the patient opens', () async {
      final chats = _Chats();
      final chat = controllerFor(chats);
      addTearDown(chat.dispose);

      await chat.send(text: 'my sugar is 310', language: 'en');
      await chat.openSession('t2');
      await chat.sendHeld();

      expect(chats.sends.last.sessionId, 't2');
      expect(chats.sends.last.text, 'my sugar is 310');
    });

    test('a voice note is held as its upload, not recorded again', () async {
      final chats = _Chats();
      final chat = controllerFor(chats);
      addTearDown(chat.dispose);

      await chat.sendVoiceNote(localPath: '/tmp/note.m4a', language: 'en');
      chat.startConversation('p1');
      await chat.sendHeld();

      expect(chats.sends.last.practiceId, 'p1');
      expect(chats.sends.last.attachments, ['voice-1']);
      expect(chats.sends.last.text, 'my sugar is 310', reason: 'the transcript is what triage reads');
    });

    test('a refusal of a send that did name a practice is an error, not a question', () async {
      // Standing in for any 409 on a send that already said where it goes:
      // asking the patient to choose again could not help.
      final chat = controllerFor(_RefusesEverything());
      addTearDown(chat.dispose);

      chat.startConversation('p3');
      await chat.send(text: 'hello', language: 'en');

      expect(chat.state.held, isNull);
      expect(chat.state.error?.code, 'CONFLICT');
    });

    test('an emergency is held with what to do now', () async {
      final chat = controllerFor(_Chats(instructions: 'Go to the nearest hospital emergency department.'));
      addTearDown(chat.dispose);

      await chat.send(text: 'I have severe chest pain', language: 'en');

      expect(chat.state.held?.emergencyInstructions, 'Go to the nearest hospital emergency department.');
    });

    test('anything less carries no instructions', () async {
      final chat = controllerFor(_Chats());
      addTearDown(chat.dispose);

      await chat.send(text: 'what should I eat', language: 'en');

      expect(chat.state.held, isNotNull);
      expect(chat.state.held?.emergencyInstructions, isNull);
    });

    test('the patient can decide not to send it', () async {
      final chat = controllerFor(_Chats());
      addTearDown(chat.dispose);

      await chat.send(text: 'never mind', language: 'en');
      chat.discardHeld();
      await chat.sendHeld();

      expect(chat.state.held, isNull);
    });
  });

  group('reading the refusal', () {
    test('an object in details is kept, not dropped for not being a list', () {
      final e = ApiException.fromErrorBody({
        'code': 'CONFLICT',
        'message': 'Choose',
        'details': {'reason': 'CHOOSE_PRACTICE', 'instructions': 'Go now.'},
      }, statusCode: 409);

      expect(e.code, 'CONFLICT');
      expect(e.statusCode, 409);
      expect(e.detailsMap['instructions'], 'Go now.');
      expect(e.details, isEmpty);
    });

    test('field problems still arrive as a list', () {
      final e = ApiException.fromErrorBody({
        'code': 'VALIDATION_ERROR',
        'message': 'Request validation failed',
        'details': [
          {'path': 'text', 'message': 'Add a message or attach a photo'},
        ],
      });

      expect(e.details.single.path, 'text');
      expect(e.detailsMap, isEmpty);
    });
  });

  group('the chat tab', () {
    late _Chats chats;

    Future<void> pumpTab(WidgetTester tester) async {
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
            uploadRepositoryProvider.overrideWithValue(_Uploads()),
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
    }

    Future<void> unmount(WidgetTester tester) async {
      // The screens' timers stop with them.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 1));
    }

    testWidgets('asks which practice, then sends the message to the one chosen', (tester) async {
      // Read while the patient had one practice; a desk has enrolled them at a
      // second since. The screen opened straight into a conversation that the
      // server can no longer place.
      chats = _Chats(
        before: ThreadList.fromJson({
          'groups': [_practice('p1', 'Dey Diabetes Clinic', [])],
        }),
        after: ThreadList.fromJson({
          'groups': [
            _practice('p1', 'Dey Diabetes Clinic', [_thread('t1')], doctor: 'Dr Anil Dey'),
            _practice('p3', 'Lake Town Heart Centre', []),
          ],
        }),
      );
      await pumpTab(tester);
      expect(find.text('Your conversations'), findsNothing, reason: 'one practice opens straight into the conversation');

      await tester.enterText(find.byType(TextField).last, 'my sugar is 310');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(find.text('Your conversations'), findsOneWidget, reason: 'the patient was not shown where to send it');
      expect(find.text('Who is this message for?'), findsOneWidget);
      expect(chats.sends.single.practiceId, isNull);

      await tester.tap(find.text('Lake Town Heart Centre'));
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(chats.sends, hasLength(2));
      expect(chats.sends.last.practiceId, 'p3', reason: 'the message went somewhere other than the practice chosen');
      expect(chats.sends.last.text, 'my sugar is 310');
      expect(find.text('Who is this message for?'), findsNothing);
      await unmount(tester);
    });

    testWidgets('an emergency shows what to do at once, and cannot be cancelled away', (tester) async {
      chats = _Chats(
        before: ThreadList.fromJson({
          'groups': [_practice('p1', 'Dey Diabetes Clinic', [])],
        }),
        after: ThreadList.fromJson({
          'groups': [
            _practice('p1', 'Dey Diabetes Clinic', [_thread('t1')], doctor: 'Dr Anil Dey'),
            _practice('p3', 'Lake Town Heart Centre', []),
          ],
        }),
        instructions: 'This needs medical attention right now. Go to the nearest hospital.',
      );
      await pumpTab(tester);

      await tester.enterText(find.byType(TextField).last, 'I have severe chest pain');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(find.byType(EmergencyCard), findsOneWidget, reason: 'the patient was not told what to do');
      // The server's words, beneath the card's own heading.
      expect(find.textContaining('This needs medical attention right now.'), findsOneWidget);
      expect(find.text('Who is this message for?'), findsOneWidget);
      expect(find.text('Cancel'), findsNothing, reason: 'an emergency could be withdrawn with a tap');

      await tester.tap(find.text('Lake Town Heart Centre'));
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(chats.sends.last.practiceId, 'p3');
      expect(chats.sends.last.text, 'I have severe chest pain');
      await unmount(tester);
    });

    testWidgets('Cancel drops the message and leaves the list as it always is', (tester) async {
      chats = _Chats(
        before: ThreadList.fromJson({
          'groups': [_practice('p1', 'Dey Diabetes Clinic', [])],
        }),
        after: ThreadList.fromJson({
          'groups': [
            _practice('p1', 'Dey Diabetes Clinic', [_thread('t1')], doctor: 'Dr Anil Dey'),
            _practice('p3', 'Lake Town Heart Centre', []),
          ],
        }),
      );
      await pumpTab(tester);

      await tester.enterText(find.byType(TextField).last, 'never mind');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('Cancel'));
      await tester.pump();

      expect(find.text('Who is this message for?'), findsNothing);
      expect(find.text('Your conversations'), findsOneWidget);

      await tester.tap(find.text('Lake Town Heart Centre'));
      await tester.pump();
      await tester.pump();
      expect(chats.sends, hasLength(1), reason: 'a cancelled message was sent anyway');
      await unmount(tester);
    });
  });
}

/// Refuses every send with a 409, whatever it names.
class _RefusesEverything extends _Chats {
  @override
  Future<SendMessageResult> sendMessage({
    String? sessionId,
    String? practiceId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    throw const ApiException(code: 'CONFLICT', message: 'Refused', statusCode: 409);
  }
}
