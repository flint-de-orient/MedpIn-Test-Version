"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, session as store, setExpiryHandler } from "./api";
import type { Admin, LoginResult } from "./types";

type Session = {
  admin: Admin | null;
  totpEnabled: boolean;
  signIn: (r: LoginResult) => void;
  signOut: () => void;
  /** Re-reads /me, so a screen that changed the account agrees with the server. */
  refresh: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [totpEnabled, setTotp] = useState(false);

  const signOut = useCallback(() => {
    store.set(null);
    setAdmin(null);
    setTotp(false);
  }, []);

  const signIn = useCallback((r: LoginResult) => {
    store.set(r.token);
    setAdmin(r.admin);
    // The server returns this on every sign-in so the console can say something
    // about it. It went unread for a while, which is why the nag exists now.
    setTotp(Boolean(r.totpEnabled ?? r.admin.totpEnabled));
  }, []);

  const refresh = useCallback(async () => {
    const out = await api<{ admin: Admin }>("/admin/me");
    setAdmin(out.admin);
    setTotp(Boolean(out.admin.totpEnabled));
  }, []);

  // A 401 anywhere returns to the sign-in screen rather than leaving a dead
  // page behind an error toast.
  useEffect(() => {
    setExpiryHandler(signOut);
  }, [signOut]);

  const value = useMemo(
    () => ({ admin, totpEnabled, signIn, signOut, refresh }),
    [admin, totpEnabled, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
