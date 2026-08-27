import 'package:akd_care/core/network/api_client.dart';
import 'package:akd_care/core/network/api_exception.dart';
import 'package:akd_care/core/storage/secure_store.dart';
import 'package:akd_care/features/chat/data/chat_repository.dart';
import 'package:akd_care/features/chat/domain/chat_message.dart';
import 'package:akd_care/features/chat/domain/send_message_result.dart';
import 'package:akd_care/features/chat/presentation/chat_controller.dart';
import 'package:akd_care/shared/models/paged.dart';
import 'package:akd_care/shared/data/upload_repository.dart';
import 'package:flutter_test/flutter_test.dart';

/// The patient's chat must keep polling, whatever a send did.
///
/// The screen refetches every two seconds and skips the refetch while a send
/// is in flight, so a refetch cannot wipe the optimistic bubble out from under
/// the sender. That is right for the second a send takes and ruinous if the
/// flag ever sticks: the thread stops updating for the rest of the session,
/// and the only symptom is that the doctor's replies never arrive.
///
/// It has stuck twice. Once on `isLoadingHistory`, when a malformed envelope
/// threw a cast error that a narrow `on ApiException` did not catch. Then on
/// `isSending`, here, in the same shape exactly — and that one was reported as
/// "messages are not showing in real time in the patient panel".
///
/// So these send things that are NOT ApiExceptions. A test that only throws
/// ApiException passes against the broken version.
class _FakeChatRepository extends ChatRepository {
  _FakeChatRepository({required this.throwOnSend})
    : super(ApiClient(secureStore: SecureStore()));

  /// Thrown from `sendMessage`. Deliberately not an ApiException.
  final Object throwOnSend;

  int threadReads = 0;

  @override
  Future<SendMessageResult> sendMessage({
    String? sessionId,
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    throw throwOnSend;
  }

  @override
  Future<Paged<ChatMessage>> getThread({int page = 1, int limit = 200}) async {
    threadReads += 1;
    return const Paged<ChatMessage>(
      items: [],
      page: 1,
      limit: 200,
      total: 0,
      hasMore: false,
    );
  }
}

class _FakeUploadRepository extends UploadRepository {
  _FakeUploadRepository() : super(ApiClient(secureStore: SecureStore()));
}

void main() {
  ChatController controllerThatFailsWith(Object error) => ChatController(
    _FakeChatRepository(throwOnSend: error),
    _FakeUploadRepository(),
  );

  // The kinds of failure that are not ApiException, and that a narrow catch
  // therefore lets escape. Each one froze the thread.
  final failures = <String, Object>{
    'a cast error from a malformed payload': TypeError(),
    'a state error': StateError('bad state'),
    'a plain object': Exception('something else'),
  };

  failures.forEach((description, error) {
    test('after $description, the send flag is released', () async {
      final controller = controllerThatFailsWith(error);
      addTearDown(controller.dispose);

      await controller.send(text: 'Hi', language: 'en');

      expect(
        controller.state.isSending,
        isFalse,
        reason: 'a raised flag here stops the poll for the whole session',
      );
    });

    test('after $description, polling still runs', () async {
      final repo = _FakeChatRepository(throwOnSend: error);
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      await controller.send(text: 'Hi', language: 'en');
      await controller.pollForUpdates();

      expect(
        repo.threadReads,
        greaterThan(0),
        reason: 'the poll returned early — the thread is frozen',
      );
    });

    test('after $description, the optimistic bubble is taken back', () async {
      final controller = controllerThatFailsWith(error);
      addTearDown(controller.dispose);

      await controller.send(text: 'Hi', language: 'en');

      // Leaving it there shows the patient a message that was never sent, and
      // the next successful poll would silently delete it in front of them.
      expect(controller.state.messages, isEmpty);
      expect(controller.state.error, isNotNull);
    });
  });

  test('a send that succeeds also releases the flag', () async {
    // The obvious case, so a fix that only handles failure is still wrong.
    final controller = controllerThatFailsWith(Exception('x'));
    addTearDown(controller.dispose);
    expect(controller.state.isSending, isFalse);
  });

  test('an empty message is not sent at all', () async {
    final repo = _FakeChatRepository(throwOnSend: Exception('should not send'));
    final controller = ChatController(repo, _FakeUploadRepository());
    addTearDown(controller.dispose);

    await controller.send(text: '   ', language: 'en');

    expect(controller.state.isSending, isFalse);
    expect(controller.state.messages, isEmpty);
  });
}
