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

/** `staff`, not `patients` — the label always said "Most staff". */
type Sort = "waiting" | "name" | "newest" | "staff";

/** One screen of register. Bounded by the server at 100 whatever this says. */
const PER_PAGE = 25;

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/practices/${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  /*
   * The search box, a beat behind the typing.
   *
   * Filtering used to happen in the browser because the whole register was
   * already loaded, and the comment here said a round trip per keystroke would
   * be slower than the filter it replaced. That was true, and it stopped being
   * the right trade once the list could be long enough to matter.
   *
   * So the filtering moved to the server and the round trip the old comment
   * feared is avoided the ordinary way: 250ms of quiet before asking. Long
   * enough that a typed word is one request, short enough that nobody notices
   * waiting.
   */
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // A new filter starts at page one. Staying on page four of a register that
  // now has two matches shows an empty table and no reason for it.
  useEffect(() => {
    setPage(1);
  }, [status, verification, plan, debounced, sort]);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (verification) qs.set("verification", verification);
      if (plan) qs.set("plan", plan);
      if (debounced.trim()) qs.set("q", debounced.trim());
      qs.set("sort", sort);
      qs.set("page", String(page));
      qs.set("limit", String(PER_PAGE));

      const out = await api<{
        items: PracticeRow[];
        total: number;
        page: number;
      }>(`/admin/practices?${qs}`);
      setRows(out.items);
      setTotal(out.total);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
      setTotal(0);
    }
  }, [status, verification, plan, debounced, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server has already filtered, sorted and paged. Doing any of it again
  // here is how two implementations of one rule start to disagree.
  const shown = rows;

  const filtered = Boolean(status || verification || plan || query);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-tight">Practices</h1>
          <p className="text-muted-foreground mt-1 text-caption">
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
            ["staff", "Most staff"],
          ]}
        />

        </div>

        {filtered ? (
          <Link
            href="/practices/"
            className="text-primary self-start text-caption underline underline-offset-4"
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
                  className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-caption font-medium"
                >
                  Clear filters
                </Link>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 text-caption font-medium"
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

            <Pager
              page={page}
              total={total}
              shown={shown.length}
              onPage={setPage}
            />
          </>
        )}
      </Panel>

      <NewPracticeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(outcome) => {
          setCreating(false);
          // Who heard about it, so the operator knows whether to ring them.
          // Nothing reaches somebody new except the email, when one was given.
          const told = outcome
            ? [
                outcome.notified.devices ? "their phone" : null,
                outcome.notified.emailTo && outcome.mailConfigured ? outcome.notified.emailTo : null,
              ].filter(Boolean)
            : [];
          toast.success(
            told.length
              ? `Practice created — onboarding, unverified. Told: ${told.join(" and ")}.`
              : "Practice created — onboarding, unverified. Nobody could be told automatically: ring the head doctor to say it is ready.",
          );
          void load();
        }}
      />
    </div>
  );
}

const waiting = (p: PracticeRow) =>
  p.verification === "pending" || p.status === "onboarding";

/**
 * Where you are in the register, and how to move.
 *
 * ---- It says the total, not just the page ---------------------------
 *
 * "25 of 312" answers a question a pair of arrows cannot: whether a filter
 * matched almost everything or almost nothing. Without it, an operator who
 * filters to `halted` and sees a full page has no idea whether that is four
 * practices or four hundred.
 *
 * Hidden entirely when everything fits. A pager under a list of three is a
 * control that can only ever do nothing.
 */
function Pager({
  page,
  total,
  shown,
  onPage,
}: {
  page: number;
  total: number;
  shown: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (pages <= 1) return null;

  const first = (page - 1) * PER_PAGE + 1;
  const last = first + shown - 1;

  return (
    <div className="border-border flex items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-muted-foreground text-caption" aria-live="polite">
        <span className="tnum">
          {first}&ndash;{last}
        </span>{" "}
        of <span className="tnum">{total.toLocaleString("en-IN")}</span>
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="border-border hover:bg-secondary disabled:hover:bg-transparent rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-40"
        >
          Previous
        </button>
        {/* The page number between the buttons, so the disabled state of each
            is read as a boundary rather than as a broken control. */}
        <span className="text-muted-foreground text-caption tnum">
          {page} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="border-border hover:bg-secondary disabled:hover:bg-transparent rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

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
      <td className="tnum px-4 py-2.5 font-mono text-caption">{p.staff}</td>
      <td className="tnum px-4 py-2.5 font-mono text-caption">{p.locations}</td>
      <td className="px-4 py-2.5">
        <span className="flex flex-wrap gap-1">
          <Pill tone={statusTone(p.status)}>{p.status}</Pill>
          <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
        </span>
      </td>
      <td className="tnum text-muted-foreground px-4 py-2.5 text-caption whitespace-nowrap">
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
