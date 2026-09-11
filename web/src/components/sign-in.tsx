"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LoginResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IconEye, IconEyeOff, Spinner, Wordmark } from "@/components/icons";
import { AudienceTabs, EntryShell } from "@/components/entry-shell";
import { PracticeSignup } from "@/components/practice-signup";
import { ApplicationStatusView } from "@/components/application-status";
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

  /*
   * Which of the two audiences this is.
   *
   * Admin first, and default, because this is the operator console — the
   * practice side is the guest here. Held in state rather than the URL: there
   * is one page, and a tab is not a place somebody links to.
   */
  const [who, setWho] = useState<"admin" | "practice">("admin");

  /*
   * What the practice side is showing.
   *
   * `entry` is the explanation and the two buttons; `register` is the form;
   * `status` looks one up by reference. Held here rather than in the URL
   * because a half-filled registration is not a place anybody should be able
   * to link somebody else into.
   */
  const [practiceView, setPracticeView] = useState<"entry" | "register" | "status">("entry");

  /// Set once, when a registration comes back. The reference is the only thing
  /// the applicant leaves with.
  const [submitted, setSubmitted] = useState<string | null>(null);

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
    <EntryShell>
      <div className="flex flex-col gap-5">
        {/* The mark, for the phone where the brand panel does not render. */}
        {/*
          The full lockup, once — `Wordmark` already contains the emblem.

          `self-start` is load-bearing. This is a direct child of a column
          flex container, so the default `align-items: stretch` pulls it to the
          full width of the cross axis; with `h-7` pinning the height, a 700x256
          lockup became a 350x28 smear running off the side of a phone. It was
          correct in the brand panel only because there it sits inside a
          wrapper div and was never a flex item itself.
        */}
        <Wordmark className="h-7 w-auto self-start lg:hidden" />

        <AudienceTabs value={who} onChange={setWho} />

        <div className="border-border bg-card rounded-md border p-6 sm:p-7">
          {who === "admin" ? (
            <div
              role="tabpanel"
              id="panel-admin"
              aria-labelledby="tab-admin"
              className="flex flex-col gap-4"
            >
              {/*
                No eyebrow. The selected tab directly above already reads
                "Admin / Operator" in a filled blue button — repeating it in
                small caps underneath is the same words twice in two
                centimetres, and the second one carries no information the
                first did not.
              */}
              <Heading
                title={
                  mode === "login"
                    ? "Sign in"
                    : mode === "forgot"
                      ? "Reset your password"
                      : "Choose a new password"
                }
                detail={
                  mode === "login"
                    ? "Access the MedPin operator console to manage practices, plans and platform records."
                    : mode === "forgot"
                      ? "We will email a link to the address on your operator account."
                      : "The link you followed is spent once this is saved."
                }
              />

              {verified ? (
                <p
                  role="status"
                  className={
                    verified === "ok"
                      ? "text-ok-ink border-l-ok bg-ok-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed"
                      : "text-stopped-ink border-l-stopped bg-stopped-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed"
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
          ) : (
            <PracticeSide
              view={practiceView}
              onView={setPracticeView}
              submitted={submitted}
              onSubmitted={(ref) => {
                setSubmitted(ref);
                setPracticeView("status");
              }}
            />
          )}
        </div>

        {/*
          Nothing here. This said "This console holds practices, plans and
          counts. It does not hold patient records" directly under a panel
          whose third point already reads "No patient records here — this
          console holds practices, plans and counts". The same sentence twice
          on one screen, forty centimetres apart.

          It still runs along the bottom of every screen inside the console,
          which is where somebody who has signed in can read it.
        */}
      </div>
    </EntryShell>
  );
}

/* ------------------------------------------------------------------- entry */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-primary text-micro font-semibold tracking-[0.1em] uppercase">
      {children}
    </p>
  );
}

function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="-mt-2">
      {/* `h2`, because the brand panel holds the page's h1. On a phone that
          panel is not rendered and this is the first heading either way. */}
      <h2 className="text-foreground text-heading font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-muted-foreground mt-1.5 text-caption leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

/**
 * The practice side of the door.
 *
 * ---- What is here, and what is deliberately not -------------------------
 *
 * Registration, and a way to check on one. Not a login.
 *
 * A practice does not sign into this console. Clinicians and front-desk staff
 * use the MedPin app, and the app identifies them by phone number — a code to
 * that number, or a password on the accounts that have one. There is no
 * email-and-password login for a practice anywhere in the product, so a form
 * here would post to nothing on the screen where somebody has least patience
 * for that.
 *
 * An earlier draft of this panel said a practice signs in "with a phone number
 * and a code — there is no password to remember". There is one:
 * `doctor_password_login_screen.dart`, against `/auth/login`. Getting that
 * wrong would have sent a doctor looking for a code they never arranged.
 */
function PracticeSide({
  view,
  onView,
  submitted,
  onSubmitted,
}: {
  view: "entry" | "register" | "status";
  onView: (v: "entry" | "register" | "status") => void;
  submitted: string | null;
  onSubmitted: (reference: string) => void;
}) {
  return (
    <div
      role="tabpanel"
      id="panel-practice"
      aria-labelledby="tab-practice"
      className="flex flex-col gap-4"
    >
      {view === "register" ? (
        <>
          <Eyebrow>Register your practice</Eyebrow>
          <Heading
            title="Apply to join MedPin"
            detail="Your application is reviewed before the practice is created. Nothing is set up until somebody at MedPin has read it."
          />
          {/*
            One way back, and it is the form's own.
            
            There used to be a second link under the card. The form already has
            Back in its action row, so step one showed two controls with one
            label three centimetres apart — and the outer one silently
            discarded a part-filled application, which is not what somebody
            pressing "Back" on step one expects to happen.
          */}
          <PracticeSignup onDone={onSubmitted} onLeave={() => onView("entry")} />
        </>
      ) : view === "status" ? (
        <>
          <Eyebrow>Your application</Eyebrow>
          <ApplicationStatusView
            initialReference={submitted}
            onBack={() => onView("entry")}
          />
        </>
      ) : (
        <>
          <Heading
            title="Practices sign in on the app"
            detail="There is no practice login on this domain. The console is for MedPin operators; a clinic's own people work in the MedPin app."
          />

          <div className="border-border bg-secondary/40 flex flex-col gap-2 rounded-md border px-4 py-3.5">
            <p className="text-title font-medium">Already using MedPin</p>
            <p className="text-muted-foreground text-caption leading-relaxed">
              Open the MedPin app and sign in with the phone number your practice
              registered — by a code sent to that number, or by a password where
              the account has one. Either way it is the phone that identifies you,
              not an email address.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onView("register")}
            className="border-border hover:bg-secondary focus-visible:ring-ring flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 text-body font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            Register your practice
            <span aria-hidden>→</span>
          </button>
          <p className="text-muted-foreground -mt-2 text-center text-micro leading-relaxed">
            Your application is reviewed before the practice is created.
          </p>

          <p className="text-muted-foreground border-border border-t pt-4 text-caption leading-relaxed">
            Already applied?{" "}
            <button
              type="button"
              onClick={() => onView("status")}
              className="text-primary underline underline-offset-4"
            >
              Check your application
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground mb-1.5 block text-micro tracking-[0.04em] uppercase"
    >
      {children}
    </label>
  );
}

const inputCls =
  "border-input bg-card focus-visible:border-ring w-full rounded-md border px-3 py-2 text-title outline-none transition-colors disabled:opacity-55";

/**
 * The message slot, whether or not there is a message.
 *
 * Rendering nothing until something goes wrong moves every control below it the
 * moment it appears — so the button somebody is reaching for is not where it
 * was when they started reaching. The height is reserved and the box fades in.
 */
function Slot({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-[2.25rem]" aria-live="polite">
      {children}
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p
      // Announced, because a message that only appears visually is invisible to
      // whoever is using a screen reader and cannot see the form clear itself.
      role="alert"
      className="text-stopped-ink border-l-stopped bg-stopped-tint animate-in fade-in-0 rounded-md border-l-2 px-3 py-2 text-caption leading-relaxed duration-150"
    >
      {children}
    </p>
  );
}

/**
 * The one button that submits.
 *
 * A spinner as well as changed text: the label alone says the click registered
 * and says nothing about whether anything is still happening, which on a slow
 * connection is exactly the moment somebody clicks again. `aria-busy` says the
 * same thing to a screen reader, where a turning ring says nothing at all.
 */
function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className={cn(
        "bg-primary text-primary-foreground flex h-10 items-center justify-center gap-2 rounded-md px-3 text-title font-medium transition-all",
        "hover:brightness-110 active:brightness-95",
        // Not just dimmed: a dimmed button still looks pressable, and the
        // cursor is the part that says it is not.
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100",
      )}
    >
      {busy ? <Spinner className="spin size-4" /> : null}
      {children}
    </button>
  );
}

/**
 * A password field that can be read back.
 *
 * The commonest reason a correct password is refused is that it was mistyped
 * into a row of dots, and the commonest fix is typing it again more slowly.
 * Showing it is one click, and the risk it carries — somebody behind you — is
 * one the person at the keyboard can see and you cannot.
 */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "pr-10")}
          required
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          // The state, not the action: a button labelled "Hide" that hides is a
          // coin toss every time it is read.
          aria-label={shown ? "Password is visible. Hide it." : "Show password"}
          aria-pressed={shown}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-2 transition-colors"
        >
          {shown ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
        </button>
      </div>
    </div>
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
    // No title here. The panel that renders this form already writes one above
    // it, and for a while the screen said "Sign in" twice in four centimetres
    // with two different one-line descriptions under it.
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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

      <PasswordField
        id="password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

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
            className={cn(inputCls, "tnum max-w-[9rem] font-mono text-heading tracking-[0.3em]")}
          />
        </div>
      ) : null}

      <Slot>{error ? <Problem>{error}</Problem> : null}</Slot>

      <Submit busy={busy}>
        {busy ? "Checking…" : needsCode ? "Verify" : "Sign in"}
      </Submit>

      <button
        type="button"
        onClick={onForgot}
        className="text-primary self-start text-caption underline underline-offset-4"
      >
        Forgot password?
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
        <h1 className="text-heading font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground text-caption leading-relaxed">
          If <span className="font-mono">{email.trim()}</span> has an account, a link
          is on its way. It works once and stops working in thirty minutes.
        </p>
        <p className="text-muted-foreground text-caption leading-relaxed">
          You will still need your passkey or authenticator code to finish. The link
          on its own cannot get anybody into the account, which is what makes it safe
          to send one at all.
        </p>
        {!sent.mailConfigured ? (
          <p className="text-waiting-ink border-waiting/30 bg-waiting-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed">
            This server has no mail configured, so nothing was actually sent. The
            link is in the server log, or mint one with{" "}
            <code className="font-mono text-micro">scripts/resetAdmin.js</code>.
          </p>
        ) : null}
        <button
          onClick={onBack}
          className="bg-primary text-primary-foreground self-start rounded-sm px-3 py-2 text-title font-medium"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    // No title. The panel writes one above every form it renders, and this
    // carried its own — so the reset view said "Reset your password" twice with
    // two different explanations under it, exactly as the sign-in view did.
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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

      <Slot>{error ? <Problem>{error}</Problem> : null}</Slot>

      <Submit busy={busy}>{busy ? "Sending…" : "Email me a link"}</Submit>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onBack}
          className="text-primary text-caption underline underline-offset-4"
        >
          Back to sign in
        </button>
        <button
          type="button"
          onClick={onHaveToken}
          className="text-muted-foreground text-caption underline underline-offset-4"
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
        <h1 className="text-heading font-semibold tracking-tight">Password changed</h1>
        <p className="text-muted-foreground text-caption leading-relaxed">
          Sign in with it. Choosing a password is not signing in — a reset that
          handed back a session would let a stolen token skip the login it just
          re-enabled.
        </p>
        <button
          onClick={onBack}
          className="bg-primary text-primary-foreground self-start rounded-sm px-3 py-2 text-title font-medium"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {/* Same again: the panel's heading is the only one. What stays is the
          line that changes with the route the operator arrived by. */}
      <div>
        <p className="text-muted-foreground text-caption leading-relaxed">
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
          className={cn(inputCls, "font-mono text-caption")}
          required
        />
      </div>

      <PasswordField
        id="r-password"
        label="New password — 12 characters or more"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />

      <div>
        <Label htmlFor="r-totp">Authenticator code — if the account has one</Label>
        <input
          id="r-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
          className={cn(inputCls, "tnum max-w-[9rem] font-mono text-heading tracking-[0.3em]")}
        />
      </div>

      <Slot>{error ? <Problem>{error}</Problem> : null}</Slot>

      <Submit busy={busy}>{busy ? "Setting…" : "Set the password"}</Submit>

      <button
        type="button"
        onClick={onBack}
        className="text-primary self-start text-caption underline underline-offset-4"
      >
        Back to sign in
      </button>
    </form>
  );
}
