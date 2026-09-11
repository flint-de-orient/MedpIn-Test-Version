"use client";

import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { APPLICATION_LABELS, type ApplicationStatus } from "@/lib/types";
import { textInput } from "@/components/form";
import { fullWhen } from "@/components/primitives";
import { cn } from "@/lib/utils";

/**
 * Where an application has got to, for the person who filed it.
 *
 * ---- No account, and that shapes everything ------------------------------
 *
 * An applicant is not a user of this platform. There is nothing to sign into,
 * so the reference they were given is the only thing that identifies their
 * application — which is why it is long and random, and why this screen asks
 * for it rather than listing anything.
 *
 * What comes back is their own submission and the last thing an operator said.
 * Not who said it, not when it was opened, not which operator holds it: the
 * trail is the platform's, and what the applicant needs is the question or the
 * reason, not the name of somebody to chase.
 */
export function ApplicationStatusView({
  initialReference,
  onBack,
}: {
  /** Set when they have just submitted — the one case where they have not had to type it. */
  initialReference: string | null;
  onBack: () => void;
}) {
  const [reference, setReference] = useState(initialReference ?? "");
  const [found, setFound] = useState<Applicant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(async (ref: string) => {
    if (!ref.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ application: Applicant }>(
        `/applications/${encodeURIComponent(ref.trim())}`,
        { anonymous: true },
      );
      setFound(out.application);
    } catch (ex) {
      setFound(null);
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Straight to it when they have just submitted. Making somebody re-type a
  // reference they were handed four seconds ago is a form for its own sake.
  useEffect(() => {
    if (initialReference) void look(initialReference);
  }, [initialReference, look]);

  return (
    <div className="flex flex-col gap-4">
      {initialReference ? (
        <div className="border-l-ok bg-ok-tint text-ok-ink rounded-sm border-l-2 px-3 py-2.5">
          <p className="text-title font-semibold">Registration submitted</p>
          <p className="mt-0.5 text-caption leading-relaxed">
            It is with the MedPin team. Keep the reference below — it is the only
            way to check on it.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void look(reference);
        }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="application-reference"
          className="text-muted-foreground text-micro font-medium tracking-[0.04em] uppercase"
        >
          Application reference
        </label>
        <div className="flex gap-2">
          <input
            id="application-reference"
            className={`${textInput} font-mono`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={64}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={busy || !reference.trim()}
            className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-body font-medium whitespace-nowrap transition-opacity disabled:opacity-55"
          >
            {busy ? "Checking…" : "Check"}
          </button>
        </div>
      </form>

      {error ? (
        <p
          role="alert"
          className="text-stopped-ink border-l-stopped bg-stopped-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed"
        >
          {error}
        </p>
      ) : null}

      {found ? <Found application={found} /> : null}

      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground w-fit text-caption underline underline-offset-4"
      >
        Back
      </button>
    </div>
  );
}

type Applicant = {
  reference: string;
  status: ApplicationStatus;
  practiceName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  submittedOn: string;
  latestNote: string | null;
  decidedOn: string | null;
};

/**
 * What each state means, in the words the applicant needs.
 *
 * Not a status word on its own. "More information required" tells somebody
 * that something is wanted and not that they are the one who has to do
 * anything about it — so each of these says what happens next.
 */
const MEANS: Record<ApplicationStatus, string> = {
  submitted:
    "Your registration has been received and is waiting for somebody at MedPin to review it.",
  under_review: "Somebody at MedPin is reading it now.",
  more_info:
    "MedPin needs something more before this can be decided. What is needed is below — reply to the email you registered with.",
  approved:
    "Your practice has been created. Sign in on the MedPin app with the mobile number you verified.",
  rejected: "This registration was not approved. The reason is below.",
};

function Found({ application: a }: { application: Applicant }) {
  const tone =
    a.status === "approved"
      ? "ok"
      : a.status === "rejected"
        ? "stopped"
        : a.status === "more_info"
          ? "waiting"
          : "muted";

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-4">
      <div>
        <p className="text-title font-semibold">{a.practiceName}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-micro">
          {a.reference} · submitted {fullWhen(a.submittedOn)}
        </p>
      </div>

      {/*
        The word and the sentence together. Never colour alone: half these
        states are amber-ish and the one that matters most is the one somebody
        has to act on.
      */}
      <div
        className={cn(
          "rounded-sm border-l-2 px-3 py-2.5",
          tone === "ok"
            ? "border-l-ok bg-ok-tint text-ok-ink"
            : tone === "stopped"
              ? "border-l-stopped bg-stopped-tint text-stopped-ink"
              : tone === "waiting"
                ? "border-l-waiting bg-waiting-tint text-waiting-ink"
                : "border-l-border bg-secondary/40",
        )}
      >
        <p className="text-title font-semibold">{APPLICATION_LABELS[a.status]}</p>
        <p className="mt-0.5 text-caption leading-relaxed">{MEANS[a.status]}</p>
      </div>

      {a.latestNote ? (
        <div>
          <p className="text-muted-foreground text-micro font-medium tracking-[0.04em] uppercase">
            From MedPin
          </p>
          <p className="mt-1 text-body leading-relaxed">{a.latestNote}</p>
        </div>
      ) : null}

      <dl className="text-muted-foreground border-border flex flex-col gap-1 border-t pt-3 text-caption">
        <div className="flex justify-between gap-4">
          <dt>Contact</dt>
          <dd className="text-foreground">{a.contactName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Email</dt>
          <dd className="text-foreground font-mono">{a.contactEmail}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Mobile</dt>
          <dd className="text-foreground font-mono">{a.contactPhone}</dd>
        </div>
        {a.decidedOn ? (
          <div className="flex justify-between gap-4">
            <dt>Decided</dt>
            <dd className="text-foreground">{fullWhen(a.decidedOn)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
