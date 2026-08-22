import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';

/// Appears once the newest message scrolls out of view — the same affordance the
/// doctor's and patient's main threads have. Without it a long conversation
/// leaves you dragging back down to see what just arrived.
class JumpToLatest extends StatelessWidget {
  const JumpToLatest({super.key, required this.visible, required this.onTap});

  final bool visible;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: visible ? 1 : 0,
      duration: const Duration(milliseconds: 160),
      child: IgnorePointer(
        ignoring: !visible,
        child: Padding(
          // 8px left it sitting on the composer's shoulder, reading as part
          // of the input bar rather than as something floating over the thread.
          // Clear of the composer. At 20 it sat in the thumb's path to the
          // send key, and a mis-tap there scrolls the thread away mid-sentence.
          padding: const EdgeInsets.only(right: 12, bottom: 56),
          child: Material(
            color: AppColors.accentOn(context),
            shape: const CircleBorder(),
            elevation: 3,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onTap,
              child: const Padding(
                padding: EdgeInsets.all(8),
                child: Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 26,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
