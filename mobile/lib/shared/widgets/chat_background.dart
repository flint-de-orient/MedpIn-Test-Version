import 'package:flutter/material.dart';

/// The subtle medical-doodle wallpaper behind a chat thread — the same on the
/// patient's Assistant screen, their dietician thread, and the clinic's side of
/// both, like a messaging app's chat background.
///
/// Shown in every theme. It was light-mode only, which meant the same
/// conversation looked like a different product depending on the time of day
/// someone opened it. Dark mode gets the same artwork inverted and at a whisper
/// of its opacity, so it reads as texture instead of glare.
///
/// A missing asset falls back to a plain surface — the chat can never break
/// over a wallpaper.
class ChatBackground extends StatelessWidget {
  const ChatBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        image: DecorationImage(
          image: const AssetImage('assets/images/chat_bg.jpg'),
          // Tiled, not stretched — the doodles repeat small and dense like a
          // messaging-app wallpaper (scale shrinks each tile).
          repeat: ImageRepeat.repeat,
          scale: 3.0,
          // The artwork is near-white. Left as-is on a dark surface it glares
          // and swamps the bubbles, so dark mode inverts it to near-black and
          // drops it to a fraction of the light-mode strength.
          //
          // Light mode came down from 0.30. That reads as texture behind a
          // one-line bubble and as noise behind a twenty-line diet plan, and
          // the diet plan is the message that most needs reading.
          opacity: isDark ? 0.06 : 0.16,
          colorFilter: isDark
              ? const ColorFilter.mode(Colors.white, BlendMode.difference)
              : null,
          filterQuality: FilterQuality.medium,
        ),
      ),
      // RepaintBoundary isolates the thread's repaints from the static
      // background, so the wallpaper does not re-composite on every
      // keyboard/scroll frame.
      child: RepaintBoundary(child: child),
    );
  }
}
