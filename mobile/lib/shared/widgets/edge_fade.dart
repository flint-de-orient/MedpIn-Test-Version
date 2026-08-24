import 'package:flutter/material.dart';

/// Fades the ends of a horizontal scroller, but only the end that has more
/// behind it.
///
/// Every chip rail in the app had the same tell: the last item sliced clean
/// down the middle by the screen edge — "High Risk (1" — which reads as a
/// layout bug rather than as an invitation to scroll. A hard cut says the
/// content is broken; a soft one says it continues.
///
/// The fade is driven by scroll position, so it appears on the right until you
/// reach the end and on the left once you have left the start. A permanent
/// fade on both sides would dim the first and last chips of a rail short
/// enough to need no scrolling at all.
class EdgeFade extends StatefulWidget {
  const EdgeFade({
    super.key,
    required this.child,
    required this.controller,
    this.width = 28,
  });

  final Widget child;

  /// The scroller's controller. Shared rather than created here so the caller
  /// keeps whatever scrolling behaviour it already had.
  final ScrollController controller;
  final double width;

  @override
  State<EdgeFade> createState() => _EdgeFadeState();
}

class _EdgeFadeState extends State<EdgeFade> {
  bool _atStart = true;
  bool _atEnd = true;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_sync);
    // After first layout: until the viewport is measured there are no extents
    // to compare, and asking during build would answer "no overflow" for
    // every rail.
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  @override
  void dispose() {
    widget.controller.removeListener(_sync);
    super.dispose();
  }

  void _sync() {
    if (!mounted || !widget.controller.hasClients) return;
    final p = widget.controller.position;
    final atStart = p.pixels <= p.minScrollExtent + 1;
    final atEnd = p.pixels >= p.maxScrollExtent - 1;
    if (atStart != _atStart || atEnd != _atEnd) {
      setState(() {
        _atStart = atStart;
        _atEnd = atEnd;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Nothing to fade on a rail that fits.
    if (_atStart && _atEnd) return widget.child;

    return ShaderMask(
      shaderCallback: (rect) {
        final w = rect.width;
        if (w <= 0)
          return const LinearGradient(
            colors: [Colors.white, Colors.white],
          ).createShader(rect);
        final f = (widget.width / w).clamp(0.0, 0.5);
        return LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            _atStart ? Colors.white : Colors.transparent,
            Colors.white,
            Colors.white,
            _atEnd ? Colors.white : Colors.transparent,
          ],
          stops: [0, f, 1 - f, 1],
        ).createShader(rect);
      },
      // dstIn so the gradient's alpha becomes the child's alpha — the chips
      // dissolve into the page rather than into a white bar, which is what a
      // painted overlay would give on a tinted background.
      blendMode: BlendMode.dstIn,
      child: widget.child,
    );
  }
}
