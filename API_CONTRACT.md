# AKD Care — API Contract v1

Base URL: `http://<host>:4000/api/v1`
All requests/responses are JSON unless noted. All timestamps are ISO 8601 UTC.

## Conventions

**Auth:** `Authorization: Bearer <accessToken>` on everything except `/auth/register`, `/auth/login`, `/auth/refresh`, `/health`.

**Error shape** (any non-2xx):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "path": "valueMgDl", "message": "Required" }] } }
```
Codes: `BAD_REQUEST` `VALIDATION_ERROR` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `DUPLICATE` `RATE_LIMITED` `INVALID_ID` `INTERNAL_ERROR` `AI_UNAVAILABLE`.

Practice sign-up adds four, each because a client has to do something different for it:
`APPLICATION_OPEN` (409 — an application from this number is still open; `details.reference` is its reference),
`APPLICATION_PENDING` (409 — the number is on a practice application under review, so it can neither sign in nor register yet),
`PHONE_TOKEN_EXPIRED` (400 — the proof of the number has lapsed; verify it again),
`ACCOUNT_NOT_ELIGIBLE` (409 — the number's existing account is not a doctor's, so it cannot own a new practice; returned when the code is checked and on submission, never when a code is requested).
`details` is a list of `{ path, message }` on `VALIDATION_ERROR` and may be an object on these.

`NO_PRACTICE` (403) — a member of staff whose membership has ended, or who was never placed at a practice, on a platform that has practices. Every staff route returns it except `GET /practices/mine` and `GET /billing`, which answer "no practice" instead. A client should say the account is no longer part of a practice rather than retry. A patient never receives it.

`PRACTICE_SUSPENDED` (403) — the platform has suspended the practice this request is for: the caller's only practice, or the one named in `x-medpin-practice`. Every route that works inside a practice returns it, `GET /billing` included. `GET /practices/mine` still answers, with `practice.status: "suspended"`, and sign-in and `GET /auth/me` still work, so a client can say what has happened. A member of staff who also works at an active practice is served there without naming it. Retrying does not help; reinstatement by an operator restores access on the next request. A patient never receives it — their own records, prescriptions and reminders are unaffected.

**Paged list shape:**
```json
{ "items": [ ... ], "page": 1, "limit": 50, "total": 137, "hasMore": true }
```

**Patient scoping:** clinical routes are under `/patients/:patientId/...`. A patient passes `me`. A doctor/staff passes a real patient id. Anything else → 403.

**Urgency ladder** (string, ordered): `routine` < `advice` < `urgent` < `emergency`.
**Languages:** `en` | `bn` | `hi`.

---

## 1. Auth — `/auth`

### `POST /auth/register`
```json
{ "name": "Rahul Das", "phone": "+919830012345", "password": "secret123",
  "email": "r@x.com", "language": "bn", "dateOfBirth": "1975-04-02",
  "gender": "male", "diabetesType": "type2" }
```
→ `201` `{ "user": User, "accessToken": "...", "refreshToken": "..." }`

### `POST /auth/login`
`{ "phone": "+919830012345", "password": "secret123" }`
→ `200` `{ "user": User, "accessToken", "refreshToken" }`

### `POST /auth/refresh`
`{ "refreshToken": "..." }` → `200` `{ "accessToken", "refreshToken" }` (rotates; old token invalid)

### `POST /auth/logout` → `204`.  `POST /auth/device-token` `{ "token": "fcm..." }` → `204`
### `GET /auth/me` → `{ "user": User, "profile": PatientProfile|null }`
### `PATCH /auth/me` — `{ name?, email?, language?, dateOfBirth?, gender? }` → `{ "user": User }`

**User object:**
```json
{ "id": "...", "name": "Rahul Das", "phone": "+919830012345", "email": null,
  "role": "patient", "language": "bn", "dateOfBirth": "1975-04-02T00:00:00.000Z",
  "gender": "male", "createdAt": "..." }
```

---

## 2. AI Assistant — `/chat`

### `POST /chat/message`  ← **the core endpoint**
```json
{ "sessionId": "optional-existing-id", "text": "My blood sugar is 350 mg/dL. What should I do?",
  "language": "en", "attachments": ["mediaAssetId"] }
```
→ `200`
```json
{
  "sessionId": "65f...",
  "userMessage": { "id","seq":1,"role":"user","content":"...","language":"en","urgency":"urgent","createdAt":"..." },
  "reply": { "id","seq":2,"role":"assistant","content":"...","language":"en","urgency":"urgent","isFallback":false,"createdAt":"..." },
  "triage": {
    "urgency": "urgent",
    "ruleDriven": true,
    "redFlags": [{ "id":"RF_QUALITATIVE_ABNORMAL_SUGAR","label":"..." }],
    "findings": ["Blood sugar 350 mg/dL is very high (above 250)."],
    "extracted": { "glucoseMgDl": 350 }
  },
  "alert": { "id","severity":"urgent","type":"critical_hyperglycaemia","title":"..." },
  "citations": [{ "id","title":"Managing high blood sugar","source":"ADA 2025 §6" }]
}
```
`alert` is `null` when urgency is `routine`/`advice`.
**Client must render an emergency banner whenever `triage.urgency === "emergency"`.**

### `GET /chat/sessions?page=&limit=` → paged `ChatSession`
### `GET /chat/sessions/:id/messages?page=&limit=` → paged `ChatMessage`
### `POST /chat/sessions/:id/archive` → `204`
### `POST /chat/messages/:id/flag` → `204` (patient reports a bad answer)

---

## 3. Tracking — `/patients/:patientId/...`

All list endpoints accept `?from=ISO&to=ISO&page=&limit=`.

### Glucose
`POST /glucose` `{ "valueMgDl": 350, "context": "post_meal", "measuredAt": "...", "notes": "", "source": "manual" }`
→ `201` `{ "reading": {...,"flag":"very_high"}, "assessment": { "flag","urgency","summary" }, "alert": null|{...} }`
`GET /glucose` → paged. `DELETE /glucose/:id` → `204`.
`GET /glucose/trends?days=30` → `{ days, count, series[], daily[], stats{average,min,max,coefficientOfVariation,timeInRangePercent,estimatedHba1c}, distribution{} }`

### HbA1c
`POST /hba1c` `{ "percentage": 8.4, "testedOn": "...", "labName": "" }` → `201` (response includes `estimatedAverageGlucose`)
`GET /hba1c` → paged.

### Vitals (BP / weight / SpO2)
`POST /vitals` `{ "systolic":150, "diastolic":95, "pulse":80, "weightKg":78.5, "spo2":97, "recordedAt":"..." }`
→ `201` `{ "record": {...,"flag":"stage2"}, "assessment": {...}, "alert": null|{...} }`
`GET /vitals` → paged. `GET /vitals/weight-trend?days=90` → `{ series:[{at,weightKg,bmi}] }`

### Lifestyle (diet / exercise / water / sleep)
`POST /lifestyle` — `kind` is required, other fields depend on it:
```json
{ "kind":"meal", "mealType":"lunch", "foodItems":[{"name":"Rice","quantity":"1 cup","carbsGrams":45}], "loggedAt":"..." }
{ "kind":"exercise", "activityType":"walking", "durationMinutes":30, "intensity":"moderate", "steps":3200 }
{ "kind":"water", "volumeMl": 250 }
{ "kind":"sleep", "sleepHours": 6.5, "sleepQuality":"fair" }
```
`GET /lifestyle?kind=&from=&to=` → paged.
`GET /lifestyle/summary?date=YYYY-MM-DD` → `{ date, water:{totalMl,goalMl,percent}, exercise:{totalMinutes,sessions,steps}, meals:{count,totalCarbsGrams,totalCalories}, sleep:{hours} }`

---

## 4. Medications — `/patients/:patientId/medications`

`GET /` → `{ items: Medication[] }` · `POST /` · `PATCH /:id` · `DELETE /:id` (soft, sets `isActive:false`)

**Medication:**
```json
{ "id","name":"Metformin","genericName":null,"form":"tablet","strength":"500 mg","dose":"1 tablet",
  "schedule":[{"time":"08:00","relationToMeal":"after_meal"}],"daysOfWeek":[],
  "startDate":"...","endDate":null,"isActive":true,"instructions":"" }
```

`GET /schedule/today` → `{ date, slots:[{ medicationId, name, dose, time, relationToMeal, status:"pending|taken|skipped|missed", logId }] }`
`POST /:id/log` `{ "scheduledFor":"2026-07-22T08:00:00Z", "status":"taken", "unitsAdministered":12, "injectionSite":"abdomen", "skipReason":"" }` → `201` (idempotent per `medication+scheduledFor`)
`GET /adherence?days=30` → `{ expected, taken, missed, percentage, perMedication:[{medicationId,name,expected,taken,percentage}] }`

### Scanning a paper prescription — two steps, deliberately

`POST /scan` (multipart, field `file`) → **writes nothing.** Reads the photo and
proposes:

```json
{ "readable":true, "preview":true, "created":[],
  "items":[{ "name":"MF500(SR)","strength":null,"dose":null,"frequency":"AF Lunch · A Dinner",
             "instructions":null,"relationToMeal":"after_meal","durationDays":null,
             "schedule":[{"time":"14:00","relationToMeal":"after_meal"},
                         {"time":"21:00","relationToMeal":"after_meal"}] }],
  "prescriber":{...}, "note":null }
```

`POST /scan/confirm` `{ "items":[…], "prescriber":{…} }` → `201 { created: Medication[] }`

Unreadable photos still return `{ readable:false, created:[] }`.

**This route used to create the medicines itself**, so a misread hour was a live
alarm before the patient had seen it. Confirm takes the reviewed `items` back
rather than the photograph — re-reading the picture would run the model a second
time and could save a different list from the one the patient approved.

Two consequences worth knowing before deploying:

- **An old client against a new server appears to do nothing.** It sends the
  photo, gets a preview it does not understand, and finds `created: []`. Ship
  the app and the server together.
- `items` are already split, tidied and de-duplicated: a line joining two drugs
  with `+` arrives as two items sharing the line's timing, and the same drug on
  two lines arrives once with both timings. See `services/prescriptionItems.js`.

---

## 5. Foot Care — `/patients/:patientId/foot`

`POST /assessments`
```json
{ "site":"right_sole", "images":["mediaAssetId"], "woundKey":"optional-existing",
  "symptoms":{ "pain":"moderate","numbness":true,"discharge":false,"foulSmell":false,
               "swelling":true,"blackTissue":false,"fever":false,"durationDays":6 } }
```
→ `201`
```json
{ "assessment": { "id","site","assessedAt","ruleRiskLevel":"moderate","finalRiskLevel":"moderate",
    "aiAssessment":{ "riskLevel","wagnerGradeEstimate","observations","recommendations","confidence" },
    "followUpDueOn":"..." },
  "alert": null|{...} }
```
`GET /assessments` → paged · `GET /assessments/:id` · `GET /wounds/:woundKey/progression` → `{ woundKey, timeline:[{assessedAt, finalRiskLevel, images[]}] }`

## 6. Eye Care — `/patients/:patientId/eye`

`POST /reports` `{ "reportDate","files":["mediaAssetId"],"reportedGrade":"moderate_npdr","rawReportText":"...","visualAcuity":{"leftEye":"6/9"} }`
→ `201` `{ "report": { ..., "aiExplanation":{ "summary","whatItMeans","recommendedActions","referralUrgency" } } }`
`GET /reports` → paged · `GET /reports/:id` · `GET /education?topic=retinopathy&language=bn` → `{ items:[{title,content}] }`

## 7. Lab Reports — `/patients/:patientId/labs`
`POST /` `{ "title","labName","testedOn","files":[],"values":[{code,label,value,unit,refLow,refHigh}] }` → `201`
`GET /` → paged · `GET /:id`

---

## 8. Appointments — `/appointments`

`GET /?status=&from=&to=` → paged (scoped to caller)
`POST /` `{ "scheduledFor":"...","mode":"in_clinic","reason":"..." }` → `201`
`PATCH /:id/reschedule` `{ "scheduledFor":"..." }` · `PATCH /:id/cancel` `{ "reason":"" }`
`GET /slots?date=YYYY-MM-DD` → `{ date, slots:[{ time, available }] }`
`GET /queue/today` → `{ date, nowServing, entries:[{ queueNumber, patientName, status, isPriority }] }`
`POST /:id/check-in` → `{ queueNumber, position, estimatedWaitMinutes }`

## 9. Prescriptions — `/patients/:patientId/prescriptions`
`GET /` → paged · `GET /:id` · `GET /:id/pdf` → `application/pdf`
`POST /` *(doctor only)* → `201`

`referenceNo` is `<PREFIX>-<year>-<nnnnnn>`: the issuing practice's own prefix when an operator has set one (`MHC-2026-000057`), otherwise the neutral `RX` shared by every practice without one. References issued before practices had prefixes keep the `AKD-` they were printed with and are never rewritten. Treat the whole string as opaque.

---

## 10. Dashboard — `/patients/:patientId/dashboard`

`GET /` → the single call the home screen makes:
```json
{
  "healthScore": { "score":72, "band":"fair", "confidence":80,
                   "components":{ "timeInRange":{value,score,hasData}, "adherence":{...},
                                  "hba1c":{...}, "bloodPressure":{...}, "activity":{...}, "logging":{...} } },
  "glucose": { "latest":{value,context,at,flag}, "sevenDayAverage":168, "timeInRangePercent":54, "sparkline":[{at,value}] },
  "adherence": { "percentage":86, "todayPending":2 },
  "nextAppointment": { "id","scheduledFor","mode","status" } | null,
  "openAlerts": [ { "id","severity","type","title","createdAt" } ],
  "recommendations": [ { "code":"LOG_MORE","title":"...","body":"...","priority":"medium" } ],
  "reminders": { "footScreeningDue":false, "eyeScreeningDue":true, "hba1cDue":false }
}
```

## 11. Doctor — `/doctor` *(role: doctor|staff)*

`GET /overview` → `{ patientCount, activeToday, openAlerts:{emergency,urgent,total}, appointmentsToday, avgAdherence, riskDistribution:{low,moderate,high,critical} }`
`GET /patients?riskBand=&search=&page=` → paged `{ id,name,phone,riskScore,riskBand,lastReadingAt,adherencePercent,openAlertCount }`
`GET /patients/:id/summary` → full clinical snapshot (profile + trends + adherence + recent alerts)
`GET /alerts?status=open&severity=` → paged · `POST /alerts/:id/acknowledge` · `POST /alerts/:id/resolve` `{ "notes":"" }`
`GET /chat-review?flagged=true` → paged sessions needing review · `GET /chat-review/:sessionId` → full transcript + citations
`POST /knowledge` / `PATCH /knowledge/:id` / `POST /knowledge/:id/approve` — knowledge-base curation

### Daily patient summary — `GET /doctor/reports/daily` *(role: doctor, VIEW_PATIENT)*
`?date=YYYY-MM-DD` (clinic timezone; default today; a future date → `400`) `&format=json|pdf` (default `pdf`) `&purpose=view|download|share` (default `download`; PDF only).

The caller's own day at the practice the request is for (`x-medpin-practice` when they work at two). A patient is listed when a checked-in, in-consultation or completed appointment with this doctor at this practice, or a prescription this doctor issued there, falls on the date — and only while the practice may still read them (active enrolment, visit on or after `enrolledOn`).

- `format=json` → `{ report: { date, generatedAt, practice: { name, tagline, addressLine, city }, doctor: { name, qualifications, registrationNo }, patients: [ { name, age, sex, seenAt, visit, complaint: { text, source: "prescription"|"appointment" } | null, diagnosis: [], vitals: [ { at, bloodPressure, pulse, spo2, weightKg, waistCm, temperatureC } ], glucose: [ { at, valueMgDl, context } ], prescriptions: [ { issuedAt, source, standing, items: [ { name, strength, dose, frequency, durationDays, relationToMeal, instructions } ], investigations: [] } ], voidedPrescriptions, advice, followUpOn } ], totals: { patients, prescriptions } } }`. No ids, phone numbers, addresses or reference numbers.
- `format=pdf` → `application/pdf`, `Content-Disposition: attachment` (`inline` for `purpose=view`), `filename="daily-summary-<date>.pdf"`, `Cache-Control: no-store`.

Every call writes the clinical audit log before answering — one row per patient named (`resource: "DailyReport"`, `action: "read"` for a preview, `"export"`, or `"share"`), one row with no patient for an empty day. The server sends the document nowhere; sharing is the phone's share sheet.

### Patient list order and registration
`GET /doctor/patients?sort=risk|recent|name|inbox&page=&limit=` → paged. The order is worked out across the whole list before the page is cut:
- `risk`: highest risk score first.
- `recent`: latest glucose reading first.
- `name`: alphabetical.
- `inbox`: unread conversations first, newest unread first; then other conversations by latest message; then everybody else by name.

`POST /doctor/patients` enrols the patient at the caller's practice:
- A new number → `201 { id, name, phone, existing: false, enrollmentId, consentRequired: false }`.
- A number MedPin already has → `200 { id, name, phone, existing: true, enrollmentId, consentRequired, message }`. `consentRequired` means the patient has to read back a texted code first.
- A practice at its patient limit, or with a lapsed subscription → `400`, and nothing is written.

## 11a. People — `/team` *(role: any staff at a practice)*
### `GET /team`
→ `{ items, canManage, departments, locations, limits }`. Each item is `{ id, userId, name, phone, role, isOwner, department, location, permissions, usingPreset, status, startedOn, endedOn }`, where `status` is `active`, `suspended`, `left` or `disabled`.
### `POST /team/phone/otp` `{ phone }`
Texts a hiring code (same response as `/auth/otp/request`). Works for any number, including one that already has an account. Needs `MANAGE_STAFF`, and a doctor or the practice's owner.
### `POST /team/phone/verify` `{ phone, code }` → `{ phoneToken }`
### `POST /team` `{ role, name, phoneToken, password?, departmentId?, locationId?, qualifications?, registrationNo? }` → `201 { id, userId, name, phone, role, existing }`
- A number that already has an account in the same role is added to this practice with that account (`existing: true`). Its name, password and qualifications stay as they are.
- `409` for a patient's number, an account in another role, a switched-off account, somebody who already works here, or a practice at its limit on people.
### `PATCH /team/:id` `{ role?, departmentId?, locationId?, status? }` → `{ membership }`
- `status` is `active` or `suspended`. `active` brings back somebody who was suspended or who left, and is `409` at the limit on people.
- A role change also changes the account's role, and is `409` while the person works at another practice in a different role.

## 12. Uploads — `/uploads`
`POST /` `multipart/form-data`: `file` + `kind` (`foot_photo|retinal_report|lab_report|meal_photo|other`)
→ `201` `{ "id","kind","mimeType","sizeBytes","width","height","url":"/api/v1/uploads/:id/raw" }`
`GET /:id/raw` → binary (owner or clinician only)

## 13. Health — `GET /health` → `{ status:"ok", db:"connected", uptime, version }`
