"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useAttention } from "@/components/attention";
import { MetricCard } from "@/components/metrics";
import { Empty, Failed, Panel, Pill, statusTone, when } from "@/components/primitives";
import { IconAdmins, IconAlert, IconCheck, IconChevron, IconPractice } from "@/components/icons";
import type { Overview, PracticeRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The landing screen.
 *
 * Three questions, in order: what is happening, what needs my attention, what
 * do I do next. The metrics answer the first, the attention list answers the
 * second, and every item in it links to the screen that answers the third — an
 * alert that cannot be acted on from where it appears is a worry rather than a
 * task.
 *
 * Attention sits above the numbers on purpose. Counts are the thing an operator
 * reads when nothing is wrong; when something is, it should not be below a row
 * of figures they have to scroll past.
 */
export default function OverviewPage() {
  const { admin } = useSession();
  const { items: attention } = useAttention();
  const [o, setO] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<PracticeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [over, list] = await Promise.all([
        api<Overview>("/admin/overview"),
        api<{ items: PracticeRow[] }>("/admin/practices"),
      ]);
      setO(over);
      setRecent(
        [...list.items]
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
          .slice(0, 5),
      );
    } catch (ex) {
      setError((ex as ApiError).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Failed message={error} retry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}
          {admin?.name ? `, ${admin.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1 text-xs">
          {attention === null
            ? "Checking what needs you…"
            : attention.length === 0
              ? "Nothing is waiting on a decision."
              : `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} your attention.`}
        </p>
      </header>

      <AttentionPanel items={attention} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Active practices"
          value={o?.practices.active ?? 0}
          movement={o?.trends.practices}
          icon={<IconPractice className="size-4" />}
        />
        <MetricCard
          label="Patients"
          value={o?.activeEnrolments ?? 0}
          movement={o?.trends.patients}
          hint="enrolled across every practice"
        />
        <MetricCard
          label="Staff"
          value={o?.staff ?? 0}
          movement={o?.trends.staff}
          icon={<IconAdmins className="size-4" />}
        />
        <MetricCard
          label="Locations"
          value={o?.locations ?? 0}
          movement={o?.trends.locations}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Recently added"
          description="The five newest practices."
          actions={
            <Link
              href="/practices/"
              className="text-primary text-xs underline underline-offset-4"
            >
              All practices
            </Link>
          }
        >
          {recent === null ? (
            <div className="divide-border divide-y">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="bg-muted h-3 w-40 animate-pulse rounded-sm" />
                  <div className="bg-muted ml-auto h-3 w-16 animate-pulse rounded-sm" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <Empty
              title="No practices yet"
              hint="They will appear here once created."
              action={
                <Link
                  href="/practices/"
                  className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 text-xs font-medium"
                >
                  Add the first one
                </Link>
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/practices/?id=${p.id}`}
                    className="hover:bg-secondary/50 flex items-center gap-3 px-4 py-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {p.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        added {when(p.createdAt)}
                      </span>
                    </span>
                    <Pill tone={statusTone(p.status)}>{p.status}</Pill>
                    <IconChevron className="text-muted-foreground size-3.5 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="By plan" description="What every practice is on.">
          {o ? (
            <ul className="divide-border divide-y">
              {(["trial", "solo", "clinic", "hospital"] as const).map((k) => (
                <li
                  key={k}
                  className="flex items-center justify-between px-4 py-2.5 text-[13px]"
                >
                  <span className="capitalize">{k}</span>
                  <span className="tnum font-mono text-xs">{o.plans[k] ?? 0}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8" />
          )}
          <p className="text-muted-foreground border-border border-t px-4 py-3 text-[11px] leading-relaxed">
            A plan is a name. What actually restrains anything is the caps on
            each practice, which are set individually.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function AttentionPanel({
  items,
}: {
  items: ReturnType<typeof useAttention>["items"];
}) {
  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="border-ok/25 bg-ok-tint flex items-center gap-2.5 rounded-lg border px-4 py-3">
        <IconCheck className="text-ok size-4 shrink-0" />
        <p className="text-[13px]">
          <strong className="font-semibold">Nothing is waiting on you.</strong>{" "}
          <span className="text-muted-foreground">
            Every practice is decided and every administrator has a second factor.
          </span>
        </p>
      </div>
    );
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <header className="border-border flex items-center gap-2 border-b px-4 py-2.5">
        <IconAlert className="text-waiting size-4" />
        <h2 className="text-[13px] font-semibold tracking-tight">Action required</h2>
      </header>
      <ul className="divide-border divide-y">
        {items.map((it, i) => (
          <li key={`${it.kind}-${i}`} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute top-0 bottom-0 left-0 w-[3px]",
                it.severity === "stopped" ? "bg-stopped" : "bg-waiting",
              )}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{it.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {it.detail}
                </p>
              </div>
              <Link
                href={it.href}
                className="border-border hover:bg-secondary shrink-0 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
              >
                Review
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
