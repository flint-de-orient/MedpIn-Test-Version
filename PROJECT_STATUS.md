# ClinQ / MedPin — project status

Last updated 2026-09-10 at `40d6b80`.

| | |
|---|---|
| Backend + console | `40d6b80` |
| Android | 1.0.17+8131 (versionCode 10131) |
| Version gate | `ANDROID_LATEST_BUILD=8131`, `ANDROID_LATEST_VERSION=1.0.17` |
| Tests | 1390 backend · 311 mobile |
| npm advisories | 0 |
| Razorpay | test mode — Essential ₹999, Professional ₹3,999, Enterprise ₹9,999, monthly |

---

## Waiting on you

Nothing here can be done from the codebase. Roughly in the order I'd do them.

### 1. Enrol two-factor on the admin console

The single weakest point in the system. `admin.medpin.in` is public, can suspend
every practice, and today a password is the only thing in the way. The console
already nags about it on every page. Five minutes at **Account → Two-factor**.

### 2. Rotate the exposed PAT

A personal access token for `flint-de-orient/ClinQ` was pasted into a chat
transcript. A working credential is stored via `git credential approve`, so
pushes keep working — but the exposed one should be revoked and replaced.

### 3. Run the staging isolation check

```bash
ALLOW_ISOLATION_TEST=true node scripts/verifyIsolation.js
```

On **staging**, never production — it writes real rows. The specification calls
it "the test that is the product" and it has never once been run. Everything
else about tenant isolation is proven by tests that stub or by an in-memory
database; this is the one that proves it against real infrastructure.

### 4. Razorpay end-to-end on a real device

Native checkout, test card, test UPI, a successful payment, a failed one,
`/billing/verify`, the webhook, activation, renewal, cancellation, retry, halt.

I stopped driving the handset after twice landing in a personal WhatsApp thread
instead of the app — `monkey` and `am start` do not reliably foreground it. The
app-side behaviour is covered by widget tests and the server by HTTP tests;
what neither can prove is Razorpay's own network calls from a real handset.

### 5. Smaller, and yours

- Register an MSG91 DLT template for the `enrol` OTP purpose.
- Delete the Behala Evening Clinic test practice.
- Set the business name and logo in **Razorpay Dashboard → Account & Settings**.
  The checkout sheet is branded MedPin from the app, but the *emailed receipt*
  comes from the account profile and the SDK cannot reach it.

---

## Waiting on me

### Self-service signup

Sign up → create practice → verify → choose plan → trial or payment →
subscription → owner → staff → onboarding.

Parked at your instruction. The largest remaining block, and the one that
changes who is allowed to create a practice — which is a product decision as
much as a build.

### Console redesign, phases 5 onward

Phases 1–3 are done (audit, design foundation, application shell). Phase 5 is
the page-by-page pass; `/practices` is the largest page and the densest table,
so it is where remaining polish will show most.

---

## What is built

### Billing and subscriptions

The whole loop, from a doctor tapping a plan to money arriving.

- Native Razorpay checkout in the app, branded MedPin, with the hosted page as
  a fallback for a device the SDK cannot run on.
- A confirmation sheet before checkout: plan, amount today, what recurs and how
  often, approximate next date, and what cancelling actually does.
- Checkout signature verification server-side, practice-scoped and idempotent.
- Webhook verification over raw bytes, with redelivery recognised by event id.
- Payment and Invoice records, upserted so a redelivery cannot bill twice.
- Billing history in the app, with a settle-this-bill action on an unpaid
  invoice.
- Plan changes: upgrade immediately, downgrade at period end, no proration.
- Pause and resume, which keep the mandate authorised.
- The operator console: subscription queue, plan reference, manual actions.

### Plans and entitlement

Four tiers — Trial, Essential, Professional, Enterprise. Capabilities resolve
from practice type ∩ plan, narrowed by role and permission. Limits are written
per practice when a plan is assigned, so a negotiated exception needs no new
tier.

Server-side enforcement on every capability that has an endpoint to enforce:
prescriptions, lab orders, lab results, departments, multi-location, advanced
analytics, advanced reports.

### Lapse policy

```
active → past due → grace (30 days) → restricted
```

Restricted blocks growth only: new patients, people, locations, and the paid
analytics. Never anything clinical, never the assistant, and never a practice's
own data export.

### Tenant isolation

Eight cross-tenant leaks were found and fixed. Every one is pinned by a test
that has been *seen to fail* — two practices, real HTTP, asserting on the other
practice's names rather than on counts.

---

## Decisions worth not re-litigating

Each of these was argued once and is easy to undo by accident.

**Absence permits.** A practice with no type, no plan or no membership gets
everything. Every practice that existed before these fields did is in that
state, and a guard that denied on missing data would have taken prescribing
away from a live clinic on the deploy that added a column.

**A lapse never reaches the clinical work.** A doctor who cannot open a chart
with a patient in front of them because a card expired is a patient-safety
incident that happens to have a billing cause. There is a test naming every
clinical capability and failing if one appears on the restricted list.

**A practice can always export its own records.** Export was on the restricted
list until an operator caught it. It is named patients, their phone numbers and
their readings — withholding it over an invoice holds medical records hostage,
and does so to exactly the practice that needs them most, because a customer
who has stopped paying is usually one who is leaving.

**Withholding insight is allowed; withholding access is not.** Analytics
interpret data a practice can still take with it in full. Export *is* the data.

**The app's word is not payment.** A success callback arrives on a device the
customer controls. The server verifies a signature, and even then records the
checkout rather than granting the plan — the plan moves when the webhook says
money arrived.

**Unknown is null, never zero.** A revenue dashboard reading ₹0 during a
provider outage is indistinguishable from a business that has lost every
customer, on the morning that is hardest to check. Same rule for usage limits:
a null cap renders "No limit", never "0".

**Money never moves backwards.** Upgrades take effect now and give away the
rest of a cheaper period; downgrades wait for the period already paid for.
Neither owes a refund, which is why there is no proration anywhere.

**No card data, anywhere.** Not a number, not an expiry, not a last four. The
card is typed into Razorpay's own sheet and this server never sees it. That is
what keeps a clinical server out of PCI scope, and there are tests that a
client forwarding a PAN cannot persist one.

**Plans are a deploy, prices are a new Razorpay plan.** There is no "create
plan" in the console, because a tier is an enum entry that gates capabilities —
a row written from a web form would be a plan the resolver has never heard of,
and unknown means unrestricted.

---

## Things that look like bugs and are not

- An empty permission grant falls back to the role preset, and an empty
  `homeCards` list shows every card. Empty means unmigrated, not "stripped".
- A department with no `assistantScope` gets **no** assistant rather than a
  general one.
- `limits.staff` counts *people* — doctors and the owner included. A pricing
  page must say "people", not "staff".
- `LAB_RESULT` is gated but refuses nobody: every plan has it, and must, since
  Essential holds `LAB_ORDER` and ordering an investigation nobody may read is
  not a product.
- Four capabilities have no gate because they have no endpoint —
  `REPORT_EXPORT` (built in the app), `DEPARTMENT_ANALYTICS`, `STAFF_ANALYTICS`,
  `SCHEDULED_REPORTS` (not built). A test names them so the gap stays a
  decision rather than an oversight.

---

## Traps that have cost real time

**Never pipe a release build.** `./build_release.sh | tail -30` reports
*tail's* exit code. It said success while Gradle had failed, and the broken APK
was only caught by reading the log. Redirect instead.

**R8 keep rules are not optional.** This app is obfuscated and split-per-ABI.
It has already lost medicine reminders to a missing Gson rule that only mattered
in release, and Razorpay resolves its callbacks by method name — so obfuscation
would break the path that reports a *successful* payment.

**`Repository not found` on a push means no credential, not lost access.**
GitHub returns 404 rather than 401 for a private repo when unauthenticated, so
git never invokes the credential helper and never prompts. `origin` keeps
working throughout because it is public, which makes "origin works, flint does
not" misleading evidence.

**Mongoose queries are lazy.** `Model.updateOne()` returns a `Query` that
executes nothing until awaited or `.exec()`d. A counter was built, tested, and
never ran.

**Code with no caller is not a feature.** The dead-service ratchet has caught
four of these. Each time, wiring it properly produced a better design than the
one it rejected.
