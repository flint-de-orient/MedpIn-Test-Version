import { Router } from 'express';
import mongoose from 'mongoose';

import { isProd } from '../config/env.js';
import { logger } from '../config/logger.js';

import authRoutes from './auth.js';
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
import appVersionRoutes from './appVersion.js';
import dashboardRoutes from './dashboard.js';
import doctorRoutes from './doctor.js';
import departmentRoutes from './departments.js';
import practiceRoutes from './practices.js';
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
    ...(detail ? { detail } : {}),
    uptime: Math.round(process.uptime()),
    version: '1.0.0',
  });
});

// Before the authenticated routes and outside them: a client too old to sign
// in is exactly the client this has to be able to answer.
router.use('/app', appVersionRoutes);
router.use('/auth', authRoutes);
router.use('/chat', chatRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/clinics', clinicRoutes);
router.use('/messages', messageRoutes);
router.use('/doctor', doctorRoutes);
// Specialties and who practises in them. Its own router: `doctor.js` is
// already two thousand lines, and a subject with its own models earns one.
router.use('/departments', departmentRoutes);
// The practice above the clinics. Separate from `clinics.js`, which is about
// places and their opening hours; this is about who the practice is.
router.use('/practices', practiceRoutes);
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
