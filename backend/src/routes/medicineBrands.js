import { Router } from 'express';
import { z } from 'zod';
import { MedicineBrand, brandSlug } from '../models/MedicineBrand.js';
import { asyncHandler } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireClinician } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

// Prescribers only. This is a prescribing aid, and a patient does not need a
// list of every product the clinic stocks.
router.use(requireAuth, requireClinician);

function serialise(b) {
  return {
    id: String(b._id),
    name: b.name,
    strengthLabel: b.strengthLabel ?? '',
    strengthUnit: b.strengthUnit ?? null,
    form: b.form ?? 'tablet',
    note: b.note ?? '',
    composition: (b.composition ?? []).map((c) => ({
      ingredient: c.ingredient,
      amount: c.amount,
      unit: c.unit ?? 'mg',
    })),
    // What a prescriber reads to check they picked the right product:
    // "Metformin 500 mg + Glimepiride 1 mg".
    compositionLabel: (b.composition ?? [])
      .map((c) => `${c.ingredient} ${c.amount} ${c.unit ?? 'mg'}`)
      .join(' + '),
  };
}

/**
 * Brand suggestions for the medicine field.
 *
 * Matched on the slug, so "gluconorm g1", "Gluconorm-G1" and "GLUCONORMG1" all
 * find the same product — a doctor typing at speed should not have to punctuate
 * a brand name correctly to be understood.
 */
router.get(
  '/',
  validate({ query: z.object({ q: z.string().max(80).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = brandSlug(req.query.q ?? '');
    if (q.length === 0) {
      const items = await MedicineBrand.find({}).sort({ name: 1 }).limit(25).lean();
      return res.json({ items: items.map(serialise) });
    }

    // Ranked, not alphabetised.
    //
    // This used to sort by name and cut at 25, which put the answer behind the
    // alphabet: a doctor typing "gluco" got the first 25 products containing
    // those letters in A-Z order, so "Gluconorm" could be missing entirely
    // while "Deglucotide" sat at the top. On a prescribing field that is not a
    // ranking problem, it is a wrong-drug problem.
    //
    // So: fetch a wider net, then order by how well each actually matches —
    // prefix first, then how early the match falls, then the shorter name,
    // then alphabetically. `slug` is stripped to [a-z0-9] on the way in, which
    // is also what makes it safe to interpolate here.
    const pool = await MedicineBrand.find({ slug: { $regex: q } })
      .limit(200)
      .lean();

    pool.sort((a, b) => {
      const ai = a.slug.indexOf(q);
      const bi = b.slug.indexOf(q);
      if (ai !== bi) return ai - bi;
      if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
      return a.name.localeCompare(b.name);
    });

    res.json({ items: pool.slice(0, 25).map(serialise) });
  }),
);

/**
 * One brand by the name as typed, for checking a strength before a prescription
 * is issued. 404 rather than a guess: an unknown brand is unknown, and the
 * caller should say nothing rather than warn about a product it cannot identify.
 */
router.get(
  '/lookup',
  validate({ query: z.object({ name: z.string().min(1).max(160) }) }),
  asyncHandler(async (req, res) => {
    const brand = await MedicineBrand.findOne({ slug: brandSlug(req.query.name) }).lean();
    res.json({ brand: brand ? serialise(brand) : null });
  }),
);

/**
 * Correct a composition, or add a product the seed does not carry.
 *
 * Marked isSeed:false so a reseed never undoes it — the clinic's own knowledge
 * of what it prescribes outranks a list shipped with the app.
 */
router.put(
  '/',
  validate({
    body: z.object({
      name: z.string().min(1).max(160),
      form: z.string().max(40).optional(),
      note: z.string().max(300).optional(),
      composition: z
        .array(
          z.object({
            ingredient: z.string().min(1).max(120),
            amount: z.number().min(0),
            unit: z.string().max(12).default('mg'),
          }),
        )
        .default([]),
    }),
  }),
  audit('update', 'MedicineBrand'),
  asyncHandler(async (req, res) => {
    const slug = brandSlug(req.body.name);
    const brand = await MedicineBrand.findOneAndUpdate(
      { slug },
      { ...req.body, slug, isSeed: false },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    res.json({ brand: serialise(brand.toObject()) });
  }),
);

export default router;
