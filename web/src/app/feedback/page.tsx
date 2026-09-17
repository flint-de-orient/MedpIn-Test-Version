"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Empty, Failed, Loading, Panel, Pill, when, fullWhen } from "@/components/primitives";
import { Modal, Field, textInput } from "@/components/form";

/**
 * Feedback no practice reads.
 *
 * Two kinds reach MedPin rather than a clinic: feedback about the app, and
 * feedback about "the clinic" from a patient no practice has taken on — there
 * is no clinic for it to go to. Everything a patient writes about a practice
 * they are registered with goes to that practice, and never appears here.
 *
 * ---- Without the patient ----------------------------------------------------
 *
 * The console holds no patient identity, and this page does not change that.
 * An operator sees the words, a rating, a date and a short reference; not the
 * name, the number or the account. A reply reaches the patient through the
 * feedback itself, signed "MedPin", so answering needs none of them.
 *
 * Read is per operator: one person opening it does not clear it for another.
 */

type Reply = { body: string; at: string; byName: string | null };

type PlatformFeedback = {
  id: string;
  reference: string;
  about: "app" | "clinic";
  fromUnconnectedPatient: boolean;
  rating: number | null;
  message: string;
  state: "open" | "answered";
  createdAt: string;
  read: boolean;
  replies: Reply[];
};

type Page = { items: PlatformFeedback[]; total: number; unread: number };

export default function FeedbackInbox() {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState<PlatformFeedback | null>(null);
  // Bumped to fetch again; the effect below owns the request.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    api<Page>("/admin/feedback?limit=100")
      .then((out) => {
        if (!current) return;
        setError(null);
        setPage(out);
      })
      .catch((ex: unknown) => {
        if (!current) return;
        setError((ex as ApiError).message);
        setPage({ items: [], total: 0, unread: 0 });
      });
    return () => {
      current = false;
    };
  }, [version]);

  async function markRead(item: PlatformFeedback) {
    try {
      await api(`/admin/feedback/${item.id}/read`, { method: "POST" });
      load();
    } catch (ex) {
      toast.error((ex as ApiError).message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground mt-1 text-caption">
          {page === null
            ? "About the app, and from patients no practice has taken on."
            : page.unread === 0
              ? "You have read everything that has arrived."
              : `${page.unread} you have not read.`}
        </p>
      </div>

      <Panel title="Sent to MedPin" count={page?.total}>
        {error ? (
          <Failed message={error} retry={load} />
        ) : !page ? (
          <Loading rows={3} />
        ) : page.items.length === 0 ? (
          <Empty
            title="Nothing yet"
            hint="Feedback about the app, and from patients no practice has registered, arrives here."
          />
        ) : (
          <ul className="divide-border divide-y">
            {page.items.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-caption">#{f.reference}</span>
                  <Pill tone="muted">{f.fromUnconnectedPatient ? "clinic — no practice" : "the app"}</Pill>
                  {f.read ? null : <Pill tone="waiting">unread</Pill>}
                  {f.state === "answered" ? <Pill tone="ok">answered</Pill> : null}
                  <span className="text-muted-foreground ml-auto text-caption" title={fullWhen(f.createdAt)}>
                    {when(f.createdAt)}
                  </span>
                </div>
                {f.rating === null ? null : <p className="text-caption">Rated {f.rating} out of 5</p>}
                {f.message ? <p className="text-body whitespace-pre-wrap">{f.message}</p> : null}
                {f.replies.map((r, i) => (
                  <div key={i} className="border-border rounded-sm border px-3 py-2">
                    <p className="text-muted-foreground text-caption">
                      MedPin replied{r.byName ? ` (${r.byName})` : ""} · {when(r.at)}
                    </p>
                    <p className="text-body whitespace-pre-wrap">{r.body}</p>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {f.read ? null : (
                    <button
                      onClick={() => void markRead(f)}
                      className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => setReplying(f)}
                    className="bg-primary text-primary-foreground rounded-sm px-2.5 py-1 text-caption font-medium"
                  >
                    Reply
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-muted-foreground text-caption leading-relaxed">
        A reply is shown to the patient in their app under Your feedback, signed MedPin — never
        with your name — and their phone tells them. There is no way to reach the patient from here
        otherwise, by design.
      </p>

      {/* Keyed on the item, so each reply starts from an empty box. */}
      <ReplyDialog
        key={replying?.id ?? "none"}
        item={replying}
        onClose={() => setReplying(null)}
        onSent={() => {
          setReplying(null);
          toast.success("Reply sent");
          load();
        }}
      />
    </div>
  );
}

function ReplyDialog({
  item,
  onClose,
  onSent,
}: {
  item: PlatformFeedback | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!item) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (message.trim().length === 0) {
      setError("Write the reply first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/feedback/${item.id}/reply`, { method: "POST", body: { message: message.trim() } });
      onSent();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={`Reply to #${item.reference}`}
      description="The patient reads this in their app, signed MedPin."
      onSubmit={submit}
      confirmLabel={busy ? "Sending…" : "Send reply"}
      busy={busy}
      error={error}
    >
      <Field label="Reply">
        <textarea
          className={`${textInput} resize-y`}
          rows={4}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
