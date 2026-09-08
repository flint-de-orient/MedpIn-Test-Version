import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { env } from '../config/env.js';
import { identitySnapshot } from './clinicIdentity.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { Prescription } from '../models/Prescription.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { User } from '../models/User.js';
import { clinicEmergencyPhone } from './clinicContact.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// The clinic is in India; render every date/time in its wall-clock time so a
// server running in UTC does not print a prescription "issued" 5.5 hours early.
const fmt = (d, f) => dayjs(d).tz(env.CLINIC_TZ).format(f);

const TEAL = '#0f766e';
const SLATE = '#475569';
const INK = '#0f172a';
const LINE = '#e2e8f0';
const WASH = '#f1f5f9';

// The prescription is a PATIENT-facing document, so the doctor's shorthand is
// spelled out. Mirrors mobile/.../medications/domain/med_shorthand.dart.
const FREQ_PLAIN = {
  OD: 'Once a day',
  BD: 'Twice a day',
  TDS: 'Three times a day',
  QID: 'Four times a day',
  EOD: 'Every other day',
  HS: 'At bedtime',
  PRN: 'As needed',
  STAT: 'Immediately (single dose)',
};
const MEAL_PLAIN = { before_meal: 'before food', after_meal: 'after food', with_meal: 'with food' };

/** "BD" + "after_meal" → "Twice a day, after food". Unknown codes pass through. */
function frequencyText(freq, relation) {
  const key = String(freq ?? '').trim().toUpperCase();
  const base = FREQ_PLAIN[key] ?? (freq ? String(freq) : '—');
  const meal = MEAL_PLAIN[relation];
  return meal ? `${base}, ${meal}` : base;
}

/**
 * Render a prescription to a PDF buffer (pdfkit — no headless browser). Laid out
 * as a single-doctor clinic letterhead: header, patient block, complaint,
 * diagnosis, the Rx medicines table, investigations, advice, follow-up, and a
 * signature block (image when the doctor has uploaded one, otherwise a line).
 */
export function buildPrescriptionPdf({ prescription: p, patient, doctor, profile, signatureImage, identity }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 48;
    const right = doc.page.width - M;
    const contentW = doc.page.width - M * 2;

    // --- Header -----------------------------------------------------------
    // The identity this prescription was issued under. `identity` is the
    // snapshot taken at issue; the env vars remain the last resort for rows
    // written before either existed.
    const clinicName = identity?.clinicName || env.CLINIC_NAME;
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(20).text(clinicName, M, M, { width: contentW });
    if (identity?.tagline) {
      doc.fillColor(SLATE).font('Helvetica').fontSize(9.5).text(identity.tagline, { width: contentW });
    }
    const doctorName = doctor?.name ?? identity?.doctorName ?? env.DOCTOR_DISPLAY_NAME;
    const credentials = [doctor?.qualifications, doctor?.specialty ?? 'Consultant Physician & Diabetologist']
      .filter(Boolean)
      .join(', ');
    doc.fillColor(SLATE).font('Helvetica').fontSize(10.5).text(`${doctorName}${credentials ? ` — ${credentials}` : ''}`, {
      width: contentW,
    });
    const clinicPhone = clinicEmergencyPhone();
    const contactBits = [
      // The doctor's own council number first — it is theirs, not the
      // practice's — then the practice's as the fallback for a clinic that
      // records it once rather than per doctor.
      doctor?.registrationNo || identity?.registrationNo
        ? `Reg. No: ${doctor?.registrationNo || identity.registrationNo}`
        : null,
      identity?.addressLine || null,
      // `clinicEmergencyPhone()` rather than a local placeholder test: this
      // used to ask `!includes('0000')`, which is the same question with a
      // weaker answer — it prints +91-1111111111, and it prints a four-digit
      // number. One rule, in one place, for the one number a patient rings.
      identity?.phone ? `Ph: ${identity.phone}` : clinicPhone ? `Ph: ${clinicPhone}` : null,
    ].filter(Boolean);
    if (contactBits.length) doc.fontSize(9.5).fillColor(SLATE).text(contactBits.join('   ·   '), { width: contentW });

    doc.moveDown(0.4);
    let y = doc.y;
    doc.moveTo(M, y).lineTo(right, y).lineWidth(2).strokeColor(TEAL).stroke();
    y += 12;

    // --- Patient block ----------------------------------------------------
    const age = patient?.dateOfBirth ? dayjs().diff(dayjs(patient.dateOfBirth), 'year') : null;
    const demo = [age != null ? `${age} yrs` : null, patient?.gender && patient.gender !== 'undisclosed' ? cap(patient.gender) : null]
      .filter(Boolean)
      .join(' · ');

    const boxTop = y;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(patient?.name ?? '—', M, y + 2, { width: contentW * 0.62 });
    let ly = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(SLATE);
    if (demo) { doc.text(demo, M, ly, { width: contentW * 0.62 }); ly = doc.y; }
    if (patient?.phone) { doc.text(patient.phone, M, ly, { width: contentW * 0.62 }); ly = doc.y; }
    if (profile?.address) { doc.text(profile.address, M, ly, { width: contentW * 0.62 }); ly = doc.y; }

    // Right column: reference + issue date/time.
    doc.font('Helvetica').fontSize(10).fillColor(SLATE);
    doc.text(`Ref: ${p.referenceNo}`, M + contentW * 0.62, boxTop + 2, { width: contentW * 0.38, align: 'right' });
    doc.text(fmt(p.issuedOn, 'DD MMM YYYY, hh:mm A'), { width: contentW * 0.38, align: 'right' });

    y = Math.max(ly, doc.y) + 10;

    // --- Chief complaint --------------------------------------------------
    // The prescription's OWN snapshot only — no profile fallback — so the
    // consult's "show on prescription" checkbox genuinely controls whether it
    // prints (the complaint is still recorded on the profile either way).
    if (p.complaint) {
      y = labelledBlock(doc, 'Chief complaint', String(p.complaint), M, y, contentW);
    }

    // --- Diagnosis --------------------------------------------------------
    if (p.diagnosis?.length) {
      y = labelledBlock(doc, 'Diagnosis', p.diagnosis.map((d) => `•  ${d}`).join('\n'), M, y, contentW);
    }

    // --- Rx + medicines table --------------------------------------------
    // "Rx", not the ℞ glyph: U+211E is absent from the standard Helvetica
    // (WinAnsi) encoding pdfkit uses, so it would print blank.
    doc.font('Helvetica-Bold').fontSize(19).fillColor(TEAL).text('Rx', M, y);
    y = doc.y + 6;

    // No "Dose" column: the consult captures strength (shown under the name),
    // not a separate per-intake dose, so that column was always empty.
    const cols = [
      { title: 'Medicine', w: contentW * 0.5 },
      { title: 'Frequency', w: contentW * 0.3 },
      { title: 'Duration', w: contentW * 0.2 },
    ];
    // A prescription can legitimately carry no medicines — a visit that ends in
    // tests, diet advice or reassurance. Saying so in a sentence is honest;
    // printing the column headings over nothing looks like the document failed
    // to finish, and a patient handed that has no way to tell the difference.
    if ((p.items ?? []).length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(11)
        .fillColor(SLATE)
        .text('No medicines prescribed at this visit.', M, y, { width: contentW });
      y = doc.y;
    } else {
      y = tableHeader(doc, cols, M, y);
      for (const item of p.items ?? []) {
        y = ensureSpace(doc, y, 42, M, () => tableHeader(doc, cols, M, doc.page.margins.top));
        y = medicineRow(doc, cols, item, M, y);
      }
    }

    y += 10;

    // --- Investigations ---------------------------------------------------
    if (p.labTestsAdvised?.length) {
      y = ensureSpace(doc, y, 60, M);
      y = labelledBlock(doc, 'Investigations advised', p.labTestsAdvised.map((t) => `•  ${t}`).join('\n'), M, y, contentW);
    }

    // --- Advice -----------------------------------------------------------
    if (p.generalAdvice) {
      y = ensureSpace(doc, y, 60, M);
      y = labelledBlock(doc, 'Advice', p.generalAdvice, M, y, contentW);
    }

    // --- Follow-up --------------------------------------------------------
    if (p.followUpOn) {
      y = ensureSpace(doc, y, 50, M);
      y = labelledBlock(doc, 'Follow-up', fmt(p.followUpOn, 'DD MMM YYYY'), M, y, contentW);
    }

    // --- Signature + footer band -----------------------------------------
    // Flows right after the content (not pinned to the page bottom) so a short
    // prescription stays on ONE page. Only breaks to a new page if the ~92pt
    // band genuinely won't fit under the last section.
    y = ensureSpace(doc, y, 92, M);
    y += 22;

    const sigW = 190;
    const sigX = right - sigW;
    if (signatureImage) {
      try {
        doc.image(signatureImage, sigX + (sigW - 140) / 2, y, { fit: [140, 42] });
      } catch {
        // A bad image should never sink the whole prescription.
      }
    }
    const lineY = y + 46;
    doc.moveTo(sigX, lineY).lineTo(sigX + sigW, lineY).lineWidth(1).strokeColor(INK).stroke();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(doctorName, sigX, lineY + 4, { width: sigW, align: 'center' });
    if (credentials) {
      doc.font('Helvetica').fontSize(8).fillColor(SLATE).text(credentials, sigX, doc.y, { width: sigW, align: 'center' });
    }

    // Footer note on the left, level with the signature line.
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(SLATE)
      .text(
        `Valid${p.validUntil ? ` until ${fmt(p.validUntil, 'DD MMM YYYY')}` : ''}. ` +
          'Do not change any dose without consulting your doctor.',
        M,
        lineY + 4,
        { width: contentW * 0.48 },
      );

    doc.end();
  });
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A titled block: small teal uppercase label over a light-washed body box. */
function labelledBlock(doc, title, body, x, y, w) {
  // Measure first so the whole block (label + washed box + text) moves to a new
  // page as one unit — otherwise the box could print on one page and its text
  // spill onto the next.
  doc.font('Helvetica').fontSize(10.5);
  const h = doc.heightOfString(body, { width: w - 20 });
  const pageBottom = doc.page.height - 48;
  if (y + 12 + 3 + (h + 16) + 10 > pageBottom) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEAL).text(title.toUpperCase(), x, y, { characterSpacing: 0.5 });
  const ty = doc.y + 3;
  doc.rect(x, ty, w, h + 16).fillColor(WASH).fill();
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(body, x + 10, ty + 8, { width: w - 20 });
  return ty + h + 16 + 10;
}

function tableHeader(doc, cols, x, y) {
  doc.rect(x, y, cols.reduce((a, c) => a + c.w, 0), 22).fillColor(WASH).fill();
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SLATE);
  for (const c of cols) {
    doc.text(c.title.toUpperCase(), cx + 6, y + 7, { width: c.w - 12, characterSpacing: 0.4 });
    cx += c.w;
  }
  return y + 22;
}

function medicineRow(doc, cols, item, x, y) {
  const nameW = cols[0].w - 12;
  const freqW = cols[1].w - 12;
  const durW = cols[2].w - 12;

  // Medicine cell: bold name over a muted sub-line (strength · dose · notes).
  const sub = [item.strength, item.dose, item.instructions].filter(Boolean).join(' · ');
  doc.font('Helvetica-Bold').fontSize(10.5);
  const nameH = doc.heightOfString(item.name ?? '—', { width: nameW });
  let subH = 0;
  if (sub) {
    doc.font('Helvetica').fontSize(9);
    subH = doc.heightOfString(sub, { width: nameW }) + 2;
  }

  // Frequency in plain English — this is a patient-facing document.
  const freq = frequencyText(item.frequency, item.relationToMeal);
  doc.font('Helvetica').fontSize(9.5);
  const freqH = doc.heightOfString(freq, { width: freqW });

  const rowH = Math.max(nameH + subH, freqH, 14) + 12;

  let cx = x;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(item.name ?? '—', cx + 6, y + 6, { width: nameW });
  if (sub) doc.font('Helvetica').fontSize(9).fillColor(SLATE).text(sub, cx + 6, y + 6 + nameH + 1, { width: nameW });
  cx += cols[0].w;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(freq, cx + 6, y + 6, { width: freqW });
  cx += cols[1].w;
  doc.fontSize(10).fillColor(INK).text(item.durationDays ? `${item.durationDays} days` : '—', cx + 6, y + 6, { width: durW });

  const totalW = cols.reduce((a, c) => a + c.w, 0);
  doc.moveTo(x, y + rowH).lineTo(x + totalW, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
  return y + rowH;
}

/** Add a page when `need` points won't fit; optionally redraw a table header. */
function ensureSpace(doc, y, need, x, onNewPage) {
  const bottom = doc.page.height - 48;
  if (y + need <= bottom) return y;
  doc.addPage();
  return onNewPage ? onNewPage() : doc.page.margins.top;
}

/**
 * Return the stored prescription PDF, generating and caching it as a
 * `prescription_pdf` MediaAsset (owned by the patient) on first request.
 * Prescriptions are immutable, so the document only ever needs building once.
 * Returns `{ asset, filePath }`.
 */
export async function ensurePrescriptionPdf(prescription) {
  if (prescription.pdfFile) {
    const existing = await MediaAsset.findOne({ _id: prescription.pdfFile, deletedAt: null });
    if (existing) return { asset: existing, filePath: await assetPath(existing) };
  }

  const [patient, doctor, profile] = await Promise.all([
    User.findById(prescription.patient).select('name phone dateOfBirth gender').lean(),
    prescription.doctor
      ? User.findById(prescription.doctor).select('name qualifications specialty registrationNo signatureAssetId').lean()
      : null,
    PatientProfile.findOne({ user: prescription.patient }).select('address chiefComplaint').lean(),
  ]);

  const signatureImage = await loadSignature(doctor?.signatureAssetId);

  // Taken once, at first render, and kept. A prescription re-opened in a year
  // must print the letterhead it was issued under, not whatever the clinic is
  // called by then.
  //
  // A prescription does not record which location it was written at, so this
  // resolves the practice's primary one. When it does carry a location, that
  // id is what belongs here and nothing else changes.
  const existingLetterhead = prescription.letterhead?.clinicName ? prescription.letterhead : null;
  const identity = existingLetterhead ?? (await identitySnapshot(null));
  const letterheadToPersist = existingLetterhead
    ? null
    : {
        clinicName: identity.clinicName,
        tagline: identity.tagline,
        doctorName: identity.doctorName,
        registrationNo: identity.registrationNo,
        phone: identity.phone,
        addressLine: identity.addressLine,
        city: identity.city,
      };

  const buffer = await buildPrescriptionPdf({
    prescription,
    patient,
    doctor,
    profile,
    signatureImage,
    identity,
  });

  const root = await uploadRoot();
  const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.pdf`;
  const filePath = path.join(root, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);

  const asset = await MediaAsset.create({
    owner: prescription.patient,
    uploadedBy: prescription.doctor ?? prescription.patient,
    kind: 'prescription_pdf',
    storageKey: key,
    originalName: `${prescription.referenceNo}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: buffer.length,
  });
  await Prescription.updateOne(
    { _id: prescription._id },
    // Written in the same update as the file it describes, so a prescription
    // can never hold a PDF rendered from a letterhead it did not record.
    { pdfFile: asset._id, ...(letterheadToPersist ? { letterhead: letterheadToPersist } : {}) },
  );
  return { asset, filePath };
}

async function uploadRoot() {
  const dir = path.resolve(process.cwd(), env.UPLOAD_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function assetPath(asset) {
  return path.join(await uploadRoot(), asset.storageKey);
}

/** The doctor's signature image bytes, if they have uploaded one. */
async function loadSignature(signatureAssetId) {
  if (!signatureAssetId) return null;
  const asset = await MediaAsset.findOne({ _id: signatureAssetId, deletedAt: null }).lean();
  if (!asset) return null;
  try {
    const raw = await fs.readFile(path.join(await uploadRoot(), asset.storageKey));
    // pdfkit embeds only JPEG/PNG, but uploads are stored as WebP — convert, and
    // keep any transparency so a cut-out signature overlays the line cleanly.
    return await sharp(raw).png().toBuffer();
  } catch {
    return null;
  }
}
