import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { PRACTICE_TYPE } from './Practice.js';

/**
 * A practice asking to exist.
 *
 * ---- Why this is not a Practice ----------------------------------------
 *
 * A Practice is a tenant. The moment one exists, capability resolution,
 * billing, enrolment scoping and the audit trail all have something to point
 * at — and an unreviewed row means somebody who filled in a web form is a
 * tenant on this platform.
 *
 * So an application is a different thing with a different lifecycle. Nothing
 * here grants anything. Approving it calls [services/provisionPractice.js],
 * which is the same path an operator uses by hand, and the practice that
 * results is the first moment a tenant exists.
 *
 * ---- The states, and the ones deliberately absent ------------------------
 *
 * `submitted` → an operator opens it → `under_review` → one of three
 * decisions. `more_info` goes back to the applicant and returns to
 * `submitted` when they answer.
 *
 * There is no `draft`: an unfinished form lives in the browser, and making it
 * a server row would mean an applicant account to own it — a second identity
 * system for people who are not customers yet.
 *
 * There is no `provisioning` or `active` either. Provisioning is one call, not
 * a state to sit in, and "active" is a fact about the Practice that results —
 * `Practice.status` already answers it. An application that carries its own
 * copy is a second answer that goes stale.
 */
export const APPLICATION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  MORE_INFO: 'more_info',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/** The ones an operator may still act on. */
export const OPEN_STATUSES = Object.freeze([
  APPLICATION_STATUS.SUBMITTED,
  APPLICATION_STATUS.UNDER_REVIEW,
  APPLICATION_STATUS.MORE_INFO,
]);

const reviewEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    /// Who decided. Null for the applicant's own actions — they have no
    /// account, and recording one for them would be inventing an actor.
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
    adminEmail: { type: String, default: null },
    /// Required by the route for every decision. A rejection with no stated
    /// reason is one nobody can review and the applicant cannot answer.
    note: { type: String, trim: true, maxlength: 1000, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const practiceApplicationSchema = new mongoose.Schema(
  {
    /**
     * What the applicant quotes to see their own status.
     *
     * They have no account, so this is the only thing that identifies the
     * application to them. Long and random rather than sequential: a
     * guessable reference would let anybody read a stranger's contact details
     * and licence number by counting.
     */
    reference: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(9).toString('base64url'),
    },

    status: {
      type: String,
      enum: Object.values(APPLICATION_STATUS),
      default: APPLICATION_STATUS.SUBMITTED,
      index: true,
    },

    // ---- what they are asking for ----------------------------------------
    practiceName: { type: String, required: true, trim: true, maxlength: 160 },
    practiceType: { type: String, enum: Object.values(PRACTICE_TYPE), default: null },
    specialty: { type: String, trim: true, maxlength: 80, default: null },

    addressLine: { type: String, trim: true, maxlength: 200, default: null },
    city: { type: String, trim: true, maxlength: 80, default: null },
    state: { type: String, trim: true, maxlength: 80, default: null },
    postalCode: { type: String, trim: true, maxlength: 12, default: null },

    // ---- who is asking ----------------------------------------------------
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    contactEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },

    /**
     * Whether that address has been shown to reach somebody.
     *
     * ---- Why it is confirmed after submitting, not before -------------------
     *
     * The phone is proved first because it becomes the sign-in for the practice
     * — nothing is created until it is. The email is different: it is where the
     * decision goes, and the decision is days away. Making an applicant leave a
     * part-filled form to fetch a code from an inbox is friction paid at the
     * worst moment for a check that matters later.
     *
     * So one email goes out on submission carrying both the reference and the
     * confirmation. It has to be sent anyway — the reference is otherwise shown
     * once on a screen somebody closes — and asking it to do a second job costs
     * nothing.
     *
     * Null is not a failure. An operator reviewing an application sees whether
     * the address answered, which is exactly the signal worth having: an
     * unconfirmed address means a decision that will not arrive, and they can
     * chase the phone number instead of writing into the dark.
     */
    contactEmailVerifiedAt: { type: Date, default: null },

    /**
     * The link's secret, hashed.
     *
     * Stored the way a password reset is, for the same reason: a leaked
     * collection must not contain anything that can be replayed. It is also
     * never returned by `toApplicant()` — the applicant has the token in their
     * inbox already, and the status page must not hand it to anybody who knows
     * a reference.
     */
    emailTokenHash: { type: String, default: null, select: false },
    emailTokenExpiresAt: { type: Date, default: null },

    /**
     * Proved before the application is written, never after.
     *
     * The applicant answers a code sent to this number, and the submission
     * carries the token that proves it. An unproved number is how one person
     * files a hundred applications naming numbers that are not theirs.
     */
    contactPhone: { type: String, required: true, trim: true, index: true },
    phoneVerifiedAt: { type: Date, required: true },

    // ---- what a reviewer checks -------------------------------------------
    registrationNo: { type: String, trim: true, maxlength: 60, default: null },
    doctorName: { type: String, trim: true, maxlength: 120, default: null },
    doctorRegistrationNo: { type: String, trim: true, maxlength: 60, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },

    /**
     * What the practice became, once approved.
     *
     * Null until then, and the only link between the two. An application that
     * copied the practice's status would be a second answer to a question
     * `Practice.status` already answers.
     */
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', default: null },

    /// Who is looking at it. Advisory — it stops two operators reviewing the
    /// same application, and does not stop a third from deciding.
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
    reviewerEmail: { type: String, default: null },

    /**
     * Every decision, in order, kept on the row.
     *
     * The admin audit log records these too and is the authority. This copy
     * exists because the applicant has to be able to read "what did you ask me
     * for" without being given access to the platform's audit trail.
     */
    history: { type: [reviewEventSchema], default: [] },

    ip: { type: String, default: null },
  },
  { timestamps: true },
);

/// "The queue", newest first — the only list an operator ever asks for.
practiceApplicationSchema.index({ status: 1, createdAt: -1 });

/** What the applicant may see: their own submission and where it has got to. */
practiceApplicationSchema.methods.toApplicant = function toApplicant() {
  return {
    reference: this.reference,
    status: this.status,
    practiceName: this.practiceName,
    contactName: this.contactName,
    contactEmail: this.contactEmail,
    // Whether it answered, never the token that would prove it.
    contactEmailVerified: Boolean(this.contactEmailVerifiedAt),
    contactPhone: this.contactPhone,
    submittedOn: this.createdAt,
    /**
     * The last thing an operator said, and nothing else from the history.
     *
     * "More information required" is useless without what was asked for, and
     * a rejection without a reason is a wall. The rest of the trail — who
     * opened it, when, which operator — is the platform's business.
     */
    latestNote:
      [...this.history].reverse().find((h) => h.note)?.note ?? null,
    decidedOn:
      this.status === APPLICATION_STATUS.APPROVED || this.status === APPLICATION_STATUS.REJECTED
        ? this.history[this.history.length - 1]?.at ?? null
        : null,
  };
};

export const PracticeApplication = mongoose.model(
  'PracticeApplication',
  practiceApplicationSchema,
);
