import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireDoctor } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { practiceOf, noPractice } from '../middleware/practiceScope.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, badRequest } from '../middleware/errors.js';
import { PERMISSIONS } from '../models/Membership.js';
import { AuditLog } from '../models/AuditLog.js';
import { DATE_RE } from '../utils/clinicTime.js';
import { buildDailyReport, clinicToday } from '../services/dailyReport.js';
import { buildDailyReportPdf } from '../services/dailyReportPdf.js';

/**
 * Reports a doctor takes out of the app.
 *
 * Mounted at /doctor/reports, before the /doctor router, as the panels are — so
 * a report request is not first walked through the doctor router's own guards
 * on its way here.
 *
 * ---- Who may ask ------------------------------------------------------------
 *
 * A doctor, for their own day, at the practice the request is for. VIEW_PATIENT
 * because the report names patients and says what was wrong with them; the
 * doctor role because the day being summarised is a doctor's consultations. A
 * member of staff with no practice is refused by the role guard, one who works
 * at two must say which, and one whose practice is suspended is refused there
 * too — this router adds nothing to those rules and removes nothing from them.
 *
 * ---- Nothing is sent from here ----------------------------------------------
 *
 * The server builds the document and hands it to the doctor's phone. Where it
 * goes after that is the doctor's choice, made in the share sheet: WhatsApp is
 * one of the places a phone can send a file, and it is never a place this
 * server sends anything.
 */
const router = Router();
router.use(requireAuth, requireDoctor, requirePermission(PERMISSIONS.VIEW_PATIENT));

/**
 * What the doctor did with it, as the audit trail records it.
 *
 *   preview   the app showed it on screen (format=json)
 *   view      the PDF was opened on the phone
 *   download  the PDF was saved
 *   share     the PDF was handed to the share sheet
 *
 * Said by the app, which is the only side that knows. The server cannot see a
 * share sheet; what it can do is refuse to hand the file over without writing
 * down what it was asked for.
 */
const PURPOSES = ['view', 'download', 'share'];

router.get(
  '/daily',
  validate({
    query: z.object({
      date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
      format: z.enum(['pdf', 'json']).default('pdf'),
      purpose: z.enum(PURPOSES).default('download'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { format, purpose } = q(req);
    const today = clinicToday();
    const date = q(req).date ?? today;

    // A day that has not happened has nobody in it, and a report saying so
    // would read as a day with no patients. String order is date order here.
    if (date > today) throw badRequest('That date has not happened yet.');

    // Asked of the membership, never assumed. The role guard above has already
    // refused anybody with no practice on a platform that has practices; this
    // is the one left over — a platform with no memberships at all — and a
    // report scoped to no practice is not one to build.
    const practiceId = await practiceOf(req);
    if (!practiceId) throw noPractice();

    const { report, subjects } = await buildDailyReport({
      doctor: req.user,
      practiceId,
      date,
    });

    /*
     * Written before the document leaves, and awaited.
     *
     * Every other read in the app logs after the response and never fails the
     * request over it. This one hands identifiable patient data to a phone that
     * can forward it anywhere, so the order is the other way round: an export
     * that could not be recorded is not handed over.
     *
     * One row per patient named, so "who took my record out of the app" is
     * answerable from the patient's own trail; one row with no patient for a
     * day with nobody in it, so the attempt is still there.
     */
    const action = format === 'json' ? 'read' : purpose === 'share' ? 'share' : 'export';
    const meta = {
      report: 'daily',
      date,
      format,
      purpose: format === 'json' ? 'preview' : purpose,
      practice: String(practiceId),
      patients: subjects.length,
      method: req.method,
      path: '/doctor/reports/daily',
    };
    const base = {
      actor: req.user._id,
      actorRole: req.user.role,
      action,
      resource: 'DailyReport',
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 300),
      meta,
      at: new Date(),
    };
    await AuditLog.insertMany(
      subjects.length ? subjects.map((patient) => ({ ...base, subjectPatient: patient })) : [base],
    );

    if (format === 'json') {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ report });
    }

    const pdf = await buildDailyReportPdf(report);
    res.type('application/pdf');
    // A date and nothing else in the name: the file name is the first thing a
    // share sheet shows the next person, and a patient's name does not belong
    // in it.
    res.setHeader(
      'Content-Disposition',
      `${purpose === 'view' ? 'inline' : 'attachment'}; filename="daily-summary-${date}.pdf"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }),
);

export default router;
