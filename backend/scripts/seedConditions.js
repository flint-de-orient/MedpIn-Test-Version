/**
 * Seeds the illnesses the app already knows about.
 *
 * Ten rows, taken from what the schema already asserted: `diabetesType` was one
 * condition with a type, and `comorbidities` was nine more as loose strings.
 * Nothing here is new clinical scope — it is the same list, in a shape that can
 * grow without a deploy.
 *
 * `homeCards` is filled in only where the card actually exists in the app.
 * Inventing a card key here would put a screen nobody has built onto somebody's
 * Home tab. Empty means the patient sees no card for that condition, which is
 * correct until one is designed.
 *
 * `triageRules` is empty on every row, deliberately, and should stay that way
 * until a clinician in that field writes them. The 21 rules the app has are
 * diabetes-tuned.
 *
 *   node scripts/seedConditions.js          # report
 *   node scripts/seedConditions.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Condition } from '../src/models/Condition.js';

const apply = process.argv.includes('--apply');

const CONDITIONS = [
  {
    key: 'diabetes',
    names: { en: 'Diabetes', bn: 'ডায়াবেটিস', hi: 'मधुमेह' },
    sortIndex: 10,
    // The only condition whose cards are all built, because the app was written
    // for it.
    homeCards: ['glucose', 'hba1c', 'medications', 'diet_plan'],
    detailFields: [
      {
        key: 'type',
        label: 'Type',
        // The same five values `diabetesType` allowed, so the migration is a
        // move rather than a reinterpretation.
        options: ['type1', 'type2', 'gestational', 'prediabetes', 'none'],
      },
    ],
  },
  {
    key: 'hypertension',
    names: { en: 'High blood pressure', bn: 'উচ্চ রক্তচাপ', hi: 'उच्च रक्तचाप' },
    sortIndex: 20,
    homeCards: ['blood_pressure'],
  },
  {
    key: 'dyslipidaemia',
    names: { en: 'High cholesterol', bn: 'উচ্চ কোলেস্টেরল', hi: 'उच्च कोलेस्ट्रॉल' },
    sortIndex: 30,
    homeCards: [],
  },
  {
    key: 'ckd',
    names: { en: 'Kidney disease', bn: 'কিডনির রোগ', hi: 'गुर्दे की बीमारी' },
    sortIndex: 40,
    homeCards: [],
  },
  {
    key: 'retinopathy',
    names: { en: 'Diabetic retinopathy', bn: 'ডায়াবেটিক রেটিনোপ্যাথি', hi: 'डायबिटिक रेटिनोपैथी' },
    sortIndex: 50,
    homeCards: [],
  },
  {
    key: 'neuropathy',
    names: { en: 'Nerve damage', bn: 'স্নায়ুর ক্ষতি', hi: 'तंत्रिका क्षति' },
    sortIndex: 60,
    homeCards: [],
  },
  {
    key: 'cad',
    names: { en: 'Heart disease', bn: 'হৃদরোগ', hi: 'हृदय रोग' },
    sortIndex: 70,
    homeCards: [],
  },
  {
    key: 'thyroid',
    names: { en: 'Thyroid disorder', bn: 'থাইরয়েডের সমস্যা', hi: 'थायरॉइड विकार' },
    sortIndex: 80,
    homeCards: [],
  },
  {
    key: 'obesity',
    names: { en: 'Obesity', bn: 'স্থূলতা', hi: 'मोटापा' },
    sortIndex: 90,
    homeCards: [],
  },
  {
    key: 'other',
    names: { en: 'Other condition', bn: 'অন্যান্য অবস্থা', hi: 'अन्य स्थिति' },
    sortIndex: 999,
    homeCards: [],
    detailFields: [{ key: 'name', label: 'What is it?', options: [] }],
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const existing = await Condition.find({ practice: null }).lean();
  const byKey = new Map(existing.map((c) => [c.key, c]));

  const toCreate = CONDITIONS.filter((c) => !byKey.has(c.key));
  const edited = CONDITIONS.filter((c) => byKey.has(c.key) && !byKey.get(c.key).isSeed);
  const refresh = CONDITIONS.filter((c) => byKey.has(c.key) && byKey.get(c.key).isSeed);

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${String(toCreate.length).padStart(2)} to create`);
  console.log(`  ${String(refresh.length).padStart(2)} seeded rows to refresh`);
  console.log(`  ${String(edited.length).padStart(2)} edited by hand — left alone`);
  for (const c of edited) console.log(`       skipping ${c.key}`);

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  for (const c of [...toCreate, ...refresh]) {
    await Condition.updateOne(
      { practice: null, key: c.key },
      { $set: { ...c, practice: null, isSeed: true, isActive: true } },
      { upsert: true },
    );
  }

  const total = await Condition.countDocuments({ practice: null });
  console.log(`\nDone. ${total} shared conditions.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
