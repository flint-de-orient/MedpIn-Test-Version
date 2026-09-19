import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../shared/data/upload_repository.dart';
import '../data/chat_repository.dart';
import '../domain/chat_message.dart';
import 'package:flutter/foundation.dart';

/// A message the server would not place, kept until the patient says where it
/// goes.
///
/// A patient with more than one practice who writes into no conversation and
/// names no practice is asked which, with a 409, rather than guessed for. The
/// composer has already cleared by then, so without this the words they typed
/// were simply gone.
@immutable
class HeldMessage {
  const HeldMessage({
    required this.text,
    required this.language,
    this.attachments = const [],
    this.emergencyInstructions,
  });

  final String text;
  final String language;

  /// Ids of files already uploaded — a photo, or a voice note whose transcript
  /// is [text]. Sent again as they are.
  final List<String> attachments;

  /// What to do now, when the server triaged the message as an emergency
  /// before asking. The clinic has already been alerted by then; this is the
  /// half of the answer the patient needs, and it cannot wait for them to
  /// choose a doctor either.
  final String? emergencyInstructions;
}

/// A message the server did not accept, as it has to be sent again.
class _Unsent {
  const _Unsent({
    required this.text,
    required this.language,
    required this.attachments,
    this.replyToId,
  });

  final String text;
  final String language;
  final List<String> attachments;
  final String? replyToId;
}

class ChatState {
  const ChatState({
    this.sessionId,
    this.practiceId,
    this.messages = const [],
    this.isSending = false,
    this.isLoadingHistory = false,
    this.error,
    this.held,
  });

  final String? sessionId;

  /// The practice a first message is for, before any conversation exists with
  /// it. Set only by [ChatController.startConversation]; the first reply names
  /// the conversation, and from then on [sessionId] is what is sent.
  final String? practiceId;

  final List<ChatMessage> messages;
  final bool isSending;
  final bool isLoadingHistory;
  final ApiException? error;

  /// Set when the server asked which practice a message is for. The chat tab
  /// answers by showing the list; see [ChatController.sendHeld].
  final HeldMessage? held;

  ChatState copyWith({
    String? sessionId,
    List<ChatMessage>? messages,
    bool? isSending,
    bool? isLoadingHistory,
    ApiException? error,
    bool clearError = false,
    HeldMessage? held,
    bool clearHeld = false,
  }) {
    return ChatState(
      sessionId: sessionId ?? this.sessionId,
      practiceId: practiceId,
      messages: messages ?? this.messages,
      isSending: isSending ?? this.isSending,
      isLoadingHistory: isLoadingHistory ?? this.isLoadingHistory,
      error: clearError ? null : (error ?? this.error),
      held: clearHeld ? null : (held ?? this.held),
    );
  }
}

/// Drives the AI chat screen: sending a message, showing a typing indicator
/// while awaiting the reply, switching between sessions, and starting a fresh
/// one.
class ChatController extends StateNotifier<ChatState> {
  ChatController(this._repository, this._uploadRepository)
    : super(const ChatState());

  final ChatRepository _repository;
  final UploadRepository _uploadRepository;

  Future<void> send({
    required String text,
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) async {
    final trimmed = text.trim();
    // A photo-only message (empty text) is allowed as long as something is
    // attached; block only when there is nothing at all to send.
    if ((trimmed.isEmpty && (attachments == null || attachments.isEmpty)) ||
        state.isSending)
      return;

    // Echo the patient's message instantly so tapping send feels immediate; the
    // server's saved copy replaces it once the reply returns.
    const tempUserId = '__temp_user__';
    final optimisticUser = ChatMessage(
      id: tempUserId,
      seq: -1,
      role: 'user',
      content: trimmed,
      language: language,
      urgency: 'routine',
      createdAt: DateTime.now(),
    );
    _sendStartedAt = DateTime.now();
    state = state.copyWith(
      isSending: true,
      clearError: true,
      messages: [...state.messages, optimisticUser],
    );

    // Only until the first message has opened the conversation.
    final sessionId = state.sessionId;
    final practiceId = sessionId == null ? state.practiceId : null;

    // Non-streaming send. The production API sits behind an Apache reverse proxy
    // that buffers Server-Sent Events, so the streaming endpoint hangs and the
    // assistant appears dead. The plain endpoint returns the whole reply at once
    // and is reliable on every network and proxy.
    try {
      final result = await _repository.sendMessage(
        sessionId: sessionId,
        practiceId: practiceId,
        text: trimmed,
        language: language,
        attachments: attachments,
        replyToId: replyToId,
      );
      final withoutTemp =
          state.messages.where((m) => m.id != tempUserId).toList();
      state = state.copyWith(
        sessionId: result.sessionId,
        messages: [
          ...withoutTemp,
          result.userMessage,
          // The assistant may have stayed out of it — a clinician is
          // answering. Append nothing rather than an empty bubble.
          if (result.reply != null) result.reply!,
        ],
      );
    } on ApiException catch (e) {
      final withoutTemp = state.messages.where((m) => m.id != tempUserId).toList();
      if (_askedWhichPractice(e, sessionId: sessionId, practiceId: practiceId)) {
        // Not an error the patient can act on here. The tab shows the list,
        // and the message goes wherever they choose. A quote belongs to the
        // conversation it came from, so it does not travel.
        state = state.copyWith(
          messages: withoutTemp,
          held: HeldMessage(
            text: trimmed,
            language: language,
            attachments: attachments ?? const [],
            emergencyInstructions: _instructionsIn(e),
          ),
        );
      } else {
        state = state.copyWith(
          messages: _keepAsUnsent(
            tempUserId,
            language: language,
            attachments: attachments,
            replyToId: replyToId,
          ),
          error: e,
        );
      }
    } catch (_) {
      // Anything that is not an ApiException — a malformed payload, a socket
      // dropped mid-request, a cast on a field that came back the wrong shape.
      // Caught for the same reason as the finally below: this used to escape,
      // and the escape was the bug.
      state = state.copyWith(
        messages: _keepAsUnsent(
          tempUserId,
          language: language,
          attachments: attachments,
          replyToId: replyToId,
        ),
        error: const ApiException(
          code: 'NETWORK_ERROR',
          message: 'Could not send that message. Please try again.',
        ),
      );
    } finally {
      // Released on every path, including the ones nobody thought of.
      //
      // This screen polls every two seconds and skips the poll while a send is
      // in flight. Leave the flag raised and the thread stops updating for as
      // long as the app is open — which is exactly how "the doctor's replies
      // do not arrive" was reported, from a patient whose send had thrown
      // something other than an ApiException some minutes earlier.
      _sendStartedAt = null;
      state = state.copyWith(isSending: false);
    }
  }

  /// Sends a voice note with instant feedback.
  ///
  /// The just-recorded clip appears as a playable bubble immediately, built from
  /// the LOCAL file — before the upload starts — so tapping send feels alive.
  /// THEN it uploads (which transcribes) and sends, and the server's saved copy
  /// replaces the optimistic one. Two bugs this fixes: the clip used to appear
  /// only after the upload finished, and briefly as the transcript TEXT (because
  /// the old path fed the transcript through the text-only optimistic bubble).
  Future<void> sendVoiceNote({
    required String localPath,
    required String language,
  }) async {
    if (state.isSending) return;

    const tempId = '__temp_voice__';
    final optimistic = ChatMessage(
      id: tempId,
      seq: -1,
      role: 'user',
      content: '', // empty, so the bubble renders as a player, not text
      language: language,
      urgency: 'routine',
      createdAt: DateTime.now(),
      voiceNotes: [VoiceNote(url: '', localPath: localPath)],
    );
    _sendStartedAt = DateTime.now();
    state = state.copyWith(
      isSending: true,
      clearError: true,
      messages: [...state.messages, optimistic],
    );

    String? sessionId;
    String? practiceId;
    HeldMessage? uploaded;
    try {
      final asset = await _uploadRepository.uploadImage(
        path: localPath,
        filename: localPath.split(RegExp(r'[/\\]')).last,
        kind: UploadKind.voiceNote,
      );
      // The transcript becomes the text so deterministic triage reads a spoken
      // "chest pain" the same as a typed one; empty is fine (the audio is still
      // stored and sent).
      uploaded = HeldMessage(
        text: asset.transcript?.trim() ?? '',
        language: language,
        attachments: [asset.id],
      );
      sessionId = state.sessionId;
      // Only until the first message has opened the conversation.
      practiceId = sessionId == null ? state.practiceId : null;
      final result = await _repository.sendMessage(
        sessionId: sessionId,
        practiceId: practiceId,
        text: uploaded.text,
        language: language,
        attachments: uploaded.attachments,
      );
      final withoutTemp = state.messages.where((m) => m.id != tempId).toList();
      state = state.copyWith(
        sessionId: result.sessionId,
        messages: [
          ...withoutTemp,
          result.userMessage,
          // The assistant may have stayed out of it — a clinician is
          // answering. Append nothing rather than an empty bubble.
          if (result.reply != null) result.reply!,
        ],
      );
    } on ApiException catch (e) {
      final withoutTemp = state.messages.where((m) => m.id != tempId).toList();
      // Held only once the recording is uploaded: a refused upload has nothing
      // to send again, and is an ordinary failure.
      if (uploaded != null && _askedWhichPractice(e, sessionId: sessionId, practiceId: practiceId)) {
        state = state.copyWith(
          messages: withoutTemp,
          held: HeldMessage(
            text: uploaded.text,
            language: uploaded.language,
            attachments: uploaded.attachments,
            emergencyInstructions: _instructionsIn(e),
          ),
        );
      } else {
        state = state.copyWith(messages: withoutTemp, error: e);
      }
    } catch (_) {
      // The upload is the likeliest thrower here: a file that vanished, a
      // codec the transcriber rejects, a connection lost mid-upload. None of
      // those are ApiExceptions and all of them used to escape.
      state = state.copyWith(
        messages: state.messages.where((m) => m.id != tempId).toList(),
        error: const ApiException(
          code: 'NETWORK_ERROR',
          message: 'Could not send that message. Please try again.',
        ),
      );
    } finally {
      _sendStartedAt = null;
      state = state.copyWith(isSending: false);
    }
  }

  /// Clears the error banner, so it fades on its own rather than sitting there
  /// until the next message. Safe to call when there is no error.
  void dismissError() {
    if (state.error != null) state = state.copyWith(clearError: true);
  }

  /// Resend the most recent question. Used by the "Try again" action on an
  /// AI-unavailable fallback reply.
  ///
  /// Drops the fallback pair (the question and the scripted reply) first, so the
  /// retry replaces them rather than stacking a second copy. The question itself
  /// is preserved and resent.
  /// What to send again for each message marked [ChatMessage.sendFailed].
  final _unsent = <String, _Unsent>{};
  int _unsentIds = 0;

  /// The optimistic copy [tempId], kept on screen and marked as not sent.
  ///
  /// It used to be removed. A patient whose message failed watched it vanish,
  /// with only "Something went wrong" above the conversation, and had to type
  /// it again, if they noticed at all.
  List<ChatMessage> _keepAsUnsent(
    String tempId, {
    required String language,
    List<String>? attachments,
    String? replyToId,
  }) {
    return [
      for (final m in state.messages)
        if (m.id == tempId) _unsentCopyOf(m, language, attachments, replyToId) else m,
    ];
  }

  ChatMessage _unsentCopyOf(
    ChatMessage m,
    String language,
    List<String>? attachments,
    String? replyToId,
  ) {
    final id = '__unsent_${_unsentIds++}__';
    _unsent[id] = _Unsent(
      text: m.content,
      language: language,
      attachments: attachments ?? const [],
      replyToId: replyToId,
    );
    return ChatMessage(
      id: id,
      seq: -1,
      role: 'user',
      content: m.content,
      language: m.language,
      urgency: m.urgency,
      createdAt: m.createdAt,
      sendFailed: true,
    );
  }

  /// Sends a message marked as not sent, again.
  Future<void> resend(String id) async {
    if (state.isSending) return;
    final unsent = _unsent.remove(id);
    if (unsent == null) return;
    state = state.copyWith(
      messages: state.messages.where((m) => m.id != id).toList(),
    );
    await send(
      text: unsent.text,
      language: unsent.language,
      attachments: unsent.attachments,
      replyToId: unsent.replyToId,
    );
  }

  /// [local] without the messages marked as not sent that the server has.
  ///
  /// A send can fail after the server saved the patient's message, when it
  /// was the reply that failed. The next read then brings the message back,
  /// and the marked copy would show it twice, once as not sent. Matched on
  /// the text, against messages this screen has not shown before, sent within
  /// a few minutes either way (the phone's clock and the server's differ).
  List<ChatMessage> _withoutUnsentTheServerHas(
    List<ChatMessage> local,
    List<ChatMessage> remote,
  ) {
    if (!local.any((m) => m.sendFailed)) return local;
    final shown = {for (final m in local) m.id};
    final claimed = <String>{};
    final sent = <String>{};
    for (final u in local.where((m) => m.sendFailed)) {
      for (final r in remote) {
        if (!r.isUser ||
            r.content != u.content ||
            shown.contains(r.id) ||
            claimed.contains(r.id)) {
          continue;
        }
        final at = u.createdAt;
        final rAt = r.createdAt;
        if (at != null &&
            rAt != null &&
            rAt.difference(at).abs() > const Duration(minutes: 5)) {
          continue;
        }
        claimed.add(r.id);
        sent.add(u.id);
        _unsent.remove(u.id);
        break;
      }
    }
    if (sent.isEmpty) return local;
    return local.where((m) => !sent.contains(m.id)).toList();
  }

  Future<void> retryLast({required String language}) async {
    if (state.isSending) return;
    final messages = state.messages;
    final lastUserIndex = messages.lastIndexWhere((m) => m.isUser);
    if (lastUserIndex < 0) return;
    final question = messages[lastUserIndex].content;

    state = state.copyWith(messages: messages.sublist(0, lastUserIndex));
    await send(text: question, language: language);
  }

  /// Quietly re-reads the open conversation so a clinician's reply appears on
  /// its own, without the patient reloading or being told to.
  /// When the in-flight send started, or null if none is.
  ///
  /// Only used to stop a send that never finished from silencing the poll —
  /// see [_sendIsBlocking].
  DateTime? _sendStartedAt;

  /// A send is worth pausing the poll for, but not forever.
  ///
  /// Polling skips while a send is in flight so a refetch cannot wipe the
  /// optimistic bubble out from under it. That is right for the second or two
  /// a send takes and catastrophic if the flag ever sticks: the thread stops
  /// updating for the rest of the session and the only symptom is that
  /// replies stop arriving. It has stuck twice — once on isLoadingHistory,
  /// once on isSending — so the guard now expires whatever else goes wrong.
  static const _sendGrace = Duration(seconds: 30);

  bool get _sendIsBlocking {
    if (!state.isSending) return false;
    final started = _sendStartedAt;
    if (started == null) return false;
    return DateTime.now().difference(started) < _sendGrace;
  }

  Future<void> pollForUpdates() async {
    if (_sendIsBlocking || state.isLoadingHistory) return;
    // A conversation that does not exist yet has nothing to read, and reading
    // without naming one would pour the patient's other practice into it.
    if (state.sessionId == null && state.practiceId != null) return;

    // Read the whole conversation, not one session of it.
    //
    // Polling a single session id was the real defect behind "the
    // notification arrives but the message is not there": the clinician's
    // thread spans every care session, so a doctor writing into the newest one
    // was invisible to a patient whose screen had resolved an older one when
    // the tab opened. Both sides now read the same thing.

    try {
      final paged = await _repository.getThread(sessionId: state.sessionId, limit: 200);
      // Cleared here, not at the end of the try: the checks below return early
      // on the ordinary case of "nothing new", so a reset placed after them
      // never runs on a quiet thread — and a thread that had recovered from an
      // outage would have gone on calling itself stale for as long as nobody
      // wrote in it.
      pollFailures = 0;
      // By time, not seq: seq restarts inside each session and cannot order a
      // history that spans several.
      final messages = [...paged.items]..sort((a, b) {
        final at = a.createdAt;
        final bt = b.createdAt;
        if (at == null || bt == null) return a.seq.compareTo(b.seq);
        return at.compareTo(bt);
      });
      // Merged, not replaced, and never compared on length.
      //
      // This used to bail out whenever the server returned fewer messages than
      // were on screen — the guard that stopped a short read wiping a message
      // the patient had just sent. It also meant that if the two ever
      // disagreed by even one, a working fetch was thrown away on every tick
      // and the thread silently stopped moving: reopening the screen showed
      // everything, because opening REPLACES state instead of comparing it.
      // That is the shape the bug had — notifications arriving, screen frozen,
      // reopen and it is all there.
      //
      // A union by id cannot shrink the thread, so nothing needs guarding
      // against. A message the patient just sent survives a server that has
      // not echoed it yet, and a doctor's reply lands whatever else is on
      // screen.
      final merged = _merge(
        _withoutUnsentTheServerHas(state.messages, messages),
        messages,
      );
      // Unchanged polls do nothing, so the list never rebuilds under the
      // patient's scrolling.
      if (!_messagesDiffer(merged, state.messages)) return;
      state = state.copyWith(messages: merged);
    } on ApiException catch (e) {
      _pollFailed(e.code);
    } catch (e) {
      _pollFailed(e.runtimeType.toString());
    }
  }

  /// How many polls in a row have failed. Zero whenever one succeeds.
  ///
  /// A failing poll still costs one tick rather than the screen — retrying is
  /// right and an error banner every two seconds would be intolerable. What
  /// was wrong was that it cost *nothing visible ever*: both catches were
  /// empty, so a thread that had silently stopped updating looked exactly like
  /// a thread with nothing new in it. That is how "messages do not arrive in
  /// real time" survived three rounds of looking for it — there was nothing to
  /// see, in the app or in a log.
  int pollFailures = 0;

  /// True once the poll has failed enough times that the screen should stop
  /// implying it is live. Roughly fifteen seconds at a two-second tick.
  bool get isStale => pollFailures >= 7;

  void _pollFailed(String reason) {
    pollFailures += 1;
    // Logged on the first failure and then every tenth, so a persistent
    // outage leaves a trail without filling the log.
    if (pollFailures == 1 || pollFailures % 10 == 0) {
      debugPrint('chat poll failed ($pollFailures consecutive): $reason');
    }
    // Rebuild only when the answer changes, so a screen that is fine is never
    // rebuilt by a poll and a stale one says so exactly once.
    if (pollFailures == 7) state = state.copyWith();
  }

  /// Everything on screen plus everything the server returned, once each.
  ///
  /// The server's copy wins a collision: it carries the edits, the transcripts
  /// and the real attachment urls, where the local one may be an optimistic
  /// echo. Sorted by time for the same reason the fetch is — seq restarts
  /// inside each session and cannot order a history that spans several.
  static List<ChatMessage> _merge(
    List<ChatMessage> local,
    List<ChatMessage> remote,
  ) {
    final byId = <String, ChatMessage>{};
    for (final m in local) {
      byId[m.id] = m;
    }
    for (final m in remote) {
      byId[m.id] = m;
    }
    return byId.values.toList()..sort((a, b) {
      final at = a.createdAt;
      final bt = b.createdAt;
      if (at == null || bt == null) return a.seq.compareTo(b.seq);
      return at.compareTo(bt);
    });
  }

  /// True when [next] carries anything the current [current] does not — a
  /// different count, a changed id/content, or a differing attachment/voice-note
  /// count on any turn. Kept coarse so an unchanged poll never rebuilds the list
  /// (and never fights the patient's scrolling).
  static bool _messagesDiffer(
    List<ChatMessage> next,
    List<ChatMessage> current,
  ) {
    if (next.length != current.length) return true;
    for (var i = 0; i < next.length; i++) {
      final a = next[i];
      final b = current[i];
      if (a.editedAt != b.editedAt ||
          a.id != b.id ||
          a.content != b.content ||
          a.voiceNotes.length != b.voiceNotes.length ||
          a.attachmentPaths.length != b.attachmentPaths.length) {
        return true;
      }
    }
    return false;
  }

  Future<void> openSession(String sessionId) async {
    // A held message waits for the conversation the patient is choosing.
    state = ChatState(sessionId: sessionId, isLoadingHistory: true, held: state.held);
    try {
      final paged = await _repository.getThread(sessionId: state.sessionId, limit: 200);
      final messages = [...paged.items]..sort((a, b) {
        final at = a.createdAt;
        final bt = b.createdAt;
        if (at == null || bt == null) return a.seq.compareTo(b.seq);
        return at.compareTo(bt);
      });
      state = state.copyWith(messages: messages, isLoadingHistory: false);
    } on ApiException catch (e) {
      state = state.copyWith(isLoadingHistory: false, error: e);
    } catch (_) {
      // Anything at all, not only an ApiException.
      //
      // A malformed page envelope threw a cast error on the way through
      // Paged.fromJson, which this narrow catch never saw — so the spinner
      // stayed up forever and polling, which skips while isLoadingHistory,
      // never ran again either. A loading flag that only clears on the happy
      // path is a screen that can hang on any surprise the server produces.
      state = state.copyWith(isLoadingHistory: false);
    }
  }

  /// Starts a first conversation with one of the patient's practices.
  ///
  /// A patient with two practices who has written to neither has no
  /// conversation to open, and a message that names no practice is refused
  /// rather than guessed at. This names it until the first message comes back
  /// with the conversation it opened.
  void startConversation(String practiceId) {
    state = ChatState(practiceId: practiceId, held: state.held);
  }

  /// Sends the held message into the conversation now open — the one the
  /// patient chose after the server asked. Does nothing when none is held.
  Future<void> sendHeld() async {
    final held = state.held;
    if (held == null) return;
    state = state.copyWith(clearHeld: true);
    await send(text: held.text, language: held.language, attachments: held.attachments);
  }

  /// The patient would rather not send it after all.
  void discardHeld() {
    if (state.held != null) state = state.copyWith(clearHeld: true);
  }

  /// The server's "which practice?": a 409 on a send that named neither a
  /// conversation nor a practice. Nothing else on the send path is a 409, and
  /// a send that did name one is refused for some other reason — asking the
  /// patient to choose again would not help.
  static bool _askedWhichPractice(
    ApiException e, {
    required String? sessionId,
    required String? practiceId,
  }) => e.code == 'CONFLICT' && sessionId == null && practiceId == null;

  /// The written emergency instructions the server sent with that question —
  /// present only when it triaged the message as an emergency.
  static String? _instructionsIn(ApiException e) {
    final text = e.detailsMap['instructions'];
    return text is String && text.trim().isNotEmpty ? text : null;
  }

  /// Opens the patient's existing conversation when the chat tab is first shown.
  Future<void> resumeLatest() async {
    // A conversation just started with a named practice is the one on screen,
    // not the newest the patient has with somebody else.
    if (state.sessionId != null || state.practiceId != null || state.isLoadingHistory) return;
    state = state.copyWith(isLoadingHistory: true, clearError: true);
    try {
      final paged = await _repository.getSessions(limit: 1);
      if (paged.items.isEmpty) {
        state = state.copyWith(isLoadingHistory: false);
        return;
      }
      await openSession(paged.items.first.id);
    } on ApiException catch (e) {
      state = state.copyWith(isLoadingHistory: false, error: e);
    } catch (_) {
      state = state.copyWith(isLoadingHistory: false);
    }
  }

  /// Pins or unpins, then reflects it locally so the thread reorders at once
  /// rather than on the next poll.
  Future<bool> setPinned(String messageId, bool pinned) async {
    try {
      await _repository.setPinned(messageId, pinned);
      state = state.copyWith(
        messages: [
          for (final m in state.messages)
            if (m.id == messageId) m.withPinned(pinned) else m,
        ],
      );
      return true;
    } on ApiException {
      return false;
    }
  }

  /// Hides a message from this patient's view only. Returns the server's message
  /// on refusal so the caller can explain why (an emergency turn cannot be
  /// hidden).
  Future<String?> hideMessage(String messageId) async {
    try {
      await _repository.hideMessage(messageId);
      state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList(),
      );
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// Deletes a message for everyone. Only the patient's own turns qualify (the
  /// server enforces it too); returns the server's message on refusal. The turn
  /// is replaced in place with a tombstone rather than removed, so both sides
  /// keep a "message deleted" marker where it was.
  Future<String?> deleteForEveryone(String messageId) async {
    try {
      await _repository.deleteForEveryone(messageId);
      state = state.copyWith(
        messages: [
          for (final m in state.messages)
            if (m.id == messageId) m.withDeletedForEveryone() else m,
        ],
      );
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<bool> flagMessage(String messageId) async {
    try {
      await _repository.flagMessage(messageId);
      return true;
    } on ApiException {
      return false;
    }
  }

  Future<bool> archiveCurrentSession() async {
    final id = state.sessionId;
    if (id == null) return false;
    try {
      await _repository.archiveSession(id);
      return true;
    } on ApiException {
      return false;
    }
  }
}

final StateNotifierProvider<ChatController, ChatState> chatControllerProvider =
    StateNotifierProvider<ChatController, ChatState>((ref) {
      return ChatController(
        ref.watch(chatRepositoryProvider),
        ref.watch(uploadRepositoryProvider),
      );
    });
