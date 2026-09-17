import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/markdown_text.dart';
import '../../../../shared/widgets/surfaces.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../chat/domain/chat_message.dart';
import '../../../shell/presentation/widgets/patient_kit.dart';

/// The latest message from a person at the clinic.
///
/// A reply from the doctor used to exist only inside the Doctor tab and in a
/// push notification that is easily swiped away. The patient opening the app to
/// see "did the doctor answer?" had to know which tab to look in.
///
/// Home decides whether there is one worth showing (see
/// `latestClinicMessageProvider`); this only draws it.
class ClinicMessageCard extends StatelessWidget {
  const ClinicMessageCard({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final name = message.senderName;
    final role =
        message.senderRole == 'staff' ? l10n.ptRoleClinicTeam : l10n.ptRoleDoctor;
    final text =
        message.content.trim().isEmpty
            ? l10n.ptVoiceMessage
            : MarkdownText.toPlainText(message.content);

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            icon: Icons.forum_outlined,
            title: l10n.ptFromYourClinic,
          ),
          const SizedBox(height: T.s4),
          InnerTile(
            onTap: () => context.go('/chat'),
            padding: const EdgeInsets.all(T.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    UserAvatar(
                      name: withoutHonorific(name ?? role),
                      avatarUrl: message.senderAvatarUrl,
                      accent: T.primary,
                      size: T.s8 + T.s1,
                    ),
                    const SizedBox(width: T.s3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name == null ? role : '$name · $role',
                            style: T.bodyStrong.copyWith(color: T.ink),
                          ),
                          Text(
                            dayAndClock(context, message.createdAt!.toLocal()),
                            style: T.small.copyWith(color: T.inkMuted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: T.s3),
                // A preview, one tap from the whole message: three lines is
                // enough to know what it is about.
                Text(
                  text,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: T.body.copyWith(color: T.ink),
                ),
              ],
            ),
          ),
          const SizedBox(height: T.s2),
          ActionLink(label: l10n.ptOpenChat, onTap: () => context.go('/chat')),
        ],
      ),
    );
  }
}
