// Theme manager: token-based theme engine.
// Add a new theme by creating /css/themes/<name>.css and registering it in THEMES.
// Theme CSS files override semantic tokens such as --bg, --panel, --text, --line and --accent.
(function () {
  const STORAGE_KEY = "adbCommandBoxTheme";
  const THEMES = {
    dark: { icon: "moon", href: "/css/themes/dark.css", name: "深色" },
    light: { icon: "sun", href: "/css/themes/light.css", name: "浅色" }
  };

  function getTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (THEMES[saved]) return saved;
    const initial = document.documentElement.dataset.theme || window.__adbInitialTheme;
    return THEMES[initial] ? initial : "dark";
  }


  function ensureComponentLink() {
    let link = document.getElementById("themeComponentStylesheet");
    if (!link) {
      link = document.createElement("link");
      link.id = "themeComponentStylesheet";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = "/css/components/theme-system.css";
    return link;
  }

  function ensureLink() {
    let link = document.getElementById("themeStylesheet");
    if (!link) {
      link = document.createElement("link");
      link.id = "themeStylesheet";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    return link;
  }

  function applyTheme(name) {
    const theme = THEMES[name] ? name : "dark";
    const link = ensureLink();
    link.href = THEMES[theme].href;
    ensureComponentLink();
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    updateButtons(theme);
  }

  function updateButtons(theme) {
    const next = theme === "light" ? "dark" : "light";
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${THEMES[theme].icon}"></use></svg>`;
      btn.title = `切换到${THEMES[next].name}主题`;
      btn.setAttribute("aria-label", `切换到${THEMES[next].name}主题`);
      btn.dataset.themeCurrent = theme;
    });
  }

  function toggleTheme() {
    applyTheme(getTheme() === "light" ? "dark" : "light");
  }

  window.adbTheme = { apply: applyTheme, toggle: toggleTheme, get: getTheme, themes: THEMES };
  window.toggleAdbTheme = toggleTheme;

  applyTheme(getTheme());

  document.addEventListener("click", event => {
    const btn = event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!btn) return;
    event.preventDefault();
    toggleTheme();
  });

  document.addEventListener("DOMContentLoaded", () => applyTheme(getTheme()));
})();
