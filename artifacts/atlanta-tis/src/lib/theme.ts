/**
 * Site theme: dark by default, light on request, remembered per browser.
 *
 * The `dark` class on <html> drives every `dark:` utility and the `.dark`
 * token block in index.css. index.html applies the stored choice inline
 * before the stylesheet paints (no flash); this module owns the toggle and
 * keeps print output readable — a dark page printed through the browser
 * would be light text on the print stylesheet's white ground, so the
 * class comes off for the duration of printing.
 */
export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "sis-theme";
const DEFAULT_THEME: Theme = "dark";

export function readStoredTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode / quota — the choice just doesn't persist
  }
  window.dispatchEvent(new CustomEvent("sis-theme", { detail: theme }));
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/** Called once at boot: honour the stored choice (index.html already did, this re-syncs) and wire print handling. */
export function installTheme(): void {
  const stored = readStoredTheme() ?? DEFAULT_THEME;
  document.documentElement.classList.toggle("dark", stored === "dark");
  document.documentElement.style.colorScheme = stored;
  let wasDark = false;
  window.addEventListener("beforeprint", () => {
    wasDark = document.documentElement.classList.contains("dark");
    if (wasDark) { document.documentElement.classList.remove("dark"); document.documentElement.style.colorScheme = "light"; }
  });
  window.addEventListener("afterprint", () => {
    if (wasDark) { document.documentElement.classList.add("dark"); document.documentElement.style.colorScheme = "dark"; }
  });
}
