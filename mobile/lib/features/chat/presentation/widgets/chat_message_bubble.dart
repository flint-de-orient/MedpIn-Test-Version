import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/markdown_text.dart';
import '../../domain/chat_message.dart';
import 'chat_attachment_thumbs.dart';
import 'chat_document_card.dart';
import '../../domain/citation.dart';
import 'citation_chips.dart';
import 'emergency_card.dart';
import 'urgent_card.dart';
import 'voice_note_player.dart';
import '../../../../shared/widgets/user_avatar.dart';
import 'appointment_request_card.dart';

/// Renders one turn. Assistant messages whose `urgency` is `emergency` or
/// `urgent` bypass the normal bubble entirely and render inside the
/// dedicated safety cards instead â€” this is intentional and must not be
/// "simplified" back into a plain bubble.
class ChatMessageBubble extends StatelessWidget {
  const ChatMessageBubble({
    super.key,
    required this.message,
    this.onFlag,
    this.onRetry,
    this.onReply,
    this.onTogglePin,
    this.onHide,
    this.onDeleteForEveryone,
    this.onEdit,
    this.repliedTo,
    this.onQuoteTap,
    this.onCitationTap,
    this.isClinicianView = false,
  });

  /// True in the clinician's thread. Only affects voice notes: the transcript
  /// shows there and is hidden on the patient's own recording, where it would
  /// repeat what they said a second earlier.
  final bool isClinicianView;

  final ChatMessage message;
  final VoidCallback? onFlag;

  /// Quote this message in the composer. Clinical chat runs over days, so a
  /// reply has to carry what it is answering.
  final VoidCallback? onReply;

  /// Pin or unpin. Null where pinning does not apply.
  final VoidCallback? onTogglePin;

  /// Hide from this reader's own view. Never a delete â€” see the server route.
  final VoidCallback? onHide;

  /// Delete for everyone â€” tombstones the message for all participants. Passed
  /// only for the reader's OWN, non-emergency messages; null everywhere else,
  /// which is also what keeps it off the assistant's turns and other people's.
  final VoidCallback? onDeleteForEveryone;

  /// Rewrite this message. Offered only on the reader's own, still-editable
  /// message — the caller decides, the same way it decides about deletion.
  final VoidCallback? onEdit;

  /// The message being answered, when this one is a reply.
  final ChatMessage? repliedTo;

  /// Jump to the quoted message when its preview is tapped (WhatsApp-style).
  final VoidCallback? onQuoteTap;

  /// Tapping a citation pill asks the assistant about that topic.
  final ValueChanged<Citation>? onCitationTap;

  /// Present only on an AI-unavailable fallback reply â€” lets the patient
  /// resend the question once the service is back.
  final VoidCallback? onRetry;

  /// A compact tappable icon in the assistant message footer (copy, flag).
  Widget _footerIcon(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Icon(
            icon,
            size: 16,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }

  /// Long-press sheet: copy, reply, pin, hide.
  ///
  /// Copy is offered on every message, including the patient's own and the
  /// doctor's. A dosing instruction is exactly what someone wants to save or
  /// send to a family member, and it was previously available only on the
  /// assistant's replies.
  Future<void> _showActions(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);

    await showModalBottomSheet<void>(
      context: context,
      builder:
          (sheet) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.copy_rounded),
                  title: Text(l10n.chatCopy),
                  onTap: () async {
                    Navigator.pop(sheet);
                    await Clipboard.setData(
                      ClipboardData(text: message.content),
                    );
                    messenger.showSnackBar(
                      SnackBar(content: Text(l10n.chatCopied)),
                    );
                  },
                ),
                if (onEdit != null && message.canStillEdit)
                  ListTile(
                    leading: const Icon(Icons.edit_outlined),
                    title: const Text('Edit'),
                    subtitle: const Text(
                      'Within 15 minutes. The other side sees it was edited.',
                      style: TextStyle(fontSize: 12),
                    ),
                    onTap: () {
                      Navigator.pop(sheet);
                      onEdit!();
                    },
                  ),
                if (onReply != null)
                  ListTile(
                    leading: const Icon(Icons.reply_rounded),
                    title: Text(l10n.chatReply),
                    onTap: () {
                      Navigator.pop(sheet);
                      onReply!();
                    },
                  ),
                if (onTogglePin != null)
                  ListTile(
                    leading: Icon(
                      message.pinned ? Icons.push_pin : Icons.push_pin_outlined,
                    ),
                    title: Text(message.pinned ? l10n.chatUnpin : l10n.chatPin),
                    onTap: () {
                      Navigator.pop(sheet);
                      onTogglePin!();
                    },
                  ),
                if (onHide != null)
                  ListTile(
                    leading: const Icon(Icons.visibility_off_outlined),
                    // Named "hide", not "delete", because that is what it does: the
                    // message stays in the medical record and only leaves this
                    // reader's view.
                    title: Text(l10n.chatHide),
                    subtitle: Text(
                      l10n.chatHideNote,
                      style: const TextStyle(fontSize: 12),
                    ),
                    onTap: () {
                      Navigator.pop(sheet);
                      onHide!();
                    },
                  ),
                // Delete for everyone — only ever offered on the reader's own,
                // non-emergency message (the caller decides), and confirmed once,
                // because unlike Hide the other person loses it too.
                if (onDeleteForEveryone != null)
                  ListTile(
                    leading: Icon(
                      Icons.delete_outline_rounded,
                      color: AppColors.danger,
                    ),
                    title: Text(
                      l10n.chatDeleteForEveryone,
                      style: TextStyle(color: AppColors.danger),
                    ),
                    onTap: () async {
                      Navigator.pop(sheet);
                      if (!context.mounted) return;
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder:
                            (dialog) => AlertDialog(
                              title: Text(l10n.chatDeleteForEveryone),
                              content: Text(l10n.chatDeleteForEveryoneConfirm),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, false),
                                  child: Text(l10n.commonCancel),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.pop(dialog, true),
                                  style: TextButton.styleFrom(
                                    foregroundColor: AppColors.danger,
                                  ),
                                  child: Text(l10n.chatDeleteForEveryone),
                                ),
                              ],
                            ),
                      );
                      if (confirmed == true) onDeleteForEveryone!();
                    },
                  ),
              ],
            ),
          ),
    );
  }

  /// `12:45 PM`, matching the timestamps in the design.
  String _timestamp(DateTime at) {
    final local = at.toLocal();
    final hour12 = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    return '$hour12:$minute ${local.hour < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    // Deleted for everyone: a muted tombstone in place of the turn. The server
    // has already withheld the words, files and quote; nothing here is
    // long-pressable, because there is nothing left to act on.
    if (message.deletedForEveryone) {
      final scheme = Theme.of(context).colorScheme;
      final mine = isClinicianView ? message.isClinician : message.isUser;
      return Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.only(bottom: AppSpacing.md),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.3),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.block_rounded,
                size: 15,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 8),
              Text(
                l10n.chatDeletedForEveryone,
                style: TextStyle(
                  fontSize: 14,
                  fontStyle: FontStyle.italic,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // Safety cards represent a triage verdict about the patient's own message.
    // A clinician's reply is a person talking, so it never renders as one even
    // if the turn inherited an urgency from the conversation.
    // A dietician turn is rendered exactly like a clinician's — a clinic person
    // speaking, never the AI — so fold the two together here.
    final isClinician = message.isClinician || message.isDietician;

    if (!message.isUser && !isClinician && message.isEmergency) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: EmergencyCard(content: message.content),
      );
    }
    if (!message.isUser && !isClinician && message.isUrgent) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: UrgentCard(content: message.content),
      );
    }

    final isUser = message.isUser;

    // Which side of the conversation the reader is on.
    //
    // "Mine" is not a property of the message â€” it depends on who is looking.
    // A patient's turn belongs on the right in their own app and on the left in
    // the clinic's. Keying alignment off `isUser` alone mirrored the entire
    // thread for the doctor: the patient's words appeared as though the doctor
    // had sent them, and the doctor's own replies looked received.
    final isMine = isClinicianView ? message.isClinician : isUser;
    final scheme = Theme.of(context).colorScheme;

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        child: Column(
          crossAxisAlignment:
              isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            // Photos the patient attached, shown above their text.
            if (message.attachmentPaths.isNotEmpty)
              ChatAttachmentThumbs(paths: message.attachmentPaths),
            // Documents (PDF, Office, text…) as tappable file cards.
            for (final doc in message.documents)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: ChatDocumentCard(doc: doc, onDark: false),
              ),
            // Every turn is attributed, not just the clinicians'. A patient
            // must never have to guess whether the words they are reading came
            // from their doctor, their dietician or from software — and the
            // assistant going unlabelled is exactly how software gets mistaken
            // for a person.
            _SenderRow(
              isMine: isMine,
              // The real role, not the merged clinician-or-dietician flag used
              // for bubble styling above. The row draws a face for the doctor
              // and not for the dietician, so it needs the two kept apart.
              isClinician: message.isClinician,
              isDietician: message.isDietician,
              isUser: isUser,
              name: message.senderName,
              senderRole: message.senderRole,
              avatarUrl: message.senderAvatarUrl,
              fallback: l10n.chatFromClinic,
            ),
            if (message.pinned)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.push_pin_rounded,
                      size: 13,
                      color: scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      l10n.chatPinned,
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            // The quoted turn this message answers, so a reply arriving hours
            // later still says what it is about. Prefer the locally-loaded
            // original; fall back to the server-sent preview so the quote shows
            // on every device even when the original is not loaded here.
            if (repliedTo != null || message.replyPreviewContent != null)
              GestureDetector(
                onTap: onQuoteTap,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                    border: Border(
                      left: BorderSide(
                        color: AppColors.accentOn(context),
                        width: 3,
                      ),
                    ),
                  ),
                  child: Text(
                    repliedTo?.content ?? message.replyPreviewContent!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            // Skip the text bubble entirely for a photo-only message. With no
            // words and no voice note there is nothing to put in it, and an
            // empty rounded box read as a bug ("why the empty section").
            if (message.voiceNotes.isNotEmpty ||
                message.content.trim().isNotEmpty)
              GestureDetector(
                onLongPress: () => _showActions(context),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color:
                        isMine
                            ? AppColors.bubbleMine(context)
                            : isClinician
                            // Tinted, not grey: the doctor's own words carry more
                            // weight than the assistant's and should look like it.
                            ? AppColors.bubbleClinician(context)
                            : scheme.surfaceContainerLow,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(20),
                      topRight: const Radius.circular(20),
                      bottomLeft: Radius.circular(isMine ? 20 : 6),
                      bottomRight: Radius.circular(isMine ? 6 : 20),
                    ),
                    // Barely-there outline. A heavy stroke round every bubble read
                    // as clutter over the wallpaper; the fill alone carries the
                    // shape now, with just a whisper of an edge.
                    border:
                        isMine
                            ? null
                            : Border.all(
                              color:
                                  isClinician
                                      ? AppColors.bubbleClinician(context)
                                      : scheme.outlineVariant.withValues(
                                        alpha: 0.20,
                                      ),
                            ),
                  ),
                  child:
                      message.voiceNotes.isNotEmpty
                          // A spoken message renders as a player, not as its own
                          // transcript repeated â€” the player already shows the words.
                          ? Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              for (final note in message.voiceNotes)
                                VoiceNotePlayer(note: note, onDark: isMine),
                            ],
                          )
                          : (isUser || isClinician)
                          // The patient's own text is never Markdown â€” render it plain.
                          ? Text(
                            message.content,
                            style: TextStyle(
                              fontSize: 16,
                              height: 1.5,
                              color: isMine ? Colors.white : scheme.onSurface,
                            ),
                          )
                          // Assistant replies carry **bold** and `- ` bullets; render
                          // them rather than showing the raw marks.
                          //
                          // Not selectable: long-press now opens the action sheet, and
                          // text selection would swallow that gesture on assistant
                          // replies only â€” the same press doing different things
                          // depending on who spoke. Copy is in the sheet instead.
                          : MarkdownText(
                            data: message.content,
                            selectable: false,
                            style: TextStyle(
                              fontSize: 16,
                              // 1.5 gives Bengali conjuncts and Devanagari matras room
                              // to breathe; 1.4 clips their upper marks at this size.
                              height: 1.5,
                              color: isMine ? Colors.white : scheme.onSurface,
                            ),
                          ),
                ),
              ),
            if (message.createdAt != null) ...[
              const SizedBox(height: 4),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _timestamp(message.createdAt!),
                      style: TextStyle(
                        fontSize: 14,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    // An edit is never silent. On a clinical thread the other
                    // side may already have read and answered the original,
                    // and they have to be able to see that the words moved
                    // under them.
                    if (message.isEdited) ...[
                      const SizedBox(width: 4),
                      Text(
                        'edited',
                        style: TextStyle(
                          fontSize: 13,
                          fontStyle: FontStyle.italic,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    // Only on the patient's own turns, and only once a person
                    // from the clinic has opened the thread. Says their message
                    // was read without implying a reply is seconds away.
                    if (isMine &&
                        !isClinicianView &&
                        message.seenByClinicAt != null) ...[
                      const SizedBox(width: 4),
                      Icon(
                        Icons.done_all_rounded,
                        size: 15,
                        color: AppColors.accentOn(context),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        l10n.chatSeenByClinic,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.accentOn(context),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            // Citations, retry and the "AI-assisted guidance" note all describe
            // the assistant. None of them apply to something a doctor wrote,
            // and the disclaimer would actively misrepresent it.
            if (!isUser && !isClinician) ...[
              // An offer the reader may act on, under the answer rather than
              // instead of it. The assistant still replies to what was asked;
              // this is the shortcut.
              if (message.action?.kind == 'appointment_request')
                AppointmentRequestCard(action: message.action!),
              if (message.citations != null && message.citations!.isNotEmpty)
                CitationChips(
                  citations: message.citations!,
                  onTap: onCitationTap,
                ),
              // A fallback reply is the scripted "service unavailable" text â€”
              // offer to resend the question rather than leaving a dead end.
              if (message.isFallback == true && onRetry != null) ...[
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: onRetry,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      side: BorderSide(color: scheme.outlineVariant),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 4,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: Text(l10n.chatRetry),
                  ),
                ),
              ],
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _footerIcon(
                    context,
                    icon: Icons.copy_rounded,
                    label: l10n.chatCopy,
                    onTap: () async {
                      await Clipboard.setData(
                        ClipboardData(
                          text: MarkdownText.toPlainText(message.content),
                        ),
                      );
                      if (context.mounted) {
                        ScaffoldMessenger.of(context)
                          ..hideCurrentSnackBar()
                          ..showSnackBar(
                            SnackBar(content: Text(l10n.chatCopied)),
                          );
                      }
                    },
                  ),
                  if (onFlag != null)
                    _footerIcon(
                      context,
                      icon: Icons.flag_outlined,
                      label: l10n.chatFlagMessage,
                      onTap: onFlag!,
                    ),
                  const SizedBox(width: 4),
                  // Still on every assistant reply, because the point of it is
                  // that it travels with the message — screenshotted, or read
                  // months later out of order, the claim and the caveat stay
                  // together. But a full italic sentence repeated under every
                  // bubble became the loudest recurring text in the thread, so
                  // it is a chip now, with the sentence itself promoted to a
                  // banner that is always on screen. Long-pressable for anyone
                  // who wants the words rather than the badge.
                  Tooltip(
                    message: l10n.chatDisclaimer,
                    triggerMode: TooltipTriggerMode.longPress,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: scheme.outlineVariant),
                      ),
                      child: Text(
                        'AI',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.4,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Who is speaking, above their bubble: a small role badge and a name.
///
/// Shown on every turn rather than only on clinicians'. An unlabelled bubble
/// in a thread that mixes an AI, a doctor and a dietician is a bubble the
/// reader has to guess at, and the wrong guess here is "I thought the doctor
/// told me that".
class _SenderRow extends StatelessWidget {
  const _SenderRow({
    required this.isMine,
    required this.isClinician,
    required this.isDietician,
    required this.isUser,
    required this.name,
    required this.senderRole,
    required this.avatarUrl,
    required this.fallback,
  });

  final bool isMine;
  final bool isClinician;
  final bool isDietician;
  final bool isUser;
  final String? name;

  /// Which kind of person wrote it — `doctor`, `staff` or `dietician`.
  final String? senderRole;
  final String? avatarUrl;
  final String fallback;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // Own turns get a plain "You" — a badge for yourself is noise, and the
    // right-hand side and fill colour already say whose it is.
    if (isMine) {
      return Padding(
        padding: const EdgeInsets.only(right: 4, bottom: 4),
        child: Text(
          'You',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: scheme.onSurfaceVariant,
          ),
        ),
      );
    }

    final (icon, label) = switch (true) {
      // The role, not just the name. "Dr." carries it for the doctor; a
      // dietician's name alone tells a patient nothing about who is advising
      // them or on what.
      _ when isDietician => (
        Icons.restaurant_rounded,
        name == null ? 'Your dietician' : '$name · Dietician',
      ),
      // A clinician turn is written by the doctor OR by the front desk, and
      // until now both rendered as a bare name. A patient cannot be expected to
      // know which of the clinic's people "Priya Sharma" is, and the difference
      // decides whether they read a message as an instruction about their
      // medicine or as an administrative note about a booking.
      _ when isClinician => (
        senderRole == 'staff'
            ? Icons.support_agent_rounded
            : Icons.medical_information_rounded,
        switch ((name, senderRole)) {
          (null, _) => fallback,
          (final n, 'staff') => '$n · Clinic staff',
          (final n, 'doctor') => '$n · Doctor',
          (final n, _) => n!,
        },
      ),
      // The patient's own words, read by a clinician.
      _ when isUser => (Icons.person_rounded, name ?? 'Patient'),
      // Named for the clinic it answers on behalf of, because that is what it
      // is: it replies only from Dr. Dey's own approved protocols. The
      // assistant mark stays, though — a patient who believes their doctor
      // personally wrote something does not question it and may not raise it at
      // the next visit, and that is the whole reason the mark exists.
      _ => (Icons.auto_awesome_rounded, 'Dr. Dey\'s Clinic · assistant'),
    };

    // The doctor gets their own face; the assistant gets the clinic's mark.
    // A role icon standing in for a doctor who has a photo on file is a worse
    // likeness than the photo, and the generic sparkle read as decoration.

    return Padding(
      padding: const EdgeInsets.only(left: 0, bottom: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // The doctor keeps a face — the care thread's header carries the
          // clinic, not a person, so the avatar is the only thing saying who
          // replied. The dietician does not: their photo and name are already
          // in this screen's header, so a second copy beside every message
          // only repeats it.
          if (isClinician && senderRole != 'staff')
            UserAvatar(
              name: name ?? '',
              avatarUrl: avatarUrl,
              accent: AppColors.accentOn(context),
              size: 24,
            )
          // The patient's own turns carry no avatar. This row is only ever
          // shown to a clinician, whose screen already has the patient's photo
          // and name in the app bar — a generic grey silhouette repeated down
          // the thread said nothing the header had not already said, and said
          // it worse.
          //
          // The dietician gets nothing either. Their photo and name are already
          // in this screen's header, and the app emblem standing in for them was
          // worse than no mark at all: it labelled a person's message with the
          // product's logo. The label alone says who is speaking.
          else if (isUser || isDietician)
            const SizedBox.shrink()
          else
            Container(
              width: 24,
              height: 24,
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.accentSoftOn(context),
                shape: BoxShape.circle,
              ),
              child: Image.asset(
                'assets/brand/medpin_emblem.png',
                errorBuilder:
                    (_, _, _) => Icon(
                      icon,
                      size: 14,
                      color: AppColors.accentOn(context),
                    ),
              ),
            ),
          if (!isUser && !isDietician) const SizedBox(width: 8),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color:
                    isClinician || isDietician
                        ? AppColors.primary
                        : scheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
