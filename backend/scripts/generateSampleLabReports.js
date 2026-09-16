/**
 * Generates realistic pathology reports as PDFs — one per test on the patient's
 * "My tests" screen — so the upload, extraction and analysis pipeline can be
 * exercised end to end without waiting on a real lab.
 *
 * Laid out the way an Indian diagnostic lab prints: letterhead, specimen block,
 * a results table with the biological reference interval beside each value, and
 * an interpretation panel underneath. Anything outside its reference interval is
 * red and flagged H or L; everything else stays in the ordinary ink colour, so
 * the eye lands on what actually needs reading.
 *
 * The values across the ten reports belong to ONE coherent picture — a patient
 * with poorly controlled type 2 diabetes — rather than ten unrelated sets of
 * numbers. That matters: the analyser reads several reports into one record, and
 * contradictory fixtures would make its output look broken when it isn't.
 *
 * Every page carries a SAMPLE watermark and a footer saying it was generated for
 * software testing. These are fixtures, not results, and nothing that looks this
 * much like a real report should be able to pass as one.
 *
 *   node scripts/generateSampleLabReports.js
 *   node scripts/generateSampleLabReports.js --name "Rahul Sharma" --age 54 --sex Male
 *   node scripts/generateSampleLabReports.js --out ../sample-reports
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import path from 'node:path';

// --- Command line -----------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PATIENT = {
  name: arg('--name', 'Rahul Sharma'),
  age: arg('--age', '54'),
  sex: arg('--sex', 'Male'),
  id: arg('--id', 'MP-2026-04871'),
  // An invented doctor, like the invented lab below. A real doctor's name on a
  // document this convincing is a claim nobody made.
  referredBy: arg('--doctor', 'Dr. Sample Referrer, MD (Medicine)'),
};

const OUT_DIR = path.resolve(process.cwd(), arg('--out', 'sample-reports'));

// A fictional lab. Deliberately not the name of a real chain — these documents
// look genuine enough that borrowing a real accreditation would be dishonest.
const LAB = {
  name: 'Meridian Diagnostics & Research Centre',
  tagline: 'Clinical Pathology | Biochemistry | Immunoassay',
  address: '14 Park Circus Road, Kolkata 700017 | Ph: 033 4000 1200',
  accreditation: 'NABL accredited (sample document)',
  pathologist: 'Dr. S. Venkatesan, MD (Pathology)',
  regNo: 'WBMC-48219',
};

// Collection is 07:40, reporting the same afternoon — the ordinary turnaround
// for a morning fasting draw.
const COLLECTED = '12 Aug 2026, 07:40 AM';
const RECEIVED = '12 Aug 2026, 09:15 AM';
const REPORTED = '12 Aug 2026, 04:20 PM';

// --- Palette ----------------------------------------------------------------

const ACCENT = '#0f3d6e';
const INK = '#0f172a';
const SLATE = '#475569';
const MUTED = '#94a3b8';
const LINE = '#e2e8f0';
const WASH = '#f8fafc';
const DANGER = '#c0322b';
const DANGER_WASH = '#fdf2f2';

const M = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - M * 2;

/// Content stops here; below it belongs to the signature band. Anything that
/// would cross this line moves to the next page instead of printing over it.
const CONTENT_BOTTOM = PAGE_H - M - 84;

// Column geometry for the results table.
const COL_TEST = 196;
const COL_RESULT = 86;
const COL_UNIT = 68;
const COL_REF = CONTENT_W - COL_TEST - COL_RESULT - COL_UNIT;

// --- Reference-range helpers ------------------------------------------------

/** low | high | normal for a value against its interval. */
function flagFor(row) {
  if (row.low != null && row.value < row.low) return 'low';
  if (row.high != null && row.value > row.high) return 'high';
  return 'normal';
}

/** "70 - 100", "< 140", "> 40" — WinAnsi-safe, no maths glyphs pdfkit lacks. */
function refText(row) {
  if (row.ref) return row.ref;
  // Formatted the same way as the result, so a platelet count is not read
  // against a bound printed in a different notation.
  if (row.low != null && row.high != null) return `${fmtValue(row.low)} - ${fmtValue(row.high)}`;
  if (row.high != null) return `< ${fmtValue(row.high)}`;
  if (row.low != null) return `> ${fmtValue(row.low)}`;
  return '-';
}

/**
 * The value as a lab prints it: the precision it was measured to, not a
 * precision invented by the formatter. Potassium is reported as 4.2, never 4.20.
 * Counts in the thousands get Indian digit grouping, which is how a Kolkata lab
 * prints a platelet count.
 */
const fmtValue = (v) => (v >= 10000 ? new Intl.NumberFormat('en-IN').format(v) : String(v));

// --- Drawing ----------------------------------------------------------------

/**
 * The diagonal SAMPLE mark, drawn before anything else so it sits under the
 * content rather than over it. Faint enough to stay out of the way, plain enough
 * that nobody can miss what this document is.
 */
function watermark(doc) {
  doc.save();
  doc.rotate(-30, { origin: [PAGE_W / 2, PAGE_H / 2] });
  doc
    .fillColor(ACCENT)
    .opacity(0.05)
    .font('Helvetica-Bold')
    .fontSize(64)
    .text('SAMPLE REPORT', 0, PAGE_H / 2 - 40, { width: PAGE_W, align: 'center' });
  doc.restore();
}

/**
 * Starts a fresh page, closing off the current one first.
 *
 * A continuation page repeats who the report belongs to and which test it is.
 * A loose second page carrying only numbers, with no name on it, is how results
 * end up filed against the wrong patient.
 */
function newPage(doc, ctx) {
  pageFooter(doc, { last: false });
  doc.addPage();
  ctx.page += 1;
  watermark(doc);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(LAB.name, M, M, { width: CONTENT_W });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(SLATE)
    .text(
      `${PATIENT.name} | ${PATIENT.id} | ${ctx.panel.title} (continued)`,
      M,
      doc.y + 1,
      { width: CONTENT_W },
    );
  const y = doc.y + 6;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.y = y + 14;

  // Columns of bare numbers are unreadable without their headings.
  if (ctx.inTable) tableHeader(doc);
}

/** Moves to a new page when [need] points of content would not fit on this one. */
function ensureSpace(doc, ctx, need) {
  if (doc.y + need > CONTENT_BOTTOM) newPage(doc, ctx);
}

function letterhead(doc) {
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(17).text(LAB.name, M, M, { width: CONTENT_W });
  doc.fillColor(SLATE).font('Helvetica').fontSize(8.5).text(LAB.tagline, { width: CONTENT_W });
  doc.fillColor(MUTED).fontSize(8).text(LAB.address, { width: CONTENT_W });
  doc.text(LAB.accreditation, { width: CONTENT_W });

  const y = doc.y + 8;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1.6).strokeColor(ACCENT).stroke();
  doc.y = y + 12;
}

/**
 * Patient and specimen details, as a two-column grid on a washed panel. Every
 * field a lab prints and a clinician checks before trusting a number: who, when
 * it was drawn, what it was drawn into, and who asked for it.
 */
function patientBlock(doc, panel) {
  const top = doc.y;
  const rows = [
    ['Patient name', PATIENT.name, 'Patient ID', PATIENT.id],
    ['Age / Sex', `${PATIENT.age} Years / ${PATIENT.sex}`, 'Collected', COLLECTED],
    ['Referred by', PATIENT.referredBy, 'Received', RECEIVED],
    ['Specimen', panel.specimen, 'Reported', REPORTED],
  ];
  const h = rows.length * 15 + 14;

  doc.roundedRect(M, top, CONTENT_W, h, 6).fillAndStroke(WASH, LINE);

  let y = top + 8;
  const colL = M + 12;
  const colR = M + CONTENT_W / 2 + 4;
  for (const [k1, v1, k2, v2] of rows) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${k1}`, colL, y, { width: 70 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(v1, colL + 72, y - 0.5, { width: CONTENT_W / 2 - 90 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${k2}`, colR, y, { width: 62 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(v2, colR + 64, y - 0.5, { width: CONTENT_W / 2 - 80 });
    y += 15;
  }

  doc.y = top + h + 16;
}

function reportTitle(doc, panel) {
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(ACCENT).text(panel.title, M, doc.y, {
    width: CONTENT_W,
    align: 'center',
    characterSpacing: 0.6,
  });
  if (panel.method) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Method: ${panel.method}`, { width: CONTENT_W, align: 'center' });
  }
  doc.y += 10;
}

function tableHeader(doc) {
  const y = doc.y;
  doc.rect(M, y, CONTENT_W, 20).fill(ACCENT);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  doc.text('INVESTIGATION', M + 10, y + 6.5, { width: COL_TEST - 10 });
  doc.text('RESULT', M + COL_TEST, y + 6.5, { width: COL_RESULT, align: 'right' });
  doc.text('UNIT', M + COL_TEST + COL_RESULT + 14, y + 6.5, { width: COL_UNIT });
  doc.text('REFERENCE INTERVAL', M + COL_TEST + COL_RESULT + COL_UNIT + 14, y + 6.5, { width: COL_REF - 14 });
  doc.y = y + 20;
}

/**
 * One result line. An abnormal value is the only thing on the row that changes
 * colour — the label, unit and interval stay neutral, so red means "this number"
 * and not "this whole line is alarming".
 */
function resultRow(doc, ctx, row) {
  const flag = flagFor(row);
  const abnormal = flag !== 'normal';
  const H = 19;
  ensureSpace(doc, ctx, H);
  const y = doc.y;

  if (abnormal) doc.rect(M, y, CONTENT_W, H).fill(DANGER_WASH);

  doc.font('Helvetica').fontSize(8.8).fillColor(INK).text(row.name, M + 10, y + 5.5, {
    width: COL_TEST - 12,
    lineBreak: false,
  });

  const value = fmtValue(row.value);
  const mark = flag === 'high' ? ' H' : flag === 'low' ? ' L' : '';
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(abnormal ? DANGER : INK)
    .text(value + mark, M + COL_TEST, y + 5.2, { width: COL_RESULT, align: 'right' });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(SLATE)
    .text(row.unit, M + COL_TEST + COL_RESULT + 14, y + 5.5, { width: COL_UNIT, lineBreak: false });

  doc
    .fontSize(8.5)
    .fillColor(SLATE)
    .text(refText(row), M + COL_TEST + COL_RESULT + COL_UNIT + 14, y + 5.5, {
      width: COL_REF - 14,
      lineBreak: false,
    });

  doc.moveTo(M, y + H).lineTo(PAGE_W - M, y + H).lineWidth(0.4).strokeColor(LINE).stroke();
  doc.y = y + H;
}

function groupHeading(doc, ctx, text) {
  // Plus a row, so a heading never lands alone at the foot of a page.
  ensureSpace(doc, ctx, 17 + 19);
  const y = doc.y;
  doc.rect(M, y, CONTENT_W, 17).fill(WASH);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(ACCENT)
    .text(text.toUpperCase(), M + 10, y + 5, { width: CONTENT_W - 20, characterSpacing: 0.4 });
  doc.y = y + 17;
}

/**
 * The interpretation panel.
 *
 * Out-of-range findings come first, in red, each with the value it reached, the
 * interval it should sit in, and a plain sentence about what that means. What is
 * normal is worth saying too — a clinician scanning the report needs to know the
 * kidney numbers were checked and were fine — but it is said compactly, in
 * ordinary ink, because it is not what the report is about.
 */
function summary(doc, ctx, rows) {
  const out = rows.filter((r) => flagFor(r) !== 'normal');
  const ok = rows.filter((r) => flagFor(r) === 'normal');

  ctx.inTable = false;
  doc.y += 14;
  // The heading plus the first finding, so the section never opens on one page
  // and delivers on the next.
  ensureSpace(doc, ctx, 60);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(ACCENT)
    .text('SUMMARY & INTERPRETATION', M, doc.y, { width: CONTENT_W, characterSpacing: 0.5 });
  doc.y += 4;
  doc.moveTo(M, doc.y).lineTo(PAGE_W - M, doc.y).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.y += 10;

  if (out.length > 0) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(DANGER)
      .text(`Outside the reference interval (${out.length})`, M, doc.y, { width: CONTENT_W });
    doc.y += 6;

    for (const r of out) {
      const note = r.note ?? '';
      const noteH = note
        ? doc.font('Helvetica').fontSize(8.2).heightOfString(note, { width: CONTENT_W - 34 })
        : 0;
      const h = 18 + noteH + 8;
      ensureSpace(doc, ctx, h + 5);
      const top = doc.y;

      // A red rule down the left edge rather than a filled block: it marks the
      // finding without turning half the page into a warning.
      doc.rect(M, top, 2.5, h).fill(DANGER);
      doc.rect(M + 2.5, top, CONTENT_W - 2.5, h).fill(DANGER_WASH);

      const label = `${r.name}  ${fmtValue(r.value)} ${r.unit}`;
      doc.font('Helvetica-Bold').fontSize(8.8).fillColor(DANGER).text(label, M + 12, top + 5, {
        width: CONTENT_W - 150,
        lineBreak: false,
      });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(SLATE)
        .text(`Reference ${refText(r)} ${r.unit}`, M + CONTENT_W - 152, top + 5.5, {
          width: 140,
          align: 'right',
          lineBreak: false,
        });

      if (note) {
        doc.font('Helvetica').fontSize(8.2).fillColor(INK).text(note, M + 12, top + 18, {
          width: CONTENT_W - 34,
        });
      }
      doc.y = top + h + 5;
    }
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.8)
      .fillColor(INK)
      .text('All measured parameters are within their reference intervals.', M, doc.y, {
        width: CONTENT_W,
      });
    doc.y += 6;
  }

  if (ok.length > 0) {
    const line = ok.map((r) => `${r.name} ${fmtValue(r.value)}`).join('   |   ');
    const h = doc.font('Helvetica').fontSize(8.2).heightOfString(line, { width: CONTENT_W, lineGap: 2.5 });
    ensureSpace(doc, ctx, h + 24);

    doc.y += 6;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(SLATE)
      .text(`Within the reference interval (${ok.length})`, M, doc.y, { width: CONTENT_W });
    doc.y += 3;
    doc.font('Helvetica').fontSize(8.2).fillColor(SLATE).text(line, M, doc.y, {
      width: CONTENT_W,
      lineGap: 2.5,
    });
  }
}

/**
 * The band at the foot of every page.
 *
 * The pathologist's authorisation and the end-of-report marker belong on the
 * final page only — a mid-report page that says "end of report" invites someone
 * to stop reading there.
 */
function pageFooter(doc, { last }) {
  const y = PAGE_H - M - 62;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.5).strokeColor(LINE).stroke();

  if (last) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(LAB.pathologist, M, y + 8, { width: 260 });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Consultant Pathologist | Reg. ${LAB.regNo}`, {
      width: 260,
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(MUTED)
      .text('-- End of report --', M + CONTENT_W - 200, y + 10, { width: 200, align: 'right' });
  } else {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('Continued on the next page', M, y + 10, { width: CONTENT_W, align: 'right' });
  }

  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      'SAMPLE DOCUMENT - generated for software testing. Not a diagnostic result and not issued by any laboratory. ' +
        'Laboratory results are interpreted alongside the clinical picture.',
      M,
      PAGE_H - M - 22,
      { width: CONTENT_W, align: 'center' },
    );
}

// --- The reports ------------------------------------------------------------
//
// One patient, one draw. Poorly controlled type 2 diabetes on metformin: the
// glycaemic panels are high, the lipids are the pattern that goes with it (high
// triglycerides, low HDL), the liver shows the mild transaminitis of fatty liver,
// thyroid is subclinically underactive, and B12 is low — which is what long-term
// metformin does. Kidneys and electrolytes are still holding.

const PANELS = [
  {
    file: '01-fasting-blood-sugar',
    title: 'BLOOD SUGAR - FASTING',
    specimen: 'Sodium Fluoride Plasma',
    method: 'Hexokinase / G-6-PDH',
    rows: [
      {
        name: 'Glucose, Fasting (FBS)',
        value: 148,
        unit: 'mg/dL',
        low: 70,
        high: 100,
        note: 'Fasting glucose is above the non-diabetic range and above the usual treatment target of 80-130 mg/dL for a person on treatment for diabetes.',
      },
    ],
  },
  {
    file: '02-post-prandial-blood-sugar',
    title: 'BLOOD SUGAR - POST PRANDIAL (2 HOURS)',
    specimen: 'Sodium Fluoride Plasma',
    method: 'Hexokinase / G-6-PDH',
    rows: [
      {
        name: 'Glucose, Post Prandial (PPBS)',
        value: 236,
        unit: 'mg/dL',
        high: 140,
        note: 'Two-hour post-meal glucose is well above target, indicating the meal-time rise is not being controlled.',
      },
      {
        name: 'Glucose, Fasting (same draw)',
        value: 148,
        unit: 'mg/dL',
        low: 70,
        high: 100,
        note: 'Consistent with the fasting sample reported separately.',
      },
    ],
  },
  {
    file: '03-lipid-profile',
    title: 'LIPID PROFILE, SERUM',
    specimen: 'Serum (12 hour fasting)',
    method: 'Enzymatic, colorimetric | LDL calculated (Friedewald)',
    groups: [
      {
        heading: 'Measured',
        rows: [
          {
            name: 'Total Cholesterol',
            value: 224,
            unit: 'mg/dL',
            high: 200,
            note: 'Above the desirable level.',
          },
          {
            name: 'Triglycerides',
            value: 218,
            unit: 'mg/dL',
            high: 150,
            note: 'Raised. Triglycerides commonly rise when blood sugar is poorly controlled and fall again as control improves.',
          },
          {
            name: 'HDL Cholesterol',
            value: 36,
            unit: 'mg/dL',
            low: 40,
            note: 'Low. HDL below 40 mg/dL in men adds to cardiovascular risk.',
          },
        ],
      },
      {
        heading: 'Calculated',
        rows: [
          {
            name: 'LDL Cholesterol',
            value: 144.4,
            unit: 'mg/dL',
            high: 100,
            note: 'Above the target for someone with diabetes, where an LDL under 100 mg/dL is usually aimed for, and under 70 mg/dL if there is established heart disease.',
          },
          { name: 'VLDL Cholesterol', value: 43.6, unit: 'mg/dL', low: 10, high: 30, note: 'Raised, in line with the triglycerides.' },
          { name: 'Non-HDL Cholesterol', value: 188, unit: 'mg/dL', high: 130, note: 'Raised. This is the total of all the cholesterol carried by particles that contribute to plaque.' },
          { name: 'Total Cholesterol / HDL Ratio', value: 6.22, unit: 'ratio', high: 4.5, note: 'Above the desirable ratio.' },
        ],
      },
    ],
  },
  {
    file: '04-kidney-function-kft',
    title: 'KIDNEY FUNCTION TEST (KFT)',
    specimen: 'Serum',
    method: 'Urease-GLDH | Jaffe kinetic | Uricase',
    rows: [
      { name: 'Blood Urea', value: 34, unit: 'mg/dL', low: 17, high: 43 },
      { name: 'Blood Urea Nitrogen (BUN)', value: 15.9, unit: 'mg/dL', low: 8, high: 20 },
      { name: 'Creatinine, Serum', value: 1.16, unit: 'mg/dL', low: 0.7, high: 1.3 },
      {
        name: 'eGFR (CKD-EPI 2021)',
        value: 68,
        unit: 'mL/min/1.73m2',
        low: 90,
        note: 'Mildly reduced filtration (stage G2). Creatinine is still within range, so this is worth repeating rather than acting on from a single reading.',
      },
      {
        name: 'Uric Acid',
        value: 7.4,
        unit: 'mg/dL',
        low: 3.5,
        high: 7.2,
        note: 'Marginally raised.',
      },
      { name: 'Calcium, Total', value: 9.2, unit: 'mg/dL', low: 8.6, high: 10.2 },
      { name: 'Phosphorus', value: 3.6, unit: 'mg/dL', low: 2.5, high: 4.5 },
      { name: 'Total Protein', value: 7.1, unit: 'g/dL', low: 6.4, high: 8.3 },
      { name: 'Albumin, Serum', value: 4.2, unit: 'g/dL', low: 3.5, high: 5.2 },
    ],
  },
  {
    file: '05-liver-function-lft',
    title: 'LIVER FUNCTION TEST (LFT)',
    specimen: 'Serum',
    method: 'IFCC without P5P | Diazo | PNPP kinetic',
    groups: [
      {
        heading: 'Bilirubin',
        rows: [
          { name: 'Bilirubin, Total', value: 0.9, unit: 'mg/dL', low: 0.2, high: 1.2 },
          { name: 'Bilirubin, Direct', value: 0.3, unit: 'mg/dL', high: 0.3 },
          { name: 'Bilirubin, Indirect', value: 0.6, unit: 'mg/dL', low: 0.1, high: 1.0 },
        ],
      },
      {
        heading: 'Enzymes',
        rows: [
          {
            name: 'SGOT / AST',
            value: 42,
            unit: 'U/L',
            high: 37,
            note: 'Mildly raised.',
          },
          {
            name: 'SGPT / ALT',
            value: 58,
            unit: 'U/L',
            high: 41,
            note: 'Mildly raised. An ALT higher than AST at this level, with diabetes and raised triglycerides, most often reflects fat in the liver.',
          },
          { name: 'Alkaline Phosphatase (ALP)', value: 112, unit: 'U/L', low: 40, high: 129 },
          {
            name: 'GGT',
            value: 61,
            unit: 'U/L',
            high: 55,
            note: 'Mildly raised, in keeping with the same picture.',
          },
        ],
      },
      {
        heading: 'Proteins',
        rows: [
          { name: 'Total Protein', value: 7.2, unit: 'g/dL', low: 6.4, high: 8.3 },
          { name: 'Albumin', value: 4.1, unit: 'g/dL', low: 3.5, high: 5.2 },
          { name: 'Globulin', value: 3.1, unit: 'g/dL', low: 2.0, high: 3.5 },
          { name: 'A / G Ratio', value: 1.32, unit: 'ratio', low: 1.0, high: 2.1 },
        ],
      },
    ],
  },
  {
    file: '06-thyroid-profile',
    title: 'THYROID PROFILE, SERUM',
    specimen: 'Serum',
    method: 'Chemiluminescent Immunoassay (CLIA)',
    rows: [
      {
        name: 'TSH (Ultrasensitive)',
        value: 5.9,
        unit: 'uIU/mL',
        low: 0.27,
        high: 4.2,
        note: 'Raised while T3 and T4 remain normal - the pattern of subclinical hypothyroidism. It is common alongside type 2 diabetes and is usually confirmed on a repeat sample before any treatment is started.',
      },
      { name: 'Total T3 (Triiodothyronine)', value: 1.12, unit: 'ng/mL', low: 0.8, high: 2.0 },
      { name: 'Total T4 (Thyroxine)', value: 7.6, unit: 'ug/dL', low: 5.1, high: 14.1 },
    ],
  },
  {
    file: '07-complete-blood-count-cbc',
    title: 'COMPLETE BLOOD COUNT (CBC)',
    specimen: 'EDTA Whole Blood',
    method: 'Electrical impedance / Flow cytometry | Microscopy',
    groups: [
      {
        heading: 'Primary',
        rows: [
          {
            name: 'Haemoglobin (Hb)',
            value: 12.6,
            unit: 'g/dL',
            low: 13.0,
            high: 17.0,
            note: 'Mildly below the range for an adult male. The red cells are of normal size, which points away from simple iron deficiency and fits the low B12 reported separately.',
          },
          { name: 'Total RBC Count', value: 4.62, unit: 'mill/cumm', low: 4.5, high: 5.5 },
          { name: 'Total WBC Count', value: 7800, unit: '/cumm', low: 4000, high: 11000 },
          { name: 'Platelet Count', value: 245000, unit: '/cumm', low: 150000, high: 450000 },
          {
            name: 'PCV / Haematocrit',
            value: 39.2,
            unit: '%',
            low: 40,
            high: 50,
            note: 'Marginally low, tracking the haemoglobin.',
          },
        ],
      },
      {
        heading: 'Red cell indices',
        rows: [
          { name: 'MCV', value: 85.2, unit: 'fL', low: 83, high: 101 },
          { name: 'MCH', value: 27.4, unit: 'pg', low: 27, high: 32 },
          { name: 'MCHC', value: 32.1, unit: 'g/dL', low: 31.5, high: 34.5 },
          { name: 'RDW-CV', value: 14.2, unit: '%', low: 11.6, high: 14.6 },
        ],
      },
      {
        heading: 'Differential count',
        rows: [
          { name: 'Neutrophils', value: 62, unit: '%', low: 40, high: 80 },
          { name: 'Lymphocytes', value: 28, unit: '%', low: 20, high: 40 },
          { name: 'Monocytes', value: 6, unit: '%', low: 2, high: 10 },
          { name: 'Eosinophils', value: 3, unit: '%', low: 1, high: 6 },
          { name: 'Basophils', value: 1, unit: '%', low: 0, high: 2 },
        ],
      },
    ],
  },
  {
    file: '08-serum-electrolytes',
    title: 'SERUM ELECTROLYTES',
    specimen: 'Serum',
    method: 'Ion Selective Electrode (ISE), indirect',
    rows: [
      { name: 'Sodium (Na+)', value: 138, unit: 'mmol/L', low: 135, high: 145 },
      { name: 'Potassium (K+)', value: 4.2, unit: 'mmol/L', low: 3.5, high: 5.1 },
      { name: 'Chloride (Cl-)', value: 101, unit: 'mmol/L', low: 98, high: 107 },
      { name: 'Bicarbonate (HCO3-)', value: 24, unit: 'mmol/L', low: 22, high: 29 },
    ],
  },
  {
    file: '09-vitamin-d',
    title: 'VITAMIN D, 25-HYDROXY (TOTAL)',
    specimen: 'Serum',
    method: 'Chemiluminescent Immunoassay (CLIA)',
    rows: [
      {
        name: '25-OH Vitamin D, Total',
        value: 17.4,
        unit: 'ng/mL',
        low: 30,
        high: 100,
        ref: '30 - 100 (sufficient)',
        note: 'Deficient. Below 20 ng/mL is read as deficiency, 20-29 ng/mL as insufficiency, and 30 ng/mL or above as sufficient.',
      },
    ],
  },
  {
    file: '10-vitamin-b12',
    title: 'VITAMIN B12 (CYANOCOBALAMIN), SERUM',
    specimen: 'Serum',
    method: 'Chemiluminescent Immunoassay (CLIA)',
    rows: [
      {
        name: 'Vitamin B12',
        value: 174,
        unit: 'pg/mL',
        low: 211,
        high: 911,
        note: 'Below the reference range. Long-term metformin reduces B12 absorption, so this is a recognised finding in someone treated for diabetes and is worth reviewing alongside the mildly low haemoglobin.',
      },
    ],
  },
];

/** Rows in display order, whether the panel is flat or grouped. */
const allRows = (panel) => panel.groups?.flatMap((g) => g.rows) ?? panel.rows;

function buildPdf(panel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: `${panel.title} - sample report` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // What a page break needs to know to rebuild itself: which report this is,
    // and whether it interrupted the results table.
    const ctx = { panel, page: 1, inTable: true };

    watermark(doc);
    letterhead(doc);
    patientBlock(doc, panel);
    reportTitle(doc, panel);
    tableHeader(doc);

    if (panel.groups) {
      for (const g of panel.groups) {
        if (g.heading) groupHeading(doc, ctx, g.heading);
        for (const r of g.rows) resultRow(doc, ctx, r);
      }
    } else {
      for (const r of panel.rows) resultRow(doc, ctx, r);
    }

    summary(doc, ctx, allRows(panel));
    pageFooter(doc, { last: true });
    doc.end();
  });
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const panel of PANELS) {
    const buf = await buildPdf(panel);
    const file = path.join(OUT_DIR, `${panel.file}.pdf`);
    await fs.writeFile(file, buf);

    const rows = allRows(panel);
    const abnormal = rows.filter((r) => flagFor(r) !== 'normal').length;
    const kb = (buf.length / 1024).toFixed(0);
    console.log(
      `${panel.file}.pdf`.padEnd(34) +
        `${rows.length} rows, ${abnormal} flagged`.padEnd(24) +
        `${kb} KB`,
    );
  }

  console.log(`\n${PANELS.length} reports written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
