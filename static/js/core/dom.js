// Minimal DOM helpers shared by legacy scripts.
(function (global) {
  function byId(id) { return document.getElementById(id); }
  function query(selector, root) { return (root || document).querySelector(selector); }
  function queryAll(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }

  global.ADBDom = { byId, query, queryAll };
  if (!global.$) global.$ = byId;
})(window);
