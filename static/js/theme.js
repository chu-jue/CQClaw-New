// Stable global theme switcher for CQClaw.
(function () {
  const STORAGE_KEY = "adbCommandBoxTheme";

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  }

  function setButtonText(theme) {
    const icon = theme === "light" ? "sun" : "moon";
    const title = theme === "light" ? "切换到深色主题" : "切换到浅色主题";
    document.querySelectorAll(".theme-toggle").forEach(btn => {
      btn.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${icon}"></use></svg>`;
      btn.title = title;
      btn.setAttribute("aria-label", title);
    });
  }

  function applyTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    document.documentElement.classList.toggle("theme-light", value === "light");
    if (document.body) document.body.classList.toggle("theme-light", value === "light");
    localStorage.setItem(STORAGE_KEY, value);
    setButtonText(value);
  }

  function toggleTheme() {
    applyTheme(getTheme() === "light" ? "dark" : "light");
  }

  window.applyAdbTheme = applyTheme;
  window.toggleAdbTheme = toggleTheme;

  // Apply as soon as script runs.
  applyTheme(getTheme());

  // Event delegation, bubble phase only. Do not capture/stop app events globally.
  document.addEventListener("click", function (event) {
    const btn = event.target.closest && event.target.closest(".theme-toggle");
    if (!btn) return;
    event.preventDefault();
    toggleTheme();
  });

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(getTheme());
  });
})();
