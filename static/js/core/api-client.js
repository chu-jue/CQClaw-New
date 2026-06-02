// Fetch wrapper used by pages. Exposes the same global `api` contract as before.
(function (global) {
  async function api(url, options) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...(options || {})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || JSON.stringify(data));
    return data;
  }
  global.api = api;
})(window);
