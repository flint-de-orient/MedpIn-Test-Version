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
 * In development the console's dev server and the API are two ports on one
 * machine. Cookies ignore the port, so that is one site — as long as both are
 * addressed by the same host name, which `localhost` and `127.0.0.1` are not.
 * See `apiBase()`.
 */

const LOCAL = new Set(["localhost", "127.0.0.1"]);

/**
 * Where the API is.
 *
 * Same origin in production — an empty base, so the browser resolves against
 * this host and the proxy forwards it. `?api=` overrides, query-string only, so
 * nothing persists a value that could outlive the tab.
 *
 * ---- In development, by the page's own host name -------------------------
 *
 * This was a fixed 127.0.0.1:4000 for any local page, and `next dev` serves on
 * localhost:3000. Those are different sites. The console never sent the strict
 * session cookie to the API, and could not read the CSRF cookie the API set, so
 * signing in appeared to work and every write after it was refused as a
 * forgery — on a laptop, and nowhere else. Built from the page's own host name,
 * the two are one site whichever of them somebody typed.
 */
export function apiBase(): string {
  if (typeof window === "undefined") return "/api/v1";
  const override = new URLSearchParams(window.location.search).get("api");
  if (override) return override;
  const host = window.location.hostname;
  return LOCAL.has(host) ? `http://${host}:4000/api/v1` : "/api/v1";
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
  /**
   * Whatever the error carried besides a message.
   *
   * `PASSKEY_REQUIRED` arrives with the ceremony options attached, because the
   * challenge has to reach the browser and a second round trip to fetch it
   * would be a round trip for nothing.
   */
  options?: unknown;
  /**
   * What a refusal said besides its sentence.
   *
   * A validation failure names its fields here, and "already with us" carries
   * the reference it tells the applicant to use. Both were dropped at this
   * line until now, which is why neither ever reached the screen that needed
   * it.
   */
  details?: unknown;

  constructor(
    message: string,
    status: number,
    code: string | null,
    options?: unknown,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.options = options;
    this.details = details;
  }
}

/**
 * Whether a 404 from an admin route is the console being switched off.
 *
 * `requireAdmin` answers a disabled console with exactly `NOT_FOUND` and "Not
 * found" — generic on purpose, so the namespace looks absent. A route that is on
 * and could not find something says what it could not find, and a body that is
 * not the API's at all is a proxy that never reached it.
 */
function switchedOff(body: { error?: { code?: string; message?: string } } | null): boolean {
  if (!body?.error) return true;
  return body.error.code === "NOT_FOUND" && body.error.message === "Not found";
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

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 204, or an HTML error page from a proxy; the status check below covers it */
  }

  if (!res.ok) {
    const err = data as
      | { error?: { message?: string; code?: string; options?: unknown; details?: unknown } }
      | null;
    const code = err?.error?.code ?? null;

    /*
     * A 404 on an admin route can mean the console is switched off.
     *
     * `requireAdmin` answers 404 rather than 401 when `ADMIN_JWT_SECRET` is
     * unset, so the whole namespace disappears. Saying so saves an hour spent
     * looking for a bug that is a missing environment variable.
     *
     * ---- Scoped to /admin, and to the API's switched-off answer ----------
     *
     * It fired on any 404 once, which was true while every route this client
     * called was an admin one; public application routes broke that, and a
     * practice pressing "Send the code" was told about a secret that had nothing
     * to do with them. Scoped to /admin, it still said "switched off" for a
     * console that was on and could not find what it was asked for — an
     * application id from a stale link read as a misconfigured server. So the
     * body is read first, and only the deliberately generic answer counts.
     */
    if (res.status === 404 && path.startsWith("/admin") && switchedOff(err)) {
      throw new ApiError(
        "The admin API is switched off on this server (ADMIN_JWT_SECRET is not set), or this address does not reach it.",
        404,
        "PANEL_OFF",
      );
    }

    /**
     * An expired session returns to the sign-in screen rather than leaving a
     * dead page behind an error.
     *
     * Both second-factor prompts arrive as 401 and mean "carry on" rather than
     * "your session is gone" — they happen before there is a session at all.
     * Listing them by code and not by message is why adding the passkey one did
     * not silently start bouncing people mid-sign-in.
     */
    const CONTINUE = new Set(["TOTP_REQUIRED", "PASSKEY_REQUIRED"]);
    if (res.status === 401 && !anonymous && !CONTINUE.has(code ?? "")) onExpired?.();

    throw new ApiError(
      err?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      code,
      err?.error?.options,
      err?.error?.details,
    );
  }

  return data as T;
}
