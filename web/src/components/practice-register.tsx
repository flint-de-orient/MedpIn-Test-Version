"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { PracticeRow, Plan, PracticeStatus, Verification } from "@/lib/types";
import { PLAN_LABELS } from "@/lib/types";
import {
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  statusTone,
  verificationTone,
  when,
} from "@/components/primitives";
import { NewPracticeDialog } from "@/components/new-practice";
import { IconChevron, IconSearch } from "@/components/icons";
import { cn } from "@/lib/utils";

type Sort = "waiting" | "name" | "newest" | "patients";

/**
 * Every practice on the platform.
 *
 * ---- Filters live in the URL --------------------------------------------
 *
 * `/practices/?status=active&plan=trial` is a link somebody can send, a tab
 * that survives a reload, and the address the Action Required items point at.
 * Holding this in component state instead would make "3 practices awaiting
 * verification → Review" land on an unfiltered list, which is the same as not
 * linking anywhere.
 *
 * ---- The table becomes cards on a phone ---------------------------------
 *
 * Not a table that scrolls sideways. Seven columns on a 390px screen means the
 * status — the reason anybody opened this — is off the right-hand edge.
 */
export function PracticeRegister() {
  const router = useRouter();
  const params = useSearchParams();

  const status = (params.get("status") ?? "") as PracticeStatus | "";
  const verification = (params.get("verification") ?? "") as Verification | "";
  const plan = (params.get("plan") ?? "") as Plan | "";
  const query = params.get("q") ?? "";

  const [rows, setRows] = useState<PracticeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<Sort>("waiting");

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/practices/${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (verification) qs.set("verification", verification);
      const out = await api<{ items: PracticeRow[] }>(
        `/admin/practices${qs.toString() ? `?${qs}` : ""}`,
      );
      setRows(out.items);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [status, verification]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();

    // Plan and text are filtered here rather than server-side: the list is
    // already loaded, and a round trip per keystroke would be slower than the
    // filter it replaces.
    const filtered = rows.filter((p) => {
      if (plan && p.plan !== plan) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.registrationNo ?? "").toLowerCase().includes(q) ||
        (p.doctorDisplayName ?? "").toLowerCase().includes(q)
      );
    });

    const waiting = (p: PracticeRow) =>
      p.verification === "pending" || p.status === "onboarding";

    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "newest") return +new Date(b.createdAt) - +new Date(a.createdAt);
      if (sort === "patients") return b.staff - a.staff;
      // Default: anything undecided first. The console is opened to find out
      // what needs doing, not to browse an alphabet.
      return Number(waiting(b)) - Number(waiting(a));
    });
  }, [rows, query, plan, sort]);

  const filtered = Boolean(status || verification || plan || query);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Practices</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            Counts only — this console cannot open a patient record.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-body font-medium"
        >
          Add a practice
        </button>
      </div>

      {/* Filters. Every one writes to the URL, so a filtered view is a link. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="border-border bg-card focus-within:border-ring flex h-8 w-full items-center gap-2 rounded-md border px-2.5 transition-colors sm:w-auto sm:min-w-[13rem] sm:flex-1">
          <IconSearch className="text-muted-foreground size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Name, registration number, doctor"
            aria-label="Search practices"
            className="w-full bg-transparent text-body outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-2">
        <Choice
          label="Status"
          value={status}
          onChange={(v) => setParam("status", v)}
          options={[
            ["", "Any status"],
            ["onboarding", "Onboarding"],
            ["active", "Active"],
            ["suspended", "Suspended"],
          ]}
        />
        <Choice
          label="Verification"
          value={verification}
          onChange={(v) => setParam("verification", v)}
          options={[
            ["", "Any verification"],
            ["unverified", "Unverified"],
            ["pending", "Pending"],
            ["verified", "Verified"],
            ["rejected", "Rejected"],
          ]}
        />
        <Choice
          label="Plan"
          value={plan}
          onChange={(v) => setParam("plan", v)}
          options={[
            ["", "Any plan"],
            ...(Object.keys(PLAN_LABELS) as Plan[]).map(
              (k) => [k, PLAN_LABELS[k]] as [string, string],
            ),
          ]}
        />
        <Choice
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as Sort)}
          options={[
            ["waiting", "Needs attention first"],
            ["newest", "Newest first"],
            ["name", "By name"],
            ["patients", "Most staff"],
          ]}
        />

        </div>

        {filtered ? (
          <Link
            href="/practices/"
            className="text-primary self-start text-xs underline underline-offset-4"
          >
            Clear
          </Link>
        ) : null}
      </div>

      <Panel>
        {error ? (
          <Failed message={error} retry={() => void load()} />
        ) : !shown ? (
          <Loading rows={5} />
        ) : shown.length === 0 ? (
          <Empty
            title={filtered ? "Nothing matches those filters" : "No practices yet"}
            hint={
              filtered
                ? "Clear them to see the whole register."
                : "Add the first one. It arrives onboarding and unverified — creating a practice is not vouching for it."
            }
            action={
              filtered ? (
                <Link
                  href="/practices/"
                  className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-xs font-medium"
                >
                  Clear filters
                </Link>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 text-xs font-medium"
                >
                  Add a practice
                </button>
              )
            }
          />
        ) : (
          <>
            {/* Desktop: a table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-micro tracking-[0.06em] uppercase">
                    <th className="px-4 py-2 font-medium">Practice</th>
                    <th className="px-4 py-2 font-medium">Plan</th>
                    <th className="px-4 py-2 font-medium">Staff</th>
                    <th className="px-4 py-2 font-medium">Locations</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Added</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {shown.map((p) => (
                    <Row key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: cards, with the status kept where it can be seen. */}
            <ul className="divide-border divide-y md:hidden">
              {shown.map((p) => (
                <Card key={p.id} p={p} />
              ))}
            </ul>
          </>
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

const waiting = (p: PracticeRow) =>
  p.verification === "pending" || p.status === "onboarding";

function Row({ p }: { p: PracticeRow }) {
  return (
    <tr className="hover:bg-secondary/40 group relative transition-colors">
      <td className="relative px-4 py-2.5">
        {waiting(p) ? (
          <span aria-hidden className="bg-waiting absolute top-0 bottom-0 left-0 w-[3px]" />
        ) : null}
        <Link href={`/practices/?id=${p.id}`} className="block">
          <span className="block font-medium">{p.name}</span>
          <span className="text-muted-foreground font-mono text-micro">
            {p.registrationNo ?? "no registration number"}
          </span>
        </Link>
      </td>
      <td className="text-muted-foreground px-4 py-2.5">{PLAN_LABELS[p.plan]}</td>
      <td className="tnum px-4 py-2.5 font-mono text-xs">{p.staff}</td>
      <td className="tnum px-4 py-2.5 font-mono text-xs">{p.locations}</td>
      <td className="px-4 py-2.5">
        <span className="flex flex-wrap gap-1">
          <Pill tone={statusTone(p.status)}>{p.status}</Pill>
          <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
        </span>
      </td>
      <td className="tnum text-muted-foreground px-4 py-2.5 text-xs whitespace-nowrap">
        {when(p.createdAt)}
      </td>
      <td className="px-2">
        <Link href={`/practices/?id=${p.id}`} aria-label={`Open ${p.name}`}>
          <IconChevron className="text-muted-foreground size-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function Card({ p }: { p: PracticeRow }) {
  return (
    <li className="relative">
      {waiting(p) ? (
        <span aria-hidden className="bg-waiting absolute top-0 bottom-0 left-0 w-[3px]" />
      ) : null}
      <Link href={`/practices/?id=${p.id}`} className="block px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-body font-medium">{p.name}</span>
            <span className="text-muted-foreground font-mono text-micro">
              {p.registrationNo ?? "no registration number"}
            </span>
          </div>
          <IconChevron className="text-muted-foreground mt-1 size-3.5 shrink-0" />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <Pill tone={statusTone(p.status)}>{p.status}</Pill>
          <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
          <Pill tone="muted">{PLAN_LABELS[p.plan]}</Pill>
        </div>

        <dl className="text-muted-foreground mt-2.5 grid grid-cols-3 gap-2 text-micro">
          <div>
            <dt className="uppercase">Staff</dt>
            <dd className="tnum text-foreground font-mono">{p.staff}</dd>
          </div>
          <div>
            <dt className="uppercase">Locations</dt>
            <dd className="tnum text-foreground font-mono">{p.locations}</dd>
          </div>
          <div>
            <dt className="uppercase">Added</dt>
            <dd className="tnum text-foreground font-mono">{when(p.createdAt)}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "border-border bg-card h-8 min-w-0 flex-1 rounded-md border px-2 text-caption transition-colors sm:flex-none",
        value ? "border-primary text-foreground" : "text-muted-foreground",
      )}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
