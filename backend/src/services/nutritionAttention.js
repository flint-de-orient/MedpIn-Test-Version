import { dayjs } from '../utils/clinicTime.js';

/**
 * The patients whose nutrition needs a look, worst first.
 *
 * Three reasons, in the order a dietician would triage them: a log came in
 * after the last review and nobody has read it; the patient has largely stopped
 * logging; their next review falls inside three days. One entry per patient —
 * the most pressing reason wins, because the same face three times reads as
 * three patients.
 */
export function buildAttention({ assigned, defaultDays, logsByPatient, planBy }) {
  const today = dayjs().startOf('day');
  const out = [];

  for (const p of assigned) {
    const id = String(p.user._id);
    const logs = logsByPatient.get(id) ?? [];
    const lastReview = p.lastDietReviewAt ? dayjs(p.lastDietReviewAt) : null;

    // Seven days of "did they log anything at all", oldest first. A count per
    // day would spike on the patient who photographs four snacks; presence is
    // the behaviour being measured.
    const spark = [];
    for (let i = 6; i >= 0; i -= 1) {
      const key = today.subtract(i, 'day').format('YYYY-MM-DD');
      spark.push(logs.some((l) => dayjs(l.createdAt).format('YYYY-MM-DD') === key) ? 1 : 0);
    }
    const loggedDays = spark.reduce((a, b) => a + b, 0);
    const missed = 7 - loggedDays;

    // The meal's own flag. This used to compare each log against the patient's
    // last review date, which meant a dietician who replied without looking at
    // the plates had "reviewed" all of them.
    const unreviewed = logs.filter((l) => !l.reviewedAt);

    const interval = p.dietReviewIntervalDays ?? defaultDays;
    const nextReviewIn =
      interval && p.lastDietReviewAt
        ? interval - dayjs().diff(dayjs(p.lastDietReviewAt), 'day')
        : null;

    let kind = null;
    let label = null;
    let detail = null;

    if (unreviewed.length > 0) {
      kind = 'log_review';
      label = 'Food log needs review';
      const newest = unreviewed.reduce((a, b) => (dayjs(a.createdAt).isAfter(b.createdAt) ? a : b));
      detail = `New log submitted ${dayjs(newest.createdAt).fromNow()}`;
    } else if (missed >= 3) {
      kind = 'adherence';
      label = 'Low adherence';
      const last = logs[0];
      detail = last
        ? `Last log: ${dayjs(last.createdAt).fromNow()}`
        : 'No meals logged in the last week';
    } else if (nextReviewIn !== null && nextReviewIn >= 0 && nextReviewIn <= 3) {
      kind = 'review_soon';
      label = 'Review due soon';
      detail = nextReviewIn === 0 ? 'Review due today' : `Review due in ${nextReviewIn}d`;
    } else {
      continue;
    }

    out.push({
      patientId: id,
      name: p.user.name,
      avatarUrl: p.user.avatarAssetId ? `/api/v1/uploads/${p.user.avatarAssetId}/raw` : null,
      kind,
      label,
      detail,
      missedLogs: missed,
      spark,
    });
  }

  const rank = { log_review: 0, adherence: 1, review_soon: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.missedLogs - a.missedLogs);
}

/**
 * What has just happened across the caseload, newest first.
 *
 * Three streams merged and cut to [limit]: a patient wrote in their nutrition
 * thread, a patient logged a meal, a plan went out. Deliberately *not* a fourth
 * copy of the worklist — this answers "what changed while I was away", which is
 * a different question from "what do I owe", and the rest of the screen already
 * answers the second one.
 */
async function recentActivity(ids, byId, limit = 6) {
  if (ids.length === 0) return [];

  const since = dayjs().subtract(7, 'day').toDate();
  const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: ids } })
    .select('_id patient')
    .lean();

  const [messages, logs, plans] = await Promise.all([
    sessions.length > 0
      ? ChatMessage.find({
          role: 'user',
          session: { $in: sessions.map((x) => x._id) },
          createdAt: { $gte: since },
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .select('patient createdAt')
          .lean()
      : [],
    FoodLog.find({ patient: { $in: ids }, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('patient createdAt')
      .lean(),
    DietPlan.find({ patient: { $in: ids }, sharedAt: { $gte: since } })
      .sort({ sharedAt: -1 })
      .limit(limit)
      .select('patient sharedAt')
      .lean(),
  ]);

  const name = (patientId) => byId.get(String(patientId))?.user?.name ?? null;

  const rows = [
    ...messages.map((m) => ({
      id: `msg-${String(m._id)}`,
      kind: 'message',
      patientName: name(m.patient),
      // "replied", because every one of these is a patient answering in a
      // thread the clinic started.
      text: 'replied',
      at: m.createdAt,
    })),
    ...logs.map((l) => ({
      id: `log-${String(l._id)}`,
      kind: 'food_log',
      patientName: name(l.patient),
      text: 'submitted a food log',
      at: l.createdAt,
    })),
    ...plans.map((p) => ({
      id: `plan-${String(p.patient)}-${new Date(p.sharedAt).getTime()}`,
      kind: 'plan',
      patientName: name(p.patient),
      // "sent to", not "accepted by": nothing in the schema records a patient
      // accepting a plan, and claiming they did would be inventing consent.
      text: 'diet plan sent',
      at: p.sharedAt,
    })),
  ]
    // A row whose patient is not on this caseload cannot be acted on, and
    // naming someone else's patient here would be a scope leak.
    .filter((r) => r.patientName)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);

  return rows;
}
