/**
 * Everything this console knows about the API.
 *
 * ---- The token lives in memory, and that is the point --------------------
 *
 * Not `localStorage`, not a cookie. This account can suspend every practice on
 * the platform, and anything that can run script on this origin could read a
 * stored token back. Held in a module variable, a closed tab is a signed-out
 * session and the server's two-hour expiry is a ceiling rather than a
 * formality.
 *
 * The cost is signing in again after a refresh. For a panel one person opens a
 * few times a week, that is the right side of the trade.
 */

const LOCAL = new Set(["localhost", "127.0.0.1"]);

/**
 * Where the API is.
 *
 * `?api=` overrides it for an API on another port or machine — query string
 * only, so nothing persists a value that could outlive the tab and point a
 * later session somewhere unexpected.
 *
 * The local default is 4000 because that is what `PORT` is in the backend's
 * .env. It was 3000 once — a plausible default that was not this project's,
 * and every call failed on a refused connection with nothing on screen to say
 * why.
 */
export function apiBase(): string {
  if (typeof window === "undefined") return "https://clinq.flintdeorient.in/api/v1";
  const override = new URLSearchParams(window.location.search).get("api");
  if (override) return override;
  return LOCAL.has(window.location.hostname)
    ? "http://127.0.0.1:4000/api/v1"
    : "https://clinq.flintdeorient.in/api/v1";
}

let token: string | null = null;

export const session = {
  get: () => token,
  set: (t: string | null) => {
    token = t;
  },
};

export class ApiError extends Error {
  /**
   * The machine-readable half.
   *
   * `TOTP_REQUIRED` arrives as a 401, which everywhere else here means "your
   * session is gone, start again". A caller telling those apart by matching on
   * the sentence would break the next time somebody rewords it.
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

/** Called when a request is refused because the session has gone. */
let onExpired: (() => void) | null = null;
export function setExpiryHandler(fn: () => void) {
  onExpired = fn;
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Suppresses the sign-out on 401 — used by the login itself. */
  anonymous?: boolean;
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, anonymous = false } = opts;

  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token && !anonymous ? { Authorization: `Bearer ${token}` } : {}),
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
  // server: the panel is switched off rather than broken. Saying so saves an
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

    // An expired session returns you to the sign-in screen rather than leaving
    // a dead page behind an error message. Not on TOTP_REQUIRED, which means
    // "carry on" and arrives before there is a session at all.
    if (res.status === 401 && token && code !== "TOTP_REQUIRED") onExpired?.();

    throw new ApiError(
      err?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      code,
    );
  }

  return data as T;
}
