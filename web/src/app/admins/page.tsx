"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Admin } from "@/lib/types";
import {
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  when,
  fullWhen,
} from "@/components/primitives";
import { Modal, Field, textInput } from "@/components/form";

/**
 * Who else can do all this.
 *
 * A short list nobody looks at until something has gone wrong, at which point
 * it is the first question. The column that matters is the second factor:
 * "who can suspend a practice with a password alone" is the useful form of it.
 */
export default function Admins() {
  const [rows, setRows] = useState<Admin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<Admin | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const out = await api<{ items: Admin[] }>("/admin/admins");
      setRows(out.items);
    } catch (ex) {
      setError((ex as ApiError).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const weak = rows?.filter((a) => a.isActive && !a.totpEnabled).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Administrators</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {weak > 0
              ? `${weak} active account${weak === 1 ? "" : "s"} protected by a password alone.`
              : "Every active account has a second factor."}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="bg-primary text-primary-foreground rounded-sm px-3 py-2 text-body font-medium"
        >
          Add an administrator
        </button>
      </div>

      <Panel>
        {error ? (
          <Failed message={error} retry={() => void load()} />
        ) : !rows ? (
          <Loading rows={3} />
        ) : rows.length === 0 ? (
          <Empty title="No administrators" hint="That should not be possible from here." />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body font-medium">{a.name}</span>
                    {a.isSelf ? <Pill tone="accent">you</Pill> : null}
                    {!a.isActive ? <Pill tone="stopped">deactivated</Pill> : null}
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {a.email}
                  </div>
                </div>

                <div className="text-muted-foreground w-32 text-xs">
                  <span title={fullWhen(a.lastLoginAt)}>
                    {a.lastLoginAt ? `seen ${when(a.lastLoginAt)}` : "never signed in"}
                  </span>
                </div>

                {a.totpEnabled ? (
                  <Pill tone="ok">two-factor</Pill>
                ) : (
                  <Pill tone="waiting">password only</Pill>
                )}

                <button
                  onClick={() => setTarget(a)}
                  disabled={a.isSelf}
                  title={
                    a.isSelf
                      ? "You cannot deactivate your own account — that is the last door locked from the inside."
                      : undefined
                  }
                  className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {a.isActive ? "Deactivate" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-muted-foreground text-xs leading-relaxed">
        A deactivated account keeps its second factor, so restoring it does not
        quietly hand back an account protected by a password alone. There is no
        delete: an administrator who took actions is named in the audit log, and
        removing the row would leave those entries pointing at nobody.
      </p>

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          toast.success("Administrator created — they have no second factor yet");
          void load();
        }}
      />

      <ToggleDialog
        admin={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          void load();
        }}
      />
    </div>
  );
}

function AddDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPassword("");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) {
      setError("Choose a password of at least 12 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/admin/admins", {
        method: "POST",
        body: { name: name.trim(), email: email.trim(), password },
      });
      onCreated();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an administrator"
      description="They will be able to create practices, verify them, and suspend any of them."
      onSubmit={submit}
      confirmLabel={busy ? "Creating…" : "Create"}
      busy={busy}
      error={error}
    >
      <Field label="Name">
        <input
          className={textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
        />
      </Field>
      <Field label="Email">
        <input
          className={`${textInput} font-mono text-body`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password" hint="12 characters or more">
        <input
          className={textInput}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Tell them out of band, and ask them to enrol a second factor on their
        Account screen before they do anything else. Until they do, this account
        is protected by a password alone.
      </p>
    </Modal>
  );
}

function ToggleDialog({
  admin,
  onClose,
  onSaved,
}: {
  admin: Admin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!admin) return;
    setReason("");
    setError(null);
  }, [admin]);

  if (!admin) return null;
  const off = admin.isActive;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!admin) return;
    if (reason.trim().length < 3) {
      setError("A reason is required. It is what the log will show.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/admins/${admin.id}`, {
        method: "PATCH",
        body: { isActive: !admin.isActive, reason: reason.trim() },
      });
      toast.success(off ? "Deactivated" : "Restored");
      onSaved();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={admin !== null}
      onClose={onClose}
      title={`${off ? "Deactivate" : "Restore"} ${admin.name}`}
      description={
        off
          ? "They will not be able to sign in. Their existing session lasts until it expires — this console cannot revoke a token that has already been issued."
          : "They regain access, with whatever second factor the account already had."
      }
      destructive={off}
      onSubmit={submit}
      confirmLabel={busy ? "Saving…" : off ? "Deactivate" : "Restore"}
      busy={busy}
      error={error}
    >
      <Field label="Reason">
        <textarea
          className={`${textInput} resize-y`}
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
