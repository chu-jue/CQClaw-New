/* CQClaw - Log Insight Timeline v1 */

(function timelineModule(global) {
  const EVENT_TYPES = [
    { value: "all", label: "全部" },
    { value: "activity_start", label: "Activity" },
    { value: "first_display", label: "页面显示" },
    { value: "anr", label: "ANR" },
    { value: "crash", label: "Crash" },
    { value: "input_timeout", label: "输入超时" },
    { value: "process_died", label: "进程死亡" },
    { value: "jank", label: "卡顿" },
  ];

  const TYPE_LABELS = EVENT_TYPES.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {});

  function stableHash(text) {
    let hash = 5381;
    const value = String(text || "");
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }

  function includes(value, keyword) {
    return String(value || "").includes(keyword);
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function extractPackageName(log, text) {
    if (log?.packageName) return log.packageName;
    const match = String(text || "").match(/\b([A-Za-z][\w$]*(?:\.[\w$]+)+)(?:\/[\w.$]+)?\b/);
    return match ? match[1] : "";
  }

  function extractComponent(text) {
    const value = String(text || "");
    const patterns = [
      /\bDisplayed\s+([A-Za-z][\w.$]*(?:\/[\w.$]+)?)/,
      /\bcmp=([A-Za-z][\w.$]*\/[\w.$]+)/,
      /\b(?:ActivityRecord|ActivityInfo)\{[^}]*\s([A-Za-z][\w.$]*\/[\w.$]+)\}/,
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return match[1];
    }
    return "";
  }

  function extractDuration(text) {
    const match = String(text || "").match(/([+:]\s*\+?\d+(?:\.\d+)?\s*(?:ms|s))/i)
      || String(text || "").match(/(\+\d+(?:\.\d+)?\s*(?:ms|s))/i);
    return match ? match[1].replace(/^:\s*/, "").replace(/\s+/g, "") : "";
  }

  function shortSummary(log, fallback = "") {
    return String(fallback || log?.message || log?.raw || "").replace(/\s+/g, " ").trim().slice(0, 220);
  }

  function makeTimelineEvent(log, index, type, title, summary, confidence) {
    const raw = String(log?.raw || "");
    const message = String(log?.message || "");
    const lineIndex = Number.isFinite(Number(log?.rawIndex)) ? Number(log.rawIndex) : index;
    const text = `${log?.tag || ""} ${message} ${raw}`;
    return {
      id: `timeline:${type}:${lineIndex}:${stableHash(raw || message || `${type}:${index}`)}`,
      time: log?.timestamp || log?.time || "",
      type,
      title,
      summary: shortSummary(log, summary),
      packageName: extractPackageName(log, text),
      source: "system_log",
      confidence,
      lineIndex,
      raw,
    };
  }

  function activitySummary(log) {
    const component = extractComponent(log?.message || log?.raw || "");
    return component || shortSummary(log);
  }

  function displaySummary(log) {
    const text = log?.message || log?.raw || "";
    const component = extractComponent(text);
    const duration = extractDuration(text);
    return [component, duration].filter(Boolean).join(" · ") || shortSummary(log);
  }

  function detectSystemEvent(log, index = 0) {
    const tag = String(log?.tag || "");
    const message = String(log?.message || "");
    const raw = String(log?.raw || "");
    const haystack = `${message} ${raw}`;

    if ((includes(tag, "AndroidRuntime") && includes(haystack, "FATAL EXCEPTION")) || tag === "am_crash") {
      return makeTimelineEvent(log, index, "crash", "Crash", message || raw, "high");
    }

    if (includes(message, "ANR in") || tag === "am_anr" || includes(message, "Application Not Responding")) {
      return makeTimelineEvent(log, index, "anr", "ANR", message || raw, "high");
    }

    if (includes(tag, "InputDispatcher") && includes(message, "Input dispatching timed out")) {
      return makeTimelineEvent(log, index, "input_timeout", "输入超时", message, "high");
    }

    if (includes(tag, "ActivityTaskManager") && includes(message, "Displayed")) {
      return makeTimelineEvent(log, index, "first_display", "页面首次显示", displaySummary(log), "high");
    }

    if (includes(tag, "ActivityTaskManager") && (includes(message, "START") || includes(message, "START u0"))) {
      return makeTimelineEvent(log, index, "activity_start", "Activity 启动", activitySummary(log), "high");
    }

    if (includes(tag, "Choreographer") && includes(message, "Skipped") && includes(message, "frames")) {
      return makeTimelineEvent(log, index, "jank", "页面卡顿", message, "medium");
    }

    if (includes(tag, "ActivityManager") && (includes(message, "has died") || (/Process .* died/i).test(message))) {
      return makeTimelineEvent(log, index, "process_died", "进程死亡", message, "medium");
    }

    return null;
  }

  function buildTimelineEvents(logs = []) {
    return logs
      .map((log, index) => detectSystemEvent(log, index))
      .filter(Boolean)
      .sort((left, right) => (left.lineIndex || 0) - (right.lineIndex || 0));
  }

  function filterTimelineEvents(events = [], options = {}) {
    const type = options.type || "all";
    const query = lower(options.query || "");
    return events.filter((event) => {
      if (type !== "all" && event.type !== type) return false;
      if (!query) return true;
      const text = lower(`${event.title} ${event.summary} ${event.raw} ${event.packageName}`);
      return text.includes(query);
    });
  }

  const api = {
    EVENT_TYPES,
    TYPE_LABELS,
    buildTimelineEvents,
    detectSystemEvent,
    filterTimelineEvents,
  };

  global.LogInsightTimeline = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
