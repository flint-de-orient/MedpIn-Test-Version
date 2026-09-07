"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Light, dark, or whatever the operating system says.
 *
 * The choice is the one thing here that *does* go in `localStorage`. It is a
 * preference, not a credential — the argument against storing the token does
 * not extend to which colours somebody likes, and re-picking dark mode on every
 * visit would be its own small insult.
 *
 * Wrapped in try/catch because a private window or a browser set to block site
 * data throws on the accessor itself, and a theme toggle must not be able to
 * take the console down with it.
 */
const KEY = "medpin-admin-theme";
export type Theme = "light" | "dark" | "system";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const t = read();
    setThemeState(t);
    apply(t);
  }, []);

  // Following the system means following it as it changes, not as it was at
  // load. A laptop that switches to dark at sunset should take the console
  // with it.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* the toggle still worked for this tab, which is most of the value */
    }
  }, []);

  return { theme, setTheme };
}

/**
 * Runs before React does, so the first paint is already the right colour.
 *
 * Without it a dark-mode operator gets a white flash on every load, which on
 * this palette is genuinely unpleasant. Inlined into the document head — the
 * one inline script in the app, and the reason the deploy computes a CSP hash
 * for it rather than allowing inline scripts generally.
 */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('${KEY}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`;
