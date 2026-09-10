"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CommandPalette, usePaletteShortcut } from "@/components/command-palette";
import { AttentionBell } from "@/components/attention";
import { Alert } from "@/components/primitives";
import {
  IconAccount,
  IconAdmins,
  IconAnalytics,
  IconAudit,
  IconBilling,
  IconClose,
  IconCollapse,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconOverview,
  IconPractice,
  IconSearch,
  IconSun,
  Logo,
} from "@/components/icons";

type Item = { href: string; label: string; Icon: (p: { className?: string }) => React.ReactElement };

const SECTIONS: { heading: string | null; items: Item[] }[] = [
  {
    heading: null,
    items: [
      { href: "/", label: "Overview", Icon: IconOverview },
      { href: "/practices/", label: "Practices", Icon: IconPractice },
      { href: "/billing/", label: "Billing", Icon: IconBilling },
      { href: "/analytics/", label: "Analytics", Icon: IconAnalytics },
      { href: "/audit/", label: "Audit", Icon: IconAudit },
    ],
  },
  {
    heading: "Administration",
    items: [{ href: "/admins/", label: "Administrators", Icon: IconAdmins }],
  },
  {
    heading: null,
    items: [{ href: "/account/", label: "Account", Icon: IconAccount }],
  },
];

const ALL = SECTIONS.flatMap((s) => s.items);

/**
 * The frame every signed-in screen sits in.
 *
 * A sidebar rather than a tab bar, now that there are six destinations and the
 * screens below them are wide tables. Tabs work to about four; past that they
 * either wrap or start hiding things behind a menu, and a destination behind a
 * menu is a destination nobody uses.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { protected: hasFactor } = useSession();
  const [drawer, setDrawer] = useState(false);

  /*
   * Remembered, because it is a preference and not a mode.
   *
   * Somebody who collapses the rail to read a wide table wants it collapsed on
   * the next page too. Read in an effect rather than in the initial state so
   * the server-rendered markup and the first client render agree — reading
   * localStorage during render is how a hydration mismatch happens.
   */
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("medpin.nav.collapsed") === "1");
    } catch {
      // A browser with storage blocked still gets a working sidebar.
    }
  }, []);

  const toggleNav = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      try {
        localStorage.setItem("medpin.nav.collapsed", next ? "1" : "0");
      } catch {
        /* not worth failing a click over */
      }
      return next;
    });
  }, []);
  const [palette, setPalette] = useState(false);

  // Navigating closes the drawer. Without this, tapping a link on a phone
  // leaves the sheet open over the page it just went to.
  useEffect(() => {
    setDrawer(false);
  }, [path]);

  usePaletteShortcut(useCallback(() => setPalette(true), []));

  return (
    <div className="flex flex-1">
      <Sidebar
        path={path}
        collapsed={collapsed}
        onToggle={toggleNav}
        className={cn(
          "border-border bg-sidebar hidden shrink-0 border-r lg:flex",
          // Width is the only thing that animates. 200ms, which is inside the
          // brief's range for a layout change and short enough that the table
          // beside it does not appear to slide.
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-[4rem]" : "w-[15rem]",
        )}
      />

      {/* Drawer, on anything narrower. A sheet rather than a squeezed sidebar:
          below this width the content needs the whole screen. */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="bg-foreground/25 absolute inset-0"
          />
          <Sidebar
            path={path}
            className="border-border bg-sidebar animate-in slide-in-from-left-2 relative flex h-full w-[15rem] border-r duration-150"
            onClose={() => setDrawer(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenu={() => setDrawer(true)}
          onSearch={() => setPalette(true)}
        />

        <main className="mx-auto w-full max-w-[80rem] flex-1 px-5 py-6 lg:px-8">
          {/* Shown until the account behind this password has more than a
              password. The server returns `totpEnabled` on every sign-in for
              exactly this, and it went unread for a while. Not on the screen
              that fixes it, where it would be a banner pointing at the button
              underneath it. */}
          {!hasFactor && path !== "/account/" ? <TotpNag /> : null}
          {children}
        </main>

        <footer className="border-border text-muted-foreground border-t px-5 py-3 text-micro lg:px-8">
          This console creates practices and decides whether they may operate. It
          holds no patient records.
        </footer>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} items={ALL} />
    </div>
  );
}

function TotpNag() {
  return (
    <Alert
      title="This account has no second factor"
      className="mb-5"
      action={
        <Link
          href="/account/"
          className="border-border bg-card hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
        >
          Set one up
        </Link>
      }
    >
      A password alone stands between anyone who learns it and every practice.
    </Alert>
  );
}

function Sidebar({
  path,
  className,
  onClose,
  collapsed = false,
  onToggle,
}: {
  path: string;
  className?: string;
  onClose?: () => void;
  /** Icons only, for a narrow screen or somebody who wants the width back. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <aside className={cn("flex-col", className)}>
      <div
        className={cn(
          "border-border flex h-14 items-center border-b",
          collapsed ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        <Logo className="h-[26px] w-auto shrink-0" />
        {/* The wordmark goes, the mark stays. A collapsed rail with no logo at
            all stops looking like the product it belongs to. */}
        {collapsed ? null : (
          <span className="flex items-baseline gap-1.5">
            <span className="text-title font-bold tracking-tight">MedPin</span>
            <span className="text-muted-foreground text-micro tracking-[0.1em] uppercase">
              operator
            </span>
          </span>
        )}
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="hover:bg-secondary ml-auto rounded-sm p-1"
          >
            <IconClose className="size-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {section.heading && !collapsed ? (
              <span className="text-muted-foreground mb-1 px-2 text-micro font-medium tracking-[0.1em] uppercase">
                {section.heading}
              </span>
            ) : null}
            {/* Collapsed, a heading becomes a rule. The grouping is information
                and losing it entirely would make seven icons one list. */}
            {section.heading && collapsed ? (
              <span aria-hidden className="border-border mx-2 mb-1 border-t" />
            ) : null}
            {section.items.map(({ href, label, Icon }) => {
              // `/` would otherwise light up on every page.
              const on = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={on ? "page" : undefined}
                  // The label is the accessible name either way: a collapsed
                  // rail of unlabelled icons is unusable with a screen reader,
                  // and `title` alone does not fix that.
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "group relative flex items-center rounded-md py-2 text-body font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                    on
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
                  )}
                >
                  {/* The active marker is an edge, not a fill. It survives being
                      scanned past at speed, which a background tint does not. */}
                  {on ? (
                    <span
                      aria-hidden
                      className="bg-primary absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full"
                    />
                  ) : null}
                  <Icon className="size-[17px] shrink-0" />
                  {collapsed ? null : label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/*
        At the foot rather than the header.

        In the header it had nowhere to live once collapsed — the rail is a
        centred logo and 64px of width — so the control that got you in would
        not have got you out. Down here it is the same button in both states,
        which is also the reason it reads as a toggle rather than two.
      */}
      {onToggle ? (
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/70",
            "hidden items-center gap-2.5 border-t px-3 py-3 text-body font-medium transition-colors lg:flex",
            collapsed ? "justify-center" : "",
          )}
        >
          <IconCollapse
            className={cn("size-4 shrink-0 transition-transform", collapsed && "rotate-180")}
          />
          {collapsed ? null : "Collapse"}
        </button>
      ) : null}
    </aside>
  );
}

function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { admin, signOut } = useSession();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <header className="border-border bg-background/85 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-sm lg:px-8">
      <button
        onClick={onMenu}
        aria-label="Open navigation"
        className="hover:bg-secondary rounded-sm p-1.5 lg:hidden"
      >
        <IconMenu className="size-5" />
      </button>

      {/* A button that looks like a field. It opens the palette rather than
          being one, so there is a single search surface and not two that
          behave differently. */}
      <button
        onClick={onSearch}
        className="border-border text-muted-foreground hover:bg-secondary/60 hidden h-9 w-full max-w-[22rem] min-w-0 items-center gap-2 rounded-md border px-3 text-body transition-colors sm:flex"
      >
        <IconSearch className="size-4 shrink-0" />
        <span className="truncate">Search practices, staff, locations…</span>
        <kbd className="border-border text-muted-foreground ml-auto hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-micro sm:inline">
          {mac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <AttentionBell />
        <ThemeToggle />
        <span className="bg-border mx-1 hidden h-5 w-px sm:block" />
        <span
          className="text-muted-foreground hidden max-w-[12rem] truncate font-mono text-caption lg:inline xl:max-w-[16rem]"
          title={admin?.email}
        >
          {admin?.email}
        </span>
        <button
          onClick={signOut}
          className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconMonitor;
  const label = { light: "Light", dark: "Dark", system: "System" }[theme];

  return (
    <button
      onClick={() => setTheme(next)}
      // The current state, not the action. A button labelled "Dark" that turns
      // dark off is a coin toss every time it is pressed.
      title={`Theme: ${label}. Click for ${next}.`}
      aria-label={`Theme: ${label}. Switch to ${next}.`}
      className="hover:bg-secondary rounded-sm p-1.5 transition-colors"
    >
      <Icon className="size-[17px]" />
    </button>
  );
}
