"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, textInput } from "@/components/form";
import { PERMISSION_LABELS, PERMISSION_ORDER, type Member } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * What one member of staff may do.
 *
 * ---- Not adding one --------------------------------------------------------
 *
 * There is no "invite a colleague" here on purpose. A person joins a practice
 * through the clinic's own flow, where their phone number is verified and
 * somebody who works there vouches for them. An administrator conjuring staff
 * into a clinic they have never visited is a different and much worse power
 * than adjusting the permissions of somebody already present.
 *
 * ---- The preset is the surprising part -------------------------------------
 *
 * An empty permission list does not mean "nothing". It means "the default for
 * this role", because live memberships predate the field and denying them
 * everything would have locked the working clinic out on the day it deployed.
 * Ticking the first box turns that fallback off — which is a real change in
 * behaviour, so the dialog says it in words rather than letting somebody
 * discover it.
 */
export function MemberDialog({
  member,
  practiceId,
  onClose,
  onSaved,
}: {
  member: Member | null;
  practiceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = useState<string[]>([]);
  const [ending, setEnding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!member) return;
    setPerms(member.permissions);
    setEnding(false);
    setReason("");
    setError(null);
  }, [member]);

  if (!member) return null;

  const toggle = (p: string) =>
    setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    if (ending && reason.trim().length < 3) {
      setError("Ending a membership needs a reason. It is what the log will show.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api(`/admin/practices/${practiceId}/members/${member.id}`, {
        method: "PATCH",
        body: {
          permissions: perms,
          ...(ending
            ? {
                status: member.status === "active" ? "suspended" : "active",
                reason: reason.trim(),
              }
            : {}),
        },
      });
      onSaved();
    } catch (ex) {
      setError((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const willSuspend = member.status === "active";

  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title={member.name}
      description={`${member.role.toLowerCase()}${member.isOwner ? " · owner" : ""}${
        member.phone ? ` · ${member.phone}` : ""
      }`}
      onSubmit={submit}
      confirmLabel={busy ? "Saving…" : "Save"}
      busy={busy}
      error={error}
    >
      <Field label="Permissions">
        <div className="border-border divide-border divide-y rounded-sm border">
          {PERMISSION_ORDER.map((p) => {
            const on = perms.includes(p);
            return (
              <label
                key={p}
                className="hover:bg-secondary/50 flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(p)}
                  className="accent-primary mt-0.5 size-3.5"
                />
                <span className="min-w-0">
                  <span className="block text-body leading-snug">
                    {PERMISSION_LABELS[p]}
                  </span>
                  <span className="text-muted-foreground block font-mono text-micro">
                    {p}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Field>

      {member.usingPreset ? (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-sm border px-3 py-2 text-xs leading-relaxed">
          These are the defaults for a <strong>{member.role.toLowerCase()}</strong>, not
          a saved list — the grant is empty and the role's preset is standing in.
          Saving writes them down, and this membership stops following the preset
          if it ever changes.
        </p>
      ) : null}

      {perms.length === 0 ? (
        <p className="text-waiting-ink border-waiting/30 bg-waiting-tint rounded-sm border-l-2 px-3 py-2 text-xs leading-relaxed">
          An empty list falls back to the role's default rather than denying
          everything. To actually restrict this person, suspend the membership
          instead.
        </p>
      ) : null}

      <div className="border-border border-t pt-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={ending}
            onChange={(e) => setEnding(e.target.checked)}
            className="accent-stopped mt-0.5 size-3.5"
          />
          <span className="text-body leading-snug">
            {willSuspend ? "End this membership" : "Restore this membership"}
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {willSuspend
                ? "They stop being able to open this practice's records immediately. Their own account and any other practice they work at are untouched."
                : "They regain access to this practice with the permissions above."}
            </span>
          </span>
        </label>

        {ending ? (
          <div className="mt-3">
            <Field label="Reason">
              <textarea
                className={cn(textInput, "resize-y")}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
