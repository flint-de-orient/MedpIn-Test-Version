/**
 * Doctor-approved knowledge base seed.
 *
 * This is the ONLY content the AI assistant is allowed to ground its answers
 * in. Everything here is written to be read aloud to a patient with no medical
 * training, and deliberately stops short of anything that would constitute
 * changing a prescription.
 *
 * IMPORTANT: this seed content is drafted from mainstream diabetes-care
 * guidance (ADA Standards of Care, IDF, WHO) as a working starting point. It
 * MUST be reviewed, corrected and formally approved by Dr. Amit Kumar Dey
 * before the app is used with real patients — the `status` field exists
 * precisely so that approval is an explicit, auditable act.
 *
 * This file covers core diabetes care. Endocrinology beyond diabetes,
 * complications, pharmacology, labs and special populations live in
 * `seedContentEndocrine.js` and are appended at the bottom of this file.
 */

import { ENDOCRINE_SEED } from './seedContentEndocrine.js';

const DIABETES_SEED = [
  // -------------------------------------------------------------------------
  // Hypoglycaemia
  // -------------------------------------------------------------------------
  {
    docId: 'hypo-15-15',
    title: 'What to do when blood sugar is low',
    section: 'The 15-15 rule',
    category: 'hypoglycaemia',
    language: 'en',
    tags: ['hypoglycaemia', 'low sugar', 'emergency', 'glucose'],
    sourceCitation: 'ADA Standards of Care 2025, Glycemic Targets',
    content: `A blood sugar below 70 mg/dL is called hypoglycaemia, or a "low". It needs to be treated straight away.

Use the 15-15 rule if you are awake and able to swallow safely:
1. Take 15 grams of fast-acting sugar. Any one of these works: 3-4 teaspoons of glucose powder in water, 3-4 teaspoons of ordinary sugar in water, half a cup (120 ml) of regular fruit juice or a regular soft drink (not diet), or 3-4 glucose tablets.
2. Wait 15 minutes. Do not eat more during this time, even if you still feel unwell.
3. Check your blood sugar again.
4. If it is still below 70 mg/dL, repeat steps 1 to 3.
5. Once the reading is above 70 mg/dL, eat a small meal or snack containing carbohydrate and protein, such as a chapati with dal or a sandwich, so the sugar does not fall again.

Do not use chocolate, biscuits, ice cream or milk to treat a low. The fat in them slows down how fast the sugar is absorbed.

Common warning signs of a low are shaking, sweating, a fast heartbeat, sudden hunger, dizziness, blurred vision, difficulty concentrating, irritability, and tingling around the lips.`,
  },
  {
    docId: 'hypo-severe',
    title: 'Severe low blood sugar — an emergency',
    section: 'When to get help immediately',
    category: 'hypoglycaemia',
    language: 'en',
    tags: ['severe hypoglycaemia', 'emergency', 'unconscious', 'seizure'],
    sourceCitation: 'ADA Standards of Care 2025, Hypoglycemia',
    content: `A blood sugar below 54 mg/dL is a serious low and needs urgent attention. A low is a medical emergency if the person is confused, unable to swallow safely, having a seizure, or unconscious.

If someone with diabetes is unconscious or having a seizure:
- Do NOT try to give them food, drink or anything by mouth. They can choke.
- Turn them onto their side.
- If a glucagon injection or nasal glucagon has been prescribed and someone present knows how to give it, use it now.
- Call for an ambulance or take them to the nearest hospital immediately.

After any severe low, the person must be reviewed by their doctor even if they recover fully. The cause needs to be found so it does not happen again.

Severe lows are more likely if you take insulin or sulfonylurea tablets, if you skipped a meal, if you exercised more than usual, or if you drank alcohol.`,
  },

  // -------------------------------------------------------------------------
  // Hyperglycaemia
  // -------------------------------------------------------------------------
  {
    docId: 'hyper-high-reading',
    title: 'What to do when blood sugar is high',
    section: 'Readings above target',
    category: 'hyperglycaemia',
    language: 'en',
    tags: ['high sugar', 'hyperglycaemia', 'ketones'],
    sourceCitation: 'ADA Standards of Care 2025, Glycemic Targets',
    content: `A single high reading is usually not an emergency by itself, but it should not be ignored.

If your blood sugar is above 250 mg/dL:
- Drink plenty of plain water, unless your doctor has told you to limit fluids.
- Do not do heavy exercise while your sugar is very high. It can push the level higher.
- Take your medicines exactly as they are already prescribed. Do not take an extra dose to "correct" the reading unless Dr. Dey has given you a written plan to do so.
- Check again in 2 to 4 hours.
- Think about what may have caused it: a missed dose, a large or high-carbohydrate meal, illness or infection, stress, or steroid medicines.

If your blood sugar is above 400 mg/dL, or if you have vomiting, stomach pain, deep or rapid breathing, drowsiness, or a fruity smell on your breath, this may be diabetic ketoacidosis. Go to hospital immediately.

Contact the clinic if your readings stay above 250 mg/dL for more than two days in a row.`,
  },
  {
    docId: 'dka-warning',
    title: 'Diabetic ketoacidosis (DKA) warning signs',
    section: 'Recognising DKA',
    category: 'emergency',
    language: 'en',
    tags: ['dka', 'ketoacidosis', 'emergency', 'vomiting'],
    sourceCitation: 'ADA Standards of Care 2025, Diabetes Care in Hospital',
    content: `Diabetic ketoacidosis is a life-threatening emergency. It happens when the body does not have enough insulin and starts breaking down fat for energy, producing acids called ketones.

Go to hospital immediately if you have a high blood sugar together with any of these:
- Vomiting, or being unable to keep fluids down
- Stomach or abdominal pain
- Deep, fast or laboured breathing
- A sweet or fruity smell on the breath
- Severe thirst and passing a lot of urine
- Drowsiness, confusion, or difficulty staying awake
- Moderate or large ketones on a urine or blood ketone test

DKA is more common in Type 1 diabetes, but it can happen in Type 2 diabetes as well, especially during a serious infection.

Do not wait to see if it improves on its own. DKA gets worse quickly and needs treatment in hospital.`,
  },

  // -------------------------------------------------------------------------
  // Insulin and medicines
  // -------------------------------------------------------------------------
  {
    docId: 'insulin-missed-dose',
    title: 'If you forget an insulin dose',
    section: 'Missed doses',
    category: 'insulin',
    language: 'en',
    tags: ['insulin', 'missed dose', 'forgot'],
    sourceCitation: 'Clinic protocol — Dr. A. K. Dey',
    content: `Forgetting a dose happens to almost everyone at some point. What to do depends on the type of insulin and how much time has passed, so the safest step is always to contact the clinic before acting.

General principles:
- Never take a double dose to make up for a missed one. This is the most common cause of a dangerous low.
- Check your blood sugar now, before deciding anything.
- If you have only just realised and it is close to the usual time, taking the dose late is usually reasonable — but confirm with the clinic first.
- If it is nearly time for the next scheduled dose, it is usually safer to skip the missed one and take the next dose at the normal time.
- Check your blood sugar more often than usual for the next 24 hours.

If you have missed several doses, or you feel unwell, contact Dr. Dey's clinic the same day.

Only Dr. Dey can tell you to change an insulin dose. This app cannot and will not give you a new dose.`,
  },
  {
    docId: 'insulin-technique',
    title: 'Injecting insulin safely',
    section: 'Injection sites and technique',
    category: 'insulin',
    language: 'en',
    tags: ['insulin', 'injection', 'lipohypertrophy', 'sites'],
    sourceCitation: 'FITTER injection technique recommendations',
    content: `Where and how you inject affects how well insulin works.

Injection sites: the abdomen (at least two finger-widths away from the navel), the front and outer thigh, the upper outer arm, and the upper outer buttock. Insulin is absorbed fastest from the abdomen and slowest from the buttock.

Rotate your sites. Injecting into the same small patch over and over causes hard, lumpy areas under the skin called lipohypertrophy. Insulin injected into these lumps is absorbed unpredictably, which causes unexplained highs and lows. Move at least one finger-width from the last injection each time, and change to a different area each week.

Other points:
- Use a new needle for each injection. Reused needles become blunt and cause pain and tissue damage.
- Count slowly to ten before withdrawing the needle so the full dose goes in.
- Store unopened insulin in the fridge, between 2 and 8 degrees Celsius. Never freeze it.
- An insulin pen in use can usually be kept at room temperature for about 28 days, away from direct sunlight and heat.
- Check the insulin before use. Clear insulin should be clear, not cloudy or discoloured.

Show your injection sites to Dr. Dey at your next visit so any lumps can be found early.`,
  },

  // -------------------------------------------------------------------------
  // Foot care
  // -------------------------------------------------------------------------
  {
    docId: 'foot-daily-care',
    title: 'Daily diabetic foot care',
    section: 'Prevention',
    category: 'foot_care',
    language: 'en',
    tags: ['foot', 'prevention', 'neuropathy', 'ulcer'],
    sourceCitation: 'IWGDF Guidelines 2023',
    content: `Diabetes can reduce the feeling in your feet, so an injury can go unnoticed until it becomes serious. A few minutes of care each day prevents most serious foot problems.

Every day:
- Look at both feet, including between the toes and under the soles. Use a mirror or ask a family member if you cannot see easily.
- Look for cuts, cracks, blisters, redness, swelling, colour changes, or anything warm to the touch.
- Wash your feet in lukewarm water. Test the temperature with your elbow or a thermometer, not your feet — reduced sensation means you may not feel water that is too hot.
- Dry carefully, especially between the toes.
- Apply moisturiser to dry skin on the top and bottom of the feet, but NOT between the toes.

Always:
- Wear well-fitting closed shoes. Check inside them with your hand before putting them on.
- Never walk barefoot, even at home or in the temple.
- Cut toenails straight across, not curved into the corners.
- Never use a blade, razor or over-the-counter corn remover on a callus or corn. Have it treated properly.

See Dr. Dey promptly for any new cut, blister, ulcer, colour change, swelling, or a wound that is not healing.`,
  },
  {
    docId: 'foot-danger-signs',
    title: 'Foot problems that need urgent attention',
    section: 'Red flags',
    category: 'foot_care',
    language: 'en',
    tags: ['foot', 'infection', 'gangrene', 'emergency', 'ulcer'],
    sourceCitation: 'IWGDF Guidelines 2023',
    content: `Some foot problems in diabetes can worsen within hours. Go to hospital or contact the clinic the same day if you notice any of these:

- Any black or dark blue area on the foot or toes
- Pus, discharge, or a bad smell from a wound
- Redness spreading away from a wound, or red streaks running up the foot or leg
- The foot feels hot, or is much more swollen than usual
- Fever or chills together with a foot wound
- A wound that reaches deep enough to see fat, tendon or bone
- Sudden severe pain in the foot, or a foot that suddenly becomes cold and pale
- Any wound that has not started healing after two weeks

A diabetic foot infection can spread quickly and can threaten the limb. It is always better to be seen and told it is nothing than to wait.

Do not apply turmeric, ash, oil, or any home remedy to an open wound. Cover it with a clean dry dressing and get it seen.`,
  },

  // -------------------------------------------------------------------------
  // Eye care
  // -------------------------------------------------------------------------
  {
    docId: 'eye-retinopathy',
    title: 'Diabetic retinopathy explained',
    section: 'What it is',
    category: 'eye_care',
    language: 'en',
    tags: ['retinopathy', 'eye', 'vision', 'screening'],
    sourceCitation: 'ADA Standards of Care 2025, Retinopathy',
    content: `Diabetic retinopathy is damage to the small blood vessels at the back of the eye, in the light-sensitive layer called the retina. It is caused by high blood sugar levels over a long period.

The most important thing to understand: in the early stages there are usually NO symptoms at all. Your vision can feel completely normal while damage is developing. This is why a yearly eye examination matters even when your eyes feel fine.

The stages, from earliest to most advanced:
- No retinopathy — no damage seen.
- Mild non-proliferative (NPDR) — small bulges in the blood vessels. Usually only monitoring is needed.
- Moderate NPDR — more blood vessels affected. Closer follow-up needed.
- Severe NPDR — many blood vessels blocked. Needs specialist review soon.
- Proliferative (PDR) — new, fragile blood vessels grow and can bleed. This needs urgent treatment.

Macular oedema means fluid has collected in the central part of the retina. It can happen at any stage and affects the sharp central vision used for reading.

Treatment works well when started early. Laser treatment and injections into the eye can protect vision. Keeping your blood sugar and blood pressure controlled slows retinopathy down considerably.

Have your eyes examined at least once a year, or more often if your specialist advises.`,
  },
  {
    docId: 'eye-urgent',
    title: 'Eye symptoms that need immediate attention',
    section: 'Red flags',
    category: 'eye_care',
    language: 'en',
    tags: ['vision loss', 'emergency', 'eye', 'floaters'],
    sourceCitation: 'ADA Standards of Care 2025, Retinopathy',
    content: `Go to an eye hospital or emergency department immediately if you have:

- Sudden loss of vision in one or both eyes
- A sudden shower of new floaters — dark spots or cobweb shapes drifting across your vision
- Flashes of light
- A dark curtain or shadow coming across part of your vision
- Sudden severe eye pain with redness, and seeing halos around lights

These can be signs of bleeding inside the eye, a detached retina, or acute glaucoma. Vision can often be saved if treated quickly, but delay can make the loss permanent.

Gradual blurring of vision over days can also happen when blood sugar changes quickly. This often settles once sugar levels are stable, but it still needs to be reported to Dr. Dey rather than ignored.`,
  },

  // -------------------------------------------------------------------------
  // Diet, exercise, general
  // -------------------------------------------------------------------------
  {
    docId: 'diet-basics',
    title: 'Eating well with diabetes',
    section: 'Everyday principles',
    category: 'diet',
    language: 'en',
    tags: ['diet', 'food', 'carbohydrate', 'meal planning'],
    sourceCitation: 'ADA Standards of Care 2025, Nutrition Therapy',
    content: `There is no single "diabetes diet". The aim is a consistent, balanced way of eating that you can keep up.

Practical principles:
- Fill half your plate with non-starchy vegetables, a quarter with protein such as dal, fish, eggs, chicken or paneer, and a quarter with carbohydrate such as rice or roti.
- Keep portion sizes of rice, roti, potato and other starchy foods consistent from meal to meal. Sudden large portions cause sharp spikes.
- Choose whole grains where you can — brown rice, whole wheat atta, millets such as ragi and bajra — instead of refined white flour.
- Eat at roughly the same times each day, especially if you take insulin or sulfonylurea tablets.
- Avoid sugary drinks, packaged fruit juices, and sweets. Liquid sugar raises blood glucose very fast.
- Whole fruit is fine in moderate portions. Fruit juice is not — it removes the fibre and concentrates the sugar.
- Include fibre: vegetables, dal, whole pulses, and salads.
- Limit deep-fried food, and reduce salt if you also have high blood pressure.

Do not fast or skip meals to lower your sugar, particularly if you take insulin or sulfonylurea tablets. It can cause a dangerous low.

If you are planning to fast for religious reasons, speak to Dr. Dey beforehand so your medicines can be planned safely.`,
  },
  {
    docId: 'exercise-basics',
    title: 'Physical activity with diabetes',
    section: 'Safe exercise',
    category: 'exercise',
    language: 'en',
    tags: ['exercise', 'walking', 'activity'],
    sourceCitation: 'ADA Standards of Care 2025, Physical Activity',
    content: `Regular activity lowers blood sugar, improves how well insulin works, and helps your heart. Aim for about 150 minutes of moderate activity per week — for example a brisk 30-minute walk on five days.

Try not to go more than two days in a row without activity. Also break up long periods of sitting: stand and move for a few minutes every half hour.

Staying safe:
- Check your blood sugar before and after exercise, especially when starting something new.
- If your reading is below 100 mg/dL before you start, eat a small carbohydrate snack first.
- Do not exercise hard if your blood sugar is above 250 mg/dL, or if you feel unwell.
- Carry fast-acting sugar such as glucose tablets with you.
- Wear well-fitting shoes and check your feet afterwards.
- Drink water before, during and after.

If you have heart disease, eye disease, or numbness in your feet, ask Dr. Dey which activities are suitable before starting. Some exercises need to be avoided with advanced retinopathy or significant neuropathy.`,
  },
  {
    docId: 'sick-day-rules',
    title: 'Sick day rules',
    section: 'Managing diabetes during illness',
    category: 'sick_day_rules',
    language: 'en',
    tags: ['illness', 'fever', 'infection', 'sick day'],
    sourceCitation: 'Diabetes UK / ADA sick day guidance',
    content: `Any illness — even a cold, fever or stomach upset — can push blood sugar up, because the body releases stress hormones.

When you are unwell:
- NEVER stop your insulin, even if you are eating less. Stopping insulin during illness is a common cause of ketoacidosis.
- Check your blood sugar more often than usual — every 4 hours, or more if it is high.
- Drink plenty of fluids to avoid dehydration. Small sips often is better than a large amount at once.
- If you cannot eat normally, replace meals with carbohydrate-containing fluids such as milk, soup or fruit juice, unless your doctor has told you otherwise.
- If you have Type 1 diabetes or use insulin, check for ketones if your sugar goes above 250 mg/dL.
- Rest.

Contact the clinic the same day if you cannot keep fluids down, if you have vomiting or diarrhoea lasting more than 6 hours, if your blood sugar stays above 250 mg/dL despite taking your medicines, if you have moderate or large ketones, or if you are becoming drowsy or confused.

Some tablets, particularly metformin and SGLT2 inhibitors, may need to be paused during a serious illness with dehydration. Ask Dr. Dey — do not decide this yourself.`,
  },
  {
    docId: 'hba1c-explained',
    title: 'Understanding your HbA1c',
    section: 'What the number means',
    category: 'diabetes_basics',
    language: 'en',
    tags: ['hba1c', 'a1c', 'test', 'control'],
    sourceCitation: 'ADA Standards of Care 2025, Glycemic Targets',
    content: `HbA1c is a blood test that shows your average blood sugar over roughly the past three months. Unlike a finger-prick reading, which is a single moment, HbA1c reflects the overall picture.

It is reported as a percentage. As a general guide:
- Below 5.7% — normal
- 5.7% to 6.4% — prediabetes
- 6.5% or above — diabetes

For most adults with diabetes the usual target is below 7%, but the right target is individual. Dr. Dey may set a higher target if you are older, have other medical conditions, or have had severe low sugars — because in those situations, pushing too hard can be more dangerous than a slightly higher number.

HbA1c is usually checked every three months while treatment is being adjusted, and every six months once you are stable.

A rough guide to what your HbA1c means in everyday numbers: 6% is about an average of 126 mg/dL, 7% about 154 mg/dL, 8% about 183 mg/dL, 9% about 212 mg/dL, and 10% about 240 mg/dL.

Remember that HbA1c can be misleading if you have anaemia, a haemoglobin disorder, or kidney disease. Discuss your result with Dr. Dey rather than judging it alone.`,
  },
  {
    docId: 'bp-diabetes',
    title: 'Blood pressure and diabetes',
    section: 'Why it matters',
    category: 'hypertension',
    language: 'en',
    tags: ['blood pressure', 'hypertension', 'kidney', 'heart'],
    sourceCitation: 'ADA Standards of Care 2025, Cardiovascular Disease',
    content: `High blood pressure and diabetes together greatly increase the risk of heart attack, stroke, kidney disease and eye damage. Controlling blood pressure is as important as controlling blood sugar.

For most people with diabetes the target is below 140/90 mmHg, and Dr. Dey may set a lower target such as below 130/80 mmHg depending on your circumstances.

How to measure correctly at home:
- Sit quietly for 5 minutes first, with your back supported and feet flat on the floor.
- Rest your arm on a table at the level of your heart.
- Do not talk during the measurement.
- Avoid tea, coffee and smoking for 30 minutes beforehand.
- Take two readings a minute apart and record both.

A blood pressure of 180/120 mmHg or higher is a hypertensive crisis. Go to hospital immediately, especially if you also have chest pain, breathlessness, severe headache, weakness on one side, or change in vision.

Reducing salt, staying active, losing excess weight, and taking your prescribed tablets regularly all help. Do not stop a blood pressure tablet because your reading has become normal — the reading is normal because the tablet is working.`,
  },
  {
    docId: 'clinic-info',
    title: 'About the clinic and this app',
    section: 'How to reach us',
    category: 'clinic_info',
    language: 'en',
    tags: ['clinic', 'contact', 'appointment', 'app'],
    sourceCitation: 'Clinic information',
    content: `Dr. Amit Kumar Dey is a Consultant Physician and Diabetologist. This app helps you manage your diabetes between visits.

What this app can do: record your blood sugar, blood pressure, weight, medicines, meals and activity; remind you about doses; let you upload foot photographs and eye or laboratory reports; book appointments; and answer general health questions using guidance Dr. Dey has approved.

What this app cannot do: it cannot examine you, it cannot diagnose a new condition, and it cannot change any medicine or dose. Only Dr. Dey can do those things.

For an emergency, do not use the chat. Go to the nearest hospital emergency department, or call the clinic emergency number shown in the app.

To book, reschedule or cancel an appointment, use the Appointments section. If you need to be seen sooner than the next available slot, mention it when booking and the clinic will try to accommodate you.`,
  },

  // -------------------------------------------------------------------------
  // Bengali
  // -------------------------------------------------------------------------
  {
    docId: 'hypo-15-15-bn',
    title: 'রক্তে শর্করা কমে গেলে কী করবেন',
    section: '১৫-১৫ নিয়ম',
    category: 'hypoglycaemia',
    language: 'bn',
    tags: ['হাইপোগ্লাইসেমিয়া', 'কম সুগার', 'জরুরি'],
    sourceCitation: 'ADA Standards of Care 2025',
    content: `রক্তে শর্করা ৭০ mg/dL-এর নিচে নেমে গেলে তাকে হাইপোগ্লাইসেমিয়া বা "লো" বলা হয়। এর চিকিৎসা সঙ্গে সঙ্গে করতে হবে।

আপনি যদি সজ্ঞানে থাকেন এবং নিরাপদে গিলতে পারেন, তাহলে ১৫-১৫ নিয়ম মেনে চলুন:
১. ১৫ গ্রাম দ্রুত-কার্যকরী চিনি খান। যেকোনো একটি: জলে গোলা ৩-৪ চা চামচ গ্লুকোজ পাউডার, ৩-৪ চা চামচ সাধারণ চিনি, আধ কাপ (১২০ মিলি) সাধারণ ফলের রস বা সাধারণ ঠান্ডা পানীয় (ডায়েট নয়), অথবা ৩-৪টি গ্লুকোজ ট্যাবলেট।
২. ১৫ মিনিট অপেক্ষা করুন। এই সময়ে আর কিছু খাবেন না, এমনকি খারাপ লাগলেও।
৩. আবার রক্তে শর্করা মেপে দেখুন।
৪. যদি এখনও ৭০ mg/dL-এর নিচে থাকে, তাহলে ১ থেকে ৩ নম্বর ধাপ আবার করুন।
৫. মাত্রা ৭০-এর উপরে উঠে গেলে একটি ছোট খাবার খান যাতে কার্বোহাইড্রেট ও প্রোটিন আছে, যেমন রুটি-ডাল, যাতে শর্করা আবার না কমে।

চকোলেট, বিস্কুট, আইসক্রিম বা দুধ দিয়ে "লো" সারানোর চেষ্টা করবেন না। এগুলিতে থাকা চর্বি চিনি শোষণে দেরি করায়।

লো-এর সাধারণ লক্ষণ: হাত-পা কাঁপা, ঘাম হওয়া, বুক ধড়ফড় করা, হঠাৎ খিদে পাওয়া, মাথা ঘোরা, চোখে ঝাপসা দেখা, মনোযোগ দিতে অসুবিধা, খিটখিটে ভাব, এবং ঠোঁটের চারপাশে ঝিনঝিন করা।`,
  },
  {
    docId: 'foot-danger-bn',
    title: 'পায়ের যে সমস্যায় দ্রুত চিকিৎসা দরকার',
    section: 'বিপদ সংকেত',
    category: 'foot_care',
    language: 'bn',
    tags: ['পা', 'সংক্রমণ', 'ঘা', 'জরুরি'],
    sourceCitation: 'IWGDF Guidelines 2023',
    content: `ডায়াবেটিসে পায়ের কিছু সমস্যা কয়েক ঘণ্টার মধ্যেই মারাত্মক হয়ে উঠতে পারে। নিচের যেকোনো একটি দেখলে সেই দিনই হাসপাতালে যান বা ক্লিনিকে যোগাযোগ করুন:

- পায়ে বা আঙুলে কালো বা গাঢ় নীল কোনো অংশ
- ঘা থেকে পুঁজ, রস, বা দুর্গন্ধ
- ঘায়ের চারপাশ থেকে লালচে ভাব ছড়িয়ে পড়া, বা পা-জুড়ে লাল দাগ উঠে যাওয়া
- পা গরম লাগা, বা স্বাভাবিকের চেয়ে অনেক বেশি ফুলে যাওয়া
- ঘায়ের সঙ্গে জ্বর বা কাঁপুনি
- এত গভীর ঘা যে চর্বি, শিরা বা হাড় দেখা যাচ্ছে
- পায়ে হঠাৎ তীব্র ব্যথা, বা পা হঠাৎ ঠান্ডা ও ফ্যাকাশে হয়ে যাওয়া
- দুই সপ্তাহেও শুকোতে শুরু করেনি এমন ঘা

ডায়াবেটিসের পায়ের সংক্রমণ দ্রুত ছড়ায় এবং পা কেটে বাদ দেওয়ার পর্যন্ত পরিস্থিতি যেতে পারে। দেরি করার চেয়ে দেখিয়ে নিশ্চিন্ত হওয়া সবসময় ভালো।

খোলা ঘায়ে হলুদ, ছাই, তেল বা কোনো ঘরোয়া টোটকা লাগাবেন না। পরিষ্কার শুকনো ব্যান্ডেজ দিয়ে ঢেকে ডাক্তার দেখান।`,
  },
  {
    docId: 'diet-basics-bn',
    title: 'ডায়াবেটিসে সঠিক খাদ্যাভ্যাস',
    section: 'প্রতিদিনের নিয়ম',
    category: 'diet',
    language: 'bn',
    tags: ['খাদ্য', 'ডায়েট', 'কার্বোহাইড্রেট'],
    sourceCitation: 'ADA Standards of Care 2025',
    content: `ডায়াবেটিসের জন্য আলাদা কোনো একটিমাত্র "ডায়েট" নেই। লক্ষ্য হল এমন একটি ভারসাম্যপূর্ণ ও নিয়মিত খাওয়ার অভ্যাস যা আপনি দীর্ঘদিন চালিয়ে যেতে পারবেন।

কিছু বাস্তব পরামর্শ:
- থালার অর্ধেক ভরুন শাকসবজি দিয়ে, এক-চতুর্থাংশ প্রোটিন দিয়ে (ডাল, মাছ, ডিম, মুরগি বা পনির), এবং এক-চতুর্থাংশ ভাত বা রুটি দিয়ে।
- ভাত, রুটি, আলুর পরিমাণ প্রতিদিন একই রাখুন। হঠাৎ বেশি খেলে সুগার দ্রুত বেড়ে যায়।
- সাদা ময়দার বদলে গোটা শস্য বেছে নিন — ব্রাউন রাইস, আটার রুটি, রাগি বা বাজরার মতো মিলেট।
- প্রতিদিন প্রায় একই সময়ে খাবার খান, বিশেষ করে যদি আপনি ইনসুলিন বা সালফোনাইলইউরিয়া জাতীয় ওষুধ নেন।
- চিনিযুক্ত পানীয়, প্যাকেটজাত ফলের রস ও মিষ্টি এড়িয়ে চলুন। তরল চিনি খুব দ্রুত সুগার বাড়ায়।
- গোটা ফল পরিমিত পরিমাণে খাওয়া চলে, কিন্তু ফলের রস নয় — রস করলে আঁশ চলে যায় এবং চিনি ঘন হয়ে যায়।
- আঁশযুক্ত খাবার রাখুন: শাকসবজি, ডাল, গোটা ডালশস্য ও স্যালাড।
- ভাজাভুজি কম খান, আর উচ্চ রক্তচাপ থাকলে নুন কমান।

সুগার কমানোর জন্য উপোস করবেন না বা খাবার বাদ দেবেন না, বিশেষ করে যদি ইনসুলিন বা সালফোনাইলইউরিয়া নেন। এতে বিপজ্জনকভাবে সুগার কমে যেতে পারে।

ধর্মীয় কারণে উপোস করার পরিকল্পনা থাকলে আগেই ডাঃ দে-র সঙ্গে কথা বলুন, যাতে ওষুধ নিরাপদভাবে সাজানো যায়।`,
  },

  // -------------------------------------------------------------------------
  // Hindi
  // -------------------------------------------------------------------------
  {
    docId: 'hypo-15-15-hi',
    title: 'रक्त शर्करा कम होने पर क्या करें',
    section: '15-15 का नियम',
    category: 'hypoglycaemia',
    language: 'hi',
    tags: ['हाइपोग्लाइसीमिया', 'कम शुगर', 'आपातकाल'],
    sourceCitation: 'ADA Standards of Care 2025',
    content: `रक्त शर्करा 70 mg/dL से नीचे जाने को हाइपोग्लाइसीमिया या "लो" कहते हैं। इसका इलाज तुरंत करना चाहिए।

यदि आप होश में हैं और सुरक्षित रूप से निगल सकते हैं, तो 15-15 का नियम अपनाएँ:
1. 15 ग्राम जल्दी असर करने वाली चीनी लें। इनमें से कोई एक: पानी में घोलकर 3-4 चम्मच ग्लूकोज पाउडर, 3-4 चम्मच साधारण चीनी, आधा कप (120 मिली) साधारण फलों का रस या साधारण ठंडा पेय (डाइट नहीं), या 3-4 ग्लूकोज की गोलियाँ।
2. 15 मिनट प्रतीक्षा करें। इस दौरान और कुछ न खाएँ, भले ही तबीयत ठीक न लगे।
3. दोबारा रक्त शर्करा जाँचें।
4. यदि अब भी 70 mg/dL से कम है, तो चरण 1 से 3 दोहराएँ।
5. स्तर 70 से ऊपर आने पर कार्बोहाइड्रेट और प्रोटीन वाला छोटा भोजन लें, जैसे रोटी-दाल, ताकि शर्करा दोबारा न गिरे।

"लो" के इलाज के लिए चॉकलेट, बिस्किट, आइसक्रीम या दूध का उपयोग न करें। इनमें मौजूद वसा चीनी के अवशोषण को धीमा कर देती है।

लो के सामान्य लक्षण: कँपकँपी, पसीना आना, दिल तेज़ धड़कना, अचानक भूख लगना, चक्कर आना, धुंधला दिखना, ध्यान लगाने में कठिनाई, चिड़चिड़ापन, और होंठों के आसपास झुनझुनी।`,
  },
  {
    docId: 'hyper-high-hi',
    title: 'रक्त शर्करा अधिक होने पर क्या करें',
    section: 'लक्ष्य से ऊपर के स्तर',
    category: 'hyperglycaemia',
    language: 'hi',
    tags: ['अधिक शुगर', 'हाइपरग्लाइसीमिया', 'कीटोन'],
    sourceCitation: 'ADA Standards of Care 2025',
    content: `एक बार का अधिक स्तर आमतौर पर अपने आप में आपातकाल नहीं है, लेकिन इसे अनदेखा भी नहीं करना चाहिए।

यदि आपकी रक्त शर्करा 250 mg/dL से ऊपर है:
- खूब सादा पानी पिएँ, बशर्ते डॉक्टर ने तरल पदार्थ सीमित करने को न कहा हो।
- शर्करा बहुत अधिक होने पर भारी व्यायाम न करें। इससे स्तर और बढ़ सकता है।
- अपनी दवाएँ ठीक वैसे ही लें जैसे पहले से निर्धारित हैं। स्तर "ठीक" करने के लिए अतिरिक्त खुराक न लें, जब तक डॉ. दे ने लिखित योजना न दी हो।
- 2 से 4 घंटे बाद दोबारा जाँचें।
- कारण पर विचार करें: छूटी हुई खुराक, अधिक कार्बोहाइड्रेट वाला भोजन, बीमारी या संक्रमण, तनाव, या स्टेरॉयड दवाएँ।

यदि रक्त शर्करा 400 mg/dL से ऊपर है, या उल्टी, पेट दर्द, गहरी या तेज़ साँस, सुस्ती, या साँस में मीठी गंध है — तो यह डायबिटिक कीटोएसिडोसिस हो सकता है। तुरंत अस्पताल जाएँ।

यदि आपके स्तर लगातार दो दिन से अधिक 250 mg/dL से ऊपर रहते हैं तो क्लिनिक से संपर्क करें।`,
  },
  {
    docId: 'foot-daily-hi',
    title: 'मधुमेह में पैरों की दैनिक देखभाल',
    section: 'बचाव',
    category: 'foot_care',
    language: 'hi',
    tags: ['पैर', 'बचाव', 'घाव'],
    sourceCitation: 'IWGDF Guidelines 2023',
    content: `मधुमेह से पैरों की संवेदना कम हो सकती है, जिससे कोई चोट तब तक पता नहीं चलती जब तक वह गंभीर न हो जाए। रोज़ कुछ मिनट की देखभाल अधिकांश गंभीर समस्याओं को रोक देती है।

हर दिन:
- दोनों पैरों को देखें, उँगलियों के बीच और तलवों के नीचे भी। यदि देखने में कठिनाई हो तो शीशे का उपयोग करें या घर के किसी सदस्य से मदद लें।
- कटाव, दरार, छाले, लालिमा, सूजन, रंग में बदलाव, या छूने पर गर्म लगने वाली जगह देखें।
- गुनगुने पानी से पैर धोएँ। पानी का तापमान कोहनी से जाँचें, पैर से नहीं — संवेदना कम होने पर बहुत गर्म पानी का पता नहीं चलता।
- अच्छी तरह पोंछें, विशेषकर उँगलियों के बीच।
- सूखी त्वचा पर मॉइस्चराइज़र लगाएँ, लेकिन उँगलियों के बीच नहीं।

हमेशा:
- सही नाप के बंद जूते पहनें। पहनने से पहले अंदर हाथ डालकर जाँचें।
- कभी नंगे पाँव न चलें, घर या मंदिर में भी नहीं।
- नाखून सीधे काटें, कोनों से गोल नहीं।
- गट्टे या कॉर्न पर ब्लेड, उस्तरा या बाज़ार की दवा का प्रयोग कभी न करें।

किसी भी नए कटाव, छाले, घाव, रंग परिवर्तन, सूजन, या न भरने वाले घाव के लिए तुरंत डॉ. दे को दिखाएँ।`,
  },
];

/**
 * Everything the assistant may ground an answer in.
 *
 * Order matters only for readability — retrieval ranks by relevance, not by
 * position. Adding a domain here is what makes it answerable; the assistant is
 * instructed to refuse rather than improvise when nothing matches.
 */
import { AI_DRAFT_SEED } from './aiDrafts.js';
export const KNOWLEDGE_SEED = [...DIABETES_SEED, ...ENDOCRINE_SEED, ...AI_DRAFT_SEED];
