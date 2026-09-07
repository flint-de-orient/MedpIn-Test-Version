"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Member, PracticeDetail } from "@/lib/types";
import { PLAN_LABELS } from "@/lib/types";
import {
  Empty,
  Failed,
  Field,
  Loading,
  Panel,
  Pill,
  Stat,
  statusTone,
  verificationTone,
  when,
  fullWhen,
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
  | null;

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
          className="text-muted-foreground hover:text-foreground text-xs transition-colors"
        >
          ← Practices
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
              <Pill tone={statusTone(p.status)}>{p.status}</Pill>
              <Pill tone={verificationTone(p.verification)}>{p.verification}</Pill>
              {d.isFounding ? (
                <Pill tone="accent" className="uppercase">
                  founding
                </Pill>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {p.registrationNo ?? "no registration number"} · created{" "}
              <span title={fullWhen(p.createdAt)}>{when(p.createdAt)}</span>
            </p>
          </div>

          <button
            onClick={() => setEditing(true)}
            className="border-border hover:bg-secondary shrink-0 rounded-sm border px-3 py-1.5 text-[13px] font-medium transition-colors"
          >
            Edit details
          </button>
        </div>
      </div>

      {/* Decisions first. This is what the screen is opened for. */}
      <Panel
        title="Decisions"
        description="Verification says a doctor is who they claim. Status says whether the practice may operate. They are different facts, and neither implies the other."
      >
        <div className="flex flex-wrap gap-2 px-4 py-3.5">
          {p.verification !== "verified" ? (
            <Action
              onClick={() =>
                void act(
                  `/admin/practices/${p.id}/verification`,
                  { verification: "verified" },
                  "Marked verified",
                )
              }
              busy={busy}
            >
              Mark verified
            </Action>
          ) : null}

          {p.verification !== "rejected" ? (
            <Action onClick={() => setAsk({ kind: "reject", name: p.name })} busy={busy}>
              Reject
            </Action>
          ) : null}

          {p.status !== "active" ? (
            <Action
              primary
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
          ) : (
            <Action
              destructive
              onClick={() => setAsk({ kind: "suspend", name: p.name })}
              busy={busy}
            >
              Suspend
            </Action>
          )}
        </div>
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Staff" description="Who works here, and what each of them may do.">
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
                          <span className="truncate text-[13px] font-medium">{m.name}</span>
                          {m.isOwner ? <Pill tone="accent">owner</Pill> : null}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
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

          <Panel title="Locations" description="Where this practice sees patients.">
            {d.locations.length === 0 ? (
              <Empty
                title="No locations"
                hint="A practice with no location cannot take a booking — the slot engine has no diary to read."
              />
            ) : (
              <ul className="divide-border divide-y">
                {d.locations.map((l) => (
                  <li key={l.id} className="px-4 py-3">
                    <div className="text-[13px] font-medium">{l.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
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

          <Panel
            title="Departments"
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
                    <span className="text-[13px]">{dep.name}</span>
                    <span className="text-muted-foreground font-mono text-[11px]">
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
              <Stat value={d.usage.staff} label="Staff" />
              <Stat value={d.usage.locations} label="Locations" />
              <Stat value={d.usage.departments} label="Departments" />
            </div>
          </Panel>

          <Panel
            title="Plan"
            actions={
              <button
                onClick={() => setPlanning(true)}
                className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
              >
                Change
              </button>
            }
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4">
              <Field label="Plan">{PLAN_LABELS[p.plan]}</Field>
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
            </dl>
            <p className="text-muted-foreground border-border border-t px-4 py-3 text-xs leading-relaxed">
              A cap is a brake on growth, not a shredder. Lowering one below the
              current count stops the next registration and touches nothing that
              already exists. A lapsed date does not suspend anybody either —
              that stays a decision a person makes and this log records.
            </p>
          </Panel>

          {d.notes ? (
            <Panel title="Notes">
              <p className="px-4 py-3.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                {d.notes}
              </p>
            </Panel>
          ) : null}
        </div>
      </div>

      <ReasonDialog
        open={ask !== null}
        busy={busy}
        title={ask ? `${ask.kind === "reject" ? "Reject" : "Suspend"} ${ask.name}` : ""}
        why={
          ask?.kind === "reject"
            ? "Nobody at the practice sees this — it goes to the audit log. Write it for whoever asks in six months why this was refused."
            : "Staff will not be able to sign in. Patients keep their records, prescriptions and dose reminders — a suspension that silenced a diabetic's insulin alarm would punish the person who did nothing wrong."
        }
        confirmLabel={ask?.kind === "reject" ? "Reject" : "Suspend"}
        onCancel={() => setAsk(null)}
        onConfirm={(reason) =>
          ask?.kind === "reject"
            ? void act(
                `/admin/practices/${p.id}/verification`,
                { verification: "rejected", reason },
                "Rejected",
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={
        "rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-55 " +
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
