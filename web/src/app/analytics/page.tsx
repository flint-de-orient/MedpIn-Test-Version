"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Empty, Failed, Panel } from "@/components/primitives";
import { UsageBar } from "@/components/metrics";
import { IconChevron } from "@/components/icons";
import { PLAN_LABELS, type Plan } from "@/lib/types";
import { cn } from "@/lib/utils";

type AnalyticsData = {
  months: string[];
  series: {
    practices: number[];
    staff: number[];
    locations: number[];
    patients: number[];
  };
  status: { active: number; onboarding: number; suspended: number };
  plans: Record<string, number>;
  utilisation: { id: string; name: string; cap: number; used: number }[];
};

const LINES = [
  { key: "practices", label: "Practices", stroke: "var(--chart-1)" },
  { key: "patients", label: "Patients", stroke: "var(--chart-2)" },
  { key: "staff", label: "Staff", stroke: "var(--chart-3)" },
  { key: "locations", label: "Locations", stroke: "var(--chart-4)" },
] as const;

/**
 * The platform over time.
 *
 * Every chart here answers a question somebody actually asks. There is no pie
 * of things that do not divide into a whole, and no sparkline drawn through
 * four points — a decorative graph is worse than no graph, because it looks
 * like evidence.
 *
 * ---- Which line and how long live in the URL ----------------------------
 *
 * Same as the practice register, and for the same two reasons. The overview's
 * Patients card has to be able to link at the patients line rather than at the
 * page — landing on the default and making somebody find the right button is
 * the same as not linking. And "look at staff over 24 months" becomes something
 * one operator can send another.
 */
export default function AnalyticsPage() {
  // `useSearchParams` suspends, and a static export has no server to fall back
  // on — without this the whole route fails to prerender.
  return (
    <Suspense fallback={<div className="h-[30rem]" />}>
      <Analytics />
    </Suspense>
  );
}

type LineKey = (typeof LINES)[number]["key"];

function Analytics() {
  const params = useSearchParams();
  const router = useRouter();

  const [a, setA] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read through a whitelist. A hand-edited ?line=nonsense would otherwise
  // reach LINES.find(...)! and throw on a null, taking the page down over a
  // typo in an address bar.
  const raw = params.get("line");
  const line: LineKey = LINES.some((l) => l.key === raw) ? (raw as LineKey) : "practices";

  const monthsRaw = Number(params.get("months"));
  const months = [6, 12, 24].includes(monthsRaw) ? monthsRaw : 12;

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      // `replace`, not `push`: flicking between four lines should not put four
      // entries in the history somebody then has to press Back through.
      router.replace(`/analytics/?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const load = useCallback(async () => {
    setError(null);
    setA(null);
    try {
      setA(await api<AnalyticsData>(`/admin/analytics?months=${months}`));
    } catch (ex) {
      setError((ex as ApiError).message);
    }
  }, [months]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Failed message={error} retry={() => void load()} />;

  const series = a?.series[line] ?? [];
  const total = a ? a.status.active + a.status.onboarding + a.status.suspended : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            How much of the platform there is, and how that changed.
          </p>
        </div>
        <div className="flex gap-1">
          {[6, 12, 24].map((m) => (
            <button
              key={m}
              onClick={() => setParam("months", String(m))}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                months === m
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <Panel
        title="Growth"
        description="Cumulative — how many existed at the end of each month, not how many arrived in it. A bar chart of arrivals reads as a collapse whenever a good month is followed by an ordinary one."
        actions={
          <div className="flex flex-wrap gap-1">
            {LINES.map((l) => (
              <button
                key={l.key}
                onClick={() => setParam("line", l.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  line === l.key
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: l.stroke }}
                />
                {l.label}
              </button>
            ))}
          </div>
        }
      >
        {a ? (
          <LineChart
            months={a.months}
            values={series}
            stroke={LINES.find((l) => l.key === line)!.stroke}
            label={LINES.find((l) => l.key === line)!.label}
          />
        ) : (
          <div className="bg-muted/40 m-4 h-[13rem] animate-pulse rounded-md" />
        )}
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel title="Status" description="Every practice, by whether it may operate.">
          {a && total > 0 ? (
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="bg-muted flex h-2 overflow-hidden rounded-full">
                <Segment n={a.status.active} total={total} className="bg-ok" />
                <Segment n={a.status.onboarding} total={total} className="bg-waiting" />
                <Segment n={a.status.suspended} total={total} className="bg-stopped" />
              </div>
              <dl className="grid grid-cols-3 gap-3 text-[13px]">
                <Legend label="Active" status="active" n={a.status.active} className="bg-ok" />
                <Legend
                  label="Onboarding"
                  status="onboarding"
                  n={a.status.onboarding}
                  className="bg-waiting"
                />
                <Legend
                  label="Suspended"
                  status="suspended"
                  n={a.status.suspended}
                  className="bg-stopped"
                />
              </dl>
            </div>
          ) : (
            <Empty title="No practices yet" hint="Nothing to break down." />
          )}
        </Panel>

        <Panel title="Plans" description="A plan is a name; the caps are what bite.">
          {a ? (
            <ul className="divide-border divide-y">
              {(Object.keys(PLAN_LABELS) as Plan[]).map((k) => {
                const n = a.plans[k] ?? 0;
                if (n === 0) {
                  return (
                    <li
                      key={k}
                      className="text-muted-foreground flex items-center justify-between px-4 py-2.5 text-[13px]"
                    >
                      <span>{PLAN_LABELS[k]}</span>
                      <span className="tnum font-mono text-xs">0</span>
                    </li>
                  );
                }
                return (
                  <li key={k}>
                    <Link
                      href={`/practices/?plan=${k}`}
                      className="hover:bg-secondary/50 group flex items-center justify-between px-4 py-2.5 text-[13px] transition-colors"
                    >
                      <span>{PLAN_LABELS[k]}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tnum font-mono text-xs">{n}</span>
                        <IconChevron className="text-muted-foreground/40 group-hover:text-primary size-3 transition-colors" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="h-40" />
          )}
        </Panel>
      </div>

      <Panel
        title="Capacity"
        description="Practices with a patient cap set, closest to it first."
      >
        {!a ? (
          <div className="h-32" />
        ) : a.utilisation.length === 0 ? (
          <Empty
            title="No practice has a cap"
            hint="Every practice is unlimited, which is what they all are until somebody types a number into a plan. Nothing here can be near a limit that does not exist."
          />
        ) : (
          <ul className="divide-border divide-y">
            {a.utilisation.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <Link href={`/practices/?id=${p.id}`} className="block">
                  <UsageBar label={p.name} used={p.used} cap={p.cap} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Segment({
  n,
  total,
  className,
}: {
  n: number;
  total: number;
  className: string;
}) {
  if (n === 0) return null;
  return <span className={className} style={{ width: `${(n / total) * 100}%` }} />;
}

/**
 * One band of the status bar, and the way into the practices behind it.
 *
 * A breakdown that cannot be opened makes somebody read "Suspended 3", go to
 * the register, and set the filter by hand — which is the work this panel was
 * meant to save. Nought is not a link, because there is nothing to open.
 */
function Legend({
  label,
  status,
  n,
  className,
}: {
  label: string;
  status: string;
  n: number;
  className: string;
}) {
  const inner = (
    <>
      <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px] uppercase">
        <span aria-hidden className={cn("size-1.5 rounded-full", className)} />
        {label}
      </dt>
      <dd className="tnum font-mono">{n}</dd>
    </>
  );

  if (n === 0) {
    return <div className="text-muted-foreground flex flex-col gap-0.5">{inner}</div>;
  }

  return (
    <Link
      href={`/practices/?status=${status}`}
      className="hover:bg-secondary/50 -m-1.5 flex flex-col gap-0.5 rounded-md p-1.5 transition-colors"
    >
      {inner}
      <span className="sr-only">— open these practices</span>
    </Link>
  );
}

/**
 * One line, drawn by hand.
 *
 * A charting library is 40KB and a set of defaults — the gridlines, the
 * tooltip, the axis type — that then have to be argued out of it one option at
 * a time. This is twelve points and a path.
 *
 * The table underneath is not a fallback: a chart is a shape, and somebody who
 * needs the number reads it there. It is also what a screen reader gets, which
 * is why the SVG is `aria-hidden` rather than carrying a description that would
 * always be a worse version of the table.
 */
function LineChart({
  months,
  values,
  stroke,
  label,
}: {
  months: string[];
  values: number[];
  stroke: string;
  label: string;
}) {
  const W = 720;
  const H = 200;
  const PAD = { top: 16, right: 12, bottom: 26, left: 40 };

  const max = Math.max(...values, 1);
  // A rounded ceiling, so the axis reads 0/25/50 rather than 0/17/34.
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const ceil = step * 4;

  const x = (i: number) =>
    PAD.left +
    (i / Math.max(values.length - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - v / ceil) * (H - PAD.top - PAD.bottom);

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${path} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const id = `fill-${label.toLowerCase()}`;

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto px-2 pt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[11rem] w-full min-w-[22rem] sm:h-[13rem]" aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3, 4].map((i) => {
            const v = step * i;
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={y(v) + 3.5}
                  textAnchor="end"
                  className="fill-[var(--muted-foreground)] text-[10px]"
                >
                  {v}
                </text>
              </g>
            );
          })}

          <path d={area} fill={`url(#${id})`} />
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={stroke} />
          ))}

          {months.map((m, i) =>
            // Every other label on a long range, or they collide.
            i % (months.length > 12 ? 3 : 2) === 0 ? (
              <text
                key={m}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-[var(--muted-foreground)] text-[10px]"
              >
                {m.slice(5)}/{m.slice(2, 4)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="border-border overflow-x-auto border-t">
        <table className="w-full text-[11px]">
          <caption className="sr-only">{label} at the end of each month</caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              {months.map((m) => (
                <th key={m} scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {values.map((v, i) => (
                <td key={i} className="tnum px-2 py-1.5 font-mono">
                  {v}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
