"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Field, Panel, Pill, when, fullWhen } from "@/components/primitives";
import { textInput } from "@/components/form";
import { cn } from "@/lib/utils";

type Stage = "off" | "enrolling" | "on";

export default function Account() {
  const { admin, refresh } = useSession();
  const [stage, setStage] = useState<Stage>("off");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStage(admin?.totpEnabled ? "on" : "off");
  }, [admin?.totpEnabled]);

  if (!admin) return null;

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      const out = await api<{ secret: string }>("/admin/me/totp/setup", {
        method: "POST",
      });
      setSecret(out.secret);
      setCode("");
      setStage("enrolling");
    } catch (ex) {
      toast.error((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!/^\d{6}$/.test(code)) return setError("Six digits from the app.");
    setBusy(true);
    setError(null);
    try {
      await api("/admin/me/totp/enable", { method: "POST", body: { totp: code } });
      await refresh();
      setSecret("");
      setCode("");
      toast.success("Two-factor is on");
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!/^\d{6}$/.test(code)) return setError("Six digits from the app.");
    setBusy(true);
    setError(null);
    try {
      await api("/admin/me/totp/disable", { method: "POST", body: { totp: code } });
      await refresh();
      setCode("");
      toast.success("Two-factor is off");
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          Signed in as <span className="font-mono">{admin.email}</span>
        </p>
      </div>

      <Panel title="You">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-3">
          <Field label="Name">{admin.name || "—"}</Field>
          <Field label="Email" mono>
            {admin.email}
          </Field>
          <Field label="Last sign-in">
            <span title={fullWhen(admin.lastLoginAt)}>
              {admin.lastLoginAt ? when(admin.lastLoginAt) : "This is the first one."}
            </span>
          </Field>
        </dl>
      </Panel>

      <Panel
        title="Two-factor"
        description={
          stage === "on"
            ? "On. A code from your authenticator app is needed at every sign-in."
            : stage === "enrolling"
              ? "Not on yet — finish by entering a code from the app."
              : "Off. Your password is the only thing protecting this account."
        }
        actions={stage === "on" ? <Pill tone="ok">on</Pill> : <Pill tone="waiting">off</Pill>}
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          {stage === "off" ? (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                An authenticator app on your phone — Google Authenticator, Aegis,
                1Password, any of them. Nothing is sent by SMS: a code that arrives
                as a text is a code your mobile operator can be talked into
                redirecting.
              </p>
              <button
                onClick={() => void begin()}
                disabled={busy}
                className="bg-primary text-primary-foreground w-fit rounded-sm px-3 py-2 text-[13px] font-medium disabled:opacity-55"
              >
                Set up two-factor
              </button>
            </>
          ) : null}

          {stage === "enrolling" ? (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                In your authenticator app choose <em>enter a setup key</em>, then type
                this. It is shown once.
              </p>

              <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-sm border border-dashed px-3 py-3">
                <code className="tnum font-mono text-sm break-all select-all">
                  {(secret.match(/.{1,4}/g) ?? []).join(" ")}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      toast.success("Copied");
                    } catch {
                      toast.error("Copy is blocked here — type it from the screen.");
                    }
                  }}
                  className="border-border hover:bg-secondary ml-auto rounded-sm border px-2 py-1 text-xs font-medium transition-colors"
                >
                  Copy
                </button>
              </div>

              <p className="text-muted-foreground text-xs leading-relaxed">
                Shown as text rather than a QR code on purpose: drawing one means a
                library on the page that handles the secret, and this is the one page
                where an extra script is worth refusing. Every authenticator app takes
                a typed key.
              </p>

              <Code
                label="Current code"
                value={code}
                onChange={setCode}
                error={error}
                hint="Until it is verified, two-factor stays off — so a mistyped key cannot lock you out."
              />

              <div className="flex gap-2">
                <button
                  onClick={() => void enable()}
                  disabled={busy}
                  className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-[13px] font-medium disabled:opacity-55"
                >
                  Turn it on
                </button>
                <button
                  onClick={() => {
                    setStage("off");
                    setSecret("");
                    setError(null);
                  }}
                  className="border-border hover:bg-secondary rounded-sm border px-3 py-2 text-[13px] font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {stage === "on" ? (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Turning it off needs a current code as well as this session —
                otherwise a stolen token could remove the factor protecting the
                account, which is the same as not having one.
              </p>
              <Code label="Current code" value={code} onChange={setCode} error={error} />
              <button
                onClick={() => void disable()}
                disabled={busy}
                className="border-stopped/40 text-stopped hover:bg-stopped-tint w-fit rounded-sm border px-3 py-2 text-[13px] font-medium transition-colors disabled:opacity-55"
              >
                Turn off two-factor
              </button>
            </>
          ) : null}
        </div>
      </Panel>

      <Panel title="This session">
        <p className="text-muted-foreground px-4 py-4 text-xs leading-relaxed">
          Held in memory only. Closing the tab signs you out, there is no
          &ldquo;remember me&rdquo;, and the server expires it after two hours
          regardless. That is deliberate for an account that can suspend every
          practice, and it means signing in again after a refresh.
          <br />
          <br />
          There is no &ldquo;sign out everywhere&rdquo;. The token is not tracked
          server-side, so once issued it is valid for its full two hours and nothing
          can revoke it early. If one leaked, the remedy is to wait it out or rotate{" "}
          <code className="font-mono text-[11px]">ADMIN_JWT_SECRET</code>, which signs
          everyone out at once. That is why the expiry is short and the session does
          not persist: when you cannot revoke, the next best thing is not lasting
          long.
        </p>
      </Panel>
    </div>
  );
}

function Code({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {label}
      </span>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className={cn(
          textInput,
          "tnum max-w-[9rem] font-mono text-lg tracking-[0.3em]",
          error && "border-stopped",
        )}
      />
      {error ? (
        <span role="alert" className="text-stopped text-xs">
          {error}
        </span>
      ) : hint ? (
        <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>
      ) : null}
    </div>
  );
}
