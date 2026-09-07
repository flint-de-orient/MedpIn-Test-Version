"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, textInput } from "@/components/form";
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
 * ---- Three steps, and the last one is a review --------------------------
 *
 * Making a practice is not reversible from here; there is no delete. So the
 * last screen shows what is about to be created rather than trusting that
 * whoever filled in step one still remembers it.
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

  // Step 1 — the practice
  const [name, setName] = useState("");
  const [reg, setReg] = useState("");

  // Step 2 — the head doctor
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
    setReg("");
    setDocName("");
    setPhone("");
    setQuals("");
    setDocReg("");
    setCode("");
    setSent(null);
    setPhoneToken(null);
    setError(null);
  }, [open]);

  /** Text a code to the number on screen. */
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
      setStep(2);
      return;
    }
    if (step === 2) {
      if (docName.trim().length < 2) return setError("The doctor needs a name.");
      if (phone.trim().length < 8) return setError("Enter the doctor's phone number.");
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
          ? "It arrives onboarding and unverified. Creating a practice is not vouching for it."
          : step === 2
            ? "A practice needs somebody who can run it, and their number has to be answered rather than typed."
            : "Check this before it exists. There is no delete."
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
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field
            label="Registration number"
            hint="optional — the doctor's own is used if this is blank"
          >
            <input
              className={`${textInput} font-mono text-[13px]`}
              value={reg}
              onChange={(e) => setReg(e.target.value)}
              maxLength={60}
            />
          </Field>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Field label="Head doctor's name">
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

          {!sent ? (
            <>
              <Field label="Qualifications" hint="optional — prints on prescriptions">
                <input
                  className={textInput}
                  value={quals}
                  onChange={(e) => setQuals(e.target.value)}
                  maxLength={120}
                  placeholder="MBBS, MD"
                />
              </Field>
              <Field label="Their registration number" hint="optional — what verification checks">
                <input
                  className={`${textInput} font-mono text-[13px]`}
                  value={docReg}
                  onChange={(e) => setDocReg(e.target.value)}
                  maxLength={60}
                />
              </Field>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Continuing texts a code to that number. It has to be answered — a
                mistyped digit would hand this practice, and every patient in it, to
                whoever owns the number typed instead.
              </p>
            </>
          ) : (
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
                <p className="text-waiting border-waiting/30 bg-waiting-tint rounded-sm border px-3 py-2 text-xs leading-relaxed">
                  No SMS credentials on this server, so nothing was sent. The code is
                  in the server log.
                </p>
              ) : (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Sent to <span className="font-mono">{phone.trim()}</span>. Ask the
                  doctor to read it out.
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
          )}
        </>
      ) : null}

      {step === 3 ? (
        <dl className="border-border divide-border divide-y rounded-md border text-[13px]">
          <Row label="Practice">{name.trim()}</Row>
          <Row label="Registration">
            {reg.trim() || docReg.trim() || <span className="text-muted-foreground">none</span>}
          </Row>
          <Row label="Head doctor">{docName.trim()}</Row>
          <Row label="Phone" mono>
            {phone.trim()}{" "}
            <span className="text-ok text-[11px]">confirmed</span>
          </Row>
          {quals.trim() ? <Row label="Qualifications">{quals.trim()}</Row> : null}
          <Row label="Starts as">
            <span className="text-muted-foreground">onboarding · unverified</span>
          </Row>
        </dl>
      ) : null}

      {step === 3 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          The doctor becomes the practice&apos;s owner and can sign in with that
          number straight away. They add their own staff, doctors and locations —
          this console does not, because the person hiring knows who they are
          hiring.
        </p>
      ) : null}
    </Modal>
  );
}

function Steps({ current }: { current: Step }) {
  const labels = ["Practice", "Head doctor", "Review"];
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
                    ? "bg-ok-tint text-ok"
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
