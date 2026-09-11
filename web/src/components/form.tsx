"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const textInput =
  "border-input bg-card focus-visible:border-ring w-full rounded-sm border px-2.5 py-1.5 text-title outline-none transition-colors disabled:opacity-55";

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
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  /** Shown as a disabled first option when nothing is chosen. */
  placeholder?: string;
  /**
   * For a picker with nothing to pick.
   *
   * A select whose list failed to load still opens, onto a single line that is
   * the placeholder — a control that looks available and cannot help. Saying
   * so is better than letting somebody click it twice.
   */
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        disabled={disabled}
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
  error,
  children,
}: {
  label: string;
  hint?: string;
  /**
   * What is wrong with this field, under this field.
   *
   * A form that answers "that does not look like an email address" in one
   * banner at the bottom has told somebody that one of six boxes is wrong. The
   * message belongs where the box is, and appears once the field has been
   * touched rather than while it is still being typed into for the first time.
   */
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {/*
        The label carries the weight; the hint does not.

        The hint used to be `text-muted-foreground/70` — a dimmer grey at
        3.24:1, which is not a hint, it is a hint nobody can read. Both are the
        token now, so the difference between them is weight and case rather
        than legibility: LABEL in medium uppercase, hint in normal weight and
        normal case beside it.
      */}
      <span className="text-muted-foreground text-micro font-medium tracking-[0.04em] uppercase">
        {label}
        {hint ? (
          <span className="ml-1.5 font-normal normal-case tracking-normal">{hint}</span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span
          // Announced. A message that only appears visually is invisible to
          // somebody who cannot see the field it belongs to.
          role="alert"
          className="text-stopped-ink text-caption leading-relaxed"
        >
          {error}
        </span>
      ) : null}
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
          <h2 className="text-title font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-1 text-caption leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {children}
          {error ? (
            <p
              role="alert"
              className="text-stopped-ink border-l-stopped bg-stopped-tint rounded-sm border-l-2 px-3 py-2 text-caption leading-relaxed"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          {/*
            `shrink-0` on both. Flex items shrink by default, so a long label —
            "Saving…", "Suspend this practice" — squeezes the pair inside a
            dialog that is `calc(100vw-2rem)` wide on a phone, and the last
            button is the one that loses. The way out of a dialog and the way
            through it are the two things on it that must always be whole.
          */}
          <button
            type="button"
            onClick={onCancel ?? onClose}
            className="border-border hover:bg-secondary shrink-0 rounded-sm border px-3 py-1.5 text-body font-medium whitespace-nowrap transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "shrink-0 rounded-sm px-3 py-1.5 text-body font-medium whitespace-nowrap transition-opacity disabled:opacity-55",
              /*
                `--destructive` and its own foreground, not `--stopped` and a
                literal white. `--stopped` is #f87171 in dark and white on it is
                2.77:1 — the least readable thing in the console was the confirm
                button on "Suspend this practice", in the theme half of people
                use. `--destructive-foreground` is defined per theme for exactly
                this and reads 6.47:1 in light, 6.51:1 in dark.

                It was also the only raw colour left in the console, which is
                how it went unmeasured: the contrast test reads tokens.
              */
              destructive
                ? "bg-destructive text-destructive-foreground"
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

