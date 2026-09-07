"use client";

import { SessionProvider, useSession } from "@/lib/session";
import { Shell } from "@/components/shell";
import { SignIn } from "@/components/sign-in";

/**
 * The gate.
 *
 * Every screen sits behind it, so no page has to remember to check. There is
 * no redirect and no route guard because there is no persisted session to
 * restore: with the token in memory, "not signed in" is simply the state the
 * app starts in, and a refresh returns to it honestly rather than flashing a
 * dashboard and then bouncing.
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
      <div className="flex min-h-full flex-1 items-center justify-center">
        <span className="sr-only">Checking your session…</span>
        <span
          aria-hidden
          className="border-border border-t-primary size-5 animate-spin rounded-full border-2"
        />
      </div>
    );
  }

  if (!admin) return <SignIn />;
  return <Shell>{children}</Shell>;
}
