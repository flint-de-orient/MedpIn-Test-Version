import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/markdown_text.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../domain/chat_review.dart';
import 'inbox_states.dart';

/// One conversation in a clinic inbox — chat review and the nutrition inbox
/// draw the same row, so a doctor learns one shape.
///
/// Reads top to bottom as: who, when; what was last said and by whom; and the
/// words that decide whether to open it — its urgency, how much is unread,
/// whether it is flagged.
///
/// ---- Words, not only colour ------------------------------------------------
///
/// The nutrition inbox marked an urgent thread with a red rail down the card's
/// edge and nothing else, and the review list shouted EMERGENCY in capitals in
/// a pill. Urgency here is a word in sentence case, tinted, and unread is a
/// count with the word "unread" — a reader who cannot separate the tints loses
/// nothing.
///
/// ---- Who spoke last ----------------------------------------------------------
///
/// Every reply that was not the patient's was labelled "You:", so the
/// assistant's answers read as the doctor's own words. The assistant is
/// "Assistant", a reply from anyone at the clinic is "Clinic", and the
/// dietician is "Dietician".
class ConversationRow extends StatelessWidget {
  const ConversationRow({
    super.key,
    required this.session,
    required this.onTap,
    this.showFlag = true,
    this.trailing,
  });

  final ChatReviewSession session;
  final VoidCallback onTap;

  /// Whether to say "Flagged". Off on a list that holds nothing else.
  final bool showFlag;

  /// An action at the end of the tags line: "Clear flag".
  final Widget? trailing;

  static String speaker(String role) => switch (role) {
    'assistant' => 'Assistant: ',
    'clinician' => 'Clinic: ',
    'dietician' => 'Dietician: ',
    _ => '',
  };

  static IconData mediaIcon(String type) => switch (type) {
    'voice' => Icons.mic_none_rounded,
    'photo' => Icons.photo_camera_outlined,
    'pdf' => Icons.picture_as_pdf_outlined,
    'document' => Icons.description_outlined,
    _ => Icons.attach_file_rounded,
  };

  /// `10:42 AM` today, `Yesterday`, a weekday within the week, else `12 Oct`.
  static String stamp(BuildContext context, DateTime at, DateTime now) {
    final day = DateTime(at.year, at.month, at.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return clockTime(context, at);
    if (diff == 1) return 'Yesterday';
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (diff < 7) return weekdays[at.weekday - 1];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${at.day} ${months[at.month - 1]}';
  }

  /// The urgency as a word, or null for routine — which is almost every
  /// conversation and would be noise on every row.
  static (String, Status)? urgencyWord(String urgency) => switch (urgency) {
    'emergency' => ('Emergency', Status.alert),
    'urgent' => ('Urgent', Status.alert),
    'advice' => ('Advice given', Status.neutral),
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final s = session;
    final name = s.patientName ?? 'Patient';
    final msg = s.lastMessage;
    final at = msg?.at ?? s.lastMessageAt;
    final unread = s.unreadCount > 0;
    final urgency = urgencyWord(s.highestUrgency);

    final previewStyle = T.small.copyWith(
      color: unread ? T.ink : T.inkMuted,
      fontWeight: unread ? FontWeight.w600 : null,
    );

    final tags = <Widget>[
      if (urgency != null)
        TonePill(
          label: urgency.$1,
          status: urgency.$2,
          icon: urgency.$2 == Status.alert ? Icons.priority_high_rounded : null,
        ),
      if (showFlag && s.flaggedForReview)
        TonePill(
          label: 'Flagged',
          status: Status.watch,
          icon: Icons.flag_outlined,
        ),
      if (!s.flaggedForReview && s.reviewedAt != null)
        TonePill(
          label: 'Reviewed',
          status: Status.ok,
          icon: Icons.check_rounded,
        ),
    ];

    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(T.s4, T.s3, T.s2, T.s3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                name: nameForInitial(name),
                avatarUrl: s.avatarUrl,
                accent: T.primary,
                size: T.s8 + T.s2,
              ),
              const SizedBox(width: T.s3),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: T.s2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _NameAndTime(
                        name: name,
                        time:
                            at == null
                                ? null
                                : stamp(context, at, DateTime.now()),
                        unread: unread,
                      ),
                      const SizedBox(height: T.s1),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text.rich(
                              TextSpan(
                                children: [
                                  if (msg == null)
                                    const TextSpan(text: 'No messages yet')
                                  else ...[
                                    TextSpan(text: speaker(msg.role)),
                                    if (msg.mediaType != null)
                                      WidgetSpan(
                                        alignment: PlaceholderAlignment.middle,
                                        child: Padding(
                                          padding: const EdgeInsets.only(
                                            right: T.s1,
                                          ),
                                          child: Icon(
                                            mediaIcon(msg.mediaType!),
                                            size: T.s4,
                                            color: previewStyle.color,
                                          ),
                                        ),
                                      ),
                                    TextSpan(
                                      text: MarkdownText.toPreview(msg.preview),
                                    ),
                                  ],
                                ],
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: previewStyle,
                            ),
                          ),
                          // Unread sits where inboxes put it, beside what was
                          // said: a count and the word, in the panel's blue —
                          // something to look at, not a warning.
                          if (unread) ...[
                            const SizedBox(width: T.s2),
                            TonePill.info(
                              label:
                                  '${s.unreadCount > 99 ? '99+' : s.unreadCount} unread',
                            ),
                          ],
                        ],
                      ),
                      if (tags.isNotEmpty || trailing != null) ...[
                        const SizedBox(height: T.s2),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Expanded(
                              child: Wrap(
                                spacing: T.s2,
                                runSpacing: T.s2,
                                children: tags,
                              ),
                            ),
                            if (trailing != null) trailing!,
                          ],
                        ),
                      ],
                    ],
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

/// The name, and when the last message came, side by side while the name's
/// longest word fits beside the time — and the time under the name when it
/// does not, rather than a name broken in the middle of a word.
class _NameAndTime extends StatelessWidget {
  const _NameAndTime({
    required this.name,
    required this.time,
    required this.unread,
  });

  final String name;
  final String? time;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final nameStyle = T.bodyStrong.copyWith(color: T.ink);
    final nameText = Text(name, style: nameStyle);
    final when = time;
    if (when == null) return nameText;

    final timeStyle = T.small.copyWith(
      color: unread ? T.primary : T.inkMuted,
      fontWeight: unread ? FontWeight.w600 : null,
    );
    final timeText = Text(when, style: timeStyle);

    return LayoutBuilder(
      builder: (context, constraints) {
        final room =
            constraints.maxWidth -
            textWidths(context, when, timeStyle).line -
            T.s2;
        if (textWidths(context, name, nameStyle).word > room) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [nameText, timeText],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            // Wraps rather than ellipsising: a name is how two conversations
            // are told apart.
            Expanded(child: nameText),
            const SizedBox(width: T.s2),
            timeText,
          ],
        );
      },
    );
  }
}
