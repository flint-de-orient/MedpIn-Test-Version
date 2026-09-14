import { Router } from 'express';
import mongoose from 'mongoose';

import { isProd } from '../config/env.js';
import { logger } from '../config/logger.js';
import { readinessSummary } from '../config/readiness.js';

import authRoutes from './auth.js';
import applicationRoutes from './applications.js';
import chatRoutes from './chat.js';
import trackingRoutes from './tracking.js';
import medicationRoutes from './medications.js';
import foodLogRoutes from './foodlog.js';
import labTestRoutes from './labtests.js';
import medicineBrandRoutes from './medicineBrands.js';
import careRoutes from './care.js';
import appointmentRoutes from './appointments.js';
import clinicRoutes from './clinics.js';
import messageRoutes from './messages.js';
import prescriptionRoutes from './prescriptions.js';
import brandRoutes from './brand.js';
import appVersionRoutes from './appVersion.js';
import dashboardRoutes from './dashboard.js';
import doctorRoutes from './doctor.js';
import chatSummaryRoutes from './chatSummaries.js';
import departmentRoutes from './departments.js';
import teamRoutes from './team.js';
import billingRoutes from './billing.js';
import practiceRoutes from './practices.js';
import adminRoutes from './admin.js';
import enrolmentRoutes from './enrolments.js';
import recordRoutes from './records.js';
import dieticianRoutes from './dietician.js';
import feedbackRoutes from './feedback.js';
import uploadRoutes from './uploads.js';

const router = Router();

/**
 * Liveness + readiness.
 *
 * `readyState` alone describes the socket, not whether this process can
 * actually use the database. A deployment whose credentials lack rights on the
 * database keeps a happily open connection and reported `db: "connected"` while
 * every single query failed â€” a green health check sitting on top of a server
 * that could not serve a login. So the check issues a real read, and answers
 * 503 when the database is reachable but unusable, which is what a load
 * balancer or uptime monitor needs to see.
 */
router.get('/health', async (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  let db = states[mongoose.connection.readyState] ?? 'unknown';
  let detail;

  if (mongoose.connection.readyState === 1) {
    try {
      // Deliberately not `ping`: that command succeeds without authentication
      // and would have reported this exact outage as healthy. Listing
      // collections needs genuine read rights on the database.
      await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    } catch (err) {
      db = err?.codeName === 'Unauthorized' || err?.code === 13 ? 'unauthorized' : 'error';
      // The coarse state is safe to publish; the driver's message can name
      // internals, so it stays out of production responses and in the log.
      if (!isProd) detail = err?.codeName ?? err?.message;
      logger.error({ err }, 'health check: database unusable');
    }
  }

  const healthy = db === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db,
    /*
     * Whether this deployment is configured to do what it claims.
     *
     * Counts only, never reasons — a deploy script needs to know something is
     * wrong without authenticating, and "payments: no webhook secret" tells a
     * reader exactly which forged request to send. The detail is behind the
     * admin guard at /admin/readiness.
     *
     * Deliberately not part of `status`: a missing SMTP host is not a reason
     * to fail a load balancer's health probe and take the clinic offline.
     * Liveness and readiness are different questions and this answers both,
     * separately.
     */
    ...readinessSummary(),
    ...(detail ? { detail } : {}),
    uptime: Math.round(process.uptime()),
    version: '1.0.0',
  });
});

// Before the authenticated routes and outside them: a client too old to sign
// in is exactly the client this has to be able to answer.
// Public: Razorpay's checkout fetches the logo from the customer's phone with
// no session, and there is nothing here that is not already on every app icon.
router.use('/brand', brandRoutes);
router.use('/app', appVersionRoutes);
router.use('/auth', authRoutes);
/*
 * Unauthenticated, like `/auth` above it and for the same reason: nobody
 * filling in a practice application has an account yet. Everything it does to
 * protect itself is something other than a session — see the file.
 */
router.use('/applications', applicationRoutes);
router.use('/chat', chatRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/clinics', clinicRoutes);
router.use('/messages', messageRoutes);
router.use('/doctor', doctorRoutes);
// A day of each patient's conversation, for the clinicians it did not interrupt.
router.use('/chat-summaries', chatSummaryRoutes);
// Specialties and who practises in them. Its own router: `doctor.js` is
// already two thousand lines, and a subject with its own models earns one.
router.use('/departments', departmentRoutes);
router.use('/team', teamRoutes);
// Outside every auth guard: Razorpay posts with no session, and the signature
// is the authentication. See routes/billing.js.
router.use('/billing', billingRoutes);
// The practice above the clinics. Separate from `clinics.js`, which is about
// places and their opening hours; this is about who the practice is.
router.use('/practices', practiceRoutes);

// The platform's own surface. Its own login, its own audit log, no clinical
// data — and a 404 rather than a 401 when ADMIN_JWT_SECRET is unset, so a
// deployment not running the panel does not advertise that it could.
router.use('/admin', adminRoutes);

// Confirming a consent code, reading the consent trail, and the patient
// withdrawing a practice's access.
router.use('/enrolments', enrolmentRoutes);

// Ending a clinical record, and moving a dependant to their own login. Both
// change what the record says about a person, so neither is a delete.
router.use('/records', recordRoutes);
router.use('/dietician', dieticianRoutes);
router.use('/feedback', feedbackRoutes);
// Prescribing aid: brand -> composition, for autocomplete and the strength check.
router.use('/medicine-brands', medicineBrandRoutes);
router.use('/uploads', uploadRoutes);

// Patient-scoped clinical data. `:patientId` is 'me' for patients, or a real
// id for clinicians â€” resolvePatientScope enforces which is allowed.
router.use('/patients/:patientId', trackingRoutes);
router.use('/patients/:patientId/medications', medicationRoutes);
router.use('/patients/:patientId/food-log', foodLogRoutes);
router.use('/patients/:patientId/lab-tests', labTestRoutes);
router.use('/patients/:patientId', careRoutes);
router.use('/patients/:patientId/prescriptions', prescriptionRoutes);
router.use('/patients/:patientId/dashboard', dashboardRoutes);

export default router;
