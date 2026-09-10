"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IconAlert, IconBell, IconCheck } from "@/components/icons";

export type AttentionItem = {
  kind: string;
  severity: "waiting" | "stopped";
  title: string;
  detail: string;
  href: string;
  count: number;
};

/**
 * What is waiting on a person.
 *
 * ---- Derived, never stored -----------------------------------------------
 *
 * There is no notifications table and nothing to dismiss. A stored alert needs
 * a rule for when it comes back, and the only honest rule is "when it is still
 * true" — which is what recomputing already means. It also removes the failure
 * where somebody dismisses a warning and the thing it warned about stays wrong.
 *
 * The cost is that these cannot be marked read. For a console one person opens
 * a few times a week, "it is still there because it is still true" is the
 * behaviour that needs no explaining.
 */
export function useAttention() {
  const [items, setItems] = useState<AttentionItem[] | null>(null);

  const load = useCallback(() => {
    api<{ items: AttentionItem[] }>("/admin/attention")
      .then((out) => setItems(out.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { items, reload: load };
}

export function AttentionBell() {
  const { items } = useAttention();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const count = items?.length ?? 0;

  // Click-away and Escape. A panel that only closes by pressing the button
  // again is one an operator ends up clicking around.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `${count} things need attention` : "Nothing needs attention"}
        aria-expanded={open}
        className="hover:bg-secondary relative rounded-sm p-1.5 transition-colors"
      >
        <IconBell className="size-[17px]" />
        {count > 0 ? (
          <span
            // A count, not a dot. "Three things" and "something" are different
            // amounts of urgency and the badge may as well say which.
            className="bg-waiting text-background absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-micro font-semibold tabular-nums"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-border bg-popover absolute right-0 z-40 mt-2 w-[22rem] rounded-lg border shadow-xl">
          <div className="border-border border-b px-4 py-2.5">
            <h2 className="text-body font-semibold tracking-tight">Needs attention</h2>
          </div>

          {items === null ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-caption">Checking…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <IconCheck className="text-ok size-5" />
              <p className="text-caption font-medium">Nothing is waiting on you</p>
              <p className="text-muted-foreground text-micro leading-relaxed">
                Every practice is decided and every administrator has a second
                factor.
              </p>
            </div>
          ) : (
            <ul className="divide-border max-h-[24rem] divide-y overflow-y-auto">
              {items.map((it, i) => (
                <li key={`${it.kind}-${i}`}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="hover:bg-secondary/60 flex gap-2.5 px-4 py-3 transition-colors"
                  >
                    <IconAlert
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        it.severity === "stopped" ? "text-stopped" : "text-waiting",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-body leading-snug font-medium">
                        {it.title}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-micro leading-relaxed">
                        {it.detail}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
