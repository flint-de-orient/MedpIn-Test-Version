import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../l10n/gen/app_localizations.dart';

/// "AI-assisted guidance, not a diagnosis", once, always on screen.
///
/// This line used to sit under every assistant reply as a full italic
/// sentence. That put it in the right place — attached to the claim it
/// qualifies, so it survives a screenshot — but repeated down a long thread it
/// became the loudest recurring text in the conversation, and a notice you
/// scroll past twenty times is a notice you stop reading.
///
/// Split in two rather than moved: the sentence lives here, pinned above the
/// thread where it cannot scroll away, and each assistant bubble keeps a small
/// "AI" chip that long-presses to the same words. Neither half alone is
/// enough — a banner on its own detaches the caveat from the claim, and the
/// chip on its own is too terse to be the only statement of it.
///
/// Deliberately not dismissible.
///
/// In a conversation no assistant answers — a specialty whose assistant no
/// clinician has approved — the same place says so instead. "AI-assisted
/// guidance" above a thread the assistant never replies in told a patient to
/// wait for an answer that was not coming.
class AssistantDisclaimerBanner extends StatelessWidget {
  const AssistantDisclaimerBanner({super.key, this.clinicRepliesOnly = false});

  final bool clinicRepliesOnly;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Semantics(
      liveRegion: false,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: T.s4,
          vertical: T.s2 + 2,
        ),
        decoration: BoxDecoration(
          color: dark ? const Color(0xFF16202E) : T.primaryTint,
          border: Border(
            bottom: BorderSide(color: dark ? const Color(0x14FFFFFF) : T.line),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.info_outline_rounded,
              size: 15,
              color: dark ? const Color(0xFF7FB0FF) : T.primary,
            ),
            const SizedBox(width: T.s2),
            Flexible(
              child: Text(
                clinicRepliesOnly ? l10n.chatClinicRepliesOnly : l10n.chatDisclaimer,
                textAlign: TextAlign.center,
                // Two lines, because Bengali and Hindi both run appreciably
                // longer than the English and were being clipped at one.
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: T.label.copyWith(
                  fontSize: 12,
                  height: 1.35,
                  letterSpacing: 0,
                  fontWeight: FontWeight.w600,
                  color: dark ? const Color(0xFF9DC0FF) : T.primary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
