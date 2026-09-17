"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, Select, textInput } from "@/components/form";
import type { Practice, PracticeOptions, PracticeType } from "@/lib/types";

/**
 * The letterhead, and one field that is not on it.
 *
 * What prints at the top of every prescription this practice issues, so a typo
 * here is a typo on a legal document — the reason these are editable at all
 * rather than fixed at creation.
 *
 * ---- Two of them are fallbacks, and the dialog used to hide that ---------
 *
 * `prescriptionPdf.js` prefers the prescribing doctor's own name and council
 * number and reaches for the practice's only when the doctor has none:
 *
 *   doctor?.name || identity?.doctorName
 *   doctor?.registrationNo || identity?.registrationNo
 *
 * (There is no configured name beneath those any more: it was the founding
 * doctor's, printed for any practice that had not filled this in.)
 *
 * So an operator correcting a registration number on a practice whose doctor
 * has their own was editing a field that changes nothing on any prescription,
 * having been told it appears on all of them.
 *
 * ---- And one is not printed anywhere ------------------------------------
 *
 * `notes` is the operator's own note about a customer. The header said
 * "these appear on the practice's letterhead and on every prescription it
 * issues" over a field whose own hint said it is not shown to the practice —
 * two sentences on one screen saying opposite things about the same box.
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
  const [prefix, setPrefix] = useState(practice.prescriptionPrefix ?? "");
  const [practiceType, setPracticeType] = useState<PracticeType | "">(
    practice.practiceType ?? "",
  );
  const [specialty, setSpecialty] = useState(practice.specialty ?? "");
  const [options, setOptions] = useState<PracticeOptions | null>(null);
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
    setPrefix(practice.prescriptionPrefix ?? "");
    setPracticeType(practice.practiceType ?? "");
    setSpecialty(practice.specialty ?? "");
    setNote(notes);
    setError(null);
  }, [open, practice, notes]);

  // The same vocabulary the create form offers, from the same endpoint. A
  // second list typed out here would disagree with that one the first time
  // either changed.
  useEffect(() => {
    if (!open || options) return;
    api<PracticeOptions>("/admin/practice-options")
      .then(setOptions)
      .catch(() => {
        /* the rest of the form still saves */
      });
  }, [open, options]);

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
          // Blank is the neutral RX. The server refuses a prefix another
          // practice holds or has issued references under, and says whose.
          prescriptionPrefix: prefix.trim().toUpperCase() || null,
          notes: note.trim(),
          // Empty means "no answer", which the server stores as null — the
          // value the capability resolver reads as unclassified.
          practiceType: practiceType || null,
          specialty: specialty || null,
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
      description="What prints at the top of this practice's prescriptions — except the notes, which are yours."
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

      <Field label="Tagline" hint="optional — prints under the name">
        <input
          className={textInput}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={160}
        />
      </Field>

      <Field
        label="Doctor's printed name"
        hint="used only when the prescribing doctor has no name on file"
      >
        <input
          className={textInput}
          value={doctor}
          onChange={(e) => setDoctor(e.target.value)}
          maxLength={160}
        />
      </Field>

      {/*
        What kind of practice, and what it treats.

        Both were on the create form and on no edit path, so a practice created
        before either field existed could never acquire them and one created
        with the wrong answer could never lose it. The register drew both as
        pills that nothing on the platform could change.

        `practiceType` feeds the capability resolver and `specialty` is what
        the AI assistant tells patients their doctor practises, so neither is
        decoration.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Practice type" hint="what kind of organisation">
          <Select
            value={practiceType}
            onChange={(v) => setPracticeType(v as PracticeType | "")}
            placeholder="Not saying"
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
            placeholder="Not saying"
          >
            {options?.specialties.map((sp) => (
              <option key={sp.key} value={sp.key}>
                {sp.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Registration number"
        hint="what verification checks — a doctor's own council number wins on the page"
      >
        <input
          className={`${textInput} font-mono text-body`}
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          maxLength={60}
        />
      </Field>

      {/*
        The prefix on its prescription references.

        Every practice's references began AKD- — the founding doctor's
        initials. A practice with nothing here issues the neutral RX-, and
        references already issued keep the prefix they were printed with.
      */}
      <Field
        label="Prescription prefix"
        hint="optional — MHC numbers them MHC-2026-000057; blank is RX"
      >
        <input
          className={`${textInput} font-mono text-body uppercase`}
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8))}
          maxLength={8}
          placeholder="RX"
        />
      </Field>

      {/* Set apart, because it is the one box on this form that is not the
          letterhead. Everything above prints; this never does. */}
      <div className="border-border -mx-5 mt-1 border-t px-5 pt-4">
        <Field label="Notes" hint="yours — never printed, never shown to the practice">
          <textarea
            className={`${textInput} resize-y`}
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
