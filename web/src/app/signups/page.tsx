"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import {
  APPLICATION_LABELS,
  type ApplicationDetail,
  type ApplicationRow,
  type ApplicationStatus,
  PLAN_LABELS,
} from "@/lib/types";
import {
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  when,
  fullWhen,
} from "@/components/primitives";
import { Modal, Field, textInput } from "@/components/form";
import { cn } from "@/lib/utils";

/**
 * Practices asking to exist.
 *
 * ---- What approving does, and why the copy keeps saying so --------------
 *
 * Nothing on this screen is reversible in the way the rest of the console is.
 * Approving creates a tenant: a practice row, a head doctor attached to it,
 * and a clinic that can from that moment sign in and see patients. There is no
 * delete anywhere in this product.
 *
 * So every action here asks for a reason, the destructive two go through the
 * confirmation dialog the rest of the console uses, and the panel says what the
 * applicant will read — because on the two that send a note back, the note is
 * the only thing they get.
 */
export default function Page() {
  // `useSearchParams` suspends, and a static export has no server to fall back
  // on — without this the whole route fails to prerender.
  return (
    <Suspense fallback={<Loading rows={5} />}>
      <Signups />
    </Suspense>
  );
}

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "submitted", label: "Pending review" },
  { key: "under_review", label: "Under review" },
  { key: "more_info", label: "More info" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];

function Signups() {
  const params = useSearchParams();
  const id = params.get("id");
  return id ? <Detail id={id} /> : <Queue />;
}

/* ------------------------------------------------------------------- queue */

function Queue() {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("open");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const qs =
        filter === "open" ? "?open=true" : filter ? `?status=${filter}` : "";
      const out = await api<{ items: ApplicationRow[]; counts: Record<string, number> }>(
        `/admin/applications${qs}`,
      );
      setRows(out.items);
      setCounts(out.counts ?? {});
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight">Self signup</h1>
        <p className="text-muted-foreground mt-1 text-caption">
          Practices that have applied through the public form. Approving one
          creates it.
        </p>
      </div>

      <Panel
        title="Applications"
        count={rows?.length}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const n = counts[f.key === "" ? "all" : f.key];
              // A filter for a state nothing is in is a button that can only
              // produce an empty table. "Open" and "All" always show.
              if (f.key && f.key !== "open" && !n) return null;

              return (
                <button
                  key={f.key || "all"}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors",
                    filter === f.key
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {f.label}
                  {n === undefined ? null : (
                    <span className="tnum ml-1.5 font-normal">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        }
      >
        {error ? (
          <Failed message={error} retry={() => void load()} />
        ) : !rows ? (
          <Loading rows={4} />
        ) : rows.length === 0 ? (
          <Empty
            title={
              filter === "open"
                ? "Nothing waiting"
                : "No applications in that state"
            }
            hint={
              filter === "open"
                ? "Applications appear here as soon as a practice submits one."
                : "Try another filter, or All."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-micro tracking-[0.04em] uppercase">
                  <th className="px-4 py-2 font-medium">Practice</th>
                  <th className="px-4 py-2 font-medium">Primary contact</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Submitted</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Reviewer</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link href={`/signups/?id=${r.id}`} className="block">
                        <span className="block font-medium">{r.practiceName}</span>
                        <span className="text-muted-foreground font-mono text-micro">
                          {r.reference}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block">{r.contactName}</span>
                      <span className="text-muted-foreground font-mono text-micro">
                        {r.contactPhone}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-caption">
                      {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td
                      className="tnum text-muted-foreground px-4 py-2.5 text-caption whitespace-nowrap"
                      title={fullWhen(r.submittedOn)}
                    >
                      {when(r.submittedOn)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 font-mono text-micro">
                      {r.reviewer ?? "—"}
                    </td>
                    <td className="px-2">
                      <Link
                        href={`/signups/?id=${r.id}`}
                        aria-label={`Open ${r.practiceName}`}
                        className="text-primary text-caption underline underline-offset-4"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * The status, with its word.
 *
 * Never colour alone: half of these are amber-ish and a reader who cannot
 * separate them has the sentence instead.
 */
function StatusPill({ status }: { status: ApplicationStatus }) {
  const tone =
    status === "approved"
      ? "ok"
      : status === "rejected"
        ? "stopped"
        : status === "more_info"
          ? "waiting"
          : "muted";
  return <Pill tone={tone}>{APPLICATION_LABELS[status]}</Pill>;
}

/* ------------------------------------------------------------------ detail */

type Ask = "approve" | "request-info" | "reject" | null;

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const [a, setA] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const out = await api<{ application: ApplicationDetail }>(
        `/admin/applications/${id}`,
      );
      setA(out.application);
    } catch (ex) {
      setError((ex as ApiError).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Failed message={error} retry={() => void load()} />;
  if (!a) return <Loading rows={6} />;

  const open = !["approved", "rejected"].includes(a.status);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/signups/"
          className="text-muted-foreground hover:text-foreground text-caption transition-colors"
        >
          ← Self signup
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display font-semibold tracking-tight">
                {a.practiceName}
              </h1>
              <StatusPill status={a.status} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-caption">
              {a.reference} · applied{" "}
              <span title={fullWhen(a.submittedOn)}>{when(a.submittedOn)}</span>
            </p>
          </div>

          {/*
            What this became. The only link between an application and a
            tenant, and the thing an operator wants immediately after
            approving one.
          */}
          {a.practice ? (
            <Link
              href={`/practices/?id=${a.practice}`}
              className="border-border hover:bg-secondary shrink-0 rounded-sm border px-3 py-1.5 text-body font-medium transition-colors"
            >
              Open the practice
            </Link>
          ) : null}
        </div>
      </div>

      {open ? (
        <Panel title="Decide">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <button
              onClick={() => setAsk("approve")}
              className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 text-body font-medium"
            >
              Approve and create
            </button>
            <button
              onClick={() => setAsk("request-info")}
              className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-body font-medium transition-colors"
            >
              Ask for more
            </button>
            <button
              onClick={() => setAsk("reject")}
              className="border-stopped/40 text-stopped-ink hover:bg-stopped-tint rounded-sm border px-3 py-1.5 text-body font-medium transition-colors"
            >
              Reject
            </button>
          </div>
          <p className="text-muted-foreground border-border border-t px-4 py-3 text-micro leading-relaxed">
            Approving creates the practice and attaches {a.doctorName ?? a.contactName}{" "}
            as its head doctor, on the number they verified. Nothing here can be
            undone — there is no delete on a practice.
          </p>
        </Panel>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Practice" description="What they say they are.">
            <dl className="divide-border divide-y">
              <Row label="Name" value={a.practiceName} />
              <Row
                label="Type"
                value={a.practiceType?.replace(/_/g, " ") ?? "not said"}
              />
              <Row label="Specialty" value={a.specialty ?? "not said"} />
              <Row
                label="Address"
                value={
                  [a.addressLine, a.city, a.state, a.postalCode]
                    .filter(Boolean)
                    .join(", ") || "not given"
                }
              />
            </dl>
          </Panel>

          <Panel
            title="Verification"
            description="What a reviewer checks against a register."
          >
            <dl className="divide-border divide-y">
              <Row label="Practice registration" value={a.registrationNo ?? "none given"} mono />
              <Row label="Primary doctor" value={a.doctorName ?? "not named"} />
              <Row
                label="Doctor registration"
                value={a.doctorRegistrationNo ?? "none given"}
                mono
              />
              {a.notes ? <Row label="Their note" value={a.notes} /> : null}
            </dl>
            {/*
              Said out loud, because its absence is the thing somebody would
              otherwise go looking for.
            */}
            <p className="text-muted-foreground border-border border-t px-4 py-3 text-micro leading-relaxed">
              No documents. The public form takes no uploads — this platform has
              no scanning or retention story for files from people without
              accounts — so papers are asked for in a note and arrive the way
              they do today.
            </p>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Primary contact" description="Who would run it.">
            <dl className="divide-border divide-y">
              <Row label="Name" value={a.contactName} />
              {/*
                Whether the decision this review produces will actually arrive.
                An unconfirmed address is not a reason to refuse an application
                — it is a reason to ring the number instead of writing into the
                dark.
              */}
              <Row
                label="Email"
                value={
                  a.contactEmailVerified
                    ? a.contactEmail
                    : `${a.contactEmail} — not confirmed`
                }
                mono
              />
              <Row label="Phone" value={a.contactPhone} mono />
              <Row
                label="Number proved"
                value={fullWhen(a.phoneVerifiedAt)}
                hint="They answered a code on this number before the form was accepted."
              />
            </dl>
          </Panel>

          <Panel title="History" description="Every step, in order.">
            {a.history.length === 0 ? (
              <Empty title="Nothing yet" hint="Actions appear here as they are taken." />
            ) : (
              <ul className="divide-border divide-y">
                {a.history.map((h, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-body font-medium capitalize">
                        {h.action.replace(/_/g, " ")}
                      </span>
                      <span
                        className="tnum text-muted-foreground text-caption"
                        title={fullWhen(h.at)}
                      >
                        {when(h.at)}
                      </span>
                    </div>
                    {h.by ? (
                      <p className="text-muted-foreground mt-0.5 font-mono text-micro">
                        {h.by}
                      </p>
                    ) : null}
                    {h.note ? (
                      <p className="mt-1 text-caption leading-relaxed">{h.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <DecisionDialog
        ask={ask}
        application={a}
        onClose={() => setAsk(null)}
        onDone={(next) => {
          setAsk(null);
          setA(next);
          if (next.status === "approved") {
            toast.success(`${next.practiceName} created`);
            router.refresh();
          }
        }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="text-muted-foreground text-caption">{label}</dt>
      <dd className={cn("min-w-0 text-right text-body", mono && "font-mono")}>
        {value}
        {hint ? (
          <span className="text-muted-foreground mt-0.5 block text-micro leading-relaxed">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The three decisions, each of which needs a reason.
 *
 * Approve included. "Approved" with nothing beside it is a decision nobody can
 * review six months later — and on the other two, the note is the only thing
 * the applicant ever reads, which the copy says on the screen rather than
 * leaving it to be discovered.
 */
function DecisionDialog({
  ask,
  application,
  onClose,
  onDone,
}: {
  ask: Ask;
  application: ApplicationDetail;
  onClose: () => void;
  onDone: (a: ApplicationDetail) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setError(null);
  }, [ask]);

  if (!ask) return null;

  const copy = {
    approve: {
      title: `Approve ${application.practiceName}`,
      confirm: "Approve and create",
      why: `This creates the practice and attaches ${application.doctorName ?? application.contactName} as its head doctor. There is no delete on a practice.`,
      audience: "Nobody at the practice sees this — it goes to the platform log.",
    },
    "request-info": {
      title: "Ask for more information",
      confirm: "Send it back",
      why: "The application goes back to the applicant and can be decided once they answer.",
      audience: "The applicant reads this. Say exactly what is needed.",
    },
    reject: {
      title: `Reject ${application.practiceName}`,
      confirm: "Reject",
      why: "They may apply again — a rejection is not a ban.",
      audience: "The applicant reads this. It is the only thing they are told.",
    },
  }[ask];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ application: ApplicationDetail }>(
        `/admin/applications/${application.id}/${ask}`,
        { method: "POST", body: { note: note.trim() } },
      );
      onDone(out.application);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.why}
      onSubmit={submit}
      confirmLabel={busy ? "Working…" : copy.confirm}
      destructive={ask === "reject"}
      busy={busy}
      error={error}
    >
      <Field label="Reason" hint={copy.audience}>
        <textarea
          className={`${textInput} resize-y`}
          rows={4}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
