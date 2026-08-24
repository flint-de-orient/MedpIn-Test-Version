/// The clinic's diabetes-focused lab catalog: each ORDER is a panel (the main
/// test); its analytes are the sub-tests that come back on the report. The
/// doctor orders at the panel level — you order "Lipid Profile", not "LDL".
///
/// Panels are matched to reports and prescriptions by their [name], so this is
/// the single list every surface draws from — keep names stable.
class LabPanel {
  const LabPanel({
    required this.name,
    required this.category,
    this.analytes = const [],
  });

  /// The ordered name, stored in `labTestsAdvised` and matched against reports.
  final String name;

  /// Grouping for the picker (Glycemic, Lipid, Renal…).
  final String category;

  /// The sub-tests the panel reports. Empty for a single-value test (HbA1c).
  final List<String> analytes;

  bool get isPanel => analytes.isNotEmpty;
}

const List<LabPanel> kLabCatalog = [
  // Glycemic
  LabPanel(name: 'HbA1c', category: 'Glycemic'),
  LabPanel(name: 'Fasting Blood Sugar', category: 'Glycemic'),
  LabPanel(name: 'Post-Prandial Blood Sugar', category: 'Glycemic'),
  LabPanel(name: 'Random Blood Sugar', category: 'Glycemic'),

  // Lipid
  LabPanel(
    name: 'Lipid Profile',
    category: 'Lipid',
    analytes: ['Total Cholesterol', 'LDL', 'HDL', 'VLDL', 'Triglycerides'],
  ),

  // Renal
  LabPanel(
    name: 'Kidney Function (KFT)',
    category: 'Renal',
    analytes: ['Urea', 'Creatinine', 'Uric Acid', 'eGFR', 'BUN'],
  ),
  LabPanel(
    name: 'Urine Microalbumin (ACR)',
    category: 'Renal',
    analytes: ['Microalbumin', 'Albumin/Creatinine Ratio'],
  ),

  // Liver
  LabPanel(
    name: 'Liver Function (LFT)',
    category: 'Liver',
    analytes: [
      'SGOT (AST)',
      'SGPT (ALT)',
      'ALP',
      'Bilirubin',
      'Albumin',
      'Total Protein',
    ],
  ),

  // Thyroid
  LabPanel(
    name: 'Thyroid Profile',
    category: 'Thyroid',
    analytes: ['TSH', 'T3', 'T4'],
  ),

  // Hematology
  LabPanel(
    name: 'CBC',
    category: 'Hematology',
    analytes: ['Hemoglobin', 'TLC', 'RBC', 'Platelets', 'PCV', 'MCV'],
  ),

  // Metabolic / other
  LabPanel(
    name: 'Serum Electrolytes',
    category: 'Metabolic',
    analytes: ['Sodium', 'Potassium', 'Chloride'],
  ),
  LabPanel(name: 'Vitamin B12', category: 'Vitamins'),
  LabPanel(name: 'Vitamin D', category: 'Vitamins'),
];

/// Case-insensitive lookup so an ordered/reported name resolves to its panel
/// (and its sub-tests) even if the wording drifts slightly.
LabPanel? labPanelFor(String name) {
  final n = name.trim().toLowerCase();
  for (final p in kLabCatalog) {
    if (p.name.toLowerCase() == n) return p;
  }
  return null;
}

/// The panels grouped by category, in catalog order — for a sectioned picker.
Map<String, List<LabPanel>> labCatalogByCategory() {
  final out = <String, List<LabPanel>>{};
  for (final p in kLabCatalog) {
    (out[p.category] ??= []).add(p);
  }
  return out;
}

/// Panels matching what a doctor has typed, best first.
///
/// Searches the analytes as well as the panel name, because that is how the
/// order is actually thought of: nobody orders "LDL", they order a Lipid
/// Profile *to get* the LDL — but "ldl" is what gets typed. Without this the
/// field answered a real query with nothing and the doctor added a duplicate
/// custom test the catalog already covered.
///
/// Ranked rather than filtered. A prefix on the panel name is the strongest
/// signal, then a match anywhere in it, then a match on one of its analytes;
/// ties break on the shorter name, which is almost always the more common
/// test.
List<LabPanel> searchLabPanels(String query, {int limit = 8}) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return const [];

  int rank(LabPanel p) {
    final name = p.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.contains(q)) return 1;
    if (p.analytes.any((a) => a.toLowerCase().startsWith(q))) return 2;
    if (p.analytes.any((a) => a.toLowerCase().contains(q))) return 3;
    // Category last: "renal" should find the renal panels, but only once
    // nothing named or measured matches.
    if (p.category.toLowerCase().contains(q)) return 4;
    return -1;
  }

  final hits = <(int, LabPanel)>[];
  for (final p in kLabCatalog) {
    final r = rank(p);
    if (r >= 0) hits.add((r, p));
  }
  hits.sort((a, b) {
    if (a.$1 != b.$1) return a.$1.compareTo(b.$1);
    if (a.$2.name.length != b.$2.name.length) {
      return a.$2.name.length.compareTo(b.$2.name.length);
    }
    return a.$2.name.compareTo(b.$2.name);
  });
  return [for (final h in hits.take(limit)) h.$2];
}

/// Why a panel surfaced for [query] — "Includes LDL", or its category.
///
/// Shown under the name in the suggestion list. Without it, typing "ldl" and
/// being offered "Lipid Profile" looks like the search misfiring rather than
/// like the answer.
String labMatchReason(LabPanel p, String query) {
  final q = query.trim().toLowerCase();
  if (q.isNotEmpty && !p.name.toLowerCase().contains(q)) {
    final hit = p.analytes.firstWhere(
      (a) => a.toLowerCase().contains(q),
      orElse: () => '',
    );
    if (hit.isNotEmpty) return 'Includes $hit';
  }
  if (p.analytes.isEmpty) return p.category;
  return '${p.category} · ${p.analytes.length} values';
}
