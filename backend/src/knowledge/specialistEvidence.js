/**
 * The words in each heart-specialist guideline that a cardiology passage cites
 * it for, and where they are — so a reviewing cardiologist can check a
 * citation against the guideline itself in minutes.
 *
 * Keyed by the English passage's docId; its translations cite the same. Every
 * quote was found verbatim in the guideline's full text on SPECIALIST_ACCESSED
 * (guidanceSources.js). A test asserts that every specialist citation has one.
 */
export const SPECIALIST_EVIDENCE = Object.freeze({
  "cardio-angina": Object.freeze([
    Object.freeze({ source: "esc2023Acs", quote: "It is characterized by specific clinical findings of prolonged (>20 min) angina at rest; new onset of severe angina; angina that is increasing in frequency, longer in duration, or lower in threshold", location: "Section 2.1 Definitions (unstable angina)" }),
    Object.freeze({ source: "esc2023Acs", quote: "the public should be educated to call the EMS directly rather than a primary care physician for symptoms suggestive of ACS.", location: "Section 4.1.4" }),
    Object.freeze({ source: "esc2024Ccs", quote: "Unstable cardiac symptoms with angina, heart failure or arrhythmia: acute assessment by the ED", location: "Figure 2 Stepwise approach to the initial management of individuals with suspected CCS" }),
  ]),
  "cardio-bp-what-it-is": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Hypertension is predominantly an asymptomatic condition that is typically detected by systematic or opportunistic screening in a healthcare setting.", location: "Section 7.2 Confirming the diagnosis of hypertension" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Symptoms of hypertensive emergency depend on the organs affected but may include headache, visual disturbances, chest pain, shortness of breath, dizziness, and other neurological deficits.", location: "Section 10.1.1 Definition and characteristics of hypertensive emergencies" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Hypertensive emergencies are potentially life-threatening and require immediate and careful intervention to reduce BP, often with i.v. therapy.", location: "Section 10.1.1 Definition and characteristics of hypertensive emergencies" }),
  ]),
  "cardio-bp-numbers": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Hypertension remains defined as office BP of ≥140/90 mmHg.", location: "Section 12 Key messages (also Section 2.1 What is new)" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "An average HBPM of ≥135/85 mmHg (equivalent to an office BP of ≥140/90 mmHg) should be used to diagnose hypertension", location: "Section 5.2.3 Home blood pressure measurement" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "If these measurements are not logistically or economically feasible, then diagnosis can be made on repeated office BP measurements on more than one visit.", location: "Recommendation Table 5 — Recommendations for blood pressure screening (Section 7.2)" }),
  ]),
  "cardio-bp-home-measurement": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Patients should avoid exercising and stimulants (caffeine, tobacco) for at least 30 min before measurement. The patient’s bladder should be emptied if needed.", location: "Section 5.2.2 Office blood pressure measurement (patient preparation; Section 5.2.3 tells home users to follow the same steps)" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Patients should be seated with their legs unfolded and their back supported at the time of measurement. The arm should be supported", location: "Section 5.2.2 Office blood pressure measurement" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Clothing at the location of the cuff placement should be removed", location: "Section 5.2.2 Office blood pressure measurement" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Two measurements should be taken at each measurement session, performed 1–2 min apart. Measurements should be made twice a day (morning and evening) at the same time", location: "Section 5.2.3 Home blood pressure measurement" }),
  ]),
  "cardio-salt": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Restriction of sodium to approximately 2 g per day is recommended where possible in all adults with elevated BP and hypertension [this is equivalent to about 5 g of salt (sodium chloride) per day", location: "Recommendation Table 15 — Recommendations for non-pharmacological treatment of blood pressure and cardiovascular risk reduction" }),
    Object.freeze({ source: "esc2021Prevention", quote: "<5 g total salt intake per day", location: "Table 8 Healthy diet characteristics" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to reduce salt intake to lower BP and risk of CVD.", location: "Recommendations for nutrition and alcohol (Section 4.3.2)" }),
  ]),
  "cardio-bp-lifestyle": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Moderate intensity aerobic exercise of ≥150 min/ week (≥30 min, 5–7 days/week) or alternatively 75 min of vigorous intensity aerobic exercise per week over 3 days are recommended", location: "Recommendation Table 15 — Recommendations for non-pharmacological treatment of blood pressure and cardiovascular risk reduction" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "It is recommended to aim for a stable and healthy BMI (e.g. 20–25 kg/m2) and waist circumference values (e.g. <94 cm in men and <80 cm in women) to reduce BP and CVD risk.", location: "Recommendation Table 15" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Preferably, it is recommended to avoid alcohol to achieve the best health outcomes.", location: "Recommendation Table 15" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "It is recommended to stop tobacco smoking, initiate supportive care and refer to smoking cessation programmes", location: "Recommendation Table 15" }),
  ]),
  "cardio-bp-emergency": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Symptoms of hypertensive emergency depend on the organs affected but may include headache, visual disturbances, chest pain, shortness of breath, dizziness, and other neurological deficits.", location: "Section 10.1.1 Definition and characteristics of hypertensive emergencies" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Hypertensive emergencies are potentially life-threatening and require immediate and careful intervention to reduce BP, often with i.v. therapy.", location: "Section 10.1.1 Definition and characteristics of hypertensive emergencies" }),
    Object.freeze({ source: "esc2023Acs", quote: "the public should be educated to call the EMS directly rather than a primary care physician for symptoms suggestive of ACS.", location: "Section 4.1.4" }),
  ]),
  "cardio-low-bp": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Patients with orthostatic hypotension should be asked to change position slowly, maintain adequate hydration, and avoid alcohol and large meals.", location: "Section 9.5 Orthostatic hypotension with supine hypertension" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "triggering medications (like alpha-blockers, beta-blockers, diuretics, nitrates, antidepressants, and antipsychotics)", location: "Section 9.5 Orthostatic hypotension with supine hypertension" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "The treatment of orthostatic hypotension among those with supine hypertension is not to automatically down-titrate BP-lowering medications.", location: "Section 9.5 Orthostatic hypotension with supine hypertension" }),
  ]),
  "cardio-cholesterol-lifestyle": Object.freeze([
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to replace saturated with unsaturated fats to lower the risk of CVD.", location: "Recommendations for nutrition and alcohol (Section 4.3.2)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to choose a more plant-based food pattern, rich in fibre, that includes whole grains, fruits, vegetables, pulses, and nuts.", location: "Recommendations for nutrition and alcohol (Section 4.3.2)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to eat fish, preferably fatty, at least once a week and restrict (processed) meat.", location: "Recommendations for nutrition and alcohol (Section 4.3.2)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended for adults of all ages to strive for at least 150–300 min a week of moderate-intensity or 75–150 min a week of vigorous-intensity aerobic PA", location: "Recommendations for physical activity (Section 4.3.1; repeated in Section 9 What to do and what not to do)" }),
  ]),
  "cardio-statins": Object.freeze([
    Object.freeze({ source: "csi2024Dyslipidemia", quote: "Statins are contraindicated during pregnancy and breast feeding and are not recommended in pre-menopausal patients with or without diabetes who are considering pregnancy, or not using adequate contraception.", location: "Section 5.1 Statins in dyslipidemia management" }),
    Object.freeze({ source: "csi2024Dyslipidemia", quote: "In general, statins are safe and well tolerated, but are associated with (usually reversible) muscle and liver toxicity.", location: "Section 5.1 Statins in dyslipidemia management" }),
  ]),
  "cardio-heart-attack": Object.freeze([
    Object.freeze({ source: "esc2023Acs", quote: "Acute chest discomfort—which may be described as pain, pressure, tightness, heaviness, or burning—is the leading presenting symptom", location: "Section 3.1.1 Clinical presentation" }),
    Object.freeze({ source: "esc2023Acs", quote: "Chest pain-equivalent symptoms include dyspnoea, epigastric pain, and pain in the left or right arm or neck/jaw.", location: "Section 3.1.1 Clinical presentation" }),
    Object.freeze({ source: "esc2023Acs", quote: "Therefore, the public should be educated to call the EMS directly rather than a primary care physician for symptoms suggestive of ACS.", location: "Section 4.1.4 General practitioners" }),
  ]),
  "cardio-chd-living": Object.freeze([
    Object.freeze({ source: "esc2024Ccs", quote: "Symptoms like chest pain triggered by emotional stress; dyspnoea or dizziness on exertion; pain in the arms, jaw, neck, or upper back; or fatigue should be considered as potential angina equivalents.", location: "Recommendation Table 1 — Recommendations for history taking, risk factor assessment, and resting electrocardiogram in individuals with suspected chronic coronary syndrome (also Table 3 New major recommendations)" }),
    Object.freeze({ source: "esc2024Ccs", quote: "Although both procedures increase CFC and prevent myocardial ischaemia during exercise or emotional stress, they do not heal coronary atherosclerosis.", location: "Section 4.4 Revascularization for chronic coronary syndromes" }),
    Object.freeze({ source: "esc2024Ccs", quote: "Statins are recommended in all patients with CCS.", location: "Recommendation Table 18 — Recommendations for lipid-lowering drugs in patients with chronic coronary syndrome" }),
    Object.freeze({ source: "esc2023Acs", quote: "Beta-blockers are recommended in ACS patients with LVEF ≤40% regardless of HF symptoms.", location: "Recommendation Table 16 — Recommendations for long-term management" }),
    Object.freeze({ source: "esc2023Acs", quote: "There is a two-fold risk of anxiety and mood disorders in patients with heart disease.", location: "Section 13.2.4 Psychological considerations" }),
  ]),
  "cardio-antiplatelets": Object.freeze([
    Object.freeze({ source: "esc2023Acs", quote: "By default, DAPT consisting of a potent P2Y12 receptor inhibitor in addition to aspirin is recommended for a minimum of 12 months after an ACS event", location: "Section 6.4 Long-term treatment" }),
    Object.freeze({ source: "esc2024Ccs", quote: "In CCS patients with a prior MI or PCI, clopidogrel 75 mg daily is recommended as a safe and effective alternative to aspirin monotherapy.", location: "Recommendation Table 17 — Recommendations for antithrombotic therapy in patients with chronic coronary syndrome" }),
    Object.freeze({ source: "esc2024Ccs", quote: "In CCS patients with a prior MI or remote PCI, aspirin 75–100 mg daily is recommended lifelong after an initial period of DAPT.", location: "Recommendation Table 17 — Recommendations for antithrombotic therapy in patients with chronic coronary syndrome" }),
  ]),
  "cardio-cardiac-rehab": Object.freeze([
    Object.freeze({ source: "esc2026CardiacRehab", quote: "Phase II CR is a multidisciplinary, patient-centred, and medically supervised intervention designed to optimize a patient’s physical, mental, and social functioning following a cardiac event or diagnosis of cardiac disease.", location: "Section 4.1 From exercise-based to comprehensive cardiac rehabilitation" }),
    Object.freeze({ source: "esc2026CardiacRehab", quote: "modern programmes encompass additional core components such as self-management and education, optimization of pharmacotherapies, lifestyle modification, and psychosocial support.", location: "Section 4.1" }),
    Object.freeze({ source: "esc2026CardiacRehab", quote: "CR is recommended in patients after ACS or with CCS (with or without PCI or CABG) to reduce the risk of cardiovascular mortality and myocardial infarction.", location: "Recommendation Table 4 — indications in patients with acute and chronic coronary syndromes" }),
    Object.freeze({ source: "esc2026CardiacRehab", quote: "CR is recommended in patients with chronic HFrEF to reduce all-cause hospital admissions and improve physical functioning", location: "Recommendation Table 5 — Recommendations for indications in patients with heart failure (Section 5.2)" }),
    Object.freeze({ source: "esc2026CardiacRehab", quote: "Centre-based CR offers direct supervision by healthcare professionals while home-based CR, on the other hand, provides a more flexible and accessible option", location: "Section 4.4 Early initiation and safety of cardiac rehabilitation" }),
    Object.freeze({ source: "esc2023Acs", quote: "It is recommended that all ACS patients participate in a medically supervised, structured, comprehensive, multidisciplinary exercise-based cardiac rehabilitation and prevention programme.", location: "Recommendation Table 16 — Recommendations for long-term management" }),
  ]),
  "cardio-physical-activity": Object.freeze([
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended for adults of all ages to strive for at least 150–300 min a week of moderate-intensity or 75–150 min a week of vigorous-intensity aerobic PA", location: "Recommendations for physical activity (Section 4.3.1; repeated in Section 9 What to do and what not to do)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended that adults who cannot perform 150 min of moderate-intensity PA a week should stay as active as their abilities and health condition allow.", location: "Recommendations for physical activity (Section 4.3.1; repeated in Section 9 What to do and what not to do)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to reduce sedentary time to engage in at least light activity throughout the day", location: "Recommendations for physical activity (Section 4.3.1; repeated in Section 9 What to do and what not to do)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Performing resistance exercise, in addition to aerobic activity, is recommended on 2 or more days per week to reduce all-cause mortality.", location: "Recommendations for physical activity (Section 4.3.1; repeated in Section 9 What to do and what not to do)" }),
    Object.freeze({ source: "esc2026CardiacRehab", quote: "Exercise training, as part of CR, is recommended in patients after ACS or with CCS to reduce cardiovascular mortality, MI, and all-cause hospitalization.", location: "Recommendation Table 17 — Recommendations for exercise training (Section 7.5)" }),
  ]),
  "cardio-hf-what-it-is": Object.freeze([
    Object.freeze({ source: "esc2026HeartFailure", quote: "Heart failure is a clinical syndrome comprising signs and/or symptoms caused by structural and/or functional abnormalities of the heart that result in elevated intracardiac pressures and/or inadequate cardiac output", location: "Section 3.1 Definition of heart failure" }),
    Object.freeze({ source: "esc2026HeartFailure", quote: "Common causes of HF include ischaemic heart disease, hypertension, and valvular heart disease, although a multitude of other causes and contributing factors exist", location: "Section 5.3 Aetiology and subtypes of heart failure" }),
    Object.freeze({ source: "esc2026HeartFailure", quote: "Loop diuretics are recommended to reduce signs and/or symptoms of congestion in patients with HF and volume overload.", location: "Section 6.1.3.1 Loop diuretics" }),
    Object.freeze({ source: "esc2026HeartFailure", quote: "Weight gain (>2 kg/week)", location: "Table 7 Symptoms and signs of heart failure (other listed symptoms: dyspnoea, orthopnoea, fatigue, ankle oedema, bloated feeling)" }),
  ]),
  "cardio-hf-self-care": Object.freeze([
    Object.freeze({ source: "esc2026CardiacRehab", quote: "CR is recommended in patients with chronic HFrEF to reduce all-cause hospital admissions and improve physical functioning", location: "Recommendation Table 5 — Recommendations for indications in patients with heart failure (Section 5.2)" }),
  ]),
  "cardio-af": Object.freeze([
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Symptoms related to episodes of AF are variable and broad, and not just typical palpitations (Figure 1). Asymptomatic episodes of AF can occur", location: "Section 3.3 Symptoms attributable to AF (Figure 1 lists palpitations, shortness of breath, fatigue, chest pain, dizziness, poor exercise capacity, fainting)" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Oral anticoagulation is recommended in patients with clinical AF at elevated thromboembolic risk to prevent ischaemic stroke and thromboembolism.", location: "Recommendation Table 6 — Recommendations to assess and manage thromboembolic risk in AF" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Atrioventricular node ablation in combination with pacemaker implantation should be considered in patients unresponsive to, or ineligible for, intensive rate and rhythm control therapy", location: "Section 7.1.4 Atrioventricular node ablation and pacemaker implantation" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Cardioversion of AF (either electrical or pharmacological) should be considered in symptomatic patients with persistent AF as part of a rhythm control approach.", location: "Table 3 New recommendations — General principles and anticoagulation, Section 7.2.1" }),
  ]),
  "cardio-anticoagulants": Object.freeze([
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Regardless of the type of OAC prescribed, healthcare teams should be aware of the potential for interactions with other drugs, foods, and supplements, and incorporate this information into the education provided to patients and their carers.", location: "Section 6.2 Oral anticoagulants (with Figure 9 Common drug interactions with oral anticoagulants)" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "advice to reduce excess alcohol intake, avoidance of unnecessary antiplatelet or anti-inflammatory agents, and attention to OAC therapy (adherence, control of TTR if on VKAs, and review of interacting medications)", location: "Section 6.7.1 Assessment of bleeding risk" }),
  ]),
  "cardio-warfarin": Object.freeze([
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "A target INR of 2.0–3.0 is recommended for patients with AF prescribed a VKA for stroke prevention to ensure safety and effectiveness.", location: "Recommendation Table 7 — Recommendations for oral anticoagulation in AF" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "Direct oral anticoagulants are recommended in preference to VKAs to prevent ischaemic stroke and thromboembolism, except in patients with mechanical heart valves or moderate-to-severe mitral stenosis.", location: "Recommendation Table 7 — Recommendations for oral anticoagulation in AF" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "In patients receiving OAC, alcohol excess is associated with a greater risk of bleeding", location: "Section 5.7 Alcohol excess" }),
    Object.freeze({ source: "esc2024AtrialFibrillation", quote: "The list of potential interactions with VKA is broad", location: "Section 6.2 Oral anticoagulants (Figure 9: for VKA, NSAIDs \"avoid where possible\"; alcohol, grapefruit/cranberry juice and St John’s wort \"limit consumption\")" }),
  ]),
  "cardio-tobacco": Object.freeze([
    Object.freeze({ source: "esc2021Prevention", quote: "Second-hand smoke is associated with an increase in CVD risk.", location: "Section 3.2.1.3 Cigarette smoking" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Quitting must be encouraged in all smokers, and passive smoking should be avoided as much as possible.", location: "Section 4.5 Smoking intervention strategies" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Varenicline 1 mg b.i.d. (twice a day) increases quitting rates more than two-fold compared with placebo.", location: "Section 4.5.2 Evidence-based drug interventions" }),
    Object.freeze({ source: "esc2021Prevention", quote: "In patients with ASCVD, varenicline (RR 2.6), bupropion (RR 1.4), telephone therapy (RR 1.5), and individual counselling (RR 1.6) all increase success rates.", location: "Section 4.5.2 Evidence-based drug interventions" }),
  ]),
  "cardio-heart-healthy-eating": Object.freeze([
    Object.freeze({ source: "esc2021Prevention", quote: "Saturated fatty acids should account for <10% of total energy intake, through replacement by PUFAs, MUFAs, and carbohydrates from whole grains", location: "Table 8 Healthy diet characteristics" }),
    Object.freeze({ source: "esc2021Prevention", quote: "≥200 g of fruit per day (≥2–3 servings)", location: "Table 8 Healthy diet characteristics (next row: ≥200 g of vegetables per day)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Trans unsaturated fatty acids should be minimized as far as possible, with none from processed foods", location: "Table 8 Healthy diet characteristics" }),
    Object.freeze({ source: "esc2021Prevention", quote: "It is recommended to restrict free sugar consumption, in particular sugar-sweetened beverages, to a maximum of 10% of energy intake.", location: "Recommendations for nutrition and alcohol (Section 4.3.2)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "<5 g total salt intake per day", location: "Table 8 Healthy diet characteristics" }),
  ]),
  "cardio-flu-vaccine": Object.freeze([
    Object.freeze({ source: "esc2023Acs", quote: "An annual influenza vaccination in patients with stable ASCVD appears to be associated with reduced incidence of MI, an improved prognosis in patients with HF, and decreased CV risk in adults aged 65 years and older.", location: "Section 13.3.8 Vaccination" }),
    Object.freeze({ source: "esc2023Acs", quote: "Influenza vaccination is recommended for all ACS patients.", location: "Recommendation Table 16 — Recommendations for long-term management (Vaccination)" }),
    Object.freeze({ source: "esc2026HeartFailure", quote: "Influenza vaccination is associated with a reduced risk of pneumonia and all-cause death in patients with HF.", location: "Section 10.9 Other non-cardiovascular comorbidities" }),
    Object.freeze({ source: "esc2026HeartFailure", quote: "influenza and pneumococcal vaccination should be considered in all patients with HF in order to reduce the risk of infection-related complications.", location: "Section 10.9 Other non-cardiovascular comorbidities" }),
    Object.freeze({ source: "esc2024Ccs", quote: "Vaccination against influenza, pneumococcal disease and other widespread infections, e.g. COVID-19", location: "Section 4.1 Patient education, lifestyle optimization for risk-factor control, and exercise therapy" }),
  ]),
  "cardio-cv-risk": Object.freeze([
    Object.freeze({ source: "esc2021Prevention", quote: "The major risk factors for ASCVD are cholesterol, BP, cigarette smoking, DM, and adiposity.", location: "Section 7 Key messages (Risk factors and risk classification)" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Immigrants from South Asia (notably India and Pakistan) present higher CVD rates independent of other risk factors", location: "Section 3.3.2 Ethnicity" }),
    Object.freeze({ source: "esc2021Prevention", quote: "Systematic global CVD risk assessment is recommended in individuals with any major vascular risk factor (i.e. family history of premature CVD, FH, CVD risk factors such as smoking, arterial hypertension, DM, raised lipid level, obesity", location: "Recommendations for CVD risk assessment (Section 3.1)" }),
  ]),
  "cardio-heart-medicines-safely": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Adherence to medical therapies is especially suboptimal in asymptomatic conditions such as hypertension.", location: "Section 7.4.2 Drug adherence and persistence with treatment" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "Non-adherence to BP-lowering therapy correlates with a higher risk of CVD events.", location: "Section 7.4.2 Drug adherence and persistence with treatment" }),
    Object.freeze({ source: "esc2024Hypertension", quote: "It is recommended to maintain BP-lowering drug treatment lifelong, even beyond the age of 85 years, if well tolerated.", location: "Recommendation Table 16 — Recommendations for pharmacological treatment of hypertension (also Table 3 New recommendations)" }),
  ]),
  "cardio-heart-medicine-side-effects": Object.freeze([
    Object.freeze({ source: "esc2024Hypertension", quote: "Although generally well tolerated, common side effects include headaches, cough, dizziness or light-headedness, diarrhoea or constipation, fatigue, ankle swelling, and erectile problems, depending on the drug class", location: "Section 8.7.1.1 Symptomatic adverse effects" }),
  ]),
});
