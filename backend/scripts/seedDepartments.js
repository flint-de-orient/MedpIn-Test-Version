/**
 * Seeds the specialties the platform ships with.
 *
 * Shared rows — `practice: null` — because "Cardiologist" means the same thing
 * in Salt Lake as in Behala, and a hundred practices each keeping their own
 * copy of it is a hundred slightly different spellings on a hundred
 * prescription letterheads.
 *
 * Bengali and Hindi are here because a patient in this clinic reads one of the
 * three, and a department name is the one word on a prescription that tells
 * them which doctor they saw.
 *
 * Every row is marked `isSeed`, and a row the clinic has edited is never
 * overwritten — the same rule seedMedicineBrands follows, for the same reason:
 * a maintenance script that silently reverts somebody's correction teaches
 * people not to make corrections.
 *
 *   node scripts/seedDepartments.js          # report
 *   node scripts/seedDepartments.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Department } from '../src/models/Department.js';

const apply = process.argv.includes('--apply');

/**
 * The eight, in the order a patient meets them.
 *
 * General Physician first because most people start there and most clinics have
 * one. The rest alphabetical-ish by how commonly they are asked for, which is a
 * judgement the clinic can overrule by editing sortIndex.
 *
 * `homeCards` is what a patient of that department sees on Home. Only two are
 * filled in: the ones this clinic actually runs and whose cards already exist
 * in the app. The others are empty on purpose — an invented card list is a
 * screen nobody designed, and a department with no cards falls back to the
 * general ones rather than showing something wrong.
 *
 * `triageRules` is empty on every row. Deliberately, and it should stay that
 * way until a clinician in that specialty writes them. The 21 existing red
 * flags are diabetes-tuned; obstetric bleeding and suicidal ideation are not
 * among them and cannot be inferred from them.
 */
const DEPARTMENTS = [
  {
    key: 'general_physician',
    names: { en: 'General Physician', bn: 'জেনারেল ফিজিশিয়ান', hi: 'जनरल फिजिशियन' },
    sortIndex: 10,
    homeCards: [],
  },
  {
    key: 'diabetology',
    names: { en: 'Diabetes & Endocrinology', bn: 'ডায়াবেটিস ও এন্ডোক্রিনোলজি', hi: 'मधुमेह और एंडोक्राइनोलॉजी' },
    sortIndex: 20,
    // The only department whose cards are known, because it is the one the app
    // was built for and these screens already exist.
    homeCards: ['glucose', 'hba1c', 'medications', 'diet_plan'],
  },
  {
    key: 'cardiology',
    names: { en: 'Cardiologist', bn: 'কার্ডিওলজিস্ট', hi: 'हृदय रोग विशेषज्ञ' },
    sortIndex: 30,
    homeCards: ['blood_pressure'],
  },
  {
    key: 'gynaecology',
    names: { en: 'Gynaecologist', bn: 'স্ত্রীরোগ বিশেষজ্ঞ', hi: 'स्त्री रोग विशेषज्ञ' },
    sortIndex: 40,
    homeCards: [],
  },
  {
    key: 'paediatrics',
    names: { en: 'Paediatrician', bn: 'শিশু বিশেষজ্ঞ', hi: 'बाल रोग विशेषज्ञ' },
    sortIndex: 50,
    homeCards: [],
  },
  {
    key: 'dermatology',
    names: { en: 'Dermatologist', bn: 'চর্মরোগ বিশেষজ্ঞ', hi: 'त्वचा रोग विशेषज्ञ' },
    sortIndex: 60,
    homeCards: [],
  },
  {
    key: 'orthopaedics',
    names: { en: 'Orthopaedic Doctor', bn: 'অর্থোপেডিক চিকিৎসক', hi: 'हड्डी रोग विशेषज्ञ' },
    sortIndex: 70,
    homeCards: [],
  },
  {
    key: 'psychiatry',
    names: { en: 'Psychiatrist', bn: 'মনোরোগ বিশেষজ্ঞ', hi: 'मनोचिकित्सक' },
    sortIndex: 80,
    homeCards: [],
  },
  {
    key: 'physical_medicine',
    names: {
      en: 'Physical Medicine & Rehabilitation',
      bn: 'ফিজিক্যাল মেডিসিন ও পুনর্বাসন',
      hi: 'फिजिकल मेडिसिन और पुनर्वास',
    },
    sortIndex: 90,
    homeCards: [],
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const existing = await Department.find({ practice: null }).lean();
  const byKey = new Map(existing.map((d) => [d.key, d]));

  const toCreate = DEPARTMENTS.filter((d) => !byKey.has(d.key));
  const edited = DEPARTMENTS.filter((d) => byKey.has(d.key) && !byKey.get(d.key).isSeed);
  const refresh = DEPARTMENTS.filter((d) => byKey.has(d.key) && byKey.get(d.key).isSeed);

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${String(toCreate.length).padStart(2)} to create`);
  console.log(`  ${String(refresh.length).padStart(2)} seeded rows to refresh`);
  console.log(`  ${String(edited.length).padStart(2)} edited by hand — left alone`);
  for (const d of edited) console.log(`       skipping ${d.key}`);

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  for (const d of [...toCreate, ...refresh]) {
    await Department.updateOne(
      { practice: null, key: d.key },
      { $set: { ...d, practice: null, isSeed: true, isActive: true } },
      { upsert: true },
    );
  }

  const total = await Department.countDocuments({ practice: null });
  console.log(`\nDone. ${total} shared departments.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
