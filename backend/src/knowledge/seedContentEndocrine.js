/**
 * Knowledge base seed — endocrinology beyond diabetes, complications, and the
 * supporting knowledge patients ask about between visits.
 *
 * Companion to `seedContent.js`, which covers core diabetes care. Split only
 * for readability; both are loaded by `scripts/seedKnowledge.js`.
 *
 * Written to the same rules as the diabetes seed:
 *   - Patient-level language. No jargon without an explanation in the same breath.
 *   - Never states a dose, never tells anyone to start, stop or change a medicine.
 *   - Anything time-critical says "go now", not "consider contacting".
 *
 * IMPORTANT: drafted from mainstream guidance (ADA Standards of Care 2026, ATA,
 * Endocrine Society, KDIGO, ESC/ISH, RSSDI/ICMR). It MUST be reviewed and
 * formally approved by Dr. Amit Kumar Dey before use with real patients.
 * Numbers in particular — targets, thresholds, intervals — are exactly what a
 * clinician needs to sign off or correct.
 */

export const ENDOCRINE_SEED = [
  // ==========================================================================
  // Thyroid
  // ==========================================================================
  {
    docId: 'thyroid-hypo-basics',
    title: 'Understanding an underactive thyroid (hypothyroidism)',
    section: 'What it is and how it is treated',
    category: 'thyroid',
    language: 'en',
    tags: ['thyroid', 'hypothyroidism', 'levothyroxine', 'tsh', 'hashimoto'],
    sourceCitation: 'American Thyroid Association — Hypothyroidism guidelines',
    content: `The thyroid is a small gland in the front of your neck. It makes a hormone that sets the speed of your body — how you use energy, how warm you feel, how your heart beats. When it makes too little, that is called hypothyroidism, or an underactive thyroid.

Common symptoms are tiredness that rest does not fix, feeling cold when others do not, weight gain, dry skin, hair thinning, constipation, low mood, and heavier or irregular periods.

The most common cause is Hashimoto's thyroiditis, where the body's own immune system slowly damages the gland. It is not caused by anything you did, and it is not contagious.

Treatment is levothyroxine, a tablet that simply replaces the hormone your thyroid is no longer making. It is not a stimulant and it is not a steroid. Most people take it for life, and once the dose is right, they feel normal.

Your dose is set from a blood test called TSH. After any dose change, TSH is usually rechecked after about 6 to 8 weeks, because the level takes that long to settle. Checking sooner gives a misleading answer.

Do not change your own dose based on how you feel. Feeling tired has many causes, and taking more levothyroxine than you need causes palpitations, tremor and bone thinning.`,
  },
  {
    docId: 'thyroid-levo-timing',
    title: 'How and when to take levothyroxine',
    section: 'Timing, food and other medicines',
    category: 'thyroid',
    language: 'en',
    tags: ['levothyroxine', 'thyroid', 'timing', 'interaction', 'calcium', 'iron'],
    sourceCitation: 'American Thyroid Association — Hypothyroidism guidelines',
    content: `Levothyroxine is absorbed poorly if it meets food or certain minerals in the stomach. How you take it matters as much as the dose.

- Take it on an empty stomach, first thing in the morning, with plain water.
- Wait at least 30 to 60 minutes before tea, coffee, milk or breakfast.
- If mornings are impossible, taking it at bedtime at least 3 hours after your last food works too. What matters most is that you do the same thing every day.

Keep a gap of at least 4 hours between levothyroxine and any of these, because they block its absorption:
- Calcium tablets and antacids
- Iron tablets
- Multivitamins containing calcium or iron
- Some stomach medicines and cholesterol-binding medicines

Soya products and very high-fibre meals also reduce absorption. You do not have to avoid them — just keep them away from the tablet.

If you miss a dose, take it as soon as you remember on the same day. If you only remember the next day, take that day's dose as usual. Do not take two at once without asking the clinic.

Tell ${'the clinic'} if you start any new medicine, become pregnant, or change brand of levothyroxine — all three can change how much you need.`,
  },
  {
    docId: 'thyroid-tsh-report',
    title: 'Understanding your thyroid blood test',
    section: 'TSH, FT4 and antibodies in plain language',
    category: 'lab_interpretation',
    language: 'en',
    tags: ['tsh', 'ft4', 'thyroid', 'lab', 'report'],
    sourceCitation: 'American Thyroid Association; Endocrine Society',
    content: `Thyroid reports usually show two or three numbers.

TSH is the message the brain sends to the thyroid. It works backwards from what most people expect:
- A HIGH TSH usually means the thyroid is UNDERactive. The brain is shouting because the gland is not responding.
- A LOW TSH usually means the thyroid is OVERactive, or that a thyroid tablet dose is too high.
- The usual adult range is roughly 0.4 to 4.0 mIU/L, though laboratories differ slightly and the target is adjusted in pregnancy and in older people.

FT4 (free T4) is the actual hormone level in your blood. It is used alongside TSH to work out what is happening.

TPO antibodies, if tested, show whether the immune system is attacking the gland. A positive result explains the cause; it does not change day-to-day treatment.

Two things worth knowing before you worry about a number:
- A single abnormal TSH is often repeated before anything changes. Illness, pregnancy, some medicines and even the time of day shift it.
- The aim of treatment is a TSH in range AND you feeling well. Neither one alone.

Bring the printed report to your next appointment. Your doctor will interpret it alongside your symptoms, your other medicines and your history — which is what a number on its own cannot tell you.`,
  },
  {
    docId: 'thyroid-hyper-basics',
    title: 'Understanding an overactive thyroid (hyperthyroidism)',
    section: 'Graves disease and thyrotoxicosis',
    category: 'thyroid',
    language: 'en',
    tags: ['hyperthyroidism', 'graves', 'thyrotoxicosis', 'carbimazole'],
    sourceCitation: 'American Thyroid Association — Hyperthyroidism guidelines',
    content: `An overactive thyroid makes too much hormone, so the body runs too fast. Common symptoms are a fast or pounding heartbeat, weight loss despite a good appetite, feeling hot and sweaty, tremor in the hands, anxiety, poor sleep, loose stools and, in women, lighter periods.

The most common cause is Graves' disease, an immune condition. Some people also notice eye changes — gritty, watery or prominent eyes.

Treatment is usually a tablet that slows the gland down, such as carbimazole or methimazole. Some people later need radioiodine or surgery. Your doctor will explain which suits you.

Two warnings that matter with these tablets:

1. If you develop a sore throat, mouth ulcers or fever while taking carbimazole or methimazole, stop and contact the clinic the same day. These medicines can rarely drop the white cells that fight infection, and a blood count is needed urgently.

2. If you develop a high fever, a very fast or irregular heartbeat, agitation or confusion, go to the nearest hospital immediately. A severe flare of an overactive thyroid, called a thyroid storm, is a medical emergency.

Do not stop the tablet on your own because you feel better. Stopping early is the commonest reason the illness comes back.`,
  },
  {
    docId: 'thyroid-nodule-goitre',
    title: 'Thyroid nodules and goitre',
    section: 'What a lump in the neck usually means',
    category: 'thyroid',
    language: 'en',
    tags: ['nodule', 'goitre', 'lump', 'neck', 'fnac', 'ultrasound'],
    sourceCitation: 'American Thyroid Association — Thyroid Nodules and DTC guidelines',
    content: `A thyroid nodule is a lump within the thyroid gland. A goitre simply means the whole gland is enlarged. Both are common, especially in women and with increasing age, and the great majority are not cancer.

How they are usually assessed:
- A blood test to see whether the gland is working normally.
- An ultrasound scan of the neck, which describes the size and appearance of the nodule.
- If the ultrasound suggests it, a fine needle test (FNAC), where a thin needle takes a few cells for examination. It is done in the clinic and is not usually painful beyond a blood-test level.

Many nodules only need watching with a repeat scan after some months. That is a normal plan, not a delay.

See the clinic sooner if the lump grows quickly, if your voice becomes hoarse and stays hoarse, if swallowing or breathing becomes difficult, or if the lump becomes hard and fixed.

Post-surgery: if you have had part or all of your thyroid removed, you may need lifelong levothyroxine, and possibly calcium and vitamin D. Tingling around the mouth or in the fingers in the days after thyroid surgery means a low calcium level — contact the clinic straight away.`,
  },

  // ==========================================================================
  // Hypertension
  // ==========================================================================
  {
    docId: 'htn-home-monitoring',
    title: 'How to measure your blood pressure correctly at home',
    section: 'Technique',
    category: 'hypertension',
    language: 'en',
    tags: ['blood pressure', 'home monitoring', 'technique', 'cuff'],
    sourceCitation: 'ESC/ISH hypertension guidelines; ADA Standards of Care 2026',
    content: `A home reading is only useful if it is taken properly. Most surprisingly high readings at home are technique, not illness.

Before you measure:
- Sit quietly for 5 minutes first. Do not measure straight after climbing stairs, arguing, or drinking tea or coffee.
- Empty your bladder first — a full bladder raises the reading.
- No smoking or caffeine for 30 minutes beforehand.

How to sit:
- Back supported by the chair, feet flat on the floor, legs uncrossed.
- Arm resting on a table so the cuff is level with your heart.
- Cuff on bare skin, not over a sleeve. Two fingers should fit under it.
- Do not talk during the measurement. Talking adds several points.

What to record:
- Take two readings a minute apart and note both. If they differ a lot, take a third.
- Measure at the same times each day, usually morning before medicines and evening.
- Bring the whole set of readings, not just the highest one. Your doctor looks at the pattern.

Most people with diabetes are aimed at a blood pressure below 130/80 mmHg, but your own target may differ depending on age, kidney function and other conditions.

Go to hospital immediately, do not wait for an appointment, if a high reading comes with chest pain, breathlessness, severe headache, weakness on one side, or difficulty speaking.`,
  },
  {
    docId: 'htn-medicine-classes',
    title: 'Blood pressure medicines and their common side effects',
    section: 'What to expect from each type',
    category: 'hypertension',
    language: 'en',
    tags: ['antihypertensive', 'amlodipine', 'telmisartan', 'ramipril', 'side effects'],
    sourceCitation: 'ESC/ISH hypertension guidelines',
    content: `Blood pressure medicines work in different ways, which is why two smaller doses of different types often work better than one large dose of a single medicine.

Common groups and what people usually notice:

- ACE inhibitors (names ending in -pril, such as ramipril, enalapril). A dry, tickly cough is the classic side effect, and it is a reason to switch, not to put up with it. Tell the clinic.
- ARBs (names ending in -sartan, such as telmisartan, losartan). Similar benefit, rarely cause the cough. Often chosen in diabetes because they also protect the kidneys.
- Calcium channel blockers (such as amlodipine, cilnidipine). Ankle swelling and occasional flushing or headache are the usual complaints. Swelling is not a sign of heart or kidney failure by itself, but do report it.
- Diuretics or "water tablets" (such as chlorthalidone, indapamide, hydrochlorothiazide). Passing more urine at first, and they can affect potassium and salt levels, so blood tests are done periodically.
- Beta blockers (such as metoprolol, bisoprolol). Slower pulse, sometimes tiredness or cold hands. Important: they can mask the early warning signs of a low blood sugar.

Two things that apply to all of them:
- Do not stop a blood pressure medicine because your reading is now normal. The reading is normal because of the medicine.
- Never stop a beta blocker suddenly. It has to be reduced gradually.

If you feel dizzy on standing, do not stop the tablet yourself — record the readings and tell the clinic, because the dose may simply need adjusting.`,
  },

  // ==========================================================================
  // Dyslipidaemia
  // ==========================================================================
  {
    docId: 'lipid-panel-explained',
    title: 'Understanding your cholesterol report',
    section: 'LDL, HDL, triglycerides',
    category: 'lab_interpretation',
    language: 'en',
    tags: ['cholesterol', 'ldl', 'hdl', 'triglycerides', 'lipid'],
    sourceCitation: 'ADA Standards of Care 2026; ESC/EAS dyslipidaemia guidelines',
    content: `A lipid profile usually reports four numbers.

- LDL cholesterol is the one that matters most. It is the cholesterol that builds up in artery walls. Lower is better, and the target depends on your overall risk — people with diabetes are aimed lower than people without.
- HDL cholesterol carries cholesterol away. Higher is better.
- Triglycerides are a different kind of fat, strongly affected by sugar, refined carbohydrate, alcohol and uncontrolled diabetes. A very high level can also inflame the pancreas.
- Total cholesterol is the sum, and on its own it is the least useful number.

Two practical points:
- Most laboratories no longer require fasting for a lipid profile, but follow whatever instruction your test slip gives.
- A single reading taken during an illness, or soon after a change in diabetes control, can be misleading.

What actually lowers LDL: reducing fried food, ghee, vanaspati, coconut oil and full-fat dairy; more soluble fibre such as oats, dal, beans and vegetables; regular activity; and, where the risk justifies it, a statin.

What raises triglycerides most in this clinic's patients: sweets, sugary drinks, refined flour, alcohol, and blood sugar that is running high.

Do not compare your numbers with a relative's targets. Yours are set from your own risk.`,
  },
  {
    docId: 'lipid-statin-myalgia',
    title: 'Statins and muscle aches',
    section: 'What is normal and what is not',
    category: 'dyslipidaemia',
    language: 'en',
    tags: ['statin', 'muscle pain', 'myalgia', 'atorvastatin', 'rosuvastatin'],
    sourceCitation: 'ADA Standards of Care 2026; ESC/EAS dyslipidaemia guidelines',
    content: `Statins lower cholesterol and reduce the risk of heart attack and stroke. Muscle aching is their best-known complaint, though studies show most aching in people taking statins turns out to have another cause.

Mild aching that comes on after starting a statin is worth reporting, not enduring. There are several statins and several doses, and switching very often solves it.

Contact the clinic the same day if you have:
- Muscle pain or weakness that is severe, or that stops you doing normal things
- Muscle pain together with fever or feeling generally unwell
- Urine that turns dark brown or tea-coloured

That last combination can mean a rare but serious muscle breakdown, and it needs a blood test quickly.

Things that make statin muscle problems more likely: higher doses, some antibiotics and antifungals, certain heart medicines, low thyroid hormone that has not been treated, heavy alcohol, and grapefruit juice with some statins.

Do not stop a statin on your own if you have had a heart attack, stroke or stent — the risk of stopping is real. Tell the clinic, keep taking it until you are advised otherwise, unless your urine has gone dark, in which case stop and call the same day.`,
  },

  // ==========================================================================
  // Obesity, metabolic syndrome, GLP-1
  // ==========================================================================
  {
    docId: 'glp1-what-to-expect',
    title: 'Starting a GLP-1 medicine (semaglutide, liraglutide, tirzepatide)',
    section: 'What to expect and how to manage side effects',
    category: 'obesity_metabolic',
    language: 'en',
    tags: ['glp-1', 'semaglutide', 'liraglutide', 'tirzepatide', 'weight', 'nausea'],
    sourceCitation: 'ADA Standards of Care 2026, Obesity and Weight Management',
    content: `These medicines copy a natural gut hormone. They slow how fast the stomach empties, reduce appetite, and improve blood sugar. Some are weekly injections, some daily, and one is a tablet.

The dose is deliberately started low and increased in steps over weeks. That is not caution for its own sake — going up too fast is the main reason people cannot tolerate these medicines.

Nausea is the commonest side effect, and it usually settles within a few weeks. What helps:
- Eat smaller portions and stop as soon as you feel full. Your old portion size will now be too much.
- Eat slowly. Avoid fried, oily and very rich food while you are settling in.
- Sip water through the day.
- Do not lie down straight after eating.

Constipation is also common — more fibre, more water, more walking.

Contact the clinic if you have persistent vomiting, if you cannot keep fluids down, or if you are losing weight much faster than expected.

Go to hospital the same day for severe, constant abdominal pain that goes through to your back, especially with vomiting. Inflammation of the pancreas is uncommon but serious.

Important with diabetes: if you also take insulin or a sulfonylurea, your risk of a low sugar goes up as these medicines take effect. Your doctor may reduce those doses — but only your doctor. Keep testing and keep fast-acting sugar with you.

Storage: most GLP-1 pens live in the fridge (2–8 °C) until first use, then many can stay at room temperature for a set number of weeks. Never freeze one. Check the leaflet for your specific pen, and never use a pen that has been frozen.`,
  },
  {
    docId: 'metabolic-syndrome-india',
    title: 'Metabolic syndrome and why Indian waistlines are measured differently',
    section: 'Asian Indian thresholds',
    category: 'obesity_metabolic',
    language: 'en',
    tags: ['metabolic syndrome', 'bmi', 'waist', 'asian indian', 'obesity'],
    sourceCitation: 'RSSDI/ICMR India guidelines; WHO Asia-Pacific BMI cut-offs',
    content: `Metabolic syndrome is a cluster that travels together: extra weight around the middle, raised blood sugar, raised blood pressure, high triglycerides and low HDL cholesterol. Having several together raises heart risk more than any one alone.

Indians develop these problems at a lower body weight than Europeans do. The same BMI carries more risk, with more fat carried around the abdomen and around the organs. Because of this, Indian thresholds are lower:

- Overweight starts around a BMI of 23 kg/m², not 25.
- Obesity starts around a BMI of 25 kg/m², not 30.
- Waist circumference matters more than weight: above about 90 cm in men and 80 cm in women is the point of concern.

How to measure your waist properly: stand up, breathe out normally, and put the tape midway between the lowest rib and the top of the hip bone — roughly at the navel. Do not pull it tight and do not hold your breath in.

This is also why some Indians develop type 2 diabetes while looking slim. A normal weight on the scale does not rule it out.

What moves these numbers most: cutting sugar and refined flour (maida, white rice in large portions, sweets, sugary drinks), walking at least 30 minutes most days, adding resistance exercise twice a week, and sleeping properly. Losing even 5 to 7 percent of your weight measurably improves all five parts of the cluster.`,
  },

  // ==========================================================================
  // PCOS, adrenal, pituitary
  // ==========================================================================
  {
    docId: 'pcos-basics',
    title: 'Polycystic ovary syndrome (PCOS)',
    section: 'What it is and what helps',
    category: 'pcos',
    language: 'en',
    tags: ['pcos', 'periods', 'insulin resistance', 'metformin', 'fertility'],
    sourceCitation: 'International PCOS Guideline; Endocrine Society',
    content: `PCOS is a common hormone condition. It usually shows itself as irregular or missed periods, extra hair on the face or body, acne, difficulty losing weight, and sometimes difficulty conceiving.

The name is misleading. The "cysts" seen on a scan are not true cysts and they are not dangerous — they are small follicles that have not matured. Many women with PCOS have normal scans, and many women with that scan appearance do not have PCOS.

Underneath it, most women with PCOS have insulin resistance — the body needs more insulin than it should to do the same job. That is why PCOS raises the long-term risk of type 2 diabetes, and why treatment often overlaps with diabetes treatment.

What is known to help:
- Weight loss of even 5 percent often restores more regular periods.
- Regular activity improves insulin resistance directly, even without weight loss.
- Reducing sugar and refined carbohydrate helps more than a general "diet".
- Metformin is often used for the insulin resistance side.
- Hormonal treatment may be used to regularise periods or manage acne and hair growth.

Two things worth raising at your appointment:
- If your periods are absent for several months at a time, that needs attention in its own right, not just for fertility reasons.
- If you are planning a pregnancy, say so early — several PCOS medicines are changed before conception, and folic acid should be started beforehand.`,
  },
  {
    docId: 'adrenal-steroid-sick-day',
    title: 'Steroid sick-day rules and adrenal crisis',
    section: 'If you take long-term steroids',
    category: 'adrenal',
    language: 'en',
    tags: ['steroid', 'hydrocortisone', 'addison', 'adrenal crisis', 'sick day'],
    sourceCitation: 'Endocrine Society — Primary Adrenal Insufficiency guideline',
    content: `This applies if you take hydrocortisone or prednisolone for adrenal insufficiency or Addison's disease, or if you have been on steroid tablets for a long time.

Your body normally makes extra stress hormone when you are ill. If you take steroids long term, your own glands cannot do that, so the extra has to come from your tablets. Illness without that extra is dangerous.

When you are unwell with a fever or infection, your doctor will usually have given you a rule for increasing your dose. Follow the rule you were given. If you were not given one, contact the clinic the same day you become unwell — do not wait.

Go to hospital immediately if you:
- Cannot keep your tablets down because of vomiting or diarrhoea
- Feel severely weak, dizzy, or as though you are about to collapse
- Have severe abdominal pain with vomiting
- Become confused or drowsy

Vomiting matters more than it sounds. A tablet that has been vomited has not been absorbed, and adrenal crisis can develop within hours. If you have an emergency hydrocortisone injection and have been trained to use it, use it and then go to hospital.

Always carry your steroid card or wear an alert bracelet, and tell every doctor, dentist and surgeon that you take steroids — including before any procedure.

Never stop long-term steroids suddenly. They must be reduced slowly under supervision.`,
  },
  {
    docId: 'adrenal-cushing',
    title: 'Cushing’s syndrome — too much cortisol',
    section: 'What patients notice',
    category: 'adrenal',
    language: 'en',
    tags: ['cushing', 'cortisol', 'adrenal', 'steroid'],
    sourceCitation: 'Endocrine Society — Cushing’s Syndrome guideline',
    content: `Cushing's syndrome happens when the body is exposed to too much cortisol, the main stress hormone, for a long time. The most common cause worldwide is taking steroid medicine; less commonly, the body makes too much itself.

What people typically notice: weight gain concentrated on the trunk and face while arms and legs get thinner, a rounder face, a fatty pad at the base of the neck, purple stretch marks wider than a finger, skin that bruises very easily, muscle weakness going up stairs or rising from a chair, new or worsening diabetes, high blood pressure, thinning bones, and low mood or poor sleep.

Testing usually involves collecting urine over 24 hours, a late-night saliva sample, or a tablet taken at night with a blood test the next morning. These tests are affected by shift work, alcohol, illness and some medicines, so they are often repeated before anything is concluded.

If you are taking any steroid — tablets, strong skin creams, inhalers at high dose, or joint injections — bring the details to your appointment. It changes both the interpretation of the test and the plan.

Do not stop a steroid you have been taking regularly without medical advice. Stopping suddenly after long use can cause an adrenal crisis.`,
  },
  {
    docId: 'pituitary-basics',
    title: 'Pituitary conditions — prolactinoma and acromegaly',
    section: 'Plain-language overview',
    category: 'pituitary',
    language: 'en',
    tags: ['pituitary', 'prolactin', 'prolactinoma', 'acromegaly', 'growth hormone'],
    sourceCitation: 'Endocrine Society — Pituitary guidelines',
    content: `The pituitary is a pea-sized gland at the base of the brain that directs several other hormone glands.

Prolactinoma is a benign (non-cancerous) growth that makes too much of the hormone prolactin. In women it typically causes irregular or absent periods, milk from the breasts when not breastfeeding, and difficulty conceiving. In men it typically causes reduced sex drive, erectile difficulty and sometimes breast tenderness. A large one can press on the nerves to the eyes and affect side vision.

It is usually treated successfully with tablets, not surgery. Prolactin can also be raised by several common medicines, by an underactive thyroid, and by stress — which is why the test is often repeated before treatment starts.

Acromegaly is caused by too much growth hormone in adulthood. Changes are slow and easy to miss: rings and shoes becoming tight, coarser facial features, larger hands and jaw, deeper voice, snoring or sleep apnoea, joint pains, sweating, headaches, and new diabetes or high blood pressure. Comparing old photographs often makes it obvious. Treatment may be surgery, medicines, or radiotherapy.

Tell the clinic promptly about any new persistent headache, or any change in your side vision, if you are known to have a pituitary condition.`,
  },

  // ==========================================================================
  // Bone, calcium, vitamin D, gout
  // ==========================================================================
  {
    docId: 'bone-osteoporosis',
    title: 'Osteoporosis and keeping bones strong',
    section: 'Thin bones explained',
    category: 'bone_metabolism',
    language: 'en',
    tags: ['osteoporosis', 'bone', 'dexa', 'calcium', 'fracture'],
    sourceCitation: 'Endocrine Society; ICMR bone health guidance',
    content: `Osteoporosis means bone has become thinner and more fragile, so it can break from a fall that would not normally cause a fracture. It has no symptoms until something breaks, which is why it is screened for rather than waited for.

Risk is higher after menopause, with increasing age, with long-term steroid use, with an overactive thyroid or too much thyroid tablet, with low body weight, with smoking and heavy alcohol, and with a family history of hip fracture.

It is measured by a DEXA scan, a quick, painless, low-radiation scan of the hip and spine. The result is given as a T-score.

What genuinely helps:
- Enough calcium, preferably from food: milk, curd, paneer, ragi, sesame (til), green leafy vegetables, and small fish eaten with bones.
- Enough vitamin D, which lets your body absorb that calcium.
- Weight-bearing exercise — walking, stairs, light weights. Swimming is good for you but does little for bone.
- Stopping smoking, and keeping alcohol low.
- Preventing falls: good light at night, no loose rugs, checked eyesight, and a review of any medicine that makes you dizzy.

If you have had a fracture from a minor fall, tell the clinic even if it healed. It changes how your risk is assessed.`,
  },
  {
    docId: 'bone-vitamin-d',
    title: 'Vitamin D — why it matters and why so many are low',
    section: 'Deficiency in India',
    category: 'bone_metabolism',
    language: 'en',
    tags: ['vitamin d', 'deficiency', 'calcium', 'sunlight'],
    sourceCitation: 'Endocrine Society; ICMR vitamin D guidance',
    content: `Vitamin D lets your body absorb calcium from food. Without enough, calcium passes straight through however much you eat.

Deficiency is very common in India despite the sunshine. The usual reasons are working indoors, covering most of the skin, air pollution blocking UVB, darker skin needing longer exposure, and a mostly vegetarian diet with little natural vitamin D in it.

Symptoms, when present, are vague: aching bones, especially the lower back, hips and thighs; muscle weakness, particularly getting up from sitting; tiredness; and more frequent infections. Many people have none at all.

Levels are measured as 25-hydroxy vitamin D in the blood. Broadly, below 20 ng/mL is considered deficient and 20 to 30 ng/mL insufficient, though laboratories and guidelines differ slightly.

Sensible sun exposure means roughly 15 to 30 minutes on the arms and face several times a week, in mid-morning or late afternoon rather than the peak of the day. Darker skin needs longer.

Food sources are limited: fortified milk, egg yolk, mushrooms exposed to sunlight, and oily fish for those who eat it. Most people who are deficient need a supplement.

Do not take high-dose vitamin D long term without supervision. It is stored in the body and too much raises calcium levels, which causes nausea, constipation, excessive thirst, confusion and kidney stones.`,
  },
  {
    docId: 'gout-acute-and-prevention',
    title: 'Gout — the sudden painful joint',
    section: 'Attacks and long-term control',
    category: 'gout',
    language: 'en',
    tags: ['gout', 'uric acid', 'joint pain', 'allopurinol', 'febuxostat'],
    sourceCitation: 'ACR gout guideline; RSSDI clinical practice recommendations',
    content: `Gout happens when uric acid forms sharp crystals inside a joint. It causes an attack that comes on over hours, often overnight, and the joint becomes intensely painful, swollen, red and hot. Classically it is the base of the big toe, but the ankle, knee, wrist or fingers can be affected.

During an attack:
- Rest the joint and keep it raised.
- An ice pack wrapped in a cloth, applied for short spells, helps the pain.
- Keep drinking water.
- Take the medicine your doctor has prescribed for attacks, if you have one.
- Keep bedding off the joint — even a sheet can be unbearable.

Important: if you already take a long-term uric-acid tablet such as allopurinol or febuxostat, do not stop it during an attack. Stopping mid-attack usually makes things worse.

Contact the clinic urgently, the same day, if the joint is hot and swollen AND you have a fever, or if you feel generally unwell. A joint infection can look almost identical to gout and is treated completely differently.

Between attacks, what lowers uric acid: less alcohol, especially beer and spirits; fewer sugary drinks and anything sweetened with fructose; less organ meat, red meat and shellfish; keeping well hydrated; and losing excess weight slowly rather than by crash dieting, which can trigger an attack.

Long-term tablets are aimed at a uric acid level around 6 mg/dL or below, and lower if you have visible deposits. They are prevention, not painkillers, and they are taken every day — including when you feel perfectly well.`,
  },

  // ==========================================================================
  // Complications and overlap
  // ==========================================================================
  {
    docId: 'kidney-ckd-explained',
    title: 'Diabetes and your kidneys',
    section: 'eGFR, ACR and what the numbers mean',
    category: 'kidney',
    language: 'en',
    tags: ['kidney', 'nephropathy', 'egfr', 'acr', 'creatinine', 'ckd'],
    sourceCitation: 'KDIGO CKD guideline; ADA Standards of Care 2026',
    content: `High blood sugar and high blood pressure slowly damage the filters in the kidneys. This is checked with two tests, and both matter.

eGFR estimates how well the kidneys are filtering, calculated from a blood creatinine. Above about 90 is normal; the number falls as filtering declines. A mildly reduced eGFR in an older person is common and is not automatically alarming.

ACR (urine albumin-to-creatinine ratio) checks whether protein is leaking into the urine. This is often the earliest sign, appearing well before eGFR changes. Broadly, under 30 is normal, 30 to 300 is moderately raised, and over 300 is heavily raised.

Both are usually checked at least once a year in diabetes, and repeated to confirm before anything is concluded — a single raised ACR can be caused by a urine infection, fever, heavy exercise the day before, or menstruation.

Early kidney damage has no symptoms at all. By the time there is swelling or tiredness, a great deal of function has already gone. That is the whole reason for annual testing.

What protects the kidneys, in order of impact: blood pressure control, blood sugar control, certain medicines that specifically protect kidneys in diabetes, not smoking, and avoiding painkillers of the ibuprofen and diclofenac type unless your doctor has approved them.

Tell the clinic if you notice frothy urine that persists, swelling of the ankles or around the eyes, or a large change in how much urine you pass.`,
  },
  {
    docId: 'neuropathy-explained',
    title: 'Nerve damage from diabetes (neuropathy)',
    section: 'Numbness, burning and tingling',
    category: 'neuropathy',
    language: 'en',
    tags: ['neuropathy', 'numbness', 'tingling', 'burning feet', 'nerve'],
    sourceCitation: 'ADA Standards of Care 2026, Retinopathy, Neuropathy and Foot Care',
    content: `Long-standing high blood sugar can damage nerves, most often the longest ones, which is why it usually starts in the feet and moves upwards over years.

What it feels like: numbness, tingling or pins and needles, burning that is worse at night, sharp shooting pains, or feet that feel oddly cold or oddly hot. Some people lose sensation without ever having pain — that is the more dangerous version.

Why numbness matters more than pain: a foot that cannot feel does not warn you about a stone in your shoe, a blister, or a burn from hot water. Most serious diabetic foot problems begin with an injury the person never felt. If you have numbness, check your feet by looking at them every single day.

What helps the underlying nerve damage: steady blood sugar control. This slows progression but does not usually reverse damage already done, which is why it is worth acting early.

What helps the pain: specific medicines that work on nerve pain rather than ordinary painkillers. Ordinary paracetamol and anti-inflammatory tablets work poorly for this and the anti-inflammatory ones can harm the kidneys.

Nerve damage can also affect other functions — dizziness on standing, bloating or nausea after meals, unusually rapid or irregular bowel habit, difficulty emptying the bladder, and erectile difficulty. These are worth mentioning even though they are easy to feel embarrassed about; they are common and treatable.

Contact the clinic promptly for any new numbness, weakness or foot injury, and immediately for a foot wound that is black, discharging, or smells.`,
  },
  {
    docId: 'liver-masld',
    title: 'Fatty liver (MASLD) and diabetes',
    section: 'What a fatty liver report means',
    category: 'liver',
    language: 'en',
    tags: ['fatty liver', 'masld', 'nafld', 'liver', 'ultrasound'],
    sourceCitation: 'AASLD/EASL MASLD guidance; ADA Standards of Care 2026',
    content: `Fatty liver means fat has accumulated inside liver cells. It is now called MASLD — metabolic dysfunction-associated steatotic liver disease — because it travels with diabetes, extra weight around the middle, high blood pressure and abnormal cholesterol. It is very common in India and it is usually found by chance on an ultrasound.

Most people have no symptoms. Some feel a vague fullness or discomfort under the right ribs, or tiredness.

It matters because in some people the fat causes inflammation and, over years, scarring. Your doctor may check liver blood tests and sometimes a scan that measures stiffness, to work out whether you are in the small group who need closer follow-up.

What actually reverses it — and it genuinely can be reversed:
- Losing weight gradually. Losing around 7 to 10 percent of body weight can clear a great deal of the fat.
- Cutting sugar, sweets, and especially sugary and fizzy drinks. Fructose goes more or less straight to the liver.
- Reducing refined carbohydrate — white rice in large portions, maida, biscuits.
- Regular exercise, which helps even before the weight changes.
- Avoiding alcohol.

Be careful with supplements and herbal remedies "for the liver". Several sold in India have caused liver injury. Show the clinic anything you are taking, including ayurvedic and over-the-counter products.

Good blood sugar control also helps the liver, and some diabetes medicines are chosen partly for that reason.`,
  },
  {
    docId: 'cvd-risk-diabetes',
    title: 'Diabetes and your heart',
    section: 'Why heart risk is checked so often',
    category: 'cardiovascular',
    language: 'en',
    tags: ['heart', 'cardiovascular', 'risk', 'aspirin', 'chest pain'],
    sourceCitation: 'ADA Standards of Care 2026, Cardiovascular Disease and Risk Management',
    content: `Diabetes raises the risk of heart attack and stroke, and Indians develop heart disease around a decade earlier on average than Europeans. This is why appointments spend time on blood pressure and cholesterol and not only on sugar.

The four things that lower heart risk most, roughly in order:
1. Not smoking, and avoiding second-hand smoke. This is the single biggest one.
2. Blood pressure control.
3. Cholesterol control, usually with a statin where risk justifies it.
4. Blood sugar control.

Regular activity, weight control and sleep sit underneath all four.

Warning signs that need a hospital immediately, not an appointment:
- Chest pain, pressure, heaviness or tightness, especially if it spreads to the arm, neck, jaw or back
- Sudden breathlessness, or breathlessness lying flat
- Cold sweat with nausea and a feeling that something is badly wrong
- Sudden weakness or numbness on one side, drooping face, or slurred speech

An important warning specific to diabetes: long-standing nerve damage can blunt the pain of a heart attack. Some people with diabetes have a heart attack with no chest pain at all — only sudden breathlessness, extreme tiredness, sweating or nausea. Do not wait for classic chest pain before seeking help.

Aspirin is not for everyone with diabetes. It is a decision your doctor makes based on your particular risk, because it also carries a bleeding risk. Do not start or stop it on your own.`,
  },

  // ==========================================================================
  // Devices, CGM, technique
  // ==========================================================================
  {
    docId: 'cgm-interpretation',
    title: 'Reading your CGM — time in range',
    section: 'What the numbers on the app mean',
    category: 'devices',
    language: 'en',
    tags: ['cgm', 'time in range', 'sensor', 'libre', 'glucose monitor'],
    sourceCitation: 'ADA Standards of Care 2026, Diabetes Technology; Glycemic Goals',
    content: `A continuous glucose monitor (CGM) is a small sensor worn on the arm or abdomen that measures glucose every few minutes, day and night. Instead of a handful of finger-prick numbers, you get a picture of the whole day.

The main figures your app shows:

- Time in Range: the percentage of time your glucose stayed between 70 and 180 mg/dL. For most non-pregnant adults the aim is above 70 percent, which is roughly 17 hours of the day. Targets are relaxed for older or frail people.
- Time Below Range: time under 70 mg/dL. This is the number to look at first. The aim is under 4 percent of the day, and under 1 percent below 54 mg/dL. Lows matter more than a slightly imperfect average.
- Time Above Range: time over 180 mg/dL.
- Glucose Management Indicator (GMI): an estimate of what your HbA1c is likely to be. It is an estimate, and it can differ from the laboratory result.
- Variability: how much your glucose swings. Flatter is better, even at the same average.

Two things that confuse people:
- A sensor reads the fluid under the skin, not blood, so it lags behind a finger-prick by several minutes. When glucose is changing fast — after a meal, during exercise, or during a low — the two will disagree. That is expected.
- Treat a suspected low based on how you feel, and confirm with a finger-prick if the reading and the symptoms do not match.

Bring your CGM report, or share the app, at your appointment. The pattern over two weeks tells your doctor far more than any single reading.`,
  },
  {
    docId: 'device-troubleshooting',
    title: 'When your meter, sensor, pen or BP machine seems wrong',
    section: 'Practical checks',
    category: 'devices',
    language: 'en',
    tags: ['glucometer', 'meter', 'strips', 'insulin pen', 'bp machine', 'troubleshooting'],
    sourceCitation: 'Clinic protocol; manufacturer guidance',
    content: `Glucose meter reading looks wrong:
- Wash and dry your hands. Fruit, sweets or juice on a finger gives a wildly high result. Alcohol swabs left wet give a low one.
- Check the strips have not expired and that the pot was closed properly. Strips left open absorb moisture and read badly.
- Very cold or very hot rooms affect meters.
- Use the second drop of blood, not the first, and do not squeeze the finger hard.
- If a reading does not match how you feel, wash your hands and repeat before acting on it.

CGM sensor seems wrong:
- Sensors are least accurate in the first day after insertion.
- Pressing on the sensor, including lying on it at night, causes false lows.
- Confirm with a finger-prick whenever the reading and your symptoms disagree.

Insulin pen:
- Always do the small air-shot before injecting, so you know insulin comes out.
- Cloudy insulin must be rolled gently until evenly milky, never shaken hard.
- Insulin that is discoloured, clumped, or has been frozen must be thrown away. Frozen insulin does not work even after thawing.
- Use a new needle each time. A reused needle bends and hurts more.

Blood pressure machine:
- Use an upper-arm machine, not a wrist one, unless your doctor advised otherwise.
- Check the cuff fits your arm. A cuff that is too small reads high.
- Take the machine to your appointment once a year so it can be checked against the clinic's.

If a device is genuinely faulty, bring it in rather than simply stopping your monitoring.`,
  },

  // ==========================================================================
  // Pharmacology and adherence
  // ==========================================================================
  {
    docId: 'pharm-missed-dose',
    title: 'If you miss a dose of a tablet',
    section: 'General rule and important exceptions',
    category: 'pharmacology',
    language: 'en',
    tags: ['missed dose', 'adherence', 'tablet', 'metformin'],
    sourceCitation: 'Clinic protocol',
    content: `The general rule for most regular tablets: take the missed dose as soon as you remember. If it is nearly time for the next one, skip the missed dose and carry on as usual. Never take two doses together to catch up.

Where that general rule is not enough, and you should ask rather than guess:

- Insulin. Timing and type matter too much for a general rule. Follow the specific instruction you were given, and if you do not have one, contact the clinic.
- Sulfonylureas (such as glimepiride, gliclazide). Taking one late, close to the next dose, can cause a low blood sugar. Usually better to skip it and eat normally.
- Levothyroxine. Same-day is fine; if you only remember the next day, take that day's dose as usual.
- Steroids for adrenal insufficiency. Never simply skip. Contact the clinic.
- Weekly injections. There is usually a window within which you can take it late and a point after which you wait for the next scheduled day. Check your leaflet or ask.

If you are missing doses often, that is worth saying plainly at your appointment. It is extremely common, and the answer is usually a simpler regimen or a different timing — not being told to try harder. A pill box, an alarm, or tying the dose to a fixed daily habit like brushing your teeth all help.

Never stop a medicine because you feel well. Most of these medicines work silently, and feeling well is the medicine working.`,
  },
  {
    docId: 'pharm-generic-brand-cost',
    title: 'Generic and brand medicines, and managing cost',
    section: 'Are they the same?',
    category: 'pharmacology',
    language: 'en',
    tags: ['generic', 'brand', 'cost', 'jan aushadhi', 'insurance'],
    sourceCitation: 'Clinic protocol; CDSCO guidance',
    content: `A generic medicine contains the same active ingredient, in the same strength, as the branded one. Approved generics have to show they behave the same way in the body. For most medicines, switching between a quality generic and a brand is safe and can cut the cost substantially.

There are a few where it is better to stay on one consistent product once you are stable, and to tell the clinic if the pharmacy changes it:
- Levothyroxine
- Some epilepsy medicines
- Insulins — different brands and types are genuinely not interchangeable

Practical points for India:
- The same molecule is sold under many brand names. Metformin alone has dozens. If a pharmacy offers a different name, check the ingredient and strength on the strip, not the brand.
- Jan Aushadhi stores stock quality-assured generics at much lower prices.
- Bring the actual strips or the box to appointments. Brand names alone are easy to confuse; the ingredient and strength are what matter.
- If cost is a reason you are skipping doses, say so. There is almost always a cheaper equivalent, and stopping a medicine costs more in the long run than any tablet.

Check with the clinic before starting anything from outside your prescription — including ayurvedic, homeopathic and herbal products. "Natural" does not mean it cannot interact. Several traditional preparations sold for diabetes have been found to contain undeclared steroids or sulfonylureas, which is dangerous alongside your prescribed medicines.`,
  },
  {
    docId: 'pharm-insulin-storage-travel',
    title: 'Storing insulin, and travelling with it',
    section: 'Heat, cold and journeys',
    category: 'insulin',
    language: 'en',
    tags: ['insulin', 'storage', 'travel', 'fridge', 'heat'],
    sourceCitation: 'Manufacturer guidance; ADA Standards of Care 2026',
    content: `Unopened insulin belongs in the fridge, between 2 and 8 °C. Store it in the main body of the fridge, not the door and never against the back wall or the freezer compartment, where it can freeze.

The pen or vial you are currently using can usually stay at room temperature for about 28 days, though some insulins differ — check your leaflet. Keep it out of direct sunlight.

Insulin that has been frozen must be thrown away, even if it looks fine after thawing. So must insulin that is discoloured, cloudy when it should be clear, or has clumps or crystals.

In Indian summers, room temperature can exceed what insulin tolerates. Practical options: a clay pot (matka) kept in a cool corner, a wide-mouthed flask, or an evaporative cooling pouch. Do not put insulin directly on ice.

Travelling:
- Always carry insulin in your hand luggage. Aircraft holds get cold enough to freeze it, and bags get lost.
- Carry more than you need — at least twice the amount for the trip.
- Carry a copy of your prescription and a letter from the clinic for security checks.
- Carry fast-acting sugar in your pocket, not only in your bag.
- On long journeys across time zones, ask the clinic in advance how to shift your timings. Do not work it out mid-flight.

During a power cut, a closed fridge stays cold for several hours. Do not keep opening it.`,
  },

  // ==========================================================================
  // Special populations
  // ==========================================================================
  {
    docId: 'special-ramadan',
    title: 'Fasting safely with diabetes (Ramadan and religious fasts)',
    section: 'Planning ahead',
    category: 'special_populations',
    language: 'en',
    tags: ['ramadan', 'fasting', 'roza', 'vrat', 'religious'],
    sourceCitation: 'IDF-DAR Practical Guidelines; RSSDI recommendations',
    content: `Many people with diabetes fast for religious reasons, and many can do so safely — but it needs planning, not improvisation.

See the clinic 6 to 8 weeks beforehand. Medicine timings and sometimes doses need rearranging, and this cannot be done safely on the first morning of the fast.

Some people are advised not to fast, or to fast only with close supervision — for example those with type 1 diabetes, those who have had a recent severe low or a recent DKA, those with advanced kidney disease, those who no longer feel their lows coming, and pregnant women. Most faith traditions provide alternatives in these situations, and your religious adviser can guide you on those.

If you do fast:
- You must break the fast immediately if your blood sugar falls below 70 mg/dL, rises above 300 mg/dL, or if you feel unwell, shaky, confused or faint. Every major religious authority permits this.
- Checking your blood sugar does not break the fast.
- At the pre-dawn meal, choose slowly absorbed food — whole grains, dal, vegetables, curd — and eat it as late as permitted.
- Break the fast with something simple, then eat a balanced meal. Avoid making the evening meal an occasion for large amounts of sweets and fried food, which is the commonest cause of very high readings during Ramadan.
- Drink plenty of water between the evening and pre-dawn meals.
- Reduce heavy physical exertion during fasting hours. Taraweeh prayers count as activity.

Test more often than usual, not less, particularly in the hours before breaking the fast.`,
  },
  {
    docId: 'special-pregnancy',
    title: 'Diabetes and pregnancy',
    section: 'Planning and gestational diabetes',
    category: 'special_populations',
    language: 'en',
    tags: ['pregnancy', 'gestational', 'gdm', 'planning', 'folic acid'],
    sourceCitation: 'ADA Standards of Care 2026, Management of Diabetes in Pregnancy',
    content: `If you already have diabetes and are planning a pregnancy, tell the clinic before you conceive. The first weeks matter most, often before a pregnancy is confirmed. Blood sugar targets are tighter, folic acid is started beforehand, and several common medicines — including some blood pressure tablets and statins — are changed or stopped before conception.

Gestational diabetes is diabetes that appears during pregnancy, usually found on a screening test between 24 and 28 weeks. It happens because pregnancy hormones make the body resistant to its own insulin. It is not caused by anything you ate or did wrong.

It is treated seriously because well-controlled blood sugar protects the baby from growing too large, from difficult delivery, and from low blood sugar after birth.

Most women manage with diet changes and regular activity. Some need metformin or insulin. Insulin does not cross to the baby and is safe in pregnancy.

Blood sugar is usually checked fasting and after meals, several times a day. Your targets in pregnancy are lower than outside it — your team will give you your specific numbers.

After delivery, gestational diabetes usually resolves. But it is a clear warning: roughly half of women who have had it develop type 2 diabetes within about ten years. A glucose test around 6 to 12 weeks after delivery, and then regularly for life, is important — and it is the test most often forgotten. Breastfeeding, staying active and keeping weight in a healthy range all reduce that risk.`,
  },
  {
    docId: 'special-elderly',
    title: 'Diabetes in older adults',
    section: 'Why targets are relaxed with age',
    category: 'special_populations',
    language: 'en',
    tags: ['elderly', 'older', 'frail', 'hypoglycaemia', 'targets'],
    sourceCitation: 'ADA Standards of Care 2026, Older Adults',
    content: `Blood sugar targets are deliberately relaxed in older adults, and especially in those who are frail or have several other conditions. This is not giving up. It is a considered decision.

The reason is that in older people the danger balance shifts. A slightly higher average sugar causes harm over many years, while a single severe low can cause a fall, a fracture, a confusion episode, or a heart problem today. Older bodies also warn less clearly about a low and recover from it more slowly.

So a healthy, active older person may still aim for a fairly tight target, while someone frail, with memory problems or with several illnesses may be aimed at a looser one, and blood pressure targets may be relaxed too.

What matters most in this age group:
- Avoiding lows. Report every one, even mild.
- Reviewing medicines regularly. The number of tablets tends to grow, and some become unnecessary or unsafe with age.
- Kidney function, which declines naturally and changes which medicines are safe.
- Preventing falls, and keeping eyesight and hearing checked.
- Eating enough. Losing weight without trying is a problem in an older person, not a success.

If you look after an older relative: watch for new confusion, unusual drowsiness, or a change in behaviour. In an older person these can be the first sign of a low sugar, an infection, or a high sugar — not simply "old age".`,
  },
  {
    docId: 'special-transition',
    title: 'Moving from paediatric to adult diabetes care',
    section: 'For young adults',
    category: 'special_populations',
    language: 'en',
    tags: ['transition', 'young adult', 'type 1', 'college'],
    sourceCitation: 'ADA Standards of Care 2026, Children and Adolescents',
    content: `Moving from a children's clinic to an adult one usually happens in the late teens. It is the point at which diabetes control most often slips, so it is worth taking seriously.

What changes: you attend appointments yourself, you order your own supplies, and decisions are discussed with you rather than with your parents. That is a lot of responsibility arriving at the same time as exams, college or a first job.

Practical things that help:
- Learn your own regimen properly — names, doses, timings — rather than relying on a parent who has always managed it.
- Keep supplies where you actually are, including at college or work.
- Tell at least one friend or roommate that you have diabetes, what a low looks like, and what to do. This matters most for anyone on insulin.
- Alcohol deserves specific attention. It can cause a delayed low several hours later, often overnight. Never drink on an empty stomach, eat carbohydrate alongside, and test before sleeping.
- Late nights, irregular meals and skipped injections all show up in your readings. Say so honestly at appointments — the plan can be built around your real life, but only if the clinic knows what it is.

Do not disappear from follow-up because you feel well. The complications that matter are silent for years, and the years between 18 and 30 are exactly when they begin.`,
  },

  // ==========================================================================
  // Preventive care, mental and sexual health
  // ==========================================================================
  {
    docId: 'preventive-screening-schedule',
    title: 'Your yearly checks with diabetes',
    section: 'What is due and when',
    category: 'preventive_care',
    language: 'en',
    tags: ['screening', 'annual', 'eye exam', 'foot exam', 'vaccination'],
    sourceCitation: 'ADA Standards of Care 2026; RSSDI recommendations',
    content: `Most diabetes complications are silent until they are advanced. These checks exist to find them while they can still be treated.

Roughly every 3 months, or as advised:
- HbA1c. More often if your treatment has changed or control is unsettled.
- Blood pressure and weight.

At least once a year:
- Eye examination with the pupils dilated, or retinal photographs. This is not the same as a spectacles test at an optician.
- Feet examined, including sensation testing and pulses.
- Kidney tests — blood creatinine with eGFR, and urine ACR.
- Cholesterol profile.
- Review of every medicine you take.

Also worth keeping in mind:
- Dental check-ups. Gum disease and diabetes worsen each other.
- Thyroid testing, particularly with type 1 diabetes.
- Vitamin B12 if you take metformin long term, which can lower it.

Vaccinations matter more with diabetes because infections hit harder: yearly influenza, pneumococcal, hepatitis B, and COVID-19 boosters as advised. Shingles vaccination is recommended in older adults where available.

Between visits, check your own feet daily and report any wound at once.

If you are unsure what is due, ask at your next appointment and the clinic will tell you what is outstanding. It is easier to catch up than to start again.`,
  },
  {
    docId: 'mental-health-diabetes-distress',
    title: 'Diabetes distress, low mood and sleep',
    section: 'The part that is rarely discussed',
    category: 'mental_health',
    language: 'en',
    tags: ['distress', 'depression', 'burnout', 'sleep', 'anxiety'],
    sourceCitation: 'ADA Standards of Care 2026, Psychosocial Care',
    content: `Diabetes is relentless. There is no day off from it, and the effort is largely invisible to everyone around you. Feeling worn down by it is so common that it has a name: diabetes distress.

It shows up as being tired of testing and injecting, avoiding checking because you dread the number, feeling guilty after eating, arguments at home about food, or a sense that whatever you do the numbers do not cooperate.

This is not weakness and it is not non-compliance. It is a recognised part of living with a chronic condition, and it responds to help.

Depression is roughly twice as common in people with diabetes. Signs worth mentioning: losing interest in things you used to enjoy, sleeping far more or far less, appetite changes, difficulty concentrating, or feeling hopeless most days for more than two weeks.

Sleep matters more than most people expect. Poor sleep raises blood sugar directly. Loud snoring with pauses in breathing and daytime sleepiness may be sleep apnoea, which is common with diabetes and very treatable.

What helps: telling the clinic plainly, rather than saying everything is fine. Targets can be simplified. Regimens can be made less demanding. Counselling and, where appropriate, treatment are available.

Please tell someone today, and go to the nearest hospital, if you are having thoughts of harming yourself. That is an emergency and help is available immediately.`,
  },
  {
    docId: 'sexual-health-diabetes',
    title: 'Diabetes and sexual health',
    section: 'Common, treatable, rarely mentioned',
    category: 'sexual_health',
    language: 'en',
    tags: ['erectile', 'sexual', 'libido', 'dryness', 'testosterone'],
    sourceCitation: 'ADA Standards of Care 2026; Endocrine Society',
    content: `Sexual difficulties are common with diabetes and are hardly ever raised at appointments. They are medical problems with medical answers, and your doctor will have heard them many times before.

In men, erectile difficulty is the commonest. Diabetes affects both the nerves and the small blood vessels involved. It is worth mentioning for two reasons: it is treatable, and because those same small vessels supply the heart, erectile difficulty is sometimes the earliest warning of heart disease. It is a reason to have your heart risk assessed, not only a quality-of-life issue.

Low testosterone is also more common in men with type 2 diabetes, causing low energy, low mood, reduced sex drive and loss of muscle. It is diagnosed with a morning blood test.

In women, higher blood sugar increases thrush and urinary infections, and can cause vaginal dryness and discomfort. Nerve changes can reduce sensation. These are treatable too.

An important safety point: medicines for erectile difficulty must never be combined with nitrate medicines used for angina — the combination can drop blood pressure dangerously. Always tell the clinic every medicine you take, and never use a friend's tablets or something bought without a prescription.

Better blood sugar control, stopping smoking, activity and weight loss all improve sexual function directly.`,
  },

  // ==========================================================================
  // Nutrition in the Indian context
  // ==========================================================================
  {
    docId: 'diet-indian-practical',
    title: 'Eating well with diabetes — Indian meals',
    section: 'Practical swaps, not a foreign diet',
    category: 'diet',
    language: 'en',
    tags: ['diet', 'indian', 'rice', 'roti', 'portion', 'nutrition'],
    sourceCitation: 'ICMR-NIN Dietary Guidelines for Indians; RSSDI recommendations',
    content: `You do not need to eat unfamiliar food to control diabetes. Most of what helps is portion size, balance and order — not giving up your usual meals.

The plate approach, adapted to an Indian thali:
- Half the plate vegetables — sabzi, salad, greens. Cooked or raw both count.
- One quarter protein — dal, rajma, chana, paneer, curd, eggs, fish or chicken if you eat them.
- One quarter carbohydrate — rice, roti, or another grain.

Practical swaps that make a measurable difference:
- Brown or hand-pounded rice instead of polished white rice, and a smaller portion of it. Rice is not forbidden; the quantity is what matters.
- Mixed-grain or whole-wheat roti rather than maida.
- Add dal or curd to a rice meal. Protein alongside carbohydrate slows the sugar rise.
- Eat vegetables and protein first, carbohydrate last in the meal. The same food in a different order gives a lower rise.
- Whole fruit rather than juice. Juice removes the fibre and raises sugar quickly.
- Roasted chana, peanuts, or a small handful of nuts instead of biscuits and namkeen.
- Cut down on sweets, and treat them as occasional rather than daily. At festivals, take a small portion and adjust the rest of the meal rather than skipping meals beforehand.

Watch out for foods sold as healthy that are not: fruit juices, "diabetic" sweets, most breakfast cereals, packaged fruit yoghurt, and multigrain biscuits.

Cooking oil: use a moderate amount of any of mustard, groundnut, rice bran or sesame oil. Limit vanaspati, dalda and repeatedly reheated frying oil.

Do not skip meals to compensate for a high reading. It usually causes a low later, then overeating.`,
  },

  // ==========================================================================
  // Scope of the assistant
  // ==========================================================================
  {
    docId: 'scope-what-assistant-cannot-do',
    title: 'What this assistant can and cannot do',
    section: 'Scope and limits',
    category: 'clinic_info',
    language: 'en',
    tags: ['scope', 'limits', 'assistant', 'disclaimer'],
    sourceCitation: 'Clinic protocol',
    content: `This assistant shares guidance that has been clinically reviewed and approved. It is useful between visits, and it is deliberately limited.

It can:
- Explain what your condition, medicines, tests and reports mean in plain language
- Remind you what to do for a low sugar, a sick day, or daily foot care
- Help you prepare questions for your appointment
- Recognise when something needs urgent attention and alert the clinic

It cannot, and will not:
- Diagnose a new condition
- Start, stop or change the dose of any medicine, including insulin — only your doctor can do that
- Interpret a scan or report that your doctor has not yet discussed with you
- Replace an examination

If you ask it to change a dose, it will decline and offer you an appointment. That is not the assistant being unhelpful. A dose change needs your full history, your other medicines, your kidney function and an examination — things a message cannot provide.

For anything urgent, do not wait for a reply here. Go to the nearest hospital or call the clinic.

Every reply carries a note that it is AI-assisted guidance rather than a diagnosis. If a reply seems wrong or does not fit your situation, use the flag icon to report it. Those reports are reviewed by the clinic, and reporting one genuinely helps.`,
  },

  // ==========================================================================
  // Bengali — highest-value translations
  // ==========================================================================
  {
    docId: 'thyroid-levo-timing-bn',
    title: 'লেভোথাইরক্সিন কীভাবে ও কখন খাবেন',
    section: 'সময়, খাবার ও অন্য ওষুধ',
    category: 'thyroid',
    language: 'bn',
    tags: ['levothyroxine', 'thyroid', 'timing', 'বাংলা'],
    sourceCitation: 'American Thyroid Association — Hypothyroidism guidelines',
    content: `লেভোথাইরক্সিন খাবারের সঙ্গে মিশে গেলে ঠিকমতো শোষিত হয় না। তাই কীভাবে খাচ্ছেন, সেটি ডোজের মতোই গুরুত্বপূর্ণ।

- সকালে ঘুম থেকে উঠে খালি পেটে, শুধু জল দিয়ে খান।
- এর পর অন্তত ৩০ থেকে ৬০ মিনিট চা, কফি, দুধ বা প্রাতরাশ নেবেন না।
- সকালে সম্ভব না হলে, রাতে শোওয়ার সময় শেষ খাবারের অন্তত ৩ ঘণ্টা পরেও খাওয়া যায়। সবচেয়ে জরুরি হল প্রতিদিন একই নিয়ম মেনে চলা।

নিচের জিনিসগুলির সঙ্গে অন্তত ৪ ঘণ্টার ব্যবধান রাখুন, কারণ এগুলি ওষুধের শোষণ কমিয়ে দেয়:
- ক্যালসিয়াম ট্যাবলেট ও অ্যান্টাসিড
- আয়রন ট্যাবলেট
- ক্যালসিয়াম বা আয়রনযুক্ত মাল্টিভিটামিন

একটি ডোজ ভুলে গেলে সেই দিনেই মনে পড়ামাত্র খেয়ে নিন। পরের দিন মনে পড়লে সেদিনের নির্ধারিত ডোজটিই খান। ক্লিনিকে জিজ্ঞাসা না করে একসঙ্গে দুটি ডোজ খাবেন না।

নতুন কোনও ওষুধ শুরু করলে, গর্ভবতী হলে, বা লেভোথাইরক্সিনের ব্র্যান্ড বদলালে ক্লিনিকে জানান — তিনটিই আপনার প্রয়োজনীয় মাত্রা বদলে দিতে পারে।`,
  },
  {
    docId: 'adrenal-steroid-sick-day-bn',
    title: 'স্টেরয়েড নিলে অসুস্থতার দিনের নিয়ম',
    section: 'অ্যাড্রিনাল সংকট',
    category: 'adrenal',
    language: 'bn',
    tags: ['steroid', 'adrenal', 'emergency', 'বাংলা'],
    sourceCitation: 'Endocrine Society — Primary Adrenal Insufficiency guideline',
    content: `আপনি যদি দীর্ঘদিন হাইড্রোকর্টিসোন বা প্রেডনিসোলোন জাতীয় স্টেরয়েড নেন, তবে এই তথ্য আপনার জন্য।

শরীর অসুস্থ হলে স্বাভাবিকভাবে অতিরিক্ত স্ট্রেস হরমোন তৈরি করে। দীর্ঘদিন স্টেরয়েড নিলে আপনার গ্রন্থি সেটি করতে পারে না, তাই অতিরিক্তটুকু ট্যাবলেট থেকেই আসতে হয়।

জ্বর বা সংক্রমণ হলে ডাক্তার আপনাকে যে বাড়তি ডোজের নিয়ম দিয়েছেন, সেটি মেনে চলুন। নিয়ম দেওয়া না থাকলে অসুস্থ হওয়ার দিনেই ক্লিনিকে যোগাযোগ করুন — অপেক্ষা করবেন না।

এখনই হাসপাতালে যান যদি:
- বমি বা পাতলা পায়খানার কারণে ট্যাবলেট পেটে রাখতে না পারেন
- খুব দুর্বল লাগে, মাথা ঘোরে, বা মনে হয় পড়ে যাবেন
- বমির সঙ্গে তীব্র পেটে ব্যথা হয়
- বিভ্রান্ত বা ঝিমুনিভাব আসে

বমি হওয়াটা যতটা সাধারণ শোনায়, ততটা নয়। বমি হয়ে যাওয়া ট্যাবলেট শরীরে শোষিত হয়নি, আর কয়েক ঘণ্টার মধ্যেই অ্যাড্রিনাল সংকট তৈরি হতে পারে।

সবসময় স্টেরয়েড কার্ড সঙ্গে রাখুন এবং প্রত্যেক ডাক্তার, দন্তচিকিৎসক ও সার্জনকে জানান যে আপনি স্টেরয়েড নেন।

দীর্ঘদিনের স্টেরয়েড কখনও হঠাৎ বন্ধ করবেন না।`,
  },

  // ==========================================================================
  // Hindi — highest-value translations
  // ==========================================================================
  {
    docId: 'thyroid-levo-timing-hi',
    title: 'लेवोथायरोक्सिन कैसे और कब लें',
    section: 'समय, भोजन और अन्य दवाएँ',
    category: 'thyroid',
    language: 'hi',
    tags: ['levothyroxine', 'thyroid', 'timing', 'हिन्दी'],
    sourceCitation: 'American Thyroid Association — Hypothyroidism guidelines',
    content: `लेवोथायरोक्सिन भोजन के साथ मिलने पर ठीक से अवशोषित नहीं होती। इसलिए आप इसे कैसे लेते हैं, यह खुराक जितना ही महत्वपूर्ण है।

- सुबह उठकर खाली पेट, केवल सादे पानी के साथ लें।
- इसके बाद कम से कम 30 से 60 मिनट तक चाय, कॉफ़ी, दूध या नाश्ता न लें।
- यदि सुबह संभव न हो, तो रात को सोते समय अंतिम भोजन के कम से कम 3 घंटे बाद भी ले सकते हैं। सबसे ज़रूरी है हर दिन एक ही नियम का पालन करना।

इनसे कम से कम 4 घंटे का अंतर रखें, क्योंकि ये अवशोषण रोकती हैं:
- कैल्शियम की गोलियाँ और एंटासिड
- आयरन की गोलियाँ
- कैल्शियम या आयरन वाले मल्टीविटामिन

खुराक भूल जाएँ तो उसी दिन याद आते ही ले लें। अगले दिन याद आए तो उस दिन की सामान्य खुराक ही लें। क्लिनिक से पूछे बिना एक साथ दो खुराक न लें।

कोई नई दवा शुरू करने पर, गर्भवती होने पर, या लेवोथायरोक्सिन का ब्रांड बदलने पर क्लिनिक को बताएँ — तीनों आपकी आवश्यक मात्रा बदल सकते हैं।`,
  },
  {
    docId: 'gout-acute-hi',
    title: 'गठिया (गाउट) — अचानक जोड़ों का तेज़ दर्द',
    section: 'दौरे के समय क्या करें',
    category: 'gout',
    language: 'hi',
    tags: ['gout', 'uric acid', 'joint', 'हिन्दी'],
    sourceCitation: 'ACR gout guideline; RSSDI clinical practice recommendations',
    content: `गाउट तब होता है जब यूरिक एसिड जोड़ के अंदर नुकीले क्रिस्टल बना लेता है। दर्द कुछ ही घंटों में बढ़ता है, अक्सर रात में, और जोड़ बहुत दर्दनाक, सूजा हुआ, लाल और गर्म हो जाता है। सबसे आम जगह पैर के अंगूठे का जोड़ है।

दौरे के समय:
- जोड़ को आराम दें और ऊँचा रखें।
- कपड़े में लपेटकर बर्फ़ थोड़ी-थोड़ी देर लगाएँ।
- पानी पीते रहें।
- दौरे के लिए डॉक्टर ने जो दवा दी है, वह लें।

महत्वपूर्ण: यदि आप पहले से एलोप्यूरिनॉल या फेबुक्सोस्टेट जैसी लंबी अवधि की दवा ले रहे हैं, तो दौरे के दौरान उसे बंद न करें। बीच में बंद करने से स्थिति आमतौर पर बिगड़ती है।

उसी दिन क्लिनिक से संपर्क करें यदि जोड़ गर्म और सूजा हुआ है और साथ में बुखार है, या आप सामान्य रूप से अस्वस्थ महसूस कर रहे हैं। जोड़ का संक्रमण गाउट जैसा ही दिख सकता है पर उसका इलाज बिल्कुल अलग है।

दौरों के बीच यूरिक एसिड कम करने के लिए: शराब कम करें, मीठे पेय कम करें, कलेजी और लाल मांस कम करें, भरपूर पानी पिएँ, और वज़न धीरे-धीरे घटाएँ — अचानक भूखा रहने से दौरा पड़ सकता है।

लंबी अवधि की दवाएँ रोकथाम के लिए हैं, दर्द निवारक नहीं। इन्हें रोज़ लेना होता है, तब भी जब आप बिल्कुल ठीक महसूस करें।`,
  },
];
