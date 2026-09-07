"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setExpiryHandler } from "./api";
import type { Admin, LoginResult } from "./types";

type Session = {
  admin: Admin | null;
  totpEnabled: boolean;
  /** True until the boot probe has answered. Not the same as signed out. */
  restoring: boolean;
  signIn: (r: LoginResult) => void;
  signOut: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [totpEnabled, setTotp] = useState(false);
  const [restoring, setRestoring] = useState(true);

  const signIn = useCallback((r: LoginResult) => {
    setAdmin(r.admin);
    setTotp(Boolean(r.totpEnabled ?? r.admin.totpEnabled));
  }, []);

  const signOut = useCallback(() => {
    setAdmin(null);
    setTotp(false);
    // Ask the server to clear the cookie. Fire-and-forget: the local state is
    // already gone, and a failed request must not leave somebody looking at a
    // console they think they have left.
    api("/admin/auth/logout", { method: "POST", anonymous: true }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const out = await api<{ admin: Admin }>("/admin/me");
    setAdmin(out.admin);
    setTotp(Boolean(out.admin.totpEnabled));
  }, []);

  /**
   * Is there already a session?
   *
   * The cookie is `httpOnly`, so the page cannot look. It asks instead: one
   * `/admin/me` on mount, which either answers with the account or 401s.
   *
   * `anonymous` so a 401 here does not fire the expiry handler — arriving
   * signed out is the ordinary case, not an expiry, and treating it as one
   * would loop.
   */
  useEffect(() => {
    let cancelled = false;
    api<{ admin: Admin }>("/admin/me", { anonymous: true })
      .then((out) => {
        if (cancelled) return;
        setAdmin(out.admin);
        setTotp(Boolean(out.admin.totpEnabled));
      })
      .catch(() => {
        /* no session, or the console is switched off; the gate shows sign-in */
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setExpiryHandler(() => {
      setAdmin(null);
      setTotp(false);
    });
  }, []);

  const value = useMemo(
    () => ({ admin, totpEnabled, restoring, signIn, signOut, refresh }),
    [admin, totpEnabled, restoring, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
