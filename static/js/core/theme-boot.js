// Applies the saved theme before page paint and injects the matching token stylesheet.
(function () {
  var theme = "dark";
  try {
    theme = localStorage.getItem("adbCommandBoxTheme") === "light" ? "light" : "dark";
  } catch (e) {
    theme = "dark";
  }
  window.__adbInitialTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  document.write('<link id="themeStylesheet" rel="stylesheet" href="/css/themes/' + theme + '.css"><link id="themeComponentStylesheet" rel="stylesheet" href="/css/components/theme-system.css">');
})();
