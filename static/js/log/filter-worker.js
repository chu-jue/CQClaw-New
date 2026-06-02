/* CQClaw - Log Workbench Filter Worker */

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRegexFlags(flags = "", fallback = "i", required = "") {
  const source = flags || fallback || "";
  const result = [];
  for (const flag of `${source}${required}`) {
    if ("dgimsuvy".includes(flag) && !result.includes(flag)) result.push(flag);
  }
  return result.join("");
}

function explicitRegexParts(pattern) {
  const source = String(pattern || "").trim();
  if (source.startsWith("re:")) return { pattern: source.slice(3), flags: "i" };
  if (source.startsWith("/") && source.lastIndexOf("/") > 0) {
    const end = source.lastIndexOf("/");
    return { pattern: source.slice(1, end), flags: source.slice(end + 1) || "i" };
  }
  return null;
}

function makeMatcher(pattern, flags = "i") {
  const source = String(pattern || "").trim();
  if (!source) return null;
  const explicit = explicitRegexParts(source);
  if (explicit) {
    try {
      return new RegExp(explicit.pattern, normalizeRegexFlags(explicit.flags, flags));
    } catch (error) {
      return null;
    }
  }
  return new RegExp(escapeRegExp(source), flags);
}

function textMatches(value, pattern) {
  const matcher = makeMatcher(pattern);
  if (!matcher) return true;
  return matcher.test(String(value || ""));
}

function matchesKeyword(log, filters) {
  const keyword = String(filters.keyword || "").trim();
  if (!keyword) return true;
  const target = filters.keywordMode === "tag"
    ? log.tag
    : `${log.tag || ""} ${log.packageName || ""} ${log.message || ""} ${log.raw || ""}`;
  return textMatches(target, keyword);
}

function logMatchesFilters(log, filters) {
  const selectedDevices = new Set(filters.selectedDevices || []);
  const levels = new Set(filters.levels || []);
  if (selectedDevices.size && !selectedDevices.has(log.deviceId)) return false;
  if (levels.size && !levels.has(log.level)) return false;
  if (filters.tag && !textMatches(log.tag, filters.tag)) return false;
  if (filters.pid && !textMatches(log.pid, filters.pid)) return false;
  if (filters.tid && !textMatches(log.tid, filters.tid)) return false;
  if (filters.packageName && !textMatches(log.packageName, filters.packageName)) return false;
  if (filters.timeStart && log.timestamp && log.timestamp < filters.timeStart) return false;
  if (filters.timeEnd && log.timestamp && log.timestamp > filters.timeEnd) return false;
  return matchesKeyword(log, filters);
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type !== "filter") return;
  const started = Date.now();
  try {
    const filters = data.filters || {};
    const rawIndices = [];
    for (const log of data.logs || []) {
      if (logMatchesFilters(log, filters)) rawIndices.push(log.rawIndex);
    }
    self.postMessage({
      type: "filter-result",
      jobId: data.jobId,
      filterKey: data.filterKey,
      rawIndices,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    self.postMessage({ type: "filter-error", jobId: data.jobId, error: error.message || String(error) });
  }
};

self.postMessage({ type: "ready" });
