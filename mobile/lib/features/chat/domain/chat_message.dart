import 'citation.dart';
import 'triage.dart';

/// A single turn in a chat session. Matches the `userMessage`/`reply`
/// shape from `POST /chat/message` and the items returned by
/// `GET /chat/sessions/:id/messages` (API_CONTRACT.md §2).
///
/// [citations] and [triage] are NOT part of the message object itself in
/// the contract — they arrive as sibling fields on the `POST /chat/message`
/// response. This app attaches them to the freshly-created assistant
/// message client-side (see `ChatController`) so the emergency/urgent card
/// and citation chips can render immediately after sending. History
/// re-fetched via `GET /chat/sessions/:id/messages` will not have them, but
/// still carries `urgency` (a real per-message field), which is what
/// drives the emergency banner regardless of source.
/// A recording the patient spoke instead of typing.
///
/// [transcript] is produced server-side at upload, so it exists even on a phone
/// with no speech recogniser — and it is what the triage engine and the
/// assistant actually read. Shown under the player so the thread stays
/// skimmable, and so a deaf patient or a doctor in a noisy clinic is not shut
/// out of the conversation.
class VoiceNote {
  const VoiceNote({
    required this.url,
    this.transcript,
    this.mimeType,
    this.localPath,
  });

  /// Relative `/api/v1/uploads/:id/raw` path. Auth header is attached at play
  /// time, the same as protected images.
  final String url;
  final String? transcript;

  /// Set ONLY on an optimistic, just-recorded note: the local recording file on
  /// disk. When present the player plays it directly (no download), so the
  /// bubble is instant and playable the moment the patient hits send — before
  /// the upload finishes. Server notes leave this null and stream from [url].
  final String? localPath;

  /// The stored recording's content type (e.g. `audio/mpeg`). The player uses
  /// it to cache the download under the right extension — ExoPlayer picks its
  /// decoder partly from the file name, so a `.mp3` note saved as `.m4a` simply
  /// refused to play.
  final String? mimeType;
}

/// A document (PDF, Office file, text…) shared in the thread. Rendered as a
/// named file card, not a thumbnail — tapping downloads and opens it with the
/// phone's own viewer.
class DocumentAttachment {
  const DocumentAttachment({
    required this.url,
    required this.name,
    this.mimeType,
    this.sizeBytes,
  });

  /// Relative `/api/v1/uploads/:id/raw` path; auth header is added on download.
  final String url;
  final String name;
  final String? mimeType;
  final int? sizeBytes;
}

/// Classifies a serialised attachment `{id, url, kind, mimeType, …}`.
///
/// Note what `kind` is NOT: it is the upload's *purpose* (`meal_photo`,
/// `lab_report`, `voice_note`, `avatar`, `other`), never a media type. Testing
/// it for `'image'` or `'audio'` matches nothing, which silently files every
/// photo and every recording as a document. Media type comes from [mimeType];
/// `kind` is only consulted for `voice_note`, where it is authoritative.
bool isAudioAttachment(Map a) =>
    a['kind'] == 'voice_note' ||
    (a['mimeType']?.toString().startsWith('audio/') ?? false);

/// A document — a PDF, Office file, text or CSV. Not an image, not audio.
bool isDocumentAttachment(Map a) {
  if (isAudioAttachment(a)) return false;
  final m = a['mimeType']?.toString() ?? '';
  return m.startsWith('application/') || m.startsWith('text/');
}

/// Anything left over is a picture.
bool isImageAttachment(Map a) =>
    !isAudioAttachment(a) && !isDocumentAttachment(a);

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.seq,
    required this.role,
    required this.content,
    required this.language,
    required this.urgency,
    this.isFallback,
    this.createdAt,
    this.citations,
    this.triage,
    this.senderName,
    this.senderRole,
    this.senderAvatarUrl,
    this.pinned = false,
    this.deletedForEveryone = false,
    this.editedAt,
    this.replyToId,
    this.replyPreviewContent,
    this.seenByClinicAt,
    this.attachmentPaths = const [],
    this.voiceNotes = const [],
    this.documents = const [],
    this.action,
    this.sendFailed = false,
  });

  /// True for a message of the patient's that the server did not accept.
  ///
  /// Set on this phone only, and never read from the server. The message used
  /// to be removed from the screen when a send failed, so the patient saw it
  /// vanish with nothing to tap. It now stays, marked, until it is sent again.
  final bool sendFailed;

  /// Recordings attached to this turn. Kept separate from [attachmentPaths]
  /// because a voice note renders as a player, not a thumbnail.
  final List<VoiceNote> voiceNotes;

  /// Documents attached to this turn, rendered as file cards.
  final List<DocumentAttachment> documents;

  /// Something the app offers the reader to do, under this turn.
  ///
  /// Null on nearly every message. The first — and so far only — kind is an
  /// appointment request recognised in what the patient wrote. Nothing has
  /// happened when this is set: it is an offer until somebody taps it.
  final MessageAction? action;

  /// Kept at the top of the thread. A dosing instruction otherwise scrolls out
  /// of reach within a day.
  final bool pinned;

  /// Deleted for everyone by its author. The server withholds the words, files
  /// and quote, so the bubble renders a "message deleted" tombstone in place.
  final bool deletedForEveryone;

  /// When the author last rewrote this, or null if they never did. The thread
  /// marks it; the words the clinic originally saw stay on the server, which
  /// is where a medical record needs them.
  final DateTime? editedAt;

  bool get isEdited => editedAt != null;

  /// Fifteen minutes, matching the server. Checked here as well so the option
  /// simply is not offered once it has expired, rather than being offered and
  /// then refused.
  static const editWindow = Duration(minutes: 15);

  /// An optimistic message not yet acknowledged has no createdAt. Treating
  /// that as "not editable" is right: there is nothing on the server to edit.
  bool get canStillEdit =>
      createdAt != null &&
      DateTime.now().difference(createdAt!) < editWindow &&
      !deletedForEveryone &&
      voiceNotes.isEmpty &&
      urgency != 'emergency';

  /// The message this one answers, when the sender quoted an earlier turn.
  final String? replyToId;

  /// A text preview of the quoted turn, sent by the server so the reply's quote
  /// renders even when the original message is not loaded on this side.
  final String? replyPreviewContent;

  /// When the clinic first read this message. Shown to the patient as "Seen by
  /// the clinic" — chosen over a typing indicator, which would promise a reply
  /// within seconds that a clinician with a full list cannot keep.
  final DateTime? seenByClinicAt;

  final String id;
  final int seq;

  /// `user` | `assistant` | `clinician`.
  ///
  /// `clinician` is the doctor or staff speaking directly into this thread.
  /// There is no separate clinic inbox — the assistant answers what it safely
  /// can and refers the rest, and the clinician's reply lands here so the whole
  /// exchange stays one conversation.
  final String role;
  final String content;
  final String language;

  /// Who wrote a `clinician` turn — that clinician's own name, e.g.
  /// "Dr. Meera Iyer". Null otherwise, and never a practice default.
  final String? senderName;

  /// `doctor` | `staff` | `dietician`, when a person wrote this turn.
  ///
  /// The name alone is not enough. A patient reading "Priya Sharma" cannot tell
  /// the receptionist from their doctor, and the two say very different kinds
  /// of thing — one moves an appointment, the other changes a dose.
  final String? senderRole;

  /// The clinician's or dietician's own photo, so a patient sees the person who
  /// wrote to them rather than a role icon standing in for them.
  final String? senderAvatarUrl;

  /// routine < advice < urgent < emergency.
  final String urgency;
  final bool? isFallback;
  final DateTime? createdAt;

  final List<Citation>? citations;
  final Triage? triage;

  /// Relative `/api/v1/uploads/:id/raw` paths of photos the patient attached.
  /// The full URL and auth header are assembled at render time.
  final List<String> attachmentPaths;

  bool get isUser => role == 'user';

  /// A real person from the clinic, not the assistant. Rendered distinctly so a
  /// patient is never unsure whether they are reading their doctor or an AI.
  bool get isClinician => role == 'clinician';

  /// `dietician` is the assigned dietician speaking into this thread. It is
  /// rendered exactly like a clinician turn — a clinic person, not the AI.
  bool get isDietician => role == 'dietician';

  bool get isEmergency => urgency == 'emergency';
  bool get isUrgent => urgency == 'urgent';

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id']?.toString() ?? '',
      action: MessageAction.fromJson(json['action']),
      seq: (json['seq'] as num?)?.toInt() ?? 0,
      role: json['role']?.toString() ?? 'assistant',
      content: json['content']?.toString() ?? '',
      language: json['language']?.toString() ?? 'en',
      urgency: json['urgency']?.toString() ?? 'routine',
      isFallback: json['isFallback'] as bool?,
      createdAt:
          json['createdAt'] == null
              ? null
              : DateTime.tryParse(json['createdAt'].toString()),
      senderName: json['senderName']?.toString(),
      senderRole: json['senderRole']?.toString(),
      senderAvatarUrl: json['senderAvatarUrl']?.toString(),
      pinned: json['pinned'] == true,
      deletedForEveryone: json['deletedForEveryone'] == true,
      editedAt:
          DateTime.tryParse(json['editedAt']?.toString() ?? '')?.toLocal(),
      replyToId: json['replyToId']?.toString(),
      replyPreviewContent:
          json['replyPreview'] is Map
              ? (json['replyPreview'] as Map)['content']?.toString()
              : null,
      seenByClinicAt:
          json['seenByClinicAt'] == null
              ? null
              : DateTime.tryParse(json['seenByClinicAt'].toString()),
      attachmentPaths: _parseAttachments(json['attachments']),
      voiceNotes: _parseVoiceNotes(json['attachments']),
      documents: _parseDocuments(json['attachments']),
    );
  }

  /// Attachments arrive as `[{id, url, kind, mimeType, transcript}]`.
  ///
  /// Photos and voice notes are split here rather than in the widget tree: a
  /// recording and a foot photograph want completely different rendering, and
  /// deciding that once keeps every consumer from re-sniffing mime types.
  static List<String> _parseAttachments(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .where((a) => a is! Map || (!_isAudio(a) && !_isDocument(a)))
        .map((a) => a is Map ? a['url']?.toString() : a?.toString())
        .whereType<String>()
        .where((s) => s.isNotEmpty)
        .toList();
  }

  static List<DocumentAttachment> _parseDocuments(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .where(_isDocument)
        .map(
          (a) => DocumentAttachment(
            url: a['url']?.toString() ?? '',
            name:
                (a['name']?.toString().trim().isNotEmpty ?? false)
                    ? a['name'].toString()
                    : 'Document',
            mimeType: a['mimeType']?.toString(),
            sizeBytes: (a['sizeBytes'] as num?)?.toInt(),
          ),
        )
        .where((d) => d.url.isNotEmpty)
        .toList();
  }

  static List<VoiceNote> _parseVoiceNotes(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .where(_isAudio)
        .map(
          (a) => VoiceNote(
            url: a['url']?.toString() ?? '',
            transcript: a['transcript']?.toString(),
            mimeType: a['mimeType']?.toString(),
          ),
        )
        .where((v) => v.url.isNotEmpty)
        .toList();
  }

  static bool _isAudio(Map a) => isAudioAttachment(a);
  static bool _isDocument(Map a) => isDocumentAttachment(a);

  /// Returns a copy with new [content] — used to grow a streaming reply as
  /// tokens arrive, keeping every other field.
  ChatMessage withContent(String content) => ChatMessage(
    id: id,
    seq: seq,
    role: role,
    content: content,
    language: language,
    urgency: urgency,
    isFallback: isFallback,
    createdAt: createdAt,
    citations: citations,
    triage: triage,
    senderName: senderName,
    senderRole: senderRole,
    senderAvatarUrl: senderAvatarUrl,
    pinned: pinned,
    deletedForEveryone: deletedForEveryone,
    replyToId: replyToId,
    replyPreviewContent: replyPreviewContent,
    seenByClinicAt: seenByClinicAt,
    attachmentPaths: attachmentPaths,
    voiceNotes: voiceNotes,
    documents: documents,
  );

  /// Returns a copy with [pinned] flipped, so the thread reorders immediately
  /// instead of waiting for the next poll to confirm it.
  ChatMessage withPinned(bool value) => ChatMessage(
    id: id,
    seq: seq,
    role: role,
    content: content,
    language: language,
    urgency: urgency,
    isFallback: isFallback,
    createdAt: createdAt,
    citations: citations,
    triage: triage,
    senderName: senderName,
    senderRole: senderRole,
    senderAvatarUrl: senderAvatarUrl,
    pinned: value,
    deletedForEveryone: deletedForEveryone,
    replyToId: replyToId,
    replyPreviewContent: replyPreviewContent,
    seenByClinicAt: seenByClinicAt,
    attachmentPaths: attachmentPaths,
    voiceNotes: voiceNotes,
    documents: documents,
  );

  /// A copy marked deleted-for-everyone, with its words, files and quote
  /// cleared — so the tombstone shows the instant the author deletes it, before
  /// the thread reloads and the server's own tombstone arrives.
  ChatMessage withDeletedForEveryone() => ChatMessage(
    id: id,
    seq: seq,
    role: role,
    content: '',
    language: language,
    urgency: urgency,
    isFallback: isFallback,
    createdAt: createdAt,
    senderName: senderName,
    senderRole: senderRole,
    senderAvatarUrl: senderAvatarUrl,
    pinned: false,
    deletedForEveryone: true,
    replyToId: null,
    replyPreviewContent: null,
    seenByClinicAt: seenByClinicAt,
    attachmentPaths: const [],
    voiceNotes: const [],
    documents: const [],
  );

  /// Every field, not the handful this happened to need.
  ///
  /// It listed fifteen of twenty-two, so copying a message to attach citations
  /// quietly unpinned it, forgot it had been edited, dropped the turn it was
  /// replying to and cleared the clinic's read mark. A copy that loses things
  /// is worse than no copy: the loss shows up somewhere else entirely, long
  /// after, as a pin that will not stay put.
  ChatMessage copyWith({List<Citation>? citations, Triage? triage}) {
    return ChatMessage(
      id: id,
      seq: seq,
      role: role,
      content: content,
      language: language,
      urgency: urgency,
      isFallback: isFallback,
      createdAt: createdAt,
      citations: citations ?? this.citations,
      triage: triage ?? this.triage,
      senderName: senderName,
      senderRole: senderRole,
      senderAvatarUrl: senderAvatarUrl,
      pinned: pinned,
      deletedForEveryone: deletedForEveryone,
      editedAt: editedAt,
      replyToId: replyToId,
      replyPreviewContent: replyPreviewContent,
      seenByClinicAt: seenByClinicAt,
      attachmentPaths: attachmentPaths,
      voiceNotes: voiceNotes,
      documents: documents,
      action: action,
      sendFailed: sendFailed,
    );
  }
}

/// An offer drawn under a message: a thing the reader may do next.
///
/// Deliberately one type rather than a field per feature. The clinic's first is
/// an appointment request; whatever the second turns out to be will not be
/// worth another shape.
class MessageAction {
  const MessageAction({required this.kind, this.preferredFor, this.timePhrase});

  /// Which card to draw. Unknown kinds are dropped rather than rendered, so an
  /// older app meeting a newer server shows the reply and no card, instead of
  /// a broken box.
  final String kind;

  /// The day the patient seems to have meant, or null when they named none —
  /// which is a real answer. "Can I get an appointment?" says no day, and the
  /// card asks for one rather than inventing tomorrow.
  final DateTime? preferredFor;

  /// The hour they mentioned, in their own words: "around 4pm". Never parsed
  /// into a slot — a request carries a day and no time, because the desk
  /// offers the times the doctor is actually free.
  final String? timePhrase;

  static const _known = {'appointment_request'};

  static MessageAction? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final kind = raw['kind']?.toString();
    if (kind == null || !_known.contains(kind)) return null;
    return MessageAction(
      kind: kind,
      preferredFor:
          DateTime.tryParse(raw['preferredFor']?.toString() ?? '')?.toLocal(),
      timePhrase: raw['timePhrase']?.toString(),
    );
  }
}

/// When the newest message the server has delivered was written: how far a
/// screen showing [messages] has been read.
///
/// A message still being sent carries a temporary id and the phone's own
/// clock, which can be minutes out from the server's, so it does not count.
DateTime? newestDeliveredAt(Iterable<ChatMessage> messages) {
  DateTime? newest;
  for (final m in messages) {
    final at = m.createdAt;
    if (at == null || m.id.isEmpty || m.id.startsWith('__')) continue;
    if (newest == null || at.isAfter(newest)) newest = at;
  }
  return newest;
}
