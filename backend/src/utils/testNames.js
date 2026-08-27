/**
 * Deciding whether an advised lab test has actually been reported.
 *
 * There were three answers to this question in the codebase and they disagreed.
 * The dietician's panel normalised names and knew aliases. The patient's own
 * screen compared strings exactly, so "Vitamin D" and "Vitamin D (25-Hydroxy)"
 * were different tests. The reminder cron did not compare names at all — it
 * asked whether *any* report had been uploaded since the prescription, so a
 * patient who had uploaded the report before the doctor wrote the advice was
 * told to upload it, every scheduled nudge, forever.
 *
 * One answer now, here, used by all three.
 */

/**
 * Names that are genuinely the same test.
 *
 * Deliberately a fixed list rather than fuzzy matching: a near-miss that marks
 * the wrong test as done is worse than a nudge for one already uploaded,
 * because it hides an outstanding test from the doctor instead of annoying a
 * patient. Anything not listed simply has to match on its bare form.
 */
const TEST_ALIASES = new Map([
  ['glycatedhaemoglobin', 'hba1c'],
  ['glycatedhemoglobin', 'hba1c'],
  ['glycosylatedhaemoglobin', 'hba1c'],
  ['glycosylatedhemoglobin', 'hba1c'],
  ['hba1cglycatedhaemoglobin', 'hba1c'],
  ['a1c', 'hba1c'],
  ['fastingbloodsugar', 'fbs'],
  ['fastingplasmaglucose', 'fbs'],
  ['bloodsugarfasting', 'fbs'],
  ['postprandialbloodsugar', 'ppbs'],
  ['bloodsugarpostprandial', 'ppbs'],
  ['kidneyfunctiontest', 'kft'],
  ['kidneyfunction', 'kft'],
  ['renalfunctiontest', 'kft'],
  ['liverfunctiontest', 'lft'],
  ['liverfunction', 'lft'],
  ['completebloodcount', 'cbc'],
  ['thyroidprofile', 'thyroid'],
  ['thyroidfunctiontest', 'thyroid'],
  ['vitamind', 'vitd'],
  ['vitamind25hydroxy', 'vitd'],
  ['vitamindtotal', 'vitd'],
  ['vitaminb12', 'vitb12'],
  ['serumvitaminb12', 'vitb12'],
  ['serumelectrolytes', 'electrolytes'],
  ['lipidprofile', 'lipid'],
]);

/**
 * The comparable form of a test name.
 *
 * Brackets go first — a lab writes "Vitamin D (25-Hydroxy)" where a doctor
 * writes "Vitamin D", and the qualifier in brackets is almost always the same
 * test said more precisely. Then everything that is not a letter or digit, so
 * spacing, hyphens and capitals stop mattering.
 */
export function normaliseTestName(name) {
  const bare = String(name ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '');
  return TEST_ALIASES.get(bare) ?? bare;
}

/** The normalised names covered by a set of uploaded results. */
export function reportedNames(results) {
  return new Set(
    (results ?? [])
      .map((r) => normaliseTestName(r?.testName))
      .filter((n) => n.length > 0),
  );
}

/** Whether `advisedName` is covered by a set from [reportedNames]. */
export function isReported(advisedName, reported) {
  const key = normaliseTestName(advisedName);
  return key.length > 0 && reported.has(key);
}

/**
 * The advised tests with no report against them.
 *
 * The list a reminder should actually name. Nudging with the full advised list
 * when only one of four is outstanding tells the patient to do work they have
 * already done, which is how a reminder stops being read.
 */
export function outstandingTests(advised, results) {
  const reported = reportedNames(results);
  return (advised ?? []).filter((name) => name && !isReported(name, reported));
}
