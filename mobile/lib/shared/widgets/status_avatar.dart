import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import 'character_avatar.dart';
import 'mood_avatar.dart';
import 'user_avatar.dart';

/// A real photograph, ringed by what the data says.
///
/// The reference apps this was measured against all lead with photography of
/// actual people, and none of them uses an illustrated mascot. That is the
/// whole reason this exists: the drawn face was answering a question — "show a
/// character" — that the professional answer solves with a photo.
///
/// The state has not been dropped, only moved. What the expression was saying,
/// the ring now says: green when everything is in range, amber when something
/// is drifting, red when an alert is open. It reads at a glance, it does not
/// risk looking like the app is judging anybody, and it costs no asset at all
/// because the photograph is already in the account.
///
/// Most people never upload a photo, so the fallback is the part that matters
/// in practice. It goes: the real photograph when the account has one, then the
/// generated character for that role and gender, then the drawn face. Initials
/// are deliberately skipped — two grey letters is what the reference apps look
/// better than, and a figure with a face reads as a person where "SJ" does not.
class StatusAvatar extends StatelessWidget {
  const StatusAvatar({
    super.key,
    required this.name,
    required this.mood,
    required this.role,
    this.avatarUrl,
    this.gender,
    this.size = 64,
  });

  final String name;
  final String? avatarUrl;
  final Mood mood;

  /// Decides which generated figure stands in when there is no photograph.
  final CareRole role;
  final String? gender;

  final double size;

  Color get _tone => switch (mood) {
    Mood.calm => AppColors.success,
    Mood.watchful => AppColors.warning,
    Mood.concerned => AppColors.danger,
  };

  @override
  Widget build(BuildContext context) {
    // No ring when everything is in range. A ring that is always there is
    // decoration; one that appears only when something wants looking at is
    // information — and on a blue screen a permanent amber circle round
    // someone's face is the loudest thing on it for no reason.
    final quiet = mood == Mood.calm;
    final ring = quiet ? 0.0 : size * 0.038;
    final inner = size - ring * 4;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          // The ring is drawn as a padded, bordered circle rather than a
          // painted arc: it has to sit outside the photo without cropping it,
          // and a border does that for free at any size.
          AnimatedContainer(
            duration:
                MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero
                    : const Duration(milliseconds: 400),
            width: size,
            height: size,
            padding: EdgeInsets.all(ring),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: quiet ? null : Border.all(color: _tone, width: ring),
              color: Colors.white,
            ),
            // One avatar, photo or not.
            //
            // With no photo this drew a generated character, which made the
            // patient's own home the only screen in the app where an account
            // without a picture did not show its owner's initial — the doctor
            // and dietician panels have always used UserAvatar. An illustrated
            // stand-in also says nothing about *which* patient, which is
            // precisely what an avatar is for. UserAvatar already falls back to
            // the first letter on a tinted disc, so it handles both cases.
            child: ClipOval(
              child: UserAvatar(
                name: name,
                avatarUrl: avatarUrl,
                accent: AppColors.accentOn(context),
                size: inner,
              ),
            ),
          ),
          // A small solid dot at the corner, and only when the ring is there.
          // Colour alone is not readable for everyone, so the state gets a
          // second, positional cue — but neither appears when there is no
          // state to report.
          if (!quiet)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: size * 0.22,
                height: size * 0.22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _tone,
                  border: Border.all(color: Colors.white, width: size * 0.03),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
