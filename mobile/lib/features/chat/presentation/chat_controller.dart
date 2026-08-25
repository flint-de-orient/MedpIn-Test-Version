import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../shared/data/upload_repository.dart';
import '../data/chat_repository.dart';
import '../domain/chat_message.dart';

class ChatState {
  const ChatState({
    this.sessionId,
    this.messages = const [],
    this.isSending = false,
    this.isLoadingHistory = false,
    this.error,
  });

  final String? sessionId;
  final List<ChatMessage> messages;
  final bool isSending;
  final bool isLoadingHistory;
  final ApiException? error;

  ChatState copyWith({
    String? sessionId,
    List<ChatMessage>? messages,
    bool? isSending,
    bool? isLoadingHistory,
    ApiException? error,
    bool clearError = false,
  }) {
    return ChatState(
      sessionId: sessionId ?? this.sessionId,
      messages: messages ?? this.messages,
      isSending: isSending ?? this.isSending,
      isLoadingHistory: isLoadingHistory ?? this.isLoadingHistory,
      error: clearError ? null : (error ?? this.error),
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
    state = state.copyWith(
      isSending: true,
      clearError: true,
      messages: [...state.messages, optimisticUser],
    );

    // Non-streaming send. The production API sits behind an Apache reverse proxy
    // that buffers Server-Sent Events, so the streaming endpoint hangs and the
    // assistant appears dead. The plain endpoint returns the whole reply at once
    // and is reliable on every network and proxy.
    try {
      final result = await _repository.sendMessage(
        sessionId: state.sessionId,
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
        isSending: false,
      );
    } on ApiException catch (e) {
      state = state.copyWith(
        messages: state.messages.where((m) => m.id != tempUserId).toList(),
        isSending: false,
        error: e,
      );
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
    state = state.copyWith(
      isSending: true,
      clearError: true,
      messages: [...state.messages, optimistic],
    );

    try {
      final asset = await _uploadRepository.uploadImage(
        path: localPath,
        filename: localPath.split(RegExp(r'[/\\]')).last,
        kind: UploadKind.voiceNote,
      );
      final result = await _repository.sendMessage(
        sessionId: state.sessionId,
        // The transcript becomes the text so deterministic triage reads a spoken
        // "chest pain" the same as a typed one; empty is fine (the audio is still
        // stored and sent).
        text: asset.transcript?.trim() ?? '',
        language: language,
        attachments: [asset.id],
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
        isSending: false,
      );
    } on ApiException catch (e) {
      state = state.copyWith(
        messages: state.messages.where((m) => m.id != tempId).toList(),
        isSending: false,
        error: e,
      );
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
  Future<void> pollForUpdates() async {
    final id = state.sessionId;
    if (id == null || state.isSending || state.isLoadingHistory) return;

    try {
      final paged = await _repository.getSessionMessages(id, limit: 200);
      final messages = [...paged.items]..sort((a, b) => a.seq.compareTo(b.seq));
      // NEVER shrink the visible thread. A message the patient just sent that the
      // server has not echoed back on this exact poll — or a transient short
      // read — must not wipe what is on screen. Dropping this guard is what made
      // sent text, voice and photos flash up and then vanish a second later.
      if (messages.length < state.messages.length) return;
      // Otherwise replace when anything changed — a new clinician reply, or a
      // message whose content/attachments came back fuller — so a doctor's reply
      // appears live and nothing renders stale. Unchanged polls do nothing, so
      // the list never rebuilds under the patient's scrolling.
      if (!_messagesDiffer(messages, state.messages)) return;
      state = state.copyWith(messages: messages);
    } on ApiException {
      // Ignored on purpose — the next tick retries.
    }
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
      if (a.id != b.id ||
          a.content != b.content ||
          a.voiceNotes.length != b.voiceNotes.length ||
          a.attachmentPaths.length != b.attachmentPaths.length) {
        return true;
      }
    }
    return false;
  }

  Future<void> openSession(String sessionId) async {
    state = ChatState(sessionId: sessionId, isLoadingHistory: true);
    try {
      final paged = await _repository.getSessionMessages(sessionId, limit: 100);
      final messages = [...paged.items]..sort((a, b) => a.seq.compareTo(b.seq));
      state = state.copyWith(messages: messages, isLoadingHistory: false);
    } on ApiException catch (e) {
      state = state.copyWith(isLoadingHistory: false, error: e);
    }
  }

  /// Opens the patient's existing conversation when the chat tab is first shown.
  Future<void> resumeLatest() async {
    if (state.sessionId != null || state.isLoadingHistory) return;
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
