import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/network/api_client.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/storage/secure_store.dart';
import 'package:medpin/features/chat/data/chat_repository.dart';
import 'package:medpin/features/chat/domain/chat_message.dart';
import 'package:medpin/features/chat/domain/send_message_result.dart';
import 'package:medpin/features/chat/presentation/chat_controller.dart';
import 'package:medpin/features/chat/presentation/widgets/chat_message_bubble.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/data/upload_repository.dart';
import 'package:medpin/shared/models/paged.dart';

/// A message the server did not accept stays on screen, marked, and can be
/// sent again.
///
/// It used to be removed. With "Something went wrong" above the conversation,
/// the patient watched "I have a chest pain" vanish, with nothing to tap and
/// no sign whether the clinic had it.

Map<String, dynamic> _json(String id, String role, String content) => {
  'id': id,
  'seq': 0,
  'role': role,
  'content': content,
  'language': 'en',
  'urgency': 'routine',
  'createdAt': DateTime.now().toUtc().toIso8601String(),
};

class _Chats extends ChatRepository {
  _Chats() : super(ApiClient(secureStore: SecureStore()));

  final sends = <String>[];
  ApiException? failNext;
  List<ChatMessage> server = [];
  int _ids = 0;

  @override
  Future<SendMessageResult> sendMessage({
    String? sessionId,
    String? practiceId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    sends.add(text);
    final fail = failNext;
    if (fail != null) {
      failNext = null;
      throw fail;
    }
    final user = _json('u${_ids++}', 'user', text);
    final reply = _json('a${_ids++}', 'assistant', 'An answer.');
    server = [...server, ChatMessage.fromJson(user), ChatMessage.fromJson(reply)];
    return SendMessageResult.fromJson({
      'sessionId': 's1',
      'userMessage': user,
      'reply': reply,
      'triage': {'urgency': 'routine', 'ruleDriven': false, 'redFlags': [], 'findings': [], 'extracted': <String, dynamic>{}},
      'alert': null,
      'citations': [],
    });
  }

  @override
  Future<Paged<ChatMessage>> getThread({String? sessionId, int page = 1, int limit = 200}) async =>
      Paged<ChatMessage>(items: server, page: 1, limit: limit, total: server.length, hasMore: false);
}

class _NoUploads extends UploadRepository {
  _NoUploads() : super(ApiClient(secureStore: SecureStore()));
}

const _refused = ApiException(code: 'DUPLICATE', message: 'refused', statusCode: 409);

List<String> _texts(ChatController c) =>
    [for (final m in c.state.messages) '${m.role}:${m.content}${m.sendFailed ? ' (not sent)' : ''}'];

void main() {
  test('a message the server refuses stays on screen, marked as not sent', () async {
    final chats = _Chats()..failNext = _refused;
    final chat = ChatController(chats, _NoUploads());

    await chat.send(text: 'I have a chest pain', language: 'en');

    expect(_texts(chat), ['user:I have a chest pain (not sent)']);
    expect(chat.state.error?.code, 'DUPLICATE', reason: 'the banner still says something went wrong');
    expect(chat.state.isSending, isFalse);
  });

  test('tapping it sends it again, and the sent copy replaces it', () async {
    final chats = _Chats()..failNext = _refused;
    final chat = ChatController(chats, _NoUploads());
    await chat.send(text: 'I have a chest pain', language: 'en');

    await chat.resend(chat.state.messages.single.id);

    expect(chats.sends, ['I have a chest pain', 'I have a chest pain']);
    expect(_texts(chat), ['user:I have a chest pain', 'assistant:An answer.']);
  });

  test('if the server saved it anyway, the next read shows it once, as sent', () async {
    // The reply was what failed: the patient's message is on the server.
    final chats = _Chats()..failNext = _refused;
    final chat = ChatController(chats, _NoUploads());
    await chat.send(text: 'I have a chest pain', language: 'en');
    chats.server = [ChatMessage.fromJson(_json('u9', 'user', 'I have a chest pain'))];

    await chat.pollForUpdates();

    expect(_texts(chat), ['user:I have a chest pain']);
  });

  test('an earlier message with the same words is not taken for it', () async {
    final chats = _Chats();
    final chat = ChatController(chats, _NoUploads());
    await chat.send(text: 'ok', language: 'en');
    chats.failNext = _refused;
    await chat.send(text: 'ok', language: 'en');

    await chat.pollForUpdates();

    expect(_texts(chat), ['user:ok', 'assistant:An answer.', 'user:ok (not sent)']);
  });

  testWidgets('the bubble says it was not sent, and a tap sends it again', (tester) async {
    var resent = 0;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ChatMessageBubble(
            message: ChatMessage(
              id: '__unsent_0__',
              seq: -1,
              role: 'user',
              content: 'I have a chest pain',
              language: 'en',
              urgency: 'routine',
              createdAt: DateTime.now(),
              sendFailed: true,
            ),
            onResend: () => resent++,
          ),
        ),
      ),
    );

    expect(find.text('Not sent. Tap to try again.'), findsOneWidget);
    expect(find.text('Seen by the clinic'), findsNothing);
    await tester.tap(find.text('Not sent. Tap to try again.'));
    expect(resent, 1);
  });
}
