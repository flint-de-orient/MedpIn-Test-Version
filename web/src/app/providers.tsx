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
  const { admin } = useSession();
  if (!admin) return <SignIn />;
  return <Shell>{children}</Shell>;
}
