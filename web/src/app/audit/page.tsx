"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { AuditPage, AuditRow } from "@/lib/types";
import { Empty, Failed, Loading, Panel, when, fullWhen } from "@/components/primitives";
import { cn } from "@/lib/utils";

/**
 * Every action taken in this console, newest first — including the ones that
 * only looked.
 *
 * "Who read this" is the half of an audit trail usually missing, because a read
 * succeeds quietly and nobody thinks to record it. It is also the half that
 * matters when the question is whether somebody went somewhere they shouldn't.
 */
export default function Page() {
  // `useSearchParams` suspends, and a static export has no server to fall back
  // on — without this the whole route fails to prerender.
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <Audit />
    </Suspense>
  );
}

function Audit() {
  /*
   * Scoped to one practice when arrived at from that practice.
   *
   * The endpoint has taken this filter since it was written and nothing sent
   * it, so "what have we done to this practice" was a question you answered by
   * copying an id out of one screen and into another — which nobody does, so
   * in practice it was not answerable at all.
   *
   * In the URL rather than in state, so it is a link the practice view can
   * hold and a page an operator can send to somebody.
   */
  const params = useSearchParams();
  const router = useRouter();
  const practice = params.get("practice");

  /*
   * In the URL, so the overview can link straight to it.
   *
   * It began as component state, and the overview's "Full audit trail" link
   * then carried `?kind=changes` to a page that read nothing — a link that
   * silently opens the unfiltered log looks exactly like one that worked.
   * linksLand caught it, which is what that contract is for.
   *
   * Read through a whitelist: a hand-edited `?kind=nonsense` becomes "all"
   * rather than reaching the server as a value the validator will refuse.
   */
  const kind: "all" | "changes" = params.get("kind") === "changes" ? "changes" : "all";

  const setKind = useCallback(
    (next: "all" | "changes") => {
      const q = new URLSearchParams(params.toString());
      if (next === "all") q.delete("kind");
      else q.set("kind", next);
      // `replace`, not `push`: flicking between two chips should not fill the
      // history with entries somebody has to press Back through.
      router.replace(`/audit/${q.size ? `?${q}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState("");
  const [admin, setAdmin] = useState("");
  const [total, setTotal] = useState(0);

  /*
   * Typed, and what was typed 250ms ago.
   *
   * The reason is the only free prose in the log, so this is the only filter
   * that can find "the suspension explained by a ticket number" — and a
   * request per keystroke against a growing collection is how a search box
   * becomes the slowest thing on the page.
   */
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [facets, setFacets] = useState<{ actions: string[]; admins: string[] }>({
    actions: [],
    admins: [],
  });

  const page = cursors.length - 1;
  const before = cursors[page];

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (practice) params.set("practice", practice);
      if (action) params.set("action", action);
      if (admin) params.set("admin", admin);
      if (kind !== "all") params.set("kind", kind);
      if (debounced) params.set("q", debounced);
      if (since) params.set("since", new Date(since).toISOString());
      // The whole of the closing day, not midnight at the start of it. A range
      // ending "today" that excludes today is the commonest way a date filter
      // hides the row somebody is looking for.
      if (until) params.set("until", new Date(until + "T23:59:59.999").toISOString());
      if (before) params.set("before", before);

      const out = await api<AuditPage>(`/admin/audit?${params}`);
      setRows(out.items);
      setHasMore(out.hasMore);
      setTotal(out.total ?? out.items.length);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [practice, action, admin, kind, debounced, since, until, before]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The filter offers what actually happened rather than a hand-typed list
    // that goes stale the first time somebody adds a route.
    api<{ actions: string[]; admins: string[] }>("/admin/audit/actions")
      .then(setFacets)
      .catch(() => {
        /* the log still reads without its filters */
      });
  }, []);

  const resetTo = (fn: () => void) => {
    setCursors([null]);
    fn();
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight">Audit</h1>
        <p className="text-muted-foreground mt-1 text-caption">
          {practice
            ? "Everything done to one practice, newest first — including the times somebody only looked."
            : "Every action taken here, newest first — including the ones that only looked."}
        </p>
      </div>

      {/*
        Named from the rows rather than from the URL. A name in a link goes
        stale the moment the practice is renamed, and a heading that disagrees
        with the table beneath it is worse than one that says nothing.
      */}
      {practice ? (
        <div className="border-border bg-secondary/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-4 py-2.5">
          <span className="text-caption">
            <span className="text-muted-foreground">Filtered to </span>
            <span className="font-medium">
              {rows?.[0]?.practice?.name ?? "one practice"}
            </span>
          </span>
          <Link
            href={`/practices/?id=${practice}`}
            className="text-primary text-caption underline underline-offset-4"
          >
            Open it
          </Link>
          <Link
            href="/audit/"
            className="text-muted-foreground hover:text-foreground ml-auto text-caption underline underline-offset-4"
          >
            Show the whole log
          </Link>
        </div>
      ) : null}

      {/*
        The filters, above the table rather than tucked into its header.

        Five controls no longer fit on one line beside a title, and a filter an
        operator cannot see is a filter they do not use. Free text first: it is
        the one that reaches the reason, which is the only prose in the log.
      */}
      <div className="border-border bg-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-3">
        <input
          value={query}
          onChange={(e) => resetTo(() => setQuery(e.target.value))}
          placeholder="Search a reason or an operator…"
          aria-label="Search the reason and the operator"
          className="border-input bg-card focus-visible:border-ring min-w-[14rem] flex-1 rounded-sm border px-2.5 py-1.5 text-body outline-none transition-colors"
        />

        {/*
          Reads are recorded on purpose and outnumber everything else several
          to one, so the whole log answers "what has been done here" badly.
        */}
        <div className="border-border flex shrink-0 overflow-hidden rounded-sm border">
          {(["all", "changes"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => resetTo(() => setKind(k))}
              className={cn(
                "px-2.5 py-1.5 text-caption font-medium whitespace-nowrap transition-colors",
                kind === k
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {k === "all" ? "Everything" : "Changes only"}
            </button>
          ))}
        </div>

        <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-caption">
          From
          <input
            type="date"
            value={since}
            onChange={(e) => resetTo(() => setSince(e.target.value))}
            className="border-input bg-card focus-visible:border-ring rounded-sm border px-2 py-1 text-caption outline-none"
          />
        </label>
        <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-caption">
          to
          <input
            type="date"
            value={until}
            onChange={(e) => resetTo(() => setUntil(e.target.value))}
            className="border-input bg-card focus-visible:border-ring rounded-sm border px-2 py-1 text-caption outline-none"
          />
        </label>
      </div>

      <Panel
        title="Actions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(e) => resetTo(() => setAction(e.target.value))}
              className="border-border bg-card rounded-sm border px-2 py-1 font-mono text-micro"
            >
              <option value="">every action</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={admin}
              onChange={(e) => resetTo(() => setAdmin(e.target.value))}
              className="border-border bg-card rounded-sm border px-2 py-1 font-mono text-micro"
            >
              <option value="">anybody</option>
              {facets.admins.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {action || admin || query || since || until || kind !== "all" ? (
              <button
                onClick={() =>
                  resetTo(() => {
                    setAction("");
                    setAdmin("");
                    setQuery("");
                    setSince("");
                    setUntil("");
                    setKind("all");
                  })
                }
                className="text-primary text-micro underline underline-offset-4"
              >
                clear
              </button>
            ) : null}
          </div>
        }
      >
        {error ? (
          <Failed message={error} retry={() => void load()} />
        ) : !rows ? (
          <Loading rows={6} />
        ) : rows.length === 0 ? (
          <Empty
            title={
              practice
                ? "Nothing has been done to this practice yet"
                : action || admin || query || since || until || kind !== "all"
                  ? "Nothing matches those filters"
                  : "Nothing recorded yet"
            }
            hint={
              practice
                ? "Every action taken on it will appear here."
                : action || admin || query || since || until || kind !== "all"
                  ? "Clear them to see the whole log."
                  : "Actions appear here as soon as somebody takes one."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-micro tracking-[0.04em] uppercase">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  {/*
                    Dropped when the whole table is one practice. A column
                    repeating the same name on every row is a column that costs
                    width and answers nothing.
                  */}
                  {practice ? null : <th className="px-4 py-2 font-medium">Practice</th>}
                  <th className="px-4 py-2 font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-secondary/40 transition-colors">
                    <td
                      className="tnum text-muted-foreground relative px-4 py-2.5 align-top whitespace-nowrap"
                      title={fullWhen(r.at)}
                    >
                      {/*
                        A refused sign-in or a locked account is the row this
                        page is opened to find, and 1,400 rows of identical grey
                        monospace is a list nobody scans.

                        The same left edge the register puts on a practice
                        awaiting a decision and the attention panel puts on an
                        item — one language, drawn one way. `--stopped` here
                        rather than `--waiting`, and in the accent role
                        globals.css documents for it rather than as body text.
                        The action name still says "failed" in words, so the
                        colour reinforces rather than carries.
                      */}
                      {toneOf(r.action) === "alarm" ? (
                        <span
                          aria-hidden
                          className="bg-stopped absolute top-0 bottom-0 left-0 w-[3px]"
                        />
                      ) : null}
                      {when(r.at)}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className="block font-mono text-caption">{r.admin}</span>
                      {/*
                        Under the name rather than beside it. Where from is
                        half of "who", and a column of its own would have cost
                        more width than the answer is asked for — but a sign-in
                        from an address nobody recognises is the whole of the
                        evidence when this log is opened in anger.

                        The browser is on the title, because it is a paragraph
                        and it is the third question, not the second.
                      */}
                      {r.ip ? (
                        <span
                          className="text-muted-foreground block font-mono text-micro"
                          title={r.userAgent ?? undefined}
                        >
                          {r.ip}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span
                        className={cn(
                          "font-mono text-caption",
                          // Reads recede. They are recorded on purpose and are
                          // still the least of what is here.
                          toneOf(r.action) === "read" && "text-muted-foreground",
                          toneOf(r.action) === "alarm" && "font-semibold",
                        )}
                      >
                        {r.action}
                      </span>
                    </td>
                    {practice ? null : (
                      <td className="px-4 py-2.5 align-top">
                        <Target practice={r.practice} />
                      </td>
                    )}
                    <td className="px-4 py-2.5 align-top">
                      <Diff row={r} />
                    </td>
                    <td className="text-muted-foreground max-w-[22rem] px-4 py-2.5 align-top text-caption">
                      {r.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 ? (
          <div className="border-border flex items-center justify-between border-t px-4 py-2.5">
            {/*
              What matched, not which page. "Page 3" cannot say whether a
              filter caught almost everything or almost nothing, which is the
              only thing worth knowing after typing one.
            */}
            <span className="text-muted-foreground text-caption">
              <span className="tnum">{(page * 50 + 1).toLocaleString()}</span>–
              <span className="tnum">{(page * 50 + rows.length).toLocaleString()}</span> of{" "}
              <span className="tnum text-foreground font-medium">
                {total.toLocaleString()}
              </span>
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
                className={cn(
                  "border-border rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors",
                  // `disabled:` rather than a ternary on the same condition as
                  // the `disabled` prop above it. WCAG exempts an unavailable
                  // control from contrast; a dimmed-but-live button is not
                  // exempt from anything.
                  "disabled:opacity-40",
                  "hover:bg-secondary disabled:hover:bg-transparent",
                )}
              >
                Newer
              </button>
              <button
                disabled={!hasMore}
                onClick={() => setCursors((c) => [...c, rows[rows.length - 1].at])}
                className={cn(
                  "border-border rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors",
                  "disabled:opacity-40",
                  "hover:bg-secondary disabled:hover:bg-transparent",
                )}
              >
                Older
              </button>
            </div>
          </div>
        ) : null}
      </Panel>

      <p className="text-muted-foreground text-caption leading-relaxed">
        Paged by timestamp rather than by offset. The log grows while it is being
        read, and an offset would show the same row twice or skip one entirely.
      </p>
    </div>
  );
}

/**
 * Who the action was aimed at.
 *
 * Links, because an entry an operator cannot act on from where it appears is a
 * worry rather than a task — the question after "who suspended them" is always
 * "show me them".
 *
 * A practice that has since been deleted keeps its id and says what it is. The
 * alternative is a dash, which is what a platform-wide action renders, and the
 * two mean opposite things: one was aimed at nobody, the other at somebody who
 * is no longer here.
 */
function Target({ practice }: { practice: AuditRow["practice"] }) {
  if (!practice) return <span className="text-muted-foreground">—</span>;

  if (!practice.name) {
    return (
      <span
        className="text-muted-foreground font-mono text-caption"
        title={`Deleted practice · ${practice.id}`}
      >
        deleted · {practice.id.slice(-6)}
      </span>
    );
  }

  return (
    <Link
      href={`/practices/?id=${practice.id}`}
      className="hover:text-primary text-caption underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
    >
      {practice.name}
    </Link>
  );
}

/**
 * "active → suspended", from whichever fields actually moved.
 *
 * "Changed plan" with no values is an entry nobody can review, and the question
 * asked six months later is always what it used to be.
 */
function Diff({ row }: { row: AuditRow }) {
  if (!row.after) return <span className="text-muted-foreground">—</span>;
  if (!row.before) return <span className="text-muted-foreground text-caption">created</span>;

  const moved = Object.keys(row.after).filter(
    (k) => JSON.stringify(row.before?.[k]) !== JSON.stringify(row.after?.[k]),
  );
  if (moved.length === 0)
    return <span className="text-muted-foreground text-caption">no change</span>;

  const show = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "—"
      : Array.isArray(v)
        ? v.length
          ? v.join(", ")
          : "—"
        : String(v);

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {moved.map((k) => (
        <span key={k} className="text-caption whitespace-nowrap">
          <span className="text-muted-foreground">{k} </span>
          <s className="text-muted-foreground decoration-1">{show(row.before?.[k])}</s>{" "}
          <b className="font-semibold">{show(row.after?.[k])}</b>
        </span>
      ))}
    </span>
  );
}

/**
 * How loudly an action should read.
 *
 * The raw name stays on screen — a taxonomy invented for display is a second
 * vocabulary to learn, and this one is the log's own. Only the weight changes,
 * because 1,400 rows of identical grey monospace is a list nobody scans.
 *
 * A refused sign-in or a locked account is the row this page is opened to find.
 * A read is the row it is opened to skip past — recorded on purpose, and still
 * the least of what is here.
 */
function toneOf(action: string): "alarm" | "read" | "change" {
  // `failed_*` rather than the three that exist today: a fourth way to fail a
  // sign-in should be loud the day it is added, not the day somebody notices
  // this list never grew.
  if (/\.(locked|failed(_\w+)?)$/.test(action)) return "alarm";
  if (/\.(read|list)$/.test(action)) return "read";
  return "change";
}
