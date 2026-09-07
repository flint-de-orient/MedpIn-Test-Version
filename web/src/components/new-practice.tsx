"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field as FormField, textInput } from "@/components/form";

/**
 * Bring a practice into existence.
 *
 * Only the name is required. A registration number is what gets verified later
 * and is often not to hand when the clinic is first entered; demanding it here
 * would mean the operator inventing one or not creating the row at all.
 */
export function NewPracticeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [doctor, setDoctor] = useState("");
  const [reg, setReg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDoctor("");
    setReg("");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("A practice needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/admin/practices", {
        method: "POST",
        body: {
          name: name.trim(),
          doctorDisplayName: doctor.trim() || undefined,
          registrationNo: reg.trim() || undefined,
        },
      });
      onCreated();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a practice"
      description="It arrives onboarding and unverified. Creating a practice is not vouching for it."
      onSubmit={submit}
      confirmLabel={busy ? "Creating…" : "Create"}
      busy={busy}
      error={error}
    >
      <FormField label="Practice name">
        <input
          className={textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
          autoFocus
        />
      </FormField>

      <FormField label="Doctor's printed name" hint="optional — appears on prescriptions">
        <input
          className={textInput}
          value={doctor}
          onChange={(e) => setDoctor(e.target.value)}
          maxLength={160}
        />
      </FormField>

      <FormField label="Registration number" hint="optional — what gets verified later">
        <input
          className={`${textInput} font-mono text-[13px]`}
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          maxLength={60}
        />
      </FormField>
    </Modal>
  );
}
