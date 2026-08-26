import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/chat_message.dart';
import '../domain/chat_session.dart';
import '../domain/send_message_result.dart';

/// Talks to `/chat/*` (API_CONTRACT.md §2).
class ChatRepository {
  ChatRepository(this._client);

  final ApiClient _client;

  Future<SendMessageResult> sendMessage({
    String? sessionId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    final json = await _client.postJson(
      '/chat/message',
      body: {
        if (sessionId != null) 'sessionId': sessionId,
        'text': text,
        'language': language,
        if (attachments != null && attachments.isNotEmpty)
          'attachments': attachments,
        if (replyToId != null) 'replyTo': replyToId,
      },
    );
    return SendMessageResult.fromJson(json);
  }

  /// Streams the reply as Server-Sent Events, yielding `(event, data)` pairs:
  /// `meta` (verdict, echoed user message, citations), many `token` (text
  /// pieces), an optional `replace` (swap the partial for fallback text), and
  /// `done` (the saved reply). Throws if the stream cannot be opened, so the
  /// caller can fall back to [sendMessage].
  Stream<(String, Map<String, dynamic>)> streamMessage({
    String? sessionId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) {
    return _client.postSse(
      '/chat/message/stream',
      body: {
        if (sessionId != null) 'sessionId': sessionId,
        'text': text,
        'language': language,
        if (attachments != null && attachments.isNotEmpty)
          'attachments': attachments,
        if (replyToId != null) 'replyTo': replyToId,
      },
    );
  }

  Future<Paged<ChatSession>> getSessions({int page = 1, int limit = 50}) async {
    final json = await _client.getJson(
      '/chat/sessions',
      query: {'page': page, 'limit': limit},
    );
    return Paged.fromJson(json, ChatSession.fromJson);
  }

  /// The patient's whole care conversation, across every session it spans.
  ///
  /// The clinician has always read it this way. Reading one session instead
  /// meant that when the two disagreed — the doctor writing into the newest,
  /// this screen polling an older one — the reply simply never appeared, while
  /// the push notification still arrived, because that is addressed by patient
  /// rather than by session.
  Future<Paged<ChatMessage>> getThread({int page = 1, int limit = 200}) async {
    final json = await _client.getJson(
      '/chat/thread',
      query: {'page': page, 'limit': limit},
    );
    return Paged.fromJson(json, ChatMessage.fromJson);
  }

  Future<Paged<ChatMessage>> getSessionMessages(
    String sessionId, {
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      '/chat/sessions/$sessionId/messages',
      query: {'page': page, 'limit': limit},
    );
    return Paged.fromJson(json, ChatMessage.fromJson);
  }

  Future<void> archiveSession(String sessionId) async {
    await _client.postJson('/chat/sessions/$sessionId/archive');
  }

  Future<void> flagMessage(String messageId) async {
    await _client.postJson('/chat/messages/$messageId/flag');
  }

  Future<void> setPinned(String messageId, bool pinned) async {
    await _client.postJson(
      '/chat/messages/$messageId/pin',
      body: {'pinned': pinned},
    );
  }

  /// Hides the message from this reader only. The server refuses on anything
  /// carrying an emergency verdict, so callers must surface that error.
  Future<void> hideMessage(String messageId) async {
    await _client.postJson('/chat/messages/$messageId/hide');
  }

  /// Rewrites your own message. The server refuses anything older than its
  /// fifteen-minute window, anything carrying an emergency verdict and any
  /// voice note, so callers must surface the error rather than assume success.
  Future<void> editMessage(String messageId, String content) async {
    await _client.postJson(
      '/chat/messages/$messageId/edit',
      body: {'content': content},
    );
  }

  /// Deletes the message for everyone — the other participants see a "message
  /// deleted" tombstone in its place. The server allows this only on the
  /// caller's own, non-emergency messages and returns an error otherwise, so
  /// callers must surface it.
  Future<void> deleteForEveryone(String messageId) async {
    await _client.postJson(
      '/chat/messages/$messageId/delete',
      body: {'scope': 'everyone'},
    );
  }
}

final Provider<ChatRepository> chatRepositoryProvider =
    Provider<ChatRepository>((ref) {
      return ChatRepository(ref.watch(apiClientProvider));
    });
