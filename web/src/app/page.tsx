"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useAttention } from "@/components/attention";
import { MetricCard } from "@/components/metrics";
import {
  Alert,
  Empty,
  Failed,
  Loading,
  Panel,
  when,
  fullWhen,
} from "@/components/primitives";
import {
  IconAdmins,
  IconAlert,
  IconChevron,
  IconPatients,
  IconPin,
  IconPractice,
} from "@/components/icons";
import type { AuditPage, AuditRow, Overview } from "@/lib/types";
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
  const [recent, setRecent] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [over, list] = await Promise.all([
        api<Overview>("/admin/overview"),
        /*
         * What has been done here lately.
         *
         * This used to be the five newest practices, which on a platform that
         * gains one a month is a panel that never changes. The trail already
         * records a practice being created, so this is the same information
         * plus everything else somebody did — who suspended a practice an hour
         * ago being the question an operator actually arrives with.
         *
         * `kind=changes`, because reads outnumber the rest several to one and
         * a feed of "Ops opened the register" is a feed nobody reads twice.
         */
        api<AuditPage>("/admin/audit?kind=changes&limit=6"),
      ]);
      setO(over);
      setRecent(list.items);
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
        <h1 className="text-display font-semibold tracking-tight">
          {greeting()}
          {admin?.name ? `, ${admin.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1 text-caption">
          {attention === null
            ? "Checking what needs you…"
            : attention.length === 0
              ? "Nothing is waiting on a decision."
              : `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} your attention.`}
        </p>
      </header>

      <AttentionPanel items={attention} />

      {/*
        Every card leads somewhere, and only one of them leads to a list.

        Practices have a register, so "Active practices" opens it filtered to
        active. The other three have no list and must not grow one — there is no
        patient screen in this console, and its whole argument for living on its
        own host is that there is nothing here to read about anybody. So they
        open the growth chart on their own line, which answers what a trend
        actually asks: since when, and from what.
      */}
      <section className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Active practices"
          value={o?.practices.active ?? 0}
          movement={o?.trends.practices}
          /*
            The card this console exists for says more than the other three.
            `o.practices` already carries the whole status breakdown and only
            `.active` was ever read from it — so an operator had to open the
            register to learn that two practices were mid-onboarding.

            Zeroes are dropped rather than rendered. A platform with nothing
            suspended should not carry a line saying "Suspended 0"; the absence
            is the same information and one less thing to read.
          */
          breakdown={
            o
              ? [
                  { label: "Onboarding", value: o.practices.onboarding ?? 0 },
                  { label: "Suspended", value: o.practices.suspended ?? 0 },
                ].filter((b) => b.value > 0)
              : undefined
          }
          icon={<IconPractice className="size-4" />}
          href="/practices/?status=active"
          to="the active practices"
        />
        <MetricCard
          label="Patients"
          value={o?.activeEnrolments ?? 0}
          movement={o?.trends.patients}
          icon={<IconPatients className="size-4" />}
          href="/analytics/?line=patients"
          to="patient growth over time"
        />
        <MetricCard
          label="Staff"
          value={o?.staff ?? 0}
          movement={o?.trends.staff}
          icon={<IconAdmins className="size-4" />}
          href="/analytics/?line=staff"
          to="staff growth over time"
        />
        <MetricCard
          label="Locations"
          value={o?.locations ?? 0}
          movement={o?.trends.locations}
          icon={<IconPin className="size-4" />}
          href="/analytics/?line=locations"
          to="location growth over time"
        />
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Recent activity"
          description="What has been done here, newest first."
          actions={
            <Link
              href="/audit/?kind=changes"
              className="text-primary text-caption underline underline-offset-4"
            >
              Full audit trail
            </Link>
          }
        >
          {recent === null ? (
            <div className="divide-border divide-y">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="bg-muted h-3 w-48 animate-pulse rounded-sm" />
                  <div className="bg-muted ml-auto h-3 w-14 animate-pulse rounded-sm" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <Empty
              title="Nothing has been done yet"
              hint="Creating a practice is the first thing that will appear here."
              action={
                <Link
                  href="/practices/"
                  className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 text-caption font-medium"
                >
                  Add the first practice
                </Link>
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-body">
                    <Did row={r} />
                  </span>
                  <span
                    className="text-muted-foreground tnum shrink-0 text-caption"
                    title={fullWhen(r.at)}
                  >
                    {when(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="By plan" description="What every practice is on.">
          {o ? (
            <ul className="divide-border divide-y">
              {(["trial", "essential", "professional", "enterprise"] as const).map((k) => {
                const n = o.plans[k] ?? 0;

                // A row reading nought leads to a list of nothing. It stays a
                // row, because a plan with no practices on it is a fact worth
                // seeing, and it stops being a link because there is nothing
                // behind it to open.
                if (n === 0) {
                  return (
                    <li
                      key={k}
                      className="text-muted-foreground flex items-center justify-between px-4 py-2.5 text-body"
                    >
                      <span className="capitalize">{k}</span>
                      <span className="tnum font-mono text-caption">0</span>
                    </li>
                  );
                }

                return (
                  <li key={k}>
                    <Link
                      href={`/practices/?plan=${k}`}
                      className="hover:bg-secondary/50 group flex items-center justify-between px-4 py-2.5 text-body transition-colors"
                    >
                      <span className="capitalize">{k}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tnum font-mono text-caption">{n}</span>
                        <IconChevron className="text-muted-foreground group-hover:text-primary size-3 transition-colors" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-8" />
          )}
          <p className="text-muted-foreground border-border border-t px-4 py-3 text-micro leading-relaxed">
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
  // Loading, not empty. Rendering nothing here made a slow request look
  // identical to "nothing needs you", which is the one thing this panel exists
  // to distinguish.
  if (items === null) return <Loading rows={2} />;

  if (items.length === 0) {
    return (
      <Alert tone="ok" title="Nothing is waiting on you">
        No application is waiting, every practice is decided, and every administrator has a
        second factor.
      </Alert>
    );
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <header className="border-border flex items-center gap-2 border-b px-4 py-2.5">
        <IconAlert className="text-waiting size-4" />
        <h2 className="text-body font-semibold tracking-tight">Action required</h2>
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
                <p className="text-body font-medium">{it.title}</p>
                <p className="text-muted-foreground mt-0.5 text-caption leading-relaxed">
                  {it.detail}
                </p>
              </div>
              <Link
                href={it.href}
                className="border-border hover:bg-secondary shrink-0 rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
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

/**
 * One entry, as a sentence.
 *
 * `admin.practice.plan` is the log's own vocabulary and belongs on the trail,
 * where a column of it is scannable and exact. Six of them stacked in a narrow
 * panel is not a summary of anything.
 *
 * Every verb is mapped by hand and anything unmapped falls through to the raw
 * action, so a route added next week reads awkwardly rather than silently
 * describing itself as something it is not.
 */
const DID: Record<string, string> = {
  "admin.practice.create": "created",
  "admin.practice.edit": "edited",
  "admin.practice.plan": "changed the plan for",
  "admin.practice.trial.extend": "extended the trial for",
  "admin.practice.verified": "verified",
  "admin.member.update": "changed a membership at",
  "admin.subscription.pause": "paused the subscription for",
  "admin.subscription.resume": "resumed the subscription for",
  "admin.subscription.grace": "granted grace to",
  "admin.admin.create": "added an administrator",
  "admin.admin.update": "changed an administrator",
  "admin.totp.enabled": "turned on their authenticator",
  "admin.totp.disabled": "turned off their authenticator",
  "admin.passkey.added": "added a passkey",
  "admin.passkey.removed": "removed a passkey",
  "admin.login": "signed in",
  "admin.logout": "signed out",
};

function Did({ row }: { row: AuditRow }) {
  const verb = DID[row.action];
  // The account, not the person: the log records an email and inventing a
  // display name from it would be a name nobody chose.
  const who = row.admin.split("@")[0];

  return (
    <>
      <span className="font-medium">{who}</span>{" "}
      {verb ? (
        <span className="text-muted-foreground">{verb}</span>
      ) : (
        <span className="text-muted-foreground font-mono text-caption">{row.action}</span>
      )}{" "}
      {row.practice ? (
        row.practice.name ? (
          <Link
            href={`/practices/?id=${row.practice.id}`}
            className="hover:text-primary underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
          >
            {row.practice.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">a practice since deleted</span>
        )
      ) : null}
    </>
  );
}
