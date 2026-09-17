/**
 * The published guidance the AI-drafted cardiology and general-medicine
 * passages were checked against.
 *
 * ---- What "checked" means here ---------------------------------------------
 *
 * Every page below was opened on the date in `ACCESSED` and the statements
 * drafted from it were compared with the page's own wording: numbers, symptom
 * lists and "when to get help" lists are the page's, rewritten only into plain
 * patient English and Indian service terms. Where the pages send patients to
 * NHS 111 or 999, the passages say "contact a doctor the same day" and "call an
 * ambulance or go to the nearest hospital emergency department" — the same
 * urgency, not the same phone numbers, which would ring nowhere in India.
 *
 * Nothing here was cited from memory. A statement that could not be found on a
 * page that was actually opened was left out of the passages, not given a
 * plausible citation.
 *
 * `year` is the year the page was published or last reviewed, as the page
 * says. Two Indian government documents carry no date, and say so with null.
 *
 * ---- Why one file ----------------------------------------------------------
 *
 * The same pages back several passages and both specialties. One definition
 * each means one place to update when a page is revised and re-checked, and a
 * test can assert every citation is complete without reading two copies.
 */

/** The day these pages were opened and compared with the drafted wording. */
export const ACCESSED = '2026-09-16';

const NHS = 'NHS (England)';
const WHO = 'World Health Organization';
const CDC = 'Centers for Disease Control and Prevention (United States)';

const src = (organisation, title, year, url) => Object.freeze({ title, organisation, year, url, accessed: ACCESSED });

export const SOURCES = Object.freeze({
  // ---- NHS -------------------------------------------------------------------
  nhsHighBloodPressure: src(NHS, 'High blood pressure (hypertension)', 2024, 'https://www.nhs.uk/conditions/high-blood-pressure/'),
  nhsBloodPressureTest: src(NHS, 'Blood pressure test', 2025, 'https://www.nhs.uk/tests-and-treatments/blood-pressure-test/'),
  nhsLowBloodPressure: src(NHS, 'Low blood pressure (hypotension)', 2023, 'https://www.nhs.uk/conditions/low-blood-pressure-hypotension/'),
  nhsHighCholesterol: src(NHS, 'High cholesterol', 2026, 'https://www.nhs.uk/conditions/high-cholesterol/'),
  nhsCholesterolLevels: src(NHS, 'Cholesterol levels', 2026, 'https://www.nhs.uk/conditions/high-cholesterol/cholesterol-levels/'),
  nhsLowerCholesterol: src(NHS, 'How to lower your cholesterol', 2026, 'https://www.nhs.uk/conditions/high-cholesterol/how-to-lower-your-cholesterol/'),
  nhsStatins: src(NHS, 'Statins', 2026, 'https://www.nhs.uk/medicines/statins/'),
  nhsAtorvastatinSideEffects: src(NHS, 'Side effects of atorvastatin', 2026, 'https://www.nhs.uk/medicines/atorvastatin/side-effects-of-atorvastatin/'),
  nhsHeartAttack: src(NHS, 'Heart attack', 2026, 'https://www.nhs.uk/conditions/heart-attack/'),
  nhsStrokeSymptoms: src(NHS, 'Symptoms of a stroke', 2024, 'https://www.nhs.uk/conditions/stroke/symptoms/'),
  nhsAngina: src(NHS, 'Angina', 2025, 'https://www.nhs.uk/conditions/angina/'),
  nhsCoronaryHeartDisease: src(NHS, 'Coronary heart disease', 2024, 'https://www.nhs.uk/conditions/coronary-heart-disease/'),
  nhsClopidogrelHow: src(NHS, 'How and when to take clopidogrel', 2025, 'https://www.nhs.uk/medicines/clopidogrel/how-and-when-to-take-clopidogrel/'),
  nhsClopidogrelSideEffects: src(NHS, 'Side effects of clopidogrel', 2025, 'https://www.nhs.uk/medicines/clopidogrel/side-effects-of-clopidogrel/'),
  nhsHeartFailure: src(NHS, 'Heart failure', 2026, 'https://www.nhs.uk/conditions/heart-failure/'),
  nhsAtrialFibrillation: src(NHS, 'Atrial fibrillation', 2025, 'https://www.nhs.uk/conditions/atrial-fibrillation/'),
  nhsAnticoagulants: src(NHS, 'Anticoagulant medicines', 2024, 'https://www.nhs.uk/medicines/anticoagulants/'),
  nhsApixabanInteractions: src(NHS, 'Taking apixaban with other medicines and herbal supplements', 2026, 'https://www.nhs.uk/medicines/apixaban/taking-apixaban-with-other-medicines-and-herbal-supplements/'),
  nhsApixabanSideEffects: src(NHS, 'Side effects of apixaban', 2026, 'https://www.nhs.uk/medicines/apixaban/side-effects-of-apixaban/'),
  nhsWarfarin: src(NHS, 'Warfarin', 2026, 'https://www.nhs.uk/medicines/warfarin/'),
  nhsPalpitations: src(NHS, 'Heart palpitations', 2026, 'https://www.nhs.uk/conditions/heart-palpitations/'),
  nhsFainting: src(NHS, 'Fainting', 2026, 'https://www.nhs.uk/conditions/fainting/'),
  nhsOedema: src(NHS, 'Swollen ankles, feet and legs (oedema)', 2026, 'https://www.nhs.uk/conditions/oedema/'),
  nhsEcg: src(NHS, 'Electrocardiogram (ECG)', 2023, 'https://www.nhs.uk/tests-and-treatments/electrocardiogram/'),
  nhsEchocardiogram: src(NHS, 'Echocardiogram', 2026, 'https://www.nhs.uk/tests-and-treatments/echocardiogram/'),
  nhsBetaBlockers: src(NHS, 'Beta blockers', 2026, 'https://www.nhs.uk/medicines/beta-blockers/'),
  nhsBisoprololHow: src(NHS, 'How and when to take bisoprolol', 2026, 'https://www.nhs.uk/medicines/bisoprolol/how-and-when-to-take-bisoprolol/'),
  nhsRamiprilSideEffects: src(NHS, 'Side effects of ramipril', 2026, 'https://www.nhs.uk/medicines/ramipril/side-effects-of-ramipril/'),
  nhsChestPain: src(NHS, 'Chest pain', 2023, 'https://www.nhs.uk/conditions/chest-pain/'),
  nhsShortnessOfBreath: src(NHS, 'Shortness of breath', 2024, 'https://www.nhs.uk/conditions/shortness-of-breath/'),
  nhsFlu: src(NHS, 'Flu', 2026, 'https://www.nhs.uk/conditions/flu/'),
  nhsHeatExhaustion: src(NHS, 'Heat exhaustion and heatstroke', 2026, 'https://www.nhs.uk/conditions/heat-exhaustion-heatstroke/'),
  nhsHeadInjury: src(NHS, 'Head injury and concussion', 2025, 'https://www.nhs.uk/conditions/head-injury-and-concussion/'),
  nhsStomachAche: src(NHS, 'Stomach ache', 2023, 'https://www.nhs.uk/conditions/stomach-ache/'),
  nhsFeverInAdults: src(NHS, 'High temperature (fever) in adults', 2023, 'https://www.nhs.uk/conditions/fever-in-adults/'),
  nhsSepsis: src(NHS, 'Sepsis', 2026, 'https://www.nhs.uk/conditions/sepsis/'),
  nhsMeningitis: src(NHS, 'Meningitis', 2026, 'https://www.nhs.uk/conditions/meningitis/'),
  nhsCommonCold: src(NHS, 'Common cold', 2024, 'https://www.nhs.uk/conditions/common-cold/'),
  nhsCough: src(NHS, 'Cough', 2023, 'https://www.nhs.uk/conditions/cough/'),
  nhsSoreThroat: src(NHS, 'Sore throat', 2024, 'https://www.nhs.uk/conditions/sore-throat/'),
  nhsDiarrhoeaVomiting: src(NHS, 'Diarrhoea and vomiting', 2023, 'https://www.nhs.uk/conditions/diarrhoea-and-vomiting/'),
  nhsDehydration: src(NHS, 'Dehydration', 2026, 'https://www.nhs.uk/conditions/dehydration/'),
  nhsUti: src(NHS, 'Urinary tract infections (UTIs)', 2025, 'https://www.nhs.uk/conditions/urinary-tract-infections-utis/'),
  nhsHeadaches: src(NHS, 'Headaches', 2024, 'https://www.nhs.uk/conditions/headaches/'),
  nhsBackPain: src(NHS, 'Back pain', 2026, 'https://www.nhs.uk/conditions/back-pain/'),
  nhsSprains: src(NHS, 'Sprains and strains', 2024, 'https://www.nhs.uk/conditions/sprains-and-strains/'),
  nhsCuts: src(NHS, 'Cuts and grazes', 2026, 'https://www.nhs.uk/conditions/cuts-and-grazes/'),
  nhsBurns: src(NHS, 'Burns and scalds', 2026, 'https://www.nhs.uk/conditions/burns-and-scalds/'),
  nhsTetanus: src(NHS, 'Tetanus', 2026, 'https://www.nhs.uk/conditions/tetanus/'),
  nhsParacetamol: src(NHS, 'Paracetamol for adults', 2026, 'https://www.nhs.uk/medicines/paracetamol-for-adults/'),
  nhsIbuprofen: src(NHS, 'Ibuprofen for adults', 2025, 'https://www.nhs.uk/medicines/ibuprofen-for-adults/'),
  nhsAntibiotics: src(NHS, 'Antibiotics', 2022, 'https://www.nhs.uk/medicines/antibiotics/'),
  nhsAnaphylaxis: src(NHS, 'Anaphylaxis', 2023, 'https://www.nhs.uk/conditions/anaphylaxis/'),

  // ---- WHO -------------------------------------------------------------------
  whoHypertension: src(WHO, 'Hypertension (fact sheet)', 2025, 'https://www.who.int/news-room/fact-sheets/detail/hypertension'),
  whoSodium: src(WHO, 'Sodium reduction (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/salt-reduction'),
  whoHealthyDiet: src(WHO, 'Healthy diet (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'),
  whoCardiovascular: src(WHO, 'Cardiovascular diseases (CVDs) (fact sheet)', 2025, 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)'),
  whoPhysicalActivity: src(WHO, 'Physical activity (fact sheet)', 2024, 'https://www.who.int/news-room/fact-sheets/detail/physical-activity'),
  whoTobacco: src(WHO, 'Tobacco (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/tobacco'),
  whoAlcohol: src(WHO, 'Alcohol (fact sheet)', 2024, 'https://www.who.int/news-room/fact-sheets/detail/alcohol'),
  whoIndiaQuitline: src('World Health Organization, India', 'Tobacco kills, dial 1800 11 2356 to quit!', 2021, 'https://www.who.int/india/news-room/detail/08-10-2021-tobacco-kills-dial-1800-11-2356-to-quit!'),
  whoDengue: src(WHO, 'Dengue and severe dengue (fact sheet)', 2025, 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue'),
  whoMalaria: src(WHO, 'Malaria (fact sheet)', 2025, 'https://www.who.int/news-room/fact-sheets/detail/malaria'),
  whoTyphoid: src(WHO, 'Typhoid (fact sheet)', 2023, 'https://www.who.int/news-room/fact-sheets/detail/typhoid'),
  whoTuberculosis: src(WHO, 'Tuberculosis (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/tuberculosis'),
  whoDiarrhoealDisease: src(WHO, 'Diarrhoeal disease (fact sheet)', 2024, 'https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease'),
  whoFoodSafety: src(WHO, 'Food safety (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/food-safety'),
  whoAntimicrobialResistance: src(WHO, 'Antimicrobial resistance (fact sheet)', 2026, 'https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance'),
  whoVaccination: src(WHO, 'Vaccines and immunization: What is vaccination?', 2025, 'https://www.who.int/news-room/questions-and-answers/item/vaccines-and-immunization-what-is-vaccination'),
  whoRabies: src(WHO, 'Rabies (fact sheet)', 2024, 'https://www.who.int/news-room/fact-sheets/detail/rabies'),
  whoSnakebite: src(WHO, 'Snakebite envenoming (fact sheet)', 2023, 'https://www.who.int/news-room/fact-sheets/detail/snakebite-envenoming'),
  whoDiabetes: src(WHO, 'Diabetes (fact sheet)', 2024, 'https://www.who.int/news-room/fact-sheets/detail/diabetes'),

  // ---- CDC and NIH -------------------------------------------------------------
  cdcMeasureBloodPressure: src(CDC, 'Measuring Your Blood Pressure', 2026, 'https://www.cdc.gov/high-blood-pressure/measure/index.html'),
  cdcCardiacRehabilitation: src(CDC, 'How Cardiac Rehabilitation Can Help Heal Your Heart', 2024, 'https://www.cdc.gov/heart-disease/about/cardiac-rehabilitation-treatment.html'),
  cdcFluHeartDisease: src(CDC, 'Flu and People with Heart Disease or History of Stroke', 2025, 'https://www.cdc.gov/flu/highrisk/heartdisease.htm'),
  cdcAntibioticDosDonts: src(CDC, "Healthy Habits: Antibiotic Do's and Don'ts", 2025, 'https://www.cdc.gov/antibiotic-use/about/index.html'),
  nhlbiLivingWithHeartFailure: src('National Heart, Lung, and Blood Institute (US National Institutes of Health)', 'Living With Heart Failure', 2022, 'https://www.nhlbi.nih.gov/health/heart-failure/living-with'),

  // ---- India -----------------------------------------------------------------
  ntcpQuitLine: src(
    'National Tobacco Control Programme, Ministry of Health and Family Welfare, Government of India',
    'National Tobacco Quit Line Services',
    2024,
    'https://ntcp.mohfw.gov.in/national_tobacco_quit_line_services',
  ),
  ntepPresumptiveTb: src(
    'National TB Elimination Programme, Ministry of Health and Family Welfare, Government of India',
    'Diagnostic algorithm for TB disease in NTEP',
    null,
    'https://www.ntep.in/node/1743/CP-diagnostic-algorithm-tb-disease-ntep',
  ),
  imdHeatWave: src(
    'India Meteorological Department (Agromet), Government of India',
    "Dos and Don'ts for Heat wave",
    null,
    'https://imdagrimet.gov.in/Files/Dos_Donts/Heat_wave_Dos_and_Donts.pdf',
  ),
});
