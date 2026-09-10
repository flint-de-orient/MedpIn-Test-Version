"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  PLAN_LABELS,
  SUBSCRIPTION_LABELS,
  type PlanRow,
  type SubscriptionRow,
  type Revenue,
  type SubscriptionCounts,
} from "@/lib/types";
import {
  Alert,
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  Stat,
  when,
} from "@/components/primitives";
import { LineChart } from "@/components/charts";
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
  const [counts, setCounts] = useState<SubscriptionCounts>({});
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [canPrice, setCanPrice] = useState(true);
  const [rev, setRev] = useState<Revenue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const out = await api<{
        subscriptions: SubscriptionRow[];
        counts: SubscriptionCounts;
      }>(`/admin/billing/subscriptions${status ? `?status=${status}` : ""}`);
      setRows(out.subscriptions);
      setCounts(out.counts ?? {});
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Same reasoning as the plans below: revenue depends on Razorpay prices,
    // and a failure there must not take the queue down with it.
    void (async () => {
      try {
        setRev(await api<Revenue>("/admin/billing/revenue"));
      } catch {
        setRev(null);
      }
    })();
  }, []);

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
        <h1 className="text-display font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-body">
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

      {rev && <RevenueSection rev={rev} />}

      <Panel
        title="Subscriptions"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => {
              const n = counts[s.key || "all"];
              // A chip for a state nothing is in is a button that can only
              // produce an empty table. "All" always shows, so a platform with
              // no subscriptions still has something to look at.
              if (s.key && !n) return null;

              return (
                <button
                  key={s.key || "all"}
                  type="button"
                  onClick={() => setStatus(s.key)}
                  className={cn(
                    "rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors",
                    status === s.key
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {s.label}
                  {n === undefined ? null : (
                    /*
                      Quieter than the label, because the count is the second
                      thing read and the state is the first — but by weight, not
                      by opacity. Dimming inherited muted-foreground to 60% put
                      it at 2.65:1 on a light ground, which is below the 4.5:1
                      text needs and below the 3:1 anything meaningful needs.
                      The palette's quiet grey is the floor; there is no step
                      under it that is still readable.
                    */
                    <span className="tnum ml-1.5 font-normal">{n}</span>
                  )}
                </button>
              );
            })}
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
              <p className="text-muted-foreground border-border border-b px-4 py-3 text-caption">
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

/**
 * What the platform earns.
 *
 * ---- Unknown reads as unknown ------------------------------------------
 *
 * Every money tile shows an em dash rather than 0 when the prices could not be
 * fetched, and the panel says why underneath. Zero would be the most damaging
 * possible wrong answer here: a revenue figure of nothing during a Razorpay
 * outage is indistinguishable from a business that has lost every customer, on
 * exactly the morning that is hardest to check.
 *
 * ---- Two numbers that are not the same thing --------------------------
 *
 * MRR is a projection: what active subscriptions would bill in a month.
 * "Collected" on the chart is a fact from the payment ledger. They are shown
 * apart and labelled apart, because a dashboard that blurs them is one where
 * nobody can tell a good month from an optimistic one.
 */
function RevenueSection({ rev }: { rev: Revenue }) {
  const months = rev.trend.map((t) => t.month);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat value={money(rev.mrr)} label="MRR" hint="active subscriptions, per month" />
        <Stat value={money(rev.arr)} label="ARR" hint="twelve times MRR" />
        <Stat
          value={rev.subscriptions.active.toLocaleString("en-IN")}
          label="Active"
          hint={`${rev.trials.toLocaleString("en-IN")} on trial`}
        />
        <Stat
          value={money(rev.arpu)}
          label="ARPU"
          hint="per active subscription"
          tone={rev.subscriptions.halted > 0 ? "waiting" : undefined}
        />
      </div>

      {!rev.pricesKnown && (
        <p className="text-muted-foreground text-caption leading-relaxed">
          Razorpay prices could not be read, so the money figures are unknown
          rather than zero. The counts above are unaffected.
        </p>
      )}

      <Panel
        title="Collected"
        description="Money actually taken, from the payment ledger &mdash; not a projection."
      >
        <LineChart
          months={months}
          values={rev.trend.map((t) => Math.round(t.collected / 100))}
          stroke="var(--primary)"
          label="Collected"
        />
      </Panel>

      <Panel title="Subscriptions started and cancelled">
        <LineChart
          months={months}
          values={rev.trend.map((t) => t.started)}
          stroke="var(--primary)"
          label="Started"
        />
        <div className="border-border border-t">
          <LineChart
            months={months}
            values={rev.trend.map((t) => t.cancelled)}
            stroke="var(--destructive)"
            label="Cancelled"
          />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Revenue by plan">
          {rev.revenueByPlan === null || rev.revenueByPlan.length === 0 ? (
            <Empty
              title={rev.pricesKnown ? "Nothing recurring yet" : "Prices unavailable"}
              hint={
                rev.pricesKnown
                  ? "Every practice is on a trial."
                  : "Razorpay could not be reached."
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {rev.revenueByPlan.map((r) => (
                <li key={r.plan} className="flex items-baseline justify-between px-4 py-3">
                  <span className="text-body">{PLAN_LABELS[r.plan] ?? r.plan}</span>
                  <span className="font-mono text-body">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Trial conversion"
          description="Practices that have ever had an active subscription."
        >
          <dl className="grid grid-cols-3 gap-4 px-4 py-4">
            <Fig label="Practices" value={rev.conversion.practices.toLocaleString("en-IN")} />
            <Fig label="Converted" value={rev.conversion.converted.toLocaleString("en-IN")} />
            {/* Null on an empty platform rather than NaN, which is where this
                starts and where a naive percentage would print garbage. */}
            <Fig
              label="Rate"
              value={rev.conversion.rate === null ? "—" : `${rev.conversion.rate}%`}
            />
          </dl>
        </Panel>
      </div>
    </>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-caption">{label}</dt>
      <dd className="mt-0.5 font-mono text-title">{value}</dd>
    </div>
  );
}

/** Paise to rupees, or an em dash where the figure is genuinely unknown. */
function money(paise: number | null): string {
  return paise === null ? "—" : rupees(paise);
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
              className="text-title font-medium hover:underline"
            >
              {row.practice.name}
            </Link>
          ) : (
            // A subscription whose practice is gone. Worth showing rather than
            // filtering out: it is money against nothing.
            <span className="text-muted-foreground text-title">Practice deleted</span>
          )}
          <div className="text-muted-foreground mt-0.5 font-mono text-caption">
            {row.providerSubscriptionId}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone}>{SUBSCRIPTION_LABELS[row.status] ?? row.status}</Pill>
          <span className="text-body">{PLAN_LABELS[row.plan] ?? row.plan}</span>
        </div>
      </div>

      <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 text-caption">
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
        <p className="text-destructive mt-2 text-caption">
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
          <span className="text-title font-medium">{PLAN_LABELS[row.plan] ?? row.plan}</span>
          {!row.sellable && (
            // Granted, not purchased. Worth saying, because its absence from
            // checkout otherwise looks like a bug.
            <Pill tone="muted">granted only</Pill>
          )}
        </div>
        <span className="font-mono text-body">
          {row.amount === null ? (
            <span className="text-muted-foreground">no price</span>
          ) : (
            `${rupees(row.amount)}${row.period ? ` / ${row.period.replace("ly", "")}` : ""}`
          )}
        </span>
      </div>

      <dl className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-caption">
        <Fact label="Patients" value={cap(row.limits.patients)} />
        {/* "People", because the cap counts doctors and the owner too. */}
        <Fact label="People" value={cap(row.limits.staff)} />
        <Fact label="Locations" value={cap(row.limits.locations)} />
        {/*
          What support pastes into Razorpay when a customer asks about a charge.
          The server has sent it since this panel existed and nothing showed it,
          so the one identifier the two systems share was the one an operator
          had to go and look up.
        */}
        {row.providerPlanId ? (
          <Fact label="Razorpay plan" value={row.providerPlanId} mono />
        ) : null}
      </dl>

      <p className="text-muted-foreground mt-2 text-caption leading-relaxed">
        {row.capabilities.length} capabilities:{" "}
        <span className="font-mono">{row.capabilities.join(", ").toLowerCase()}</span>
      </p>
    </li>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  /** For an identifier, where a character being wrong matters. */
  mono?: boolean;
}) {
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      <span className={cn("text-foreground", mono && "font-mono")}>{value}</span>
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
