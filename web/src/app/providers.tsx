"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { SessionProvider, useSession } from "@/lib/session";
import { useArrival } from "@/lib/arrival";
import { Shell } from "@/components/shell";
import { SignIn } from "@/components/sign-in";

/**
 * The gate.
 *
 * Every screen sits behind it, so no page has to remember to check. There is
 * no redirect and no route guard: the session is a cookie the page cannot read,
 * so the gate asks the server once and shows the console or the way in.
 *
 * ---- Links from email pass through here first ---------------------------
 *
 * An applicant's confirmation, an operator's address check and a password
 * reset all arrive as links to this console. They used to be read by the
 * sign-in screen, which this gate mounts only for somebody signed out — so for
 * anybody signed in, the link opened the dashboard and did nothing. They are
 * read here now, before the gate decides anything. See lib/arrival.ts.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { admin, restoring } = useSession();
  const { arrival, clear } = useArrival();

  /*
   * An address confirmed by somebody already inside.
   *
   * Nothing on screen needs to change for it, so it is a toast over the page
   * they are on rather than a screen of its own. Somebody signed out sees the
   * same outcome above the sign-in form instead.
   */
  useEffect(() => {
    if (!admin || arrival?.kind !== "verify" || arrival.outcome === "checking") return;
    if (arrival.outcome === "ok") toast.success("Email confirmed.");
    else
      toast.error(
        "That confirmation link is not valid or has expired. Send another from the Account screen.",
      );
    clear();
  }, [admin, arrival, clear]);

  /**
   * Restoring is not the same as signed out.
   *
   * The session lives in an `httpOnly` cookie the page cannot read, so on load
   * the app has to ask the server whether one exists. Rendering the sign-in
   * form during that moment would flash a login at somebody who is already
   * signed in — which is exactly the friction the cookie was meant to remove.
   */
  if (restoring) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="sr-only">Checking your session…</span>
        <span
          aria-hidden
          className="border-border border-t-primary size-5 animate-spin rounded-full border-2"
        />
      </div>
    );
  }

  /*
   * A link that needs a screen of its own, followed while signed in.
   *
   * An application's status and a password reset are both things somebody
   * with a session may still need — the reset may even be for another account —
   * so the screen for them opens over the console, with a way back to it.
   */
  if (admin && arrival && arrival.kind !== "verify") {
    return <SignIn arrival={arrival} signedIn onDone={clear} />;
  }

  if (!admin) return <SignIn arrival={arrival} onDone={clear} />;
  return <Shell>{children}</Shell>;
}
