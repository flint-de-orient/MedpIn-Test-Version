import mongoose from 'mongoose';

/**
 * What the platform administrator did, kept apart from the clinical log.
 *
 * ---- Why not the existing AuditLog ---------------------------------------
 *
 * `AuditLog` answers "who looked at this patient". It is scoped to a practice,
 * read by a practice, and one day exposed to a practice behind VIEW_AUDIT.
 *
 * Admin actions belong to none of those. "MedPin suspended Dr. Sen's practice"
 * is not Dr. Sen's record to read, and putting it in the same collection means
 * a practice-scoped audit viewer has to remember to exclude it — a filter that
 * works until somebody writes a query without it.
 *
 * Two collections; no filter to forget.
 *
 * ---- Every admin action, not the interesting ones ------------------------
 *
 * Including reads. An administrator listing every practice on the platform is
 * doing something worth a record, and "who looked" is the half of an audit
 * trail usually missing.
 */
const adminAuditLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlatformAdmin',
      required: true,
      index: true,
    },

    /// Kept as text as well as an id, so the entry still reads if the account
    /// is later removed. An audit line naming an ObjectId nobody can resolve
    /// records that something happened and not who did it.
    adminEmail: { type: String, required: true },

    action: { type: String, required: true, index: true },

    /// What it was done to — `Practice`, usually.
    resource: { type: String, default: null },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /// The practice affected, denormalised so "everything done to this
    /// practice" is one indexed query rather than a scan.
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', default: null, index: true },

    /// Why. Required in the route for anything destructive: a suspension with
    /// no stated reason is one nobody can review afterwards.
    reason: { type: String, trim: true, maxlength: 500, default: null },

    /// What the fields were, and what they became.
    ///
    /// "Changed permission" is not an audit entry — it records that something
    /// happened and not what. The question asked six months later is always
    /// "what did it used to be", and a log that cannot answer it is a list of
    /// timestamps.
    ///
    /// Only the fields that actually moved, so an entry reads as a diff rather
    /// than two copies of a document with one difference buried in them.
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    at: { type: Date, default: Date.now, index: true },
  },
  // No updatedAt. An audit entry that records having been modified is not an
  // audit entry.
  { timestamps: { createdAt: true, updatedAt: false } },
);

/// "Everything that happened to this practice", newest first.
adminAuditLogSchema.index({ practice: 1, at: -1 });

/// "Everything this administrator did", newest first.
adminAuditLogSchema.index({ admin: 1, at: -1 });

/**
 * Append an entry. The only way rows are written, and there is deliberately no
 * counterpart that edits or removes one.
 */
adminAuditLogSchema.statics.record = function record({
  admin,
  action,
  resource = null,
  resourceId = null,
  practice = null,
  reason = null,
  before = null,
  after = null,
  req = null,
}) {
  return this.create({
    admin: admin._id ?? admin.sub,
    adminEmail: admin.email ?? 'unknown',
    action,
    resource,
    resourceId,
    practice,
    reason,
    before,
    after,
    ip: req?.ip ?? null,
    userAgent: req?.get?.('user-agent') ?? null,
    at: new Date(),
  });
};

export const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);
