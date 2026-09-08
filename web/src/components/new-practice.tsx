"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, Select, textInput } from "@/components/form";
import { Alert, Info } from "@/components/primitives";
import type { DuplicateCheck, PracticeOptions, PracticeType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Bringing a practice into existence, with somebody in it.
 *
 * ---- Why this is a sequence and not a form ------------------------------
 *
 * It used to be three fields and a Create button, and what it made was a tenant
 * nobody could sign into: a Practice row with no member, and nothing else in
 * the system creates one. The operator would find out when the doctor rang to
 * ask why they could not log in.
 *
 * A practice needs a head, and the head's number has to be answered rather than
 * typed — so there is a step that waits for a text. That cannot be one form,
 * because the middle of it is somebody reading a code off a phone.
 *
 * ---- What the type decides ----------------------------------------------
 *
 * Everything after step one. A hospital's responsible person is a medical
 * superintendent and a diagnostic centre's is a pathologist, so step two's
 * label comes from step one's answer — and the capabilities the practice will
 * have follow from it too, which is why the review step says what it will and
 * will not be able to do rather than leaving that to be discovered.
 *
 * The list of types and specialties is fetched, not hardcoded. Specialties are
 * the shared Department rows and an operator can add one; a list baked in here
 * would be a rebuild every time somebody opens a practice in a specialty
 * nobody anticipated.
 */
type Step = 1 | 2 | 3;

export function NewPracticeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [options, setOptions] = useState<PracticeOptions | null>(null);

  // Step 1 — the practice
  const [name, setName] = useState("");
  const [practiceType, setPracticeType] = useState<PracticeType | "">("");
  const [specialty, setSpecialty] = useState("");
  const [reg, setReg] = useState("");
  const [dupes, setDupes] = useState<DuplicateCheck | null>(null);

  // Step 2 — the responsible person
  const [docName, setDocName] = useState("");
  const [phone, setPhone] = useState("");
  const [quals, setQuals] = useState("");
  const [docReg, setDocReg] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ simulated: boolean } | null>(null);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setPracticeType("");
    setSpecialty("");
    setReg("");
    setDupes(null);
    setDocName("");
    setPhone("");
    setQuals("");
    setDocReg("");
    setCode("");
    setSent(null);
    setPhoneToken(null);
    setError(null);

    // Once per opening. The shared departments change about as often as a new
    // specialty is invented, and re-fetching per keystroke would be a request
    // per letter of the practice's name.
    api<PracticeOptions>("/admin/practice-options")
      .then(setOptions)
      // A picker that failed to load is not a reason to block the wizard: type
      // and specialty are both optional, and the practice can be classified
      // afterwards from its own screen.
      .catch(() => setOptions({ types: [], specialties: [] }));
  }, [open]);

  const chosen = options?.types.find((t) => t.key === practiceType);
  const responsible = chosen?.responsibleLabel ?? "Head doctor";

  /** Anything already here under this name or this licence. */
  const check = useCallback(async () => {
    const q = new URLSearchParams();
    if (name.trim().length >= 2) q.set("name", name.trim());
    if (reg.trim()) q.set("registrationNo", reg.trim());
    if (!q.toString()) return setDupes(null);
    try {
      setDupes(await api<DuplicateCheck>(`/admin/practices/check?${q}`));
    } catch {
      // A check that could not run must not stop a practice being created. The
      // registration clash is refused by the server at create time either way.
      setDupes(null);
    }
  }, [name, reg]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ simulated: boolean }>("/admin/phone/otp", {
        method: "POST",
        body: { phone: phone.trim() },
      });
      setSent({ simulated: out.simulated });
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  /** Answer it, and hold the token that proves the handset replied. */
  async function confirmCode() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ phoneToken: string }>("/admin/phone/verify", {
        method: "POST",
        body: { phone: phone.trim(), code: code.trim() },
      });
      setPhoneToken(out.phoneToken);
      setStep(3);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api("/admin/practices", {
        method: "POST",
        body: {
          name: name.trim(),
          practiceType: practiceType || undefined,
          specialty: specialty || undefined,
          registrationNo: reg.trim() || undefined,
          headDoctorName: docName.trim(),
          headDoctorPhone: phone.trim(),
          headDoctorPhoneToken: phoneToken,
          headDoctorQualifications: quals.trim() || undefined,
          headDoctorRegistrationNo: docReg.trim() || undefined,
        },
      });
      onCreated();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (step === 1) {
      if (name.trim().length < 2) return setError("A practice needs a name.");
      if (dupes?.registrationClash) {
        return setError(
          `That registration number already belongs to ${dupes.registrationClash.name}.`,
        );
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (docName.trim().length < 2) return setError(`The ${responsible.toLowerCase()} needs a name.`);
      if (phone.trim().length < 8) return setError("Enter their phone number.");

      // Already answered. Coming back here from the review step used to land on
      // the code field holding a code the server had consumed, so Verify failed
      // on a number that was verified.
      if (phoneToken) {
        setStep(3);
        return;
      }

      if (!sent) return void sendCode();
      if (!/^\d{4,8}$/.test(code.trim())) return setError("Enter the code that was texted.");
      return void confirmCode();
    }
    void create();
  }

  const confirmLabel =
    step === 1
      ? "Next"
      : step === 2
        ? busy
          ? "Please wait…"
          : phoneToken
            ? "Next"
            : sent
              ? "Verify"
              : "Text a code"
        : busy
          ? "Creating…"
          : "Create practice";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a practice"
      description={
        step === 1
          ? `Name it and say what kind it is. You will add its ${responsible.toLowerCase()} next.`
          : step === 2
            ? "They will own the practice and sign in with this number."
            : "Confirm the details below. Everything except the phone number can be changed later."
      }
      onSubmit={submit}
      confirmLabel={confirmLabel}
      cancelLabel={step === 1 ? "Cancel" : "Back"}
      busy={busy}
      error={error}
      onCancel={step === 1 ? undefined : () => setStep((s) => (s === 3 ? 2 : 1) as Step)}
    >
      <Steps current={step} />

      {step === 1 ? (
        <>
          <Field label="Practice name">
            <input
              className={textInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void check()}
              maxLength={160}
              autoFocus
            />
          </Field>

          <Field label="Practice type" hint="what kind of organisation">
            <Select
              value={practiceType}
              onChange={(v) => setPracticeType(v as PracticeType | "")}
              placeholder="Not saying yet"
            >
              {options?.types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Primary specialty" hint="what it mainly treats">
            <Select
              value={specialty}
              onChange={setSpecialty}
              placeholder="Not saying yet"
            >
              {options?.specialties.map((sp) => (
                <option key={sp.key} value={sp.key}>
                  {sp.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Registration number"
            hint="optional — the doctor's own is used if this is blank"
          >
            <input
              className={`${textInput} font-mono text-[13px]`}
              value={reg}
              onChange={(e) => setReg(e.target.value)}
              onBlur={() => void check()}
              maxLength={60}
            />
          </Field>

          {/* Two strengths of answer. A licence already in use is refused; a
              name somebody else also chose is worth a look and nothing more —
              "City Clinic" is a real name in every city in the country. */}
          {dupes?.registrationClash ? (
            <Alert tone="stopped" title="That registration number is already in use">
              It belongs to {dupes.registrationClash.name}.
            </Alert>
          ) : null}

          {dupes?.sameName.length ? (
            <Alert title={`A practice is already called “${name.trim()}”`}>
              {dupes.sameName.length === 1
                ? "Check this is not the same one before continuing."
                : `${dupes.sameName.length} of them. Check this is not one of them.`}
            </Alert>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Field label={`${responsible}'s name`}>
            <input
              className={textInput}
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              maxLength={120}
              disabled={Boolean(sent)}
              autoFocus
            />
          </Field>

          <Field label="Phone number" hint="they sign in with this">
            <input
              className={`${textInput} font-mono text-[13px]`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              disabled={Boolean(sent)}
            />
          </Field>

          {sent && !phoneToken ? (
            <>
              <Field label="Code from the text">
                <input
                  ref={codeRef}
                  className={cn(
                    textInput,
                    "tnum h-12 max-w-[11rem] text-center font-mono text-2xl tracking-[0.3em]",
                  )}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="000000"
                />
              </Field>
              {sent.simulated ? (
                <Alert title="Nothing was sent">
                  No SMS credentials on this server — the code is in the server log.
                </Alert>
              ) : (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Sent to <span className="font-mono">{phone.trim()}</span>. Ask them
                  to read it out.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setSent(null);
                  setCode("");
                }}
                className="text-primary self-start text-xs underline underline-offset-4"
              >
                Wrong number — change it
              </button>
            </>
          ) : (
            <>
              {phoneToken ? (
                <p className="text-ok-ink bg-ok-tint border-l-ok rounded-sm border-l-2 px-3 py-2 text-xs">
                  <span className="font-mono">{phone.trim()}</span> confirmed.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSent(null);
                      setCode("");
                      setPhoneToken(null);
                    }}
                    className="underline underline-offset-4"
                  >
                    Use a different number
                  </button>
                </p>
              ) : null}
              <Field label="Qualifications" hint="optional — prints on prescriptions">
                <input
                  className={textInput}
                  value={quals}
                  onChange={(e) => setQuals(e.target.value)}
                  maxLength={120}
                  placeholder="MBBS, MD"
                />
              </Field>
              <Field
                label="Their registration number"
                hint="optional — what verification checks"
              >
                <input
                  className={`${textInput} font-mono text-[13px]`}
                  value={docReg}
                  onChange={(e) => setDocReg(e.target.value)}
                  maxLength={60}
                />
              </Field>
              {!phoneToken ? (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Continuing sends a verification code to this number.
                </p>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {step === 3 ? (
        <dl className="border-border divide-border divide-y rounded-md border text-[13px]">
          <Row label="Practice">{name.trim()}</Row>
          <Row label="Type">
            {chosen?.label ?? <span className="text-muted-foreground">not set</span>}
          </Row>
          <Row label="Specialty">
            {options?.specialties.find((sp) => sp.key === specialty)?.label ?? (
              <span className="text-muted-foreground">not set</span>
            )}
          </Row>
          <Row label="Registration">
            {reg.trim() || docReg.trim() || (
              <span className="text-muted-foreground">none</span>
            )}
          </Row>
          <Row label={responsible}>{docName.trim()}</Row>
          <Row label="Phone" mono>
            {phone.trim()} <span className="text-ok text-[11px]">confirmed</span>
          </Row>
          {quals.trim() ? <Row label="Qualifications">{quals.trim()}</Row> : null}
          <Row label="Plan">
            <span className="text-muted-foreground">trial</span>
          </Row>

          {/* Two facts, each with its definition behind it rather than in a
              paragraph underneath. "Why does it say unverified" was a real
              question, and the answer belongs on the word that raised it. */}
          <div className="flex flex-col gap-2 px-3 py-2">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
                Starts as
              </dt>
              <dd className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                <Info term={<span className="text-waiting-ink">onboarding</span>}>
                  Staff cannot sign in until you activate it, on the practice&apos;s
                  own screen.
                </Info>
                <Info term={<span className="text-muted-foreground">unverified</span>}>
                  Nobody has checked the registration number against the medical
                  council register yet. Creating a practice is not that check.
                </Info>
              </dd>
            </div>
          </div>
        </dl>
      ) : null}

      {step === 3 && !reg.trim() && !docReg.trim() ? (
        <Alert
          title="No registration number"
          action={
            <button
              type="button"
              onClick={() => setStep(2)}
              className="border-border bg-card hover:bg-secondary rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
            >
              Add one
            </button>
          }
        >
          Needed to verify this practice, and printed on its prescriptions.
        </Alert>
      ) : null}

      {step === 3 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          The {responsible.toLowerCase()} becomes the owner and adds their own staff
          and locations.
        </p>
      ) : null}
    </Modal>
  );
}

function Steps({ current }: { current: Step }) {
  const labels = ["Practice", "Responsible", "Review"];
  return (
    <ol className="flex items-center gap-1.5 text-[11px]">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const on = n === current;
        return (
          <li key={l} className="flex items-center gap-1.5">
            <span
              className={cn(
                "tnum flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                on
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-ok-tint text-ok-ink"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? "✓" : n}
            </span>
            <span className={on ? "font-medium" : "text-muted-foreground"}>{l}</span>
            {i < labels.length - 1 ? (
              <span aria-hidden className="bg-border mx-1 h-px w-4" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {label}
      </dt>
      <dd className={cn("min-w-0 text-right", mono && "font-mono text-[13px]")}>
        {children}
      </dd>
    </div>
  );
}
