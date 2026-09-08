"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const textInput =
  "border-input bg-card focus-visible:border-ring w-full rounded-sm border px-2.5 py-1.5 text-sm outline-none transition-colors disabled:opacity-55";

/**
 * A select that matches the text input beside it.
 *
 * Native `<select>`, deliberately. A custom listbox is a scroll trap on a phone
 * and reimplements type-ahead, keyboard wrap and the platform's own picker —
 * all of which the browser already does better than a div can.
 *
 * The one thing it needs is `appearance-none` plus a drawn chevron: the default
 * arrow is rendered by the OS and does not follow the page's dark theme, so it
 * turns into a black arrow on a dark field.
 */
export function Select({
  value,
  onChange,
  children,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  /** Shown as a disabled first option when nothing is chosen. */
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          textInput,
          "appearance-none pr-8",
          !value && "text-muted-foreground",
        )}
      >
        {placeholder ? (
          <option value="">{placeholder}</option>
        ) : null}
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {label}
        {hint ? (
          <span className="text-muted-foreground/70 ml-1.5 normal-case tracking-normal">
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/**
 * A dialog, using the platform's own `<dialog>`.
 *
 * Native gives focus trapping, Escape, inert background and the top layer for
 * free — all of which a hand-rolled overlay gets wrong in some browser.
 *
 * ---- Cancel is a button, not a submit ----------------------------------
 *
 * The old panel closed by submitting, which works until the form has a
 * required field: a submit runs constraint validation first, so on an empty
 * form the browser refused and Cancel did nothing — on precisely the blank form
 * somebody most wants to abandon. Cancelling is not submitting.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  onSubmit,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  error,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  /**
   * What the left-hand button does, when it is not "close this".
   *
   * A multi-step dialog needs it to mean "back" on every step but the first,
   * and a second button beside Cancel would be two ways out of a sequence that
   * has one.
   */
  onCancel?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Escape fires `close` without going through any handler, so the parent
      // has to hear about it here or its state and the DOM drift apart.
      onClose={onClose}
      className={cn(
        "border-border bg-card text-foreground m-auto w-[min(30rem,calc(100vw-2rem))] rounded-md border p-0 shadow-lg",
        "backdrop:bg-foreground/25 backdrop:backdrop-blur-[1px]",
        "open:animate-in open:fade-in-0 open:zoom-in-[0.98] open:duration-150",
      )}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        <div className="border-border border-b px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {children}
          {error ? (
            <p
              role="alert"
              className="text-stopped-ink border-l-stopped bg-stopped-tint rounded-sm border-l-2 px-3 py-2 text-xs leading-relaxed"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onCancel ?? onClose}
            className="border-border hover:bg-secondary rounded-sm border px-3 py-1.5 text-[13px] font-medium transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "rounded-sm px-3 py-1.5 text-[13px] font-medium transition-opacity disabled:opacity-55",
              destructive
                ? "bg-stopped text-white"
                : "bg-primary text-primary-foreground",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Ask why, before doing something that will be asked about later.
 *
 * The server refuses a rejection or a suspension without a reason. Asking here
 * rather than letting the request fail keeps the explanation in front of the
 * person who has to write it, at the moment they still remember why.
 */
export function ReasonDialog({
  open,
  title,
  why,
  confirmLabel,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  why: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Reopening starts clean. A complaint about the last attempt sitting above an
  // empty box reads as a complaint about the empty box.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={why}
      destructive
      busy={busy}
      error={error}
      confirmLabel={confirmLabel}
      onSubmit={(e) => {
        e.preventDefault();
        const text = ref.current?.value.trim() ?? "";
        if (!text) {
          setError("A reason is required. It is what the log will show.");
          return;
        }
        onConfirm(text);
      }}
    >
      <Field label="Reason">
        <textarea
          ref={ref}
          rows={3}
          maxLength={500}
          className={cn(textInput, "resize-y")}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

