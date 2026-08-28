import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/data/upload_repository.dart';
import 'voice_recorder_bar.dart';
import '../../../appointments/presentation/request_appointment_sheet.dart';

/// The message composer used on both sides of the nutrition thread.
///
/// One widget rather than two so the patient and the dietician get the same
/// abilities. A conversation where only one side can send a photo is one where
/// the other side keeps asking for something that cannot be sent — and the
/// answer to "what did you eat" is almost always a picture.
///
/// Attach offers camera, gallery and documents: a lab PDF or a diet sheet is a
/// normal thing to pass either way.
class CareComposer extends ConsumerStatefulWidget {
  const CareComposer({
    super.key,
    required this.controller,
    required this.hint,
    required this.sending,
    required this.onSend,
    required this.onSendAttachment,
    this.onVoiceRecorded,
  });

  final TextEditingController controller;
  final String hint;
  final bool sending;
  final VoidCallback onSend;

  /// Called with the uploaded asset id once an attachment is ready to post.
  final Future<void> Function(String assetId) onSendAttachment;

  /// Fired the instant a voice recording finishes — with the LOCAL file path,
  /// before the upload begins — so a screen can show an optimistic, playable
  /// voice bubble immediately instead of waiting for upload + post + refetch.
  /// Null on surfaces that don't need optimistic voice.
  final void Function(String path)? onVoiceRecorded;

  @override
  ConsumerState<CareComposer> createState() => _CareComposerState();
}

class _CareComposerState extends ConsumerState<CareComposer> {
  final _picker = ImagePicker();
  bool _recording = false;
  bool _uploading = false;

  Future<void> _attach() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder:
          (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: const Text('Take a photo'),
                  onTap: () => Navigator.pop(ctx, 'camera'),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Choose from gallery'),
                  onTap: () => Navigator.pop(ctx, 'gallery'),
                ),
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined),
                  title: const Text('Document'),
                  subtitle: const Text('PDF, Word, Excel, text…'),
                  onTap: () => Navigator.pop(ctx, 'document'),
                ),
                const Divider(height: 1),
                // Not an attachment, but it belongs on the same menu: this is
                // where a patient already comes to say something to the clinic,
                // and "can I see the doctor" is the commonest thing they want
                // to say. Making them find a separate screen for it is how a
                // request becomes a phone call instead.
                ListTile(
                  leading: const Icon(Icons.event_available_outlined),
                  title: const Text('Ask for an appointment'),
                  subtitle: const Text('The clinic confirms a time'),
                  onTap: () => Navigator.pop(ctx, 'appointment'),
                ),
              ],
            ),
          ),
    );
    if (choice == null) return;

    if (choice == 'appointment') {
      final messenger = ScaffoldMessenger.of(context);
      final sent = await showRequestAppointmentSheet(context);
      if (sent) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'Request sent. The clinic will confirm a time and let you know.',
            ),
          ),
        );
      }
      return;
    }

    String path;
    String filename;

    if (choice == 'document') {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const [
          'pdf',
          'doc',
          'docx',
          'xls',
          'xlsx',
          'txt',
          'csv',
        ],
        withData: false,
      );
      final file = result?.files.singleOrNull;
      if (file?.path == null) return;
      path = file!.path!;
      filename = file.name;
    } else {
      final x = await _picker.pickImage(
        source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 85,
      );
      if (x == null) return;
      path = x.path;
      filename = x.name;
    }

    await _upload(path, filename);
  }

  Future<void> _upload(
    String path,
    String filename, {
    String kind = UploadKind.other,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _uploading = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(path: path, filename: filename, kind: kind);
      await widget.onSendAttachment(asset.id);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final busy = widget.sending || _uploading;

    if (_recording) {
      return SafeArea(
        top: false,
        child: VoiceRecorderBar(
          onCancel: () => setState(() => _recording = false),
          onSend: (path, _) {
            setState(() => _recording = false);
            // Show it immediately as a playable bubble (from the local file),
            // before the upload — so the patient sees their message land at once.
            widget.onVoiceRecorded?.call(path);
            // The server transcribes on upload, and the transcript is what the
            // triage rules read — so a spoken worry escalates exactly as a
            // typed one does. Tagged voice_note so it is stored as audio and
            // never mistaken for a food photo (which asked "which meal?").
            _upload(path, 'voice-note.m4a', kind: UploadKind.voiceNote);
          },
        ),
      );
    }

    return SafeArea(
      top: false,
      child: Container(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.sm,
          8,
          AppSpacing.sm,
          MediaQuery.viewInsetsOf(context).bottom > 0 ? 8 : 8,
        ),
        // Transparent, like the care thread's composer: the pill itself is
        // filled, so the input stays legible while the conversation keeps
        // running underneath it. An opaque bar with a hard top rule cut the
        // thread off at the ankles and made the screen feel shorter than it is.
        decoration: const BoxDecoration(color: Colors.transparent),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: widget.controller,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText: widget.hint,
                  isDense: true,
                  filled: true,
                  fillColor: scheme.surfaceContainerHigh.withValues(
                    alpha: 0.55,
                  ),
                  border: const OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(20)),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: const OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(20)),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: const OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(20)),
                    borderSide: BorderSide.none,
                  ),
                  // The clip lives inside the pill, as it does on the care
                  // thread. Outside it, the attach button sat on the wallpaper
                  // with nothing behind it and read as a stray icon rather than
                  // part of the composer.
                  prefixIcon: IconButton(
                    tooltip: 'Attach',
                    onPressed: busy ? null : _attach,
                    icon: Icon(
                      Icons.attach_file_rounded,
                      size: 22,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 12,
                  ),
                  suffixIcon: IconButton(
                    tooltip: 'Record a voice message',
                    onPressed:
                        busy ? null : () => setState(() => _recording = true),
                    icon: Icon(
                      Icons.mic_none_rounded,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 4),
            Material(
              color: AppColors.accentOn(context),
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: busy ? null : widget.onSend,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child:
                      busy
                          ? const SizedBox(
                            width: 20,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: Colors.white,
                            ),
                          )
                          : const Icon(
                            Icons.send_rounded,
                            size: 22,
                            color: Colors.white,
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
