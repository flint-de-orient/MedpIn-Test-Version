"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { addPasskey, platformAuthenticatorAvailable } from "@/lib/passkey";
import { useSession } from "@/lib/session";
import { Panel, Pill, when, fullWhen } from "@/components/primitives";
import { Modal, Field, textInput } from "@/components/form";
import { IconCheck } from "@/components/icons";

/**
 * Passkeys — the second factor that asks nothing of you.
 *
 * ---- Why this is offered first, above the code from an app --------------
 *
 * TOTP works and it asks a lot: install a third-party app, paste a secret into
 * it, then read six digits and type them within thirty seconds, every time. The
 * likeliest outcome of asking that of one operator on one laptop is an account
 * that never turns a second factor on at all, which protects nothing.
 *
 * A passkey is the prompt the machine already has — Windows Hello, Touch ID, a
 * security key. Nothing installed, nothing typed.
 *
 * ---- And it is the stronger of the two ----------------------------------
 *
 * A six-digit code can be phished live: a convincing fake login page asks for
 * it and forwards it to the real site inside its thirty seconds. That works
 * against every TOTP deployment ever built. A passkey signature is bound to the
 * origin by the browser, so a page on another domain cannot obtain one this
 * server will accept. The attack is not made harder, it is made impossible.
 */
export function PasskeyPanel() {
  const { admin, refresh } = useSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    platformAuthenticatorAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    if (!naming) return;
    setError(null);
    // A default that is usually right. "Chrome on Windows" beats an empty box
    // somebody has to invent an answer for, and beats "Passkey 2" later when
    // they are trying to work out which one to remove.
    setName(guessDevice());
  }, [naming]);

  if (!admin) return null;
  const keys = admin.passkeys ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addPasskey(name.trim() || "Passkey");
      await refresh();
      setNaming(false);
      toast.success("Passkey added");
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/admin/me/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
      setRemoving(null);
      toast.success("Passkey removed");
    } catch (ex) {
      toast.error((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const last = keys.length === 1 && !admin.totpEnabled;

  return (
    <Panel
      title="Passkey"
      description={
        keys.length
          ? "Your device confirms it is you. Nothing to install, nothing to type."
          : "Use this laptop’s own fingerprint, face or PIN instead of a code from an app."
      }
      actions={
        keys.length ? <Pill tone="ok">on</Pill> : <Pill tone="waiting">off</Pill>
      }
    >
      {keys.length ? (
        <ul className="divide-border divide-y">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <IconCheck className="text-ok size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{k.name}</p>
                <p className="text-muted-foreground text-caption">
                  added <span title={fullWhen(k.createdAt)}>{when(k.createdAt)}</span>
                  {k.lastUsedAt ? (
                    <>
                      {" · last used "}
                      <span title={fullWhen(k.lastUsedAt)}>{when(k.lastUsedAt)}</span>
                    </>
                  ) : (
                    " · not used yet"
                  )}
                </p>
              </div>
              <button
                onClick={() => setRemoving(k.id)}
                disabled={busy}
                className="border-border hover:bg-secondary rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-55"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-3 px-4 py-4">
        {available === false ? (
          <p className="text-muted-foreground text-caption leading-relaxed">
            This device has no fingerprint reader, face camera or PIN that a
            passkey can use, and no security key is plugged in. You can still add
            one from a device that does — a passkey belongs to the account, not to
            one machine — or use a code from an app instead.
          </p>
        ) : (
          <p className="text-muted-foreground text-caption leading-relaxed">
            {keys.length
              ? "Add another for a second device, so losing one does not lock you out."
              : "Your browser will ask for whatever unlocks this device. Nothing leaves it — the key stays on the machine and only a signature is sent."}
          </p>
        )}

        <button
          onClick={() => setNaming(true)}
          disabled={busy || available === false}
          className="bg-primary text-primary-foreground w-fit rounded-sm px-3 py-2 text-body font-medium disabled:opacity-55"
        >
          {keys.length ? "Add another passkey" : "Use a passkey"}
        </button>
      </div>

      <Modal
        open={naming}
        onClose={() => setNaming(false)}
        title="Add a passkey"
        description="Name it after the device, so you can tell which is which when you come to remove one."
        onSubmit={create}
        confirmLabel={busy ? "Waiting for your device…" : "Continue"}
        busy={busy}
        error={error}
      >
        <Field label="Name">
          <input
            className={textInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
          />
        </Field>
        <p className="text-muted-foreground text-caption leading-relaxed">
          Your browser will prompt as soon as you continue. If nothing appears,
          the device may have no fingerprint reader or PIN set up.
        </p>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this passkey?"
        description={
          last
            ? "This is the only thing protecting the account beyond the password. Removing it leaves the password alone."
            : "You will still be able to sign in with the others."
        }
        destructive
        busy={busy}
        confirmLabel={busy ? "Removing…" : "Remove"}
        onSubmit={(e) => {
          e.preventDefault();
          if (removing) void remove(removing);
        }}
      >
        <p className="text-muted-foreground text-caption leading-relaxed">
          The key itself stays on the device — this only stops the account
          accepting it. Delete it there too if the device is no longer yours.
        </p>
      </Modal>
    </Panel>
  );
}

/** A sensible default name, from what the browser will admit to. */
function guessDevice(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac/.test(ua)
      ? "Mac"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iPhone"
          : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : null;
  if (os && browser) return `${browser} on ${os}`;
  return os ?? browser ?? "Passkey";
}
