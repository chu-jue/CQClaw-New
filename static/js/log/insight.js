/* CQClaw - Log Workbench */

/**
 * @typedef {Object} LogEntry
 * @property {string} id
 * @property {number} rawIndex
 * @property {string} timestamp
 * @property {string} level
 * @property {string} uid
 * @property {string} pid
 * @property {string} tid
 * @property {string} tag
 * @property {string} processName
 * @property {string} packageName
 * @property {string} packageSource
 * @property {string} message
 * @property {string} raw
 * @property {string} deviceId
 */

const byId = (id) => document.getElementById(id);
const FILTER_PRESET_STORAGE_KEY = "androidAutomationStudio.logFilterPresets.v1";
const FILTER_PRESET_LAST_STORAGE_KEY = "androidAutomationStudio.logFilterPresets.lastSelected.v1";
const COLUMN_STORAGE_KEY = "androidAutomationStudio.logColumns.v1";
const COLUMN_WIDTH_STORAGE_KEY = "androidAutomationStudio.logColumnWidths.v1";
const ANCHOR_COLLAPSE_STORAGE_KEY = "androidAutomationStudio.logAnchorCollapsed.v1";
const COLUMN_PACKAGE_MIGRATION_KEY = "androidAutomationStudio.logColumns.package.v1";
const DEFAULT_COLUMNS = ["line", "device", "time", "level", "pidtid", "package", "tag", "message", "action"];
const LOG_LEVELS = ["V", "D", "I", "W", "E", "F"];
const LOG_LEVEL_LABELS = { V: "Verbose", D: "Debug", I: "Info", W: "Warn", E: "Error", F: "Fatal" };
const PROCESS_PACKAGE_REFRESH_INTERVAL_MS = 15000;
const DEFAULT_COLUMN_WIDTHS = {
  line: 62,
  device: 112,
  time: 132,
  level: 58,
  pidtid: 110,
  package: 180,
  tag: 170,
  message: 520,
  action: 128,
};
const COLUMN_WIDTH_LIMITS = {
  line: [46, 120],
  device: [72, 260],
  time: [104, 220],
  level: [48, 96],
  pidtid: [86, 220],
  package: [120, 420],
  tag: [110, 420],
  message: [240, 1400],
  action: [96, 240],
};
const COLUMN_LABELS = {
  line: "行号",
  device: "设备",
  time: "时间",
  level: "级别",
  pidtid: "PID/TID",
  package: "包名",
  tag: "Tag",
  message: "消息",
  action: "操作",
};

const state = {
  devices: [],
  fileSources: [],
  sessions: [],
  allLogs: [],
  filteredLogs: [],
  runtimeEvents: [],
  timelineEvents: [],
  manualAnchors: [],
  filterPresets: [],
  rawIndexMap: new Map(),
  statusText: "未开始采集",
  statusKind: "idle",
  captureNotice: "未开始采集",
  captureKind: "idle",
  lastBatchSize: 0,
  lastLogAt: "",
  selectedLogId: "",
  currentAnchor: null,
  ghostAnchor: null,
  dismissedGhostAnchorKey: "",
  lastFilterPresetId: "",
  startupPresetApplied: false,
  contextMode: null,
  activeDetailTab: "raw",
  captureRunning: false,
  captureTransition: false,
  captureToken: 0,
  captureStopLatchUntil: 0,
  captureStopRequestedAt: 0,
  importPickerLockedUntil: 0,
  pollTimer: null,
  flushTimer: null,
  filterTimer: null,
  renderPending: false,
  logEmptySignature: "",
  surfaceMode: "logs-empty",
  surfaceSignature: "",
  metaRenderTimer: null,
  anchorRenderTimer: null,
  timelineBuildTimer: null,
  timelineBuildJobId: 0,
  timelineBuildError: "",
  timelineBuildPending: false,
  timelineStaleWhileViewing: false,
  rowHeight: 36,
  maxLogs: 100000,
  nextRawIndex: 0,
  pendingLines: [],
  allVersion: 0,
  filteredVersion: 0,
  eventsVersion: -1,
  timelineVersion: -1,
  activeLogView: "logs",
  logViewSwitchVersion: 0,
  timelineType: "all",
  timelineQuery: "",
  lastFilterKey: "",
  stderrLines: [],
  stdoutLines: [],
  processPackageCache: {},
  lastProcessPackageRefreshAt: 0,
  processPackageRefreshPromise: null,
  visibleColumns: new Set(DEFAULT_COLUMNS),
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  anchorCollapsed: {},
  anchorFilteredOnly: false,
  flashingRawIndex: null,
  clearFlashTimer: null,
  selectedLogRawIndexes: new Set(),
  lastSelectionRawIndex: null,
  highlightRegex: null,
  searchRegex: null,
  highlightRegexError: "",
  searchRegexError: "",
  programmaticScroll: false,
  programmaticScrollTimer: null,
  activeFind: null,
  textSelectionPauseUntil: 0,
  textSelectionRenderTimer: null,
  columnResize: null,
  quickFilters: {
    errors: { active: false, before: null },
    crash: { active: false, before: null },
    anr: { active: false, before: null },
  },
};

const QUICK_FILTER_CONFIG = {
  errors: {
    buttonId: "quickErrorBtn",
    target: { level: "E,F" },
    fields: ["level"],
  },
  crash: {
    buttonId: "quickCrashBtn",
    target: { keyword: "re:FATAL EXCEPTION|Exception|NullPointerException", keywordEnabled: true },
    fields: ["keyword", "keywordEnabled"],
  },
  anr: {
    buttonId: "quickAnrBtn",
    target: { keyword: "re:ANR|Input dispatching timed out", keywordEnabled: true },
    fields: ["keyword", "keywordEnabled"],
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function iconSvg(name, extraClass = "") {
  const classes = ["ui-icon", extraClass].filter(Boolean).join(" ");
  return `<svg class="${attr(classes)}" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${attr(name)}"></use></svg>`;
}

function iconLabel(icon, label) {
  return `${iconSvg(icon)}<span>${escapeHtml(label)}</span>`;
}

function isFilterEnabled(id) {
  const toggle = byId(id);
  return !toggle || Boolean(toggle.checked);
}

function safeRegex(pattern, flags = "i") {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRegexFlags(flags = "", fallback = "i", required = "") {
  const allowed = new Set("dgimsuvy".split(""));
  const output = [];
  for (const char of String(flags || fallback || "")) {
    if (allowed.has(char) && !output.includes(char)) output.push(char);
  }
  for (const char of String(required || "")) {
    if (allowed.has(char) && !output.includes(char)) output.push(char);
  }
  return output.join("");
}

function explicitRegexParts(pattern) {
  const source = String(pattern || "").trim();
  if (source.startsWith("re:")) return { pattern: source.slice(3).trim(), flags: "" };
  const match = source.match(/^\/(.+)\/([dgimsuvy]*)$/);
  if (!match) return null;
  return { pattern: match[1], flags: match[2] || "" };
}

function parseContainsExpression(source) {
  return String(source || "")
    .split("|")
    .map((orPart) => orPart
      .split("&")
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean))
    .filter((terms) => terms.length);
}

function expressionTerms(groups) {
  return [...new Set(groups.flat())];
}

function compileTextMatcher(pattern, flags = "i") {
  const source = String(pattern || "").trim();
  if (!source) return { test: () => true, regex: null, error: "", mode: "empty" };
  const required = flags.includes("g") ? "g" : "";
  const explicit = explicitRegexParts(source);
  if (explicit) {
    try {
      const regex = new RegExp(explicit.pattern, normalizeRegexFlags(explicit.flags, flags, required));
      return {
        regex,
        error: "",
        mode: "regex",
        test: (value) => {
          regex.lastIndex = 0;
          return regex.test(String(value || ""));
        },
      };
    } catch (error) {
      return { test: () => false, regex: null, error: error.message || "正则表达式无效", mode: "regex" };
    }
  }
  const groups = parseContainsExpression(source);
  const terms = expressionTerms(groups);
  const regexSource = terms.length ? terms.map(escapeRegExp).join("|") : escapeRegExp(source);
  const regex = safeRegex(regexSource, normalizeRegexFlags("", flags, required));
  return {
    regex,
    error: "",
    mode: groups.length > 1 || groups.some((termsInGroup) => termsInGroup.length > 1) ? "logical-contains" : "contains",
    test: (value) => {
      const haystack = String(value || "").toLowerCase();
      return groups.some((termsInGroup) => termsInGroup.every((term) => haystack.includes(term)));
    },
  };
}

function compileUserRegex(pattern, flags = "i") {
  const source = String(pattern || "").trim();
  if (!source) return { regex: null, error: "" };
  try {
    return { regex: new RegExp(source, flags), error: "" };
  } catch (error) {
    return { regex: null, error: error.message || "正则表达式无效" };
  }
}

function buildSearchRegex() {
  const enabled = isFilterEnabled("keywordFilterEnabled");
  const pattern = byId("keywordFilter")?.value.trim() || "";
  state.searchRegexError = "";
  state.searchRegex = null;
  if (!enabled || !pattern) return null;
  const result = compileTextMatcher(pattern, "gi");
  state.searchRegex = result.regex;
  state.searchRegexError = result.error;
  return state.searchRegex;
}

function buildHighlightRegex() {
  const input = byId("highlightRegex");
  const enabled = isFilterEnabled("highlightRegexEnabled");
  const pattern = input?.value.trim() || "";
  state.highlightRegexError = "";
  state.highlightRegex = null;
  if (!enabled || !pattern) return null;
  const result = compileUserRegex(pattern, "gi");
  state.highlightRegex = result.regex;
  state.highlightRegexError = result.error;
  return state.highlightRegex;
}

function buildFindRegex() {
  const field = byId("filterFindField")?.value || "";
  const query = byId("filterFindInput")?.value.trim() || "";
  if (!field || !query) return null;
  const config = FIND_FIELD_CONFIG[field];
  if (!config) return null;
  const result = config.regexOnly ? compileUserRegex(query, "gi") : compileTextMatcher(query, "gi");
  if (result.error) return null;
  return result.regex;
}

function highlightHtml(value, extraRegexes = []) {
  const text = String(value ?? "");
  const regexes = [state.searchRegex, state.highlightRegex, ...extraRegexes].filter(Boolean);
  if (!regexes.length) return escapeHtml(text);

  const ranges = [];
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match;
    let guard = 0;
    while ((match = regex.exec(text)) && guard < 300) {
      guard += 1;
      const hit = match[0];
      if (!hit) {
        regex.lastIndex += 1;
        continue;
      }
      ranges.push({ start: match.index, end: match.index + hit.length });
    }
  }
  if (!ranges.length) return escapeHtml(text);
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) merged.push({ ...range });
    else last.end = Math.max(last.end, range.end);
  }
  let html = "";
  let lastIndex = 0;
  for (const range of merged) {
    html += escapeHtml(text.slice(lastIndex, range.start));
    html += `<mark class="log-highlight-hit">${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    lastIndex = range.end;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function regexMatches(value, pattern) {
  const source = String(pattern || "").trim();
  if (!source) return true;
  const result = compileTextMatcher(source, "i");
  if (result.error) return false;
  return result.test(value);
}

function isRecognizedLogcatLine(line) {
  const text = String(line || "");
  return /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(?:(\d+)\s+)?(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/.test(text)
    || /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(?:(\d+)\s+)?(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/.test(text)
    || /^[VDIWEF]\/[^\s(]+\s*\(\s*\d+\):/.test(text);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function formatRawLine(log) {
  if (!log) return "";
  return log.raw || `${log.timestamp} ${log.pid} ${log.tid} ${log.level} ${log.tag}: ${log.message}`;
}

function logcatTimeStamp(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.000`;
}

function normalizeLogcatSinceInput(value) {
  const text = String(value || "").trim();
  if (!text) return logcatTimeStamp();
  if (/^\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/.test(text)) {
    const [datePart, timePart] = text.split(/\s+/);
    const parts = timePart.split(".");
    const main = parts[0].split(":");
    const hhmmss = main.length === 2 ? `${main[0]}:${main[1]}:00` : main.join(":");
    const millis = (parts[1] || "000").padEnd(3, "0").slice(0, 3);
    return `${datePart} ${hhmmss}.${millis}`;
  }
  if (/^\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/.test(text)) {
    const datePart = logcatTimeStamp().slice(0, 5);
    return normalizeLogcatSinceInput(`${datePart} ${text}`);
  }
  return text;
}

function fillDefaultCaptureSince(force = false) {
  const input = byId("captureSinceInput");
  if (!input) return;
  if (force || !input.value.trim()) input.value = logcatTimeStamp();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportTimestamp() {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const now = new Date();
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function setStatus(text, kind = "idle") {
  state.statusText = text;
  state.statusKind = kind;
  const status = byId("captureStatus");
  if (status) {
    status.textContent = text;
    status.dataset.kind = kind;
  }
  renderCaptureState();
}

function setCaptureNotice(text, kind = "idle") {
  state.captureNotice = text;
  state.captureKind = kind;
  renderCaptureState();
}

function renderCaptureState() {
  const panel = byId("captureState");
  if (!panel) return;
  const kind = state.captureRunning ? "running" : state.captureKind;
  panel.dataset.kind = kind;
  document.body.classList.toggle("is-capturing", state.captureRunning);
  const text = byId("captureStateText");
  const meta = byId("captureStateMeta");
  const visibleCount = currentViewerLogs().length;
  const sessionCount = state.sessions.filter((session) => session.running).length || state.sessions.length;
  if (text) {
    text.textContent = state.captureRunning ? "正在实时抓取 Logcat" : (state.captureNotice || (state.allLogs.length ? "当前未采集" : "未开始采集"));
  }
  if (meta) {
    const parts = state.captureRunning
      ? [`Session ${sessionCount}`, `内存 ${state.allLogs.length.toLocaleString()} 行`, `过滤 ${visibleCount.toLocaleString()} 行`]
      : [`内存 ${state.allLogs.length.toLocaleString()} 行`, `过滤 ${visibleCount.toLocaleString()} 行`];
    if (state.lastBatchSize) parts.push(`新增 ${state.lastBatchSize.toLocaleString()} 行`);
    if (state.lastLogAt) parts.push(state.lastLogAt);
    meta.textContent = parts.join(" · ");
  }
  const startBtn = byId("startCaptureBtn");
  if (startBtn) {
    const starting = state.captureKind === "starting" || (state.captureTransition && !state.captureRunning && state.sessions.length === 0);
    const stopping = state.captureKind === "stopping";
    const canStop = state.captureRunning || starting || state.sessions.length > 0;
    const label = stopping
      ? "停止中..."
      : (canStop ? "停止抓取" : (state.allLogs.length ? "继续抓取" : "开始抓取"));
    const icon = canStop || stopping
      ? `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.75 6.75h10.5v10.5H6.75z"/></svg>`
      : `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.75c0-.9.98-1.46 1.76-1.01l9.23 5.33c.78.45.78 1.57 0 2.02l-9.23 5.33A1.17 1.17 0 0 1 8 16.41V5.75Z"/></svg>`;
    startBtn.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;
    startBtn.setAttribute("aria-pressed", canStop ? "true" : "false");
    // 启动中也必须允许点击停止；禁用按钮会造成 VOC：用户点击停止没有任何反应。
    startBtn.disabled = false;
    startBtn.classList.toggle("is-loading", starting || stopping);
    startBtn.classList.toggle("btn-primary", !canStop && !stopping);
    startBtn.classList.toggle("btn-danger", canStop || stopping);
    startBtn.title = canStop || stopping ? "立即停止当前实时采集，已显示日志会保留" : "从点击后的时间开始继续抓取新日志";
  }
}

function normalizeLevel(level) {
  const value = String(level || "I").trim().toUpperCase();
  return "VDIWEF".includes(value) ? value : "I";
}

function normalizeProcessPackageName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/\b([A-Za-z][\w$]*(?:\.[\w$]+)+)(?::[\w.$-]+)?\b/);
  return match ? match[1] : "";
}

function processPackageEntry(deviceId, pid) {
  if (!deviceId || !pid) return null;
  const entry = state.processPackageCache[deviceId];
  return entry?.pidMap?.[String(pid)] || null;
}

function inferPackageName(message, tag) {
  const text = `${message || ""} ${tag || ""}`;
  const match = text.match(/\b([a-zA-Z][\w$]*(?:\.[\w$]+){1,})\b/);
  return match ? match[1] : "";
}

function resolveLogProcessInfo(deviceId, pid, message, tag) {
  const processEntry = processPackageEntry(deviceId, pid);
  const packageName = normalizeProcessPackageName(processEntry?.packageName || processEntry?.processName || "");
  const inferred = inferPackageName(message, tag);
  return {
    processName: processEntry?.processName || "",
    packageName: packageName || inferred,
    packageSource: packageName ? "ps" : (inferred ? "inferred" : ""),
  };
}

function parseLogLine(raw, deviceId, rawIndex) {
  const line = String(raw || "").replace(/\r$/, "");
  let timestamp = "";
  let uid = "";
  let pid = "";
  let tid = "";
  let level = "I";
  let tag = "raw";
  let message = line;
  let parsedFormat = "raw";

  // Android logcat -v threadtime commonly has:
  // MM-DD HH:MM:SS.mmm  PID  TID  L TAG: message
  // Some vendor / txt exports add UID before PID/TID:
  // MM-DD HH:MM:SS.mmm  UID  PID  TID  L TAG: message
  // The extra unknown number in the user's sample is inferred as UID.
  const logcat = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(?:(\d+)\s+)?(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/);
  const yearTime = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(?:(\d+)\s+)?(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/);
  const brief = line.match(/^([VDIWEF])\/([^\s(]+)\s*\(\s*(\d+)\):\s?(.*)$/);

  if (logcat || yearTime) {
    const match = logcat || yearTime;
    timestamp = match[1];
    uid = match[2] || "";
    pid = match[3];
    tid = match[4];
    level = normalizeLevel(match[5]);
    tag = match[6].trim();
    message = match[7] || "";
    parsedFormat = uid ? "threadtime_uid" : "threadtime";
  } else if (brief) {
    level = normalizeLevel(brief[1]);
    tag = brief[2].trim();
    pid = brief[3];
    tid = brief[3];
    message = brief[4] || "";
    parsedFormat = "brief";
  }

  const processInfo = resolveLogProcessInfo(deviceId || "-", pid, message, tag);

  return {
    id: `${rawIndex}-${Math.random().toString(36).slice(2, 8)}`,
    rawIndex,
    timestamp,
    uid,
    pid,
    tid,
    level,
    tag,
    processName: processInfo.processName,
    packageName: processInfo.packageName,
    packageSource: processInfo.packageSource,
    message,
    raw: line,
    deviceId: deviceId || "-",
    parsedFormat,
  };
}

function appendRawLines(lines, deviceId) {
  const cleanLines = lines.filter((line) => line !== undefined && line !== null && String(line).length);
  if (!cleanLines.length) return;
  state.pendingLines.push({ lines: cleanLines, deviceId: deviceId || "-" });
  scheduleFlushLogs();
}

function scheduleFlushLogs(delay = 24) {
  if (state.flushTimer) return;
  state.flushTimer = window.setTimeout(flushPendingLogs, delay);
}

function flushPendingLogs() {
  window.clearTimeout(state.flushTimer);
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  // 保持停止按钮可响应：日志抓取时可能一次返回大量行，不能在一个 JS tick 内
  // 同步 parse/filter/render 几千上万行，否则用户点“停止抓取”会被主线程阻塞，表现为没反应。
  const MAX_LINES_PER_FLUSH = state.captureRunning ? 700 : 1800;
  const batch = [];
  let consumed = 0;

  while (state.pendingLines.length && consumed < MAX_LINES_PER_FLUSH) {
    const item = state.pendingLines[0];
    const remaining = MAX_LINES_PER_FLUSH - consumed;
    const slice = item.lines.splice(0, remaining);
    consumed += slice.length;
    for (const line of slice) {
      batch.push(parseLogLine(line, item.deviceId, state.nextRawIndex));
      state.nextRawIndex += 1;
    }
    if (!item.lines.length) state.pendingLines.shift();
  }

  if (state.pendingLines.length) scheduleFlushLogs(0);
  if (!batch.length) return;
  state.lastBatchSize = batch.length;
  state.lastLogAt = new Date().toLocaleTimeString();
  for (const log of batch) state.rawIndexMap.set(log.rawIndex, log);
  state.allLogs.push(...batch);
  state.stdoutLines.push(...batch.map(formatRawLine));
  state.stdoutLines = state.stdoutLines.slice(-3000);
  state.allVersion += batch.length;
  appendRuntimeEvents(batch);
  const trimmed = enforceLogLimit();
  applyFilters({ appendedLogs: trimmed ? null : batch, force: trimmed, render: true });
  scheduleAnchorRender();
}

function enforceLogLimit() {
  const overflow = state.allLogs.length - state.maxLogs;
  if (overflow <= 0) return false;
  const removed = state.allLogs.splice(0, overflow);
  for (const log of removed) state.rawIndexMap.delete(log.rawIndex);
  const firstKept = state.allLogs[0]?.rawIndex ?? state.nextRawIndex;
  state.filteredLogs = state.filteredLogs.filter((log) => log.rawIndex >= firstKept);
  state.runtimeEvents = state.runtimeEvents.filter((event) => event.rawIndex >= firstKept);
  state.manualAnchors = state.manualAnchors.map((anchor) => ({ ...anchor, trimmed: anchor.rawIndex < firstKept }));
  if (state.contextMode && state.contextMode.rawIndex < firstKept) state.contextMode = null;
  if (state.currentAnchor && state.currentAnchor.rawIndex < firstKept) state.currentAnchor = null;
  if (state.ghostAnchor && state.ghostAnchor.rawIndex < firstKept) clearGhostAnchor();
  state.stderrLines.push(`Log Workbench trimmed ${removed.length} old rows, kept latest ${state.maxLogs}.`);
  state.stderrLines = state.stderrLines.slice(-1000);
  state.lastFilterKey = "";
  return true;
}

function allLogSourceIds() {
  return [
    ...state.devices.map((device) => device.serial).filter(Boolean),
    ...state.fileSources.map((source) => source.id).filter(Boolean),
  ];
}

function selectedLogSources() {
  const checked = [...document.querySelectorAll("[data-device-log-toggle]:checked")]
    .map((input) => input.value)
    .filter(Boolean);
  const selected = byId("deviceSelect")
    ? [...byId("deviceSelect").selectedOptions].map((option) => option.value).filter(Boolean)
    : [];
  const all = allLogSourceIds();
  return checked.length ? checked : (selected.length ? selected : all);
}

function selectedCaptureDeviceSerials() {
  const checked = [...document.querySelectorAll('[data-device-log-toggle][data-source-kind="device"]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
  const online = state.devices.map((device) => device.serial).filter(Boolean);
  return checked.length ? checked : online;
}

function selectedDeviceSerials() {
  return selectedLogSources();
}

function collectFilters() {
  buildHighlightRegex();
  const mode = "multi";
  const selectedDevices = new Set(selectedLogSources());
  const levels = new Set(String(byId("levelFilter").value || "V,D,I,W,E,F").split(",").filter(Boolean));
  return {
    mode,
    selectedDevices,
    levels,
    tagEnabled: isFilterEnabled("tagFilterEnabled"),
    pidEnabled: isFilterEnabled("pidFilterEnabled"),
    tidEnabled: isFilterEnabled("tidFilterEnabled"),
    packageEnabled: isFilterEnabled("packageFilterEnabled"),
    timeEnabled: isFilterEnabled("timeFilterEnabled"),
    keywordEnabled: isFilterEnabled("keywordFilterEnabled"),
    keywordExcludeEnabled: isFilterEnabled("keywordExcludeFilterEnabled"),
    highlightEnabled: isFilterEnabled("highlightRegexEnabled"),
    highlightRegex: byId("highlightRegex")?.value.trim() || "",
    tag: byId("tagFilter").value.trim(),
    pid: byId("pidFilter").value.trim(),
    tid: byId("tidFilter").value.trim(),
    packageName: byId("packageFilter").value.trim(),
    timeStart: byId("timeStart").value.trim(),
    timeEnd: byId("timeEnd").value.trim(),
    keyword: byId("keywordFilter").value.trim(),
    keywordExclude: byId("keywordExcludeFilter")?.value.trim() || "",
  };
}

function currentFilterSnapshot() {
  return {
    mode: "multi",
    selectedDevices: selectedLogSources(),
    level: byId("levelFilter").value || "V,D,I,W,E,F",
    tagEnabled: isFilterEnabled("tagFilterEnabled"),
    pidEnabled: isFilterEnabled("pidFilterEnabled"),
    tidEnabled: isFilterEnabled("tidFilterEnabled"),
    packageEnabled: isFilterEnabled("packageFilterEnabled"),
    timeEnabled: isFilterEnabled("timeFilterEnabled"),
    keywordEnabled: isFilterEnabled("keywordFilterEnabled"),
    keywordExcludeEnabled: isFilterEnabled("keywordExcludeFilterEnabled"),
    highlightEnabled: isFilterEnabled("highlightRegexEnabled"),
    highlightRegex: byId("highlightRegex")?.value.trim() || "",
    tag: byId("tagFilter").value.trim(),
    pid: byId("pidFilter").value.trim(),
    tid: byId("tidFilter").value.trim(),
    packageName: byId("packageFilter").value.trim(),
    timeStart: byId("timeStart").value.trim(),
    timeEnd: byId("timeEnd").value.trim(),
    keyword: byId("keywordFilter").value.trim(),
    keywordExclude: byId("keywordExcludeFilter")?.value.trim() || "",
  };
}

function quickFilterSnapshot(kind) {
  const config = QUICK_FILTER_CONFIG[kind];
  if (!config) return {};
  const values = {
    level: byId("levelFilter")?.value || "V,D,I,W,E,F",
    keyword: byId("keywordFilter")?.value || "",
    keywordEnabled: isFilterEnabled("keywordFilterEnabled"),
  };
  return Object.fromEntries(config.fields.map((field) => [field, values[field]]));
}

function quickSnapshotEquals(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function applyQuickFilterSnapshot(snapshot = {}) {
  if (Object.prototype.hasOwnProperty.call(snapshot, "level") && byId("levelFilter")) {
    byId("levelFilter").value = snapshot.level || "V,D,I,W,E,F";
    renderLevelPicker();
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "keyword") && byId("keywordFilter")) {
    byId("keywordFilter").value = snapshot.keyword || "";
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "keywordEnabled") && byId("keywordFilterEnabled")) {
    byId("keywordFilterEnabled").checked = snapshot.keywordEnabled ?? true;
  }
}

function quickFilterMatchesTarget(kind) {
  const config = QUICK_FILTER_CONFIG[kind];
  return Boolean(config) && quickSnapshotEquals(quickFilterSnapshot(kind), config.target);
}

function renderQuickFilterButtons() {
  let menuActive = false;
  Object.entries(QUICK_FILTER_CONFIG).forEach(([kind, config]) => {
    const button = byId(config.buttonId);
    if (!button) return;
    const active = Boolean(state.quickFilters[kind]?.active) && quickFilterMatchesTarget(kind);
    button.classList.toggle("active", active);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    if (["errors", "anr"].includes(kind) && active) menuActive = true;
  });
  byId("quickFilterMenu")?.classList.toggle("has-active-filter", menuActive);
}

function syncQuickFilterState() {
  Object.keys(QUICK_FILTER_CONFIG).forEach((kind) => {
    if (!state.quickFilters[kind]?.active) return;
    if (quickFilterMatchesTarget(kind)) return;
    state.quickFilters[kind] = { active: false, before: null };
  });
  renderQuickFilterButtons();
}

function applyFilterSnapshot(filters = {}) {
  if (byId("deviceMode")) byId("deviceMode").value = "multi";
  byId("levelFilter").value = filters.level || "V,D,I,W,E,F";
  byId("tagFilter").value = filters.tag || "";
  byId("pidFilter").value = filters.pid || "";
  byId("tidFilter").value = filters.tid || "";
  byId("packageFilter").value = filters.packageName || "";
  byId("timeStart").value = filters.timeStart || "";
  byId("timeEnd").value = filters.timeEnd || "";
  byId("keywordFilter").value = filters.keyword || "";
  if (byId("keywordExcludeFilter")) byId("keywordExcludeFilter").value = filters.keywordExclude || "";
  if (byId("highlightRegex")) byId("highlightRegex").value = filters.highlightRegex || "";
  ["tagFilterEnabled", "pidFilterEnabled", "tidFilterEnabled", "packageFilterEnabled", "timeFilterEnabled", "keywordFilterEnabled", "keywordExcludeFilterEnabled", "highlightRegexEnabled"].forEach((id) => {
    if (byId(id)) byId(id).checked = filters[id.replace("Filter", "").replace("Enabled", "Enabled")] ?? filters[id] ?? true;
  });
  if (byId("tagFilterEnabled")) byId("tagFilterEnabled").checked = filters.tagEnabled ?? true;
  if (byId("pidFilterEnabled")) byId("pidFilterEnabled").checked = filters.pidEnabled ?? true;
  if (byId("tidFilterEnabled")) byId("tidFilterEnabled").checked = filters.tidEnabled ?? true;
  if (byId("packageFilterEnabled")) byId("packageFilterEnabled").checked = filters.packageEnabled ?? true;
  if (byId("timeFilterEnabled")) byId("timeFilterEnabled").checked = filters.timeEnabled ?? true;
  if (byId("keywordFilterEnabled")) byId("keywordFilterEnabled").checked = filters.keywordEnabled ?? true;
  if (byId("keywordExcludeFilterEnabled")) byId("keywordExcludeFilterEnabled").checked = filters.keywordExcludeEnabled ?? true;
  if (byId("highlightRegexEnabled")) byId("highlightRegexEnabled").checked = filters.highlightEnabled ?? true;
  renderLevelPicker();
  const selected = new Set(filters.selectedDevices || []);
  [...byId("deviceSelect").options].forEach((option) => {
    option.selected = selected.size ? selected.has(option.value) : true;
  });
  syncDeviceCheckboxes(selected);
  state.contextMode = null;
  state.lastFilterKey = "";
  applyFilters({ force: true, render: true });
}

function levelLabel(value) {
  const map = {
    "V,D,I,W,E,F": "All",
    "E,F": "Error/Fatal",
    "W,E,F": "Warn+",
    "I,W,E,F": "Info+",
    "D,I,W,E,F": "Debug+",
  };
  return map[value] || value || "All";
}

function filterPresetSummary(filters = {}) {
  const parts = [levelLabel(filters.level)];
  if (filters.tag) parts.push(`Tag:${filters.tag}`);
  if (filters.packageName) parts.push(`Pkg:${filters.packageName}`);
  if (filters.pid) parts.push(`PID:${filters.pid}`);
  if (filters.tid) parts.push(`TID:${filters.tid}`);
  if (filters.keyword) parts.push(`MsgRegex:${filters.keyword}`);
  if (filters.keywordExclude) parts.push(`排除:${filters.keywordExclude}`);
  return parts.slice(0, 4).join(" · ");
}

function suggestedFilterPresetName(filters = currentFilterSnapshot()) {
  const summary = filterPresetSummary(filters);
  return summary && summary !== "All" ? summary : `过滤组合 ${state.filterPresets.length + 1}`;
}

function loadFilterPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_PRESET_STORAGE_KEY) || "[]");
    state.filterPresets = Array.isArray(parsed)
      ? parsed.filter((item) => item && item.id && item.name && item.filters).slice(0, 60)
      : [];
  } catch {
    state.filterPresets = [];
  }
  state.lastFilterPresetId = localStorage.getItem(FILTER_PRESET_LAST_STORAGE_KEY) || "";
}

function persistFilterPresets() {
  localStorage.setItem(FILTER_PRESET_STORAGE_KEY, JSON.stringify(state.filterPresets));
}

function persistLastFilterPreset(id = "") {
  state.lastFilterPresetId = id || "";
  if (id) localStorage.setItem(FILTER_PRESET_LAST_STORAGE_KEY, id);
  else localStorage.removeItem(FILTER_PRESET_LAST_STORAGE_KEY);
}

function selectedFilterPreset() {
  const id = byId("filterPresetSelect").value;
  return state.filterPresets.find((preset) => preset.id === id) || null;
}

function updateFilterPresetMeta() {
  const preset = selectedFilterPreset();
  const meta = byId("filterPresetMeta");
  if (!meta) return;
  meta.textContent = preset ? filterPresetSummary(preset.filters) : "保存当前过滤组合";
}

function renderFilterPresets() {
  const select = byId("filterPresetSelect");
  if (!select) return;
  const current = select.value || state.lastFilterPresetId || state.filterPresets[0]?.id || "";
  select.innerHTML = `<option value="">选择过滤组合</option>${state.filterPresets.map((preset) => `
    <option value="${attr(preset.id)}">${escapeHtml(preset.name)}</option>
  `).join("")}`;
  select.value = state.filterPresets.some((preset) => preset.id === current) ? current : "";
  if (select.value) {
    const preset = state.filterPresets.find((item) => item.id === select.value);
    if (byId("filterPresetName")) byId("filterPresetName").value = preset?.name || "";
  }
  byId("filterPresetCount").textContent = String(state.filterPresets.length);
  updateFilterPresetMeta();
}

function applyStartupFilterPreset() {
  if (state.startupPresetApplied) return false;
  state.startupPresetApplied = true;
  if (!state.filterPresets.length) return false;
  const select = byId("filterPresetSelect");
  const id = select?.value || state.lastFilterPresetId || state.filterPresets[0]?.id || "";
  const preset = state.filterPresets.find((item) => item.id === id) || state.filterPresets[0];
  if (!preset) return false;
  if (select) select.value = preset.id;
  if (byId("filterPresetName")) byId("filterPresetName").value = preset.name;
  persistLastFilterPreset(preset.id);
  applyFilterSnapshot(preset.filters);
  updateFilterPresetMeta();
  setStatus(`已加载常用过滤：${preset.name}`, "ready");
  return true;
}

function saveFilterPreset() {
  const filters = currentFilterSnapshot();
  const existing = selectedFilterPreset();
  const rawName = byId("filterPresetName").value.trim() || existing?.name || suggestedFilterPresetName(filters);
  const duplicate = state.filterPresets.find((preset) => preset.name === rawName);
  const target = existing || duplicate;
  const preset = {
    id: target?.id || `preset:${Date.now()}:${stableHash(rawName)}`,
    name: rawName,
    filters,
    updatedAt: new Date().toISOString(),
  };
  if (target) {
    state.filterPresets = state.filterPresets.map((item) => item.id === target.id ? { ...item, ...preset } : item);
  } else {
    state.filterPresets.unshift(preset);
  }
  state.filterPresets = state.filterPresets.slice(0, 60);
  persistFilterPresets();
  persistLastFilterPreset(preset.id);
  renderFilterPresets();
  renderColumnPicker();
  renderLevelPicker();
  byId("filterPresetSelect").value = preset.id;
  byId("filterPresetName").value = preset.name;
  updateFilterPresetMeta();
  setStatus(`已保存过滤组合：${preset.name}`, "ready");
}

function applySelectedFilterPreset() {
  const preset = selectedFilterPreset();
  if (!preset) {
    setStatus("请选择一个过滤组合", "error");
    return;
  }
  byId("filterPresetName").value = preset.name;
  persistLastFilterPreset(preset.id);
  applyFilterSnapshot(preset.filters);
  updateFilterPresetMeta();
  setStatus(`已套用过滤组合：${preset.name}`, "ready");
}

function deleteSelectedFilterPreset() {
  const preset = selectedFilterPreset();
  if (!preset) {
    setStatus("请选择要删除的过滤组合", "error");
    return;
  }
  const ok = window.confirm(`确认删除过滤组合「${preset.name}」吗？\n\n删除后不可恢复，但不会影响当前日志内容。`);
  if (!ok) {
    setStatus("已取消删除过滤组合", "ready");
    return;
  }
  state.filterPresets = state.filterPresets.filter((item) => item.id !== preset.id);
  if (state.lastFilterPresetId === preset.id) persistLastFilterPreset(state.filterPresets[0]?.id || "");
  persistFilterPresets();
  byId("filterPresetName").value = "";
  renderFilterPresets();
  renderColumnPicker();
  renderLevelPicker();
  setStatus(`已删除过滤组合：${preset.name}`, "ready");
}

function filterKey(filters) {
  return JSON.stringify({
    mode: filters.mode,
    selectedDevices: [...filters.selectedDevices].sort(),
    levels: [...filters.levels].sort(),
    tag: filters.tag,
    pid: filters.pid,
    tid: filters.tid,
    packageName: filters.packageName,
    timeStart: filters.timeStart,
    timeEnd: filters.timeEnd,
    keyword: filters.keyword,
    tagEnabled: filters.tagEnabled,
    pidEnabled: filters.pidEnabled,
    tidEnabled: filters.tidEnabled,
    packageEnabled: filters.packageEnabled,
    timeEnabled: filters.timeEnabled,
    keywordEnabled: filters.keywordEnabled,
    keywordExcludeEnabled: filters.keywordExcludeEnabled,
    keywordExclude: filters.keywordExclude,
    highlightEnabled: filters.highlightEnabled,
    highlightRegex: filters.highlightRegex,
  });
}

function matchesKeyword(log, filters) {
  if (filters.keywordEnabled && filters.keyword && !regexMatches(log.message, filters.keyword)) return false;
  if (filters.keywordExcludeEnabled && filters.keywordExclude && regexMatches(log.message, filters.keywordExclude)) return false;
  return true;
}

function parseLogTimestampParts(timestamp) {
  const text = String(timestamp || "").trim();
  let match = text.match(/^(?:\d{4}-)?(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!match) return null;
  return {
    month: Number(match[1]),
    day: Number(match[2]),
    hour: Number(match[3]),
    minute: Number(match[4]),
    second: Number(match[5]),
    ms: Number((match[6] || "0").padEnd(3, "0").slice(0, 3)),
  };
}

function timePartsToComparable(parts) {
  if (!parts) return null;
  return (((((parts.month * 31 + parts.day) * 24 + parts.hour) * 60 + parts.minute) * 60 + parts.second) * 1000) + parts.ms;
}

function parseTimeFilterValue(value, baseParts) {
  const text = String(value || "").trim();
  if (!text) return null;
  const base = baseParts || { month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 };
  let match = text.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (match) {
    return timePartsToComparable({
      month: Number(match[1]), day: Number(match[2]), hour: Number(match[3]),
      minute: Number(match[4]), second: Number(match[5]),
      ms: Number((match[6] || "0").padEnd(3, "0").slice(0, 3)),
    });
  }
  match = text.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (match) {
    return timePartsToComparable({
      month: base.month, day: base.day, hour: Number(match[1]),
      minute: Number(match[2]), second: Number(match[3]),
      ms: Number((match[4] || "0").padEnd(3, "0").slice(0, 3)),
    });
  }
  match = text.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (match) {
    return timePartsToComparable({
      month: base.month, day: base.day, hour: base.hour,
      minute: Number(match[1]), second: Number(match[2]),
      ms: Number((match[3] || "0").padEnd(3, "0").slice(0, 3)),
    });
  }
  match = text.match(/^(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (match) {
    return timePartsToComparable({
      month: base.month, day: base.day, hour: base.hour,
      minute: base.minute, second: Number(match[1]),
      ms: Number((match[2] || "0").padEnd(3, "0").slice(0, 3)),
    });
  }
  return null;
}

function logMatchesTimeRange(log, filters) {
  if (!filters.timeEnabled || (!filters.timeStart && !filters.timeEnd)) return true;
  const parts = parseLogTimestampParts(log.timestamp);
  const current = timePartsToComparable(parts);
  if (current == null) return true;
  const start = parseTimeFilterValue(filters.timeStart, parts);
  const end = parseTimeFilterValue(filters.timeEnd, parts);
  if (filters.timeStart && start != null && current < start) return false;
  if (filters.timeEnd && end != null && current > end) return false;
  return true;
}

function logTimestampSortValue(log) {
  const value = timePartsToComparable(parseLogTimestampParts(log?.timestamp));
  return value == null ? null : value;
}

function compareLogsByTime(left, right) {
  const leftRaw = left?.rawIndex ?? 0;
  const rightRaw = right?.rawIndex ?? 0;
  const leftTime = logTimestampSortValue(left);
  const rightTime = logTimestampSortValue(right);

  // Only use timestamp ordering when both rows have a real timestamp.
  // Raw/imported lines without timestamp must keep their original # order instead
  // of being pushed to the end of the table.
  if (leftTime != null && rightTime != null) {
    const timeDelta = leftTime - rightTime;
    if (timeDelta) return timeDelta;
  }
  return leftRaw - rightRaw;
}

function sortLogsByTime(logs) {
  return logs.sort(compareLogsByTime);
}

function mergeSortedLogsByTime(leftLogs, rightLogs) {
  const output = [];
  let left = 0;
  let right = 0;
  while (left < leftLogs.length && right < rightLogs.length) {
    if (compareLogsByTime(leftLogs[left], rightLogs[right]) <= 0) {
      output.push(leftLogs[left]);
      left += 1;
    } else {
      output.push(rightLogs[right]);
      right += 1;
    }
  }
  if (left < leftLogs.length) output.push(...leftLogs.slice(left));
  if (right < rightLogs.length) output.push(...rightLogs.slice(right));
  return output;
}

function logMatchesFilters(log, filters) {
  if (filters.selectedDevices.size && !filters.selectedDevices.has(log.deviceId)) return false;
  if (!filters.levels.has(log.level)) return false;
  if (filters.tagEnabled && filters.tag && !regexMatches(log.tag, filters.tag)) return false;
  if (filters.pidEnabled && filters.pid && !regexMatches(log.pid, filters.pid)) return false;
  if (filters.tidEnabled && filters.tid && !regexMatches(log.tid, filters.tid)) return false;
  if (filters.packageEnabled && filters.packageName && !regexMatches(log.packageName, filters.packageName)) return false;
  if (!logMatchesTimeRange(log, filters)) return false;
  return matchesKeyword(log, filters);
}

function applyFilters(options = {}) {
  const filters = collectFilters();
  syncQuickFilterState();
  buildSearchRegex();
  buildHighlightRegex();
  const key = filterKey(filters);
  const appendedLogs = options.appendedLogs || [];
  if (!options.force && key === state.lastFilterKey && appendedLogs.length && !state.contextMode) {
    const matched = appendedLogs.filter((log) => logMatchesFilters(log, filters));
    if (matched.length) state.filteredLogs = mergeSortedLogsByTime(state.filteredLogs, sortLogsByTime(matched));
    state.filteredVersion += matched.length;
  } else if (options.force || key !== state.lastFilterKey || !appendedLogs.length) {
    state.filteredLogs = sortLogsByTime(state.allLogs.filter((log) => logMatchesFilters(log, filters)));
    state.filteredVersion += 1;
    state.lastFilterKey = key;
  }
  if (state.activeFind) refreshActiveFind();
  reconcileGhostAnchorAfterFilter();
  // Timeline is a key-event snapshot. During live capture, rebuilding it on every
  // poll makes the panel flicker between the event list and the loading state.
  // Keep the current Timeline stable; mark it stale and rebuild when the user
  // enters Timeline or explicitly changes filters, not for every appended batch.
  if (state.activeLogView === "timeline" && appendedLogs.length && !options.force) {
    state.timelineStaleWhileViewing = state.timelineVersion !== state.allVersion;
    updateTimelineBadge();
    if (options.render !== false) {
      renderMeta();
      renderContextBanner();
      renderAnchors();
      renderDetails();
    }
    return;
  }
  if (state.activeLogView !== "timeline") {
    scheduleTimelineBuild(1200, { render: false });
  } else if (options.force || state.timelineVersion !== state.allVersion) {
    scheduleTimelineBuild(120, { render: true, force: options.force === true });
  }
  if (options.render === false) return;
  scheduleRender();
}

const scheduleFilter = debounce(() => applyFilters({ force: true, render: true }), 120);

function timelineApi() {
  return window.LogInsightTimeline || null;
}

function timelineTypeLabel(type) {
  return timelineApi()?.TYPE_LABELS?.[type] || type || "-";
}

function scheduleTimelineBuild(delay = 180, options = {}) {
  window.clearTimeout(state.timelineBuildTimer);
  state.timelineBuildPending = true;
  updateTimelineBadge();
  state.timelineBuildTimer = window.setTimeout(() => rebuildTimelineEvents(options), Math.max(0, delay));
}

function updateTimelineBadge() {
  const badge = byId("timelineCountBadge");
  if (!badge) return;
  // Keep the badge width stable while Timeline is rebuilding. Showing "…"
  // after a real count such as 8 makes the tab flicker and shrink/expand during
  // live capture, so keep the last known count and use a state class instead.
  const count = state.timelineEvents.length;
  badge.textContent = String(count);
  badge.classList.toggle("is-building", Boolean(state.timelineBuildPending));
  badge.classList.toggle("is-stale", Boolean(state.timelineStaleWhileViewing));
  badge.title = state.timelineBuildPending
    ? `Timeline 更新中，当前已识别 ${count} 个事件`
    : state.timelineStaleWhileViewing
      ? `Timeline 显示的是快照，已有新日志进入。当前已识别 ${count} 个事件`
      : `Timeline 已识别 ${count} 个事件`;
}

function cancelTimelineBuild() {
  window.clearTimeout(state.timelineBuildTimer);
  state.timelineBuildJobId += 1;
  state.timelineBuildPending = false;
  updateTimelineBadge();
}

function rebuildTimelineEvents(options = {}) {
  const api = timelineApi();
  const renderWhenDone = options.render !== false;
  window.clearTimeout(state.timelineBuildTimer);

  if (!api) {
    state.timelineBuildJobId += 1;
    state.timelineBuildPending = false;
    state.timelineBuildError = "Timeline 模块未加载";
    updateTimelineBadge();
    if (renderWhenDone && state.activeLogView === "timeline") renderTimeline({ skipEnsure: true });
    return;
  }

  if (state.timelineVersion === state.allVersion && !options.force) {
    state.timelineBuildPending = false;
    updateTimelineBadge();
    if (renderWhenDone && state.activeLogView === "timeline") renderTimeline({ skipEnsure: true });
    return;
  }

  const sourceLogs = [...state.allLogs];
  const sourceVersion = state.allVersion;
  const jobId = state.timelineBuildJobId + 1;
  state.timelineBuildJobId = jobId;
  state.timelineBuildPending = true;
  state.timelineBuildError = "";
  // Keep the current Timeline visible while a new snapshot is being built.
  // Clearing timelineEvents here caused the panel to flicker between the list
  // and the loading state during live Logcat capture.
  updateTimelineBadge();

  // Large log streams can contain tens of thousands of rows. Building Timeline
  // synchronously would block the main thread, so the tab would appear not to
  // switch and Logcat polling would stop repainting. Build in chunks instead.
  const detect = typeof api.detectSystemEvent === "function" ? api.detectSystemEvent : null;
  const chunkSize = options.chunkSize || 1200;
  let cursor = 0;
  const events = [];

  const finish = () => {
    if (state.timelineBuildJobId !== jobId) return;
    events.sort((left, right) => (left.lineIndex || 0) - (right.lineIndex || 0));
    state.timelineEvents = events;
    state.timelineVersion = sourceVersion;
    state.timelineStaleWhileViewing = false;
    state.timelineBuildError = "";
    state.timelineBuildPending = false;
    updateTimelineBadge();
    if (renderWhenDone && state.activeLogView === "timeline") renderTimeline({ skipEnsure: true });
  };

  const fail = (error) => {
    if (state.timelineBuildJobId !== jobId) return;
    console.error("Timeline build failed", error);
    state.timelineEvents = [];
    state.timelineVersion = sourceVersion;
    state.timelineBuildError = error?.message || "Timeline 构建失败";
    state.timelineBuildPending = false;
    updateTimelineBadge();
    if (renderWhenDone && state.activeLogView === "timeline") renderTimeline({ skipEnsure: true });
  };

  if (!detect) {
    window.setTimeout(() => {
      if (state.timelineBuildJobId !== jobId) return;
      try {
        state.timelineEvents = api.buildTimelineEvents(sourceLogs);
        state.timelineVersion = sourceVersion;
        state.timelineStaleWhileViewing = false;
        state.timelineBuildError = "";
        state.timelineBuildPending = false;
        updateTimelineBadge();
        if (renderWhenDone && state.activeLogView === "timeline") renderTimeline({ skipEnsure: true });
      } catch (error) {
        fail(error);
      }
    }, 0);
    return;
  }

  const step = () => {
    if (state.timelineBuildJobId !== jobId) return;
    try {
      const end = Math.min(sourceLogs.length, cursor + chunkSize);
      for (let index = cursor; index < end; index += 1) {
        const event = detect(sourceLogs[index], index);
        if (event) events.push(event);
      }
      cursor = end;
      if (state.activeLogView === "timeline") {
        setTimelineProgressText(`正在识别系统事件 · ${cursor.toLocaleString()} / ${sourceLogs.length.toLocaleString()} 行`);
      }
      if (cursor < sourceLogs.length) {
        window.setTimeout(step, 0);
      } else {
        finish();
      }
    } catch (error) {
      fail(error);
    }
  };

  window.setTimeout(step, 0);
}

function ensureTimelineFresh() {
  if (state.timelineVersion !== state.allVersion && !state.timelineBuildPending) {
    scheduleTimelineBuild(state.activeLogView === "timeline" ? 120 : 800, { render: state.activeLogView === "timeline" });
  }
}

function filteredTimelineEvents(options = {}) {
  if (!options.skipEnsure) ensureTimelineFresh();
  const api = timelineApi();
  if (!api) return [];
  return api.filterTimelineEvents(state.timelineEvents, {
    type: state.timelineType,
    query: state.timelineQuery,
  });
}

function loadColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || "[]");
    const allowed = new Set(DEFAULT_COLUMNS);
    let chosen = Array.isArray(saved) ? saved.filter((col) => allowed.has(col)) : [];
    if (localStorage.getItem(COLUMN_PACKAGE_MIGRATION_KEY) !== "1") {
      const next = chosen.length ? [...chosen] : [...DEFAULT_COLUMNS];
      if (!next.includes("package")) {
        const pidIndex = next.indexOf("pidtid");
        next.splice(pidIndex >= 0 ? pidIndex + 1 : Math.max(0, next.indexOf("tag")), 0, "package");
      }
      chosen = next;
      localStorage.setItem(COLUMN_PACKAGE_MIGRATION_KEY, "1");
    }
    state.visibleColumns = new Set(chosen.length ? chosen : DEFAULT_COLUMNS);
  } catch {
    state.visibleColumns = new Set(DEFAULT_COLUMNS);
  }
  try {
    const savedWidths = JSON.parse(localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY) || "{}");
    state.columnWidths = normalizeColumnWidths(savedWidths);
  } catch {
    state.columnWidths = { ...DEFAULT_COLUMN_WIDTHS };
  }
  try {
    state.anchorCollapsed = JSON.parse(localStorage.getItem(ANCHOR_COLLAPSE_STORAGE_KEY) || "{}") || {};
  } catch {
    state.anchorCollapsed = {};
  }
  for (const kind of ["manual", "crash", "anr", "activity", "binder"]) {
    if (!(kind in state.anchorCollapsed)) state.anchorCollapsed[kind] = false;
  }
}

function persistColumnPrefs() {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...state.visibleColumns]));
}

function normalizeColumnWidths(value) {
  const output = { ...DEFAULT_COLUMN_WIDTHS };
  for (const col of DEFAULT_COLUMNS) {
    const raw = Number(value?.[col]);
    const [min, max] = COLUMN_WIDTH_LIMITS[col] || [40, 1600];
    if (Number.isFinite(raw)) output[col] = Math.max(min, Math.min(max, Math.round(raw)));
  }
  return output;
}

function persistColumnWidths() {
  localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(state.columnWidths));
}

function persistAnchorCollapsed() {
  localStorage.setItem(ANCHOR_COLLAPSE_STORAGE_KEY, JSON.stringify(state.anchorCollapsed));
}

function isAnchorGroupCollapsed(kind) {
  return state.anchorCollapsed[kind] === true;
}

function renderColumnPicker() {
  const panel = byId("columnPickerPanel");
  if (!panel) return;
  panel.innerHTML = DEFAULT_COLUMNS.map((col) => `
    <label class="column-choice">
      <input type="checkbox" data-column-toggle="${attr(col)}" ${state.visibleColumns.has(col) ? "checked" : ""} ${col === "message" ? "disabled" : ""}>
      ${escapeHtml(COLUMN_LABELS[col] || col)}
    </label>
  `).join("");
  applyColumnLayout();
  if (!panel.hidden) placeColumnPickerPanel();
}

function placeFloatingPanel(panel, anchor, options = {}) {
  if (!panel || !anchor) return;
  if (panel.parentElement !== document.body) document.body.appendChild(panel);
  const gap = options.gap ?? 6;
  const anchorRect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth || options.width || 180;
  const height = panel.offsetHeight || options.height || 180;
  const point = options.point;
  let left = point ? point.x - width + 20 : (options.align === "left" ? anchorRect.left : anchorRect.right - width);
  let top = point ? point.y + gap : anchorRect.bottom + gap;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  if (top + height > window.innerHeight - 8 && anchorRect.top - height - gap > 8) {
    top = anchorRect.top - height - gap;
  }
  panel.style.position = "fixed";
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.right = "auto";
  panel.style.marginTop = "0";
  panel.style.zIndex = "10000";
  const placed = panel.getBoundingClientRect();
  if (placed.right > window.innerWidth - 8) left -= placed.right - (window.innerWidth - 8);
  if (placed.left < 8) left += 8 - placed.left;
  if (placed.bottom > window.innerHeight - 8) top -= placed.bottom - (window.innerHeight - 8);
  if (placed.top < 8) top += 8 - placed.top;
  panel.style.left = `${Math.round(Math.max(8, left))}px`;
  panel.style.top = `${Math.round(Math.max(8, top))}px`;
}

function placeColumnPickerPanel() {
  placeFloatingPanel(byId("columnPickerPanel"), byId("columnPickerToggle"), { width: 180 });
}

function placeAdvancedCapturePanel() {
  placeFloatingPanel(
    byId("advancedCapturePanel")?.querySelector(".advanced-capture-body") || document.querySelector(".advanced-capture-body"),
    byId("advancedCapturePanel")?.querySelector("summary"),
    { width: 304 }
  );
}

function placeOpenFloatingPanels() {
  if (!byId("columnPickerPanel")?.hidden) placeColumnPickerPanel();
  if (byId("advancedCapturePanel")?.open) placeAdvancedCapturePanel();
}

function closeFloatingPanelsOutside(target) {
  const advancedPanel = byId("advancedCapturePanel");
  if (advancedPanel?.open && !target.closest("#advancedCapturePanel") && !target.closest(".advanced-capture-body")) {
    setAdvancedCapturePanelOpen(false);
  }
  if (!target.closest("#columnPicker") && !target.closest("#columnPickerPanel")) {
    setColumnPickerOpen(false);
  }
}

function setColumnPickerOpen(open) {
  const panel = byId("columnPickerPanel");
  const toggle = byId("columnPickerToggle");
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.classList.toggle("is-active", Boolean(open));
  if (open) placeColumnPickerPanel();
}

function toggleColumnPicker(event) {
  event.preventDefault();
  event.stopPropagation();
  const panel = byId("columnPickerPanel");
  setColumnPickerOpen(Boolean(panel?.hidden));
}

function toggleAdvancedCapturePanel(event) {
  const panel = event.currentTarget.closest("#advancedCapturePanel");
  if (!panel) return;
  event.preventDefault();
  event.stopPropagation();
  setAdvancedCapturePanelOpen(!panel.open);
  if (panel.open) {
    fillDefaultCaptureSince();
    placeAdvancedCapturePanel();
  }
}

function setAdvancedCapturePanelOpen(open) {
  const panel = byId("advancedCapturePanel");
  const body = panel?.querySelector(".advanced-capture-body") || document.querySelector(".advanced-capture-body");
  if (!panel || !body) return;
  panel.open = Boolean(open);
  body.hidden = !open;
  if (open) placeAdvancedCapturePanel();
}

function visibleLogColumns() {
  return DEFAULT_COLUMNS.filter((col) => state.visibleColumns.has(col));
}

function columnWidth(col) {
  return Number(state.columnWidths[col]) || DEFAULT_COLUMN_WIDTHS[col] || 100;
}

function logGridTemplate() {
  return visibleLogColumns().map((col) => {
    const width = columnWidth(col);
    return col === "message" ? `minmax(${width}px, 1fr)` : `${width}px`;
  }).join(" ");
}

function logGridMinWidth() {
  const columns = visibleLogColumns();
  const gap = 10;
  return columns.reduce((sum, col) => sum + columnWidth(col), 0) + Math.max(0, columns.length - 1) * gap + 20;
}

function ensureColumnResizeHandles() {
  document.querySelectorAll(".log-table-head [data-col]").forEach((node) => {
    if (node.querySelector(".column-resize-handle")) return;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "column-resize-handle";
    handle.dataset.resizeColumn = node.dataset.col;
    handle.title = "拖动调整列宽，双击恢复默认宽度";
    handle.setAttribute("aria-label", `调整 ${COLUMN_LABELS[node.dataset.col] || node.dataset.col} 列宽`);
    node.appendChild(handle);
  });
}

function applyColumnLayout() {
  const template = logGridTemplate();
  const minWidth = `${logGridMinWidth()}px`;
  const head = document.querySelector(".log-table-head");
  if (head) {
    head.style.gridTemplateColumns = template;
    head.style.minWidth = minWidth;
  }
  [byId("logSpacer"), byId("logWindow")].forEach((node) => {
    if (node) node.style.minWidth = minWidth;
  });
  document.querySelectorAll(".log-row").forEach((row) => {
    row.style.gridTemplateColumns = template;
    row.style.minWidth = minWidth;
  });
  document.querySelectorAll("[data-col]").forEach((node) => {
    node.hidden = !state.visibleColumns.has(node.dataset.col);
  });
  ensureColumnResizeHandles();
  syncLogHeaderScroll();
}

function startColumnResize(event, col) {
  if (!col || !DEFAULT_COLUMNS.includes(col)) return;
  event.preventDefault();
  event.stopPropagation();
  const [min, max] = COLUMN_WIDTH_LIMITS[col] || [40, 1600];
  state.columnResize = {
    col,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: columnWidth(col),
    min,
    max,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  document.body.classList.add("is-resizing-log-column");
}

function updateColumnResize(event) {
  const resize = state.columnResize;
  if (!resize) return;
  event.preventDefault();
  const next = Math.max(resize.min, Math.min(resize.max, Math.round(resize.startWidth + event.clientX - resize.startX)));
  if (next === state.columnWidths[resize.col]) return;
  state.columnWidths = { ...state.columnWidths, [resize.col]: next };
  applyColumnLayout();
}

function finishColumnResize() {
  if (!state.columnResize) return;
  state.columnResize = null;
  document.body.classList.remove("is-resizing-log-column");
  persistColumnWidths();
}

function resetColumnWidth(col) {
  if (!col || !DEFAULT_COLUMNS.includes(col)) return;
  state.columnWidths = { ...state.columnWidths, [col]: DEFAULT_COLUMN_WIDTHS[col] };
  persistColumnWidths();
  applyColumnLayout();
}

function columnCell(col, html, className = "cell") {
  if (!state.visibleColumns.has(col)) return "";
  return `<span class="${className}" data-col="${attr(col)}">${html}</span>`;
}


function classifyRuntimeEvent(log) {
  const raw = `${log.tag} ${log.message} ${log.raw}`;
  if (/FATAL EXCEPTION|java\.lang\.[A-Za-z]+Exception/i.test(raw)) return { kind: "crash", label: "Crash", keyword: "FATAL EXCEPTION" };
  if (/Input dispatching timed out|\bANR\b|Application Not Responding/i.test(raw)) return { kind: "anr", label: "ANR", keyword: "ANR" };
  if (/Binder.*timeout|timeout.*Binder|Slow Binder|BpBinder/i.test(raw)) return { kind: "binder", label: "Binder", keyword: "Binder" };
  if (/(ActivityManager|ActivityTaskManager|ActivityThread|WindowManager).*(START|Displayed|Resumed|Paused|Stopping|Force stopping|onResume|onPause|onStop|onDestroy)/i.test(raw)) {
    return { kind: "activity", label: "Activity", keyword: "Activity" };
  }
  return null;
}

function appendRuntimeEvents(logs) {
  for (const log of logs) {
    const event = classifyRuntimeEvent(log);
    if (event) state.runtimeEvents.push({ ...event, logId: log.id, rawIndex: log.rawIndex });
  }
  if (state.runtimeEvents.length > 2000) {
    state.runtimeEvents = state.runtimeEvents.slice(-2000);
  }
  state.eventsVersion = state.allVersion;
}

function rebuildRuntimeEvents() {
  if (state.eventsVersion === state.allVersion) return;
  state.runtimeEvents = [];
  for (const log of state.allLogs) {
    const event = classifyRuntimeEvent(log);
    if (event) state.runtimeEvents.push({ ...event, logId: log.id, rawIndex: log.rawIndex });
  }
  state.eventsVersion = state.allVersion;
}

function anchorFromLog(log, kind = "manual", keyword = "") {
  if (!log) return null;
  return {
    id: `${kind}:${log.rawIndex}:${stableHash(log.raw || log.message || "")}`,
    kind,
    time: log.timestamp || "-",
    line: log.rawIndex,
    device: log.deviceId || "-",
    tag: log.tag || "-",
    level: log.level || "-",
    keyword: keyword || log.tag || "",
    summary: (log.message || log.raw || "").slice(0, 160),
    logId: log.id,
    rawIndex: log.rawIndex,
  };
}

function stableHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function findLogByRawIndex(rawIndex) {
  return state.rawIndexMap.get(Number(rawIndex)) || null;
}

function findLogById(logId) {
  return state.allLogs.find((log) => log.id === logId) || null;
}

function autoAnchors() {
  return state.runtimeEvents.map((event) => {
    const log = findLogByRawIndex(event.rawIndex);
    return anchorFromLog(log, event.kind, event.keyword);
  }).filter(Boolean);
}

function allAnchors() {
  return [...autoAnchors(), ...state.manualAnchors].sort((a, b) => a.rawIndex - b.rawIndex);
}

function ghostAnchorKey(anchor, signature = state.lastFilterKey) {
  return anchor ? `${anchor.rawIndex}:${signature || ""}` : "";
}

function clearGhostAnchor() {
  state.ghostAnchor = null;
}

function dismissGhostAnchor() {
  if (state.ghostAnchor) {
    state.dismissedGhostAnchorKey = ghostAnchorKey(state.ghostAnchor.anchor, state.ghostAnchor.filterSignature);
  }
  clearGhostAnchor();
}

function viewerLogIndexByRawIndex(rawIndex) {
  return currentViewerLogs().findIndex((log) => log.rawIndex === Number(rawIndex));
}

function nearestVisibleLog(rawIndex) {
  const logs = currentViewerLogs();
  if (!logs.length) return null;
  const target = Number(rawIndex);
  let nearest = logs[0];
  let nearestDelta = Math.abs((nearest.rawIndex ?? 0) - target);
  for (const log of logs) {
    const delta = Math.abs((log.rawIndex ?? 0) - target);
    if (delta < nearestDelta) {
      nearest = log;
      nearestDelta = delta;
    }
  }
  return nearest;
}

function setGhostAnchor(anchor, nearestLog, options = {}) {
  if (!anchor || !nearestLog) return false;
  const filterSignature = state.lastFilterKey || filterKey(collectFilters());
  const key = ghostAnchorKey(anchor, filterSignature);
  if (!options.force && key && key === state.dismissedGhostAnchorKey) return false;
  state.ghostAnchor = {
    anchor,
    rawIndex: anchor.rawIndex,
    nearestRawIndex: nearestLog.rawIndex,
    filterSignature,
  };
  return true;
}

function reconcileGhostAnchorAfterFilter() {
  const ghost = state.ghostAnchor;
  if (!ghost) return;
  if (state.contextMode) {
    clearGhostAnchor();
    return;
  }
  const anchor = ghost.anchor || state.currentAnchor;
  if (!anchor || state.currentAnchor?.rawIndex !== anchor.rawIndex) {
    clearGhostAnchor();
    return;
  }
  if (viewerLogIndexByRawIndex(anchor.rawIndex) >= 0) {
    clearGhostAnchor();
    return;
  }
  const nearest = nearestVisibleLog(anchor.rawIndex);
  if (!nearest) {
    clearGhostAnchor();
    return;
  }
  setGhostAnchor(anchor, nearest);
}

function jumpToAnchor(anchor, options = {}) {
  const log = findLogByAnchor(anchor);
  if (!log) {
    setStatus(anchor ? `锚点 #${Number(anchor.rawIndex) + 1} 已不在内存窗口内` : "没有可回到的锚点", "error");
    return;
  }
  state.currentAnchor = anchor || anchorFromLog(log, "manual");
  if (state.contextMode && state.contextMode.rawIndex !== log.rawIndex) state.contextMode = null;
  if (viewerLogIndexByRawIndex(log.rawIndex) >= 0) {
    clearGhostAnchor();
    scrollToLog(log);
    setStatus(`已回到锚点 #${log.rawIndex + 1}`, "ready");
    return;
  }
  const nearest = nearestVisibleLog(log.rawIndex);
  if (!nearest) {
    setGhostAnchor(state.currentAnchor, log, { force: options.forceGhost !== false });
    setStatus(`锚点 #${log.rawIndex + 1} 被当前筛选隐藏，当前筛选结果为空`, "error");
    renderAll();
    return;
  }
  setGhostAnchor(state.currentAnchor, nearest, { force: options.forceGhost !== false });
  scrollToLog(nearest);
  setStatus(`锚点 #${log.rawIndex + 1} 被当前筛选隐藏，已跳到最近可见日志 #${nearest.rawIndex + 1}`, "ready");
}

function isManualAnchorLog(log) {
  if (!log) return false;
  return state.manualAnchors.some((anchor) => anchor.rawIndex === log.rawIndex);
}

function removeManualAnchorByRawIndex(rawIndex, options = {}) {
  const numericRawIndex = Number(rawIndex);
  if (!Number.isFinite(numericRawIndex)) return false;
  const before = state.manualAnchors.length;
  state.manualAnchors = state.manualAnchors.filter((anchor) => Number(anchor.rawIndex) !== numericRawIndex);
  const removed = state.manualAnchors.length !== before;
  if (!removed) return false;
  if (state.currentAnchor?.kind === "manual" && Number(state.currentAnchor.rawIndex) === numericRawIndex) {
    state.currentAnchor = null;
  }
  if (state.ghostAnchor?.anchor?.kind === "manual" && Number(state.ghostAnchor.rawIndex) === numericRawIndex) {
    clearGhostAnchor();
  }
  if (state.contextMode?.rawIndex === numericRawIndex) {
    state.contextMode = null;
  }
  scheduleAnchorRender();
  renderDetails();
  renderVirtualLogs();
  if (!options.silent) setStatus(`已取消锚点 #${numericRawIndex + 1}`, "ready");
  return true;
}

function addManualAnchor(log) {
  if (!log) return;
  const exists = isManualAnchorLog(log);
  if (exists) {
    removeManualAnchorByRawIndex(log.rawIndex);
    return;
  }
  const anchor = anchorFromLog(log, "manual", byId("keywordFilter").value.trim());
  if (!anchor) return;
  state.manualAnchors.push(anchor);
  state.currentAnchor = anchor;
  clearGhostAnchor();
  scheduleAnchorRender();
  renderDetails();
  renderVirtualLogs();
  setStatus(`已添加锚点 #${log.rawIndex + 1}`, "ready");
}

function findLogByAnchor(anchor) {
  if (!anchor) return null;
  return findLogByRawIndex(anchor.rawIndex) || findLogById(anchor.logId);
}

function contextPreset(preset) {
  if (preset === "around50") return { before: 50, after: 50 };
  if (preset === "around100") return { before: 100, after: 100 };
  return { before: 50, after: 50 };
}

function normalizeContextCount(value, fallback = 50) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.max(0, Math.min(5000, Math.floor(count)));
}

function setContextRangeInputs(before = 50, after = 50) {
  const beforeInput = byId("contextBeforeInput");
  const afterInput = byId("contextAfterInput");
  if (beforeInput) beforeInput.value = String(normalizeContextCount(before));
  if (afterInput) afterInput.value = String(normalizeContextCount(after));
}

function contextRangeFromInputs() {
  return {
    before: normalizeContextCount(byId("contextBeforeInput")?.value, state.contextMode?.before ?? 50),
    after: normalizeContextCount(byId("contextAfterInput")?.value, state.contextMode?.after ?? 50),
  };
}

function applyContextRange(range = contextRangeFromInputs()) {
  const log = state.contextMode ? findLogByRawIndex(state.contextMode.rawIndex) : selectedLog();
  if (!log) {
    setStatus("请先选择一条日志再调整上下文范围", "error");
    return;
  }
  enterContextMode(log, range.before, range.after);
}

function contextLogsFor(log, before = 50, after = 50) {
  if (!log) return [];
  const position = state.allLogs.findIndex((item) => item.rawIndex === log.rawIndex);
  if (position < 0) return [];
  const from = Math.max(0, position - before);
  const to = Math.min(state.allLogs.length - 1, position + after);
  return state.allLogs.slice(from, to + 1);
}

function currentViewerLogs() {
  if (!state.contextMode) return state.filteredLogs;
  const anchor = findLogByRawIndex(state.contextMode.rawIndex);
  return contextLogsFor(anchor, state.contextMode.before, state.contextMode.after);
}

const FIND_FIELD_CONFIG = {
  messageFind: { label: "Message", value: (log) => log.message },
  tagFilter: { label: "Tag", value: (log) => log.tag },
  levelFind: { label: "Level", value: (log) => log.level },
  pidFilter: { label: "PID", value: (log) => log.pid },
  tidFilter: { label: "TID", value: (log) => log.tid },
  packageFilter: { label: "Package", value: (log) => log.packageName },
  deviceFind: { label: "Device", value: (log) => log.deviceId },
  rawFind: { label: "Raw", value: (log) => log.raw },
  keywordFilter: { label: "Message", value: (log) => log.message },
  keywordExcludeFilter: { label: "Message 排除", value: (log) => log.message },
  highlightRegex: { label: "Highlight", value: (log) => log.message, regexOnly: true },
};

function findConfigForControl(control) {
  return control?.id ? FIND_FIELD_CONFIG[control.id] : null;
}

function buildFindMatcher(control) {
  const config = findConfigForControl(control);
  const query = String(control?.value || "").trim();
  if (!config || !query) return null;
  const result = config.regexOnly ? compileUserRegex(query, "i") : compileTextMatcher(query, "i");
  if (result.error || (!result.test && !result.regex)) {
    return { config, query, error: result.error || "查找条件无效", test: () => false };
  }
  const test = result.test || ((value) => {
    result.regex.lastIndex = 0;
    return result.regex.test(String(value || ""));
  });
  return { config, query, error: "", test };
}

function toolbarFindControl() {
  const field = byId("filterFindField");
  const input = byId("filterFindInput");
  const id = field?.value || "messageFind";
  return { id, value: input?.value || "" };
}

function syncFindToolbarFromControl(control) {
  const config = findConfigForControl(control);
  if (!config) return toolbarFindControl();
  const field = byId("filterFindField");
  const input = byId("filterFindInput");
  if (field) field.value = ["keywordFilter", "keywordExcludeFilter"].includes(control.id) ? "messageFind" : control.id;
  if (input) input.value = control.value || "";
  return toolbarFindControl();
}

function refreshActiveFind(control = null) {
  const sourceControl = control || toolbarFindControl();
  const matcher = buildFindMatcher(sourceControl);
  if (!matcher) {
    state.activeFind = null;
    renderFindBar();
    return false;
  }
  const logs = currentViewerLogs();
  const matches = [];
  logs.forEach((log, viewIndex) => {
    if (matcher.test(matcher.config.value(log), log)) matches.push({ rawIndex: log.rawIndex, viewIndex });
  });
  state.activeFind = {
    controlId: sourceControl.id,
    label: matcher.config.label,
    query: matcher.query,
    error: matcher.error,
    matches,
    position: -1,
  };
  return true;
}

function findPositionForRawIndex(rawIndex) {
  if (!state.activeFind?.matches?.length) return -1;
  return state.activeFind.matches.findIndex((match) => match.rawIndex === rawIndex);
}

function jumpFilterFind(direction = 1, control = null) {
  const sourceControl = control ? syncFindToolbarFromControl(control) : toolbarFindControl();
  if (control) applyFilters({ force: true, render: false });
  if (!refreshActiveFind(sourceControl)) return;
  const find = state.activeFind;
  if (find.error || !find.matches.length) {
    renderAll();
    setStatus(find.error || "当前筛选结果中没有匹配日志", find.error ? "error" : "idle");
    return;
  }

  const logs = currentViewerLogs();
  const selected = selectedLog();
  const selectedViewIndex = selected ? logs.findIndex((log) => log.rawIndex === selected.rawIndex) : -1;
  let nextPosition = findPositionForRawIndex(selected?.rawIndex);
  if (nextPosition >= 0) {
    nextPosition = (nextPosition + direction + find.matches.length) % find.matches.length;
  } else if (direction > 0) {
    nextPosition = find.matches.findIndex((match) => match.viewIndex > selectedViewIndex);
    if (nextPosition < 0) nextPosition = 0;
  } else {
    nextPosition = find.matches.length - 1;
    for (let index = find.matches.length - 1; index >= 0; index -= 1) {
      if (find.matches[index].viewIndex < selectedViewIndex || selectedViewIndex < 0) {
        nextPosition = index;
        break;
      }
    }
  }

  find.position = nextPosition;
  const target = findLogByRawIndex(find.matches[nextPosition].rawIndex);
  if (target) scrollToLog(target);
  renderFindBar();
  setStatus(`查找 ${find.label}: ${nextPosition + 1}/${find.matches.length}`, "ready");
}

function updateFindPreview() {
  if (!String(byId("filterFindInput")?.value || "").trim()) {
    state.activeFind = null;
    renderFindBar();
    return;
  }
  refreshActiveFind(toolbarFindControl());
  const selected = selectedLog();
  const position = findPositionForRawIndex(selected?.rawIndex);
  if (position >= 0) state.activeFind.position = position;
  renderFindBar();
}

function renderFindBar() {
  const bar = byId("filterFindBar");
  if (!bar) return;
  const find = state.activeFind;
  const position = find?.position >= 0 ? find.position + 1 : 0;
  const count = find?.matches?.length || 0;
  const meta = byId("filterFindMeta");
  if (meta) meta.textContent = find?.error ? find.error : `${position}/${count}`;
  bar.classList.toggle("has-error", Boolean(find?.error));
}

function closeFilterFind() {
  state.activeFind = null;
  if (byId("filterFindInput")) byId("filterFindInput").value = "";
  renderFindBar();
}

function selectedLog() {
  return findLogById(state.selectedLogId);
}

function selectedLogsInViewer() {
  const selected = state.selectedLogRawIndexes;
  if (!selected.size) return [];
  return currentViewerLogs().filter((log) => selected.has(log.rawIndex));
}

function selectedLogsAll() {
  const selected = state.selectedLogRawIndexes;
  if (!selected.size) return [];
  return state.allLogs.filter((log) => selected.has(log.rawIndex));
}

function selectionSummary() {
  const count = state.selectedLogRawIndexes.size;
  if (!count) return "未选择日志";
  const inView = selectedLogsInViewer().length;
  return inView === count ? `已选择 ${count.toLocaleString()} 行` : `已选择 ${count.toLocaleString()} 行 · 当前视图 ${inView.toLocaleString()} 行`;
}

function updateSelectionUi() {
  const badge = byId("selectionCountBadge");
  if (badge) badge.textContent = selectionSummary();
  const copyBtn = byId("copySelectedLogsBtn");
  const clearBtn = byId("clearSelectionBtn");
  const hasSelection = state.selectedLogRawIndexes.size > 0;
  if (copyBtn) copyBtn.disabled = !hasSelection;
  if (clearBtn) clearBtn.disabled = !hasSelection;
}

function enterContextMode(log, before = 50, after = 50) {
  if (!log) return;
  clearGhostAnchor();
  const normalizedBefore = normalizeContextCount(before);
  const normalizedAfter = normalizeContextCount(after);
  state.contextMode = { logId: log.id, rawIndex: log.rawIndex, before: normalizedBefore, after: normalizedAfter };
  state.selectedLogId = log.id;
  state.currentAnchor = anchorFromLog(log, "context", byId("keywordFilter").value.trim());
  setContextRangeInputs(normalizedBefore, normalizedAfter);
  renderAll();
  scrollToLog(log);
}

function exitContextMode() {
  state.contextMode = null;
  renderAll();
}

function setDetailTab(tab) {
  state.activeDetailTab = tab;
  if (!byId("detailRaw") && !byId("detailContext") && !byId("detailAi")) return;
  document.querySelectorAll("[data-detail-tab]").forEach((button) => button.classList.toggle("active", button.dataset.detailTab === tab));
  document.querySelectorAll(".detail-pane").forEach((pane) => pane.classList.remove("active"));
  const target = byId(`detail${tab[0].toUpperCase()}${tab.slice(1)}`);
  if (target) target.classList.add("active");
  renderDetails();
}


function renderLevelPicker() {
  const panel = byId("levelPickerPanel");
  const hidden = byId("levelFilter");
  if (!panel || !hidden) return;
  const selected = new Set(String(hidden.value || "V,D,I,W,E,F").split(",").filter(Boolean));
  panel.innerHTML = LOG_LEVELS.map((level) => `
    <label class="level-choice level-choice-${level.toLowerCase()}" title="${LOG_LEVEL_LABELS[level]}">
      <input type="checkbox" data-level-toggle="${level}" ${selected.has(level) ? "checked" : ""}>
      <span class="badge level-pill level-${level.toLowerCase()}">${level}</span>
    </label>
  `).join("");
}

function updateLevelFilterFromPicker() {
  const panel = byId("levelPickerPanel");
  const hidden = byId("levelFilter");
  if (!panel || !hidden) return;
  const selected = [...panel.querySelectorAll("[data-level-toggle]")]
    .filter((input) => input.checked)
    .map((input) => input.dataset.levelToggle);
  hidden.value = (selected.length ? selected : LOG_LEVELS).join(",");
  scheduleFilter();
}

function renderAll() {
  renderLogViewShell();
  renderMeta();
  renderContextBanner();
  renderCurrentLogSurface();
  renderAnchors();
  renderDetails();
  updateSelectionUi();
  renderFindBar();
}

function scheduleRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  window.requestAnimationFrame(() => {
    state.renderPending = false;
    renderAll();
  });
}

function scheduleAnchorRender() {
  window.clearTimeout(state.anchorRenderTimer);
  state.anchorRenderTimer = window.setTimeout(() => {
    renderAnchors();
    renderDetails();
  }, 120);
}

function setLogView(view, options = {}) {
  const nextView = view === "timeline" ? "timeline" : "logs";
  const changed = state.activeLogView !== nextView;
  state.activeLogView = nextView;
  state.logViewSwitchVersion += 1;

  // The Timeline tab is a key-event navigator, not another log table. Make the
  // view switch deterministic before any expensive Timeline work starts; do not
  // rely only on the hidden attribute because old page CSS/plugins have
  // repeatedly overridden it in this project.
  renderLogViewShell();
  renderMeta();
  renderContextBanner();
  updateSelectionUi();
  renderFindBar();

  if (nextView === "timeline") {
    renderTimeline({ skipEnsure: false, force: options.force === true });
  } else {
    renderVirtualLogs();
  }

  if (changed) {
    setStatus(nextView === "timeline" ? "已切换到 Timeline，可点击系统事件回到日志流" : "已切换到日志流", "ready");
  }
}

function forceElementDisplay(node, visible, displayValue = "block") {
  if (!node) return;
  node.toggleAttribute("hidden", !visible);
  node.setAttribute("aria-hidden", visible ? "false" : "true");
  // Inline display is intentional here: log-insight has several legacy CSS files
  // and earlier patches. This guarantees the Timeline/log stream switch always
  // wins over stale CSS.
  node.style.display = visible ? displayValue : "none";
}

function renderLogViewShell() {
  const isTimeline = state.activeLogView === "timeline";
  document.body?.classList.toggle("log-view-timeline", isTimeline);
  document.body?.classList.toggle("log-view-stream", !isTimeline);

  // Timeline is rendered inside the same viewport as the log stream. This avoids
  // the fragile old layout where a separate timelinePanel competed with the
  // virtualized log viewport and could be covered by stale CSS or a pending
  // requestAnimationFrame log render.
  forceElementDisplay(byId("logTableHead"), !isTimeline, "grid");
  forceElementDisplay(byId("dropZone"), true, "block");
  forceElementDisplay(byId("timelinePanel"), false, "none");
  const viewport = byId("dropZone");
  if (viewport) {
    viewport.classList.toggle("is-timeline-view", isTimeline);
    viewport.classList.toggle("is-log-stream-view", !isTimeline);
    viewport.setAttribute("aria-label", isTimeline ? "系统事件时间线" : "日志流");
  }
  setTimelineHostVisible(isTimeline);

  document.querySelectorAll("[data-log-view]").forEach((button) => {
    const active = button.dataset.logView === state.activeLogView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  updateTimelineBadge();
}


function deriveLogSurfaceMode() {
  if (state.activeLogView === "timeline") {
    if (!state.allLogs.length) return "timeline-empty";
    if (state.timelineBuildError) return "timeline-error";
    if (state.timelineBuildPending && !state.timelineEvents.length) return "timeline-loading";
    const api = timelineApi();
    const filteredEvents = api ? api.filterTimelineEvents(state.timelineEvents, {
      type: state.timelineType,
      query: state.timelineQuery,
    }) : [];
    return filteredEvents.length ? "timeline-ready" : "timeline-empty-result";
  }
  if (!state.allLogs.length) return "logs-empty";
  if (!currentViewerLogs().length) return "logs-filter-empty";
  return "logs-ready";
}

function setLogSurfaceMode(mode) {
  state.surfaceMode = mode;
  const root = document.querySelector(".log-workbench-page") || document.body;
  if (root) root.dataset.logSurfaceMode = mode;
  document.body?.setAttribute("data-log-surface-mode", mode);
}

function renderCurrentLogSurface() {
  const mode = deriveLogSurfaceMode();
  setLogSurfaceMode(mode);
  if (state.activeLogView === "timeline") {
    renderTimeline({ skipEnsure: mode !== "timeline-loading" });
  } else {
    renderVirtualLogs();
  }
}

function ensureTimelineHost() {
  const viewport = byId("dropZone");
  if (!viewport) return null;
  let host = byId("timelineInlineHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "timelineInlineHost";
    host.className = "timeline-inline-host";
    host.hidden = true;
    viewport.appendChild(host);
  }
  return host;
}

function setTimelineHostVisible(visible) {
  const host = ensureTimelineHost();
  const spacer = byId("logSpacer");
  if (host) {
    host.hidden = !visible;
    host.style.display = visible ? "block" : "none";
  }
  if (spacer) {
    spacer.hidden = visible;
    spacer.style.display = visible ? "none" : "block";
  }
}

function ensureTimelineInlineStyles() {
  if (document.getElementById("timelineInlineRuntimeStyles")) return;
  const style = document.createElement("style");
  style.id = "timelineInlineRuntimeStyles";
  style.textContent = `
    #timelineCountBadge { min-width: 24px; text-align: center; }
    #timelineCountBadge.is-building { opacity: .78; }
    #timelineCountBadge.is-stale { box-shadow: inset 0 0 0 1px rgba(245,158,11,.35); }
    #timelineCountBadge.is-building::after {
      content: "";
      display: inline-block;
      width: 4px;
      height: 4px;
      margin-left: 3px;
      border-radius: 999px;
      background: currentColor;
      vertical-align: middle;
      animation: timelineBadgePulse 1s ease-in-out infinite;
    }
    @keyframes timelineBadgePulse { 0%,100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
    #dropZone.is-timeline-view {
      overflow: auto;
      background: var(--log-surface, var(--surface-panel, #fff));
    }
    #dropZone.is-timeline-view .log-spacer { display: none !important; }
    .timeline-inline-host {
      min-height: 100%;
      width: 100%;
    }
    .timeline-inline-view {
      min-height: max(560px, calc(100vh - 300px));
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      color: var(--text-primary, #0f172a);
    }
    .timeline-inline-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 16px;
      border: 1px solid var(--border-subtle, rgba(148, 163, 184, .28));
      border-radius: 18px;
      background: var(--surface-card, rgba(255,255,255,.82));
      box-shadow: var(--shadow-sm, 0 10px 30px rgba(15,23,42,.06));
    }
    .timeline-inline-title { display: grid; gap: 4px; }
    .timeline-inline-title strong { font-size: 18px; letter-spacing: -.02em; }
    .timeline-inline-title span { color: var(--text-secondary, #64748b); font-size: 12px; }
    .timeline-inline-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .timeline-inline-controls .select { width: 132px; }
    .timeline-inline-controls .input { width: 280px; max-width: 32vw; }
    .timeline-inline-list { display: grid; gap: 10px; }
    .timeline-inline-empty,
    .timeline-inline-loading,
    .timeline-inline-error {
      min-height: 360px;
      display: grid;
      place-items: center;
      text-align: center;
      border: 1px dashed var(--border-subtle, rgba(148, 163, 184, .35));
      border-radius: 22px;
      background: color-mix(in srgb, var(--surface-card, #fff) 84%, transparent);
      padding: 32px;
    }
    .timeline-inline-empty strong,
    .timeline-inline-loading strong,
    .timeline-inline-error strong { display:block; font-size: 20px; margin-bottom: 8px; }
    .timeline-inline-empty span,
    .timeline-inline-loading span,
    .timeline-inline-error span { color: var(--text-secondary, #64748b); line-height: 1.7; max-width: 560px; }
    .timeline-inline-error { border-color: var(--danger-border, rgba(239,68,68,.35)); }
    .timeline-inline-error strong { color: var(--danger-text, #dc2626); }
    .timeline-item {
      border: 1px solid var(--border-subtle, rgba(148, 163, 184, .28));
      border-radius: 16px;
      background: var(--surface-card, #fff);
      overflow: hidden;
    }
    .timeline-event-main {
      width: 100%;
      display: grid;
      grid-template-columns: 132px 110px minmax(160px, .7fr) minmax(260px, 1.4fr) minmax(160px, .6fr) 82px;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border: 0;
      color: inherit;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    .timeline-event-main:hover { background: var(--surface-hover, rgba(59,130,246,.08)); }
    .timeline-time { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--text-secondary, #64748b); font-size: 12px; }
    .timeline-title { font-weight: 800; }
    .timeline-summary,
    .timeline-package { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary, #64748b); }
    .timeline-confidence { justify-self: end; border-radius: 999px; padding: 3px 8px; background: var(--badge-bg, rgba(59,130,246,.10)); color: var(--accent, #2563eb); font-size: 11px; font-weight: 800; }
    .timeline-raw { border-top: 1px solid var(--border-subtle, rgba(148, 163, 184, .22)); padding: 8px 14px; }
    .timeline-raw summary { cursor: pointer; color: var(--text-secondary, #64748b); font-size: 12px; }
    .timeline-raw pre { overflow: auto; white-space: pre-wrap; font-size: 12px; color: var(--text-secondary, #64748b); }
    html[data-theme="dark"] .timeline-inline-head,
    html[data-theme="dark"] .timeline-item,
    body.theme-dark .timeline-inline-head,
    body.theme-dark .timeline-item {
      background: var(--log-surface-2, #171b25);
      border-color: var(--log-border, rgba(148,163,184,.20));
    }
    html[data-theme="dark"] .timeline-inline-empty,
    html[data-theme="dark"] .timeline-inline-loading,
    html[data-theme="dark"] .timeline-inline-error,
    body.theme-dark .timeline-inline-empty,
    body.theme-dark .timeline-inline-loading,
    body.theme-dark .timeline-inline-error {
      background: var(--log-surface-2, #171b25);
      border-color: var(--log-border, rgba(148,163,184,.22));
    }
    @media (max-width: 1280px) {
      .timeline-event-main { grid-template-columns: 108px 88px minmax(140px,.7fr) minmax(220px,1.3fr) 72px; }
      .timeline-package { display: none; }
      .timeline-inline-controls .input { width: 220px; }
    }
  `;
  document.head.appendChild(style);
}

function timelineInlineTypeOptions() {
  const types = timelineApi()?.EVENT_TYPES || [{ value: "all", label: "全部" }];
  return types.map((item) => `<option value="${attr(item.value)}" ${state.timelineType === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function renderTimelineInlineShell(innerHtml, metaText = "") {
  ensureTimelineInlineStyles();
  const viewport = byId("dropZone");
  const host = ensureTimelineHost();
  if (!viewport || !host) return;
  viewport.classList.add("is-timeline-view");
  viewport.classList.remove("is-log-stream-view");
  setTimelineHostVisible(true);
  viewport.scrollTop = 0;
  host.innerHTML = `
    <section class="timeline-inline-view" aria-label="系统事件时间线">
      <div class="timeline-inline-head">
        <div class="timeline-inline-title">
          <strong>系统事件时间线</strong>
          <span data-timeline-meta>${escapeHtml(metaText || "从日志中提取 Crash、ANR、Activity 跳转、卡顿等关键系统事件；点击事件可回到日志流定位原始行。")}</span>
        </div>
        <div class="timeline-inline-controls">
          <select class="select" data-timeline-type-inline aria-label="Timeline 类型过滤">${timelineInlineTypeOptions()}</select>
          <input class="input" data-timeline-search-inline placeholder="搜索 title / summary / raw / package" value="${attr(state.timelineQuery || "")}">
          <button class="btn btn-secondary" type="button" data-log-view="logs">返回日志流</button>
        </div>
      </div>
      <div class="timeline-inline-list">${innerHtml}</div>
    </section>`;
  bindInlineTimelineControls();
}

function bindInlineTimelineControls() {
  const typeSelect = document.querySelector("[data-timeline-type-inline]");
  if (typeSelect && typeSelect.dataset.bound !== "1") {
    typeSelect.dataset.bound = "1";
    typeSelect.addEventListener("change", (event) => {
      state.timelineType = event.target.value || "all";
      renderTimeline({ skipEnsure: true });
    });
  }
  const searchInput = document.querySelector("[data-timeline-search-inline]");
  if (searchInput && searchInput.dataset.bound !== "1") {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", debounce((event) => {
      state.timelineQuery = event.target.value || "";
      renderTimeline({ skipEnsure: true });
    }, 120));
  }
}

function setTimelineProgressText(text) {
  const meta = byId("timelineMeta") || document.querySelector("[data-timeline-meta]");
  if (meta) meta.textContent = text;
}

function renderTimelineFilters() {
  const select = byId("timelineTypeFilter");
  if (!select || select.dataset.ready === "1") return;
  const types = timelineApi()?.EVENT_TYPES || [];
  select.innerHTML = types.map((item) => `<option value="${attr(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  select.value = state.timelineType;
  select.dataset.ready = "1";
}

function renderMeta() {
  const viewerLogs = currentViewerLogs();
  const mode = state.contextMode ? "上下文" : "过滤";
  const firstRaw = state.allLogs[0]?.rawIndex ?? 0;
  const lastRaw = state.allLogs[state.allLogs.length - 1]?.rawIndex ?? 0;
  byId("logCountMeta").textContent = `内存 ${state.allLogs.length.toLocaleString()} 行 · ${mode}显示 ${viewerLogs.length.toLocaleString()} 行 · raw #${firstRaw}~#${lastRaw}`;
  const pageMeta = byId("pageMeta");
  if (pageMeta) pageMeta.textContent = `显示 ${viewerLogs.length.toLocaleString()} 行 · Anchor ${allAnchors().length.toLocaleString()} 个 · 上限 ${state.maxLogs.toLocaleString()} 行`;
  renderCaptureState();
}

function renderContextBanner() {
  const banner = byId("contextBanner");
  if (state.activeLogView === "timeline") {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.classList.toggle("active", Boolean(state.contextMode));
  if (!state.contextMode) return;
  const anchor = findLogByRawIndex(state.contextMode.rawIndex);
  byId("contextTitle").textContent = `上下文模式 · #${anchor?.rawIndex ?? "-"}`;
  byId("contextMeta").textContent = anchor ? `${anchor.deviceId} · ${anchor.timestamp || "-"} · ${anchor.tag || "-"} · 前 ${state.contextMode.before} / 后 ${state.contextMode.after}` : "";
  setContextRangeInputs(state.contextMode.before, state.contextMode.after);
}

function renderLogEmptyCanvas(viewport, spacer, windowNode, logs) {
  const hasMemoryLogs = state.allLogs.length > 0;
  const title = hasMemoryLogs ? "当前筛选没有匹配日志" : "还没有日志流";
  const desc = hasMemoryLogs
    ? "内存里已有日志，但当前过滤条件没有命中。可以放宽 Package / Tag / Message / Level 条件，或点击“清屏”清空后重新抓取。"
    : "开始抓取实时 Logcat，或把 .log / .txt 文件拖到这里。导入后可以继续用过滤、锚点、Timeline 和上下文定位问题。";

  const viewportHeight = Math.max(viewport?.clientHeight || 0, 420);
  if (spacer) spacer.style.height = `${viewportHeight}px`;
  if (!windowNode) return;

  windowNode.style.transform = "translateY(0)";
  windowNode.style.minHeight = `${viewportHeight}px`;
  windowNode.classList.add("is-empty");
  windowNode.classList.toggle("is-filter-empty", hasMemoryLogs);
  windowNode.classList.toggle("is-memory-empty", !hasMemoryLogs);

  // Important: while logcat is capturing, polling may call renderVirtualLogs many
  // times per second. If we rebuild the empty-state DOM every time, the user sees
  // the card/button flicker and clicks can be swallowed because the button node is
  // replaced under the pointer. Keep the same empty canvas until its semantic type
  // changes: memory empty vs. filter empty.
  const signature = hasMemoryLogs ? "filter-empty" : "memory-empty";
  if (state.logEmptySignature === signature && windowNode.dataset.emptySignature === signature) {
    return;
  }
  state.logEmptySignature = signature;
  windowNode.dataset.emptySignature = signature;

  windowNode.innerHTML = `
    <div class="empty-state log-empty-state">
      <div class="empty-visual-card log-empty-card">
        <div class="empty-visual-media" aria-hidden="true">
          <img class="module-theme-art module-theme-art-light" src="/assets/workbench/log-insight-hero-light.png" alt="">
          <img class="module-theme-art module-theme-art-dark" src="/assets/workbench/log-insight-hero-dark.png" alt="">
        </div>
        <div class="empty-visual-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(desc)}</span>
          <div class="empty-visual-actions">
            ${hasMemoryLogs ? `<button class="btn btn-secondary" type="button" id="resetFiltersFromEmptyBtn">${iconLabel("refresh", "重置过滤")}</button>` : `<button class="btn btn-primary" type="button" data-log-empty-start>${iconLabel("play", "开始抓取")}</button><button class="btn btn-secondary" type="button" data-log-empty-import>${iconLabel("import", "导入日志")}</button>`}
          </div>
        </div>
      </div>
    </div>`;
  byId("resetFiltersFromEmptyBtn")?.addEventListener("click", () => byId("resetFiltersBtn")?.click());
  windowNode.querySelector("[data-log-empty-start]")?.addEventListener("click", () => byId("toggleCaptureBtn")?.click());
  windowNode.querySelector("[data-log-empty-import]")?.addEventListener("click", (event) => {
    openLogFilePicker(event);
  });
}

function renderVirtualLogs() {
  if (state.activeLogView !== "logs") return;
  const switchVersion = state.logViewSwitchVersion;

  const viewport = byId("dropZone");
  const spacer = byId("logSpacer");
  const windowNode = byId("logWindow");
  if (!viewport || !spacer || !windowNode) return;

  const logs = currentViewerLogs();
  setLogSurfaceMode(!state.allLogs.length ? "logs-empty" : (!logs.length ? "logs-filter-empty" : "logs-ready"));

  // Empty state is rendered synchronously. This avoids the initial blank canvas that
  // could happen when the first requestAnimationFrame was skipped or overwritten by
  // another toolbar/device render path.
  if (!logs.length) {
    renderLogEmptyCanvas(viewport, spacer, windowNode, logs);
    return;
  }

  window.requestAnimationFrame(() => {
    if (state.activeLogView !== "logs" || switchVersion !== state.logViewSwitchVersion) return;
    if (shouldPauseRenderForTextSelection()) {
      scheduleRenderAfterTextSelectionPause();
      return;
    }
    const liveLogs = currentViewerLogs();
    if (!liveLogs.length) {
      renderLogEmptyCanvas(viewport, spacer, windowNode, liveLogs);
      return;
    }

    const totalHeight = liveLogs.length * state.rowHeight;
    spacer.style.height = `${Math.max(totalHeight, viewport.clientHeight)}px`;
    windowNode.classList.remove("is-filter-empty");
    windowNode.style.minHeight = "";
    windowNode.classList.remove("is-empty");
    windowNode.dataset.emptySignature = "";
    state.logEmptySignature = "";

    const start = Math.max(0, Math.floor(viewport.scrollTop / state.rowHeight) - 8);
    const visibleCount = Math.ceil(viewport.clientHeight / state.rowHeight) + 16;
    const end = Math.min(liveLogs.length, start + visibleCount);
    windowNode.style.transform = `translateY(${start * state.rowHeight}px)`;
    const rowsHtml = liveLogs.slice(start, end).map((log, localIndex) => renderLogRow(log, start + localIndex)).join("");
    windowNode.innerHTML = rowsHtml + renderGhostAnchorMarker(start, end);
    applyColumnLayout();
    if (byId("autoScrollToggle").checked && state.captureRunning && !state.contextMode) {
      setViewportScrollTop(viewport, viewport.scrollHeight);
    }
  });
}

function renderTimelineSnapshot(options = {}) {
  const events = filteredTimelineEvents({ skipEnsure: true });
  updateTimelineBadge();

  if (!events.length) {
    const emptyText = state.timelineEvents.length
      ? "当前 Timeline 搜索或类型过滤没有匹配事件。"
      : "当前日志中暂未识别到 Activity、ANR、Crash、卡顿等系统事件。可以继续抓取或导入更完整的 system/main 日志。";
    renderTimelineInlineShell(`<div class="timeline-inline-empty">
      <div>
        <strong>暂无系统事件</strong>
        <span>${escapeHtml(emptyText)}</span>
      </div>
    </div>`, `系统事件 0 个 · 原始识别 ${state.timelineEvents.length.toLocaleString()} 个`);
    return;
  }

  const listHtml = events.map((event) => `
    <article class="timeline-item timeline-type-${attr(event.type)}">
      <button class="timeline-event-main" type="button" data-timeline-line-index="${attr(event.lineIndex)}" title="点击回到日志流并定位原始日志 #${Number(event.lineIndex) + 1}">
        <span class="timeline-time">${escapeHtml(event.time || "-")}</span>
        <span class="timeline-title">${escapeHtml(timelineTypeLabel(event.type))}</span>
        <span class="timeline-title">${escapeHtml(event.title)}</span>
        <span class="timeline-summary">${escapeHtml(event.summary || "-")}</span>
        <span class="timeline-package">${escapeHtml(event.packageName || "-")}</span>
        <span class="timeline-confidence is-${attr(event.confidence)}">${escapeHtml(event.confidence || "-")}</span>
      </button>
      <details class="timeline-raw">
        <summary>查看原始日志</summary>
        <pre>${escapeHtml(event.raw || "")}</pre>
      </details>
    </article>
  `).join("");

  const staleText = options.stale || state.timelineStaleWhileViewing ? " · 快照更新中，继续展示当前结果" : "";
  renderTimelineInlineShell(listHtml, `系统事件 ${events.length.toLocaleString()} 个 · 原始识别 ${state.timelineEvents.length.toLocaleString()} 个 · 点击事件可回到日志流定位${staleText}`);
}

function renderTimeline(options = {}) {
  if (state.activeLogView !== "timeline") return;
  renderLogViewShell();
  renderTimelineFilters();
  setLogSurfaceMode(deriveLogSurfaceMode());

  const totalLogs = state.allLogs.length;
  const badge = byId("timelineCountBadge");

  if (!totalLogs) {
    state.timelineEvents = [];
    state.timelineVersion = state.allVersion;
    state.timelineBuildPending = false;
    updateTimelineBadge();
    renderTimelineInlineShell(`<div class="timeline-inline-empty">
      <div>
        <strong>还没有日志，无法生成 Timeline</strong>
        <span>先开始抓取 Logcat，或导入 .log / .txt 文件。Timeline 会自动提取 Crash、ANR、Activity 跳转、页面显示、卡顿等关键事件。</span>
      </div>
    </div>`, "等待日志输入");
    return;
  }

  if (!options.skipEnsure && state.timelineVersion !== state.allVersion) {
    const hasSnapshot = state.timelineEvents.length > 0;
    state.timelineBuildPending = true;
    state.timelineStaleWhileViewing = hasSnapshot;
    updateTimelineBadge();
    if (!hasSnapshot) {
      renderTimelineInlineShell(`<div class="timeline-inline-loading">
        <div>
          <strong>正在生成 Timeline</strong>
          <span>正在从 ${totalLogs.toLocaleString()} 行日志中识别 Activity、ANR、Crash、卡顿等系统事件。日志抓取会继续进行。</span>
        </div>
      </div>`, `正在识别系统事件 · 原始日志 ${totalLogs.toLocaleString()} 行`);
    } else {
      renderTimelineSnapshot({ stale: true });
      setTimelineProgressText(`正在后台更新 Timeline 快照 · 新日志会继续抓取，当前先展示上一次结果`);
    }
    scheduleTimelineBuild(0, { render: true, force: options.force === true });
    return;
  }

  if (state.timelineBuildPending && !state.timelineEvents.length) {
    updateTimelineBadge();
    renderTimelineInlineShell(`<div class="timeline-inline-loading">
      <div>
        <strong>正在生成 Timeline</strong>
        <span>正在分片扫描日志，不会阻塞实时抓取。完成后会显示关键系统事件列表。</span>
      </div>
    </div>`, `正在识别系统事件 · 原始日志 ${totalLogs.toLocaleString()} 行`);
    return;
  }

  if (state.timelineBuildError) {
    updateTimelineBadge();
    renderTimelineInlineShell(`<div class="timeline-inline-error">
      <div>
        <strong>Timeline 构建失败</strong>
        <span>${escapeHtml(state.timelineBuildError)}</span>
      </div>
    </div>`, "Timeline 构建失败");
    return;
  }

  renderTimelineSnapshot();

}

function markTextSelectionRenderPause(ms = 1200) {
  if (!hasActiveLogTextSelection()) return;
  state.textSelectionPauseUntil = Math.max(state.textSelectionPauseUntil, Date.now() + ms);
}

function shouldPauseRenderForTextSelection() {
  return hasActiveLogTextSelection() && Date.now() < state.textSelectionPauseUntil;
}

function scheduleRenderAfterTextSelectionPause() {
  const wait = Math.max(0, state.textSelectionPauseUntil - Date.now() + 16);
  window.clearTimeout(state.textSelectionRenderTimer);
  state.textSelectionRenderTimer = window.setTimeout(() => {
    state.textSelectionPauseUntil = 0;
    renderVirtualLogs();
  }, wait);
}

function nodeInside(node, container) {
  if (!node || !container) return false;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(element && container.contains(element));
}

function hasActiveLogTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !String(selection.toString()).trim()) return false;
  const viewport = byId("dropZone");
  return nodeInside(selection.anchorNode, viewport) || nodeInside(selection.focusNode, viewport);
}

function setAutoScroll(enabled) {
  const toggle = byId("autoScrollToggle");
  if (toggle) toggle.checked = Boolean(enabled);
  if (enabled) clearGhostAnchor();
}

function isNearViewportBottom(viewport, threshold = 24) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold;
}

function setViewportScrollTop(viewport, value) {
  state.programmaticScroll = true;
  viewport.scrollTop = value;
  window.clearTimeout(state.programmaticScrollTimer);
  state.programmaticScrollTimer = window.setTimeout(() => {
    state.programmaticScroll = false;
  }, 100);
}

function handleLogViewportScroll() {
  const viewport = byId("dropZone");
  if (!viewport) return;
  syncLogHeaderScroll();
  if (!state.programmaticScroll && byId("autoScrollToggle")?.checked && state.captureRunning && !isNearViewportBottom(viewport)) {
    setAutoScroll(false);
  }
  renderVirtualLogs();
}

function syncLogHeaderScroll() {
  const viewport = byId("dropZone");
  const head = document.querySelector(".log-table-head");
  if (!viewport || !head) return;
  head.style.transform = `translateX(${-viewport.scrollLeft}px)`;
}

function tagKind(tag) {
  if (/Activity|Window/i.test(tag)) return "activity";
  if (/Binder/i.test(tag)) return "binder";
  return "";
}

function findHighlightRegexForColumn(column) {
  const field = byId("filterFindField")?.value || "";
  if (!state.activeFind && !String(byId("filterFindInput")?.value || "").trim()) return null;
  if (column === "message" && ["messageFind", "keywordFilter", "keywordExcludeFilter", "highlightRegex", "rawFind"].includes(field)) return buildFindRegex();
  if (column === "tag" && field === "tagFilter") return buildFindRegex();
  if (column === "package" && field === "packageFilter") return buildFindRegex();
  if (column === "device" && field === "deviceFind") return buildFindRegex();
  if (column === "level" && field === "levelFind") return buildFindRegex();
  if (column === "pidtid" && ["pidFilter", "tidFilter"].includes(field)) return buildFindRegex();
  return null;
}

function renderLogRow(log, viewIndex) {
  const levelClass = `level-${log.level.toLowerCase()}`;
  const rowLevelClass = `log-${levelClass}`;
  const selected = log.id === state.selectedLogId ? "selected" : "";
  const rangeSelected = state.selectedLogRawIndexes.has(log.rawIndex) ? "range-selected" : "";
  const anchor = state.currentAnchor?.rawIndex === log.rawIndex ? "anchor" : "";
  const contextAnchor = state.contextMode?.rawIndex === log.rawIndex ? "context-anchor" : "";
  const flash = state.flashingRawIndex === log.rawIndex ? "flash-anchor" : "";
  const isManualAnchor = isManualAnchorLog(log);
  const anchorActionClass = isManualAnchor ? "is-active" : "";
  const anchorActionTitle = isManualAnchor ? "取消锚点" : "添加锚点";
  return `<div class="log-row ${rowLevelClass} ${selected} ${rangeSelected} ${anchor} ${contextAnchor} ${flash}" data-level="${attr(log.level)}" data-view-index="${viewIndex}" data-log-id="${attr(log.id)}" data-raw-index="${attr(log.rawIndex)}" role="row" style="grid-template-columns:${attr(logGridTemplate())};min-width:${attr(`${logGridMinWidth()}px`)}" title="点击选择；Shift 点击选择连续日志；Cmd/Ctrl 点击追加或取消选择">
    ${columnCell("line", `#${escapeHtml(log.rawIndex + 1)}`, "cell line-cell")}
    ${columnCell("device", highlightHtml(log.deviceId || "-", [findHighlightRegexForColumn("device")]), "cell device")}
    ${columnCell("time", escapeHtml(log.timestamp || "-"))}
    ${columnCell("level", `<span class="badge level-pill ${levelClass}">${highlightHtml(log.level, [findHighlightRegexForColumn("level")])}</span>`)}
    ${columnCell("pidtid", highlightHtml(`${log.pid || "-"}/${log.tid || "-"}`, [findHighlightRegexForColumn("pidtid")]), "cell pidtid")}
    ${columnCell("package", highlightHtml(log.packageName || "-", [findHighlightRegexForColumn("package")]), `cell package-cell ${log.packageSource === "inferred" ? "is-inferred" : ""}`)}
    ${columnCell("tag", highlightHtml(log.tag || "-", [findHighlightRegexForColumn("tag")]), `cell tag-cell ${tagKind(log.tag)}`)}
    ${columnCell("message", highlightHtml(log.message || log.raw, [findHighlightRegexForColumn("message")]), "cell message-cell")}
    ${state.visibleColumns.has("action") ? `<span class="row-actions" data-col="action">
      <button class="btn btn-ghost row-action-btn anchor-action ${anchorActionClass}" type="button" data-add-anchor="${attr(log.id)}" title="${attr(anchorActionTitle)}" aria-label="${attr(anchorActionTitle)}" aria-pressed="${isManualAnchor ? "true" : "false"}">${iconSvg("anchor")}</button>
      <button class="btn btn-ghost row-action-btn nearby-action" type="button" data-context-log="${attr(log.id)}" title="查看附近日志" aria-label="查看附近日志">${iconSvg("target")}<span class="nearby-action-text">附近</span></button>
      <button class="btn btn-ghost" type="button" data-copy-log="${attr(log.id)}">${iconLabel("copy", "复制")}</button>
    </span>` : ""}
  </div>`;
}

function renderGhostAnchorMarker(start, end) {
  const ghost = state.ghostAnchor;
  if (!ghost || state.contextMode) return "";
  const logs = currentViewerLogs();
  const viewIndex = logs.findIndex((log) => log.rawIndex === ghost.nearestRawIndex);
  if (viewIndex < start || viewIndex >= end) return "";
  const anchor = ghost.anchor || {};
  const anchorLine = Number.isFinite(Number(anchor.rawIndex)) ? Number(anchor.rawIndex) + 1 : "-";
  const top = Math.max(0, (viewIndex - start) * state.rowHeight - 2);
  return `<div class="ghost-anchor-marker" style="top:${attr(`${top}px`)}">
    <span class="ghost-anchor-copy">${iconSvg("anchor")} 锚点 #${escapeHtml(anchorLine)} 被当前筛选隐藏，位于这里附近</span>
    <button class="btn btn-secondary" type="button" data-ghost-anchor-context>${iconLabel("search", "显示上下文")}</button>
    <button class="btn btn-ghost" type="button" data-ghost-anchor-clear-filter>${iconLabel("filter", "清除筛选")}</button>
    <button class="btn btn-ghost ghost-anchor-close" type="button" data-ghost-anchor-dismiss title="隐藏本次提示">×</button>
  </div>`;
}

function renderAnchors() {
  const groups = {
    manual: [],
    crash: [],
    anr: [],
    activity: [],
    binder: [],
  };
  const filteredRawIndexes = state.anchorFilteredOnly ? new Set(state.filteredLogs.map((log) => log.rawIndex)) : null;
  for (const anchor of allAnchors()) {
    if (filteredRawIndexes && !filteredRawIndexes.has(anchor.rawIndex)) continue;
    const key = groups[anchor.kind] ? anchor.kind : "manual";
    groups[key].push(anchor);
  }
  const labels = {
    manual: { icon: "anchor", text: "手动锚点" },
    crash: { icon: "alert", text: "Crash" },
    anr: { icon: "alert", text: "ANR" },
    activity: { icon: "activity", text: "Activity" },
    binder: { icon: "binder", text: "Binder" },
  };
  const html = Object.entries(groups).map(([kind, anchors]) => {
    const collapsed = isAnchorGroupCollapsed(kind);
    const clearManual = kind === "manual" && anchors.length
      ? `<div class="anchor-group-body-actions"><button class="btn btn-ghost btn-compact anchor-group-action" type="button" data-clear-manual-anchors>清空手动</button></div>`
      : "";
    return `
      <section class="anchor-group ${collapsed ? "collapsed" : ""}">
        <div class="anchor-group-head">
          <button class="anchor-group-title" type="button" data-toggle-anchor-group="${attr(kind)}">
            <span class="anchor-group-label">
              ${iconSvg(collapsed ? "chevron-right" : "chevron-down", "anchor-chevron-icon")}
              ${iconSvg(labels[kind].icon, `anchor-kind-icon anchor-kind-${kind}`)}
              <span>${escapeHtml(labels[kind].text)}</span>
            </span>
            <span>${anchors.length}</span>
          </button>
        </div>
        <div class="anchor-group-body">
          ${clearManual}
          ${anchors.length ? anchors.slice(-80).map(renderAnchorItem).join("") : ""}
        </div>
      </section>
    `;
  }).join("");
  byId("anchorGroups").innerHTML = html;
  byId("anchorCountBadge").textContent = String(allAnchors().length);
}

function renderAnchorItem(anchor) {
  const active = state.currentAnchor?.rawIndex === anchor.rawIndex ? "active" : "";
  const canDelete = anchor.kind === "manual";
  const lineNumber = Number(anchor.line) + 1;
  return `<div class="anchor-item ${active}" data-anchor-kind="${attr(anchor.kind)}">
    <button class="anchor-item-main" type="button" data-anchor-raw-index="${attr(anchor.rawIndex)}" title="跳转到日志 #${attr(lineNumber)}">
      <span class="anchor-summary">${escapeHtml(anchor.summary || anchor.keyword || anchor.tag)}</span>
      <span class="anchor-meta">#${lineNumber} · ${escapeHtml(anchor.device)} · ${escapeHtml(anchor.level)} · ${escapeHtml(anchor.tag)}</span>
      <span class="anchor-meta">${escapeHtml(anchor.time)} · ${escapeHtml(anchor.keyword || "-")}</span>
    </button>
    ${canDelete ? `<button class="anchor-item-delete" type="button" data-delete-manual-anchor="${attr(anchor.rawIndex)}" title="删除这个锚点" aria-label="删除锚点 #${attr(lineNumber)}">${iconSvg("trash")}</button>` : ""}
  </div>`;
}

function renderDetails() {
  // 选中日志详情面板已移除：日志定位、锚点和上下文跳转仍由主日志区承担。
}

function renderRawDetail(log) {
  const el = byId("detailRaw");
  if (!el) return;
  el.innerHTML = log
    ? `<div class="raw-box">${escapeHtml(formatRawLine(log))}</div>
       <div class="detail-meta">rawIndex=${log.rawIndex} · device=${escapeHtml(log.deviceId)} · package=${escapeHtml(log.packageName || "-")}</div>`
    : `<div class="empty-state">选择一条日志后查看原始内容。</div>`;
}

function renderContextDetail(log) {
  const el = byId("detailContext");
  if (!el) return;
  if (!log) {
    el.innerHTML = `<div class="empty-state">选择日志后可查看前后上下文。</div>`;
    return;
  }
  const before = state.contextMode?.before ?? 50;
  const after = state.contextMode?.after ?? 50;
  const logs = contextLogsFor(log, before, after);
  el.innerHTML = `
    <div class="detail-card-title">上下文预览 · 前 ${before} / 后 ${after}</div>
    <div class="context-list">
      ${logs.map((item) => `<div class="context-line log-level-${item.level.toLowerCase()} ${item.rawIndex === log.rawIndex ? "anchor" : ""}">
        <span>${item.rawIndex}</span>
        <span>${escapeHtml(item.timestamp || "-")}</span>
        <span class="level-text level-${item.level.toLowerCase()}">${escapeHtml(item.level)}</span>
        <span class="cell">${escapeHtml(item.tag || "-")}</span>
        <span class="cell">${escapeHtml(item.message || item.raw)}</span>
      </div>`).join("")}
    </div>`;
}

function renderStdoutDetail() {
  const el = byId("detailStdout");
  if (!el) return;
  el.innerHTML = `<div class="stdout-box">${escapeHtml(state.stdoutLines.slice(-220).join("\n") || "stdout 暂无内容")}</div>`;
}

function renderStderrDetail() {
  const el = byId("detailStderr");
  if (!el) return;
  el.innerHTML = `<div class="stderr-box">${escapeHtml(state.stderrLines.slice(-220).join("\n") || "stderr 暂无内容")}</div>`;
}

function renderAiDetail(log) {
  const el = byId("detailAi");
  if (!el) return;
  el.innerHTML = `
    <div class="ai-card">
诊断建议
- ${log ? "优先查看同一 PID/TID 与同一 Tag 的上下文，确认异常前后的触发链路。" : "选择日志或锚点后显示。"}
- Crash/ANR/Binder/Activity 会自动进入左侧锚点分组，可点击回到对应行。
- 若上下文不足，可先清屏后重新抓取，或导入完整 log 文件再定位。
    </div>`;
}

function scrollToLog(log) {
  if (!log) return;
  setAutoScroll(false);
  const logs = currentViewerLogs();
  const index = logs.findIndex((item) => item.rawIndex === log.rawIndex);
  if (index < 0) {
    state.contextMode = { logId: log.id, rawIndex: log.rawIndex, before: 80, after: 120 };
    state.selectedLogId = log.id;
    state.currentAnchor = anchorFromLog(log, "context", byId("keywordFilter").value.trim());
    return window.setTimeout(() => scrollToLog(log), 0);
  }
  const viewport = byId("dropZone");
  state.selectedLogId = log.id;
  state.currentAnchor = state.currentAnchor || anchorFromLog(log, "selected", byId("keywordFilter").value.trim());
  state.flashingRawIndex = log.rawIndex;
  setViewportScrollTop(viewport, Math.max(0, index * state.rowHeight - Math.floor(viewport.clientHeight / 2)));
  window.clearTimeout(state.clearFlashTimer);
  state.clearFlashTimer = window.setTimeout(() => {
    state.flashingRawIndex = null;
    renderVirtualLogs();
  }, 1800);
  renderAll();
  window.setTimeout(() => {
    setViewportScrollTop(viewport, Math.max(0, index * state.rowHeight - Math.floor(viewport.clientHeight / 2)));
    renderVirtualLogs();
  }, 32);
}

function selectLog(log, event = null) {
  if (!log) return;
  setAutoScroll(false);
  const logs = currentViewerLogs();
  const isShift = Boolean(event?.shiftKey);
  const isToggle = Boolean(event?.metaKey || event?.ctrlKey);

  if (isShift && state.lastSelectionRawIndex !== null) {
    const start = logs.findIndex((item) => item.rawIndex === state.lastSelectionRawIndex);
    const end = logs.findIndex((item) => item.rawIndex === log.rawIndex);
    if (start >= 0 && end >= 0) {
      const [from, to] = start <= end ? [start, end] : [end, start];
      if (!isToggle) state.selectedLogRawIndexes.clear();
      logs.slice(from, to + 1).forEach((item) => state.selectedLogRawIndexes.add(item.rawIndex));
    } else {
      state.selectedLogRawIndexes.add(log.rawIndex);
    }
  } else if (isToggle) {
    if (state.selectedLogRawIndexes.has(log.rawIndex)) state.selectedLogRawIndexes.delete(log.rawIndex);
    else state.selectedLogRawIndexes.add(log.rawIndex);
    state.lastSelectionRawIndex = log.rawIndex;
  } else {
    state.selectedLogRawIndexes.clear();
    state.selectedLogRawIndexes.add(log.rawIndex);
    state.lastSelectionRawIndex = log.rawIndex;
  }

  state.selectedLogId = log.id;
  if (!state.ghostAnchor) state.currentAnchor = anchorFromLog(log, "selected", byId("keywordFilter").value.trim());
  renderAll();
}

function clearSelection() {
  state.selectedLogRawIndexes.clear();
  state.lastSelectionRawIndex = null;
  state.selectedLogId = "";
  updateSelectionUi();
  renderVirtualLogs();
}

function keepOnlyFilteredLogs() {
  if (state.pendingLines.length) flushPendingLogs();
  applyFilters({ force: true, render: false });
  const keepRawIndexes = new Set(state.filteredLogs.map((log) => log.rawIndex));
  const removeCount = state.allLogs.length - keepRawIndexes.size;
  if (!state.allLogs.length) {
    setStatus("当前没有可裁剪的日志", "idle");
    return;
  }
  if (!keepRawIndexes.size) {
    setStatus("当前筛选结果为空，未裁剪内存日志", "error");
    return;
  }
  if (removeCount <= 0) {
    setStatus("当前内存日志已经全部命中筛选", "ready");
    return;
  }
  const ok = window.confirm(`仅保留当前筛选命中的 ${keepRawIndexes.size.toLocaleString()} 行日志，并从内存清除其它 ${removeCount.toLocaleString()} 行？`);
  if (!ok) return;

  state.allLogs = state.allLogs.filter((log) => keepRawIndexes.has(log.rawIndex));
  state.filteredLogs = state.filteredLogs.filter((log) => keepRawIndexes.has(log.rawIndex));
  state.rawIndexMap = new Map(state.allLogs.map((log) => [log.rawIndex, log]));
  state.runtimeEvents = state.runtimeEvents.filter((event) => keepRawIndexes.has(event.rawIndex));
  state.manualAnchors = state.manualAnchors.filter((anchor) => keepRawIndexes.has(anchor.rawIndex));
  state.selectedLogRawIndexes = new Set([...state.selectedLogRawIndexes].filter((rawIndex) => keepRawIndexes.has(rawIndex)));
  if (state.selectedLogId && !state.allLogs.some((log) => log.id === state.selectedLogId)) state.selectedLogId = "";
  if (state.lastSelectionRawIndex !== null && !keepRawIndexes.has(state.lastSelectionRawIndex)) state.lastSelectionRawIndex = null;
  if (state.contextMode && !keepRawIndexes.has(state.contextMode.rawIndex)) state.contextMode = null;
  if (state.currentAnchor && !keepRawIndexes.has(state.currentAnchor.rawIndex)) state.currentAnchor = null;
  if (state.ghostAnchor && !keepRawIndexes.has(state.ghostAnchor.rawIndex)) clearGhostAnchor();
  if (state.flashingRawIndex !== null && !keepRawIndexes.has(state.flashingRawIndex)) state.flashingRawIndex = null;
  state.stdoutLines = state.allLogs.slice(-3000).map(formatRawLine);
  state.allVersion += 1;
  state.filteredVersion += 1;
  state.timelineVersion = -1;
  state.lastFilterKey = "";
  applyFilters({ force: true, render: true });
  scheduleAnchorRender();
  setStatus(`已仅保留筛选结果 ${keepRawIndexes.size.toLocaleString()} 行，清除 ${removeCount.toLocaleString()} 行内存日志`, "ready");
}

function copySelectedLogs() {
  const selected = selectedLogsInViewer();
  const logs = selected.length ? selected : selectedLogsAll();
  if (!logs.length) {
    setStatus("请先选择要复制的日志行", "error");
    return;
  }
  navigator.clipboard.writeText(logs.map(formatRawLine).join("\n"));
  setStatus(`已复制 ${logs.length.toLocaleString()} 行日志`, "ready");
}

function resetFilters(options = {}) {
  if (byId("deviceMode")) byId("deviceMode").value = "multi";
  byId("levelFilter").value = "V,D,I,W,E,F";
  ["tagFilter", "pidFilter", "tidFilter", "packageFilter", "timeStart", "timeEnd", "keywordFilter", "keywordExcludeFilter", "highlightRegex"].forEach((id) => {
    if (byId(id)) byId(id).value = "";
  });
  ["tagFilterEnabled", "pidFilterEnabled", "tidFilterEnabled", "packageFilterEnabled", "timeFilterEnabled", "keywordFilterEnabled", "keywordExcludeFilterEnabled", "highlightRegexEnabled"].forEach((id) => {
    if (byId(id)) byId(id).checked = true;
  });
  renderLevelPicker();
  byId("filterPresetSelect").value = "";
  byId("filterPresetName").value = "";
  updateFilterPresetMeta();
  Object.keys(state.quickFilters).forEach((kind) => {
    state.quickFilters[kind] = { active: false, before: null };
  });
  renderQuickFilterButtons();
  state.lastFilterKey = "";
  if (options.apply !== false) applyFilters({ force: true, render: true });
}

function renderDevicePicker() {
  const panel = byId("deviceCheckboxPanel");
  const select = byId("deviceSelect");
  if (!panel || !select) return;
  const prevChecked = new Set([...document.querySelectorAll("[data-device-log-toggle]:checked")].map((input) => input.value));
  const deviceSources = state.devices.map((device) => ({
    id: device.serial || "",
    kind: "device",
    title: device.alias || device.model || device.serial || "Android Device",
    subtitle: device.serial || "-",
    count: null,
  })).filter((source) => source.id);
  const fileSources = state.fileSources.map((source) => ({ ...source, kind: "file" }));
  const sources = [...deviceSources, ...fileSources];

  select.innerHTML = sources.length
    ? sources.map((source) => `<option value="${attr(source.id)}">${escapeHtml(source.title)} (${escapeHtml(source.subtitle || source.id)})</option>`).join("")
    : `<option value="">暂无设备或导入日志</option>`;
  if (!sources.length) {
    panel.innerHTML = `<div class="device-empty-state">未发现在线设备。也可以导入 .log / .txt 文件作为日志源。</div>`;
    return;
  }
  panel.innerHTML = sources.map((source) => {
    const checked = prevChecked.size ? prevChecked.has(source.id) : true;
    const countText = Number.isFinite(source.count) ? ` · ${Number(source.count).toLocaleString()} 行` : "";
    return `
      <label class="device-check-item source-${attr(source.kind)}">
        <input type="checkbox" data-device-log-toggle data-source-kind="${attr(source.kind)}" value="${attr(source.id)}" ${checked ? "checked" : ""}>
        <span class="source-kind-pill ${source.kind === "file" ? "is-file" : "is-device"}">${source.kind === "file" ? ".log" : "ADB"}</span>
        <span class="device-check-main">
          <strong>${escapeHtml(source.title)}</strong>
          <small>${escapeHtml(source.subtitle || source.id)}${escapeHtml(countText)}</small>
        </span>
      </label>`;
  }).join("");
  syncHiddenDeviceSelectFromCheckboxes();
}

function syncHiddenDeviceSelectFromCheckboxes() {
  const checked = new Set([...document.querySelectorAll("[data-device-log-toggle]:checked")].map((input) => input.value));
  const select = byId("deviceSelect");
  if (!select) return;
  [...select.options].forEach((option) => {
    option.selected = checked.size ? checked.has(option.value) : false;
  });
}

function upsertFileSource(id, file, count = 0) {
  const existing = state.fileSources.find((source) => source.id === id);
  const next = {
    id,
    kind: "file",
    title: file.name,
    subtitle: `${(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 ? 1 : 3)} MB`,
    count,
    importedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, next);
  else state.fileSources.unshift(next);
  state.fileSources = state.fileSources.slice(0, 20);
}

function clearImportedLogSources() {
  const sourceIds = new Set(state.fileSources.map((source) => source.id).filter(Boolean));
  if (!sourceIds.size) {
    setStatus("没有可清除的导入日志记录", "ready");
    return;
  }
  const before = state.allLogs.length;
  state.fileSources = [];
  state.allLogs = state.allLogs.filter((log) => !sourceIds.has(log.deviceId));
  state.rawIndexMap = new Map(state.allLogs.map((log) => [log.rawIndex, log]));
  const keptRawIndexes = new Set(state.allLogs.map((log) => log.rawIndex));
  state.filteredLogs = state.filteredLogs.filter((log) => keptRawIndexes.has(log.rawIndex));
  state.runtimeEvents = state.runtimeEvents.filter((event) => keptRawIndexes.has(event.rawIndex));
  state.manualAnchors = state.manualAnchors.filter((anchor) => keptRawIndexes.has(anchor.rawIndex));
  if (state.contextMode && !keptRawIndexes.has(state.contextMode.rawIndex)) state.contextMode = null;
  if (state.currentAnchor && !keptRawIndexes.has(state.currentAnchor.rawIndex)) state.currentAnchor = null;
  if (state.ghostAnchor && !keptRawIndexes.has(state.ghostAnchor.rawIndex)) clearGhostAnchor();
  state.stdoutLines = state.allLogs.slice(-3000).map(formatRawLine);
  state.allVersion += 1;
  state.timelineVersion = -1;
  state.lastFilterKey = "";
  renderDevicePicker();
  applyFilters({ force: true, render: true });
  renderAnchors();
  setStatus(`已清除导入记录，移除 ${(before - state.allLogs.length).toLocaleString()} 行文件日志`, "ready");
}

function uniqueFileSourceId(fileName) {
  const base = `file:${fileName}`;
  if (!state.fileSources.some((source) => source.id === base)) return base;
  let index = 2;
  while (state.fileSources.some((source) => source.id === `${base}#${index}`)) index += 1;
  return `${base}#${index}`;
}

function syncDeviceCheckboxes(selected = new Set()) {
  const hasSelected = selected && selected.size;
  document.querySelectorAll("[data-device-log-toggle]").forEach((input) => {
    input.checked = hasSelected ? selected.has(input.value) : true;
  });
  syncHiddenDeviceSelectFromCheckboxes();
}

function applyProcessPackageCacheEntry(serial, entry) {
  if (!serial || !entry) return 0;
  state.processPackageCache = {
    ...state.processPackageCache,
    [serial]: {
      serial,
      updatedAtTs: Number(entry.updatedAtTs || 0),
      pidMap: entry.pidMap || {},
      processCount: Number(entry.processCount || 0),
      source: entry.source || "cache",
      error: entry.error || "",
    },
  };
  let changed = 0;
  state.allLogs.forEach((log) => {
    if (log.deviceId !== serial) return;
    const resolved = resolveLogProcessInfo(log.deviceId, log.pid, log.message, log.tag);
    if (resolved.processName && log.processName !== resolved.processName) {
      log.processName = resolved.processName;
      changed += 1;
    }
    if (resolved.packageName && log.packageName !== resolved.packageName) {
      log.packageName = resolved.packageName;
      log.packageSource = resolved.packageSource;
      changed += 1;
    }
  });
  return changed;
}

function hydrateProcessPackageCaches(entries = {}, options = {}) {
  let changed = 0;
  Object.entries(entries || {}).forEach(([serial, entry]) => {
    changed += applyProcessPackageCacheEntry(serial, entry);
  });
  if (Object.keys(entries || {}).length) state.lastProcessPackageRefreshAt = Date.now();
  if (changed || options.forceRender) {
    state.lastFilterKey = "";
    applyFilters({ force: true, render: options.render !== false });
  }
}

async function refreshProcessPackages(options = {}) {
  const serials = [...new Set((options.serials || selectedCaptureDeviceSerials()).filter(Boolean))];
  if (!serials.length) return {};
  if (state.processPackageRefreshPromise && !options.force) return state.processPackageRefreshPromise;
  const params = new URLSearchParams();
  serials.forEach((serial) => params.append("serial", serial));
  if (options.force) params.set("force", "true");
  const promise = api(`/api/logcat/process-packages?${params.toString()}`)
    .then((data) => {
      hydrateProcessPackageCaches(data.serials || {}, { forceRender: true });
      return data.serials || {};
    })
    .finally(() => {
      state.processPackageRefreshPromise = null;
    });
  state.processPackageRefreshPromise = promise;
  return promise;
}

function maybeRefreshProcessPackagesInBackground(options = {}) {
  const serials = [...new Set((options.serials || selectedCaptureDeviceSerials()).filter(Boolean))];
  if (!serials.length) return;
  const shouldForce = options.force === true;
  if (!shouldForce && Date.now() - state.lastProcessPackageRefreshAt < PROCESS_PACKAGE_REFRESH_INTERVAL_MS) return;
  refreshProcessPackages({ serials, force: shouldForce }).catch((error) => {
    state.stderrLines.push(`[process-package] refresh failed: ${error.message}`);
    state.stderrLines = state.stderrLines.slice(-1000);
  });
}

async function refreshDevices() {
  const panel = byId("deviceCheckboxPanel");
  if (panel) panel.innerHTML = `<div class="device-empty-state">读取设备中...</div>`;
  try {
    const data = await api("/api/devices?includeProcessPackages=1&refreshProcessPackages=1");
    state.devices = data.devices || [];
    hydrateProcessPackageCaches(data.processPackages || {}, { forceRender: false });
    renderDevicePicker();
    setStatus(`设备 ${state.devices.length} 台`, "ready");
  } catch (error) {
    state.devices = [];
    if (byId("deviceSelect")) byId("deviceSelect").innerHTML = `<option value="">ADB 不可用</option>`;
    if (panel) panel.innerHTML = `<div class="device-empty-state">ADB 不可用</div>`;
    setStatus(`设备读取失败：${error.message}`, "error");
  }
  applyFilters();
}


function logcatStopPayload(session) {
  return { sessionId: session?.sessionId || "", serial: session?.serial || "" };
}

async function stopLogcatSessionBestEffort(session, timeoutMs = 900) {
  if (!session?.sessionId) return;
  const stopPromise = api("/api/logcat/stop", {
    method: "POST",
    body: JSON.stringify(logcatStopPayload(session)),
  });
  let timer = null;
  try {
    await Promise.race([
      stopPromise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("stop request timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function markCaptureStoppedImmediately(notice = "已停止采集，屏幕日志已保留") {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  state.captureRunning = false;
  state.sessions = [];
  state.captureKind = "idle";
  state.captureNotice = notice;
  state.captureTransition = false;
  renderCaptureState();
}

async function startCapture(options = {}) {
  if (state.captureRunning || state.sessions.length) await stopCapture({ keepNotice: true });
  const token = ++state.captureToken;
  state.captureKind = "starting";
  state.captureTransition = true;
  state.captureRunning = false;
  state.sessions = [];
  renderCaptureState();
  if (options.replace) resetDisplayedLogs("已清空屏幕日志，准备从指定时间抓取");
  const serials = selectedCaptureDeviceSerials();
  await refreshProcessPackages({ serials, force: true }).catch((error) => {
    if (token === state.captureToken) state.stderrLines.push(`[process-package] preload failed: ${error.message}`);
  });
  if (token !== state.captureToken) return;
  state.sessions = [];
  state.captureRunning = true;
  state.captureTransition = false;
  state.captureKind = "running";
  setAutoScroll(true);
  const since = options.since ? normalizeLogcatSinceInput(options.since) : "";
  const clickStartedAt = since || new Date().toLocaleTimeString();
  setCaptureNotice(`启动采集中 · 从 ${clickStartedAt} 开始`, "running");
  setStatus(`启动采集中 · 从 ${clickStartedAt} 开始`, "running");
  for (const serial of serials.length ? serials : [""]) {
    if (token !== state.captureToken) return;
    try {
      const data = await api("/api/logcat/start", {
        method: "POST",
        body: JSON.stringify(since ? { serial, since, sinceNow: false } : { serial, sinceNow: true }),
      });
      if (token !== state.captureToken) {
        if (data?.sessionId) {
          api("/api/logcat/stop", {
            method: "POST",
            body: JSON.stringify({ sessionId: data.sessionId }),
          }).catch(() => {});
        }
        return;
      }
      state.sessions.push({
        sessionId: data.sessionId,
        serial: data.serial || serial || "-",
        offset: data.offset || 0,
        running: true,
        since: data.since || "",
      });
      if (data.since) state.stdoutLines.push(`[${data.serial || serial || "default"}] logcat 从 ${data.since} 之后开始采集`);
    } catch (error) {
      if (token !== state.captureToken) return;
      state.stderrLines.push(`[${serial || "default"}] start failed: ${error.message}`);
    }
  }
  if (token !== state.captureToken) return;
  state.captureRunning = state.sessions.some((session) => session.running);
  state.captureTransition = false;
  state.captureKind = state.captureRunning ? "running" : "error";
  setCaptureNotice(state.captureRunning ? `实时采集中 · ${state.sessions.length} session` : "启动失败", state.captureRunning ? "running" : "error");
  setStatus(state.captureRunning ? `实时采集中 · ${state.sessions.length} session` : "启动失败", state.captureRunning ? "running" : "error");
  renderDetails();
  if (state.captureRunning) pollLogcat(0, token);
}

async function startAdvancedCapture(mode = "append") {
  fillDefaultCaptureSince();
  const since = normalizeLogcatSinceInput(byId("captureSinceInput")?.value);
  if (!since) {
    setStatus("请输入抓取时间点", "error");
    return;
  }
  await startCapture({ since, replace: mode === "replace" });
  const panel = byId("advancedCapturePanel");
  if (panel) panel.open = false;
}

function captureStopIsAvailable() {
  return Boolean(
    state.captureRunning
    || state.sessions.length > 0
    || state.captureKind === "starting"
    || state.captureKind === "running"
    || state.captureKind === "stopping"
    || state.captureTransition
  );
}

function detachCaptureImmediately(options = {}) {
  // 根治停止按钮偶现无反应：停止是本地同步状态变更，不等待后端、不等待 poll、不等待启动流程。
  const token = ++state.captureToken;
  state.captureStopRequestedAt = Date.now();
  state.captureStopLatchUntil = Date.now() + 900;
  window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  window.clearTimeout(state.flushTimer);
  state.flushTimer = null;

  const sessions = [...state.sessions];
  state.sessions = [];
  state.captureRunning = false;
  state.captureTransition = false;
  state.captureKind = "idle";
  state.captureNotice = options.keepNotice ? (state.captureNotice || "已停止采集") : "已停止采集，屏幕日志已保留";
  state.lastBatchSize = 0;
  renderCaptureState();
  if (!options.keepNotice) setStatus("已停止，可继续抓取且保留当前屏幕日志", "idle");

  // 后端停止只做后台收尾。任何返回都不能再把前端恢复成 running。
  if (sessions.length) {
    Promise.allSettled(sessions.map((session) => stopLogcatSessionBestEffort(session))).then((results) => {
      if (token !== state.captureToken) return;
      const failed = results.filter((item) => item.status === "rejected");
      if (failed.length) {
        state.stderrLines.push(`[logcat] stop warning: ${failed.length} session stop request timed out or failed; UI has already detached.`);
        state.stderrLines = state.stderrLines.slice(-1000);
      }
      renderDetails();
    });
  }
  return { token, sessions };
}

async function stopCapture(options = {}) {
  detachCaptureImmediately(options);
}

async function pollLogcat(delay = 180, token = state.captureToken) {
  window.clearTimeout(state.pollTimer);
  if (token !== state.captureToken || !state.captureRunning || !state.sessions.length) return;
  let anyRunning = false;
  const sessions = [...state.sessions];
  for (const session of sessions) {
    if (token !== state.captureToken) return;
    if (!session.running) continue;
    try {
      const params = new URLSearchParams({ sessionId: session.sessionId, offset: String(session.offset), limit: "800" });
      const data = await api(`/api/logcat/poll?${params.toString()}`);
      if (token !== state.captureToken) return;
      session.offset = data.nextOffset || session.offset;
      session.running = Boolean(data.running);
      anyRunning = anyRunning || session.running || Boolean(data.hasMore);
      if (data.stderr) state.stderrLines.push(...String(data.stderr).split(/\r?\n/).filter(Boolean));
      if (data.lines?.length) appendRawLines(data.lines, data.serial || session.serial || "-");
    } catch (error) {
      if (token !== state.captureToken) return;
      session.running = false;
      state.stderrLines.push(`[${session.serial}] poll failed: ${error.message}`);
    }
  }
  if (token !== state.captureToken) return;
  state.stderrLines = state.stderrLines.slice(-1000);
  state.captureRunning = anyRunning;
  maybeRefreshProcessPackagesInBackground({ serials: state.sessions.map((session) => session.serial).filter(Boolean) });
  setCaptureNotice(anyRunning ? `采集中 · ${state.allLogs.length.toLocaleString()} 行` : "采集结束", anyRunning ? "running" : "idle");
  setStatus(anyRunning ? `采集中 · ${state.allLogs.length.toLocaleString()} 行` : "采集结束", anyRunning ? "running" : "idle");
  renderDetails();
  if (token === state.captureToken && state.captureRunning) state.pollTimer = window.setTimeout(() => pollLogcat(delay, token), delay);
}

function resetDisplayedLogs(notice = "屏幕日志已清空") {
  window.clearTimeout(state.flushTimer);
  state.flushTimer = null;
  state.allLogs = [];
  state.filteredLogs = [];
  state.runtimeEvents = [];
  state.timelineEvents = [];
  state.timelineBuildError = "";
  state.timelineBuildPending = false;
  state.manualAnchors = [];
  state.rawIndexMap = new Map();
  state.pendingLines = [];
  state.nextRawIndex = 0;
  state.selectedLogId = "";
  state.selectedLogRawIndexes.clear();
  state.lastSelectionRawIndex = null;
  state.currentAnchor = null;
  clearGhostAnchor();
  state.contextMode = null;
  state.stdoutLines = [];
  state.stderrLines = [];
  state.lastBatchSize = 0;
  state.lastLogAt = "";
  state.allVersion += 1;
  state.eventsVersion = -1;
  state.timelineVersion = -1;
  state.lastFilterKey = "";
  applyFilters({ force: true, render: true });
  setCaptureNotice(notice, state.captureRunning ? "running" : "idle");
  setStatus(notice, state.captureRunning ? "running" : "idle");
  renderDetails();
}

async function clearLogs() {
  resetDisplayedLogs(state.captureRunning ? "屏幕日志已清空，继续实时抓取" : "屏幕日志已清空");
  for (const session of state.sessions) {
    try {
      await api("/api/logcat/clear", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.sessionId, serial: session.serial, displayOnly: true }),
      });
    } catch {
      // UI clear is still useful even if device logcat -c is unavailable.
    }
  }
}


function openLogFilePicker(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
  const input = byId("logFileInput");
  if (!input) return;

  // 统一所有“导入日志”入口。浏览器文件选择器必须只由一次用户手势触发。
  // 之前空状态按钮既绑定了局部 click，又会冒泡到 document 委托，
  // 再加上 bindEvents 可能被重复执行，导致一次点击弹出两次资源管理器。
  const now = Date.now();
  if (now < state.importPickerLockedUntil) return;
  state.importPickerLockedUntil = now + 1200;

  // 允许用户连续选择同一个文件；清空 value 不会触发第二个 picker。
  input.value = "";
  input.click();

  // 用户取消选择时也要自动解锁；change 事件里会再次解锁。
  window.setTimeout(() => {
    if (Date.now() >= state.importPickerLockedUntil) state.importPickerLockedUntil = 0;
  }, 1300);
}

async function importLogFile(file) {
  if (!file) return;
  if (!/\.(log|txt)$/i.test(file.name)) {
    setStatus("导入失败：仅支持 .log / .txt", "error");
    return;
  }
  const sourceId = uniqueFileSourceId(file.name);
  upsertFileSource(sourceId, file, 0);
  renderDevicePicker();
  syncDeviceCheckboxes(new Set(selectedLogSources().concat(sourceId)));

  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let imported = 0;
  let scanned = 0;
  setStatus(`导入中 · ${file.name}`, "running");
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      scanned += lines.length;
      const parsedLines = lines.filter(isRecognizedLogcatLine);
      appendRawLines(parsedLines, sourceId);
      imported += parsedLines.length;
      const source = state.fileSources.find((item) => item.id === sourceId);
      if (source) source.count = imported;
      if (imported % 6000 < parsedLines.length || scanned % 12000 < lines.length) {
        renderDevicePicker();
        setStatus(`导入 ${imported.toLocaleString()} 行 · 已忽略 ${Math.max(0, scanned - imported).toLocaleString()} 行非 logcat`, "running");
        await nextFrame();
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      scanned += 1;
      if (isRecognizedLogcatLine(buffer)) {
        appendRawLines([buffer], sourceId);
        imported += 1;
      }
    }
    const source = state.fileSources.find((item) => item.id === sourceId);
    if (source) source.count = imported;
    renderDevicePicker();
    syncDeviceCheckboxes(new Set(selectedLogSources().concat(sourceId)));
    applyFilters({ force: true, render: true });
    setStatus(`导入完成 · ${file.name} · ${imported.toLocaleString()} 行`, "ready");
  } catch (error) {
    setStatus(`导入失败：${error.message}`, "error");
  }
}

async function importLogFiles(files) {
  const list = Array.from(files || []);
  for (const file of list) {
    // 顺序导入，避免多个大文件同时解析卡住 UI。
    // eslint-disable-next-line no-await-in-loop
    await importLogFile(file);
  }
}

function hasDraggedFiles(event) {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes("Files") || Boolean(dataTransfer.files?.length);
}

function importableDroppedFiles(event) {
  return Array.from(event?.dataTransfer?.files || []).filter((file) => /\.(log|txt)$/i.test(file.name || ""));
}

function setLogDragActive(active) {
  document.body.classList.toggle("is-log-file-dragging", Boolean(active));
  byId("dropZone")?.classList.toggle("dragging", Boolean(active));
}

function handleLogDragOver(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setLogDragActive(true);
}

function handleLogDragLeave(event) {
  if (!hasDraggedFiles(event)) return;
  const outsideWindow = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  if (outsideWindow) setLogDragActive(false);
}

function handleLogDrop(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  setLogDragActive(false);
  const files = importableDroppedFiles(event);
  if (!files.length) {
    setStatus("导入失败：仅支持 .log / .txt", "error");
    return;
  }
  importLogFiles(files);
}


function exportFilteredLogs() {
  const logs = currentViewerLogs();
  downloadText(`android-log-workbench-${exportTimestamp()}.log`, logs.map(formatRawLine).join("\n"));
}

function copyContext() {
  const log = selectedLog() || (state.contextMode ? findLogByRawIndex(state.contextMode.rawIndex) : null);
  const logs = contextLogsFor(log, state.contextMode?.before ?? 50, state.contextMode?.after ?? 50);
  navigator.clipboard.writeText(logs.map(formatRawLine).join("\n"));
  setStatus("上下文已复制", "ready");
}

function copyAnchors() {
  const text = allAnchors().map((anchor) => `#${Number(anchor.line) + 1} ${anchor.time} ${anchor.device} ${anchor.level}/${anchor.tag} ${anchor.summary}`).join("\n");
  navigator.clipboard.writeText(text);
  setStatus("锚点已复制", "ready");
}

function setQuickFilter(kind) {
  const config = QUICK_FILTER_CONFIG[kind];
  if (!config) return;
  syncQuickFilterState();
  const entry = state.quickFilters[kind] || { active: false, before: null };
  if (entry.active && quickFilterMatchesTarget(kind)) {
    applyQuickFilterSnapshot(entry.before || {});
    state.quickFilters[kind] = { active: false, before: null };
  } else {
    state.quickFilters[kind] = {
      active: true,
      before: quickFilterSnapshot(kind),
    };
    applyQuickFilterSnapshot(config.target);
  }
  syncQuickFilterState();
  state.lastFilterKey = "";
  applyFilters({ force: true, render: true });
}

async function toggleCapture(event) {
  event?.preventDefault?.();
  // 如果处于启动中/运行中/已有 session，点击主按钮一律视为“停止”。
  // 停止必须同步完成 UI 状态变更，不能 await 网络请求。
  if (captureStopIsAvailable()) {
    detachCaptureImmediately();
    return;
  }
  if (state.captureTransition) return;
  state.captureTransition = true;
  state.captureKind = "starting";
  renderCaptureState();
  try {
    await startCapture();
  } finally {
    if (state.captureKind === "starting") state.captureKind = state.captureRunning ? "running" : "idle";
    state.captureTransition = false;
    renderCaptureState();
  }
}

function handleCaptureButtonPointerDown(event) {
  // 捕获阶段处理“停止”，避免 click 事件被频繁重绘、loading 状态或子元素吞掉。
  if (!captureStopIsAvailable()) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  detachCaptureImmediately();
}

function handleCaptureButtonClick(event) {
  // pointerdown 已经处理过停止时，后续合成 click 必须吞掉，避免立刻又开始抓取。
  if (Date.now() < state.captureStopLatchUntil) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    return;
  }
  toggleCapture(event);
}

function closeQuickFilterMenu() {
  const menu = byId("quickFilterMenu");
  if (menu) menu.open = false;
}

function bindEvents() {
  byId("refreshDevicesBtn").addEventListener("click", refreshDevices);
  const captureButton = byId("startCaptureBtn");
  captureButton.addEventListener("pointerdown", handleCaptureButtonPointerDown, true);
  captureButton.addEventListener("click", handleCaptureButtonClick, true);
  byId("clearLogsBtn").addEventListener("click", clearLogs);
  byId("copySelectedLogsBtn")?.addEventListener("click", copySelectedLogs);
  byId("clearSelectionBtn")?.addEventListener("click", clearSelection);
  byId("filterFindPrevBtn")?.addEventListener("click", () => jumpFilterFind(-1));
  byId("filterFindNextBtn")?.addEventListener("click", () => jumpFilterFind(1));
  byId("filterFindCloseBtn")?.addEventListener("click", closeFilterFind);
  byId("filterFindField")?.addEventListener("change", () => {
    updateFindPreview();
  });
  byId("filterFindInput")?.addEventListener("input", () => {
    updateFindPreview();
  });
  byId("filterFindInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpFilterFind(event.shiftKey ? -1 : 1);
  });
  byId("advancedCapturePanel")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) fillDefaultCaptureSince();
  });
  const advancedCaptureSummary = byId("advancedCapturePanel")?.querySelector("summary");
  advancedCaptureSummary?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    state.advancedCapturePointerHandledUntil = Date.now() + 600;
    toggleAdvancedCapturePanel(event);
  }, true);
  advancedCaptureSummary?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < (state.advancedCapturePointerHandledUntil || 0)) return;
    toggleAdvancedCapturePanel(event);
  }, true);
  advancedCaptureSummary?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    toggleAdvancedCapturePanel(event);
  });
  byId("captureSinceInput")?.addEventListener("focus", () => fillDefaultCaptureSince());
  byId("appendSinceCaptureBtn")?.addEventListener("click", () => startAdvancedCapture("append"));
  byId("replaceSinceCaptureBtn")?.addEventListener("click", () => startAdvancedCapture("replace"));
  byId("importLogBtn").addEventListener("click", openLogFilePicker, true);
  byId("clearImportedSourcesBtn")?.addEventListener("click", clearImportedLogSources);
  document.querySelectorAll("[data-log-view]").forEach((button) => {
    button.addEventListener("click", () => setLogView(button.dataset.logView));
  });
  byId("timelineTypeFilter")?.addEventListener("change", (event) => {
    state.timelineType = event.target.value || "all";
    renderTimeline();
  });
  byId("timelineSearchInput")?.addEventListener("input", debounce((event) => {
    state.timelineQuery = event.target.value || "";
    renderTimeline();
  }, 120));
  byId("logFileInput").addEventListener("change", (event) => {
    state.importPickerLockedUntil = 0;
    importLogFiles(event.target.files);
  });
  byId("exportLogsBtn").addEventListener("click", exportFilteredLogs);
  byId("keepFilteredLogsBtn")?.addEventListener("click", keepOnlyFilteredLogs);
  byId("resetFiltersBtn").addEventListener("click", resetFilters);
  byId("quickErrorBtn").addEventListener("click", () => {
    setQuickFilter("errors");
    closeQuickFilterMenu();
  });
  byId("quickCrashBtn").addEventListener("click", () => setQuickFilter("crash"));
  byId("quickAnrBtn").addEventListener("click", () => {
    setQuickFilter("anr");
    closeQuickFilterMenu();
  });
  byId("filterPresetSelect").addEventListener("change", () => {
    const preset = selectedFilterPreset();
    persistLastFilterPreset(preset?.id || "");
    byId("filterPresetName").value = preset?.name || "";
    updateFilterPresetMeta();
  });
  byId("applyFilterPresetBtn").addEventListener("click", applySelectedFilterPreset);
  byId("saveFilterPresetBtn").addEventListener("click", saveFilterPreset);
  byId("deleteFilterPresetBtn").addEventListener("click", deleteSelectedFilterPreset);
  byId("clearAnchorsBtn")?.addEventListener("click", () => {
    state.manualAnchors = [];
    renderAnchors();
  });
  byId("copyAnchorsBtn")?.addEventListener("click", copyAnchors);
  byId("scrollBottomBtn").addEventListener("click", () => {
    const viewport = byId("dropZone");
    clearGhostAnchor();
    setViewportScrollTop(viewport, viewport.scrollHeight);
    renderVirtualLogs();
  });
  byId("scrollTopBtn")?.addEventListener("click", () => {
    const viewport = byId("dropZone");
    setAutoScroll(false);
    setViewportScrollTop(viewport, 0);
    renderVirtualLogs();
  });
  byId("anchorFilteredOnlyToggle")?.addEventListener("change", (event) => {
    state.anchorFilteredOnly = Boolean(event.target.checked);
    renderAnchors();
  });
  byId("autoScrollToggle")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      clearGhostAnchor();
      renderVirtualLogs();
    }
  });
  byId("levelPickerPanel")?.addEventListener("change", updateLevelFilterFromPicker);
  byId("deviceCheckboxPanel")?.addEventListener("change", (event) => {
    if (!event.target.closest("[data-device-log-toggle]")) return;
    syncHiddenDeviceSelectFromCheckboxes();
    scheduleFilter();
  });
  byId("columnPickerToggle")?.addEventListener("click", toggleColumnPicker);
  byId("columnPickerPanel")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-column-toggle]");
    if (!input) return;
    const col = input.dataset.columnToggle;
    if (input.checked) state.visibleColumns.add(col);
    else state.visibleColumns.delete(col);
    if (!state.visibleColumns.has("message")) state.visibleColumns.add("message");
    persistColumnPrefs();
    renderColumnPicker();
    renderVirtualLogs();
  });
  document.querySelector(".log-table-head")?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-resize-column]");
    if (!handle) return;
    startColumnResize(event, handle.dataset.resizeColumn);
  });
  document.querySelector(".log-table-head")?.addEventListener("dblclick", (event) => {
    const handle = event.target.closest("[data-resize-column]");
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    resetColumnWidth(handle.dataset.resizeColumn);
  });
  document.addEventListener("pointermove", updateColumnResize);
  document.addEventListener("pointerup", finishColumnResize);
  document.addEventListener("pointercancel", finishColumnResize);
  window.addEventListener("resize", placeOpenFloatingPanels);
  document.addEventListener("pointerdown", (event) => closeFloatingPanelsOutside(event.target), true);
  byId("returnAnchorBtn").addEventListener("click", () => {
    const anchor = state.contextMode ? anchorFromLog(findLogByRawIndex(state.contextMode.rawIndex), "context", byId("keywordFilter").value.trim()) : state.currentAnchor;
    jumpToAnchor(anchor, { forceGhost: true });
  });
  byId("applyContextRangeBtn")?.addEventListener("click", () => applyContextRange());
  ["contextBeforeInput", "contextAfterInput"].forEach((id) => {
    byId(id)?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyContextRange();
    });
  });
  byId("exitContextBtn").addEventListener("click", exitContextMode);
  byId("aiAnalyzeBtn")?.addEventListener("click", () => setStatus("AI 分析面板已暂时收起，后续可在日志行/锚点工作流中接入。", "ready"));
  byId("dropZone").addEventListener("scroll", handleLogViewportScroll);
  byId("dropZone").addEventListener("mouseup", () => markTextSelectionRenderPause());
  byId("dropZone").addEventListener("dragover", handleLogDragOver);
  byId("dropZone").addEventListener("dragleave", handleLogDragLeave);
  byId("dropZone").addEventListener("drop", handleLogDrop);
  document.addEventListener("dragover", handleLogDragOver);
  document.addEventListener("dragleave", handleLogDragLeave);
  document.addEventListener("drop", handleLogDrop);
  document.querySelectorAll("[data-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => setDetailTab(button.dataset.detailTab));
  });
  document.querySelectorAll(".workbench-toolbar input, .workbench-toolbar select").forEach((control) => {
    if (control.id === "logFileInput") return;
    control.addEventListener("input", scheduleFilter);
    control.addEventListener("change", scheduleFilter);
    if (findConfigForControl(control)) {
      control.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        jumpFilterFind(event.shiftKey ? -1 : 1, control);
      });
    }
  });

  document.addEventListener("click", (event) => {
    const logs = currentViewerLogs();
    const addAnchor = event.target.closest("[data-add-anchor]");
    const contextLog = event.target.closest("[data-context-log]");
    const copyLog = event.target.closest("[data-copy-log]");
    const row = event.target.closest("[data-view-index]");
    const deleteManualAnchor = event.target.closest("[data-delete-manual-anchor]");
    const anchor = event.target.closest("[data-anchor-raw-index]");
    const toggleAnchorGroup = event.target.closest("[data-toggle-anchor-group]");
    const clearManualAnchors = event.target.closest("[data-clear-manual-anchors]");
    const ghostContext = event.target.closest("[data-ghost-anchor-context]");
    const ghostClearFilter = event.target.closest("[data-ghost-anchor-clear-filter]");
    const ghostDismiss = event.target.closest("[data-ghost-anchor-dismiss]");
    const preset = event.target.closest("[data-context-preset]");
    const copyContextBtn = event.target.closest("#copyContextBtn");
    const timelineEvent = event.target.closest("[data-timeline-line-index]");
    const logViewTab = event.target.closest("[data-log-view]");
    const emptyStart = event.target.closest("[data-log-empty-start]");
    const emptyImport = event.target.closest("[data-log-empty-import]");

    if (logViewTab) {
      event.preventDefault();
      setLogView(logViewTab.dataset.logView);
      event.stopPropagation();
      return;
    }

    closeFloatingPanelsOutside(event.target);
    if (byId("quickFilterMenu")?.open && !event.target.closest("#quickFilterMenu")) {
      closeQuickFilterMenu();
    }

    if (emptyStart) {
      toggleCapture();
      event.stopPropagation();
      return;
    }
    if (emptyImport) {
      openLogFilePicker(event);
      event.stopPropagation();
      return;
    }
    if (addAnchor) {
      addManualAnchor(findLogById(addAnchor.dataset.addAnchor));
      event.stopPropagation();
      return;
    }
    if (contextLog) {
      enterContextMode(findLogById(contextLog.dataset.contextLog), 50, 50);
      event.stopPropagation();
      return;
    }
    if (copyLog) {
      const log = findLogById(copyLog.dataset.copyLog);
      navigator.clipboard.writeText(formatRawLine(log));
      event.stopPropagation();
      return;
    }
    if (toggleAnchorGroup) {
      const kind = toggleAnchorGroup.dataset.toggleAnchorGroup;
      state.anchorCollapsed[kind] = !isAnchorGroupCollapsed(kind);
      persistAnchorCollapsed();
      renderAnchors();
      return;
    }
    if (clearManualAnchors) {
      state.manualAnchors = [];
      if (state.currentAnchor?.kind === "manual") state.currentAnchor = null;
      clearGhostAnchor();
      renderAnchors();
      renderVirtualLogs();
      setStatus("已清空手动锚点", "ready");
      event.stopPropagation();
      return;
    }
    if (deleteManualAnchor) {
      removeManualAnchorByRawIndex(deleteManualAnchor.dataset.deleteManualAnchor);
      event.stopPropagation();
      return;
    }
    if (ghostContext) {
      const log = findLogByRawIndex(state.ghostAnchor?.rawIndex);
      clearGhostAnchor();
      enterContextMode(log, 50, 50);
      event.stopPropagation();
      return;
    }
    if (ghostClearFilter) {
      const anchorBeforeReset = state.currentAnchor;
      clearGhostAnchor();
      resetFilters();
      window.setTimeout(() => jumpToAnchor(anchorBeforeReset, { forceGhost: true }), 0);
      event.stopPropagation();
      return;
    }
    if (ghostDismiss) {
      dismissGhostAnchor();
      renderVirtualLogs();
      setStatus("已隐藏本次幽灵锚点提示", "ready");
      event.stopPropagation();
      return;
    }
    if (anchor) {
      const rawIndex = Number(anchor.dataset.anchorRawIndex);
      const log = findLogByRawIndex(rawIndex);
      if (!log) {
        setStatus(`锚点 #${rawIndex + 1} 已不在内存窗口内`, "error");
        return;
      }
      state.currentAnchor = allAnchors().find((item) => item.rawIndex === rawIndex) || anchorFromLog(log, "manual");
      if (state.contextMode && state.contextMode.rawIndex !== rawIndex) state.contextMode = null;
      jumpToAnchor(state.currentAnchor, { forceGhost: true });
      return;
    }
    if (preset) {
      const log = selectedLog() || (state.contextMode ? findLogByRawIndex(state.contextMode.rawIndex) : null);
      const range = contextPreset(preset.dataset.contextPreset);
      setContextRangeInputs(range.before, range.after);
      applyContextRange(range);
      return;
    }
    if (copyContextBtn) {
      copyContext();
      return;
    }
    if (timelineEvent) {
      const lineIndex = Number(timelineEvent.dataset.timelineLineIndex);
      const log = findLogByRawIndex(lineIndex);
      if (!log) {
        setStatus(`Timeline 事件 #${lineIndex + 1} 已不在内存窗口内`, "error");
        return;
      }
      setLogView("logs");
      window.setTimeout(() => scrollToLog(log), 0);
      setStatus(`已跳转 Timeline 事件 #${lineIndex + 1}`, "ready");
      return;
    }
    if (row) {
      if (hasActiveLogTextSelection()) return;
      selectLog(logs[Number(row.dataset.viewIndex)], event);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input,select,textarea")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && state.selectedLogRawIndexes.size) {
      event.preventDefault();
      copySelectedLogs();
      return;
    }
    if (event.key === "Escape" && state.selectedLogRawIndexes.size) {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const logs = currentViewerLogs();
    const current = Math.max(0, logs.findIndex((log) => log.id === state.selectedLogId));
    const next = event.key === "ArrowDown" ? Math.min(logs.length - 1, current + 1) : Math.max(0, current - 1);
    if (logs[next]) {
      event.preventDefault();
      scrollToLog(logs[next]);
    }
  });
}

async function init() {
  loadFilterPresets();
  loadColumnPrefs();
  bindEvents();
  renderFilterPresets();
  renderColumnPicker();
  renderLevelPicker();
  await refreshDevices();
  if (!applyStartupFilterPreset()) {
    applyFilters({ force: true, render: true });
  } else {
    applyFilters({ force: true, render: true });
  }
  setDetailTab("raw");
  // Ensure the first paint also shows the empty-state canvas when no logs are in memory.
  window.requestAnimationFrame(() => {
    if (!state.allLogs.length && state.activeLogView === "logs") renderVirtualLogs();
  });
}

init();
