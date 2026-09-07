/**
 * Everything this console knows about the API.
 *
 * ---- The session is a cookie the page cannot read -----------------------
 *
 * There is no token in this file, and no token anywhere in the app. The server
 * sets an `httpOnly` cookie at sign-in; the browser attaches it; JavaScript
 * never sees it.
 *
 * The first version held a token in a module variable, on the argument that
 * `localStorage` is readable by anything that can run script here and this
 * account can suspend every practice on the platform. Half of that was right:
 * memory does beat `localStorage`. The other half was assuming those were the
 * only options. An `httpOnly` cookie is not readable by script at all — better
 * on the axis that mattered — and it survives a reload, which memory did not.
 *
 * So the old design charged an operator a full sign-in on every refresh, and on
 * every accidental hard navigation, for a property it did not have over the
 * option it skipped.
 *
 * ---- Which is why the API is same-origin in production ------------------
 *
 * The cookie is `SameSite=Strict`, so it is never sent on a cross-site request.
 * That is the CSRF defence itself rather than a mitigation of one — but it
 * means the console and the API must be the same site, so production
 * reverse-proxies `/api/v1/admin/` from the console's own host.
 *
 * That is stronger than the cross-origin arrangement it replaces: the cookie is
 * scoped to the console's host and never sent anywhere else, so a script on the
 * clinic app cannot reach the admin API with credentials at all.
 *
 * In development the console is on :8144 and the API on :4000. Cookies ignore
 * the port, so those are the same site and the cookie works between them.
 */

const LOCAL = new Set(["localhost", "127.0.0.1"]);

/**
 * Where the API is.
 *
 * Same origin in production — an empty base, so the browser resolves against
 * this host and the proxy forwards it. `?api=` overrides, query-string only, so
 * nothing persists a value that could outlive the tab.
 */
export function apiBase(): string {
  if (typeof window === "undefined") return "/api/v1";
  const override = new URLSearchParams(window.location.search).get("api");
  if (override) return override;
  return LOCAL.has(window.location.hostname) ? "http://127.0.0.1:4000/api/v1" : "/api/v1";
}

/**
 * The anti-forgery value, read from the one cookie that is deliberately
 * readable.
 *
 * The session cookie beside it is `httpOnly` and this cannot see it. This one
 * exists to be echoed in a header, because a header is the thing a cross-site
 * request cannot set.
 */
function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== "medpin_admin_csrf") continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export class ApiError extends Error {
  /**
   * The machine-readable half.
   *
   * `TOTP_REQUIRED` arrives as a 401, which everywhere else means "your session
   * is gone, start again". A caller telling those apart by matching on the
   * sentence would break the next time somebody rewords it.
   */
  code: string | null;
  status: number;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let onExpired: (() => void) | null = null;
export function setExpiryHandler(fn: () => void) {
  onExpired = fn;
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Suppresses the sign-out on 401 — used by the login and the boot probe. */
  anonymous?: boolean;
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, anonymous = false } = opts;
  const csrf = csrfToken();

  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      // The whole mechanism. Without this the cookie is not attached and every
      // request is anonymous, which reads as "signed out" and is very confusing
      // to debug because the sign-in itself appears to work.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A refused connection, DNS, or an offline laptop. "Failed to fetch" is all
    // the browser will say, and on its own it reads like the API is broken
    // rather than unreachable from here.
    throw new ApiError(
      `Could not reach the API at ${apiBase()}. It may be down, or this page may be pointed at the wrong address.`,
      0,
      "UNREACHABLE",
    );
  }

  // A 404 across this whole namespace means ADMIN_JWT_SECRET is unset on the
  // server: the console is switched off rather than broken. Saying so saves an
  // hour looking for a bug that is a missing environment variable.
  if (res.status === 404 && !path.includes("/practices/") && !path.includes("/admins/")) {
    throw new ApiError(
      "The admin API is switched off on this server (ADMIN_JWT_SECRET is not set).",
      404,
      "PANEL_OFF",
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 204, or an HTML error page from a proxy; the status check below covers it */
  }

  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } } | null;
    const code = err?.error?.code ?? null;

    // An expired session returns to the sign-in screen rather than leaving a
    // dead page behind an error. Not on TOTP_REQUIRED, which means "carry on"
    // and arrives before there is a session at all; and not on the boot probe,
    // whose whole job is to find out whether there is one.
    if (res.status === 401 && !anonymous && code !== "TOTP_REQUIRED") onExpired?.();

    throw new ApiError(
      err?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      code,
    );
  }

  return data as T;
}
