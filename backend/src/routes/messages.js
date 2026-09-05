import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireClinician, resolvePatientScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { DirectMessage } from '../models/DirectMessage.js';
import { User, ROLES } from '../models/User.js';
import { recordWindow } from '../middleware/authorise.js';

const router = Router();
router.use(requireAuth);

const bodySchema = z.object({ content: z.string().trim().min(1).max(4000) });

function serialise(m) {
  const sender = m.sender && typeof m.sender === 'object' && m.sender.name ? m.sender : null;
  return {
    id: m._id,
    senderRole: m.senderRole,
    senderName: sender?.name ?? null,
    content: m.content,
    createdAt: m.createdAt,
  };
}

// ---- Patient's own thread with the clinic --------------------------------

router.get(
  '/',
  audit('read', 'DirectMessage'),
  asyncHandler(async (req, res) => {
    if (req.user.role !== ROLES.PATIENT) {
      // Clinicians must specify which patient (see /threads and /patient/:id).
      return res.json({ items: [] });
    }
    const items = await DirectMessage.find({ patient: req.user._id })
      .sort({ createdAt: 1 })
      .populate('sender', 'name')
      .lean();

    // Opening the thread clears the patient's unread clinic messages.
    await DirectMessage.updateMany(
      { patient: req.user._id, senderRole: { $ne: 'patient' }, readByPatient: false },
      { readByPatient: true },
    );

    res.json({ items: items.map(serialise) });
  }),
);

router.post(
  '/',
  validate({ body: bodySchema }),
  audit('create', 'DirectMessage'),
  asyncHandler(async (req, res) => {
    if (req.user.role !== ROLES.PATIENT) throw notFound('Use the clinician endpoint to message a patient');
    const message = await DirectMessage.create({
      patient: req.user._id,
      sender: req.user._id,
      senderRole: 'patient',
      content: req.body.content,
      readByPatient: true,
    });
    await message.populate('sender', 'name');
    res.status(201).json({ message: serialise(message) });
  }),
);

/** Patient's unread count (clinic messages they have not opened). */
router.get(
  '/unread',
  asyncHandler(async (req, res) => {
    if (req.user.role !== ROLES.PATIENT) return res.json({ count: 0 });
    const count = await DirectMessage.countDocuments({
      patient: req.user._id,
      senderRole: { $ne: 'patient' },
      readByPatient: false,
    });
    res.json({ count });
  }),
);

// ---- Clinician view ------------------------------------------------------

/** Inbox: every patient the clinic has a conversation with, newest first. */
router.get(
  '/threads',
  requireClinician,
  asyncHandler(async (req, res) => {
    const threads = await DirectMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$patient',
          lastMessage: { $first: '$content' },
          lastAt: { $first: '$createdAt' },
          lastSenderRole: { $first: '$senderRole' },
          unread: {
            $sum: { $cond: [{ $and: [{ $eq: ['$senderRole', 'patient'] }, { $eq: ['$readByClinician', false] }] }, 1, 0] },
          },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: 200 },
    ]);

    const ids = threads.map((t) => t._id);
    const patients = await User.find({ _id: { $in: ids } }).select('name phone').lean();
    const map = new Map(patients.map((p) => [p._id.toString(), p]));

    res.json({
      items: threads.map((t) => ({
        patientId: t._id,
        patientName: map.get(t._id.toString())?.name ?? null,
        patientPhone: map.get(t._id.toString())?.phone ?? null,
        lastMessage: t.lastMessage,
        lastAt: t.lastAt,
        lastSenderRole: t.lastSenderRole,
        unread: t.unread,
      })),
    });
  }),
);

router.get(
  '/patient/:patientId',
  requireClinician,
  resolvePatientScope,
  audit('read', 'DirectMessage'),
  asyncHandler(async (req, res) => {
    const items = await DirectMessage.find({
      patient: req.patientId,
      ...recordWindow(req, 'createdAt'),
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'name')
      .lean();

    await DirectMessage.updateMany(
      { patient: req.patientId, senderRole: 'patient', readByClinician: false },
      { readByClinician: true },
    );

    res.json({
      patient: req.patientUser
        ? { id: req.patientUser._id, name: req.patientUser.name, phone: req.patientUser.phone }
        : null,
      items: items.map(serialise),
    });
  }),
);

router.post(
  '/patient/:patientId',
  requireClinician,
  resolvePatientScope,
  validate({ body: bodySchema }),
  audit('create', 'DirectMessage'),
  asyncHandler(async (req, res) => {
    const message = await DirectMessage.create({
      patient: req.patientId,
      sender: req.user._id,
      senderRole: req.user.role, // 'doctor' or 'staff'
      content: req.body.content,
      readByClinician: true,
    });
    await message.populate('sender', 'name');
    res.status(201).json({ message: serialise(message) });
  }),
);

export default router;
