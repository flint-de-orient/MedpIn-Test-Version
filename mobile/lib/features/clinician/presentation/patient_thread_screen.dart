import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';

import '../../../core/capabilities/capabilities.dart';
import '../../../core/router/area.dart';

import '../../../core/network/api_exception.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../core/theme/tokens.dart';
import '../../../shared/widgets/load_failed.dart';
import '../../chat/domain/chat_message.dart';
import '../../chat/data/chat_repository.dart';

import '../../chat/presentation/widgets/chat_message_bubble.dart';
import '../../../shared/widgets/chat_background.dart';
import '../../chat/presentation/widgets/voice_recorder_bar.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';
import '../../chat/presentation/widgets/edit_message_sheet.dart';
import '../../chat/presentation/widgets/assistant_control.dart';
import 'widgets/inbox_states.dart';

/// What the doctor's attach button offers.
enum _DoctorAttach { camera, gallery, document }

/// The clinician's view of a patient's conversation — the doctor's, and the
/// front desk's.
///
/// Renders with [ChatMessageBubble] — the same widget the patient's Care Team
/// screen uses — so the doctor is looking at exactly what the patient is
/// looking at, down to the emergency cards and citations. A separate clinician
/// chat UI was what let the two drift into showing different conversations.
///
/// ---- What changed, and why -------------------------------------------------
///
/// Re-reading after a send that then failed replaced the whole conversation
/// with "Could not load the conversation", and a poll that failed was silently
/// ignored, so the thread could sit hours out of date with nothing saying so.
/// The messages that loaded now stay on screen, marked with when they loaded.
///
/// A role that may read conversations but not answer them was shown a
/// composer whose every send the server refused. It is told it can read and
/// not reply, and a role that may not read them at all is told that, rather
/// than that the thread failed to load.
///
/// The name in the header was cut to "Kalyani Bandyopadh…" by the controls
/// beside it. The bar grows with the text size, and the name has two lines.
class PatientThreadScreen extends ConsumerStatefulWidget {
  const PatientThreadScreen({
    super.key,
    required this.patientId,
    this.patientName,
  });

  final String patientId;
  final String? patientName;

  @override
  ConsumerState<PatientThreadScreen> createState() =>
      _PatientThreadScreenState();
}

class _PatientThreadScreenState extends ConsumerState<PatientThreadScreen> {
  /// Beats while this screen is up, so the assistant holds off for as long as
  /// the doctor is actually reading.
  ClinicianPresence? _presence;

  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _scrollController = ScrollController();

  List<ChatMessage> _messages = const [];
  String? _patientName;

  /// Carried so the doctor can call from inside the conversation, which is
  /// where the decision to stop typing and phone someone is actually made.
  String? _patientPhone;

  /// The photo the patient set. Part of recognising who you are talking to,
  /// so it is read from the thread rather than left as an initial.
  String? _patientAvatarUrl;
  bool _loading = true;
  bool _sending = false;

  /// The message the doctor is quoting in their next reply. Shown as a preview
  /// bar above the composer until they send or dismiss it.
  ChatMessage? _replyingTo;

  /// True while the doctor is recording a reply, which swaps the composer for
  /// [VoiceRecorderBar] — same treatment as the patient's side.
  bool _recording = false;

  /// Why nothing could be shown — only ever set while there are no messages.
  Object? _error;

  /// A read failed after messages had loaded, so what is on screen may be out
  /// of date. The messages stay; this says so.
  bool _stale = false;

  /// When the messages on screen last arrived from the server.
  DateTime? _loadedAt;

  /// Whether the newest message has scrolled out of view. Same affordance the
  /// patient has: on a long thread, reading back and then returning to the
  /// bottom otherwise means a lot of dragging.
  bool _showJumpToLatest = false;

  /// Keeps the conversation live while the clinician has it open, so a message
  /// the patient sends appears without reopening the screen. Same interval as
  /// the patient's side, for the same reason: no socket or push channel exists.
  /// Two seconds in every thread, patient and clinician alike.
  ///
  /// The nutrition threads sat at eight, which is what "messages arrive late"
  /// actually was: a reply could be on the server for the better part of ten
  /// seconds before either side saw it, and leaving the screen and coming back
  /// fetched it immediately — which is precisely how it was reported.
  static const _pollInterval = Duration(seconds: 2);
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // Hold the assistant back for as long as this screen is up. The beat
    // stops in dispose, and lapses by itself if the app never gets there.
    _presence = ClinicianPresence(
      ref,
      patientId: widget.patientId,
      kind: ThreadKind.care,
    )..start();
    _patientName = widget.patientName;
    _load();
    _poll = Timer.periodic(_pollInterval, (_) => _pollForUpdates());
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    final away = pos.maxScrollExtent - pos.pixels > 240;
    if (away != _showJumpToLatest) setState(() => _showJumpToLatest = away);
  }

  @override
  void dispose() {
    _presence?.stop();
    _poll?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Silent refresh: no spinner, no error, and state is replaced only when a
  /// message actually arrived — otherwise every tick would rebuild the
  /// transcript under the doctor's scrolling.

  /// Whether [next] carries anything [current] does not — a different count, a
  /// different id or text on any row, or an edit. Coarse on purpose: an
  /// unchanged poll must not rebuild the list and fight the reader's scroll.
  static bool _threadChanged(
    List<ChatMessage> next,
    List<ChatMessage> current,
  ) {
    if (next.length != current.length) return true;
    for (var i = 0; i < next.length; i++) {
      final a = next[i];
      final b = current[i];
      if (a.id != b.id ||
          a.content != b.content ||
          a.editedAt != b.editedAt ||
          a.deletedForEveryone != b.deletedForEveryone) {
        return true;
      }
    }
    return false;
  }

  Future<void> _pollForUpdates() async {
    if (!mounted || _sending || _loading) return;
    // A role that may not read the thread would only collect refusals.
    if (!mayReadConversations(ref.read(capabilitySetProvider))) return;
    if (refusedForRole(_error)) return;
    try {
      final result = await ref
          .read(clinicianRepositoryProvider)
          .patientThread(widget.patientId);
      if (!mounted) return;
      _loadedAt = DateTime.now();
      final recovered = _stale || _error != null;
      // Count is not the only thing that changes.
      //
      // This compared lengths and returned unless the thread had GROWN, so an
      // edited message, a deleted-for-everyone tombstone and a turn whose
      // attachments finished uploading all went unnoticed until the screen was
      // left and reopened. Compare what is actually on the row.
      final changed = _threadChanged(result.messages, _messages);
      if (!changed && !recovered) return;
      final grew = result.messages.length > _messages.length;
      setState(() {
        _messages = result.messages;
        _stale = false;
        _error = null;
      });
      // Only follow a genuinely new message down; re-rendering an edit should
      // not yank the reader away from where they were looking.
      if (grew) _scrollToBottom();
    } catch (_) {
      // Any failure, not only an ApiException: a narrow catch is how a poll
      // quietly stops for the rest of a session. The next tick retries; until
      // one succeeds, the messages on screen are marked as possibly old.
      if (mounted && _messages.isNotEmpty && !_stale) {
        setState(() => _stale = true);
      }
    }
  }

  Future<void> _load() async {
    try {
      final result = await ref
          .read(clinicianRepositoryProvider)
          .patientThread(widget.patientId);
      if (!mounted) return;
      setState(() {
        _messages = result.messages;
        _patientName = result.patientName ?? _patientName;
        _patientPhone = result.patientPhone ?? _patientPhone;
        _patientAvatarUrl = result.patientAvatarUrl ?? _patientAvatarUrl;
        _loading = false;
        _error = null;
        _stale = false;
        _loadedAt = DateTime.now();
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        // Messages already on screen are kept and marked, never replaced by
        // an error: a reload after a send that fails must not blank the
        // conversation the doctor is in the middle of.
        if (_messages.isEmpty) {
          _error = e;
        } else {
          _stale = true;
        }
      });
    }
  }

  /// Pins the thread to the newest message.
  ///
  /// Jumped twice, a beat apart. On the first frame after a load the list has
  /// only built the rows it can see, so `maxScrollExtent` is an underestimate —
  /// jumping to it lands partway up and leaves the doctor scrolling down to
  /// find the message they opened the thread to read. The second jump runs once
  /// the remaining rows have been laid out and the extent is real.
  void _scrollToBottom() {
    void jump() {
      if (!_scrollController.hasClients) return;
      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      jump();
      Future.delayed(const Duration(milliseconds: 120), () {
        if (mounted) jump();
      });
    });
  }

  Future<void> _call() async {
    final phone = _patientPhone;
    if (phone == null) return;
    final messenger = ScaffoldMessenger.of(context);
    if (!await launchUrl(Uri(scheme: 'tel', path: phone))) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not start a call to $phone')),
      );
    }
  }

  /// Records a reply instead of typing it.
  ///
  /// A doctor between patients can say in fifteen seconds what would take a
  /// minute to thumb-type, and the patient hears their actual voice — which
  /// carries reassurance that text does not. Uploaded and transcribed the same
  /// way as the patient's, so the thread stays readable either way.
  Future<void> _sendVoiceNote(String path) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: path,
            filename: path.split(RegExp(r'[/\\]')).last,
            kind: UploadKind.voiceNote,
            patientId: widget.patientId,
          );
      await ref
          .read(clinicianRepositoryProvider)
          .messagePatient(
            patientId: widget.patientId,
            // WhatsApp-style: the message text is just a marker, not the transcript —
            // so the thread, the inbox preview and the patient's push notification
            // all read "Voice message" rather than the spoken words.
            content: 'Voice message',
            attachments: [asset.id],
            replyTo: _replyingTo?.id,
          );
      if (mounted) setState(() => _replyingTo = null);
      await _load();
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not send. Please try again.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Sends a photo to the patient — the doctor's version of the patient's
  /// attach button. Uploads it, then sends it as a message with the text in the
  /// box as its caption (or a default, so the message is never empty).
  Future<void> _sendImage() async {
    final choice = await _pickAttachSource();
    if (choice == null || !mounted) return;
    if (choice == _DoctorAttach.document) {
      await _sendDocuments();
      return;
    }
    final picker = ImagePicker();
    final source =
        choice == _DoctorAttach.camera
            ? ImageSource.camera
            : ImageSource.gallery;
    // Gallery allows picking several at once; the camera takes one.
    final List<XFile> files;
    if (source == ImageSource.gallery) {
      files = await picker.pickMultiImage(maxWidth: 2000, imageQuality: 85);
    } else {
      final f = await picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 2000,
        imageQuality: 85,
      );
      files = f == null ? const [] : [f];
    }
    if (files.isEmpty || !mounted) return;

    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final ids = <String>[];
      for (final file in files.take(5)) {
        final asset = await ref
            .read(uploadRepositoryProvider)
            .uploadImage(
              path: file.path,
              filename: file.name,
              kind: UploadKind.other,
              patientId: widget.patientId,
            );
        ids.add(asset.id);
      }
      // Caption is optional — photos can go on their own.
      await ref
          .read(clinicianRepositoryProvider)
          .messagePatient(
            patientId: widget.patientId,
            content: _controller.text.trim(),
            attachments: ids,
            replyTo: _replyingTo?.id,
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      await _load();
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Could not send the photo. Please try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<_DoctorAttach?> _pickAttachSource() {
    return showModalBottomSheet<_DoctorAttach>(
      context: context,
      showDragHandle: true,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: const Text('Take photo'),
                  onTap: () => Navigator.pop(ctx, _DoctorAttach.camera),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Choose from gallery'),
                  onTap: () => Navigator.pop(ctx, _DoctorAttach.gallery),
                ),
                ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: const Text('Document'),
                  subtitle: const Text('PDF, Word, Excel, text…'),
                  onTap: () => Navigator.pop(ctx, _DoctorAttach.document),
                ),
              ],
            ),
          ),
    );
  }

  /// Sends one or more documents (PDF / Office / text) to the patient, owned by
  /// the patient so they can open them.
  Future<void> _sendDocuments() async {
    FilePickerResult? result;
    try {
      result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        type: FileType.custom,
        allowedExtensions: const [
          'pdf',
          'doc',
          'docx',
          'xls',
          'xlsx',
          'ppt',
          'pptx',
          'txt',
          'csv',
        ],
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not pick the file.')),
        );
      }
      return;
    }
    final picked =
        result?.files.where((f) => f.path != null).take(5).toList() ?? const [];
    if (picked.isEmpty || !mounted) return;

    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final ids = <String>[];
      for (final f in picked) {
        final asset = await ref
            .read(uploadRepositoryProvider)
            .uploadImage(
              path: f.path!,
              filename: f.name,
              kind: UploadKind.other,
              patientId: widget.patientId,
            );
        ids.add(asset.id);
      }
      await ref
          .read(clinicianRepositoryProvider)
          .messagePatient(
            patientId: widget.patientId,
            content: _controller.text.trim(),
            attachments: ids,
            replyTo: _replyingTo?.id,
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      await _load();
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Could not send the file. Please try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;

    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    final replyTo = _replyingTo?.id;
    try {
      await ref
          .read(clinicianRepositoryProvider)
          .messagePatient(
            patientId: widget.patientId,
            content: text,
            replyTo: replyTo,
          );
      _controller.clear();
      if (mounted) setState(() => _replyingTo = null);
      // Re-read rather than appending locally, so the doctor sees the message
      // exactly as it was stored — and as the patient will receive it.
      await _load();
    } on ApiException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not send. Please try again.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Pins or unpins, reflecting it at once so the "Pinned" marker appears
  /// immediately, then confirming with the server (rolling back on failure).
  Future<void> _togglePin(ChatMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    final next = !m.pinned;
    setState(() {
      _messages = [
        for (final x in _messages)
          if (x.id == m.id) x.withPinned(next) else x,
      ];
    });
    try {
      await ref.read(chatRepositoryProvider).setPinned(m.id, next);
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _messages = [
          for (final x in _messages)
            if (x.id == m.id) x.withPinned(!next) else x,
        ];
      });
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update the pin.')),
      );
    }
  }

  /// Hides the message from the doctor's own view (reversible; the record is
  /// kept). Surfaces the server's reason on refusal (an emergency turn).
  Future<void> _hide(ChatMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).hideMessage(m.id);
      if (mounted) {
        setState(
          () => _messages = _messages.where((x) => x.id != m.id).toList(),
        );
      }
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Deletes one of the doctor's own turns for everyone — the patient then sees
  /// a "message deleted" tombstone. The server enforces author-only too.
  Future<void> _deleteForEveryone(ChatMessage m) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(chatRepositoryProvider).deleteForEveryone(m.id);
      if (!mounted) return;
      setState(() {
        _messages = [
          for (final x in _messages)
            if (x.id == m.id) x.withDeletedForEveryone() else x,
        ];
      });
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Brings the quoted turn into view when its reply preview is tapped.
  void _scrollToMessage(String id) {
    final index = _messages.indexWhere((m) => m.id == id);
    if (index < 0 || !_scrollController.hasClients || _messages.isEmpty) return;
    final target =
        _scrollController.position.maxScrollExtent * (index / _messages.length);
    _scrollController.animateTo(
      target.clamp(0.0, _scrollController.position.maxScrollExtent),
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  /// Rewrite one of our own turns, then reload so the thread shows the new
  /// words and the "edited" mark. The sheet reports its own failures.
  Future<void> _editMessage(ChatMessage message) async {
    final saved = await showEditMessageSheet(context, ref, message);
    if (saved && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(capabilitySetProvider);
    final mayRead = mayReadConversations(caps) && !refusedForRole(_error);
    final mayReply = mayReplyInConversations(caps);
    final name = _patientName;

    // The bar grows with the text size, so a two-line name is never cut.
    final barHeight =
        MediaQuery.textScalerOf(
          context,
        ).scale(T.s12 + T.s4).clamp(kToolbarHeight, T.s12 * 2).toDouble();

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: barHeight,
        titleSpacing: 0,
        // The face and the name are the way into the record: tapping a
        // person's photograph to see who they are is what every messaging app
        // has taught people to expect.
        title: Semantics(
          button: true,
          label: 'Open ${name ?? 'the patient'}’s record',
          excludeSemantics: true,
          child: InkWell(
            borderRadius: BorderRadius.circular(T.rControl),
            // The prefix, not a literal: this header is the front desk's only
            // way into a record, and `/clinician/...` is an area the router
            // bounces staff straight out of — onto a blank Today.
            onTap:
                () => context.push(
                  '${areaPrefix(ref)}/patients/${widget.patientId}',
                  extra: name,
                ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: T.s1),
              child: Row(
                children: [
                  UserAvatar(
                    name: nameForInitial(name ?? '?'),
                    avatarUrl: _patientAvatarUrl,
                    accent: T.primary,
                    size: T.s8 + T.s1,
                  ),
                  const SizedBox(width: T.s3),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          name ?? 'Conversation',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: T.bodyStrong.copyWith(
                            color: T.ink,
                            height: 1.25,
                          ),
                        ),
                        // Says what tapping does.
                        Text(
                          'View record',
                          style: T.label.copyWith(
                            color: T.primary,
                            letterSpacing: 0,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          if (mayRead && mayReply)
            // In the thread's own header, not a settings screen: the decision
            // is about this conversation and is normally made on opening it.
            AssistantToggle(patientId: widget.patientId, kind: ThreadKind.care),
          // Calling belongs here rather than on the inbox row: the decision to
          // stop typing and phone someone is made while reading the exchange.
          if (_patientPhone != null)
            IconButton(
              tooltip: 'Call ${name ?? 'the patient'}',
              icon: const Icon(Icons.call_outlined, color: T.primary),
              onPressed: _call,
            ),
          const SizedBox(width: T.s1),
        ],
      ),
      // Matches the patient's screen: a fixed background that never repaints
      // as the keyboard animates.
      resizeToAvoidBottomInset: false,
      body: ChatBackground(
        child: _KeyboardInset(
          child: Column(
            children: [
              if (mayRead && _stale && _messages.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s4, 0),
                  child: StaleNotice.english(
                    context: context,
                    what: 'the conversation',
                    loadedAt: _loadedAt,
                    onRetry: _load,
                  ),
                ),
              Expanded(
                child: Stack(
                  children: [
                    _body(mayRead),
                    if (_showJumpToLatest)
                      Positioned(
                        right: T.s4,
                        bottom: T.s4,
                        child: Semantics(
                          button: true,
                          label: 'Jump to the newest message',
                          excludeSemantics: true,
                          child: Material(
                            color: T.primary,
                            shape: const CircleBorder(),
                            elevation: 3,
                            child: InkWell(
                              customBorder: const CircleBorder(),
                              onTap: _scrollToBottom,
                              child: const SizedBox.square(
                                dimension: T.tap,
                                child: Icon(
                                  Icons.keyboard_arrow_down_rounded,
                                  color: T.surfaceRaised,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (mayRead) ...[
                // The turn being quoted, shown above the composer until sent.
                if (_replyingTo != null)
                  _ReplyPreviewBar(
                    message: _replyingTo!,
                    onCancel: () => setState(() => _replyingTo = null),
                  ),
                if (!mayReply)
                  const _ReadOnlyNote()
                // Recording replaces the composer, as on the patient's side.
                else if (_recording)
                  VoiceRecorderBar(
                    onCancel: () => setState(() => _recording = false),
                    onSend: (path, _) {
                      setState(() => _recording = false);
                      _sendVoiceNote(path);
                    },
                  )
                else
                  _Composer(
                    controller: _controller,
                    focusNode: _focusNode,
                    sending: _sending,
                    onSend: _send,
                    onRecord: () => setState(() => _recording = true),
                    onAttach: _sendImage,
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(bool mayRead) {
    if (!mayRead) {
      return ListView(
        padding: const EdgeInsets.all(T.s4),
        children: const [NotYourRole(what: 'patients’ conversations')],
      );
    }

    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(T.s4),
        children: [LoadFailed(what: 'the conversation', onRetry: _retry)],
      );
    }

    if (_messages.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(T.s4),
        children: const [
          InboxEmpty(
            icon: Icons.forum_outlined,
            title: 'No messages yet',
            body:
                'Nothing has been written in this conversation. Anything you '
                'send starts it, and the patient reads it in the app.',
          ),
        ],
      );
    }

    return ListView.builder(
      controller: _scrollController,
      // Bottom clearance for the floating jump-to-latest button.
      padding: const EdgeInsets.fromLTRB(T.s4, T.s4, T.s4, T.s4 + T.tap),
      itemCount: _messages.length,
      itemBuilder: (context, i) {
        final m = _messages[i];
        return RepaintBoundary(
          child: ChatMessageBubble(
            message: m,
            isClinicianView: true,
            repliedTo:
                m.replyToId == null
                    ? null
                    : _messages.where((x) => x.id == m.replyToId).firstOrNull,
            onQuoteTap:
                m.replyToId == null
                    ? null
                    : () => _scrollToMessage(m.replyToId!),
            onReply: () => setState(() => _replyingTo = m),
            onTogglePin: () => _togglePin(m),
            onHide: () => _hide(m),
            // Only the doctor's own clinician turns are theirs to delete for
            // everyone; the server enforces the same author-only rule.
            onDeleteForEveryone:
                m.isClinician ? () => _deleteForEveryone(m) : null,
            onEdit: m.isClinician ? () => _editMessage(m) : null,
          ),
        );
      },
    );
  }

  /// Try the first load again, from a clean slate.
  Future<void> _retry() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    await _load();
  }
}

/// See the identical widget on the patient's chat screen: reading the keyboard
/// inset here confines the per-frame rebuild to this one widget instead of the
/// whole transcript.
class _KeyboardInset extends StatelessWidget {
  const _KeyboardInset({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: child,
    );
  }
}

/// Where the composer would be, for a role that may read but not answer.
class _ReadOnlyNote extends StatelessWidget {
  const _ReadOnlyNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: T.surfaceRaised,
        border: Border(top: BorderSide(color: T.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(T.s4),
          child: Text(
            'Your role can read this conversation but not reply to it.',
            style: T.small.copyWith(color: T.inkMuted),
          ),
        ),
      ),
    );
  }
}

/// The quoted-turn strip shown above the composer while the doctor is replying
/// to a specific message. Cancelling clears the quote.
class _ReplyPreviewBar extends StatelessWidget {
  const _ReplyPreviewBar({required this.message, required this.onCancel});

  final ChatMessage message;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    // Who is being quoted. Every turn that was not the patient's said "You",
    // so quoting the assistant read as quoting yourself.
    final who =
        message.isUser
            ? (message.senderName ?? 'the patient')
            : message.isClinician || message.isDietician
            ? (message.senderName ?? 'the clinic')
            : 'the assistant';
    final preview =
        message.content.trim().isNotEmpty
            ? message.content.trim()
            : (message.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      decoration: const BoxDecoration(
        color: T.surfaceRaised,
        border: Border(top: BorderSide(color: T.line)),
      ),
      padding: const EdgeInsets.fromLTRB(T.s4, T.s2, T.s1, T.s2),
      child: Row(
        children: [
          Container(width: T.s1, height: T.s8, color: T.primary),
          const SizedBox(width: T.s2),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Replying to $who',
                  style: T.label.copyWith(color: T.primary),
                ),
                Text(
                  preview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel reply',
            icon: const Icon(Icons.close_rounded),
            onPressed: onCancel,
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.sending,
    required this.onSend,
    required this.onRecord,
    required this.onAttach,
  });

  /// Starts a voice reply. A doctor between patients can say in fifteen seconds
  /// what would take a minute to thumb-type, and the patient hears an actual
  /// voice — which carries reassurance that text does not.
  final VoidCallback onRecord;

  /// Attach a photo or a document to send the patient.
  final VoidCallback onAttach;

  final TextEditingController controller;

  /// Held by the screen rather than the TextField's own internal one, so a
  /// rebuild from the poll cannot drop focus while the doctor is mid-sentence.
  final FocusNode focusNode;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(T.s2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              // Whole pill is the tap target, so the keyboard opens on the
              // first tap wherever it lands.
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  if (!focusNode.hasFocus) focusNode.requestFocus();
                },
                child: Container(
                  constraints: const BoxConstraints(minHeight: T.hControl),
                  decoration: BoxDecoration(
                    color: T.surfaceRaised,
                    borderRadius: BorderRadius.circular(T.rControl),
                    border: Border.all(color: T.line),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: T.s1),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Attach on the left, matching the patient's composer.
                      IconButton(
                        tooltip: 'Attach a photo or document',
                        onPressed: sending ? null : onAttach,
                        icon: const Icon(
                          Icons.attach_file_rounded,
                          color: T.inkMuted,
                        ),
                      ),
                      Expanded(
                        child: TextField(
                          controller: controller,
                          focusNode: focusNode,
                          minLines: 1,
                          maxLines: 5,
                          textCapitalization: TextCapitalization.sentences,
                          style: T.body.copyWith(color: T.ink),
                          decoration: const InputDecoration(
                            hintText: 'Reply to this patient…',
                            hintMaxLines: 1,
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            filled: false,
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                              vertical: T.s4,
                            ),
                          ),
                          onSubmitted: (_) => onSend(),
                        ),
                      ),
                      // Speak instead of typing, same as the patient has.
                      IconButton(
                        tooltip: 'Record a voice reply',
                        onPressed: sending ? null : onRecord,
                        icon: const Icon(
                          Icons.mic_none_rounded,
                          color: T.inkMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: T.s2),
            Semantics(
              button: true,
              label: 'Send',
              excludeSemantics: true,
              child: Material(
                color: T.primary,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: sending ? null : onSend,
                  child: SizedBox.square(
                    dimension: T.hControl,
                    child: Center(
                      child:
                          sending
                              ? const SizedBox.square(
                                dimension: T.s5,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: T.surfaceRaised,
                                ),
                              )
                              : const Icon(
                                Icons.send_rounded,
                                color: T.surfaceRaised,
                              ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
