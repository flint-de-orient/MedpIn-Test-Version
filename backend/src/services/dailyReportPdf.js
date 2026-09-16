import PDFDocument from 'pdfkit';

import { inClinicTz, clinicDateTime } from '../utils/clinicTime.js';

/**
 * The daily summary, on paper.
 *
 * Drawn with pdfkit like the prescription (services/prescriptionPdf.js), in the
 * same palette, so a doctor holding both sees one practice's documents rather
 * than two products.
 *
 * ---- What is deliberately not on it ----------------------------------------
 *
 * No record ids, no reference numbers, no phone numbers or addresses, and no
 * author or keywords in the file's own metadata. The file is made to be passed
 * on through a phone's share sheet, and a summary forwarded to a colleague is
 * read by somebody who needs the clinical picture and nothing else. Every page
 * says it is confidential, because a PDF leaves the app with no context of its
 * own.
 */

const TEAL = '#0f766e';
const SLATE = '#475569';
const INK = '#0f172a';
const LINE = '#e2e8f0';
const WASH = '#f1f5f9';

const M = 48;

const fmt = (d, f) => inClinicTz(d).format(f);

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

/** "Metformin 500 mg — Twice a day, after food · 30 days". */
function medicineLine(it) {
  const head = [it.name, it.strength, it.dose].filter(Boolean).join(' ');
  const freq = it.frequency ? FREQ_PLAIN[String(it.frequency).trim().toUpperCase()] ?? it.frequency : null;
  const when = [freq, MEAL_PLAIN[it.relationToMeal]].filter(Boolean).join(', ');
  const tail = [when || null, it.durationDays ? `${it.durationDays} days` : null, it.instructions]
    .filter(Boolean)
    .join(' · ');
  return tail ? `${head} — ${tail}` : head;
}

function vitalsText(patient) {
  const lines = patient.vitals.map((v) => {
    const parts = [
      v.bloodPressure ? `BP ${v.bloodPressure} mmHg` : null,
      v.pulse ? `Pulse ${v.pulse}/min` : null,
      v.spo2 ? `SpO2 ${v.spo2}%` : null,
      v.weightKg ? `Weight ${v.weightKg} kg` : null,
      v.waistCm ? `Waist ${v.waistCm} cm` : null,
      v.temperatureC ? `Temp ${v.temperatureC} °C` : null,
    ].filter(Boolean);
    return parts.length ? `${fmt(v.at, 'hh:mm A')}  ${parts.join(' · ')}` : null;
  });
  const sugars = patient.glucose.map(
    (g) =>
      `${fmt(g.at, 'hh:mm A')}  Glucose ${g.valueMgDl} mg/dL${g.context && g.context !== 'random' ? ` (${g.context.replace('_', ' ')})` : ''}`,
  );
  return [...lines, ...sugars].filter(Boolean).join('\n');
}

/**
 * Render the report built by services/dailyReport.js.
 *
 * `compress` is off only in tests, which read the page text back out of the
 * file to prove what is and is not printed on it.
 */
export function buildDailyReportPdf(report, { compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: M,
      bufferPages: true,
      compress,
      // A title and nothing else. pdfkit's own producer line is harmless; an
      // author field would put a name in the file's metadata that nobody reads
      // and every indexer does.
      info: { Title: `Daily patient summary ${report.date}` },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentW = doc.page.width - M * 2;
    const bottom = () => doc.page.height - M - 24;

    // ---- Header ------------------------------------------------------------
    const practiceName = report.practice.name || 'Daily patient summary';
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text(practiceName, M, M, { width: contentW });
    if (report.practice.tagline) {
      doc.fillColor(SLATE).font('Helvetica').fontSize(9.5).text(report.practice.tagline, { width: contentW });
    }
    const credentials = [report.doctor.qualifications].filter(Boolean).join(', ');
    doc
      .fillColor(SLATE)
      .font('Helvetica')
      .fontSize(10.5)
      .text(`${report.doctor.name ?? ''}${credentials ? ` — ${credentials}` : ''}`, { width: contentW });

    doc.moveDown(0.4);
    let y = doc.y;
    doc.moveTo(M, y).lineTo(M + contentW, y).lineWidth(2).strokeColor(TEAL).stroke();
    y += 10;

    const day = clinicDateTime(report.date, '12:00');
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Daily patient summary', M, y, { width: contentW * 0.6 });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(SLATE)
      .text(day.format('dddd, DD MMM YYYY'), M + contentW * 0.6, y + 2, { width: contentW * 0.4, align: 'right' });
    y = doc.y + 4;
    const count = report.totals.patients;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(SLATE)
      .text(`${count} ${count === 1 ? 'patient' : 'patients'} seen`, M, y, { width: contentW });
    y = doc.y + 12;

    // ---- Nobody ------------------------------------------------------------
    if (!report.patients.length) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(11)
        .fillColor(SLATE)
        .text('No patients seen on this date.', M, y, { width: contentW });
      y = doc.y + 6;
    }

    // ---- Each patient ------------------------------------------------------
    report.patients.forEach((p, index) => {
      const need = 90;
      if (y + need > bottom()) {
        doc.addPage();
        y = M;
      }

      const demo = [p.age != null ? `${p.age} yrs` : null, p.sex].filter(Boolean).join(' · ');
      doc.rect(M, y, contentW, 26).fillColor(WASH).fill();
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(INK)
        .text(`${index + 1}. ${p.name}`, M + 8, y + 7, { width: contentW * 0.62 - 8, lineBreak: false, ellipsis: true });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(SLATE)
        .text([demo || null, p.seenAt ? fmt(p.seenAt, 'hh:mm A') : null].filter(Boolean).join('   '), M + contentW * 0.62, y + 8, {
          width: contentW * 0.38 - 8,
          align: 'right',
          lineBreak: false,
        });
      y += 32;

      const field = (label, body) => {
        if (!body) return;
        doc.font('Helvetica').fontSize(10);
        const h = doc.heightOfString(body, { width: contentW - 120 });
        if (y + h + 6 > bottom()) {
          doc.addPage();
          y = M;
        }
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEAL).text(label.toUpperCase(), M, y + 1, {
          width: 112,
          characterSpacing: 0.4,
        });
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(body, M + 120, y, { width: contentW - 120 });
        y = Math.max(doc.y, y + 12) + 5;
      };

      field(
        p.complaint?.source === 'appointment' ? 'Reason booked' : 'Complaint',
        p.complaint?.text ?? 'Not recorded',
      );
      field('Diagnosis', p.diagnosis.length ? p.diagnosis.join('; ') : 'Not recorded');
      field('Vitals', vitalsText(p) || 'None recorded this day');

      const rx = p.prescriptions
        .map((r) => {
          const meds = r.items.length ? r.items.map((it) => `•  ${medicineLine(it)}`).join('\n') : 'No medicines prescribed.';
          const notes = [
            r.source === 'scanned' ? 'Filed from a paper prescription.' : null,
            r.standing ? null : 'Since replaced by a later prescription.',
            r.investigations.length ? `Investigations: ${r.investigations.join(', ')}` : null,
          ].filter(Boolean);
          return [meds, ...notes].join('\n');
        })
        .join('\n\n');
      const voided =
        p.voidedPrescriptions > 0
          ? `${p.voidedPrescriptions === 1 ? 'A prescription' : `${p.voidedPrescriptions} prescriptions`} issued in error and voided — not shown.`
          : null;
      field('Prescription', [rx || 'None issued', voided].filter(Boolean).join('\n'));
      field('Advice', p.advice);
      field('Follow-up', p.followUpOn ? fmt(p.followUpOn, 'DD MMM YYYY') : 'None set');

      doc.moveTo(M, y).lineTo(M + contentW, y).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 10;
    });

    // ---- What "seen" means, once, at the end --------------------------------
    const note =
      'Listed: patients with a checked-in or completed appointment with this doctor on this date, ' +
      'or a prescription this doctor issued on it. Vitals are those recorded for the patient on this date.';
    doc.font('Helvetica').fontSize(8);
    if (y + doc.heightOfString(note, { width: contentW }) + 4 > bottom()) {
      doc.addPage();
      y = M;
    }
    doc.fillColor(SLATE).text(note, M, y + 4, { width: contentW });

    // ---- Footer on every page ------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Inside the bottom margin, where pdfkit would otherwise decide the text
      // has run off the page and start a blank one for it.
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - M + 8;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(SLATE)
        .text(
          `Confidential — identifiable patient information. Generated ${fmt(report.generatedAt, 'DD MMM YYYY, hh:mm A')}.`,
          M,
          fy,
          { width: contentW * 0.75, lineBreak: false },
        )
        .text(`Page ${i - range.start + 1} of ${range.count}`, M + contentW * 0.75, fy, {
          width: contentW * 0.25,
          align: 'right',
          lineBreak: false,
        });
    }

    doc.end();
  });
}
