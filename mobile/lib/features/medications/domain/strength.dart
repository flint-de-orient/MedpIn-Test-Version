/// Presenting a medicine's strength, whatever shape it was typed in.
///
/// `strength` is free text and always has been: a doctor types "500mg", "500
/// mg", "500/50" or "100 IU/mL" depending on the drug and the day. The stored
/// values are therefore inconsistent, and a patient reading "Gluconorm G1
/// 500/50" cannot tell whether the missing unit is milligrams or something
/// else.
///
/// This adds a unit ONLY where the value cannot mean anything else — a bare
/// number, or a slashed pair of numbers for a combination tablet. Anything
/// carrying a letter already states its own unit and is left alone but for
/// spacing.
///
/// The restraint is the point. Insulin is prescribed in IU, some drugs in
/// micrograms, liquids in mg/mL. Appending "mg" to everything would read
/// correctly on almost every screen and be dangerously wrong on exactly the
/// records where being wrong matters — which is the kind of bug that survives
/// review because it looks right.
library;

/// Digits, decimals, and the slash that separates a combination's components.
/// "500", "12.5", "500/50", "1000/50/5" — nothing else.
final _bareNumeric = RegExp(r'^\d+(\.\d+)?(\s*/\s*\d+(\.\d+)?)*$');

/// A number run straight into its unit: "500mg", "12.5mcg", "100IU".
final _numberThenUnit = RegExp(r'^(\d+(?:\.\d+)?)\s*([a-zA-Zµ%][a-zA-Zµ%/]*)$');

/// The unit assumed for a bare number. Correct for oral agents, which is what
/// a bare number is in practice — anything measured in IU or mcg is written
/// with its unit because nobody writes insulin as "100".
const defaultStrengthUnit = 'mg';

/// Units offered at entry, so a strength is chosen rather than typed.
const strengthUnits = <String>['mg', 'mcg', 'g', 'IU', 'mL', 'mg/mL', '%'];

/// The strength as it should be shown to a patient.
///
///   "1mg"        -> "1 mg"        (spacing only)
///   "500 mg"     -> "500 mg"      (unchanged)
///   "500/50"     -> "500/50 mg"   (bare pair, unit added)
///   "100 IU/mL"  -> "100 IU/mL"   (has a unit, untouched)
///   "1/2 tablet" -> "1/2 tablet"  (has a letter, untouched)
String formatStrength(String? raw) {
  final s = (raw ?? '').trim();
  if (s.isEmpty) return '';

  if (_bareNumeric.hasMatch(s)) {
    // Normalise the spacing inside a combination while we are here: "500 / 50"
    // and "500/50" should not print differently.
    return '${s.replaceAll(RegExp(r'\s*/\s*'), '/')} $defaultStrengthUnit';
  }

  final m = _numberThenUnit.firstMatch(s);
  if (m != null) return '${m.group(1)} ${m.group(2)}';

  return s;
}

/// True when the value states no unit and one had to be assumed — for warning
/// the prescriber rather than the patient.
bool strengthAssumesUnit(String? raw) =>
    _bareNumeric.hasMatch((raw ?? '').trim());
