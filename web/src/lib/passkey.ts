import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { api, ApiError } from "./api";
import type { Admin, LoginResult } from "./types";

/**
 * The browser half of a passkey.
 *
 * Two ceremonies, four lines each. Everything hard — CBOR, COSE keys,
 * signature verification across algorithms — happens on the server; this hands
 * the options to the platform and posts back what it gets.
 */

/** Whether this browser can do it at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

/**
 * Whether the *device* has something to authenticate with — a fingerprint
 * reader, Windows Hello, a face camera.
 *
 * Distinct from support: every modern browser supports the API, and a desktop
 * with no reader and no security key can register nothing. Offering a passkey
 * there and watching the prompt fail is worse than not offering it.
 */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Register one against the signed-in account. */
export async function addPasskey(name: string): Promise<Admin> {
  const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    "/admin/me/passkeys/options",
    { method: "POST" },
  );

  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw new ApiError(explain(err), 0, "CEREMONY_FAILED");
  }

  const out = await api<{ admin: Admin }>("/admin/me/passkeys", {
    method: "POST",
    body: { name, response },
  });
  return out.admin;
}

/** Finish a sign-in the server asked for a passkey on. */
export async function signInWithPasskey(
  email: string,
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<LoginResult> {
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    throw new ApiError(explain(err), 0, "CEREMONY_FAILED");
  }

  return api<LoginResult>("/admin/auth/passkey", {
    method: "POST",
    anonymous: true,
    body: { email, response },
  });
}

/**
 * What the browser threw, in words somebody can act on.
 *
 * `NotAllowedError` is the one that matters and the one that says least: it
 * covers cancelling the prompt, letting it time out, and a few genuine
 * failures, all under a message no browser bothers to fill in. Reporting the
 * raw error there leaves an empty toast.
 */
function explain(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === "NotAllowedError") {
    return "The prompt was dismissed or timed out. Try again when ready.";
  }
  if (e?.name === "InvalidStateError") {
    return "This device already has a passkey for this account.";
  }
  if (e?.name === "NotSupportedError") {
    return "This browser or device cannot create a passkey.";
  }
  if (e?.name === "SecurityError") {
    // Almost always the RP id not matching the page's domain.
    return "This page's address does not match what the passkey expects. Check ADMIN_RP_ID on the server.";
  }
  return e?.message || "The passkey prompt did not complete.";
}

/* The two option shapes, named so the calls above read as something. */
type PublicKeyCredentialCreationOptionsJSON = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type PublicKeyCredentialRequestOptionsJSON = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

export type { PublicKeyCredentialRequestOptionsJSON };
