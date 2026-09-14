"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

/**
 * Links from an email, read wherever they land.
 *
 * ---- Why this left the sign-in screen ------------------------------------
 *
 * Three emails link to this console: an applicant's confirmation
 * (`?application=…&confirm=…`), an operator's address check (`?verify=…`) and a
 * password reset (`?reset=…`). All three were read by the sign-in screen — which
 * the gate mounts only when nobody is signed in. An operator who opened a reset
 * link in the browser they were already signed into, or an applicant on a
 * computer where somebody had the console open, landed on the dashboard and
 * the link did nothing at all, without saying so.
 *
 * So they are read here, above the gate, on every page load, and handed to the
 * screen that can act on them whether or not there is a session.
 */

export type Arrival =
  /** An applicant's status, and the secret that confirms their address if the link had one. */
  | { kind: "application"; reference: string; confirm: string | null }
  | { kind: "reset"; email: string; token: string }
  /** Spent as soon as it is read — see below — so only the outcome travels. */
  | { kind: "verify"; outcome: "checking" | "ok" | "failed" };

/** The parameters the links bring, which are removed once read. */
const LINK_PARAMS = ["application", "confirm", "reset", "verify", "email"];

export function useArrival() {
  const [arrival, setArrival] = useState<Arrival | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const application = q.get("application");
    const confirm = q.get("confirm");
    const reset = q.get("reset");
    const verify = q.get("verify");
    const email = q.get("email");

    if (!application && !reset && !(verify && email)) return;

    /*
     * Out of the address bar straight away. A one-time token should not sit in
     * history or travel with a URL somebody pastes into a chat. Only the link's
     * own parameters go: this runs on every page, and a filter somebody is
     * looking at stays where it is.
     */
    for (const key of LINK_PARAMS) q.delete(key);
    const rest = q.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));

    // Application first: it belongs to a practice rather than an operator, and
    // the two kinds never arrive together.
    if (application) {
      setArrival({ kind: "application", reference: application, confirm });
      return;
    }

    if (reset) {
      setArrival({ kind: "reset", email: email ?? "", token: reset });
      return;
    }

    /*
     * An address check is spent on the way past.
     *
     * It grants nothing — it marks an address the account already had as one
     * that reaches somebody — so it needs no session, and requiring one meant
     * it only worked in the browser the operator happened to be signed into.
     */
    if (verify && email) {
      setArrival({ kind: "verify", outcome: "checking" });
      api("/admin/auth/email/verify", {
        method: "POST",
        anonymous: true,
        body: { email, token: verify },
      })
        .then(() => setArrival({ kind: "verify", outcome: "ok" }))
        .catch(() => setArrival({ kind: "verify", outcome: "failed" }));
    }
  }, []);

  const clear = useCallback(() => setArrival(null), []);

  return { arrival, clear };
}
