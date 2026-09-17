import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import '../providers/core_providers.dart';

/// The patient's profile photo when set, otherwise their initial on a tinted
/// disc. The photo is owner-protected, so it is fetched with the bearer token.
class UserAvatar extends ConsumerWidget {
  const UserAvatar({
    super.key,
    required this.name,
    required this.avatarUrl,
    required this.accent,
    this.size = 96,
  });

  final String name;

  /// Relative `/api/v1/uploads/:id/raw` path, or null for the initial.
  final String? avatarUrl;
  final Color accent;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initial = (name.isNotEmpty ? name[0] : '?').toUpperCase();
    final headers = ref.watch(imageAuthHeaderProvider).valueOrNull;

    Widget fallback() => Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.16),
        shape: BoxShape.circle,
        border: Border.all(color: accent.withValues(alpha: 0.35), width: 2),
      ),
      child: Center(
        child: Text(
          initial,
          style: TextStyle(fontSize: size * 0.4, fontWeight: FontWeight.w800, color: accent),
        ),
      ),
    );

    // An empty map means signed out or the token has not loaded yet. Sending
    // no Authorization header would 401 and cache that failure.
    if (avatarUrl == null || headers == null || headers.isEmpty) return fallback();

    // Flutter's image cache keys NetworkImage on url and scale alone, ignoring
    // headers. Once a request failed with a stale token, the failure stayed
    // cached and the photo never returned even after the token was refreshed.
    // Varying the url by the token makes a rotation a genuinely new entry.
    final tokenTag = headers.values.first.hashCode.toRadixString(36);

    return ClipOval(
      child: Image.network(
        '${AppConfig.apiOrigin}$avatarUrl?v=$tokenTag',
        headers: headers,
        width: size,
        height: size,
        fit: BoxFit.cover,
        loadingBuilder: (context, child, progress) => progress == null ? child : fallback(),
        errorBuilder: (_, _, _) => fallback(),
      ),
    );
  }
}
