"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LoginResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/icons";
import { signInWithPasskey, type PublicKeyCredentialRequestOptionsJSON } from "@/lib/passkey";

/**
 * The way in, and the way back in.
 *
 * Two legs: the password, then a code when the account has a factor. The
 * server answers `TOTP_REQUIRED` as a 401, which everywhere else here means
 * "your session is gone". It is matched on the code and not the sentence,
 * because the next person to reword the message should not silently break the
 * login.
 */
export function SignIn() {
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");

  /**
   * A reset link opens straight into the form that spends it.
   *
   * The alternative is an operator reading a token out of an email and typing
   * forty-three characters into a box, which is not a thing anybody does
   * correctly at the moment they have already lost a password.
   *
   * Read once on mount and cleared from the address bar, so the token does not
   * sit in browser history or travel with a pasted URL.
   */
  const [prefill, setPrefill] = useState<{ email: string; token: string } | null>(null);

  const [verified, setVerified] = useState<"ok" | "failed" | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const clean = () => window.history.replaceState({}, "", window.location.pathname);

    const reset = q.get("reset");
    if (reset) {
      setPrefill({ email: q.get("email") ?? "", token: reset });
      setMode("reset");
      clean();
      return;
    }

    /**
     * A confirmation link is spent here, on the way past.
     *
     * It grants nothing — it marks an address the account already had as
     * belonging to whoever reads that inbox — so it does not need a session,
     * and requiring one would mean the link only works in the browser the
     * operator happened to be signed into.
     */
    const verify = q.get("verify");
    const email = q.get("email");
    if (verify && email) {
      clean();
      api("/admin/auth/email/verify", {
        method: "POST",
        anonymous: true,
        body: { email, token: verify },
      })
        .then(() => setVerified("ok"))
        .catch(() => setVerified("failed"));
    }
  }, []);
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-border border-b px-5 py-3">
        <div className="mx-auto flex max-w-[78rem] items-center gap-2.5">
          <Wordmark className="h-6 w-auto" />
          <span className="border-border text-muted-foreground border-l pl-2.5 text-[11px] tracking-[0.08em] uppercase">
            operator
          </span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="flex w-full max-w-[23rem] flex-col gap-4">
          {verified ? (
            <p
              role="status"
              className={
                verified === "ok"
                  ? "border-ok/25 bg-ok-tint rounded-sm border px-3 py-2 text-xs leading-relaxed"
                  : "text-stopped border-stopped/25 bg-stopped-tint rounded-sm border px-3 py-2 text-xs leading-relaxed"
              }
            >
              {verified === "ok"
                ? "Email confirmed. Sign in as usual."
                : "That confirmation link is not valid or has expired. Send another from the Account screen."}
            </p>
          ) : null}

          {mode === "login" ? (
            <LoginForm onForgot={() => setMode("forgot")} />
          ) : mode === "forgot" ? (
            <ForgotForm
              onBack={() => setMode("login")}
              onHaveToken={() => setMode("reset")}
            />
          ) : (
            <ResetForm onBack={() => setMode("login")} prefill={prefill} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground mb-1.5 block text-[11px] tracking-[0.04em] uppercase"
    >
      {children}
    </label>
  );
}

const inputCls =
  "border-input bg-card focus-visible:border-ring w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors";

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p
      // Announced, because a message that only appears visually is invisible to
      // whoever is using a screen reader and cannot see the form clear itself.
      role="alert"
      className="text-stopped border-stopped/25 bg-stopped-tint rounded-sm border px-3 py-2 text-xs leading-relaxed"
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------- login */

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const out = await api<LoginResult>("/admin/auth/login", {
        method: "POST",
        anonymous: true,
        body: {
          email: email.trim(),
          password,
          ...(totp.trim() ? { totp: totp.trim() } : {}),
        },
      });
      signIn(out);
    } catch (ex) {
      const err = ex as ApiError;

      /**
       * The password was right and this account has a passkey.
       *
       * The prompt is raised straight away rather than showing a "use your
       * passkey" button: the browser requires a user gesture, and the submit
       * that got here is one. An extra click would only exist to be clicked.
       */
      if (err.code === "PASSKEY_REQUIRED" && err.options) {
        try {
          signIn(
            await signInWithPasskey(
              email.trim(),
              err.options as PublicKeyCredentialRequestOptionsJSON,
            ),
          );
          return;
        } catch (pk) {
          setError((pk as ApiError).message);
          setBusy(false);
          return;
        }
      }

      if (err.code === "TOTP_REQUIRED") {
        // Not a failure: the password was right. Everything else stays put,
        // because clearing the form and starting over is how a second factor
        // gets turned off again.
        setNeedsCode(true);
        setTotp("");
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        setTotp("");
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          This console creates practices and decides whether they may operate. It
          holds no patient records.
        </p>
      </div>

      <div>
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      {needsCode ? (
        <div>
          <Label htmlFor="totp">Code from your authenticator app</Label>
          <input
            id="totp"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            className={cn(inputCls, "tnum max-w-[9rem] font-mono text-lg tracking-[0.3em]")}
          />
        </div>
      ) : null}

      {error ? <Problem>{error}</Problem> : null}

      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-55"
      >
        {busy ? "Checking…" : needsCode ? "Verify" : "Sign in"}
      </button>

      <button
        type="button"
        onClick={onForgot}
        className="text-primary self-start text-xs underline underline-offset-4"
      >
        Lost the password?
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ forgot */

/**
 * Ask for a link.
 *
 * The answer is the same whether the address has an account or not. Saying
 * otherwise turns this into a free membership check for anybody deciding which
 * addresses are worth attacking, and this is the one endpoint that would hand
 * that over.
 */
function ForgotForm({
  onBack,
  onHaveToken,
}: {
  onBack: () => void;
  onHaveToken: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ mailConfigured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ ok: true; mailConfigured: boolean }>("/admin/auth/forgot", {
        method: "POST",
        anonymous: true,
        body: { email: email.trim() },
      });
      setSent({ mailConfigured: out.mailConfigured });
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground text-xs leading-relaxed">
          If <span className="font-mono">{email.trim()}</span> has an account, a link
          is on its way. It works once and stops working in thirty minutes.
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          You will still need your passkey or authenticator code to finish. The link
          on its own cannot get anybody into the account, which is what makes it safe
          to send one at all.
        </p>
        {!sent.mailConfigured ? (
          <p className="text-waiting border-waiting/30 bg-waiting-tint rounded-sm border px-3 py-2 text-xs leading-relaxed">
            This server has no mail configured, so nothing was actually sent. The
            link is in the server log, or mint one with{" "}
            <code className="font-mono text-[11px]">scripts/resetAdmin.js</code>.
          </p>
        ) : null}
        <button
          onClick={onBack}
          className="bg-primary text-primary-foreground self-start rounded-sm px-3 py-2 text-sm font-medium"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          We will email a link to the address on your account.
        </p>
      </div>

      <div>
        <Label htmlFor="f-email">Email</Label>
        <input
          id="f-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          required
          autoFocus
        />
      </div>

      {error ? <Problem>{error}</Problem> : null}

      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-55"
      >
        {busy ? "Sending..." : "Email me a link"}
      </button>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onBack}
          className="text-primary text-xs underline underline-offset-4"
        >
          Back to sign in
        </button>
        <button
          type="button"
          onClick={onHaveToken}
          className="text-muted-foreground text-xs underline underline-offset-4"
        >
          I already have a token
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------- reset */

function ResetForm({
  onBack,
  prefill,
}: {
  onBack: () => void;
  prefill?: { email: string; token: string } | null;
}) {
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [token, setToken] = useState(prefill?.token ?? "");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Choose a password of at least 12 characters.");
      return;
    }
    setBusy(true);
    try {
      await api("/admin/auth/reset", {
        method: "POST",
        anonymous: true,
        body: {
          email: email.trim(),
          token: token.trim(),
          newPassword: password,
          ...(totp.trim() ? { totp: totp.trim() } : {}),
        },
      });
      // No session comes back, deliberately: choosing a password is not signing
      // in, and handing back a token would let a stolen reset skip the login it
      // just re-enabled.
      setDone(true);
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Password changed</h1>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Sign in with it. Choosing a password is not signing in — a reset that
          handed back a session would let a stolen token skip the login it just
          re-enabled.
        </p>
        <button
          onClick={onBack}
          className="bg-primary text-primary-foreground self-start rounded-sm px-3 py-2 text-sm font-medium"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {prefill
            ? "The link filled this in. Choose a password, then confirm with your passkey or authenticator code."
            : "Paste the token from the email, or one minted on the server with scripts/resetAdmin.js."}
        </p>
      </div>

      <div>
        <Label htmlFor="r-email">Email</Label>
        <input
          id="r-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      <div>
        <Label htmlFor="r-token">Reset token</Label>
        <input
          id="r-token"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className={cn(inputCls, "font-mono text-xs")}
          required
        />
      </div>

      <div>
        <Label htmlFor="r-password">New password — 12 characters or more</Label>
        <input
          id="r-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      <div>
        <Label htmlFor="r-totp">Authenticator code — if the account has one</Label>
        <input
          id="r-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
          className={cn(inputCls, "tnum max-w-[9rem] font-mono text-lg tracking-[0.3em]")}
        />
      </div>

      {error ? <Problem>{error}</Problem> : null}

      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-55"
      >
        {busy ? "Setting…" : "Set the password"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="text-primary self-start text-xs underline underline-offset-4"
      >
        Back to sign in
      </button>
    </form>
  );
}
