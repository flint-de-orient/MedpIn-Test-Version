import 'package:flutter/material.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_spacing.dart';
import '../../l10n/gen/app_localizations.dart';

/// Full-screen (or in-place) error state with a retry action. Maps
/// [ApiException.code] to a localized, patient-friendly message.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, this.error, this.onRetry, this.title});

  final Object? error;
  final VoidCallback? onRetry;
  final String? title;

  static String messageFor(BuildContext context, Object? error) {
    final l10n = AppLocalizations.of(context);
    if (error is ApiException) {
      switch (error.code) {
        case 'BAD_REQUEST':
          return _withDetails(l10n.errorBadRequest, error);
        case 'VALIDATION_ERROR':
          return _withDetails(l10n.errorValidation, error);
        case 'UNAUTHORIZED':
          return l10n.errorUnauthorized;
        case 'FORBIDDEN':
          return l10n.errorForbidden;
        case 'NOT_FOUND':
          return l10n.errorNotFound;
        case 'CONFLICT':
          return l10n.errorConflict;
        case 'DUPLICATE':
          return l10n.errorDuplicate;
        case 'RATE_LIMITED':
          return l10n.errorRateLimited;
        case 'INVALID_ID':
          return l10n.errorInvalidId;
        case 'AI_UNAVAILABLE':
          return l10n.errorAiUnavailable;
        case 'NETWORK_ERROR':
        case 'TIMEOUT':
          return l10n.commonNoInternet;
        case 'INTERNAL_ERROR':
          return l10n.errorInternal;
        // A number waiting on a practice application: neither unknown nor one
        // to register. See applicationPending in backend/src/routes/auth.js.
        case 'APPLICATION_PENDING':
          return l10n.authApplicationPending;
        default:
          return l10n.commonUnknownError;
      }
    }
    return l10n.commonUnknownError;
  }

  /// A bare "check the details you entered" leaves the patient guessing which
  /// field the server rejected. The backend already names them in
  /// `error.details`, so append those rather than swallowing them.
  static String _withDetails(String base, ApiException error) {
    if (error.details.isEmpty) return base;
    final lines = error.details
        .map((d) => d.message)
        .where((m) => m.isNotEmpty)
        .toSet()
        .map((m) => '• $m');
    if (lines.isEmpty) return base;
    return '$base\n${lines.join('\n')}';
  }

  /// What kind of failure this is, which decides how it should look.
  ///
  /// ---- Why the shape has to change, not just the sentence ---------------
  ///
  /// Every one of these rendered identically: a red error triangle, the title
  /// "Something went wrong", and a Retry button. For a dropped connection that
  /// is exactly right. For a 403 it is wrong three times over — nothing went
  /// wrong, the triangle says the software broke, and Retry is a control that
  /// cannot possibly help, which is the dead-button rule in a different place.
  ///
  /// This matters more since the tenant scoping landed. Five routes that used
  /// to succeed across practices now refuse, and a clinician meeting a red
  /// triangle learns that the app is unreliable rather than that the record
  /// belongs to somebody else.
  static _Shape _shapeFor(BuildContext context, Object? error) {
    final l10n = AppLocalizations.of(context);
    final code = error is ApiException ? error.code : 'UNKNOWN';

    switch (code) {
      case 'FORBIDDEN':
        // An answer, not a failure. Whoever runs the practice can change it;
        // pressing a button here cannot.
        return _Shape(
          icon: Icons.lock_outline_rounded,
          title: l10n.errorAccessDeniedTitle,
          tone: _Tone.calm,
          canRetry: false,
        );

      case 'NOT_FOUND':
        /*
         * Also not a failure, and deliberately indistinguishable from a
         * resource that belongs to another practice — the server answers 404
         * for both so that asking for an id reveals nothing about whether it
         * exists. The app must not undo that by guessing which it was.
         */
        return _Shape(
          icon: Icons.search_off_rounded,
          title: l10n.errorNotFoundTitle,
          tone: _Tone.calm,
          canRetry: false,
        );

      case 'UNAUTHORIZED':
        // Retrying re-sends the same dead credential. The session is gone and
        // signing in again is the only thing that helps.
        return _Shape(
          icon: Icons.person_off_outlined,
          title: l10n.errorSignedOutTitle,
          tone: _Tone.calm,
          canRetry: false,
        );

      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        // The one case Retry was always right for.
        return _Shape(
          icon: Icons.wifi_off_rounded,
          title: l10n.errorOfflineTitle,
          tone: _Tone.calm,
          canRetry: true,
        );

      case 'RATE_LIMITED':
        // Retry, but not this second. Offered because waiting and trying again
        // is genuinely the fix.
        return _Shape(
          icon: Icons.hourglass_empty_rounded,
          title: l10n.errorRateLimitedTitle,
          tone: _Tone.calm,
          canRetry: true,
        );

      default:
        // Everything else — including a real 500 — keeps the original
        // treatment, because something genuinely did go wrong.
        return _Shape(
          icon: Icons.error_outline_rounded,
          title: l10n.commonSomethingWentWrong,
          tone: _Tone.error,
          canRetry: true,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final shape = _shapeFor(context, error);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              shape.icon,
              size: 48,
              // Colour is never the only carrier here — the icon and the title
              // both change with the kind — but a refusal drawn in the error
              // colour still reads as a fault.
              color: shape.tone == _Tone.error
                  ? scheme.error
                  : scheme.onSurfaceVariant,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              // An explicit `title` from the caller still wins: a screen that
              // knows what it was doing can say so better than this can.
              title ?? shape.title,
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              messageFor(context, error),
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            if (onRetry != null && shape.canRetry) ...[
              const SizedBox(height: AppSpacing.lg),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(l10n.commonRetry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

enum _Tone { calm, error }

/// How one kind of failure should be drawn.
class _Shape {
  const _Shape({
    required this.icon,
    required this.title,
    required this.tone,
    required this.canRetry,
  });

  final IconData icon;
  final String title;
  final _Tone tone;

  /// Whether pressing a button could change the outcome. False for a refusal:
  /// a Retry that cannot help is a control that teaches people the app is
  /// unreliable.
  final bool canRetry;
}
