"use client";

import { useCallback, useEffect, useState } from "react";
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
export default function Audit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState("");
  const [admin, setAdmin] = useState("");
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
      if (action) params.set("action", action);
      if (admin) params.set("admin", admin);
      if (before) params.set("before", before);

      const out = await api<AuditPage>(`/admin/audit?${params}`);
      setRows(out.items);
      setHasMore(out.hasMore);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [action, admin, before]);

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
        <h1 className="text-xl font-semibold tracking-tight">Audit</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          Every action taken here, newest first — including the ones that only
          looked.
        </p>
      </div>

      <Panel
        title="Actions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(e) => resetTo(() => setAction(e.target.value))}
              className="border-border bg-card rounded-sm border px-2 py-1 font-mono text-[11px]"
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
              className="border-border bg-card rounded-sm border px-2 py-1 font-mono text-[11px]"
            >
              <option value="">anybody</option>
              {facets.admins.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {action || admin ? (
              <button
                onClick={() =>
                  resetTo(() => {
                    setAction("");
                    setAdmin("");
                  })
                }
                className="text-primary text-[11px] underline underline-offset-4"
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
            title={action || admin ? "Nothing matches those filters" : "Nothing recorded yet"}
            hint={
              action || admin
                ? "Clear them to see the whole log."
                : "Actions appear here as soon as somebody takes one."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-[11px] tracking-[0.04em] uppercase">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-secondary/40 transition-colors">
                    <td
                      className="tnum text-muted-foreground px-4 py-2.5 whitespace-nowrap"
                      title={fullWhen(r.at)}
                    >
                      {when(r.at)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.admin}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                    <td className="px-4 py-2.5">
                      <Diff row={r} />
                    </td>
                    <td className="text-muted-foreground max-w-[22rem] px-4 py-2.5 text-xs">
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
            <span className="text-muted-foreground text-xs">
              Page <span className="tnum">{page + 1}</span>
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
                className={cn(
                  "border-border rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors",
                  page === 0 ? "opacity-40" : "hover:bg-secondary",
                )}
              >
                Newer
              </button>
              <button
                disabled={!hasMore}
                onClick={() => setCursors((c) => [...c, rows[rows.length - 1].at])}
                className={cn(
                  "border-border rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors",
                  !hasMore ? "opacity-40" : "hover:bg-secondary",
                )}
              >
                Older
              </button>
            </div>
          </div>
        ) : null}
      </Panel>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Paged by timestamp rather than by offset. The log grows while it is being
        read, and an offset would show the same row twice or skip one entirely.
      </p>
    </div>
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
  if (!row.before) return <span className="text-muted-foreground text-xs">created</span>;

  const moved = Object.keys(row.after).filter(
    (k) => JSON.stringify(row.before?.[k]) !== JSON.stringify(row.after?.[k]),
  );
  if (moved.length === 0)
    return <span className="text-muted-foreground text-xs">no change</span>;

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
        <span key={k} className="text-xs whitespace-nowrap">
          <span className="text-muted-foreground">{k} </span>
          <s className="text-muted-foreground decoration-1">{show(row.before?.[k])}</s>{" "}
          <b className="font-semibold">{show(row.after?.[k])}</b>
        </span>
      ))}
    </span>
  );
}
