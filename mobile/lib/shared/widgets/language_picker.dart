import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// The language selector, once, for all three panels.
///
/// It existed three times — copied into the patient, doctor and dietician
/// profile screens — and the copies had already drifted. Two of them sat in a
/// card like every other settings group; the patient's rendered as bare chips
/// straight on the page background, so the one section a first-time user is
/// most likely to touch was also the only one that did not look like part of
/// the app.
///
/// It is now a segmented control rather than a wrap of pills. With exactly
/// three options that always fit, a Wrap only ever varies the layout: at some
/// widths it produced two on one line and a lonely third below, which reads as
/// a mistake rather than a choice. Equal thirds cannot do that.
///
/// Every option renders in its own script — a Bengali speaker has to be able
/// to find "বাংলা" while the app is still in English, which is precisely the
/// moment they need this control.
class LanguagePicker extends StatelessWidget {
  const LanguagePicker({
    super.key,
    required this.selected,
    required this.onChanged,
  });

  /// Current language code, or null before one has been chosen.
  final String? selected;
  final ValueChanged<String> onChanged;

  /// Kept here rather than passed in: three panels showing three different
  /// language lists is the drift this widget exists to end.
  static const options = <({String code, String label, String native})>[
    (code: 'en', label: 'English', native: 'English'),
    (code: 'bn', label: 'Bengali', native: 'বাংলা'),
    (code: 'hi', label: 'Hindi', native: 'हिन्दी'),
  ];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < options.length; i++) ...[
          if (i > 0) const SizedBox(width: T.s2),
          Expanded(
            child: _Segment(
              option: options[i],
              selected: selected == options[i].code,
              onTap: () => onChanged(options[i].code),
            ),
          ),
        ],
      ],
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final ({String code, String label, String native}) option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tone = dark ? const Color(0xFF7FB0FF) : T.primary;

    return Semantics(
      button: true,
      selected: selected,
      // The English name as well as the native one, so a screen reader in
      // English does not have to attempt "বাংলা".
      label: option.label,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(T.rControl),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            curve: Curves.easeOut,
            // The full tap target, not padding that happens to add up to it.
            constraints: const BoxConstraints(minHeight: T.tap),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: T.s2),
            decoration: BoxDecoration(
              color:
                  selected
                      ? (dark ? const Color(0x1F4890F0) : T.primaryTint)
                      : (dark ? const Color(0xFF161D28) : Colors.white),
              borderRadius: BorderRadius.circular(T.rControl),
              // 1.5 against 1: the selected edge has to be findable without
              // relying on the fill, which is deliberately faint, and without
              // relying on colour alone.
              border: Border.all(
                color:
                    selected ? tone : (dark ? const Color(0x1FFFFFFF) : T.line),
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Text(
              option.native,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: T.small.copyWith(
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? tone : (dark ? Colors.white : T.ink),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
