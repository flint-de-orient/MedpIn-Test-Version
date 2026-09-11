"use client";

import { useEffect, useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { PracticeType } from "@/lib/types";
import { Field, Select, textInput } from "@/components/form";
import { cn } from "@/lib/utils";

/**
 * A practice applying to exist.
 *
 * ---- What this produces, and what it deliberately does not --------------
 *
 * An application. Not a practice, not an account, not a session. A Practice is
 * a tenant on this platform — capability resolution, billing and enrolment
 * scoping all point at one — so nothing a public form does may create one. An
 * operator reads the application and approves it, and that is the moment a
 * tenant exists.
 *
 * The applicant leaves with a reference and no account, which is why the
 * reference is long and random: it is the only thing that identifies the
 * application to them, and a short one would let anybody read a stranger's
 * contact details and licence number by counting.
 *
 * ---- Why the phone is proved in the middle, not at the end --------------
 *
 * The code is the expensive step — an SMS, a wait, a number typed in — and it
 * is the one that can fail for reasons the applicant cannot fix by editing a
 * field. Putting it after the practice details means somebody who cannot
 * receive the code has still not typed a licence number; putting it last would
 * mean they filled in five screens first.
 *
 * There is no document upload anywhere in this flow. The platform has no
 * scanning, quarantine or retention story for files from people without
 * accounts, and a working-looking upload that stores nothing is worse than
 * none. An operator asks for papers in a note.
 */
export function PracticeSignup({
  onDone,
  onLeave,
}: {
  onDone: (reference: string) => void;
  /**
   * Back on step one.
   *
   * The form owns the only Back on the screen, so on the first step it has to
   * mean "leave" — a disabled control at the start of a flow is a dead button
   * somebody presses twice before believing it.
   */
  onLeave: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- what the form holds ------------------------------------------------
  const [practiceName, setPracticeName] = useState("");
  const [practiceType, setPracticeType] = useState<PracticeType | "">("");
  const [specialty, setSpecialty] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);

  const [registrationNo, setRegistrationNo] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorRegistrationNo, setDoctorRegistrationNo] = useState("");
  const [notes, setNotes] = useState("");

  /*
   * The types the server actually has.
   *
   * Fetched rather than listed here. A copy in the client is how a public form
   * ends up offering a type the enum has never heard of — and the submission
   * would then be refused by the validator for a value this screen suggested.
   */
  const [types, setTypes] = useState<{ key: string; label: string }[] | null>(null);
  useEffect(() => {
    api<{ types: { key: string; label: string }[] }>("/applications/options", {
      anonymous: true,
    })
      .then((out) => setTypes(out.types ?? []))
      .catch(() => {
        /*
         * `[]`, not silence.
         *
         * This swallowed the failure and left `types` empty, so the picker
         * rendered with one option reading "Select a type (optional)" and
         * nothing to select — a control that looks available, opens, and has
         * nothing in it. That is what an operator sees when the console is
         * newer than the API it is talking to and this route is not deployed
         * yet, which is exactly when it happened.
         *
         * The field is optional, so the form still submits. It just says why
         * it cannot offer the list instead of pretending there is not one.
         */
        setTypes([]);
      });
  }, []);

  /*
   * The complaint clears when the thing complained about changes.
   *
   * This only watched `step`, so pressing Continue with half an email address
   * typed left "That does not look like an email address." on screen while the
   * rest of it was typed — the form telling somebody their valid email is
   * invalid, in red, as they look at it. An error that outlives its cause is
   * worse than no error: the next one is not believed either.
   */
  useEffect(() => {
    setError(null);
  }, [step, practiceName, contactName, contactEmail, phone, registrationNo, doctorName]);

  const e164 = useMemo(() => toE164(phone), [phone]);

  /*
   * Four steps. "Verify" used to be a fifth, on its own.
   *
   * It held one sentence and a button: type a number on step two, press
   * Continue, then press "Send the code" on step three. A step whose entire
   * content is a button that could have been on the step before it is a step
   * somebody counts and resents.
   *
   * The code arrives on the phone in the hand holding it, so the natural place
   * to prove the number is directly under the field where it was typed.
   */
  const STEPS = ["Practice", "Contact", "Registration", "Review"];

  /* ------------------------------------------------------------- validation */

  /**
   * What is wrong with each field, rather than what is wrong with the step.
   *
   * This returned one sentence for the whole step, so a form with six boxes
   * answered "That does not look like an email address" in a banner under all
   * of them and left the reader to work out which. The message belongs beside
   * the box, and the step is blocked when any of them has one.
   */
  function problems(): Record<string, string> {
    const p: Record<string, string> = {};

    if (step === 0) {
      if (practiceName.trim().length < 2) p.practiceName = "The practice needs a name.";
      // Optional on purpose: the model permits null for both and the capability
      // resolver reads null as unclassified, so requiring them here would be
      // stricter than anything else enforces.
      if (addressLine.trim().length < 4) p.addressLine = "Where is the practice?";
      if (city.trim().length < 2) p.city = "Which city?";
      if (stateName.trim().length < 2) p.state = "Which state?";
      if (!/^\d{6}$/.test(postalCode.trim())) p.postalCode = "Six digits.";
    }

    if (step === 1) {
      if (contactName.trim().length < 2) p.contactName = "Who should we contact?";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim()))
        p.contactEmail = "That does not look like an email address.";
      if (!e164) p.phone = "Enter a ten-digit mobile number.";
      else if (!phoneToken) p.phone = "Verify this number to continue.";
    }

    return p;
  }

  /**
   * Which fields have been visited.
   *
   * An error under a box somebody has not typed in yet is the form telling them
   * off for not having started. Pressing Continue marks the whole step touched,
   * so nothing stays hidden at the moment it blocks them.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const found = problems();
  const shown = (k: string) => (touched[k] ? found[k] : undefined);

  function next() {
    const keys = Object.keys(found);
    if (keys.length) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }));
      return;
    }
    setTouched({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  /* ----------------------------------------------------------- verification */

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      // This router's own, not `/auth/otp/request`. The console reverse-proxies
      // `/applications/` and `/admin/` and not `/auth/`, so the shared endpoint
      // 404ed in production and nowhere else — see the note on the route.
      await api("/applications/verify/send", {
        method: "POST",
        anonymous: true,
        body: { phone: e164 },
      });
      setSent(true);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ phoneToken: string }>("/applications/verify/check", {
        method: "POST",
        anonymous: true,
        body: { phone: e164, code: value },
      });
      setPhoneToken(out.phoneToken);
      setStep(3);
    } catch (ex) {
      setError((ex as ApiError).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- submit */

  async function submit() {
    if (!phoneToken) {
      setError("Verify the number to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ application: { reference: string } }>("/applications", {
        method: "POST",
        anonymous: true,
        body: {
          practiceName: practiceName.trim(),
          practiceType: practiceType || undefined,
          specialty: specialty.trim(),
          addressLine: addressLine.trim(),
          city: city.trim(),
          state: stateName.trim(),
          postalCode: postalCode.trim(),
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
          // The proof, not the number. The server reads the phone out of this
          // and ignores anything else claiming to be one.
          phoneToken,
          registrationNo: registrationNo.trim(),
          doctorName: doctorName.trim(),
          doctorRegistrationNo: doctorRegistrationNo.trim(),
          notes: notes.trim(),
        },
      });
      onDone(out.application.reference);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ view */

  return (
    <div className="flex flex-col gap-5">
      <Progress steps={STEPS} at={step} />

      <div className="border-border bg-card rounded-md border p-6 sm:p-7">
        <h2 className="text-heading font-semibold tracking-tight">{STEPS[step]}</h2>
        <p className="text-muted-foreground mt-1.5 text-caption leading-relaxed">
          {
            [
              "What the practice is called, and what kind of thing it is.",
              "Who we contact, and the number we verify.",
              "Answer the code so we know the number is yours.",
              "What a reviewer checks against a register. All optional — a missing number means we will ask.",
              "Check it over. Nothing is created until MedPin reviews this.",
            ][step]
          }
        </p>

        <div className="mt-5 flex flex-col gap-4">
          {step === 0 ? (
            <>
              <Field label="Practice name" error={shown("practiceName")}>
                <input
                  className={textInput}
                  value={practiceName}
                  onChange={(e) => setPracticeName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, practiceName: true }))}
                  maxLength={160}
                  autoFocus
                />
              </Field>
              <Field
                label="Practice type"
                hint={types && types.length === 0 ? "unavailable just now" : "optional"}
              >
                <Select
                  // Disabled while empty. A picker that opens onto one line
                  // reading "Select a type (optional)" is a control that looks
                  // available and is not, which is worse than one that says it
                  // cannot help — and the field is optional either way.
                  disabled={types !== null && types.length === 0}
                  value={practiceType}
                  onChange={(v) => setPracticeType(v as PracticeType | "")}
                  // "Not saying yet" is how an operator talks to another
                  // operator. This form is read by a customer filling in a
                  // registration, and the field is genuinely optional.
                  placeholder="Select a type (optional)"
                >
                  {(types ?? []).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Primary specialty" hint="optional">
                <input
                  className={textInput}
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  maxLength={80}
                />
              </Field>
              <Field label="Address" error={shown("addressLine")}>
                <input
                  className={textInput}
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, addressLine: true }))}
                  maxLength={200}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="City" error={shown("city")}>
                  <input
                    className={textInput}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, city: true }))}
                    maxLength={80}
                  />
                </Field>
                <Field label="State" error={shown("state")}>
                  <input
                    className={textInput}
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, state: true }))}
                    maxLength={80}
                  />
                </Field>
                <Field label="PIN" hint="six digits" error={shown("postalCode")}>
                  <input
                    className={`${textInput} tnum font-mono`}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => setTouched((t) => ({ ...t, postalCode: true }))}
                    maxLength={6}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Field label="Your name" error={shown("contactName")}>
                <input
                  className={textInput}
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, contactName: true }))}
                  maxLength={120}
                  autoFocus
                />
              </Field>
              <Field label="Email" error={shown("contactEmail")}>
                <input
                  className={textInput}
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, contactEmail: true }))}
                  maxLength={160}
                />
              </Field>
              <Field
                label="Mobile number"
                hint="we text a code to this, and it becomes the sign-in for the practice"
                error={shown("phone")}
              >
                <input
                  className={`${textInput} tnum font-mono`}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    // Editing the number invalidates the proof. Keeping a token
                    // for a number the form no longer shows is how somebody
                    // verifies one and submits another.
                    setPhoneToken(null);
                    setSent(false);
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  inputMode="tel"
                  maxLength={16}
                  placeholder="+91"
                />
              </Field>
              {/*
                No password. A practice does not sign into this domain at all —
                the app identifies a clinician by phone — and collecting one
                here would be a credential with nothing to unlock.
              */}
              <p className="text-muted-foreground text-micro leading-relaxed">
                No password to choose. Once the practice is approved, whoever
                holds this number signs in on the MedPin app.
              </p>

              {/*
                Proving the number, under the field that asked for it.

                This was a step of its own holding one sentence and a button.
                The code arrives on the phone already in somebody's hand, so
                the place to answer it is here — and the step indicator loses a
                number nobody wanted to count.
              */}
              <div className="border-border mt-1 flex flex-col gap-3 border-t pt-4">
              <p className="text-body">
                We will text a code to{" "}
                <span className="font-mono font-medium">{e164 ?? phone}</span>.
              </p>

              {!sent ? (
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={busy || !e164}
                  className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2.5 text-body font-medium transition-opacity disabled:opacity-55"
                >
                  {busy ? "Sending…" : "Send the code"}
                </button>
              ) : (
                <>
                  <Field label="The code we texted">
                    <input
                      className={`${textInput} tnum w-40 text-center font-mono tracking-[0.4em]`}
                      value={code}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setCode(v);
                        // Submits itself on the last digit, so a filled code
                        // does not wait for a button somebody has to find.
                        if (v.length === 6) void checkCode(v);
                      }}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      disabled={busy}
                      autoFocus
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => void sendCode()}
                    disabled={busy}
                    className="text-primary w-fit text-caption underline underline-offset-4 disabled:opacity-55"
                  >
                    Send another
                  </button>
                </>
              )}

              {phoneToken ? (
                <p className="text-ok-ink border-l-ok bg-ok-tint rounded-sm border-l-2 px-3 py-2 text-caption">
                  Number verified.
                </p>
              ) : null}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Field label="Practice registration number" hint="optional">
                <input
                  className={`${textInput} font-mono`}
                  value={registrationNo}
                  onChange={(e) => setRegistrationNo(e.target.value)}
                  maxLength={60}
                  autoFocus
                />
              </Field>
              <Field label="Primary doctor" hint="optional">
                <input
                  className={textInput}
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label="Their council registration" hint="optional">
                <input
                  className={`${textInput} font-mono`}
                  value={doctorRegistrationNo}
                  onChange={(e) => setDoctorRegistrationNo(e.target.value)}
                  maxLength={60}
                />
              </Field>
              <Field label="Anything else" hint="optional">
                <textarea
                  className={`${textInput} resize-y`}
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <p className="text-muted-foreground text-micro leading-relaxed">
                No documents to upload. If MedPin needs papers, they will ask
                for them by name once somebody has read this.
              </p>
            </>
          ) : null}

          {step === 3 ? (
            <dl className="divide-border border-border divide-y rounded-md border">
              <Summary label="Practice" value={practiceName} />
              <Summary
                label="Type"
                value={
                  (types ?? []).find((t) => t.key === practiceType)?.label ?? "not said"
                }
              />
              <Summary label="Specialty" value={specialty || "not said"} />
              <Summary
                label="Where"
                value={
                  [addressLine, city, stateName, postalCode].filter(Boolean).join(", ") ||
                  "not given"
                }
              />
              <Summary label="Contact" value={contactName} />
              <Summary label="Email" value={contactEmail} mono />
              <Summary label="Mobile" value={`${e164 ?? phone} · verified`} mono />
              <Summary label="Practice registration" value={registrationNo || "none given"} mono />
              <Summary label="Primary doctor" value={doctorName || "not named"} />
              <Summary
                label="Council registration"
                value={doctorRegistrationNo || "none given"}
                mono
              />
            </dl>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="text-stopped-ink border-l-stopped bg-stopped-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-border mt-6 flex items-center justify-between gap-3 border-t pt-5">
          <button
            type="button"
            onClick={() => (step === 0 ? onLeave() : setStep((s) => s - 1))}
            disabled={busy}
            className="border-border hover:bg-secondary shrink-0 rounded-md border px-4 py-2 text-body font-medium transition-colors disabled:opacity-40"
          >
            Back
          </button>

          {step === 3 ? (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-body font-medium transition-opacity disabled:opacity-55"
            >
              {busy ? "Submitting…" : "Submit registration"}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={busy}
              className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-body font-medium transition-opacity disabled:opacity-55"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Where you are in a five-step form, and what is behind you.
 *
 * ---- Three states, told apart without colour ----------------------------
 *
 * Done is a tick, current is a filled badge, ahead is an outline. A reader who
 * cannot separate the blues still has three different shapes, and the current
 * step is named in full above the fields as well — a row of numbers is a
 * position, not a label.
 *
 * The labels collapse to numbers below `sm`. Five words at 11px across a 360px
 * screen either wrap into three lines or shrink until nobody reads them, and
 * what somebody actually needs on a phone is "three of five".
 */
function Progress({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
      aria-label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}
    >
      {steps.map((label, i) => {
        const done = i < at;
        const current = i === at;

        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-1 transition-colors duration-150 sm:pr-2.5",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/40 text-primary"
                    : "border-border text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "tnum flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-semibold",
                  current
                    ? "bg-primary-foreground text-primary"
                    : done
                      ? "bg-accent text-primary"
                      : "bg-secondary",
                )}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" fill="none" className="size-3" aria-hidden>
                    <path
                      d="m5 13 4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {/* The word, where there is room for it. */}
              <span className="hidden text-micro font-medium sm:inline">{label}</span>
              {/* And for anybody who cannot see the badge at all. */}
              <span className="sr-only">
                {label}
                {done ? " — done" : current ? " — current" : ""}
              </span>
            </span>

            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "h-px w-3 sm:w-4",
                  done ? "bg-primary/40" : "bg-border",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Summary({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="text-muted-foreground text-caption">{label}</dt>
      <dd className={cn("min-w-0 text-right text-body", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

/**
 * Ten digits, or a number already in E.164.
 *
 * The server normalises too and is the authority; this exists so the screen can
 * show what will be texted before anything is sent.
 */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^\+91\d{10}$/.test(raw.trim())) return raw.trim();
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}
