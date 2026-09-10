"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PracticeRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IconChevron, IconPractice, IconSearch } from "@/components/icons";

type NavItem = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
};

type Result =
  | { kind: "nav"; href: string; label: string; Icon: NavItem["Icon"] }
  | { kind: "practice"; href: string; label: string; hint: string };

/**
 * ⌘K.
 *
 * ---- Why the search is a palette and not a field -------------------------
 *
 * A search field on a console like this ends up meaning three different things
 * on three screens — filter this table, find a practice, jump somewhere — and
 * an operator has to learn which. One palette does all three from anywhere, and
 * the keyboard reaches it without touching the page.
 *
 * ---- Filtering happens here, not on the server ---------------------------
 *
 * The practice list is already a request the console makes; searching it again
 * server-side would be a second endpoint and a round trip per keystroke for a
 * list that fits comfortably in memory. When it stops fitting, this becomes a
 * query and the shape of the component does not change.
 */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [practices, setPractices] = useState<PracticeRow[]>([]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    if (open) {
      setQuery("");
      setCursor(0);
      // The native dialog moves focus to the first focusable child; the input
      // wants it explicitly, after paint.
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  // Loaded once per opening rather than once per keystroke.
  useEffect(() => {
    if (!open) return;
    api<{ items: PracticeRow[] }>("/admin/practices")
      .then((out) => setPractices(out.items))
      .catch(() => {
        /* navigation still works without them */
      });
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();

    const nav: Result[] = items
      .filter((i) => !q || i.label.toLowerCase().includes(q))
      .map((i) => ({ kind: "nav", href: i.href, label: i.label, Icon: i.Icon }));

    // Matching the registration number too: it is what an operator has in front
    // of them when somebody rings up about a practice.
    const found: Result[] = q
      ? practices
          .filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.registrationNo ?? "").toLowerCase().includes(q) ||
              p.id.toLowerCase().includes(q),
          )
          .slice(0, 8)
          .map((p) => ({
            kind: "practice",
            href: `/practices/?id=${p.id}`,
            label: p.name,
            hint: `${p.status} · ${p.registrationNo ?? "no reg. number"}`,
          }))
      : [];

    return [...nav, ...found];
  }, [query, items, practices]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const go = useCallback(
    (r: Result) => {
      onClose();
      router.push(r.href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[cursor];
      if (r) go(r);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => {
        // The backdrop is the dialog element itself; a click landing on it
        // rather than on the panel means outside.
        if (e.target === dialog.current) onClose();
      }}
      className={cn(
        "border-border bg-popover text-foreground mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-2xl",
        "backdrop:bg-foreground/30 backdrop:backdrop-blur-[2px]",
        "open:animate-in open:fade-in-0 open:zoom-in-[0.98] open:duration-150",
      )}
    >
      <div className="border-border flex items-center gap-2.5 border-b px-4">
        <IconSearch className="text-muted-foreground size-4 shrink-0" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search practices, staff, locations…"
          aria-label="Search"
          className="w-full bg-transparent py-3.5 text-sm outline-none"
        />
        <kbd className="border-border text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 font-mono text-micro">
          esc
        </kbd>
      </div>

      <ul className="max-h-[52vh] overflow-y-auto p-2">
        {results.length === 0 ? (
          <li className="text-muted-foreground px-3 py-8 text-center text-xs">
            Nothing matches “{query}”.
          </li>
        ) : (
          results.map((r, i) => (
            <li key={`${r.kind}-${r.href}`}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-body transition-colors",
                  i === cursor ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                {r.kind === "nav" ? (
                  <r.Icon className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <IconPractice className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="truncate">{r.label}</span>
                {r.kind === "practice" ? (
                  <span className="text-muted-foreground ml-auto truncate text-micro">
                    {r.hint}
                  </span>
                ) : (
                  <IconChevron className="text-muted-foreground ml-auto size-3.5 shrink-0" />
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </dialog>
  );
}

/** ⌘K / Ctrl-K anywhere, without each screen wiring its own listener. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}
