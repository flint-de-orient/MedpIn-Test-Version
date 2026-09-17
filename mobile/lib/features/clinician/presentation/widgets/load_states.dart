/// What a clinical screen says when it cannot show what it was asked for.
///
/// ---- Three different facts ----------------------------------------------------
///
/// A dropped connection, a refusal and a server fault were one grey "Could not
/// load patient" with a Retry under it. They are not the same fact and do not
/// have the same next step. A doctor told "no access" for a patient who has
/// withdrawn consent needs to hear that, not to press Retry until it works; a
/// doctor on a bad connection needs to hear that nothing is lost.
///
/// ---- A refresh that fails keeps what is on screen -------------------------------
///
/// The record refreshes itself every few seconds. Riverpod's `when` draws its
/// error branch the moment a refresh fails, even with a perfectly good record
/// already loaded — so one dropped packet in a consulting room replaced the
/// patient's medicines with an error. A failure to *reach* the server now keeps
/// the last record on screen and says how old it is.
///
/// A refusal is different, and replaces it: when the server answers that this
/// practice may no longer see the patient, continuing to show what it saw
/// before is the one thing the refusal exists to stop.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../shared/widgets/surfaces.dart';

/// Why something could not be shown, worded for the person holding the phone.
class Failure {
  const Failure._({
    required this.title,
    required this.body,
    required this.icon,
    required this.canRetry,
    required this.keepsData,
  });

  final String title;
  final String body;
  final IconData icon;

  /// Whether pressing Retry could change the answer.
  final bool canRetry;

  /// Whether data already on screen stays there. True for a failure to reach
  /// the server; false for an answer from it.
  final bool keepsData;

  /// [what] names the thing that is missing — "this patient's record", "the
  /// patient list" — so the reader knows which part of the screen to distrust.
  factory Failure.of(Object error, {required String what}) {
    // Anything that is not an ApiException never reached the server's answer —
    // a response that would not parse, say — and is reported as a fault, not
    // as a connection it cannot know anything about.
    final code = error is ApiException ? error.code : 'UNKNOWN';
    final said = error is ApiException ? error.message.trim() : '';
    final status = error is ApiException ? error.statusCode : null;

    switch (code) {
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        return Failure._(
          title: 'No connection',
          body:
              'The phone could not reach the server, so $what could not be '
              'loaded. Nothing is lost.',
          icon: Icons.wifi_off_rounded,
          canRetry: true,
          keepsData: true,
        );
      case 'RATE_LIMITED':
        return const Failure._(
          title: 'Too many requests',
          body:
              'The server asked the app to slow down. Wait a moment, then try again.',
          icon: Icons.hourglass_empty_rounded,
          canRetry: true,
          keepsData: true,
        );
      case 'PRACTICE_REQUIRED':
        // The server's own sentence tells them to choose a practice, and
        // this app has nowhere to choose one yet. Saying so is better than
        // an instruction nobody can follow.
        return const Failure._(
          title: 'Which practice is this for?',
          body:
              'Your account works at more than one practice, and this screen '
              'could not tell which one to open it in. Ask whoever runs your '
              'practice to check your account. The record itself is not '
              'affected.',
          icon: Icons.apartment_rounded,
          canRetry: false,
          keepsData: false,
        );
      case 'NO_PRACTICE':
        return Failure._(
          title: 'Not part of a practice',
          body:
              said.isNotEmpty
                  ? said
                  : 'This account is not part of a practice any more.',
          icon: Icons.person_off_outlined,
          canRetry: false,
          keepsData: false,
        );
      case 'FORBIDDEN':
        return Failure._(
          title: _refusalTitle(said),
          // The server's sentence names the reason — not enrolled here, not
          // connected to any practice yet, consent not given, access
          // withdrawn — and each asks for something different.
          body:
              said.isNotEmpty
                  ? _sentence(said)
                  : 'Your account does not have access to $what. Whoever runs '
                      'the practice can change that.',
          icon: Icons.lock_outline_rounded,
          canRetry: false,
          keepsData: false,
        );
      case 'NOT_FOUND':
        return Failure._(
          title: 'Not available',
          body:
              '${_capitalise(what)} is not on this practice’s records, or it '
              'has been removed.',
          icon: Icons.search_off_rounded,
          canRetry: false,
          keepsData: false,
        );
      case 'UNAUTHORIZED':
        return Failure._(
          title: 'Signed out',
          body: 'Sign in again to see $what.',
          icon: Icons.person_off_outlined,
          canRetry: false,
          keepsData: false,
        );
      default:
        return Failure._(
          title: 'Could not load $what',
          body:
              status != null && status >= 500
                  ? 'The server ran into a problem. Nothing is lost — try again '
                      'in a moment.'
                  : 'Something went wrong while loading. Nothing is lost — try '
                      'again.',
          icon: Icons.error_outline_rounded,
          canRetry: true,
          keepsData: true,
        );
    }
  }

  static String _refusalTitle(String said) {
    final s = said.toLowerCase();
    if (s.contains('not connected')) return 'Not connected to a practice';
    if (s.contains('consent')) return 'Waiting for the patient’s consent';
    if (s.contains('withdrawn')) return 'Access withdrawn';
    if (s.contains('not enrolled')) return 'Not a patient of this practice';
    if (s.contains('predates')) return 'Before this practice’s access';
    return 'No access';
  }

  static String _sentence(String s) =>
      s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : '$s.';

  static String _capitalise(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// Nothing to show, and why — in place of a screen or a section.
class FailurePanel extends StatelessWidget {
  const FailurePanel({
    super.key,
    required this.error,
    required this.what,
    required this.onRetry,
  });

  final Object error;
  final String what;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final f = Failure.of(error, what: what);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(T.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(f.icon, size: T.s12, color: T.inkMuted),
            const SizedBox(height: T.s4),
            Text(
              f.title,
              textAlign: TextAlign.center,
              style: T.title.copyWith(color: T.ink),
            ),
            const SizedBox(height: T.s2),
            Text(
              f.body,
              textAlign: TextAlign.center,
              style: T.body.copyWith(color: T.inkMuted),
            ),
            if (f.canRetry) ...[
              const SizedBox(height: T.s6),
              OutlinedButton.icon(
                onPressed: onRetry,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(T.s12 * 3, T.tap),
                ),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The same, small enough to sit inside a section of a screen that otherwise
/// loaded.
class FailureNotice extends StatelessWidget {
  const FailureNotice({
    super.key,
    required this.error,
    required this.what,
    required this.onRetry,
  });

  final Object error;
  final String what;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final f = Failure.of(error, what: what);
    return InnerTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(f.icon, size: T.s6, color: T.inkMuted),
          const SizedBox(width: T.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  f.canRetry && f.keepsData ? 'Could not load $what' : f.title,
                  style: T.bodyStrong.copyWith(color: T.ink),
                ),
                Text(f.body, style: T.small.copyWith(color: T.inkMuted)),
              ],
            ),
          ),
          if (f.canRetry) ...[
            const SizedBox(width: T.s2),
            TextButton(
              onPressed: onRetry,
              style: TextButton.styleFrom(
                minimumSize: const Size(T.tap, T.tap),
              ),
              child: const Text('Retry'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Shown above data that could not be refreshed: how old it is, and a way to
/// try again. Never shown for a refusal — see [Failure.keepsData].
class StaleNotice extends StatelessWidget {
  const StaleNotice({
    super.key,
    required this.error,
    required this.what,
    required this.onRetry,
    this.loadedAt,
  });

  final Object error;

  /// What is on screen — "this record", "the list".
  final String what;
  final VoidCallback onRetry;

  /// When what is on screen last loaded, if known.
  final DateTime? loadedAt;

  @override
  Widget build(BuildContext context) {
    final f = Failure.of(error, what: what);
    final age =
        loadedAt == null
            ? 'It may be out of date.'
            : 'Showing what loaded at ${DateFormat('h:mm a').format(loadedAt!)}.';
    return Semantics(
      liveRegion: true,
      child: InnerTile(
        tone: T.warningTint,
        child: Row(
          children: [
            Icon(f.icon, size: T.s6, color: T.warning),
            const SizedBox(width: T.s3),
            Expanded(
              child: Text(
                'Could not refresh $what — ${f.title.toLowerCase()}. $age',
                style: T.small.copyWith(color: T.ink),
              ),
            ),
            if (f.canRetry) ...[
              const SizedBox(width: T.s2),
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(
                  minimumSize: const Size(T.tap, T.tap),
                ),
                child: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
