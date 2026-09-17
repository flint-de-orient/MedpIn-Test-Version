import { SOURCES as S } from './guidanceSources.js';

/**
 * Cardiology — patient guidance drafted by an AI, awaiting a cardiologist.
 *
 * ---- Nothing in this file is approved ---------------------------------------
 *
 * Every passage and the scope below are seeded `pending_review` with origin
 * `ai_draft`, and nothing in the platform approves them. A cardiologist at a
 * practice reads them on the knowledge screen and approves them for that
 * practice; until a practice's clinician has approved the scope and enough of
 * the passages, that practice has no cardiology assistant. See
 * services/ai/assistantAvailability.js.
 *
 * ---- How it was written ------------------------------------------------------
 *
 * Each statement was checked against the page cited on its passage, opened on
 * the date in guidanceSources.js: the symptom lists, "when to get help" lists
 * and numbers are the source's own. UK service names (999, 111, A&E, GP) are
 * rendered as "call an ambulance or go to the nearest hospital emergency
 * department", "contact a doctor or your clinic the same day" and "see your
 * doctor" — the same urgency in terms that work in India. The platform does not
 * name a national emergency number anywhere, so these passages do not either.
 *
 * The rules the diabetes corpus follows hold here too: plain language, no
 * dose and no dose change, no brand names, never "this is what you have", and
 * anything time-critical says go now. Numbers a reviewer should check with
 * particular care — blood pressure thresholds, activity minutes, salt — carry
 * their source in the same passage.
 *
 * English only. Retrieval grounds Bengali and Hindi conversations on English
 * passages too and the model answers in the patient's language, which is how
 * the diabetology assistant already works; translations drafted by a machine
 * would need a native-speaking clinician's review of their own, and none are
 * offered here rather than offering ones nobody has checked.
 */

export const CARDIOLOGY_ASSISTANT_SCOPE = Object.freeze({
  departmentKey: 'cardiology',
  role: 'the cardiology assistant',
  covers: [
    'High blood pressure: what the numbers mean, measuring it correctly at home, salt, and the lifestyle changes that help.',
    'Cholesterol: what it is, heart-healthy eating, and taking statins safely.',
    'Coronary heart disease and angina: living with it, the medicines people keep taking, and cardiac rehabilitation after a heart attack.',
    'Heart failure self-care: weighing yourself, noticing when symptoms are getting worse, and what to report.',
    'Atrial fibrillation and blood-thinning medicines: why they are used, bleeding warning signs, and safety with other medicines.',
    'Heart symptoms (palpitations, fainting, dizziness on standing, swollen ankles) and when each needs urgent care.',
    'What heart tests such as an ECG or an echocardiogram involve — not what a result means.',
    'Heart-healthy living: physical activity, stopping tobacco, alcohol, flu vaccination, and staying safe in hot weather.',
  ],
  refuses: [
    'Diagnosing a heart condition, or telling the patient whether a symptom is or is not coming from the heart.',
    "Interpreting this patient's own ECG, echocardiogram, angiogram, stress test, blood tests or blood pressure readings — what a result means for them is for their doctor.",
    'Starting, stopping, skipping, splitting or changing the dose of any medicine, including blood thinners, antiplatelets, statins, beta blockers and water tablets.',
    'Advice on procedures, devices or surgery (angioplasty, stents, pacemakers, bypass or valve surgery) beyond what the care team has already told the patient.',
    "Other specialties' problems, such as diabetes treatment, pregnancy care, a child's illness or a mental-health crisis — suggest the right doctor or service.",
  ],
  redFlags: [
    'Chest pain or discomfort that does not go away, that spreads to the arms, neck, jaw, back or stomach, or that comes with sweating, feeling sick, light-headedness or breathlessness.',
    'Angina pain that does not stop after resting for a few minutes and using the angina medicine as prescribed.',
    'Severe difficulty breathing — gasping, choking or unable to get words out — or lips or skin turning pale, blue or grey.',
    'Signs of a stroke: one side of the face drooping, weakness in one arm, or slurred or confused speech — even if they have gone away.',
    'A fast or irregular heartbeat together with chest pain, breathlessness, fainting, dizziness, a severe headache, weakness on one side, blurred vision or confusion.',
    'Fainting while exercising or while lying down, fainting with chest pain or a pounding or irregular heartbeat, or not waking within a minute.',
    'On a blood thinner or antiplatelet: coughing up blood, vomiting blood or vomit that looks like coffee grounds, black sticky stools, a nosebleed lasting more than 10 to 15 minutes, or a sudden bad headache with confusion, slurred speech or weakness.',
    'Very high blood pressure together with symptoms such as a severe headache, chest pain, difficulty breathing, confusion or changes in vision.',
    'Swollen legs or ankles together with breathlessness, a tight or painful chest, coughing up blood, or feeling faint, confused or clammy.',
    'Swelling of the lips, tongue, face or throat, or difficulty breathing, after taking a medicine.',
  ],
  sources: [
    S.nhsHeartAttack,
    S.nhsChestPain,
    S.nhsAngina,
    S.nhsHeartFailure,
    S.nhsStrokeSymptoms,
    S.nhsAtrialFibrillation,
    S.nhsFainting,
    S.nhsClopidogrelSideEffects,
    S.nhsStomachAche,
    S.whoHypertension,
    S.nhsOedema,
    S.nhsRamiprilSideEffects,
  ],
});

export const CARDIOLOGY_DRAFTS = [
  // ==========================================================================
  // Blood pressure
  // ==========================================================================
  {
    docId: 'cardio-bp-what-it-is',
    title: 'High blood pressure: what it is and why it matters',
    section: 'Understanding high blood pressure',
    category: 'hypertension',
    tags: ['blood pressure', 'hypertension', 'risk', 'symptoms'],
    sources: [S.whoHypertension, S.nhsHighBloodPressure],
    content: `High blood pressure (hypertension) means the pressure in your blood vessels is too high. Over time it can lead to serious problems such as heart attacks and strokes.

Most people with high blood pressure do not feel any symptoms. The only way to know is to have your blood pressure checked.

Things that make high blood pressure more likely include eating too much salt, a diet high in saturated and trans fats, eating few fruits and vegetables, not being physically active, using tobacco, drinking alcohol, and being overweight. A family history of high blood pressure, being over 65, and having diabetes or kidney disease also raise the risk.

Very high blood pressure can cause symptoms such as a severe headache, chest pain, dizziness, difficulty breathing, feeling sick or vomiting, blurred vision or other changes in vision, confusion, nosebleeds or an abnormal heart rhythm. If you have any of these symptoms together with high blood pressure, seek care immediately.

If you have been prescribed medicine for blood pressure, take it exactly as your doctor prescribed.`,
  },
  {
    docId: 'cardio-bp-numbers',
    title: 'Understanding your blood pressure numbers',
    section: 'What the two numbers mean',
    category: 'hypertension',
    tags: ['blood pressure', 'systolic', 'diastolic', 'reading', 'numbers'],
    sources: [S.nhsBloodPressureTest, S.whoHypertension],
    content: `A blood pressure reading has two numbers, written like 140/90.

- The first (top) number is the systolic pressure: the highest level your blood pressure reaches when your heart pumps blood around the body.
- The second (bottom) number is the diastolic pressure: the lowest level it reaches when your heart relaxes between beats.

Blood pressure is usually considered high if it is 140/90 or higher when checked by a health professional, or 135/85 or higher when checked at home.

High blood pressure is not diagnosed from a single reading. The World Health Organization says hypertension is diagnosed when readings taken on two different days both show a top number of 140 or more and/or a bottom number of 90 or more.

What your own readings mean for you, and what your target should be, is for your doctor to explain. Do not change any medicine because of a reading — write your readings down and share them with your care team.`,
  },
  {
    docId: 'cardio-bp-home-measurement',
    title: 'How to measure your blood pressure at home',
    section: 'Getting an accurate reading',
    category: 'hypertension',
    tags: ['blood pressure', 'home monitoring', 'measuring', 'cuff', 'log'],
    sources: [S.cdcMeasureBloodPressure, S.nhsBloodPressureTest, S.whoHypertension],
    content: `Home readings are most useful when they are taken the same way every time.

Before you measure:
- Do not eat or drink anything for 30 minutes.
- Empty your bladder.
- Sit in a comfortable chair with your back supported for at least 5 minutes.

While you measure:
- Put both feet flat on the ground and keep your legs uncrossed.
- Rest your arm with the cuff on a table at chest height.
- The cuff should be snug but not too tight, and against your bare skin, not over clothing.
- Do not talk while the reading is being taken.

Take at least two readings, 1 or 2 minutes apart, and measure at the same time every day. Write your readings in a log and share them with your care team. Ask your care team how often you should measure.

If a reading is high and you also have symptoms such as a severe headache, chest pain, difficulty breathing, confusion or changes in your vision, seek care immediately.`,
  },
  {
    docId: 'cardio-salt',
    title: 'Salt and your blood pressure',
    section: 'How much salt, and how to cut down',
    category: 'diet',
    tags: ['salt', 'sodium', 'blood pressure', 'diet', 'processed food'],
    sources: [S.whoSodium, S.whoHealthyDiet, S.whoHypertension],
    content: `Eating too much salt raises blood pressure, which increases the risk of heart disease and stroke.

The World Health Organization recommends that adults eat less than 5 grams of salt a day — just under a teaspoon. That is less than 2,000 mg of sodium. In 2021 adults around the world ate about 11 grams of salt a day on average, more than double that amount.

In many countries a large share of the salt people eat comes from processed foods, not only from salt added while cooking or at the table.

Ways to cut down:
- Eat mostly fresh, minimally processed foods.
- Cook with little or no added salt, and limit salty condiments when cooking.
- Use herbs and spices to flavour food instead of salt.
- Limit processed foods.

Eating less salt helps, but it does not replace any blood pressure medicine you have been prescribed. Keep taking your medicines as prescribed.`,
  },
  {
    docId: 'cardio-bp-lifestyle',
    title: 'Lifestyle changes that help lower blood pressure',
    section: 'What you can do',
    category: 'hypertension',
    tags: ['blood pressure', 'lifestyle', 'exercise', 'weight', 'alcohol', 'smoking'],
    sources: [S.nhsHighBloodPressure, S.whoHypertension, S.whoAlcohol],
    content: `Changes to daily life can help lower blood pressure, alongside any medicine your doctor has prescribed:

- Eat a healthy, balanced diet with plenty of vegetables and fruit.
- Do not eat too much salt.
- Be active: aim for at least 150 minutes of moderate-intensity activity a week, or 75 minutes of vigorous activity.
- Lose weight if you are overweight.
- Do not smoke or use tobacco.
- Cut down on alcohol. The World Health Organization says there is no form of drinking alcohol that is free of risk.
- Do not drink too much caffeine.

If you take blood pressure medicine, keep taking it while you make these changes. Only your doctor can decide whether a medicine can be reduced or stopped.`,
  },
  {
    docId: 'cardio-bp-emergency',
    title: 'When high blood pressure or heart symptoms need emergency care',
    section: 'Signs that cannot wait',
    category: 'emergency',
    tags: ['emergency', 'blood pressure', 'chest pain', 'stroke', 'red flags'],
    sources: [S.whoHypertension, S.nhsHighBloodPressure, S.nhsChestPain, S.nhsStrokeSymptoms],
    content: `Seek care immediately — go to the nearest hospital emergency department — if you have high blood pressure together with symptoms such as:
- a severe headache
- chest pain
- difficulty breathing
- dizziness, confusion, blurred vision or other changes in your vision
- feeling sick or vomiting
- nosebleeds or an abnormal heart rhythm

Call an ambulance straight away for:
- sudden chest pain or discomfort that does not go away
- chest pain that spreads to your left or right arm, or your neck, jaw, stomach or back
- chest pain with sweating, feeling sick, light-headedness or shortness of breath
- signs of a stroke, such as one side of the face drooping, weakness in one arm, or slurred speech

Contact your clinic the same day if you often get headaches or blurred vision, or you have chest pain that comes and goes.

Do not try to bring your blood pressure down yourself by taking extra doses of any medicine.`,
  },
  {
    docId: 'cardio-low-bp',
    title: 'Low blood pressure and dizziness when standing up',
    section: 'Symptoms and what helps',
    category: 'cardiac_symptoms',
    tags: ['low blood pressure', 'hypotension', 'dizziness', 'fainting', 'postural'],
    sources: [S.nhsLowBloodPressure, S.nhsRamiprilSideEffects, S.nhsFainting],
    content: `Low blood pressure is a reading of less than 90/60. Symptoms can include light-headedness or dizziness, feeling sick, blurred vision, generally feeling weak, confusion and fainting.

If symptoms come on when you stand up or change position suddenly, this may be a type called postural hypotension. Some medicines can cause low blood pressure; feeling dizzy or light-headed when you stand up or sit up quickly is a common side effect of some blood pressure medicines.

Things that can help:
- Get up slowly from sitting to standing.
- When getting out of bed, move slowly from lying to sitting to standing.

See your doctor if you keep getting symptoms such as dizziness or fainting. Do not stop or reduce a blood pressure medicine yourself — tell your clinic, so your doctor can review it.

Call an ambulance if someone faints and cannot be woken within a minute, has chest pain or a pounding or irregular heartbeat, or has not fully recovered or has difficulty speaking or moving.`,
  },

  // ==========================================================================
  // Cholesterol
  // ==========================================================================
  {
    docId: 'cardio-cholesterol-basics',
    title: 'Cholesterol: what it is and how it is checked',
    section: 'Understanding cholesterol',
    category: 'dyslipidaemia',
    tags: ['cholesterol', 'hdl', 'non-hdl', 'blood test', 'lipids'],
    sources: [S.nhsHighCholesterol, S.nhsCholesterolLevels],
    content: `Cholesterol is a fatty substance in your blood. Too much cholesterol can block your blood vessels, and it makes you more likely to have heart problems or a stroke.

High cholesterol does not usually cause symptoms. You can only find out if you have it from a blood test.

A cholesterol test can measure:
- total cholesterol — the overall amount of cholesterol in your blood
- HDL cholesterol, often called "good" cholesterol, which may make you less likely to have heart problems or a stroke
- non-HDL cholesterol — the difference between your total cholesterol and your HDL

You are more likely to have high cholesterol if you are over 50, a man, have been through the menopause, or are of South Asian origin, and it can run in families. Eating fatty food, not exercising enough, being overweight, smoking and drinking alcohol can also cause it.

What a good level is for you depends on your age, your health conditions and your risk of heart disease, so your doctor will explain your own results and targets.`,
  },
  {
    docId: 'cardio-cholesterol-lifestyle',
    title: 'Lowering cholesterol through food and activity',
    section: 'What to eat more of and less of',
    category: 'dyslipidaemia',
    tags: ['cholesterol', 'diet', 'saturated fat', 'ghee', 'exercise'],
    sources: [S.nhsLowerCholesterol, S.nhsHighCholesterol, S.whoHealthyDiet],
    content: `You can lower your cholesterol by eating healthily and getting more exercise. Some people also need medicine — if you have been prescribed one, keep taking it.

Eat more of:
- oily fish
- oils such as olive oil or rapeseed oil
- brown rice, wholegrain bread and wholewheat pasta
- nuts and seeds
- fruit and vegetables

Eat less of:
- fatty meat, meat pies and sausages
- butter, lard and ghee
- cream and cheese
- cakes and biscuits
- food that contains coconut oil or palm oil

The World Health Organization suggests steaming or boiling food instead of frying, and replacing butter, lard and ghee with oils rich in polyunsaturated fat.

Aim for at least 150 minutes of moderate-intensity exercise, or 75 minutes of vigorous activity, a week. Smoking can raise your cholesterol and makes heart attacks and strokes more likely. If you drink alcohol, keep several drink-free days each week.`,
  },
  {
    docId: 'cardio-statins',
    title: 'Statins: taking them safely',
    section: 'Why they are prescribed and what to watch for',
    category: 'pharmacology',
    tags: ['statins', 'cholesterol medicine', 'side effects', 'muscle pain', 'grapefruit'],
    sources: [S.nhsStatins, S.nhsAtorvastatinSideEffects],
    content: `Statins are medicines that lower cholesterol and help stop your body producing too much of it. They are usually taken long term, as a tablet once a day.

- Keep taking your statin as prescribed. Stopping can affect your cholesterol levels, so talk to your doctor or pharmacist before stopping.
- Grapefruit and grapefruit juice can increase the side effects of some statins — check with your pharmacist.
- Some other medicines interact with statins, including some antibiotics, antifungal medicines, HIV medicines and warfarin. Tell any doctor or pharmacist that you take a statin.
- Statins are not suitable if you are pregnant or trying to get pregnant. Tell your doctor if this applies to you.

Common side effects include headaches, dizziness, feeling sick, digestive problems such as constipation or diarrhoea, and muscle aches.

Contact your clinic or a doctor the same day if you have muscle cramps with severe pain or weakness, or yellowing of your skin or the whites of your eyes. Call an ambulance if your throat or tongue swells or you have difficulty breathing.`,
  },

  // ==========================================================================
  // Heart attack, stroke, angina, coronary heart disease
  // ==========================================================================
  {
    docId: 'cardio-heart-attack',
    title: 'Heart attack: symptoms and what to do',
    section: 'An emergency — call an ambulance',
    category: 'emergency',
    tags: ['heart attack', 'chest pain', 'emergency', 'ambulance', 'cpr'],
    sources: [S.nhsHeartAttack, S.whoCardiovascular],
    content: `A heart attack is a medical emergency. Call an ambulance immediately for:
- chest pain that may feel like crushing or squeezing, which can spread to the arm, neck and jaw
- pain or discomfort in the centre of the chest, or in the arms, left shoulder, elbows, jaw or back
- severe difficulty breathing
- pale, blue or grey skin
- loss of consciousness

Other symptoms can include shortness of breath, feeling sick, sweating, and a feeling like indigestion — a burning feeling in the chest, or feeling full or bloated.

While you wait for help:
- Do not drive yourself to hospital.
- Sit and rest on the floor in a comfortable position, with your knees bent and your back supported.
- If you have angina and have been prescribed a spray for it, use it as your doctor told you.
- If someone stops responding and stops breathing, start CPR.`,
  },
  {
    docId: 'cardio-stroke-fast',
    title: 'Stroke: know the signs (FAST)',
    section: 'An emergency — call an ambulance',
    category: 'emergency',
    tags: ['stroke', 'fast', 'face', 'arm weakness', 'speech', 'emergency'],
    sources: [S.nhsStrokeSymptoms, S.whoCardiovascular],
    content: `A stroke is a medical emergency. FAST is the easiest way to remember the main signs:
- Face: one side of the face may droop, and it might be hard to smile.
- Arms: the person may not be able to fully lift both arms and keep them there, because of weakness or numbness in one arm.
- Speech: words may be slurred, or the person may sound confused.
- Time: it is time to call an ambulance.

Other signs include sudden weakness or numbness down one side of the body, blurred vision or loss of sight in one or both eyes, finding it difficult to speak or think of words, confusion and memory loss, feeling dizzy or falling over, a severe headache, and feeling or being sick.

Call an ambulance immediately if you think someone is having, or has had, a stroke. Signs of a stroke within the last 24 hours need emergency help even if they have now stopped.`,
  },
  {
    docId: 'cardio-angina',
    title: 'Angina: what it is and what to do during an attack',
    section: 'Managing angina pain',
    category: 'coronary_heart_disease',
    tags: ['angina', 'chest pain', 'gtn', 'coronary', 'triggers'],
    sources: [S.nhsAngina],
    content: `Angina is pain or tightness, usually in the chest, that can be a sign of a heart problem. It can be felt in the chest, neck, shoulders, jaw or arms, and may feel like tightness, squeezing or pressure, or a dull ache. Some people also feel sick, breathless, dizzy or sweaty.

It is often brought on by exercise, stress, emotion or cold temperatures, although sometimes there is no obvious trigger.

During an angina attack:
- Stop what you are doing and rest.
- Use the angina medicine your doctor has prescribed, exactly as you were told to use it.
- Call an ambulance if the chest pain does not stop after resting for a few minutes and using your medicine as instructed.

Call an ambulance straight away for sudden chest pain or discomfort that does not go away.

Contact your clinic the same day if your angina feels worse than before, happens more often, lasts longer, or comes on when you are resting, or if you have chest pain that comes and goes.`,
  },
  {
    docId: 'cardio-chd-living',
    title: 'Living with coronary heart disease',
    section: 'Treatment and everyday care',
    category: 'coronary_heart_disease',
    tags: ['coronary heart disease', 'heart attack recovery', 'medicines', 'lifestyle'],
    sources: [S.nhsCoronaryHeartDisease, S.nhsHeartAttack],
    content: `Coronary heart disease is what happens when the heart's blood supply is blocked or interrupted by a build-up of fatty substances in the coronary arteries. Its main symptoms are chest pain (angina), shortness of breath, pain in the neck, shoulders, jaw or arms, feeling faint and feeling sick.

It cannot be cured, but treatment can help manage the symptoms and reduce the chances of problems such as heart attacks. Treatment can include lifestyle changes, medicines, angioplasty with stents, and surgery.

After a heart attack, long-term medicines usually include antiplatelets to help stop your arteries getting blocked, statins to lower your cholesterol, and other medicines to lower blood pressure, such as ACE inhibitors and beta blockers. Take them exactly as prescribed and do not stop any of them without talking to your doctor.

Things you can do:
- stop smoking
- eat a healthy, balanced diet, with less salt and saturated fat
- try to maintain a healthy weight
- exercise regularly
- cut down on alcohol

It is common to feel anxious or low after a heart attack. Talk to your doctor if you feel anxious or have low mood.`,
  },
  {
    docId: 'cardio-antiplatelets',
    title: 'Antiplatelet medicines after a heart attack or stent',
    section: 'Why they must not be stopped',
    category: 'anticoagulation',
    tags: ['antiplatelet', 'clopidogrel', 'stent', 'bleeding', 'heart attack'],
    sources: [S.nhsClopidogrelHow, S.nhsClopidogrelSideEffects, S.nhsHeartAttack, S.nhsStomachAche],
    content: `Antiplatelet medicines, such as clopidogrel, help stop your arteries getting blocked. People often take them after a heart attack or a stent.

- You may need to take clopidogrel for a few weeks or months, or for the rest of your life. Your doctor will tell you how long.
- Do not stop taking it unless your doctor tells you to. If you stop, you may be at increased risk of serious problems like heart attacks or strokes.
- If you forget a dose, check the leaflet that came with your medicine or ask your pharmacist what to do. Do not take two doses to make up for a missed one.
- You may bleed more easily than normal.

Contact your clinic or a doctor the same day if there is blood in your pee or poo, or you have hit your head.

Go to the nearest hospital emergency department now if you cough up blood, vomit blood or vomit that looks like coffee grounds, pass black, sticky poo, have a nosebleed that lasts longer than 10 to 15 minutes, or have a sudden bad headache with confusion, sensitivity to light, slurred speech or difficulty moving your arms or legs.`,
  },
  {
    docId: 'cardio-cardiac-rehab',
    title: 'Cardiac rehabilitation',
    section: 'Recovering after a heart problem',
    category: 'cardiac_rehabilitation',
    tags: ['cardiac rehabilitation', 'recovery', 'exercise', 'heart attack', 'heart failure'],
    sources: [S.cdcCardiacRehabilitation, S.nhsHeartAttack, S.nhsHeartFailure],
    content: `Cardiac rehabilitation ("cardiac rehab") is a programme for people recovering from a heart attack, heart failure, or another heart problem that needed surgery or medical care.

It usually includes:
- physical activity
- education about healthy living, including how to eat healthily, take medicines as prescribed and quit smoking
- counselling to find ways to relieve stress and improve mental health

A team may help you through it, including your health care team, exercise and nutrition specialists, physiotherapists and counsellors. It can help strengthen your heart and body after a heart attack, relieve symptoms such as chest pain, and build healthier habits. It helps men and women of all ages with mild, moderate or severe heart problems.

After a heart attack people are usually referred to cardiac rehabilitation, and people with heart failure should be referred for an assessment. Some programmes are in person and some take place from home using video calls or apps.

Ask your cardiologist whether cardiac rehabilitation is right for you and how to join a programme.`,
  },
  {
    docId: 'cardio-physical-activity',
    title: 'Staying physically active with a heart condition',
    section: 'How much, and staying safe',
    category: 'exercise',
    tags: ['exercise', 'physical activity', 'walking', 'heart', 'safety'],
    sources: [S.whoHypertension, S.whoPhysicalActivity, S.cdcCardiacRehabilitation, S.nhsAngina, S.nhsFainting, S.nhsBetaBlockers],
    content: `Regular physical activity is good for your heart. For adults, the World Health Organization advises at least 150 minutes a week of moderate-intensity aerobic activity, or 75 minutes of vigorous activity. Any amount of physical activity is better than none, and all activity counts. Try to limit the time you spend sitting still. Muscle-strengthening activity benefits everyone.

If you have a heart condition:
- Ask your care team what kind and amount of activity is right for you.
- After a heart attack, heart surgery or with heart failure, cardiac rehabilitation offers activity with a team to guide you.
- If angina comes on, stop and rest, and use your prescribed angina medicine as instructed. Call an ambulance if the pain does not stop after resting for a few minutes and using your medicine.
- If a beta blocker makes you feel dizzy, do not drive, ride a bike or use machinery until the dizziness stops.

Fainting while exercising needs emergency help — call an ambulance.`,
  },

  // ==========================================================================
  // Heart failure
  // ==========================================================================
  {
    docId: 'cardio-hf-what-it-is',
    title: 'Heart failure: what it means',
    section: 'Understanding heart failure',
    category: 'heart_failure',
    tags: ['heart failure', 'breathlessness', 'swelling', 'tiredness'],
    sources: [S.nhsHeartFailure],
    content: `Heart failure means your heart cannot pump blood around your body properly. It does not mean your heart has stopped working or is about to stop working.

Main symptoms include:
- feeling out of breath when doing everyday activities or when lying down
- feeling weak, light-headed or very tired, particularly after moving
- swelling in your feet, ankles, legs or tummy, or feeling bloated
- sudden weight gain

It can happen suddenly, for example after a heart attack, or develop because of long-term strain on the heart from conditions such as high blood pressure, coronary heart disease, heart valve disease, heart rhythm problems, kidney disease, anaemia or thyroid problems.

Treatment may include medicines such as water tablets (diuretics), medicines that widen the blood vessels, and beta blockers, and sometimes a device such as a pacemaker, or surgery. Take your medicines exactly as your doctor has prescribed.`,
  },
  {
    docId: 'cardio-hf-self-care',
    title: 'Looking after yourself with heart failure',
    section: 'Everyday self-care',
    category: 'heart_failure',
    tags: ['heart failure', 'weight', 'fluid', 'salt', 'self-care', 'vaccination'],
    sources: [S.nhsHeartFailure, S.nhlbiLivingWithHeartFailure, S.imdHeatWave],
    content: `Things that help every day:

- Take your medicines exactly as your doctor has prescribed.
- Weigh yourself regularly. A build-up of fluid can cause sudden weight gain. Ask your care team how often to weigh yourself and when to report a change in your weight.
- Weight gain, ankle swelling or increasing shortness of breath may mean fluid is building up in your body — tell your care team.
- You may be asked to limit salt and how much you drink, to reduce fluid build-up. Follow the advice your care team gives you.
- Have the vaccinations you are offered, such as the flu vaccine.
- Stay active; you should be referred for a cardiac rehabilitation assessment.
- Eat a balanced diet, keep to a healthy weight, try to quit smoking, and cut down on alcohol if you drink.
- Get care for other conditions that can make heart failure worse, such as diabetes, high blood pressure, obesity, sleep apnoea, and lung, kidney or liver disease.
- Keep phone numbers handy for your clinic, the hospital, and someone who can take you for medical care.

In hot weather, if you have been told to limit fluids, ask your doctor before drinking more than usual.`,
  },
  {
    docId: 'cardio-hf-worsening',
    title: 'Heart failure: when to get urgent or emergency help',
    section: 'Signs that heart failure is getting worse',
    category: 'emergency',
    tags: ['heart failure', 'emergency', 'breathlessness', 'weight gain', 'red flags'],
    sources: [S.nhsHeartFailure, S.nhlbiLivingWithHeartFailure],
    content: `Call an ambulance or go to the nearest hospital emergency department now if:
- you have severe difficulty breathing — you are gasping, choking or not able to get words out
- your lips or skin are pale, blue or grey (on brown or black skin this may be easier to see on the palms of the hands, the soles of the feet or the gums)
- someone has passed out and is not responding normally

Contact your clinic or a doctor the same day if:
- you feel breathless when lying down or with everyday activity
- you are coughing up frothy pink phlegm
- you have suddenly gained weight

Watch for new or worsening symptoms and tell your care team about them. Do not take extra doses of water tablets or change any medicine yourself — your doctor will decide what needs to change.`,
  },

  // ==========================================================================
  // Heart rhythm and blood thinners
  // ==========================================================================
  {
    docId: 'cardio-af',
    title: 'Atrial fibrillation (AF)',
    section: 'Symptoms, treatment and when to get help',
    category: 'atrial_fibrillation',
    tags: ['atrial fibrillation', 'af', 'irregular heartbeat', 'palpitations', 'stroke risk'],
    sources: [S.nhsAtrialFibrillation],
    content: `Atrial fibrillation (AF) is a heart rhythm problem where your heartbeat is not steady. It can cause:
- an irregular pulse
- heart palpitations that last a few seconds or minutes
- a heartbeat faster than 100 beats a minute
- feeling very tired, or finding it harder to exercise
- chest pain or tightness, or feeling short of breath, light-headed or dizzy

Sometimes there are no symptoms.

Treatment may include medicines, including anticoagulants to lower the risk of blood clots and stroke, and procedures such as cardioversion or ablation, or a pacemaker.

Call an ambulance now if you have a fast or irregular heartbeat together with chest pain, shortness of breath, sweating, feeling or being sick, fainting, feeling dizzy or falling over, a severe headache, weakness or numbness on one side of your face or body, blurred vision or loss of sight, or confusion or difficulty speaking.

See your doctor if you think you may have symptoms of AF, if palpitations keep happening or are getting worse, or if you have AF and treatment is not helping your symptoms.`,
  },
  {
    docId: 'cardio-anticoagulants',
    title: 'Anticoagulants (blood thinners): taking them safely',
    section: 'Everyday safety',
    category: 'anticoagulation',
    tags: ['anticoagulant', 'blood thinner', 'warfarin', 'apixaban', 'bleeding', 'interactions'],
    sources: [S.nhsAnticoagulants, S.nhsApixabanInteractions, S.nhsApixabanSideEffects, S.nhsWarfarin],
    content: `Anticoagulants are medicines that help prevent blood clots. Examples include warfarin, apixaban, rivaroxaban, dabigatran and edoxaban, and heparin injections.

- Your doctor or nurse should tell you how much to take and when. Take it exactly as prescribed.
- If you are unsure how to take it, or are worried that you have missed a dose or taken too much, check the leaflet that came with your medicine or ask your doctor, anticoagulant clinic or pharmacist.
- Speak to your doctor or pharmacist before taking any other medicine, including ones bought without a prescription, as some can affect how your anticoagulant works. Anti-inflammatory painkillers (NSAIDs) and the herbal remedy St John's wort are among those that may not mix well.
- If you have an anticoagulant alert card, carry it, and show it to your doctor or dentist before any medical or dental procedure.

The main risk is bleeding. Signs include blood in your pee, blood in your poo or black poo, severe bruising, nosebleeds that go on for a long time, bleeding gums, vomiting blood or coughing up blood, and heavy periods. Tell your clinic straight away if you notice any of these. Vomiting or coughing up blood, or a sudden bad headache with confusion, slurred speech or difficulty moving your arms or legs, needs urgent medical help.`,
  },
  {
    docId: 'cardio-bleeding-emergency',
    title: 'Bleeding while on a blood thinner: when it is an emergency',
    section: 'Signs that cannot wait',
    category: 'emergency',
    tags: ['bleeding', 'blood thinner', 'antiplatelet', 'emergency', 'head injury'],
    sources: [S.nhsClopidogrelSideEffects, S.nhsApixabanSideEffects, S.nhsStomachAche, S.nhsHeadInjury],
    content: `If you take an anticoagulant (such as warfarin or apixaban) or an antiplatelet medicine (such as clopidogrel), bleeding needs to be taken seriously.

Go to the nearest hospital emergency department now, or call an ambulance, if you:
- cough up blood
- vomit blood, or your vomit looks like coffee grounds
- pass poo that is bloody, or black and sticky
- have a nosebleed that lasts longer than 10 to 15 minutes
- have a sudden bad headache with confusion, sensitivity to light, slurred speech, or difficulty moving your arms or legs

Contact your clinic or a doctor the same day if you:
- have hit your head
- see blood in your pee or poo
- are bleeding from a wound after surgery

Do not stop your blood thinner yourself. Tell the doctors treating you which blood thinner you take.`,
  },
  {
    docId: 'cardio-warfarin',
    title: 'Warfarin: blood tests, food and other medicines',
    section: 'Living with warfarin',
    category: 'anticoagulation',
    tags: ['warfarin', 'inr', 'vitamin k', 'interactions', 'alcohol'],
    sources: [S.nhsWarfarin],
    content: `Warfarin is an anticoagulant (a blood thinner) that treats and prevents blood clots. It is used, for example, to lower the risk of clots in people with atrial fibrillation or an artificial heart valve.

- While you take warfarin you need regular blood tests, called INR tests, to measure how quickly your blood clots. Go to every test your clinic arranges.
- If you miss a dose, follow the instructions your warfarin clinic gave you. Never take two doses to make up for a missed one.
- Foods high in vitamin K, such as broccoli, spinach and other green leafy vegetables, can affect how warfarin works. You can still eat them — talk to your warfarin clinic for advice.
- Avoid large amounts of alcohol, and avoid cranberry juice and grapefruit juice.
- Many medicines and supplements affect warfarin, including anti-inflammatory painkillers (NSAIDs), some antibiotics, and the herbal remedy St John's wort. Check with your doctor or pharmacist before taking anything new.
- Carry your anticoagulant alert card and show it to your doctor or dentist before any procedure.

Get urgent medical help for blood in your pee or poo, unexplained bruising or nosebleeds, coughing up or vomiting blood, or a sudden bad headache with confusion, slurred speech or difficulty moving your arms or legs.`,
  },

  // ==========================================================================
  // Symptoms
  // ==========================================================================
  {
    docId: 'cardio-palpitations',
    title: 'Heart palpitations',
    section: 'Common triggers and when to worry',
    category: 'cardiac_symptoms',
    tags: ['palpitations', 'racing heart', 'irregular heartbeat', 'caffeine', 'anxiety'],
    sources: [S.nhsPalpitations],
    content: `Palpitations are when your heartbeat feels like it is racing or beating very fast, irregular with skipped or extra beats, pounding or thumping, or fluttering. They are common and not usually a sign of anything serious.

Common triggers include strenuous exercise, lack of sleep, stress and anxiety, some medicines, alcohol, caffeine, nicotine and recreational drugs. If palpitations are not caused by a health condition, avoiding triggers such as stress, smoking, caffeine and alcohol can help.

See your doctor if palpitations keep coming back or happen more often, last longer than a few minutes, or if you have a heart condition or a family history of heart problems.

Call an ambulance or go to the nearest hospital emergency department now if you have palpitations that do not go away, or palpitations together with chest pain, shortness of breath, or feeling faint or fainting.`,
  },
  {
    docId: 'cardio-fainting',
    title: 'Fainting: what to do and when to get help',
    section: 'First aid and warning signs',
    category: 'cardiac_symptoms',
    tags: ['fainting', 'syncope', 'passing out', 'dizziness', 'first aid'],
    sources: [S.nhsFainting],
    content: `If you feel you are about to faint:
- lie down with your legs raised — if you cannot, sit with your head lowered between your knees
- drink some water
- cross your legs while standing, or rock up and down on your toes
- clench your fists

If someone faints, lay them on their back and raise their legs. If they are pregnant, especially more than 28 weeks pregnant, lay them on their side instead.

Anyone who has fainted should see a doctor. It is probably nothing serious, but it is important to get checked.

Call an ambulance now if the person:
- is not breathing
- cannot be woken up within 1 minute
- has not fully recovered, or has difficulty speaking or moving
- has chest pain or a pounding, fluttering or irregular heartbeat
- has seriously hurt themselves
- is shaking or jerking (having a seizure or fit)
- fainted while exercising or while lying down`,
  },
  {
    docId: 'cardio-swollen-ankles',
    title: 'Swollen ankles, feet or legs',
    section: 'Causes and when to get help',
    category: 'cardiac_symptoms',
    tags: ['swelling', 'oedema', 'ankles', 'legs', 'fluid'],
    sources: [S.nhsOedema, S.nhlbiLivingWithHeartFailure],
    content: `Swelling in the ankles, feet or legs is often caused by a build-up of fluid, called oedema. Common causes include sitting or standing for a long time, eating too much salt, being overweight, pregnancy, and some medicines, including some blood pressure medicines. It can also be caused by an injury, a blood clot, or kidney, liver or heart problems. If you have heart failure, ankle swelling may mean fluid is building up — tell your care team.

Things that can help: raise your legs on a chair or pillows when you can, do gentle exercise such as walking, and avoid standing or sitting for long periods.

See your doctor if both legs are swollen and it has not improved after a few days of treating it at home, if it is getting worse, or if you have a heart, kidney or leg vein condition.

Contact a doctor the same day if only one ankle, foot or leg is swollen and you do not know why; the swelling is severe, painful or started very suddenly; your face or tummy is also swollen; the area is red or hot; or you feel hot, cold or shivery.

Call an ambulance now if the swelling comes with shortness of breath or struggling to breathe, a tight, heavy or painful chest, coughing up blood, palpitations, or feeling light-headed, faint, confused, sick or clammy.`,
  },
  {
    docId: 'cardio-heart-tests',
    title: 'Heart tests: ECG and echocardiogram',
    section: 'What happens during the tests',
    category: 'cardiac_tests',
    tags: ['ecg', 'electrocardiogram', 'echocardiogram', 'echo', 'heart tests'],
    sources: [S.nhsEcg, S.nhsEchocardiogram],
    content: `An ECG (electrocardiogram) records the electrical activity of your heart, including its rate and rhythm. Sticky patches called electrodes are put on your skin and connected to the ECG machine. It is usually quick and painless. Wear a top that is easy to take off, and do not put body lotion, oil or talcum powder on your skin beforehand. Some ECGs are done while you exercise, and some use a small portable recorder worn for 24 to 48 hours, and sometimes up to 7 days.

An echocardiogram (echo) is a scan to see how well your heart is working. It uses sound waves (ultrasound), like the scans used in pregnancy. Gel is put on your chest and a small ultrasound probe is moved over it. A standard echo takes around 30 to 40 minutes. Other types include a stress echo, done during exercise or with a medicine that has a similar effect on the heart, and a transoesophageal echo, where a thin tube is passed down the food pipe — this is not painful, but can be uncomfortable.

You may get results the same day, or it can take a few weeks. Your doctor will explain what your results mean and what happens next; this assistant cannot interpret your test results.`,
  },

  // ==========================================================================
  // Prevention
  // ==========================================================================
  {
    docId: 'cardio-tobacco',
    title: 'Stopping tobacco for your heart',
    section: 'Why it matters and where to get help',
    category: 'preventive_care',
    tags: ['smoking', 'tobacco', 'quitting', 'quit line', 'second-hand smoke'],
    sources: [S.whoTobacco, S.nhsLowerCholesterol, S.ntcpQuitLine, S.whoIndiaQuitline],
    content: `Tobacco use is a major risk factor for diseases of the heart and blood vessels. Smoking can raise your cholesterol and makes heart attacks and strokes more likely.

There is no safe level of exposure to second-hand tobacco smoke. It causes serious diseases, including coronary heart disease.

Counselling and medication can more than double a person's chance of quitting successfully.

India's National Tobacco Quit Line is a toll-free national service set up by the Government of India that offers counselling to people who want to quit tobacco: 1800-11-2356.

If you would like help to quit, talk to your doctor, including about whether a medicine to help you stop is suitable for you.`,
  },
  {
    docId: 'cardio-heart-healthy-eating',
    title: 'Heart-healthy eating',
    section: 'What a healthy diet looks like',
    category: 'diet',
    tags: ['diet', 'healthy eating', 'fruit', 'vegetables', 'whole grains', 'fat', 'sugar'],
    sources: [S.whoHealthyDiet, S.nhsLowerCholesterol],
    content: `A healthy diet helps protect your heart. The World Health Organization advises:
- Eat at least 400 grams of fruit and vegetables a day.
- Base meals on whole grains, vegetables, fruit and pulses; whole grains include unprocessed maize, millet, oats, wheat and brown rice.
- Keep free sugars to less than 10% of the energy you eat each day, which is about 50 grams.
- Keep saturated fat to no more than 10% of your energy, and trans fat to no more than 1%.
- Keep salt to less than 5 grams a day.

Practical tips: steam or boil food instead of frying; replace butter, lard and ghee with oils rich in polyunsaturated fat; limit salt and salty condiments when cooking; and eat more oily fish, nuts and seeds.

If you have heart failure, kidney disease or diabetes, or have been given a special diet, follow the advice of your care team or dietician.`,
  },
  {
    docId: 'cardio-flu-vaccine',
    title: 'Flu vaccination when you have heart disease',
    section: 'Why a yearly flu vaccine matters',
    category: 'preventive_care',
    tags: ['flu', 'influenza', 'vaccine', 'heart disease', 'stroke'],
    sources: [S.cdcFluHeartDisease, S.nhsFlu, S.nhsHeartFailure],
    content: `People with heart disease, and people who have had a stroke, are at higher risk of serious complications from flu. Flu illness is linked with an increase in heart attacks and strokes: one study found the risk of a heart attack was six times higher in the week after a confirmed flu infection.

If you have heart disease or have had a stroke, it is especially important to have a flu vaccine every flu season. People with heart failure should have the vaccinations they are offered, such as the flu vaccine. Ask your clinic about flu vaccination.

Flu symptoms include a sudden high temperature, an aching body, feeling exhausted, a dry cough, a sore throat and a headache. Antibiotics do not work for flu.

Call an ambulance if you have flu symptoms with sudden chest pain, severe difficulty breathing, or you are coughing up blood.`,
  },
  {
    docId: 'cardio-cv-risk',
    title: 'What raises the risk of heart disease and stroke',
    section: 'Risk factors you can and cannot change',
    category: 'cardiovascular',
    tags: ['risk factors', 'heart disease', 'stroke', 'prevention', 'lifestyle'],
    sources: [S.whoCardiovascular, S.whoHypertension, S.nhsHighCholesterol],
    content: `Cardiovascular diseases are disorders of the heart and blood vessels, such as heart attacks and strokes. An estimated 19.8 million people died from them in 2022, about a third of all deaths worldwide.

The most important behaviours that raise the risk of heart disease and stroke are an unhealthy diet, physical inactivity, tobacco use and harmful use of alcohol. These can show up as raised blood pressure, raised blood sugar, raised blood fats (lipids), and overweight or obesity.

Some things cannot be changed: a family history of high blood pressure, being over 65, and having diabetes or kidney disease all raise the risk of high blood pressure, and people of South Asian origin are more likely to have high cholesterol.

Stopping tobacco, eating less salt, eating more fruit and vegetables, being physically active and avoiding harmful use of alcohol have been shown to reduce the risk of heart and blood vessel disease.

Have your blood pressure checked, and ask your doctor whether you need a cholesterol or blood sugar test.`,
  },
  {
    docId: 'cardio-hot-weather',
    title: 'Staying safe in hot weather with a heart condition',
    section: 'Heat, fluids and heat exhaustion',
    category: 'preventive_care',
    tags: ['heat wave', 'hot weather', 'dehydration', 'heat exhaustion', 'fluid restriction'],
    sources: [S.imdHeatWave, S.nhsHeatExhaustion],
    content: `During hot weather:
- Drink enough water, even if you are not thirsty. But if you have heart, kidney or liver disease and have been told to limit fluids, or you retain fluid, ask your doctor before drinking more than usual.
- Avoid going out in the sun, especially between 12 noon and 3 pm, and avoid strenuous activity outdoors in the afternoon.
- Wear lightweight, light-coloured, loose cotton clothes, and cover your head when you go out.
- Avoid alcohol, tea, coffee and fizzy soft drinks, which dehydrate the body.
- Take special care of older people and anyone who is unwell.

Signs of heat exhaustion include tiredness, dizziness, headache, feeling sick or vomiting, heavy sweating with pale clammy skin, cramps, a high temperature and feeling very thirsty. Move to a cool place, take off unnecessary clothing, cool the skin with water and a fan, and drink water or oral rehydration solution (if you have been told to limit fluids, ask a doctor how much). People should start to feel better within 30 minutes.

Call an ambulance if the person is still unwell after 30 minutes of cooling, has hot skin that is not sweating, a fast heartbeat or fast breathing, confusion, a fit, or loses consciousness.`,
  },
  {
    docId: 'cardio-heart-medicines-safely',
    title: 'Taking heart and blood pressure medicines safely',
    section: 'Keep taking them, and ask before stopping',
    category: 'pharmacology',
    tags: ['medicines', 'beta blockers', 'bisoprolol', 'adherence', 'stopping medicines'],
    sources: [S.whoHypertension, S.nhsBisoprololHow, S.nhsStatins, S.nhsClopidogrelHow, S.nhsAnticoagulants],
    content: `Heart and blood pressure medicines work only when they are taken regularly, exactly as prescribed.

- Do not stop a heart or blood pressure medicine without talking to your doctor. Stopping some of them can make your condition worse: the advice for bisoprolol, a beta blocker, is not to stop it without talking to your doctor, and stopping clopidogrel, an antiplatelet, can raise the risk of a heart attack or stroke.
- Talk to your doctor or pharmacist before stopping a statin.
- If you are unsure how to take a medicine, or think you have missed a dose or taken too much, check the leaflet that came with it or ask your doctor or pharmacist.
- If you take a blood thinner, speak to your doctor or pharmacist before taking any other medicine, including ones bought without a prescription.

If you think a medicine is causing side effects, do not stop it yourself — contact your clinic. Only your doctor can change a dose or stop a medicine.`,
  },
  {
    docId: 'cardio-heart-medicine-side-effects',
    title: 'Side effects of common heart medicines',
    section: 'What to report, and what is an emergency',
    category: 'pharmacology',
    tags: ['side effects', 'ace inhibitors', 'ramipril', 'beta blockers', 'cough', 'angioedema'],
    sources: [S.nhsRamiprilSideEffects, S.nhsBetaBlockers, S.nhsAtorvastatinSideEffects],
    content: `Most people take heart medicines without serious problems. Some side effects are worth knowing about:

- ACE inhibitors, such as ramipril, can cause a dry, persistent cough, and dizziness or light-headedness, especially when you stand up or sit up quickly.
- Beta blockers can cause cold hands and feet, dizziness, tiredness, difficulty sleeping, vivid dreams, and problems getting or keeping an erection. If you feel dizzy after taking one, do not drive, ride a bike or use machinery until the dizziness stops.
- Statins, such as atorvastatin, can cause headaches, dizziness, feeling sick, digestive problems and muscle aches.

Tell your clinic about side effects that bother you — do not stop the medicine yourself.

Contact a doctor the same day for yellowing of your skin or the whites of your eyes, or, on a statin, muscle cramps with severe pain or weakness.

Call an ambulance or go to the nearest hospital emergency department now if your lips, mouth, tongue, face or throat suddenly swell, you have difficulty breathing, or you have chest pain. On an ACE inhibitor, swelling of the lips, tongue or face can be a sign of a serious reaction called angioedema.`,
  },
];
