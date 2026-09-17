import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';

/**
 * Direct messages — retired.
 *
 * One thread per patient with "the clinic", carrying no practice and no
 * enrolment. With two practices caring for one patient, the second practice
 * read, and answered into, the first one's thread (verification V-02).
 *
 * Care chat replaced it — one conversation per enrolment, see
 * models/ChatSession.js and services/conversationPractice.js — and no build of
 * the app or the operator console calls these routes any more.
 *
 * Retired rather than repaired: a second, weaker copy of care chat is a second
 * thing to keep isolated, and nothing uses it. The collection is left exactly as
 * it is — those messages are part of patients' records — and every route answers
 * 410 Gone, so a client still asking learns the conversation moved instead of
 * being shown an empty thread.
 */
const router = Router();

router.use(requireAuth);

router.all('*', (req, res, next) => {
  next(new AppError(410, 'GONE', 'Messages with the clinic are now in the care conversation.'));
});

export default router;
