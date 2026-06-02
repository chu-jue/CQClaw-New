// Backwards-compatible API entry. New code should include /js/core/dom.js and /js/core/api-client.js directly.
(function () {
  if (!window.ADBDom) {
    window.ADBDom = { byId: function (id) { return document.getElementById(id); } };
  }
  if (!window.$) window.$ = window.ADBDom.byId;
  if (!window.api) {
    window.api = async function api(url, options = {}) {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));
      return data;
    };
  }
})();
