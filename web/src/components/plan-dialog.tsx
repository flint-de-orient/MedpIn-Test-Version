"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, textInput } from "@/components/form";
import { PLAN_LABELS, type Plan, type Practice } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The commercial arrangement.
 *
 * ---- Empty means unlimited, and the field says so ----------------------
 *
 * A blank cap is not zero. Zero would mean a practice that may not register
 * anybody, which is a thing somebody might genuinely want and must therefore be
 * distinguishable from "no cap at all". So the input is text, empty is null,
 * and the placeholder reads "no cap" rather than "0".
 *
 * The founding clinic in particular must stay uncapped: it predates the idea of
 * plans and has never agreed to one.
 */
export function PlanDialog({
  open,
  practice,
  usage,
  onClose,
  onSaved,
}: {
  open: boolean;
  practice: Practice;
  usage: { patients: number; staff: number; locations: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(practice.plan);
  const [patients, setPatients] = useState("");
  const [staff, setStaff] = useState("");
  const [locations, setLocations] = useState("");
  const [renews, setRenews] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlan(practice.plan);
    setPatients(practice.limits.patients?.toString() ?? "");
    setStaff(practice.limits.staff?.toString() ?? "");
    setLocations(practice.limits.locations?.toString() ?? "");
    setRenews(practice.planRenewsOn ? practice.planRenewsOn.slice(0, 10) : "");
    setError(null);
  }, [open, practice]);

  const toLimit = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const limits = {
      patients: toLimit(patients),
      staff: toLimit(staff),
      locations: toLimit(locations),
    };
    if (Object.values(limits).some((v) => Number.isNaN(v))) {
      setError("A cap is a whole number, or empty for no cap.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api(`/admin/practices/${practice.id}/plan`, {
        method: "PATCH",
        body: {
          plan,
          limits,
          planRenewsOn: renews.trim() === "" ? null : renews,
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
      title="Plan and limits"
      description="The plan is a name. The caps are what the software actually enforces, so they are set per practice rather than derived from the name."
      onSubmit={submit}
      confirmLabel={busy ? "Saving…" : "Save"}
      busy={busy}
      error={error}
    >
      <Field label="Plan">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PLAN_LABELS) as Plan[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPlan(k)}
              className={cn(
                "rounded-sm border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                plan === k
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {PLAN_LABELS[k]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Cap
          label="Patients"
          value={patients}
          onChange={setPatients}
          current={usage.patients}
        />
        <Cap label="Staff" value={staff} onChange={setStaff} current={usage.staff} />
        <Cap
          label="Locations"
          value={locations}
          onChange={setLocations}
          current={usage.locations}
        />
      </div>

      <Field label="Renews on" hint="empty for open-ended">
        <input
          type="date"
          className={`${textInput} font-mono text-[13px]`}
          value={renews}
          onChange={(e) => setRenews(e.target.value)}
        />
      </Field>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Only the patient cap is enforced today, at the one place a practice gains
        a patient. A lapsed date suspends nobody — a clinic locked out of its
        records by a billing date is a patient safety problem, so that stays a
        decision a person makes.
      </p>
    </Modal>
  );
}

function Cap({
  label,
  value,
  onChange,
  current,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  current: number;
}) {
  const n = value.trim() === "" ? null : Number(value);
  const over = n !== null && Number.isFinite(n) && current > n;

  return (
    <Field label={label}>
      <input
        className={cn(textInput, "tnum font-mono text-[13px]", over && "border-waiting")}
        inputMode="numeric"
        placeholder="no cap"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      />
      <span
        className={cn(
          "text-[11px]",
          over ? "text-waiting" : "text-muted-foreground",
        )}
      >
        {over ? `already at ${current}` : `now ${current}`}
      </span>
    </Field>
  );
}
