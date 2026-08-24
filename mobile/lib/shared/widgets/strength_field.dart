import 'package:flutter/material.dart';

import '../../features/medications/domain/strength.dart';

/// A medicine strength: the number typed, the unit chosen.
///
/// The unit was free text before, which is why the stored data reads "1mg",
/// "500 mg" and "500/50" — three spellings, one of them missing the unit
/// entirely. A patient shown "Gluconorm G1 500/50" cannot tell what the numbers
/// count.
///
/// Chosen rather than typed, because the set is short and closed. It also keeps
/// the field honest about the drugs that are not in milligrams: insulin is IU,
/// and a dropdown makes that a selection instead of something the prescriber
/// has to remember to write.
///
/// Composes back into the same single `strength` string the API already takes —
/// no schema change, and the stored value stays readable to a human.
class StrengthField extends StatefulWidget {
  const StrengthField({
    super.key,
    required this.controller,
    this.label = 'Strength',
    this.isDense = true,
  });

  /// The existing free-text controller. Its value stays "500 mg" — this widget
  /// only changes how that string is arrived at.
  final TextEditingController controller;
  final String label;
  final bool isDense;

  @override
  State<StrengthField> createState() => _StrengthFieldState();
}

class _StrengthFieldState extends State<StrengthField> {
  late final TextEditingController _amount;
  String _unit = defaultStrengthUnit;

  @override
  void initState() {
    super.initState();
    // Split whatever is already stored, so editing an existing prescription
    // does not silently rewrite its unit.
    final raw = widget.controller.text.trim();
    final match = RegExp(
      r'^([\d.]+(?:\s*/\s*[\d.]+)*)\s*(.*)$',
    ).firstMatch(raw);
    final existingUnit = (match?.group(2) ?? '').trim();
    _amount = TextEditingController(text: (match?.group(1) ?? raw).trim());
    if (existingUnit.isNotEmpty) {
      // An unrecognised unit is kept as it was typed rather than snapped to the
      // nearest option — the prescriber wrote it for a reason.
      _unit = strengthUnits.firstWhere(
        (u) => u.toLowerCase() == existingUnit.toLowerCase(),
        orElse: () => existingUnit,
      );
    }
    _amount.addListener(_compose);
  }

  void _compose() {
    final a = _amount.text.trim();
    widget.controller.text = a.isEmpty ? '' : '$a $_unit';
  }

  @override
  void dispose() {
    _amount.removeListener(_compose);
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Any unit already on the record joins the list, so editing an old
    // prescription never presents a dropdown that cannot show its own value.
    final options = <String>{...strengthUnits, _unit}.toList();

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          flex: 3,
          child: TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: widget.label,
              // Two numbers for a combination tablet, which is most of what
              // this clinic prescribes.
              hintText: '500 or 500/50',
              isDense: widget.isDense,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 2,
          child: DropdownButtonFormField<String>(
            initialValue: _unit,
            isDense: widget.isDense,
            // Without this the button sizes its child to the *widest* item —
            // "mg/mL" — and where the parent is narrower than that, the child
            // is clipped away entirely and the control renders as a chevron
            // over an empty box. It looked correct on the consult form, which
            // gives it more room, and blank on the patient profile, which does
            // not. Expanded, it lays out inside whatever width it is given.
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Unit',
              isDense: widget.isDense,
            ),
            items: [
              for (final u in options)
                DropdownMenuItem(
                  value: u,
                  child: Text(u, maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (v) {
              if (v == null) return;
              setState(() => _unit = v);
              _compose();
            },
          ),
        ),
      ],
    );
  }
}
