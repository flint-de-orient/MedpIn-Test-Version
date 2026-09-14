"use client";

import { useEffect, useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { PracticeType } from "@/lib/types";
import { Field, Select, textInput } from "@/components/form";
import { Alert } from "@/components/primitives";
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
 * mean they filled in three screens first.
 *
 * There is no document upload anywhere in this flow. The platform has no
 * scanning, quarantine or retention story for files from people without
 * accounts, and a working-looking upload that stores nothing is worse than
 * none. An operator asks for papers in a note.
 */

/**
 * The steps, each with its own subtitle and the fields it holds.
 *
 * ---- Named, not numbered -------------------------------------------------
 *
 * "Verify" was a fifth step once. When it moved under the phone field the list
 * lost an entry, and two things went on counting from the old one: the code
 * check still jumped with a literal index — which had become Review, so every
 * applicant who typed the code skipped the page where a reviewer's evidence is
 * collected — and the subtitles were a separate list of five sentences for four
 * steps, each screen after Contact describing the one before it.
 *
 * So a step is an id, its sentence sits beside its name, and the fields it holds
 * are listed with it: a refusal that names a field can be taken to the step that
 * field is on. See practiceSignupForm.test.js.
 */
const STEPS = [
  {
    id: "practice",
    label: "Practice",
    blurb: "What the practice is called, what kind it is, and where it is.",
    fields: ["practiceName", "practiceType", "specialty", "addressLine", "city", "state", "postalCode"],
  },
  {
    id: "contact",
    label: "Contact",
    blurb: "Who we contact, whether that is the doctor, and the number we verify.",
    fields: ["contactName", "contactEmail", "contactIsPrimaryDoctor", "phone", "phoneToken"],
  },
  {
    id: "registration",
    label: "Registration",
    blurb: "What a reviewer checks against a register. All optional — a missing number means we will ask.",
    fields: ["registrationNo", "doctorName", "doctorRegistrationNo", "departments", "doctorDepartment", "notes"],
  },
  {
    id: "review",
    label: "Review",
    blurb: "Check it over. Nothing is created until MedPin reviews this.",
    fields: [],
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

/**
 * The server's email rule, character for character.
 *
 * `contactEmail` is checked with zod's `.email()`. A rule looser than that is a
 * round trip ending in "Request validation failed" after four screens, so this
 * is zod's own pattern rather than an approximation of it — and the test that
 * pins it reads zod.
 */
// eslint-disable-next-line no-useless-escape
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

/** What the server accepts as a code, before one is sent to it. */
const CODE = /^\d{4,8}$/;

/** The server's cap on departments. A public route does not take an unbounded list. */
const MAX_DEPARTMENTS = 24;

export function PracticeSignup({
  onDone,
  onExisting,
  onLeave,
}: {
  onDone: (reference: string) => void;
  /**
   * An application from this number is already open.
   *
   * Not an error to show. Somebody applying twice has most often lost the
   * reference, and the refusal carries it — so it is handed on, and the status
   * view opens where "use the reference you were given" can actually be done.
   */
  onExisting: (reference: string) => void;
  /**
   * Back on step one.
   *
   * The form owns the only Back on the screen, so on the first step it has to
   * mean "leave" — a disabled control at the start of a flow is a dead button
   * somebody presses twice before believing it.
   */
  onLeave: () => void;
}) {
  const [step, setStep] = useState<StepId>("practice");
  const at = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[at];

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
  /**
   * Whether the person filling this in is the practice's doctor.
   *
   * No default. The contact used to become the head doctor whoever they were,
   * so a manager applying for a clinic was approved into a doctor's account
   * under the doctor's name. A question with a pre-selected answer is that
   * mistake again, one click quicker.
   */
  const [primaryDoctor, setPrimaryDoctor] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");

  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ simulated: boolean; minutes: number | null } | null>(null);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);

  const [registrationNo, setRegistrationNo] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorRegistrationNo, setDoctorRegistrationNo] = useState("");
  const [notes, setNotes] = useState("");

  /**
   * What the server said about a field, by the field's name.
   *
   * Shown under the box it is about whether or not the box was touched — the
   * server has looked at it, which is more than touching — and cleared the
   * moment that box changes.
   */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  function clearServer(key: string) {
    setServerErrors((cur) => {
      if (!(key in cur)) return cur;
      const rest = { ...cur };
      delete rest[key];
      return rest;
    });
  }

  /*
   * The types the server actually has.
   *
   * Fetched rather than listed here. A copy in the client is how a public form
   * ends up offering a type the enum has never heard of — and the submission
   * would then be refused by the validator for a value this screen suggested.
   */
  type TypeOption = { key: string; label: string; hasDepartments?: boolean };
  const [types, setTypes] = useState<TypeOption[] | null>(null);

  /**
   * The shared specialty catalogue, which is also the department list.
   *
   * Offered rather than typed. A department an applicant invents becomes a real
   * row on approval, and "Cardiolgy" on a letterhead is the kind of thing
   * nobody notices until it is printed.
   */
  const [catalogue, setCatalogue] = useState<{ key: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [doctorDepartment, setDoctorDepartment] = useState("");

  /**
   * Whether the options could not be fetched at all.
   *
   * Separate from an empty catalogue. Both left the list empty, and both said
   * "We could not load the list" — so a deployment that simply has no shared
   * departments yet told every applicant it was broken.
   */
  const [optionsFailed, setOptionsFailed] = useState(false);

  useEffect(() => {
    api<{
      types: TypeOption[];
      departments: { key: string; label: string }[];
    }>("/applications/options", { anonymous: true })
      .then((out) => {
        setTypes(out.types ?? []);
        setCatalogue(out.departments ?? []);
      })
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
        setCatalogue([]);
        setOptionsFailed(true);
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
  }, [step, practiceName, contactName, contactEmail, phone, registrationNo, doctorName, primaryDoctor]);

  const e164 = useMemo(() => toE164(phone), [phone]);

  /*
   * Whether this kind of practice has departments at all.
   *
   * The server says so, per type, from the table that actually grants the
   * capability — a clinic never has one on any plan, and that is what a solo
   * practice is. Working it out here would be a second copy of a rule that
   * lives in capabilities.js, disagreeing the first time either moved.
   *
   * Unknown while the options are loading, and unknown means do not ask: a
   * field that appears a second after the step does is worse than one that
   * appears with it.
   */
  const asksDepartments = Boolean(
    practiceType && types?.find((t) => t.key === practiceType)?.hasDepartments,
  );

  // Changing to a type that has none clears what was chosen, so a polyclinic
  // edited down to a clinic does not submit departments it no longer has.
  useEffect(() => {
    if (!asksDepartments) {
      setDepartments([]);
      setDoctorDepartment("");
    }
  }, [asksDepartments]);

  /* ------------------------------------------------------------- validation */

  /**
   * What is wrong with each field, rather than what is wrong with the step.
   *
   * This returned one sentence for the whole step, so a form with six boxes
   * answered "That does not look like an email address" in a banner under all
   * of them and left the reader to work out which. The message belongs beside
   * the box, and the step is blocked when any of them has one.
   *
   * The same rules the server applies, so what passes here is not refused
   * there: zod's email pattern, the server's phone normalisation, its cap on
   * departments.
   */
  function problems(): Record<string, string> {
    const p: Record<string, string> = {};

    if (step === "practice") {
      if (practiceName.trim().length < 2) p.practiceName = "The practice needs a name.";
      // Type and specialty are optional on purpose: the model permits null for
      // both and the capability resolver reads null as unclassified, so
      // requiring them here would be stricter than anything else enforces.
      if (addressLine.trim().length < 4) p.addressLine = "Where is the practice?";
      if (city.trim().length < 2) p.city = "Which city?";
      if (stateName.trim().length < 2) p.state = "Which state?";
      if (!/^\d{6}$/.test(postalCode.trim())) p.postalCode = "Six digits.";
    }

    if (step === "contact") {
      if (contactName.trim().length < 2) p.contactName = "Who should we contact?";
      if (!EMAIL.test(contactEmail.trim()))
        p.contactEmail = "That does not look like an email address.";
      if (primaryDoctor === null)
        p.contactIsPrimaryDoctor = "Say whether you are the practice’s doctor.";
      if (!e164) p.phone = "Enter a mobile number: ten digits, or with its country code.";
      else if (!phoneToken) p.phone = "Verify this number to continue.";
    }

    if (step === "registration" && departments.length > MAX_DEPARTMENTS) {
      p.departments = `Choose ${MAX_DEPARTMENTS} at most.`;
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
  const shown = (k: string) => serverErrors[k] ?? (touched[k] ? found[k] : undefined);

  function goTo(id: StepId) {
    setStep(id);
  }

  function next() {
    const keys = Object.keys(found);
    if (keys.length) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }));
      return;
    }
    setTouched({});
    goTo(STEPS[Math.min(at + 1, STEPS.length - 1)].id);
  }

  function back() {
    if (at === 0) return onLeave();
    goTo(STEPS[at - 1].id);
  }

  /* ----------------------------------------------------------- verification */

  async function sendCode() {
    if (!e164) return;
    setBusy(true);
    setError(null);
    clearServer("phone");
    try {
      // This router's own, not `/auth/otp/request`. The console reverse-proxies
      // `/applications/` and `/admin/` and not `/auth/`, so the shared endpoint
      // 404ed in production and nowhere else — see the note on the route.
      const out = await api<{ simulated?: boolean; expiresInSeconds?: number }>(
        "/applications/verify/send",
        { method: "POST", anonymous: true, body: { phone: e164 } },
      );
      setSent({
        simulated: out.simulated === true,
        minutes: out.expiresInSeconds ? Math.round(out.expiresInSeconds / 60) : null,
      });
      setCode("");
    } catch (ex) {
      // Never a refusal about the number itself: the server says nothing about
      // a number until its code is answered. See checkCode.
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    if (!CODE.test(value) || !e164) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ phoneToken: string }>("/applications/verify/check", {
        method: "POST",
        anonymous: true,
        body: { phone: e164, code: value },
      });
      /*
       * The proof, and nothing else.
       *
       * This used to move the form as well, to a step number that had come to
       * mean Review. Proving the number is part of Contact; what follows Contact
       * is decided by Contact's own Continue, which checks the rest of it.
       */
      setPhoneToken(out.phoneToken);
      clearServer("phone");
    } catch (ex) {
      const err = ex as ApiError;
      // A number whose account cannot own a practice is a problem with this
      // box, and the sentence says why. Only now, to whoever answered the code:
      // before that it would tell anyone what kind of account the number has.
      if (err.code === "ACCOUNT_NOT_ELIGIBLE") {
        setSent(null);
        setServerErrors((c) => ({ ...c, phone: err.message }));
      } else {
        setError(err.message);
      }
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- submit */

  async function submit() {
    if (!phoneToken) {
      setTouched((t) => ({ ...t, phone: true }));
      goTo("contact");
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
          contactIsPrimaryDoctor: primaryDoctor === true,
          // The proof, not the number. The server reads the phone out of this
          // and ignores anything else claiming to be one.
          phoneToken,
          registrationNo: registrationNo.trim(),
          doctorName: doctorName.trim(),
          departments,
          doctorDepartment: doctorDepartment || undefined,
          doctorRegistrationNo: doctorRegistrationNo.trim(),
          notes: notes.trim(),
        },
      });
      onDone(out.application.reference);
    } catch (ex) {
      const err = ex as ApiError;

      // The proof outlived its half hour. Keeping it would send the same dead
      // token again on every press, so it goes, and so does "code sent".
      if (err.code === "PHONE_TOKEN_EXPIRED") {
        setPhoneToken(null);
        setSent(null);
        setCode("");
        setServerErrors((c) => ({ ...c, phone: err.message }));
        goTo("contact");
        return;
      }

      if (err.code === "APPLICATION_OPEN") {
        const reference = referenceIn(err.details);
        if (reference) {
          onExisting(reference);
          return;
        }
      }

      if (err.code === "ACCOUNT_NOT_ELIGIBLE") {
        setPhoneToken(null);
        setSent(null);
        setServerErrors((c) => ({ ...c, phone: err.message }));
        goTo("contact");
        return;
      }

      // Each refused field under its own box, on the step that holds it.
      if (err.code === "VALIDATION_ERROR") {
        const byField = fieldErrors(err.details);
        const first = STEPS.find((s) => s.fields.some((f) => f in byField));
        if (first) {
          setServerErrors(byField);
          goTo(first.id);
          return;
        }
      }

      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const doctorLabel = primaryDoctor === false ? "their" : "your";

  /* ------------------------------------------------------------------ view */

  return (
    <div className="flex flex-col gap-5">
      <Progress steps={STEPS.map((s) => s.label)} at={at} />

      <div className="border-border bg-card rounded-md border p-6 sm:p-7">
        <h2 className="text-heading font-semibold tracking-tight">{current.label}</h2>
        <p className="text-muted-foreground mt-1.5 text-caption leading-relaxed">{current.blurb}</p>

        <div className="mt-5 flex flex-col gap-4">
          {step === "practice" ? (
            <>
              <Field label="Practice name" error={shown("practiceName")}>
                <input
                  className={textInput}
                  value={practiceName}
                  onChange={(e) => {
                    setPracticeName(e.target.value);
                    clearServer("practiceName");
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, practiceName: true }))}
                  maxLength={160}
                  autoFocus
                />
              </Field>
              <Field
                label="Practice type"
                hint={types && types.length === 0 ? "unavailable just now" : "optional"}
                error={shown("practiceType")}
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
              <Field label="Primary specialty" hint="optional" error={shown("specialty")}>
                <input
                  className={textInput}
                  value={specialty}
                  onChange={(e) => {
                    setSpecialty(e.target.value);
                    clearServer("specialty");
                  }}
                  maxLength={80}
                />
              </Field>
              <Field label="Address" error={shown("addressLine")}>
                <input
                  className={textInput}
                  value={addressLine}
                  onChange={(e) => {
                    setAddressLine(e.target.value);
                    clearServer("addressLine");
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, addressLine: true }))}
                  maxLength={200}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="City" error={shown("city")}>
                  <input
                    className={textInput}
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      clearServer("city");
                    }}
                    onBlur={() => setTouched((t) => ({ ...t, city: true }))}
                    maxLength={80}
                  />
                </Field>
                <Field label="State" error={shown("state")}>
                  <input
                    className={textInput}
                    value={stateName}
                    onChange={(e) => {
                      setStateName(e.target.value);
                      clearServer("state");
                    }}
                    onBlur={() => setTouched((t) => ({ ...t, state: true }))}
                    maxLength={80}
                  />
                </Field>
                <Field label="PIN" hint="six digits" error={shown("postalCode")}>
                  <input
                    className={`${textInput} tnum font-mono`}
                    value={postalCode}
                    onChange={(e) => {
                      setPostalCode(e.target.value.replace(/\D/g, ""));
                      clearServer("postalCode");
                    }}
                    onBlur={() => setTouched((t) => ({ ...t, postalCode: true }))}
                    maxLength={6}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </>
          ) : null}

          {step === "contact" ? (
            <>
              <Field label="Your name" error={shown("contactName")}>
                <input
                  className={textInput}
                  value={contactName}
                  onChange={(e) => {
                    setContactName(e.target.value);
                    clearServer("contactName");
                  }}
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
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                    clearServer("contactEmail");
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, contactEmail: true }))}
                  maxLength={160}
                />
              </Field>

              {/*
                Who the applicant is to the practice, asked where they say who
                they are.

                It decides what approval makes of this number: the head doctor,
                or the manager who runs the practice and adds its doctor. Two
                answers written out, rather than a checkbox whose unticked state
                somebody has to interpret.
              */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-muted-foreground text-micro font-medium tracking-[0.04em] uppercase">
                  Are you the practice’s doctor?
                </legend>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {[
                    { value: true, title: "Yes, I am", detail: "You sign in as its head doctor." },
                    {
                      value: false,
                      title: "No, I run it for the doctor",
                      detail: "You sign in as its manager and add the doctor in the app.",
                    },
                  ].map((choice) => (
                    <label
                      key={String(choice.value)}
                      className={cn(
                        "border-input flex cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2.5 transition-colors",
                        primaryDoctor === choice.value && "border-primary bg-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name="contact-is-primary-doctor"
                        className="accent-primary mt-0.5 size-4 shrink-0"
                        checked={primaryDoctor === choice.value}
                        onChange={() => {
                          setPrimaryDoctor(choice.value);
                          clearServer("contactIsPrimaryDoctor");
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-body font-medium">{choice.title}</span>
                        <span className="text-muted-foreground block text-caption leading-relaxed">
                          {choice.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {shown("contactIsPrimaryDoctor") ? (
                  <span role="alert" className="text-stopped-ink text-caption leading-relaxed">
                    {shown("contactIsPrimaryDoctor")}
                  </span>
                ) : null}
              </fieldset>

              <Field
                label="Mobile number"
                hint="we text a code to this, and it becomes the practice’s sign-in"
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
                    setSent(null);
                    setCode("");
                    clearServer("phone");
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
                {phoneToken ? (
                  <p className="text-ok-ink border-l-ok bg-ok-tint rounded-sm border-l-2 px-3 py-2 text-caption">
                    <span className="font-mono">{e164}</span> is verified.
                  </p>
                ) : !sent ? (
                  <>
                    <p className="text-body">
                      We will text a code to{" "}
                      <span className="font-mono font-medium">{e164 ?? phone}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() => void sendCode()}
                      disabled={busy || !e164}
                      className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2.5 text-body font-medium transition-opacity disabled:opacity-55"
                    >
                      {busy ? "Sending…" : "Send the code"}
                    </button>
                  </>
                ) : (
                  <>
                    {/*
                      Said out loud when nothing was sent, the way the operator's
                      own wizard does. A tester who is not told sits waiting for
                      a text from a server that has no way to send one.
                    */}
                    {sent.simulated ? (
                      <Alert title="No text message was sent">
                        This server has no SMS set up, so the code is in its log.
                      </Alert>
                    ) : (
                      <p className="text-muted-foreground text-caption leading-relaxed">
                        Sent to <span className="font-mono">{e164}</span>
                        {sent.minutes ? `. It works for ${sent.minutes} minutes.` : "."}
                      </p>
                    )}
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
              </div>
            </>
          ) : null}

          {step === "registration" ? (
            <>
              <Field label="Practice registration number" hint="optional" error={shown("registrationNo")}>
                <input
                  className={`${textInput} font-mono`}
                  value={registrationNo}
                  onChange={(e) => {
                    setRegistrationNo(e.target.value);
                    clearServer("registrationNo");
                  }}
                  maxLength={60}
                  autoFocus
                />
              </Field>
              {/*
                The doctor, in the words that fit who is filling this in.

                The applicant said on Contact whether they are the doctor. Asking
                a doctor for "the primary doctor" makes them wonder whether they
                are being asked for somebody else; asking a manager for "your
                council registration" asks for a number they do not have.
              */}
              <Field
                label={primaryDoctor === false ? "The practice’s doctor" : "Your name as it should print"}
                hint={
                  primaryDoctor === false
                    ? "optional — so MedPin can tell you how to add them"
                    : "optional — if it differs from the name you gave"
                }
                error={shown("doctorName")}
              >
                <input
                  className={textInput}
                  value={doctorName}
                  onChange={(e) => {
                    setDoctorName(e.target.value);
                    clearServer("doctorName");
                  }}
                  placeholder={primaryDoctor === false ? "" : contactName}
                  maxLength={120}
                />
              </Field>
              <Field
                label={`${doctorLabel === "their" ? "Their" : "Your"} council registration`}
                hint="optional"
                error={shown("doctorRegistrationNo")}
              >
                <input
                  className={`${textInput} font-mono`}
                  value={doctorRegistrationNo}
                  onChange={(e) => {
                    setDoctorRegistrationNo(e.target.value);
                    clearServer("doctorRegistrationNo");
                  }}
                  maxLength={60}
                />
              </Field>

              {/*
                Only for a kind of practice that has departments.

                A solo clinic is one list of patients and one doctor; asking it
                which departments it runs is a question with no answer, and a
                field with no answer is one somebody stops to think about. The
                server decides which types those are, from the table that
                grants the capability — see the note on `asksDepartments`.
              */}
              {asksDepartments ? (
                optionsFailed ? (
                  <Field label="Departments" hint="unavailable just now">
                    <p className="text-muted-foreground border-input rounded-sm border px-3 py-2.5 text-caption">
                      We could not load the list. You can tell us below instead.
                    </p>
                  </Field>
                ) : catalogue.length === 0 ? (
                  <Field label="Departments" hint="optional">
                    <p className="text-muted-foreground border-input rounded-sm border px-3 py-2.5 text-caption">
                      MedPin has no departments listed yet. Name the ones you run
                      under Anything else.
                    </p>
                  </Field>
                ) : (
                  <>
                    <Field
                      label="Departments"
                      hint={`optional — what this practice runs, up to ${MAX_DEPARTMENTS}`}
                      error={shown("departments")}
                    >
                      <div className="border-input flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
                        {catalogue.map((d) => {
                          const checked = departments.includes(d.key);
                          return (
                            <label key={d.key} className="flex items-center gap-2.5 text-body">
                              <input
                                type="checkbox"
                                className="accent-primary size-4"
                                checked={checked}
                                // The server's cap, before the server has to say so.
                                disabled={!checked && departments.length >= MAX_DEPARTMENTS}
                                onChange={(e) => {
                                  clearServer("departments");
                                  setDepartments((cur) =>
                                    e.target.checked
                                      ? [...cur, d.key]
                                      : cur.filter((k) => k !== d.key),
                                  );
                                }}
                              />
                              {d.label}
                            </label>
                          );
                        })}
                      </div>
                    </Field>

                    {/*
                      And which of them the doctor runs — but only once there is
                      a choice to make. With one department the answer is the
                      department, and with none there is nothing to pick from.
                    */}
                    {departments.length > 1 ? (
                      <Field
                        label={primaryDoctor === false ? "Which does the doctor run?" : "Which do you run?"}
                        hint="optional"
                        error={shown("doctorDepartment")}
                      >
                        <Select
                          value={doctorDepartment}
                          onChange={setDoctorDepartment}
                          placeholder="Not saying"
                        >
                          {catalogue
                            .filter((d) => departments.includes(d.key))
                            .map((d) => (
                              <option key={d.key} value={d.key}>
                                {d.label}
                              </option>
                            ))}
                        </Select>
                      </Field>
                    ) : null}
                  </>
                )
              ) : null}
              <Field label="Anything else" hint="optional" error={shown("notes")}>
                <textarea
                  className={`${textInput} resize-y`}
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    clearServer("notes");
                  }}
                />
              </Field>
              <p className="text-muted-foreground text-micro leading-relaxed">
                No documents to upload. If MedPin needs papers, they will ask
                for them by name once somebody has read this.
              </p>
            </>
          ) : null}

          {step === "review" ? (
            <dl className="divide-border border-border divide-y rounded-md border">
              <Summary label="Practice" value={practiceName} />
              <Summary
                label="Type"
                value={
                  (types ?? []).find((t) => t.key === practiceType)?.label ?? "not said"
                }
              />
              <Summary label="Specialty" value={specialty || "not said"} />
              {/* Only where it was asked. A row reading "Departments — none"
                  on a clinic is an answer to a question nobody put. */}
              {asksDepartments ? (
                <Summary
                  label="Departments"
                  value={
                    departments.length
                      ? catalogue
                          .filter((d) => departments.includes(d.key))
                          .map((d) => d.label)
                          .join(", ")
                      : "none said"
                  }
                />
              ) : null}
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
              <Summary
                label="Approval makes you"
                value={primaryDoctor === false ? "the practice manager" : "the head doctor"}
              />
              <Summary label="Practice registration" value={registrationNo || "none given"} mono />
              <Summary
                label="Doctor"
                value={
                  primaryDoctor === false
                    ? doctorName || "not named"
                    : `${doctorName || contactName} (you)`
                }
              />
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
            onClick={back}
            disabled={busy}
            className="border-border hover:bg-secondary shrink-0 rounded-md border px-4 py-2 text-body font-medium transition-colors disabled:opacity-40"
          >
            Back
          </button>

          {step === "review" ? (
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

/** The reference an APPLICATION_OPEN refusal carries, if it carries one. */
function referenceIn(details: unknown): string | null {
  const reference = (details as { reference?: unknown } | null | undefined)?.reference;
  return typeof reference === "string" && reference ? reference : null;
}

/**
 * A validation refusal, as one message per field.
 *
 * The server names each field it refused by its path. `departments.3` is the
 * departments box, and `phoneToken` is the mobile number, because that is the
 * box where the applicant can do something about it.
 */
function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details as { path?: unknown; message?: unknown }[]) {
    const head = String(d?.path ?? "").split(".")[0];
    if (!head) continue;
    const key = head === "phoneToken" ? "phone" : head;
    if (!(key in out)) out[key] = String(d?.message || "This needs another look.");
  }
  return out;
}

/**
 * Where you are in the form, and what is behind you.
 *
 * ---- Three states, told apart without colour ----------------------------
 *
 * Done is a tick, current is a filled badge, ahead is an outline. A reader who
 * cannot separate the blues still has three different shapes, and the current
 * step is named in full above the fields as well — a row of numbers is a
 * position, not a label.
 *
 * The labels collapse to numbers below `sm`. Four words at 11px across a 360px
 * screen either wrap or shrink until nobody reads them, and what somebody
 * actually needs on a phone is "two of four".
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
 * A number the way the server will store it, or null where the server would refuse it.
 *
 * The same steps as backend/src/utils/phone.js, then the application route's
 * own check, in the same order — so what the screen says it will text is what
 * the server texts. It used to accept only a +91 number or ten bare digits: a
 * 0-prefixed number the server takes was refused here, and ten digits starting
 * with a 1 were shown as a +91 number the server would then reject.
 */
function toE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");
  let shaped = cleaned;
  if (cleaned.startsWith("+")) shaped = cleaned;
  else if (/^[6-9]\d{9}$/.test(cleaned)) shaped = `+91${cleaned}`;
  else if (/^91[6-9]\d{9}$/.test(cleaned)) shaped = `+${cleaned}`;
  else if (/^0[6-9]\d{9}$/.test(cleaned)) shaped = `+91${cleaned.slice(1)}`;
  return /^\+?[1-9]\d{7,14}$/.test(shaped) ? shaped : null;
}
