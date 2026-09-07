"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Alert, Field, Panel, Pill, fullWhen, when } from "@/components/primitives";
import { textInput } from "@/components/form";
import { cn } from "@/lib/utils";
import { PasskeyPanel } from "@/components/passkey-panel";

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
      // A 200 with no key is a server that changed shape. Showing the enrolment
      // step anyway would ask somebody to type a code derived from nothing.
      if (!out?.secret) throw new Error("The server did not return a setup key.");
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
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-3">
          <Field label="Name">{admin.name || "—"}</Field>
          <Field label="Email" mono>
            <span className="flex flex-wrap items-center gap-1.5">
              {admin.email}
              {admin.emailVerified ? (
                <Pill tone="ok">confirmed</Pill>
              ) : (
                <Pill tone="waiting">unconfirmed</Pill>
              )}
            </span>
          </Field>
          <Field label="Last sign-in">
            <span title={fullWhen(admin.lastLoginAt)}>
              {admin.lastLoginAt ? when(admin.lastLoginAt) : "This is the first one."}
            </span>
          </Field>
        </dl>
      </Panel>

      {!admin.emailVerified ? <VerifyEmail email={admin.email} /> : null}

      <PasskeyPanel />

      <Panel
        title="Code from an app"
        description={
          stage === "on"
            ? "On. A code from your authenticator app is needed at every sign-in."
            : stage === "enrolling"
              ? "Not on yet — finish by entering a code from the app."
              : "The other way to protect this account, for a device that cannot do passkeys."
        }
        actions={stage === "on" ? <Pill tone="ok">on</Pill> : <Pill tone="waiting">off</Pill>}
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          {stage === "off" ? (
            <>
              <div className="text-muted-foreground flex flex-col gap-2 text-xs leading-relaxed">
                <p>
                  You will need an <strong className="text-foreground">authenticator
                  app</strong> on your phone. Install one from the Play Store or App
                  Store first — <strong className="text-foreground">Google
                  Authenticator</strong> is the usual choice, and 2FAS, Ente Auth or
                  Microsoft Authenticator all work the same way. If you already use a
                  password manager it can probably do this too.
                </p>
                <p>
                  {/*
                    Said plainly because it is the thing people wait for. Somebody
                    expecting a text sits on this screen doing nothing, and the
                    screen previously explained why SMS is a bad idea without ever
                    saying where the code does come from.
                  */}
                  <strong className="text-foreground">
                    Nothing will be sent to you.
                  </strong>{" "}
                  No text message, no email. The app generates the code on your phone
                  from the key below, which is why it works with no signal — and why
                  a code that arrived as a text would be a code your mobile operator
                  can be talked into redirecting.
                </p>
              </div>
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
              <Step n={1} title="Add this key to your authenticator app">
                Open Google Authenticator, Aegis, 1Password — any of them — and
                choose <em>enter a setup key</em> rather than scanning. It is shown
                once and never again.
              </Step>

              {/*
                A blank box where a credential belongs is the worst thing this
                screen can do: it looks like a rendering quirk and it is
                indistinguishable from a key that failed to arrive. If there is
                nothing to show, it says so and offers the way out.
              */}
              {secret ? (
                <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3">
                  {/*
                    Selectable as ordinary text. This was `select-all`, which
                    reads well — one click takes the whole key — and is selected
                    atomically, so dragging across it can drop it from the copied
                    range entirely. A key that vanishes when copied is worse than
                    one that needs two clicks.
                  */}
                  <code className="tnum font-mono text-base leading-relaxed font-medium break-all">
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
                    className="border-border hover:bg-secondary ml-auto shrink-0 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <Alert
                  tone="stopped"
                  title="The key did not arrive"
                  action={
                    <button
                      type="button"
                      onClick={() => void begin()}
                      className="border-border bg-card hover:bg-secondary rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
                    >
                      Try again
                    </button>
                  }
                >
                  Nothing has been changed on your account.
                </Alert>
              )}

              <Step n={2} title="Then type the six digits it shows you">
                The app starts generating a new code every thirty seconds. Type the
                current one here — that is what proves it has the key correctly.
                Until it is verified two-factor stays off, so a mistyped key cannot
                lock you out.
              </Step>

              <Code
                label="Code from the app"
                value={code}
                onChange={setCode}
                error={error}
                autoFocus
                onEnter={() => void enable()}
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

              <p className="text-muted-foreground border-border border-t pt-3 text-[11px] leading-relaxed">
                Shown as text rather than a QR code on purpose: drawing one means a
                library on the page that handles the secret, and this is the one page
                where an extra script is worth refusing. Every authenticator app takes
                a typed key.
              </p>
            </>
          ) : null}

          {stage === "on" ? (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Turning it off needs a current code as well as this session —
                otherwise a stolen token could remove the factor protecting the
                account, which is the same as not having one.
              </p>
              <Code
                label="Code from the app"
                value={code}
                onChange={setCode}
                error={error}
                onEnter={() => void disable()}
              />
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
        <div className="text-muted-foreground flex flex-col gap-2 px-4 py-4 text-xs leading-relaxed">
          <p>
            Kept in a cookie your browser will not let this page read, so a
            refresh keeps you signed in and nothing that runs script here can
            take the session. It lasts two hours and then asks again.
          </p>
          <p>
            <strong className="text-foreground">Sign out</strong> ends it in this
            browser. It does not end it anywhere else: the session is not tracked
            on the server, so a copy taken beforehand stays valid until it
            expires. There is no “sign out everywhere”, and a button offering one
            would be doing less than it claimed.
          </p>
          <p>
            If a session were ever taken, the remedies are to wait out the two
            hours or rotate{" "}
            <code className="font-mono text-[11px]">ADMIN_JWT_SECRET</code> on the
            server, which ends every session at once. That is why two hours is
            short: when you cannot revoke one, the next best thing is that it does
            not last.
          </p>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Confirming the address on the account.
 *
 * ---- Why it matters here and not for a patient -------------------------
 *
 * This address is where a password reset goes. An unconfirmed one is what an
 * administrator typed for somebody else — almost always right, occasionally a
 * transposition, and a reset link sent to a transposition goes to a stranger.
 *
 * It does not gate the reset. Requiring confirmation before recovery would
 * strand the account that predates this feature, which is the account most
 * likely to need recovering.
 */
function VerifyEmail({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setNote(null);
    try {
      const out = await api<{ ok: true; mailConfigured?: boolean }>(
        "/admin/me/email/verify/send",
        { method: "POST" },
      );
      setState("sent");
      if (out.mailConfigured === false) {
        setNote(
          "This server has no mail configured, so nothing was sent. The link is in the server log.",
        );
      }
    } catch (ex) {
      setState("idle");
      toast.error((ex as ApiError).message);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Alert title="This address is not confirmed">
        A password reset would go to <span className="font-mono">{email}</span>.
      </Alert>
      {state === "sent" ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Sent. Open the link in that message — it works for a day.
          {note ? ` ${note}` : ""}
        </p>
      ) : (
        <button
          onClick={() => void send()}
          disabled={state === "sending"}
          className="border-waiting/40 hover:bg-waiting/10 w-fit rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-55"
        >
          {state === "sending" ? "Sending..." : "Send a confirmation email"}
        </button>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="bg-accent text-accent-foreground tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

/**
 * The six digits.
 *
 * ---- Made obvious, because it was not -----------------------------------
 *
 * This was a 9rem box under a small label, with a paragraph about QR codes
 * between it and the key it belongs to. The report was "I did not find any
 * place to paste the code" — the field was there and the layout had hidden it.
 *
 * Wider, taller, monospaced and tracked, with a placeholder showing the shape
 * of what goes in. An empty box says "something goes here"; `000000` says what.
 */
function Code({
  label,
  value,
  onChange,
  error,
  hint,
  autoFocus,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  hint?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="totp-code"
        className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase"
      >
        {label}
      </label>
      <input
        id="totp-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        // Six digits and a button is a form. Enter should submit it rather than
        // leaving somebody typing a code and then hunting for the mouse.
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "totp-error" : undefined}
        className={cn(
          textInput,
          "tnum h-12 max-w-[11rem] text-center font-mono text-2xl tracking-[0.35em] placeholder:tracking-[0.35em] placeholder:opacity-35",
          error && "border-stopped",
        )}
      />
      {error ? (
        <span id="totp-error" role="alert" className="text-stopped text-xs">
          {error}
        </span>
      ) : hint ? (
        <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>
      ) : null}
    </div>
  );
}
