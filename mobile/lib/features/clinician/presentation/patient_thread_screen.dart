import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../chat/domain/chat_message.dart';
import '../../chat/data/chat_repository.dart';

import '../../chat/presentation/widgets/chat_message_bubble.dart';
import '../../../shared/widgets/chat_background.dart';
import '../../chat/presentation/widgets/voice_recorder_bar.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../data/clinician_repository.dart';
import '../../chat/presentation/widgets/edit_message_sheet.dart';
import '../../chat/presentation/widgets/assistant_control.dart';

/// What the doctor's attach button offers.
enum _DoctorAttach { camera, gallery, document }

/// The clinician's view of a patient's conversation.
///
/// Renders with [ChatMessageBubble] — the same widget the patient's Care Team
/// screen uses — so the doctor is looking at exactly what the patient is
/// looking at, down to the emergency cards and citations. A separate clinician
/// chat UI was what let the two drift into showing different conversations.
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
  Object? _error;

  /// Whether the newest message has scrolled out of view. Same affordance the
  /// patient has: on a long thread, reading back and then returning to the
  /// bottom otherwise means a lot of dragging.
  bool _showJumpToLatest = false;

  /// Keeps the conversation live while the clinician has it open, so a message
  /// the patient sends appears without reopening the screen. Same interval as
  /// the patient's side, for the same reason: no socket or push channel exists.
  static const _pollInterval = Duration(seconds: 3);
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
  Future<void> _pollForUpdates() async {
    if (!mounted || _sending || _loading) return;
    try {
      final result = await ref
          .read(clinicianRepositoryProvider)
          .patientThread(widget.patientId);
      if (!mounted || result.messages.length <= _messages.length) return;
      setState(() => _messages = result.messages);
      _scrollToBottom();
    } on ApiException {
      // Ignored — the next tick retries.
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
      });
      _scrollToBottom();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e;
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
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            UserAvatar(
              name: _patientName ?? '?',
              avatarUrl: _patientAvatarUrl,
              accent: AppColors.accentOn(context),
              size: 36,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _patientName ?? 'Conversation',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.accentOn(context),
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                ),
              ),
            ),
          ],
        ),
        actions: [
          // In the thread's own header, not a settings screen: the decision is
          // about this conversation and is normally made on opening it.
          AssistantToggle(patientId: widget.patientId, kind: ThreadKind.care),
          // The patient's full record — clinical summary, prescribe, dietician,
          // test reports — opens from here; the chat is where the doctor is.
          IconButton(
            tooltip: 'Patient record & prescribe',
            icon: Icon(
              Icons.assignment_ind_outlined,
              color: AppColors.accentOn(context),
            ),
            onPressed:
                () => context.push(
                  '/clinician/patients/${widget.patientId}',
                  extra: _patientName,
                ),
          ),
          // Calling belongs here rather than on the inbox row: the decision to
          // stop typing and phone someone is made while reading the exchange,
          // not while scanning the list.
          IconButton(
            tooltip: 'Call ${_patientName ?? 'patient'}',
            icon: Icon(Icons.call_rounded, color: AppColors.accentOn(context)),
            onPressed: _patientPhone == null ? null : _call,
          ),
        ],
      ),
      // Matches the patient's screen: a fixed background that never repaints as
      // the keyboard animates.
      resizeToAvoidBottomInset: false,
      body: ChatBackground(
        child: _KeyboardInset(
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    _body(),
                    if (_showJumpToLatest)
                      Positioned(
                        right: AppSpacing.md,
                        bottom: AppSpacing.md,
                        child: Material(
                          color: AppColors.accentOn(context),
                          shape: const CircleBorder(),
                          elevation: 3,
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: _scrollToBottom,
                            child: const SizedBox(
                              width: 48,
                              height: 46,
                              child: Icon(
                                Icons.keyboard_arrow_down_rounded,
                                color: Colors.white,
                                size: 26,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              // The turn being quoted, shown above the composer until sent.
              if (_replyingTo != null)
                _ReplyPreviewBar(
                  message: _replyingTo!,
                  onCancel: () => setState(() => _replyingTo = null),
                ),
              // Recording replaces the composer, as on the patient's side.
              if (_recording)
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
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Could not load the conversation'),
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    if (_messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.forum_outlined,
                size: 48,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'No messages yet.\nAnything you send starts the conversation.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      // Bottom clearance for the floating jump-to-latest button.
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md + 48,
      ),
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

/// The quoted-turn strip shown above the composer while the doctor is replying
/// to a specific message. Cancelling clears the quote.
class _ReplyPreviewBar extends StatelessWidget {
  const _ReplyPreviewBar({required this.message, required this.onCancel});

  final ChatMessage message;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final who = message.isUser ? (message.senderName ?? 'Patient') : 'You';
    final preview =
        message.content.trim().isNotEmpty
            ? message.content.trim()
            : (message.voiceNotes.isNotEmpty ? 'Voice message' : 'Attachment');
    return Container(
      color: scheme.surfaceContainerHigh.withValues(alpha: 0.6),
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 8, AppSpacing.sm, 8),
      child: Row(
        children: [
          Container(width: 3, height: 34, color: AppColors.accentOn(context)),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Replying to $who',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.accentOn(context),
                  ),
                ),
                Text(
                  preview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel reply',
            icon: const Icon(Icons.close_rounded, size: 20),
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

  /// Attach a photo to send the patient — same affordance the patient has, for
  /// sending back a marked-up report, a diagram, or a photographed note.
  final VoidCallback onAttach;

  final TextEditingController controller;

  /// Held by the screen rather than the TextField's own internal one, so a
  /// rebuild from the three-second poll cannot drop focus while the doctor is
  /// mid-sentence.
  final FocusNode focusNode;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      // Transparent bar so the chat wallpaper shows behind the composer,
      // WhatsApp-style, instead of a solid strip hiding it. The input pill keeps
      // its own fill so typing stays readable.
      color: Colors.transparent,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.sm),
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
                    constraints: const BoxConstraints(minHeight: 52),
                    decoration: BoxDecoration(
                      // Filled, not outlined — matches the patient's composer.
                      color: scheme.surfaceContainerHigh.withValues(
                        alpha: 0.55,
                      ),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.only(left: 4, right: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          // Attach on the LEFT, matching the patient's composer.
                          IconButton(
                            tooltip: 'Attach a photo',
                            onPressed: sending ? null : onAttach,
                            icon: Icon(
                              Icons.attach_file_rounded,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          Expanded(
                            child: TextField(
                              controller: controller,
                              focusNode: focusNode,
                              minLines: 1,
                              maxLines: 5,
                              textCapitalization: TextCapitalization.sentences,
                              style: const TextStyle(fontSize: 16),
                              decoration: const InputDecoration(
                                hintText: 'Reply to this patient…',
                                hintMaxLines: 1,
                                border: InputBorder.none,
                                enabledBorder: InputBorder.none,
                                focusedBorder: InputBorder.none,
                                filled: false,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                  vertical: 16,
                                ),
                              ),
                              onSubmitted: (_) => onSend(),
                            ),
                          ),
                          // Speak instead of typing, same as the patient has.
                          IconButton(
                            tooltip: 'Record a voice reply',
                            onPressed: sending ? null : onRecord,
                            icon: Icon(
                              Icons.mic_none_rounded,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Material(
                color: AppColors.accentOn(context),
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: sending ? null : onSend,
                  child: SizedBox(
                    width: 52,
                    height: 52,
                    child: Center(
                      child:
                          sending
                              ? const SizedBox(
                                width: 20,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                              : const Icon(
                                Icons.send_rounded,
                                color: Colors.white,
                                size: 24,
                              ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
