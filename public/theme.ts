// ダークモード切り替え。設定はlocalStorageに保存し、次回訪問時にも復元する。
const THEME_STORAGE_KEY = "theme";

type Theme = "dark" | "light";

function getPreferredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

let currentTheme = getPreferredTheme();
applyTheme(currentTheme);

function initThemeToggle(): void {
  const button = document.getElementById("theme-toggle");
  if (!button) return;

  function render() {
    button!.textContent = currentTheme === "dark" ? "☀️" : "🌙";
    button!.setAttribute(
      "aria-label",
      currentTheme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"
    );
  }

  render();

  button.addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    applyTheme(currentTheme);
    render();
  });
}

document.addEventListener("DOMContentLoaded", initThemeToggle);
