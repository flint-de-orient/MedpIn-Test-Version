"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Member, PracticeDetail } from "@/lib/types";
import { PERMISSION_LABELS, PLAN_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Alert,
  Empty,
  Failed,
  Field,
  Info,
  Loading,
  Panel,
  Pill,
  Stat,
  fullWhen,
  statusTone,
  verificationTone,
  when,
} from "@/components/primitives";
import { ReasonDialog } from "@/components/form";
import { PlanDialog } from "@/components/plan-dialog";
import { MemberDialog } from "@/components/member-dialog";
import { EditPracticeDialog } from "@/components/edit-practice";
import { PracticeRegister } from "@/components/practice-register";

/**
 * One route, two screens.
 *
 * `/practices/` is the register; `/practices/?id=…` is one practice. A static
 * export cannot pre-render `/practices/[id]` without knowing every id at build
 * time, and a console whose URLs are fixed at build time is a console that
 * cannot show a practice created afterwards.
 *
 * A query parameter costs nothing an operator can see and keeps every link
 * shareable, which a client-only route would not.
 */
export default function Page() {
  // `useSearchParams` suspends, and a static export has no server to fall back
  // on — without this the whole route fails to prerender.
  return (
    <Suspense fallback={<Loading rows={5} />}>
      <Switch />
    </Suspense>
  );
}

function Switch() {
  const id = useSearchParams().get("id");
  return id ? <Detail /> : <PracticeRegister />;
}

type Ask =
  | { kind: "reject"; name: string }
  | { kind: "suspend"; name: string }
  | { kind: "reinstate"; name: string }
  | null;

/**
 * What each decision that needs a reason is called and says.
 *
 * A reinstatement joined suspending and rejecting: "reinstated" with nothing
 * beside it cannot tell a review whether whatever caused the suspension was
 * resolved or forgotten. The server refuses one without a reason.
 */
const ASKS = {
  reject: {
    verb: "Reject",
    why: "Nobody at the practice sees this — it goes to the audit log. Write it for whoever asks in six months why this was refused.",
  },
  suspend: {
    verb: "Suspend",
    why: "From their next request its staff are refused everything in this practice except seeing that it is suspended. Patients keep their records, prescriptions and dose reminders, and nothing is deleted.",
  },
  reinstate: {
    verb: "Reinstate",
    why: "Its staff can work again from their next request. Say what was resolved — this goes to the audit log beside the suspension.",
  },
} as const;

function Detail() {
  const id = useSearchParams().get("id");
  const [d, setD] = useState<PracticeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [member, setMember] = useState<Member | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setD(await api<PracticeDetail>(`/admin/practices/${id}`));
    } catch (ex) {
      setError((ex as ApiError).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (path: string, body: unknown, done: string) => {
      setBusy(true);
      try {
        await api(path, { method: "POST", body });
        toast.success(done);
        setAsk(null);
        await load();
      } catch (ex) {
        toast.error((ex as ApiError).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (error) return <Failed message={error} retry={() => void load()} />;
  if (!d) return <Loading rows={5} />;

  const p = d.practice;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/practices/"
          className="text-muted-foreground hover:text-foreground text-caption transition-colors"
        >
          ← Practices
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display font-semibold tracking-tight">{p.name}</h1>
              {/* What kind of thing this is. Absent on every practice created
                  before types existed, and absent is not "unknown-and-broken" —
                  it is unclassified, which the capability resolver reads as
                  unrestricted. So it renders as nothing rather than as a gap. */}
              {p.practiceType ? (
                <Pill tone="muted" className="capitalize">
                  {p.practiceType.replace(/_/g, " ")}
                </Pill>
              ) : null}
              {p.specialty ? (
                <Pill tone="accent" className="capitalize">
                  {p.specialty.replace(/_/g, " ")}
                </Pill>
              ) : null}
              {d.isFounding ? (
                <Pill tone="accent" className="uppercase">
                  founding
                </Pill>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-caption">
              {/* Was p.registrationNo alone, which is blank on most solo
                  practices because the number is the doctor's. It read as
                  "nothing on file" for practices that were fine. */}
              {d.registration ? (
                <span title={`On ${d.registration.where}`}>{d.registration.number}</span>
              ) : (
                "no registration number"
              )}{" "}
              · created <span title={fullWhen(p.createdAt)}>{when(p.createdAt)}</span>
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            {/*
              What has been done to this practice, and by whom.

              The audit endpoint has taken a practice filter since it was
              written and nothing sent it, so the answer existed and the way to
              ask for it was to copy an id out of the URL and into another
              screen — which is to say it was not answerable. It is a link
              rather than a panel here because the trail has paging, filters and
              a diff column already, and a second half-built copy of it on this
              page would be the one that goes stale.
            */}
            <Link
              href={`/audit/?practice=${p.id}`}
              className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-body font-medium transition-colors"
            >
              History
            </Link>
            <button
              onClick={() => setEditing(true)}
              className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-body font-medium transition-colors"
            >
              Edit details
            </button>
          </div>
        </div>
      </div>

      {/*
        Decisions first. This is what the screen is opened for.

        ---- The bottom of this card is buttons and nothing else -----------

        It used to be a paragraph defining two words, then an amber block of
        prose, then the buttons. By the time somebody reached the row they had
        read a definition they already knew and a warning about a field, and
        the four things they came to do were below the fold on a phone.

        The definitions are now behind the two words they define, opened by
        whoever does not know them and invisible to whoever does. The warning
        is one line. What is left above the buttons is the state, in a row.
      */}
      {/*
        What this practice has, before scrolling to find out.

        The reference for this screen used tabs carrying counts —
        "Locations (3) · Departments (6) · People (42)" — and the count is the
        useful half: it answers "does this practice even have departments"
        without opening anything.
        
        Tabs are not, because the panel directly below is the one this screen
        exists for. Its own note says so: decisions first, and everything
        beneath is context for them. Putting Decisions behind a tab would hide
        the four buttons an operator came to press. So the counts sit in a jump
        bar and the sections stay on one page, which also keeps them printable
        and searchable with the browser's own find.
      */}
      <nav
        aria-label="Sections of this practice"
        className="border-border bg-card flex flex-wrap items-center gap-x-1 gap-y-1 rounded-md border px-2 py-1.5"
      >
        {[
          { id: "staff", label: "Staff", n: d.members.length },
          { id: "locations", label: "Locations", n: d.locations.length },
          { id: "departments", label: "Departments", n: d.departments.length },
          { id: "capabilities", label: "Can do", n: d.capabilities.filter((c) => c.has).length },
        ].map((sec) => (
          <a
            key={sec.id}
            href={`#${sec.id}`}
            className="hover:bg-secondary rounded-sm px-2.5 py-1 text-caption font-medium transition-colors"
          >
            {sec.label}
            <span className="text-muted-foreground tnum ml-1.5 font-normal">{sec.n}</span>
          </a>
        ))}
      </nav>

      <Panel title="Decisions">
        <div className="border-border flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-caption">
          <Info
            term={
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Verification</span>
                <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
              </span>
            }
          >
            Whether somebody has checked this doctor&apos;s registration number
            against the medical council register. It says nothing about whether the
            practice may operate.
          </Info>

          <Info
            term={
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Status</span>
                <Pill tone={statusTone(p.status)}>{p.status}</Pill>
              </span>
            }
          >
            Whether the practice&apos;s staff may work in it. A suspended
            practice&apos;s staff can sign in only to see that it is suspended;
            its patients keep their own records. A practice can be active and
            unverified, which is the honest state of one that is running while
            its paperwork is checked.
          </Info>
        </div>

        {!d.registration ? (
          <Alert
            title="No registration number"
            className="mx-4 mt-3.5"
            action={
              <button
                onClick={() => setEditing(true)}
                className="border-border bg-card hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
              >
                Add one
              </button>
            }
          >
            Nothing to check against a register, so this cannot be verified.
          </Alert>
        ) : null}

        {/* Strictly actions, in weight order: the one to do, the ones to
            think about, and the one that stops a clinic working. */}
        <div className="flex flex-wrap gap-2 px-4 py-3.5">
          {p.verification !== "verified" ? (
            <Action
              primary
              onClick={() =>
                void act(
                  `/admin/practices/${p.id}/verification`,
                  { verification: "verified" },
                  "Marked verified",
                )
              }
              busy={busy}
              // The server refuses this with no number on file. Offering it
              // anyway and explaining afterwards makes the operator find out
              // by being told no.
              disabled={!d.registration}
              title={
                d.registration
                  ? `Check ${d.registration.number} against the council register first`
                  : "Nothing to check — no registration number on this practice, its doctors or its locations"
              }
            >
              Mark verified
            </Action>
          ) : null}

          {p.status === "onboarding" ? (
            <Action
              primary={p.verification === "verified"}
              onClick={() =>
                void act(
                  `/admin/practices/${p.id}/status`,
                  { status: "active" },
                  "Activated",
                )
              }
              busy={busy}
            >
              Activate
            </Action>
          ) : null}

          {/* Its own action rather than Activate: bringing back a practice
              somebody stopped is a decision with a reason, and the server
              refuses it without one. */}
          {p.status === "suspended" ? (
            <Action
              primary={p.verification === "verified"}
              onClick={() => setAsk({ kind: "reinstate", name: p.name })}
              busy={busy}
            >
              Reinstate
            </Action>
          ) : null}

          <span className="ml-auto flex flex-wrap gap-2">
            {p.verification !== "rejected" ? (
              <Action
                destructive
                onClick={() => setAsk({ kind: "reject", name: p.name })}
                busy={busy}
              >
                Reject
              </Action>
            ) : null}

            {p.status === "active" ? (
              <Action
                destructive
                onClick={() => setAsk({ kind: "suspend", name: p.name })}
                busy={busy}
              >
                Suspend
              </Action>
            ) : null}
          </span>
        </div>
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            id="staff"
            title="Staff"
            count={d.members.length}
            description="Who works here, and what each of them may do."
          >
            {d.members.length === 0 ? (
              <Empty
                title="Nobody has joined yet"
                hint="Staff join through the clinic's own invite flow, where the phone number is verified and somebody at the practice vouches for them."
              />
            ) : (
              <ul className="divide-border divide-y">
                {d.members.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => setMember(m)}
                      className="hover:bg-secondary/50 flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-body font-medium">{m.name}</span>
                          {m.isOwner ? <Pill tone="accent">owner</Pill> : null}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-caption">
                          <span className="capitalize">{m.role.toLowerCase()}</span>
                          {m.phone ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="font-mono tnum">{m.phone}</span>
                            </>
                          ) : null}
                          <span aria-hidden>·</span>
                          <span className="tnum">
                            {m.permissions.length} permission
                            {m.permissions.length === 1 ? "" : "s"}
                            {m.usingPreset ? " (role default)" : ""}
                          </span>
                        </div>
                      </div>
                      <Pill
                        tone={
                          m.status === "active"
                            ? "ok"
                            : m.status === "invited"
                              ? "waiting"
                              : "stopped"
                        }
                      >
                        {m.status}
                      </Pill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            id="locations"
            title="Locations"
            count={d.locations.length}
            description="Where this practice sees patients."
          >
            {d.locations.length === 0 ? (
              <Empty
                title="No locations"
                hint="A practice with no location cannot take a booking — the slot engine has no diary to read."
              />
            ) : (
              <ul className="divide-border divide-y">
                {d.locations.map((l) => (
                  <li key={l.id} className="px-4 py-3">
                    <div className="text-body font-medium">{l.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-caption">
                      {[l.addressLine, l.city].filter(Boolean).join(", ") ||
                        "no address on file"}
                      {l.phone ? (
                        <>
                          {" · "}
                          <span className="font-mono tnum">{l.phone}</span>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/*
            What this practice can do, and what is stopping the rest.

            Reported by the same resolver the app is answered from, so this
            cannot disagree with what a doctor sees. It exists because the
            console let an operator set a type and a plan and showed neither
            the result nor the reasoning: `DEPARTMENT` clears three independent
            gates, the app draws nothing when any one fails, and the only way
            to find out which was to read two tables in capabilities.js.
          */}
          <Panel
            id="capabilities"
            title="What this practice can do"
            description="Resolved from the type and the plan together. A member also needs the permission beside anything marked."
          >
            <ul className="divide-border divide-y">
              {d.capabilities.map((c) => (
                <li
                  key={c.capability}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 font-mono text-caption",
                      !c.has && "text-muted-foreground",
                    )}
                  >
                    {c.capability}
                  </span>

                  {c.has ? (
                    <>
                      {/*
                        The commonest reason a section is on one person's
                        screen and not another's, and the one that is a
                        conversation with the practice rather than a sale.
                      */}
                      {c.needsPermission ? (
                        <span className="text-muted-foreground text-micro">
                          needs {PERMISSION_LABELS[c.needsPermission] ?? c.needsPermission}
                        </span>
                      ) : null}
                      <Pill tone="ok">on</Pill>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground text-micro">
                        {c.blockedBy === "type"
                          ? `not something a ${(p.practiceType ?? "practice").replace(/_/g, " ")} has`
                          : c.blockedBy === "plan"
                            ? `not on ${PLAN_LABELS[p.plan] ?? p.plan}`
                            : "off"}
                      </span>
                      <Pill tone="muted">off</Pill>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            id="departments"
            title="Departments"
            count={d.departments.length}
            description="Each one can carry its own AI assistant. A department with no scope has no assistant — never a general one."
          >
            {d.departments.length === 0 ? (
              <Empty
                title="No departments"
                hint="The practice runs as a single list. That is the correct shape for a solo practice."
              />
            ) : (
              <ul className="divide-border flex flex-wrap gap-2 px-4 py-3.5">
                {d.departments.map((dep) => (
                  <li
                    key={dep.id}
                    className="border-border flex items-center gap-2 rounded-sm border px-2.5 py-1.5"
                  >
                    <span className="text-body">{dep.name}</span>
                    <span className="text-muted-foreground font-mono text-micro">
                      {dep.key}
                    </span>
                    {dep.hasAssistant ? (
                      <Pill tone="ok">assistant</Pill>
                    ) : (
                      <Pill tone="muted">no assistant</Pill>
                    )}
                    {!dep.isActive ? <Pill tone="stopped">off</Pill> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Usage">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4">
              <Stat
                value={d.usage.patients}
                label="Patients"
                hint={
                  p.limits.patients === null
                    ? "no cap"
                    : `of ${p.limits.patients}`
                }
                tone={
                  p.limits.patients !== null && d.usage.patients >= p.limits.patients
                    ? "waiting"
                    : undefined
                }
              />
              <Stat
                value={d.usage.patientsEver}
                label="Ever"
                hint="including revoked"
              />
              {/* Patients and Ever are counts of people this console cannot
                  list and should not learn how to. The other three are the
                  headline of a panel further down the page — the same fact
                  twice, a screenful apart once the columns stack. */}
              <Stat value={d.usage.staff} label="Staff" jumpTo="staff" />
              <Stat value={d.usage.locations} label="Locations" jumpTo="locations" />
              <Stat
                value={d.usage.departments}
                label="Departments"
                jumpTo="departments"
              />
            </div>
          </Panel>

          <Panel
            title="Plan"
            actions={
              <button
                onClick={() => setPlanning(true)}
                className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
              >
                Change
              </button>
            }
          >
            {d.subscription?.disagrees && (
              <div className="px-4 pt-4">
                <Alert tone="stopped" title="Paying for a different plan">
                  Razorpay is billing {PLAN_LABELS[d.subscription.plan] ??
                    d.subscription.plan}{" "}
                  and this practice is on {PLAN_LABELS[p.plan]} — either a delivery
                  was missed or somebody changed it here.
                </Alert>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4">
              <Field label="Plan">{PLAN_LABELS[p.plan]}</Field>
              {/*
                Where the plan came from, which the plan name no longer says on
                its own: an operator can set it here and the webhook can set it
                too. "Granted" is the honest word for a practice nobody is
                billing — it is not a failure, it is most of them.
              */}
              <Field label="Billing">
                {d.subscription
                  ? `${d.subscription.status} · ${PLAN_LABELS[d.subscription.plan] ?? d.subscription.plan}`
                  : "granted, not billed"}
              </Field>
              <Field label="Renews" mono>
                {p.planRenewsOn ? when(p.planRenewsOn) : "open-ended"}
              </Field>
              <Field label="Patient cap" mono>
                {p.limits.patients ?? "none"}
              </Field>
              <Field label="Staff cap" mono>
                {p.limits.staff ?? "none"}
              </Field>
              <Field label="Location cap" mono>
                {p.limits.locations ?? "none"}
              </Field>
              {d.subscription && (
                <>
                  {/* What an operator pastes into Razorpay when a customer
                      asks about a charge. Without it the two systems share no
                      visible key. */}
                  <Field label="Razorpay id" mono>
                    {d.subscription.providerSubscriptionId}
                  </Field>
                  {/* How old the provider's last word is. A row nothing has
                      confirmed looks healthy for ever otherwise. */}
                  <Field label="Confirmed" mono>
                    {d.subscription.confirmedAt
                      ? when(d.subscription.confirmedAt)
                      : "never"}
                  </Field>
                </>
              )}
            </dl>
            <p className="text-muted-foreground border-border border-t px-4 py-3 text-caption leading-relaxed">
              A cap is a brake on growth, not a shredder. Lowering one below the
              current count stops the next registration and touches nothing that
              already exists. A lapsed date does not suspend anybody either —
              that stays a decision a person makes and this log records.
            </p>
          </Panel>

          {d.notes ? (
            <Panel title="Notes">
              <p className="px-4 py-3.5 text-body leading-relaxed whitespace-pre-wrap">
                {d.notes}
              </p>
            </Panel>
          ) : null}
        </div>
      </div>

      <ReasonDialog
        open={ask !== null}
        busy={busy}
        title={ask ? `${ASKS[ask.kind].verb} ${ask.name}` : ""}
        why={ask ? ASKS[ask.kind].why : ""}
        confirmLabel={ask ? ASKS[ask.kind].verb : ""}
        destructive={ask?.kind !== "reinstate"}
        onCancel={() => setAsk(null)}
        onConfirm={(reason) =>
          ask?.kind === "reject"
            ? void act(
                `/admin/practices/${p.id}/verification`,
                { verification: "rejected", reason },
                "Rejected",
              )
            : ask?.kind === "reinstate"
              ? void act(
                  `/admin/practices/${p.id}/status`,
                  { status: "active", reason },
                  "Reinstated",
                )
              : void act(
                  `/admin/practices/${p.id}/status`,
                  { status: "suspended", reason },
                  "Suspended",
                )
        }
      />

      <EditPracticeDialog
        open={editing}
        practice={p}
        notes={d.notes}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          toast.success("Details updated");
          void load();
        }}
      />

      <PlanDialog
        open={planning}
        practice={p}
        usage={d.usage}
        subscription={d.subscription}
        onClose={() => setPlanning(false)}
        onSaved={() => {
          setPlanning(false);
          toast.success("Plan updated");
          void load();
        }}
      />

      <MemberDialog
        member={member}
        practiceId={p.id}
        onClose={() => setMember(null)}
        onSaved={() => {
          setMember(null);
          toast.success("Membership updated");
          void load();
        }}
      />
    </div>
  );
}

function Action({
  children,
  onClick,
  busy,
  primary,
  destructive,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  destructive?: boolean;
  /**
   * Unavailable for a reason of its own, as distinct from busy.
   *
   * Always pass `title` with it. A greyed control that will not say why is
   * worse than one that fails on click, because there is nothing to read and
   * nothing to do about it.
   */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      title={title}
      className={
        "rounded-sm px-3 py-1.5 text-body font-medium transition-colors " +
        "disabled:cursor-not-allowed disabled:opacity-55 " +
        (primary
          ? "bg-primary text-primary-foreground"
          : destructive
            ? "border-stopped/40 text-stopped hover:bg-stopped-tint border"
            : "border-border hover:bg-secondary border")
      }
    >
      {children}
    </button>
  );
}
