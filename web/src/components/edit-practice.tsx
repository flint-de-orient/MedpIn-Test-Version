"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, textInput } from "@/components/form";
import type { Practice } from "@/lib/types";

/**
 * The letterhead.
 *
 * These four fields are printed on every prescription this practice issues, so
 * a typo here is a typo on a legal document — which is the reason they are
 * editable at all rather than fixed at creation.
 */
export function EditPracticeDialog({
  open,
  practice,
  notes,
  onClose,
  onSaved,
}: {
  open: boolean;
  practice: Practice;
  notes: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(practice.name);
  const [tagline, setTagline] = useState(practice.tagline ?? "");
  const [doctor, setDoctor] = useState(practice.doctorDisplayName ?? "");
  const [reg, setReg] = useState(practice.registrationNo ?? "");
  const [note, setNote] = useState(notes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reopening reloads from the record rather than showing whatever was typed
  // and abandoned last time.
  useEffect(() => {
    if (!open) return;
    setName(practice.name);
    setTagline(practice.tagline ?? "");
    setDoctor(practice.doctorDisplayName ?? "");
    setReg(practice.registrationNo ?? "");
    setNote(notes);
    setError(null);
  }, [open, practice, notes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("A practice needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/practices/${practice.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          tagline: tagline.trim(),
          doctorDisplayName: doctor.trim(),
          registrationNo: reg.trim(),
          notes: note.trim(),
        },
      });
      onSaved();
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
      title="Edit details"
      description="These appear on the practice's letterhead and on every prescription it issues."
      onSubmit={submit}
      confirmLabel={busy ? "Saving…" : "Save"}
      busy={busy}
      error={error}
    >
      <Field label="Practice name">
        <input
          className={textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
        />
      </Field>

      <Field label="Tagline" hint="optional">
        <input
          className={textInput}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={160}
        />
      </Field>

      <Field label="Doctor's printed name" hint="optional">
        <input
          className={textInput}
          value={doctor}
          onChange={(e) => setDoctor(e.target.value)}
          maxLength={160}
        />
      </Field>

      <Field label="Registration number" hint="what verification checks">
        <input
          className={`${textInput} font-mono text-[13px]`}
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          maxLength={60}
        />
      </Field>

      <Field
        label="Notes"
        hint="for you — not shown to the practice"
      >
        <textarea
          className={`${textInput} resize-y`}
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
