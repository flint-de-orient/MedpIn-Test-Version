import 'package:akd_care/core/network/api_client.dart';
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

  /// When true, getThread throws — standing in for the malformed envelope or
  /// dropped connection that a poll actually meets.
  bool failThread = false;

  /// What getThread hands back.
  List<ChatMessage> thread = const [];

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
    if (failThread) throw StateError('thread unavailable');
    return Paged<ChatMessage>(
      items: thread,
      page: 1,
      limit: 200,
      total: thread.length,
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

  group('a failing poll is countable, not silent', () {
    test(
      'a run of failures is counted and eventually reads as stale',
      () async {
        // The whole point. Both catches used to be empty, so a thread that had
        // stopped updating was indistinguishable from one with nothing new — in
        // the app and in the log. This is what makes it observable.
        final repo = _FakeChatRepository(throwOnSend: Exception('x'))
          ..failThread = true;
        final controller = ChatController(repo, _FakeUploadRepository());
        addTearDown(controller.dispose);

        for (var i = 0; i < 7; i++) {
          await controller.pollForUpdates();
        }

        expect(controller.pollFailures, 7);
        expect(controller.isStale, isTrue);
      },
    );

    test('one success clears the count', () async {
      final repo = _FakeChatRepository(throwOnSend: Exception('x'))
        ..failThread = true;
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      await controller.pollForUpdates();
      expect(controller.pollFailures, 1);

      repo.failThread = false;
      await controller.pollForUpdates();

      // A thread that recovers must stop saying it is stale, or the warning
      // becomes furniture nobody reads.
      expect(controller.pollFailures, 0);
      expect(controller.isStale, isFalse);
    });

    test('a few failures do not cry stale', () async {
      // Two seconds of network hiccup is not an outage.
      final repo = _FakeChatRepository(throwOnSend: Exception('x'))
        ..failThread = true;
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      await controller.pollForUpdates();
      await controller.pollForUpdates();

      expect(controller.isStale, isFalse);
    });
  });

  group("a doctor's reply lands while the screen is open", () {
    ChatMessage msg(String id, String role, String content, int minute) =>
        ChatMessage(
          id: id,
          seq: minute,
          role: role,
          content: content,
          language: 'en',
          urgency: 'routine',
          createdAt: DateTime(2026, 8, 27, 14, minute),
        );

    test('a new clinician message appears', () async {
      final repo = _FakeChatRepository(throwOnSend: Exception('x'));
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      repo.thread = [msg('a', 'user', 'Hi', 25)];
      await controller.pollForUpdates();
      expect(controller.state.messages.length, 1);

      // The doctor replies.
      repo.thread = [
        msg('a', 'user', 'Hi', 25),
        msg('b', 'clinician', 'Hello', 26),
      ];
      await controller.pollForUpdates();

      expect(controller.state.messages.map((m) => m.id), ['a', 'b']);
    });

    test('a server that returns fewer does not stall the thread', () async {
      // The bug. The poll used to bail out whenever the server returned fewer
      // messages than were on screen, so one disagreement froze every
      // subsequent tick — notifications kept arriving, the screen never moved,
      // and reopening it showed everything because opening replaces state
      // rather than comparing it.
      final repo = _FakeChatRepository(throwOnSend: Exception('x'));
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      repo.thread = [
        msg('a', 'user', 'Hi', 25),
        msg('b', 'assistant', 'Hello', 25),
        msg('c', 'user', 'Vitamin D', 26),
      ];
      await controller.pollForUpdates();
      expect(controller.state.messages.length, 3);

      // Now the server returns one fewer than the screen holds, and a new
      // clinician reply among them.
      repo.thread = [
        msg('a', 'user', 'Hi', 25),
        msg('d', 'clinician', 'Hello back', 28),
      ];
      await controller.pollForUpdates();

      final ids = controller.state.messages.map((m) => m.id).toList();
      expect(ids, contains('d'), reason: 'the reply never arrived');
      // And nothing already on screen was thrown away to get it.
      expect(ids, containsAll(<String>['a', 'b', 'c']));
    });

    test(
      'a message the patient just sent is not wiped by a short read',
      () async {
        // Why the length guard existed. The merge has to keep this property
        // without the guard, or sent text flashes up and vanishes.
        final repo = _FakeChatRepository(throwOnSend: Exception('x'));
        final controller = ChatController(repo, _FakeUploadRepository());
        addTearDown(controller.dispose);

        repo.thread = [
          msg('a', 'user', 'Hi', 25),
          msg('b', 'user', 'Mine', 26),
        ];
        await controller.pollForUpdates();

        repo.thread = [msg('a', 'user', 'Hi', 25)];
        await controller.pollForUpdates();

        expect(
          controller.state.messages.map((m) => m.id),
          containsAll(['a', 'b']),
        );
      },
    );

    test('the same poll twice changes nothing', () async {
      // An unchanged poll must not rebuild the list under the reader's thumb.
      final repo = _FakeChatRepository(throwOnSend: Exception('x'));
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      repo.thread = [msg('a', 'user', 'Hi', 25)];
      await controller.pollForUpdates();
      final first = controller.state.messages;
      await controller.pollForUpdates();

      expect(identical(controller.state.messages, first), isTrue);
    });

    test('an edited message is taken from the server', () async {
      final repo = _FakeChatRepository(throwOnSend: Exception('x'));
      final controller = ChatController(repo, _FakeUploadRepository());
      addTearDown(controller.dispose);

      repo.thread = [msg('a', 'clinician', 'Take one', 25)];
      await controller.pollForUpdates();

      repo.thread = [msg('a', 'clinician', 'Take two', 25)];
      await controller.pollForUpdates();

      expect(controller.state.messages.single.content, 'Take two');
    });
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
