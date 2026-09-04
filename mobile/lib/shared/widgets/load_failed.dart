import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// A section that could not load, said plainly, with a way to try again.
///
/// ---- Why this exists ------------------------------------------------------
///
/// The app answered a failed load in three ways, and all three were wrong in
/// the same direction. Sixty-nine call sites read async state through
/// `valueOrNull`, which turns an error into `null` — and the widget below then
/// draws its *empty* state. The doctor's dashboard was blunter still: its
/// overview rendered an error as `SizedBox.shrink()`, so the top of the screen
/// silently disappeared.
///
/// The result is the same each time. A doctor whose alert list fails to load is
/// told there are no alerts. A patient whose readings fail is told they have no
/// readings. Nobody is told anything went wrong, so nobody retries, and a
/// clinical screen quietly reports the opposite of the truth.
///
/// An empty state and a failed state are different facts and must never look
/// alike. This is the failed one.
class LoadFailed extends StatelessWidget {
  const LoadFailed({
    super.key,
    required this.onRetry,
    this.what,
    this.compact = false,
  });

  /// What could not be loaded, in the user's words — "the alerts", "today's
  /// appointments". Names the thing that is missing so the reader knows which
  /// part of the screen to distrust, rather than distrusting all of it.
  final String? what;

  final VoidCallback onRetry;

  /// Inline inside a section rather than filling a screen.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final subject = what ?? 'this section';

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(compact ? T.s3 : T.s4),
      decoration: BoxDecoration(
        // A wash rather than a red banner. This is a network hiccup, not a
        // clinical emergency, and the app has real red for the latter.
        color: T.surface,
        borderRadius: BorderRadius.circular(T.rCard),
        border: Border.all(color: T.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: T.s1),
            child: Icon(Icons.cloud_off_rounded, size: 18, color: T.inkMuted),
          ),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Could not load $subject',
                  style: T.body.copyWith(color: T.ink),
                ),
                const SizedBox(height: T.s1),
                Text(
                  // Says what is and is not true. A doctor seeing a gap in a
                  // clinical screen needs to know the data still exists.
                  'Nothing is lost — the app could not reach the server.',
                  style: T.small.copyWith(color: T.inkMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: T.s2),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
