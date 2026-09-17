import { SOURCES as S } from './guidanceSources.js';

/**
 * General medicine — patient guidance drafted by an AI, awaiting a general
 * physician.
 *
 * ---- Nothing in this file is approved ---------------------------------------
 *
 * The scope and every passage are seeded `pending_review` with origin
 * `ai_draft`. A general physician at a practice approves them for that
 * practice on the knowledge screen; until the scope and enough passages are
 * approved there, that practice has no general-medicine assistant. See
 * services/ai/assistantAvailability.js.
 *
 * ---- How it was written ------------------------------------------------------
 *
 * The same rules as seedContentCardiology.js: each statement checked against
 * the cited page on the date in guidanceSources.js; UK service directions given
 * as the same urgency in Indian terms; no dose, no dose change, no brand name;
 * never a diagnosis of the reader. Over-the-counter painkillers are described
 * by who should avoid them and by "follow the pack or leaflet", never by an
 * amount.
 *
 * India's national TB programme, tobacco quit line and heat-wave advice are
 * cited where the Indian answer differs from, or adds to, the international
 * one — a cough that lasts two weeks is a TB test in India.
 *
 * Written for adults. A child's illness is outside this scope and the passages
 * do not attempt it.
 */

export const GENERAL_MEDICINE_ASSISTANT_SCOPE = Object.freeze({
  departmentKey: 'general_physician',
  role: 'the general medicine assistant',
  covers: [
    'Common short illnesses in adults and caring for yourself at home: fever, coughs and colds, sore throat, flu, diarrhoea and vomiting, and oral rehydration solution (ORS).',
    'Infections common in India — dengue, malaria, typhoid and tuberculosis — how they spread, their warning signs, and why testing and completing treatment matter.',
    'Urinary symptoms, headaches, back pain and stomach aches: self-care and when to see a doctor.',
    'Minor injuries — sprains, cuts and grazes, burns, head injuries, animal bites — first aid and when to go to hospital.',
    'Using pain relief (paracetamol, ibuprofen) safely, and using antibiotics wisely.',
    'Vaccination for adults, including flu and tetanus.',
    'Staying safe in hot weather, and clean food and water.',
    'The basics of long-term conditions such as high blood pressure and type 2 diabetes, and when to be checked.',
  ],
  refuses: [
    'Diagnosing the patient or telling them which illness they have.',
    'Recommending, starting, stopping or changing any prescription medicine or dose, including antibiotics, or suggesting someone else’s or leftover medicine.',
    "Interpreting this patient's own test results, scans or readings.",
    "Illness in children, pregnancy care, cancer care, a mental-health crisis, or the ongoing treatment of a specialist condition such as diabetes or heart disease — suggest the right doctor or service.",
  ],
  redFlags: [
    'Severe difficulty breathing — gasping, choking or unable to get words out — or lips or skin turning very pale, blue or grey.',
    'Chest pain or pressure that does not go away, or that spreads to the arms, neck, jaw, back or stomach, or comes with sweating, feeling sick, light-headedness or breathlessness.',
    'Signs of a stroke: one side of the face drooping, weakness in one arm, or slurred speech.',
    'Signs of sepsis: breathing very fast; confusion, slurred speech or not making sense; blue, pale or blotchy skin; a rash that does not fade when pressed.',
    'Fever with a stiff neck, pain when looking at bright lights, a rash that does not fade under a glass, a fit, or being very sleepy or hard to wake.',
    'A headache that started suddenly and is extremely painful, or a headache with weakness or numbness, confusion, loss of vision or difficulty speaking.',
    'Vomiting blood or vomit that looks like ground coffee, or bloody or black sticky stools.',
    'Swelling of the throat or tongue, difficulty breathing, or feeling faint after contact with something the person may be allergic to.',
    'After a head injury: knocked out and not waking, a fit, trouble staying awake, clear fluid from the ears or nose, new weakness or numbness, or problems speaking, walking or with balance.',
    'Dengue warning signs, which often come after the fever has gone: severe abdominal pain, persistent vomiting, rapid breathing, bleeding gums or nose, blood in vomit or stool, being very thirsty, pale cold skin.',
    'Heat stroke: still unwell after 30 minutes of cooling, hot skin that is not sweating, confusion, a fit or loss of consciousness.',
    'Back pain with numbness around the genitals or bottom, new problems controlling the bladder or bowels, or weakness or numbness in both legs.',
    'Dehydration with confusion, being sleepier than normal or hard to wake, cold or blotchy skin, or fast breathing.',
    'A bite or scratch from a dog or another animal that could have rabies, or a snakebite.',
  ],
  sources: [
    S.nhsShortnessOfBreath,
    S.nhsChestPain,
    S.nhsStrokeSymptoms,
    S.nhsSepsis,
    S.nhsMeningitis,
    S.nhsHeadaches,
    S.nhsDiarrhoeaVomiting,
    S.nhsStomachAche,
    S.nhsAnaphylaxis,
    S.nhsHeadInjury,
    S.whoDengue,
    S.nhsHeatExhaustion,
    S.nhsBackPain,
    S.nhsDehydration,
    S.whoRabies,
    S.whoSnakebite,
  ],
});

export const GENERAL_MEDICINE_DRAFTS = [
  // ==========================================================================
  // Fever and serious infection
  // ==========================================================================
  {
    docId: 'gp-fever-self-care',
    title: 'High temperature (fever) in adults: caring for yourself',
    section: 'Self-care and when to see a doctor',
    category: 'fever',
    tags: ['fever', 'high temperature', 'self-care', 'paracetamol', 'dengue'],
    sources: [S.nhsFeverInAdults, S.whoDengue, S.nhsSepsis, S.nhsMeningitis],
    content: `A high temperature is usually 38°C or above. You may also feel hot or cold, shivery or sweaty, or your chest or back may feel hotter than usual. You do not need a thermometer, but you can use one if you have it.

To look after yourself:
- get lots of rest
- drink plenty of fluids (water is best) to avoid dehydration
- paracetamol or ibuprofen can help if you feel uncomfortable — follow the pack or leaflet

If there is any chance of dengue, do not take ibuprofen or aspirin: the World Health Organization advises avoiding them in dengue because they can increase the risk of bleeding. Paracetamol is used for pain instead.

Contact a doctor the same day if you have been treating a high temperature at home and it is not getting better, or it is getting worse.

Call an ambulance or go to the nearest hospital emergency department now if a fever comes with a stiff neck, a rash that does not fade when pressed, confusion or being very sleepy, very fast breathing, or blue, pale or blotchy skin.`,
  },
  {
    docId: 'gp-sepsis',
    title: 'Sepsis: know the signs',
    section: 'An emergency that develops quickly',
    category: 'emergency',
    tags: ['sepsis', 'infection', 'emergency', 'confusion', 'fast breathing'],
    sources: [S.nhsSepsis],
    content: `Sepsis is a serious reaction to an infection. It can be life-threatening, develops very quickly and needs urgent treatment in hospital.

Call an ambulance or go to the nearest hospital emergency department now if an adult:
- is breathing very fast
- is confused, has slurred speech or is not making sense
- has blue, pale or blotchy skin
- has a very high or very low temperature, feels hot or cold to the touch, or is shivery
- has a rash that does not fade when you press it
- has symptoms you are worried might be sepsis

People more at risk include babies under 12 months, adults over 75, people who are pregnant or gave birth in the last 6 weeks, people with a weakened immune system, and people with a wound, burn or catheter.

Anyone who has had sepsis in the past 12 months and gets signs of an infection, such as a very high temperature or feeling hot, cold or shivery, should get medical advice the same day.`,
  },
  {
    docId: 'gp-meningitis',
    title: 'Meningitis: warning signs',
    section: 'An emergency — do not wait for a rash',
    category: 'emergency',
    tags: ['meningitis', 'stiff neck', 'rash', 'glass test', 'emergency'],
    sources: [S.nhsMeningitis],
    content: `Meningitis symptoms can develop suddenly and include:
- a high temperature
- a stiff neck
- a severe headache that is getting worse
- eye pain when looking at bright lights
- vomiting and diarrhoea
- being very sleepy or difficult to wake
- fits (seizures)
- spots or a rash that does not fade when pressed with a glass

To check a rash, press the side of a clear glass firmly against the skin: a meningitis rash does not fade. Not everyone with meningitis gets spots or a rash, and a rash can be harder to see on brown or black skin.

Call an ambulance or go to the nearest hospital emergency department now if you think someone has meningitis.

Vaccines are one of the safest and most effective ways to protect against meningitis. Ask your doctor which vaccines are right for you and your family.`,
  },
  {
    docId: 'gp-dengue',
    title: 'Dengue fever',
    section: 'Symptoms, care and warning signs',
    category: 'infectious_disease',
    tags: ['dengue', 'mosquito', 'fever', 'warning signs', 'paracetamol', 'ibuprofen'],
    sources: [S.whoDengue],
    content: `Dengue is a viral infection spread by the bite of infected Aedes mosquitoes. If symptoms happen, they usually begin 4 to 10 days after infection and last 2 to 7 days. Common symptoms include a high fever, severe headache, pain behind the eyes, muscle and joint pains, nausea, vomiting, swollen glands and a rash.

There is no specific medicine for dengue. Rest, drink plenty of liquids, and use paracetamol for pain. Avoid anti-inflammatory painkillers such as ibuprofen and aspirin, which can increase the risk of bleeding. If you think you might have dengue, see a doctor.

The symptoms of severe dengue often come after the fever has gone away. Seek care immediately — go to the nearest hospital — for:
- severe abdominal pain
- persistent vomiting
- rapid breathing
- bleeding gums or nose
- blood in vomit or stool
- being very thirsty
- pale and cold skin
- tiredness, restlessness or feeling weak

People infected with dengue for a second time are at greater risk of severe dengue.

Prevent bites by wearing clothes that cover as much of the body as possible and using mosquito repellent, and remove containers and other places where water collects and mosquitoes can breed.`,
  },
  {
    docId: 'gp-malaria',
    title: 'Malaria: why early testing matters',
    section: 'Symptoms, testing and severe signs',
    category: 'infectious_disease',
    tags: ['malaria', 'mosquito', 'fever', 'chills', 'test'],
    sources: [S.whoMalaria],
    content: `Malaria mostly spreads through the bites of infected Anopheles mosquitoes. The most common early symptoms are fever, headache and chills, usually starting 10 to 15 days after the bite.

Because early symptoms are not specific, getting tested early is important. The World Health Organization recommends that suspected malaria is confirmed with a test. Getting treatment early for mild malaria can stop it becoming severe, and the most dangerous type can progress to severe illness and death within 24 hours if it is not treated. If you have a fever and may have been exposed to malaria, see a doctor promptly to be tested.

Go to hospital immediately for signs of severe malaria:
- extreme tiredness
- reduced consciousness
- repeated fits (convulsions)
- difficulty breathing
- dark or bloody urine
- yellowing of the eyes and skin (jaundice)
- abnormal bleeding

Protect yourself by sleeping under a mosquito net where malaria is present and using mosquito repellent after dusk.`,
  },
  {
    docId: 'gp-typhoid',
    title: 'Typhoid fever',
    section: 'How it spreads, treatment and prevention',
    category: 'infectious_disease',
    tags: ['typhoid', 'enteric fever', 'contaminated water', 'antibiotics', 'vaccine'],
    sources: [S.whoTyphoid, S.cdcAntibioticDosDonts],
    content: `Typhoid is usually spread through contaminated food or water. Symptoms include a prolonged high fever, tiredness, headache, nausea, abdominal pain, and constipation or diarrhoea. If you have a prolonged fever, see a doctor to be assessed.

Typhoid can be treated with antibiotics, but resistance to antibiotics is common. Take antibiotics only when they are prescribed for you, exactly as prescribed, and for as long as the doctor has prescribed. Do not share antibiotics or take antibiotics prescribed for someone else.

Typhoid can be prevented with safe water, good sanitation and hygiene, and vaccination. A typhoid conjugate vaccine gives longer-lasting protection than older typhoid vaccines — ask your doctor whether it is recommended for you.`,
  },
  {
    docId: 'gp-tuberculosis',
    title: 'Tuberculosis (TB): a cough that does not go away',
    section: 'When to be tested, and completing treatment',
    category: 'infectious_disease',
    tags: ['tuberculosis', 'tb', 'cough', 'two weeks', 'ntep', 'treatment'],
    sources: [S.whoTuberculosis, S.ntepPresumptiveTb],
    content: `TB spreads through the air when people with TB cough, sneeze or spit. Symptoms of active TB include a prolonged cough (sometimes with blood), chest pain, weakness, tiredness, weight loss, fever and night sweats.

India's National TB Elimination Programme identifies anyone with a cough of more than 2 weeks as possibly having TB, so they can be tested promptly. If you have had a cough for more than 2 weeks, with or without other symptoms, see a doctor and ask about a TB test.

TB is preventable and curable. It is treated with special antibiotics, which need to be taken daily for 4 to 6 months to work. It is dangerous to stop them early or without medical advice, because the TB bacteria can become resistant to the medicines.

People with diabetes, a weakened immune system (including HIV), undernutrition, tobacco use or harmful alcohol use are at higher risk of TB.`,
  },

  // ==========================================================================
  // Coughs, colds, flu and breathing
  // ==========================================================================
  {
    docId: 'gp-common-cold',
    title: 'Common cold',
    section: 'Self-care and when to see a doctor',
    category: 'respiratory_infection',
    tags: ['cold', 'runny nose', 'sore throat', 'antibiotics', 'self-care'],
    sources: [S.nhsCommonCold, S.ntepPresumptiveTb, S.whoDengue],
    content: `A cold can cause a blocked or runny nose, sneezing, a sore throat, a hoarse voice, a cough, and feeling tired and unwell. You should begin to feel better in about 1 to 2 weeks.

To help yourself:
- get plenty of rest
- drink lots of fluids, such as water
- gargle with salt water to soothe a sore throat
- paracetamol or ibuprofen can ease aches and a temperature — follow the pack or leaflet, and avoid ibuprofen if there is any chance of dengue

Antibiotics do not help a cold: they only work on bacterial infections, and colds are caused by viruses. Wash your hands often with soap and water, and use tissues to catch coughs and sneezes.

See a doctor if:
- you have a high temperature for more than 3 days
- your symptoms get worse, or do not get better after 10 days
- your temperature is very high, or you feel hot, cold or shivery
- you feel short of breath or have chest pain
- you have a long-term condition such as diabetes or a heart, lung or kidney condition, or a weakened immune system
- your cough has lasted more than 2 weeks — in India this is a reason to be tested for TB`,
  },
  {
    docId: 'gp-cough',
    title: 'Cough',
    section: 'Self-care and when to get help',
    category: 'respiratory_infection',
    tags: ['cough', 'self-care', 'honey', 'tb', 'breathing'],
    sources: [S.nhsCough, S.ntepPresumptiveTb, S.nhsShortnessOfBreath],
    content: `A cough usually clears up on its own within 3 to 4 weeks. Rest, drink plenty of fluids, and try to stay at home and away from other people if you have a high temperature or do not feel well enough for your normal activities. Hot lemon and honey can help (honey is not suitable for babies under 1 year old).

In India, a cough that has lasted more than 2 weeks should be checked for TB — see a doctor. Also see a doctor if you are losing weight for no reason, or you have a weakened immune system, for example because of diabetes or chemotherapy.

Contact a doctor the same day if:
- your cough is very bad or quickly getting worse, or you cannot stop coughing
- you feel very unwell
- you have chest pain
- the side of your neck feels swollen and painful
- you find it hard to breathe
- you are coughing up blood

Call an ambulance now for severe difficulty breathing — gasping, choking or not able to get words out — or if your lips or skin are turning very pale, blue or grey.`,
  },
  {
    docId: 'gp-sore-throat',
    title: 'Sore throat',
    section: 'Self-care and warning signs',
    category: 'respiratory_infection',
    tags: ['sore throat', 'gargle', 'antibiotics', 'swallowing', 'stridor'],
    sources: [S.nhsSoreThroat],
    content: `Sore throats are very common and usually get better by themselves within a week. You do not normally need antibiotics — they will not usually relieve the symptoms or speed up recovery.

To help: gargle with warm, salty water (adults only — children should not try this), drink plenty of water, eat soft foods, avoid smoke, rest, and use paracetamol or ibuprofen if needed, following the pack or leaflet.

See a doctor if your sore throat has not improved after a week, or you often get sore throats.

Contact a doctor the same day if you are worried about your symptoms, have a very high temperature or feel hot, cold or shivery, have signs of dehydration such as peeing less than usual or dark, strong-smelling pee, or have a weakened immune system.

Call an ambulance or go to the nearest hospital emergency department now if you:
- have difficulty breathing or are unable to swallow
- are drooling
- are making a high-pitched sound as you breathe
- have severe symptoms that are getting worse quickly`,
  },
  {
    docId: 'gp-flu',
    title: 'Flu',
    section: 'Recovering at home and when to get help',
    category: 'respiratory_infection',
    tags: ['flu', 'influenza', 'fever', 'aches', 'vaccine'],
    sources: [S.nhsFlu],
    content: `Flu comes on quickly, within a few hours, and can leave you too exhausted to carry on as normal. Symptoms include a sudden high temperature, an aching body, feeling tired or exhausted, a dry cough, a sore throat, a headache, difficulty sleeping and loss of appetite.

To recover: rest and sleep, drink plenty of water to avoid dehydration, and take paracetamol or ibuprofen to lower a temperature and ease aches, following the pack or leaflet. Antibiotics do not work for flu.

Contact a doctor the same day if you are 65 or over; you are pregnant or have recently given birth; you have a long-term condition such as diabetes or a condition of the heart, lungs, liver, kidneys, brain or nerves; you have a weakened immune system; you feel very unwell or short of breath; or your symptoms have not improved after 7 days.

Call an ambulance now if you get sudden chest pain, have severe difficulty breathing — gasping, choking or not able to get words out — or start coughing up blood.

People at higher risk from flu — including people aged 65 or over, pregnant people, and people with long-term conditions — can be protected with a yearly flu vaccine. Ask your doctor about it.`,
  },
  {
    docId: 'gp-emergency-signs',
    title: 'Signs that need an ambulance straight away',
    section: 'When not to wait',
    category: 'emergency',
    tags: ['emergency', 'ambulance', 'chest pain', 'breathing', 'stroke', 'allergy'],
    sources: [S.nhsChestPain, S.nhsShortnessOfBreath, S.nhsStrokeSymptoms, S.nhsAnaphylaxis, S.nhsFainting, S.nhsCuts, S.nhsHeartAttack],
    content: `Call an ambulance or go to the nearest hospital emergency department immediately for:
- chest pain or discomfort that does not go away, that spreads to the arms, neck, jaw, stomach or back, or that comes with sweating, feeling sick, light-headedness or shortness of breath
- severe difficulty breathing — gasping, choking or not able to get words out — or lips or skin turning very pale, blue or grey
- feeling suddenly confused
- signs of a stroke: one side of the face drooping, weakness in one arm, or slurred speech — even if they go away
- swelling of the throat or tongue, difficulty breathing, or feeling faint soon after contact with something that can cause an allergic reaction
- someone who is not breathing, cannot be woken, or is having a fit
- bleeding from a cut that cannot be stopped, or blood spurting out

If you are the one who is unwell with chest pain, do not drive yourself to hospital.`,
  },

  // ==========================================================================
  // Stomach and fluids
  // ==========================================================================
  {
    docId: 'gp-diarrhoea-vomiting',
    title: 'Diarrhoea and vomiting',
    section: 'Looking after yourself and when to get help',
    category: 'gastrointestinal',
    tags: ['diarrhoea', 'vomiting', 'stomach bug', 'fluids', 'ors'],
    sources: [S.nhsDiarrhoeaVomiting, S.whoDiarrhoealDisease],
    content: `In adults, diarrhoea usually stops within 5 to 7 days and vomiting within 1 or 2 days.

To look after yourself:
- stay at home and get plenty of rest
- drink lots of fluids, taking small sips if you feel sick; oral rehydration solution (ORS) replaces the water and salts lost
- eat when you feel able to — it may help to avoid fatty or spicy food
- avoid fruit juice and fizzy drinks, which can make diarrhoea worse
- stay off work or school until you have had no diarrhoea or vomiting for at least 2 days

Contact a doctor the same day if you keep being sick and cannot keep fluids down, have signs of dehydration, have had diarrhoea for more than 7 days, or have been vomiting for more than 2 days.

Call an ambulance or go to the nearest hospital emergency department now if you vomit blood or your vomit looks like ground coffee, you have green vomit, you have a stiff neck and pain when looking at bright lights, or you have a sudden, severe headache.`,
  },
  {
    docId: 'gp-ors',
    title: 'Oral rehydration solution (ORS)',
    section: 'Replacing lost fluids and salts',
    category: 'gastrointestinal',
    tags: ['ors', 'oral rehydration', 'dehydration', 'diarrhoea', 'heat'],
    sources: [S.whoDiarrhoealDisease, S.nhsDehydration, S.nhsDiarrhoeaVomiting, S.imdHeatWave],
    content: `The main danger of diarrhoea is dehydration: water and body salts (electrolytes) are lost in loose stools, vomit, sweat and urine. Diarrhoea means passing 3 or more loose or liquid stools a day, or more often than is normal for you.

Oral rehydration solution (ORS) is a mixture of clean water, salt and sugar. It is absorbed in the gut and replaces the water and salts that have been lost. ORS comes as a powder to mix with clean water — follow the instructions on the packet, and ask a pharmacist if you are not sure.

- Take small sips if you feel sick.
- Keep eating nutritious food when you can.
- In hot weather, ORS and drinks such as lassi, rice water (torani), lemon water, buttermilk and coconut water help keep you hydrated.

If you have heart, kidney or liver disease and have been told to limit how much you drink, ask your doctor before drinking more than usual.

Contact a doctor the same day if you cannot keep fluids down, or signs of dehydration are not getting better.`,
  },
  {
    docId: 'gp-dehydration',
    title: 'Dehydration: signs and what to do',
    section: 'Recognising dehydration',
    category: 'gastrointestinal',
    tags: ['dehydration', 'thirst', 'dark urine', 'dizziness', 'fluids'],
    sources: [S.nhsDehydration],
    content: `Signs of dehydration include:
- feeling thirsty
- a headache and feeling light-headed or dizzy
- dark yellow, strong-smelling pee, and peeing less often than usual
- feeling tired
- a dry mouth, lips and tongue
- sunken eyes

If you have signs of dehydration, drink fluids — start with small sips and gradually drink more. Avoid caffeine and alcohol. A pharmacist can recommend an oral rehydration solution. Babies, children and older adults are more at risk of dehydration.

Contact a doctor the same day if you feel unusually tired, feel dizzy when you stand up and it does not go away, have dark yellow pee or are peeing less than normal, or are breathing quickly or have a fast heart rate.

Call an ambulance or go to the nearest hospital emergency department now for blue, grey, pale or blotchy skin, lips or tongue; skin that feels cold; difficulty breathing or taking lots of quick breaths; confusion; or being sleepier than normal or difficult to wake.`,
  },
  {
    docId: 'gp-food-water-hygiene',
    title: 'Safe food, clean water and handwashing',
    section: 'Preventing infections that spread through food and water',
    category: 'preventive_care',
    tags: ['food safety', 'clean water', 'handwashing', 'typhoid', 'diarrhoea'],
    sources: [S.whoFoodSafety, S.whoDiarrhoealDisease, S.whoTyphoid, S.nhsCommonCold],
    content: `Many infections that cause diarrhoea and fever, including typhoid, spread through contaminated food or water.

The World Health Organization's five keys to safer food:
1. Keep clean.
2. Separate raw and cooked food.
3. Cook food thoroughly.
4. Keep food at safe temperatures.
5. Use safe water and safe raw materials.

Safe drinking water, proper sanitation and washing hands with soap all help prevent diarrhoeal disease. Washing your hands often with soap and water, and catching coughs and sneezes in a tissue, also help stop colds and flu spreading.

Unsafe food causes a cycle of disease and poor nutrition that particularly affects infants, young children, older people and people who are already unwell.`,
  },
  {
    docId: 'gp-stomach-ache',
    title: 'Stomach ache: when to get help',
    section: 'Common causes and warning signs',
    category: 'gastrointestinal',
    tags: ['stomach ache', 'abdominal pain', 'indigestion', 'constipation', 'emergency'],
    sources: [S.nhsStomachAche],
    content: `Stomach ache is often caused by trapped wind, indigestion, constipation, or a stomach bug or food poisoning.

Contact a doctor the same day if:
- the pain gets much worse, does not go away or keeps coming back
- you have bloating that does not go away or keeps coming back
- you have problems swallowing food
- you are pregnant
- you are losing weight without trying to
- you suddenly pee more or less often, or peeing is suddenly painful
- you bleed from your bottom, or have unusual vaginal bleeding or discharge
- you have diarrhoea that does not go away after a few days

Call an ambulance or go to the nearest hospital emergency department now if:
- the pain came on very suddenly or is severe
- it hurts when you touch your stomach
- you are vomiting blood or your vomit looks like ground coffee
- your poo is bloody, or black and sticky
- you cannot pee, or cannot poo or pass wind
- you cannot breathe, or you have chest pain
- you have diabetes and you are vomiting
- someone has collapsed`,
  },

  // ==========================================================================
  // Urinary, headache, back pain
  // ==========================================================================
  {
    docId: 'gp-uti',
    title: 'Urinary tract infection (UTI)',
    section: 'Symptoms and when to see a doctor',
    category: 'urinary',
    tags: ['uti', 'urine infection', 'burning urine', 'kidney infection', 'cystitis'],
    sources: [S.nhsUti, S.cdcAntibioticDosDonts],
    content: `Symptoms of a urinary tract infection can include pain or burning when peeing, needing to pee more often or more suddenly than usual (including at night), cloudy pee, blood in your pee, pain low in your tummy or in your back just under the ribs, a high temperature or feeling hot, cold and shivery, a very low temperature below 36°C, and feeling tired or weak. Some of these can be signs of a kidney infection, which can be serious and could cause sepsis if it is not treated.

While you wait to be seen: rest, and drink enough fluids to pass pale pee regularly during the day. Paracetamol can help with pain and a high temperature — follow the pack or leaflet.

Contact a doctor the same day if you are 65 or over, you are a man, you are pregnant, you have diabetes, a catheter or a weakened immune system, you have a very high or low temperature or are shivering, you have pain low in your tummy or in your back just under the ribs, you have blood in your pee, your symptoms get worse quickly or have not improved within 2 days of starting treatment, or you keep getting UTIs.

Call an ambulance or go to the nearest hospital emergency department now if the person is confused, drowsy or has difficulty speaking.

Antibiotics are only for when a doctor prescribes them for you. Do not use leftover antibiotics or antibiotics prescribed for someone else.`,
  },
  {
    docId: 'gp-headache',
    title: 'Headaches',
    section: 'Self-care and warning signs',
    category: 'headache',
    tags: ['headache', 'painkillers', 'dehydration', 'warning signs', 'emergency'],
    sources: [S.nhsHeadaches],
    content: `Common causes of headaches include a cold or flu, stress, drinking too much alcohol, bad posture, eyesight problems, not eating regular meals and not drinking enough fluids.

To help:
- drink plenty of water, and rest
- try to relax — stress can make headaches worse
- take paracetamol or ibuprofen, following the pack or leaflet — but do not take too many painkillers
- do not skip meals, do not sleep more than usual, do not strain your eyes at a screen for a long time, and do not drink alcohol

See a doctor if a headache is not getting better with self-care, is getting worse, or you get headaches regularly.

Contact a doctor the same day for a headache with vision or eye problems; a headache brought on or made worse by coughing, sneezing, bending down or exercise; a headache with vomiting; or a headache with jaw pain when eating or a tender scalp.

Call an ambulance or go to the nearest hospital emergency department now if a headache:
- started suddenly and is extremely painful
- comes with a fit, numbness or weakness in the body or face, drowsiness or confusion, loss of vision, or difficulty speaking, balancing, walking or remembering
- follows a head injury in the last 3 months
- comes with a rash that does not fade when a glass is rolled over it, a very high temperature, a stiff neck, or bright lights hurting your eyes`,
  },
  {
    docId: 'gp-back-pain',
    title: 'Back pain',
    section: 'Self-care and warning signs',
    category: 'musculoskeletal',
    tags: ['back pain', 'lower back', 'stay active', 'warning signs'],
    sources: [S.nhsBackPain],
    content: `Back pain, especially lower back pain, is very common. It usually improves within a few weeks, but it can last longer or keep coming back.

Things that help:
- stay active and try to carry on with your daily activities
- use an ice pack (or a bag of frozen peas) wrapped in a tea towel to reduce pain and swelling, or a heat pack wrapped in a tea towel for stiffness or muscle spasms
- try gentle exercises and stretches for back pain
- ask a pharmacist or doctor which painkiller is suitable for you

See a doctor if the pain has not improved after a few weeks, stops you doing your daily activities, is worse at night or when you sneeze, cough or poo, is between your shoulder blades rather than in your lower back, or if you have lost weight without trying or have a lump or swelling in your back.

Contact a doctor the same day if you feel hot, cold, shivery or generally unwell, or the pain is severe and started suddenly or is getting worse quickly.

Call an ambulance or go to the nearest hospital emergency department now if you have pain, tingling, weakness or numbness in both legs; loss of feeling around your genitals or bottom; new problems with your bladder or bowels, such as difficulty peeing or wetting or soiling yourself; chest pain; or back pain that started after a serious accident.`,
  },

  // ==========================================================================
  // Injuries and bites
  // ==========================================================================
  {
    docId: 'gp-sprains',
    title: 'Sprains and strains',
    section: 'First few days and when to get help',
    category: 'minor_injury',
    tags: ['sprain', 'strain', 'ankle', 'ice', 'injury'],
    sources: [S.nhsSprains],
    content: `A sprain or strain causes pain, tenderness or weakness, usually around an ankle, foot, wrist, thumb, knee, leg or the back.

For the first 2 to 3 days:
- Protect the injury, for example with a support.
- Rest: stop exercise and try not to put weight on it.
- Ice: apply an ice pack (or a bag of frozen vegetables) wrapped in a tea towel.
- Compress: wrap a bandage around it.
- Elevate: keep it raised on a pillow as much as you can.

For the first couple of days, avoid heat (such as hot baths and heat packs), alcohol and massage. Avoid strenuous exercise such as running for up to 8 weeks. After 2 weeks most sprains and strains feel better.

Contact a doctor the same day if it is not getting better with self-care, or there is a lot of swelling or bruising.

Go to the nearest hospital emergency department if you heard a crack when you were injured, the injured part has changed shape or is pointing at an odd angle, or it is numb, tingling or has pins and needles.`,
  },
  {
    docId: 'gp-cuts',
    title: 'Cuts and grazes',
    section: 'First aid, infection and tetanus',
    category: 'minor_injury',
    tags: ['cut', 'graze', 'bleeding', 'wound', 'tetanus', 'infection'],
    sources: [S.nhsCuts, S.nhsTetanus],
    content: `To treat a cut or graze:
- Stop the bleeding by pressing on it with a bandage or a clean, folded cloth. If the cut is on your hand or arm, raise it above your head.
- Clean the wound by rinsing it with bottled or tap water, or with sterile wipes.
- Cover it with a sterile dressing or a plaster.

A cut may be infected if it is swollen, red and getting more painful, or pus is coming out of it — see a doctor.

Call an ambulance or go to the nearest hospital emergency department now if:
- you cannot stop the bleeding
- the blood spurts out, is bright red and is hard to control
- you lose feeling near the wound or have trouble moving it
- the wound is very large or deep
- something is stuck in the cut, such as glass
- you have a bad cut on your face or the palm of your hand

Tetanus bacteria can get into a wound from soil or manure. Contact a doctor the same day if you are not fully vaccinated against tetanus or are not sure, or if there is still dirt or something stuck in the wound after cleaning it — you may need a tetanus injection.`,
  },
  {
    docId: 'gp-burns',
    title: 'Burns and scalds: first aid',
    section: 'What to do and what not to do',
    category: 'minor_injury',
    tags: ['burn', 'scald', 'first aid', 'cool water', 'blisters'],
    sources: [S.nhsBurns],
    content: `First aid for a burn or scald:
- Hold the burn under cool running water for 20 minutes, as soon as possible and within 3 hours of it happening.
- Remove clothing or jewellery near the burn, but do not remove anything that is stuck to it.
- Once it has cooled, lay cling film over it if you can — do not wrap it around.
- Paracetamol or ibuprofen can help with the pain; follow the pack or leaflet.

Do not:
- put any creams, oils or butter on it
- use plasters or sticky dressings
- burst any blisters

Call an ambulance or go to the nearest hospital emergency department if the burn:
- is very large or deep
- is on the face, genitals or bottom
- was caused by an acid or chemical, or by electricity`,
  },
  {
    docId: 'gp-head-injury',
    title: 'Head injury: when to get help',
    section: 'Emergency signs and care at home',
    category: 'emergency',
    tags: ['head injury', 'concussion', 'emergency', 'blood thinner', 'vomiting'],
    sources: [S.nhsHeadInjury],
    content: `Call an ambulance now if, after hitting their head, someone:
- was knocked out and has not woken up, or cannot stay awake or keep their eyes open
- has a fit (seizure)
- fell from more than 1 metre or 5 stairs, or hit their head at high speed, such as in a road accident
- has problems with their vision or hearing
- has clear fluid coming from their ears or nose, bleeding from their ears, or bruising behind their ears
- has new numbness or weakness in any part of the body
- has problems walking, balancing, understanding, speaking or writing
- has a head wound with something inside it, or a dent in the head
- has changed behaviour, such as being more irritable or distracted

Contact a doctor the same day after a head injury if you are being sick, feel dizzy, take a medicine that thins your blood or have a condition that does, or had been drinking alcohol or taking drugs.

For a minor head injury at home: hold an ice pack wrapped in a tea towel to the area, rest, take paracetamol for a headache, and make sure an adult stays with you for the first 24 hours. Do not drive until you feel fully recovered, do not drink alcohol until you feel better, and do not play contact sports for at least 3 weeks. See a doctor if symptoms last more than 2 weeks.`,
  },
  {
    docId: 'gp-animal-bites',
    title: 'Dog and other animal bites, and snakebites',
    section: 'Rabies risk and what to do at once',
    category: 'emergency',
    tags: ['dog bite', 'rabies', 'animal bite', 'snakebite', 'emergency'],
    sources: [S.whoRabies, S.whoSnakebite, S.nhsTetanus],
    content: `Rabies can be prevented with prompt treatment after a bite, but once symptoms appear it is fatal. Dog bites and scratches cause 99% of human rabies cases.

If you are bitten or scratched by a dog or another animal that could have rabies:
1. Wash the wound thoroughly with soap and water for at least 15 minutes, as soon as possible.
2. Go to a hospital or doctor immediately for treatment to prevent rabies — every time.
3. A bite can also let tetanus into the body, so your tetanus protection may need checking.

A snakebite is a medical emergency. Get to a hospital as quickly as possible. Antivenom is the most effective treatment to prevent or reverse most of the harmful effects of snake venom.`,
  },

  // ==========================================================================
  // Medicines
  // ==========================================================================
  {
    docId: 'gp-paracetamol',
    title: 'Paracetamol: using it safely',
    section: 'Avoiding an accidental overdose',
    category: 'pain_relief',
    tags: ['paracetamol', 'painkiller', 'overdose', 'cold and flu remedies', 'liver'],
    sources: [S.nhsParacetamol, S.whoDengue],
    content: `Paracetamol is a common painkiller that can also lower a high temperature.

- Never take more than the dose written on the packet or leaflet.
- Many cold and flu remedies also contain paracetamol. Check the labels, and do not take them at the same time as other medicines that contain paracetamol.
- Check with a doctor or pharmacist before taking paracetamol if you have a liver or kidney condition, or if you drink heavily or are dependent on alcohol.

If you have taken more paracetamol than the packet or leaflet says, get medical advice straight away. Taking too much can damage your liver.

Paracetamol is the painkiller the World Health Organization advises for pain in dengue, when ibuprofen and aspirin should be avoided.`,
  },
  {
    docId: 'gp-ibuprofen',
    title: 'Ibuprofen and similar anti-inflammatory painkillers',
    section: 'Who should avoid them',
    category: 'pain_relief',
    tags: ['ibuprofen', 'nsaid', 'painkiller', 'stomach bleeding', 'dengue'],
    sources: [S.nhsIbuprofen, S.whoDengue, S.nhsApixabanInteractions],
    content: `Ibuprofen is a non-steroidal anti-inflammatory drug (NSAID). It is not suitable for everyone.

Do not take it — or check with a doctor or pharmacist first — if you:
- have had an allergic reaction to ibuprofen, aspirin or another NSAID
- have or have had a stomach ulcer
- have asthma
- have a heart, liver or kidney condition, high blood pressure, or have had a stroke
- take a blood thinner, such as warfarin
- are pregnant or trying to get pregnant
- could have dengue: the World Health Organization advises avoiding ibuprofen and aspirin in dengue because they can increase the risk of bleeding

Take it with water, ideally with or after food. Common side effects include indigestion, stomach ache, and feeling or being sick.

Get urgent medical help if you vomit blood or have black, sticky, tar-like poo — these can be signs of bleeding in the stomach.`,
  },
  {
    docId: 'gp-antibiotics-when',
    title: 'Antibiotics: when they help and when they do not',
    section: 'Antibiotic resistance',
    category: 'antibiotics',
    tags: ['antibiotics', 'resistance', 'viruses', 'cold', 'flu'],
    sources: [S.nhsAntibiotics, S.whoAntimicrobialResistance, S.cdcAntibioticDosDonts, S.nhsSoreThroat],
    content: `Antibiotics treat or prevent some bacterial infections by killing bacteria or stopping them from spreading. They do not work on viruses, so they do not treat colds, runny noses (even with thick, yellow or green mucus), flu or most coughs, and most sore throats do not need them.

Taking antibiotics when you do not need them can mean they will not work for you in the future. This is called antibiotic resistance. The World Health Organization warns that the misuse and overuse of these medicines is driving the development and spread of drug-resistant infections.

- Take antibiotics only when a doctor has prescribed them for you, and take them exactly as prescribed.
- Do not save antibiotics for later, share them, or take antibiotics prescribed for someone else.

If you think you may need antibiotics, see a doctor. This assistant cannot recommend or prescribe them.`,
  },
  {
    docId: 'gp-antibiotics-safely',
    title: 'Taking antibiotics safely',
    section: 'Side effects and allergic reactions',
    category: 'antibiotics',
    tags: ['antibiotics', 'side effects', 'allergic reaction', 'rash', 'course'],
    sources: [S.nhsAntibiotics, S.cdcAntibioticDosDonts, S.whoTyphoid],
    content: `- Take antibiotics exactly as prescribed, as directed on the packet or the leaflet that comes with them, and for as long as your doctor has prescribed.
- If you miss a dose, check the leaflet or ask your pharmacist what to do.
- Common side effects include feeling or being sick, bloating and indigestion, and diarrhoea.

Call an ambulance or go to the nearest hospital emergency department now if, after taking an antibiotic, you get:
- a skin rash that may be itchy, red, swollen, blistered or peeling
- wheezing
- tightness in the chest or throat
- trouble breathing or talking
- swelling of the mouth, face, lips, tongue or throat

These can be signs of a serious allergic reaction.`,
  },

  // ==========================================================================
  // Prevention and long-term conditions
  // ==========================================================================
  {
    docId: 'gp-vaccination',
    title: 'Vaccinations for adults',
    section: 'Why they matter at every age',
    category: 'vaccination',
    tags: ['vaccination', 'vaccines', 'flu vaccine', 'tetanus', 'adults'],
    sources: [S.whoVaccination, S.nhsFlu, S.nhsTetanus, S.cdcFluHeartDisease],
    content: `Vaccination is a simple, safe and effective way of protecting you against harmful diseases before you come into contact with them. Vaccines work with your body's natural defences to build protection. Vaccines and their ingredients are thoroughly tested and monitored for safety.

Vaccines protect people throughout life and at different ages — from birth, through childhood and the teenage years, into old age. Keep your vaccination card: it shows which vaccines you have had and when the next doses or boosters are due. Being vaccinated also protects people who cannot be vaccinated, such as very young babies and people who are seriously ill.

Vaccines to ask your doctor about include:
- a flu vaccine each year, especially if you are 65 or over, pregnant, or have a long-term condition such as diabetes or a heart, lung, liver or kidney condition
- tetanus protection — contact a doctor the same day after a wound if you are not fully vaccinated against tetanus or are not sure`,
  },
  {
    docId: 'gp-heat-illness',
    title: 'Heat exhaustion and heatstroke',
    section: 'Staying safe in a heat wave',
    category: 'heat_illness',
    tags: ['heat wave', 'heat exhaustion', 'heatstroke', 'dehydration', 'ors'],
    sources: [S.nhsHeatExhaustion, S.imdHeatWave],
    content: `Signs of heat exhaustion include tiredness, dizziness, headache, feeling sick or being sick, heavy sweating with pale, clammy skin, cramps in the arms, legs and stomach, a high temperature, being very thirsty and feeling irritable.

What to do:
1. Move the person to a cool place.
2. Remove unnecessary clothing.
3. Give them plenty of water to drink — oral rehydration solution also helps.
4. Cool their skin: spray or sponge them with cool water and fan them.

They should start to cool down and feel better within 30 minutes.

Call an ambulance if they are still unwell after 30 minutes of resting in a cool place, being cooled and drinking fluids, or they have a very high temperature, hot skin that is not sweating, a fast heartbeat, fast breathing or shortness of breath, confusion or lack of coordination, a fit, or loss of consciousness.

To prevent it in hot weather: drink enough water even if you are not thirsty; ORS, lassi, rice water (torani), lemon water, buttermilk and coconut water also help; avoid the sun especially between 12 noon and 3 pm; wear light, loose cotton clothes and cover your head; and avoid alcohol, tea, coffee and fizzy drinks. If you have heart, kidney or liver disease and have been told to limit fluids, ask your doctor before drinking more. Take special care of older people, children and anyone who is unwell.`,
  },
  {
    docId: 'gp-anaphylaxis',
    title: 'Severe allergic reaction (anaphylaxis)',
    section: 'An emergency',
    category: 'emergency',
    tags: ['anaphylaxis', 'allergy', 'adrenaline', 'swelling', 'emergency'],
    sources: [S.nhsAnaphylaxis],
    content: `Anaphylaxis is a serious allergic reaction that needs emergency help. Symptoms happen very quickly, usually within minutes of contact with something you are allergic to, and include:
- swelling of the throat and tongue
- difficulty breathing
- feeling faint or dizzy, or fainting
- blue, grey or pale skin, lips or tongue

Common triggers include foods such as nuts, milk, eggs, fish and sesame; medicines such as antibiotics; and insect stings such as wasp and bee stings.

What to do:
1. If you have been prescribed an adrenaline auto-injector, use it straight away, as you were shown.
2. Call an ambulance and say you think it is anaphylaxis.
3. Lie down — you can raise your legs; if you are struggling to breathe, raise your shoulders.
4. If symptoms have not improved and you have a second auto-injector, follow the instructions you were given for using it.`,
  },
  {
    docId: 'gp-high-blood-pressure',
    title: 'High blood pressure: why regular checks matter',
    section: 'A condition without symptoms',
    category: 'hypertension',
    tags: ['blood pressure', 'hypertension', 'check', 'lifestyle'],
    sources: [S.whoHypertension, S.nhsHighBloodPressure, S.nhsBloodPressureTest],
    content: `High blood pressure (hypertension) can lead to serious problems such as heart attacks and strokes. Most people with it do not feel any symptoms, so the only way to know is to have your blood pressure checked.

Blood pressure is usually considered high if it is 140/90 or higher when checked by a health professional, or 135/85 or higher when checked at home. It is not diagnosed from a single reading.

Things that raise the risk include eating too much salt, a diet high in saturated and trans fats, eating few fruits and vegetables, physical inactivity, tobacco, alcohol and being overweight, as well as a family history, being over 65, and having diabetes or kidney disease.

Lifestyle changes that help include a healthy diet with less salt, being active (at least 150 minutes of moderate activity a week), losing weight if you are overweight, not smoking, and cutting down on alcohol.

If you have high blood pressure and symptoms such as a severe headache, chest pain, difficulty breathing, confusion or changes in vision, seek care immediately. If you have been prescribed medicine for blood pressure, take it exactly as prescribed.`,
  },
  {
    docId: 'gp-type-2-diabetes',
    title: 'Type 2 diabetes: signs and lowering your risk',
    section: 'When to be tested',
    category: 'diabetes_basics',
    tags: ['diabetes', 'type 2 diabetes', 'thirst', 'blood sugar test', 'prevention'],
    sources: [S.whoDiabetes],
    content: `Diabetes is a long-term condition that happens when the pancreas does not make enough insulin, or the body cannot use the insulin it makes effectively.

Signs of type 2 diabetes can include feeling very thirsty, needing to pee more often than usual, blurred vision, feeling tired, and losing weight without trying. In type 2 diabetes the symptoms can be mild and may take many years to be noticed.

Over time, diabetes can damage blood vessels and nerves and can lead to blindness, kidney failure, heart attacks, stroke and amputation of the lower limbs.

To lower your risk: reach and keep a healthy weight, stay physically active with at least 150 minutes of moderate exercise a week, eat a healthy diet that avoids sugar and saturated fat, and do not use tobacco.

If you have these signs, or are worried about your risk, ask your doctor about a blood sugar test. If you already have diabetes, your diabetes care team will guide your treatment.`,
  },
];
