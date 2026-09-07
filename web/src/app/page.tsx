"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Overview, PracticeRow } from "@/lib/types";
import { PLAN_LABELS } from "@/lib/types";
import {
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  Stat,
  statusTone,
  verificationTone,
} from "@/components/primitives";
import { NewPracticeDialog } from "@/components/new-practice";
import { cn } from "@/lib/utils";

type Filter = "" | "onboarding" | "active" | "suspended";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "", label: "All" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
];

/** Waiting on the operator to do something. This is what sorts the register. */
const isWaiting = (p: PracticeRow) =>
  p.verification === "pending" || p.status === "onboarding";

export default function Practices() {
  const [rows, setRows] = useState<PracticeRow[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [filter, setFilter] = useState<Filter>("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, over] = await Promise.all([
        api<{ items: PracticeRow[] }>(
          `/admin/practices${filter ? `?status=${filter}` : ""}`,
        ),
        api<Overview>("/admin/overview"),
      ]);
      setRows(list.items);
      setOverview(over);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Anything undecided sorts to the top. The console is opened to find out what
  // needs doing, not to browse an alphabet.
  const sorted = useMemo(
    () =>
      rows
        ? [...rows].sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)))
        : null,
    [rows],
  );

  const waiting = sorted?.filter(isWaiting).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Practices</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {waiting > 0
              ? `${waiting} waiting on a decision from you.`
              : "Nothing is waiting on a decision."}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-[13px] font-medium"
        >
          Add a practice
        </button>
      </div>

      {overview ? <Totals o={overview} /> : null}

      <Panel
        title="The register"
        description="Every practice on the platform. Counts only — this console cannot open a patient record."
        actions={
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setRows(null);
                  setFilter(f.key);
                }}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors",
                  filter === f.key
                    ? "border-primary text-primary bg-accent"
                    : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <Failed message={error} retry={() => void load()} />
        ) : !sorted ? (
          <Loading rows={4} />
        ) : sorted.length === 0 ? (
          <Empty
            title={filter ? "No practices with that status" : "No practices yet"}
            hint={
              filter
                ? "Clear the filter to see the rest of the register."
                : "Add the first one. It arrives onboarding and unverified — creating a practice is not vouching for it."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {sorted.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </ul>
        )}
      </Panel>

      <NewPracticeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast.success("Practice created — onboarding, unverified");
          void load();
        }}
      />
    </div>
  );
}

/**
 * The platform in six numbers.
 *
 * No chart. A line of a dozen practices over time tells the operator nothing
 * they cannot read from the register itself, and a sparkline drawn from four
 * data points is a decoration pretending to be evidence.
 */
function Totals({ o }: { o: Overview }) {
  const waiting = (o.practices.onboarding ?? 0) + (o.verification.pending ?? 0);
  return (
    <div className="border-border bg-card grid grid-cols-2 gap-x-6 gap-y-5 rounded-md border px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        value={waiting}
        label="Waiting"
        tone={waiting > 0 ? "waiting" : undefined}
        hint="onboarding or unverified"
      />
      <Stat value={o.practices.active ?? 0} label="Active" />
      <Stat value={o.practices.suspended ?? 0} label="Suspended" />
      <Stat value={o.activeEnrolments} label="Patients" hint="enrolled, all practices" />
      <Stat value={o.staff} label="Staff" />
      <Stat
        value={o.newPracticesThisWeek}
        label="New"
        hint="in the last seven days"
      />
    </div>
  );
}

function Row({ p }: { p: PracticeRow }) {
  const waiting = isWaiting(p);
  const cap = p.limits.patients;

  return (
    <li className="relative">
      {/* The single "needs you" signal in the whole console: a left edge. Not a
          badge, not a colour on the text — an edge is visible while scanning a
          long list without reading any of it. */}
      {waiting ? (
        <span
          aria-hidden
          className="bg-waiting absolute top-0 bottom-0 left-0 w-[3px]"
        />
      ) : null}

      <Link
        href={`/practices/?id=${p.id}`}
        className="hover:bg-secondary/50 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{p.name}</span>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            {p.registrationNo ? (
              <span className="font-mono tnum">{p.registrationNo}</span>
            ) : (
              <span className="italic">no registration number</span>
            )}
            <span aria-hidden>·</span>
            <span className="tnum">
              {p.locations} location{p.locations === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span className="tnum">{p.staff} staff</span>
          </div>
        </div>

        <div className="text-muted-foreground hidden w-28 text-xs md:block">
          <div className="text-foreground">{PLAN_LABELS[p.plan]}</div>
          <div className="tnum">
            {cap === null ? "no patient cap" : `cap ${cap}`}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Pill tone={statusTone(p.status)}>{p.status}</Pill>
          <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
        </div>
      </Link>
    </li>
  );
}
