// Light/dark theme: colours live in src/index.css as CSS variables, this only flips
// the [data-theme] attribute on <html> and remembers the choice on this device.
const KEY = "visionshield-theme";

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: just don't persist */
  }
}
