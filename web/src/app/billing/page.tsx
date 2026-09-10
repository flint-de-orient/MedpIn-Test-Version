"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  PLAN_LABELS,
  SUBSCRIPTION_LABELS,
  type PlanRow,
  type SubscriptionRow,
} from "@/lib/types";
import { Alert, Empty, Failed, Loading, Panel, Pill, when } from "@/components/primitives";
import { cn } from "@/lib/utils";

/**
 * Who is paying, and what for.
 *
 * ---- The list is a queue, not a report ----------------------------------
 *
 * An unfiltered list of every subscription is neither a support queue nor a
 * revenue figure. The useful views are narrow — "who has a payment failing" is
 * something somebody acts on this morning — so the filter is the first control
 * and `halted` is one click away.
 *
 * ---- The plans panel is a reading -------------------------------------
 *
 * There is no "New plan" here and there should not be. A tier is an enum entry
 * that gates capabilities and an immutable object in Razorpay; a row written
 * from a web form would be a plan the resolver has never heard of, and unknown
 * means unrestricted everywhere in this codebase. What the panel is for is the
 * question support actually gets: what does Professional include, and what does
 * it cost.
 */

const STATUSES = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "halted", label: "Payment failed" },
  { key: "pending", label: "Retrying" },
  { key: "paused", label: "Paused" },
  { key: "cancelled", label: "Cancelled" },
];

export default function Billing() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [canPrice, setCanPrice] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const out = await api<{ subscriptions: SubscriptionRow[] }>(
        `/admin/billing/subscriptions${status ? `?status=${status}` : ""}`,
      );
      setRows(out.subscriptions);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Separate from the list on purpose: a Razorpay outage should cost the
    // price column and not the queue somebody came here to work.
    void (async () => {
      try {
        const out = await api<{ plans: PlanRow[]; canPrice: boolean }>("/admin/billing/plans");
        setPlans(out.plans);
        setCanPrice(out.canPrice);
      } catch {
        setPlans([]);
      }
    })();
  }, []);

  const disagreeing = (rows ?? []).filter((r) => r.disagrees);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Every subscription on the platform. Plans and prices are read-only —
          a tier is a deploy and a price is a new Razorpay plan.
        </p>
      </header>

      {disagreeing.length > 0 && (
        <Alert tone="stopped" title="Paying for a different plan">
          {disagreeing.length === 1
            ? `${disagreeing[0].practice?.name ?? "One practice"} is billed for a plan it is not on.`
            : `${disagreeing.length} practices are billed for a plan they are not on.`}
        </Alert>
      )}

      <Panel
        title="Subscriptions"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s.key || "all"}
                type="button"
                onClick={() => setStatus(s.key)}
                className={cn(
                  "rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors",
                  status === s.key
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <Failed message={error} retry={load} />
        ) : rows === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty
            title={status ? "Nothing in this state" : "No subscriptions yet"}
            // Informative rather than apologetic: on a platform where every
            // practice is on a trial, an empty list is the correct answer.
            hint={
              status
                ? "Try another filter."
                : "Practices are on trials until somebody completes a checkout."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((r) => (
              <SubscriptionItem key={r.id} row={r} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Plans">
        {plans === null ? (
          <Loading rows={2} />
        ) : (
          <>
            {!canPrice && (
              // Said rather than left blank. Every price missing looks like a
              // broken page unless the page explains itself.
              <p className="text-muted-foreground border-border border-b px-4 py-3 text-xs">
                Razorpay is not configured on this server, so no prices can be
                shown. The capabilities and limits below are still what a
                practice on each tier gets.
              </p>
            )}
            <ul className="divide-border divide-y">
              {plans.map((p) => (
                <PlanItem key={p.plan} row={p} />
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

function SubscriptionItem({ row }: { row: SubscriptionRow }) {
  const tone =
    row.status === "active"
      ? "ok"
      : row.status === "halted"
        ? "stopped"
        : row.status === "pending"
          ? "waiting"
          : "muted";

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {row.practice ? (
            <Link
              href={`/practices/?id=${row.practice.id}`}
              className="text-[14px] font-medium hover:underline"
            >
              {row.practice.name}
            </Link>
          ) : (
            // A subscription whose practice is gone. Worth showing rather than
            // filtering out: it is money against nothing.
            <span className="text-muted-foreground text-[14px]">Practice deleted</span>
          )}
          <div className="text-muted-foreground mt-0.5 font-mono text-xs">
            {row.providerSubscriptionId}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone}>{SUBSCRIPTION_LABELS[row.status] ?? row.status}</Pill>
          <span className="text-[13px]">{PLAN_LABELS[row.plan] ?? row.plan}</span>
        </div>
      </div>

      <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {row.pendingPlan && (
          // A downgrade asked for and not landed. The practice still has the
          // larger tier, and this is the only place that says so.
          <Fact
            label="Changing to"
            value={`${PLAN_LABELS[row.pendingPlan] ?? row.pendingPlan}${
              row.currentPeriodEnd ? ` on ${when(row.currentPeriodEnd)}` : " at period end"
            }`}
          />
        )}
        <Fact
          label="Confirmed"
          // "Never" rather than a blank: a row no webhook has touched looks
          // healthy forever otherwise.
          value={row.confirmedAt ? when(row.confirmedAt) : "never"}
        />
        {row.graceEndsAt && <Fact label="Grace ends" value={when(row.graceEndsAt)} />}
        <Fact label="Started" value={when(row.createdAt)} />
      </dl>

      {row.disagrees && (
        <p className="text-destructive mt-2 text-xs">
          Billed for {PLAN_LABELS[row.plan] ?? row.plan}; the practice is on{" "}
          {PLAN_LABELS[row.practice!.plan] ?? row.practice!.plan}.
        </p>
      )}
    </li>
  );
}

function PlanItem({ row }: { row: PlanRow }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">{PLAN_LABELS[row.plan] ?? row.plan}</span>
          {!row.sellable && (
            // Granted, not purchased. Worth saying, because its absence from
            // checkout otherwise looks like a bug.
            <Pill tone="muted">granted only</Pill>
          )}
        </div>
        <span className="font-mono text-[13px]">
          {row.amount === null ? (
            <span className="text-muted-foreground">no price</span>
          ) : (
            `${rupees(row.amount)}${row.period ? ` / ${row.period.replace("ly", "")}` : ""}`
          )}
        </span>
      </div>

      <dl className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Fact label="Patients" value={cap(row.limits.patients)} />
        {/* "People", because the cap counts doctors and the owner too. */}
        <Fact label="People" value={cap(row.limits.staff)} />
        <Fact label="Locations" value={cap(row.limits.locations)} />
      </dl>

      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {row.capabilities.length} capabilities:{" "}
        <span className="font-mono">{row.capabilities.join(", ").toLowerCase()}</span>
      </p>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground/70">{label}: </span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

/** Null is unlimited and must never render as 0 — see the app's meters. */
function cap(n: number | null): string {
  return n === null ? "no limit" : n.toLocaleString("en-IN");
}

/** Paise to rupees, grouped the Indian way. */
function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${(Number.isInteger(r) ? r : Number(r.toFixed(2))).toLocaleString("en-IN")}`;
}
