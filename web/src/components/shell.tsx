"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Practices" },
  { href: "/audit/", label: "Audit" },
  { href: "/admins/", label: "Administrators" },
  { href: "/account/", label: "Account" },
];

/**
 * The frame every signed-in screen sits in.
 *
 * A top bar and a row of tabs rather than a sidebar. Four destinations do not
 * need 240px of permanent chrome, and the screens here are wide tables — the
 * horizontal space is worth more than the navigation is.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const { admin, totpEnabled, signOut } = useSession();
  const path = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-border bg-background/85 sticky top-0 z-30 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-full max-w-[78rem] items-center gap-4 px-5">
          <Link href="/" className="flex items-baseline gap-1.5 tracking-tight">
            <span className="text-[15px] font-bold">MedPin</span>
            <span className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
              operator
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-0.5 sm:flex">
            {NAV.map((n) => {
              // `/` would otherwise light up on every page.
              const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-sm px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    on
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <span
              className="text-muted-foreground hidden font-mono text-xs md:inline"
              title={admin?.email}
            >
              {admin?.email}
            </span>
            <button
              onClick={signOut}
              className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Tabs collapse to their own row rather than disappearing behind a
            hamburger. Four items fit; a menu would hide them for no gain. */}
        <nav className="border-border flex items-center gap-0.5 border-t px-3 py-1.5 sm:hidden">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-sm px-2.5 py-1.5 text-[13px] font-medium",
                  on ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[78rem] flex-1 px-5 py-6">
        {/* Shown until the account behind this password has more than a
            password. The server returns `totpEnabled` on every sign-in for
            exactly this, and it went unread for a while. */}
        {!totpEnabled && path !== "/account/" ? <TotpNag /> : null}
        {children}
      </main>

      <footer className="border-border text-muted-foreground border-t px-5 py-3 text-center text-[11px]">
        This console creates practices and decides whether they may operate. It
        holds no patient records.
      </footer>
    </div>
  );
}

function TotpNag() {
  return (
    <div className="border-waiting bg-waiting-tint mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-l-[3px] px-4 py-3">
      <p className="text-sm">
        <strong className="font-semibold">This account has no second factor.</strong>{" "}
        <span className="text-muted-foreground">
          A password alone stands between anyone who learns it and every practice on
          the platform.
        </span>
      </p>
      <Link
        href="/account/"
        className="border-waiting/40 hover:bg-waiting/10 shrink-0 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors"
      >
        Set one up
      </Link>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const label = { light: "Light", dark: "Dark", system: "System" }[theme];

  return (
    <button
      onClick={() => setTheme(next)}
      className="border-border hover:bg-secondary rounded-sm border px-2 py-1 text-[11px] font-medium tracking-[0.02em] transition-colors"
      // The current state, not the action — a button labelled "Dark" that turns
      // dark off is a coin toss every time.
      title={`Theme: ${label}. Click for ${next}.`}
    >
      {label}
    </button>
  );
}
