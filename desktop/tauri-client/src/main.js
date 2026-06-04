const tauriInvoke = window.__TAURI__?.core?.invoke;
const isTauri = typeof tauriInvoke === "function";
const languageStorageKey = "cqclaw.client.language";
const themeStorageKey = "cqclaw.client.theme";
const supportedThemes = new Set(["system", "light", "dark"]);

const messages = {
  zh: {
    "app.title": "CQClaw 客户端",
    "brand.subtitle": "桌面控制台",
    "side.version": "版本",
    "side.windowClose": "关闭窗口",
    "side.windowCloseValue": "隐藏到托盘",
    "side.exitAction": "退出动作",
    "side.exitActionValue": "停止服务",
    "top.title": "CQClaw 控制中心",
    "top.subtitle": "查看本地自动化服务、Web 控制台、开机启动和 Android 设备状态。",
    "language.aria": "语言切换",
    "theme.aria": "主题切换",
    "theme.system": "系统",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "action.refresh": "刷新",
    "action.start": "启动服务",
    "action.openWeb": "打开 Web",
    "action.stop": "停止服务",
    "action.clear": "清空",
    "action.enableAutostart": "开启服务自启动",
    "action.disableAutostart": "关闭服务自启动",
    "hero.actionsAria": "主要服务命令",
    "serviceControls.aria": "服务启停",
    "autostart.serviceLabel": "服务开机启动",
    "autostart.clientLabel": "客户端开机启动",
    "launch.aria": "功能入口",
    "launch.web.title": "Web 控制台",
    "launch.web.desc": "打开主工作台",
    "launch.dump.title": "Dump 分析",
    "launch.dump.desc": "截图和节点解析",
    "launch.logs.title": "日志洞察",
    "launch.logs.desc": "查看运行日志",
    "launch.automation.title": "自动化流程",
    "launch.automation.desc": "编排和运行任务",
    "launch.devices.title": "设备管理",
    "launch.devices.desc": "多设备和文件操作",
    "hero.running.badge": "就绪",
    "hero.running.label": "服务在线",
    "hero.running.title": "CQClaw 已准备就绪",
    "hero.running.subtitle": "Web 控制台可访问，本地 Android 自动化命令可以正常执行。",
    "hero.running.sideTitle": "可以开始自动化",
    "hero.running.sideText": "关闭窗口后，CQClaw 会继续在托盘运行。",
    "hero.degraded.badge": "需检查",
    "hero.degraded.label": "服务异常",
    "hero.degraded.title": "服务已运行，Web 未连通",
    "hero.degraded.subtitle": "请检查端口、日志，或重启服务后再打开 Web 控制台。",
    "hero.degraded.sideTitle": "服务需要检查",
    "hero.degraded.sideText": "CQClaw 进程已运行，但 HTTP 健康检查未通过。",
    "hero.stopped.badge": "已停止",
    "hero.stopped.label": "服务已停止",
    "hero.stopped.title": "启动 CQClaw 后使用 Web 控制台",
    "hero.stopped.subtitle": "托盘客户端正在运行，但本地自动化服务当前离线。",
    "hero.stopped.sideTitle": "等待启动",
    "hero.stopped.sideText": "先在这里启动服务，再打开 Web 控制台。",
    "hero.checking.badge": "检查中",
    "hero.checking.label": "检查服务中",
    "hero.checking.title": "正在准备 CQClaw 状态",
    "hero.checking.subtitle": "正在收集服务、Web、开机启动和设备信息。",
    "hero.error.badge": "错误",
    "hero.error.label": "刷新失败",
    "hero.error.title": "无法读取 CQClaw 状态",
    "metric.service": "服务",
    "metric.port": "端口",
    "metric.autostart": "服务启动",
    "metric.devices": "设备",
    "metrics.aria": "服务指标",
    "panel.devices": "Android 设备",
    "panel.environment": "运行环境",
    "panel.activity": "最近活动",
    "panel.waiting": "等待刷新",
    "panel.notRefreshed": "未刷新",
    "env.home": "项目目录",
    "env.webUrl": "Web 地址",
    "env.port": "服务端口",
    "env.pid": "进程 PID",
    "env.autostartTarget": "启动项",
    "env.log": "日志",
    "status.working": "处理中",
    "status.running": "运行中",
    "status.stopped": "已停止",
    "status.httpOk": "HTTP 正常",
    "status.offline": "离线",
    "status.notConnected": "未连接",
    "status.enabled": "已开启",
    "status.disabled": "已关闭",
    "status.unknown": "未知",
    "status.reachable": "可访问",
    "status.notReachable": "不可访问",
    "status.alive": "存活",
    "device.none.summary": "没有在线设备",
    "device.none.title": "没有在线 Android 设备",
    "device.none.text": "连接设备并开启 USB 调试后，点击刷新。",
    "device.online": "{count} 台在线",
    "device.fallbackName": "Android 设备",
    "device.unknownSerial": "未知序列号",
    "device.state.device": "设备",
    "activity.empty": "暂无最近活动",
    "activity.commandOutput": "命令输出",
    "activity.openSkipped.title": "未打开 Web",
    "activity.openSkipped.detail": "当前没有可用的 Web 控制台地址。",
    "activity.opened.title": "已打开 Web 控制台",
    "activity.openedPath.title": "已打开功能入口",
    "activity.openFailed.title": "打开 Web 失败",
    "activity.refreshed.title": "状态已刷新",
    "activity.refreshed.detail": "{count} 台设备，服务{tone}",
    "activity.refreshFailed.title": "刷新失败",
    "activity.commandRunning.title": "正在处理",
    "activity.commandDone.title": "命令已完成",
    "activity.commandFailed.title": "命令失败",
    "last.refreshed": "刷新于 {time}",
    "tone.running": "正常",
    "tone.degraded": "需检查",
    "tone.stopped": "已停止",
    "log.webUrlMissing": "Web 控制台地址不可用，请先启动 CQClaw。",
    "log.featureUrlMissing": "服务地址不可用，请先启动 CQClaw 后再打开功能入口。",
    "log.clientAutostartEnabled": "客户端已设置为登录后自动启动并隐藏到托盘。",
    "log.clientAutostartDisabled": "客户端开机启动已关闭。",
    "error.tauriUnavailable": "浏览器预览中无法调用 Tauri 命令：{command}",
    "error.exitCode": "退出码 {code}",
    "mock.preview": "预览模式",
  },
  en: {
    "app.title": "CQClaw Client",
    "brand.subtitle": "Desktop Control",
    "side.version": "Version",
    "side.windowClose": "Window close",
    "side.windowCloseValue": "Hides to tray",
    "side.exitAction": "Exit action",
    "side.exitActionValue": "Stops service",
    "top.title": "CQClaw Control Center",
    "top.subtitle": "Monitor the local automation service, web console, startup setting, and Android devices.",
    "language.aria": "Language switch",
    "theme.aria": "Theme switch",
    "theme.system": "System",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "action.refresh": "Refresh",
    "action.start": "Start",
    "action.openWeb": "Open Web",
    "action.stop": "Stop",
    "action.clear": "Clear",
    "action.enableAutostart": "Enable Service Autostart",
    "action.disableAutostart": "Disable Service Autostart",
    "hero.actionsAria": "Primary service commands",
    "serviceControls.aria": "Service controls",
    "autostart.serviceLabel": "Service Autostart",
    "autostart.clientLabel": "Client Autostart",
    "launch.aria": "Feature launchers",
    "launch.web.title": "Web Console",
    "launch.web.desc": "Open dashboard",
    "launch.dump.title": "Dump Inspector",
    "launch.dump.desc": "Screenshot and UI tree",
    "launch.logs.title": "Log Insight",
    "launch.logs.desc": "Inspect runtime logs",
    "launch.automation.title": "Automation",
    "launch.automation.desc": "Build and run workflows",
    "launch.devices.title": "Device Manager",
    "launch.devices.desc": "Devices and files",
    "hero.running.badge": "Ready",
    "hero.running.label": "Service online",
    "hero.running.title": "CQClaw is ready",
    "hero.running.subtitle": "The web console is reachable and Android automation commands can run locally.",
    "hero.running.sideTitle": "Ready for automation",
    "hero.running.sideText": "Close the window to keep CQClaw available from the tray.",
    "hero.degraded.badge": "Needs check",
    "hero.degraded.label": "Service degraded",
    "hero.degraded.title": "Service running, web offline",
    "hero.degraded.subtitle": "Check the port, logs, or restart the service if the web console cannot open.",
    "hero.degraded.sideTitle": "Service needs attention",
    "hero.degraded.sideText": "CQClaw has a process, but the HTTP health check is failing.",
    "hero.stopped.badge": "Stopped",
    "hero.stopped.label": "Service stopped",
    "hero.stopped.title": "Start CQClaw to use the web console",
    "hero.stopped.subtitle": "The tray app is running, but the local automation service is currently offline.",
    "hero.stopped.sideTitle": "Waiting to start",
    "hero.stopped.sideText": "Start the service here, then open the web console.",
    "hero.checking.badge": "Checking",
    "hero.checking.label": "Checking service",
    "hero.checking.title": "Preparing CQClaw status",
    "hero.checking.subtitle": "Collecting service, web, autostart, and device information.",
    "hero.error.badge": "Error",
    "hero.error.label": "Refresh failed",
    "hero.error.title": "Could not read CQClaw status",
    "metric.service": "Service",
    "metric.port": "Port",
    "metric.autostart": "Service Startup",
    "metric.devices": "Devices",
    "metrics.aria": "Service metrics",
    "panel.devices": "Android Devices",
    "panel.environment": "Environment",
    "panel.activity": "Activity",
    "panel.waiting": "Waiting for refresh",
    "panel.notRefreshed": "Not refreshed",
    "env.home": "Home",
    "env.webUrl": "Web URL",
    "env.port": "Port",
    "env.pid": "PID",
    "env.autostartTarget": "Autostart Target",
    "env.log": "Log",
    "status.working": "Working",
    "status.running": "Running",
    "status.stopped": "Stopped",
    "status.httpOk": "HTTP OK",
    "status.offline": "Offline",
    "status.notConnected": "Not connected",
    "status.enabled": "Enabled",
    "status.disabled": "Disabled",
    "status.unknown": "Unknown",
    "status.reachable": "reachable",
    "status.notReachable": "not reachable",
    "status.alive": "alive",
    "device.none.summary": "No online devices",
    "device.none.title": "No Android device online",
    "device.none.text": "Connect a device and enable USB debugging, then refresh.",
    "device.online": "{count} online",
    "device.fallbackName": "Android Device",
    "device.unknownSerial": "unknown serial",
    "device.state.device": "device",
    "activity.empty": "No recent activity",
    "activity.commandOutput": "Command output",
    "activity.openSkipped.title": "Open Web skipped",
    "activity.openSkipped.detail": "No web console URL is available.",
    "activity.opened.title": "Opened Web Console",
    "activity.openedPath.title": "Opened feature",
    "activity.openFailed.title": "Open Web failed",
    "activity.refreshed.title": "Status refreshed",
    "activity.refreshed.detail": "{count} device(s), {tone} service",
    "activity.refreshFailed.title": "Refresh failed",
    "activity.commandRunning.title": "Working",
    "activity.commandDone.title": "Command completed",
    "activity.commandFailed.title": "Command failed",
    "last.refreshed": "Refreshed {time}",
    "tone.running": "running",
    "tone.degraded": "degraded",
    "tone.stopped": "stopped",
    "log.webUrlMissing": "Web console URL is not available. Start CQClaw first.",
    "log.featureUrlMissing": "Service URL is not available. Start CQClaw before opening a feature.",
    "log.clientAutostartEnabled": "Client autostart is enabled and will start hidden in the tray after login.",
    "log.clientAutostartDisabled": "Client autostart is disabled.",
    "error.tauriUnavailable": "Tauri command is unavailable in browser preview: {command}",
    "error.exitCode": "Exit code {code}",
    "mock.preview": "preview mode",
  },
};

const elements = {
  healthPill: document.getElementById("healthPill"),
  sideHeadline: document.getElementById("sideHeadline"),
  sideDescription: document.getElementById("sideDescription"),
  serviceHero: document.getElementById("serviceHero"),
  serviceStateLabel: document.getElementById("serviceStateLabel"),
  serviceTitle: document.getElementById("serviceTitle"),
  serviceSubtitle: document.getElementById("serviceSubtitle"),
  serverStatus: document.getElementById("serverStatus"),
  portStatus: document.getElementById("portStatus"),
  connectionStatus: document.getElementById("connectionStatus"),
  autostartStatus: document.getElementById("autostartStatus"),
  deviceCount: document.getElementById("deviceCount"),
  deviceSummary: document.getElementById("deviceSummary"),
  deviceList: document.getElementById("deviceList"),
  homePath: document.getElementById("homePath"),
  serverUrl: document.getElementById("serverUrl"),
  portDetail: document.getElementById("portDetail"),
  pidDetail: document.getElementById("pidDetail"),
  pythonPath: document.getElementById("pythonPath"),
  autostartTarget: document.getElementById("autostartTarget"),
  logPath: document.getElementById("logPath"),
  lastRefresh: document.getElementById("lastRefresh"),
  activityList: document.getElementById("activityList"),
  outputLog: document.getElementById("outputLog"),
  refreshBtn: document.getElementById("refreshBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  openBtn: document.getElementById("openBtn"),
  autostartToggle: document.getElementById("autostartToggle"),
  autostartButtonText: document.getElementById("autostartButtonText"),
  clientAutostartToggle: document.getElementById("clientAutostartToggle"),
  clientAutostartButtonText: document.getElementById("clientAutostartButtonText"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  langZhBtn: document.getElementById("langZhBtn"),
  langEnBtn: document.getElementById("langEnBtn"),
  themeButtons: [...document.querySelectorAll("[data-theme-mode]")],
  launchButtons: [...document.querySelectorAll("[data-open-path]")],
  buttons: [...document.querySelectorAll("button")],
};

function initialTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  return supportedThemes.has(savedTheme) ? savedTheme : "system";
}

const state = {
  language: localStorage.getItem(languageStorageKey) === "en" ? "en" : "zh",
  theme: initialTheme(),
  service: {
    running: false,
    pidAlive: false,
    httpConnected: false,
    pid: "",
    port: "",
    url: "",
    home: "",
    log: "",
  },
  autostart: {
    status: "unknown",
    target: "",
  },
  clientAutostart: {
    status: "unknown",
    target: "",
    command: "",
  },
  devices: [],
  python: "",
  busy: false,
  activities: [],
};

function t(key, params = {}) {
  const template = messages[state.language][key] || messages.zh[key] || key;
  return Object.entries(params).reduce((text, [name, value]) => {
    const resolved = value && typeof value === "object" && value.key ? t(value.key, value.params || {}) : value;
    return text.replaceAll(`{${name}}`, String(resolved));
  }, template);
}

function setLanguage(language) {
  state.language = language === "en" ? "en" : "zh";
  localStorage.setItem(languageStorageKey, state.language);
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });
  elements.langZhBtn.classList.toggle("is-active", state.language === "zh");
  elements.langEnBtn.classList.toggle("is-active", state.language === "en");
  elements.langZhBtn.setAttribute("aria-pressed", String(state.language === "zh"));
  elements.langEnBtn.setAttribute("aria-pressed", String(state.language === "en"));
  renderService();
  renderDevices();
  renderActivity();
}

function applyTheme(theme) {
  state.theme = supportedThemes.has(theme) ? theme : "system";
  localStorage.setItem(themeStorageKey, state.theme);
  if (state.theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = state.theme;
  }
  elements.themeButtons.forEach((button) => {
    const active = button.dataset.themeMode === state.theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function appendActivity(titleKey, detail = "", tone = "neutral", params = {}) {
  state.activities.unshift({
    titleKey,
    detail,
    tone,
    params,
    time: nowLabel(),
  });
  state.activities = state.activities.slice(0, 6);
  renderActivity();
}

function activityDetailText(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  return t(detail.key, detail.params || {});
}

function appendLog(text) {
  if (!text) return;
  const next = `${elements.outputLog.textContent}${text.trimEnd()}\n`;
  elements.outputLog.textContent = next.slice(Math.max(0, next.length - 16000));
}

function setText(element, value) {
  element.textContent = value || "-";
}

function setBusy(value, activeControl = null) {
  state.busy = value;
  document.body.classList.toggle("is-command-busy", value);
  document.querySelectorAll(".is-busy[aria-busy]").forEach((element) => {
    element.classList.remove("is-busy");
    element.removeAttribute("aria-busy");
  });
  const activeShell = activeControl?.closest?.(".autostart-switch-card") || activeControl;
  if (value && activeShell) {
    activeShell.classList.add("is-busy");
    activeShell.setAttribute("aria-busy", "true");
  }
  elements.buttons.forEach((button) => {
    if (!["clearLogBtn", "langZhBtn", "langEnBtn", "themeSystemBtn", "themeLightBtn", "themeDarkBtn"].includes(button.id)) button.disabled = value;
  });
  if (value) {
    elements.healthPill.textContent = t("status.working");
    elements.healthPill.dataset.state = "working";
  }
  applyButtonState();
}

function applyButtonState() {
  elements.autostartButtonText.textContent = state.autostart.status === "enabled" ? t("status.enabled") : state.autostart.status === "disabled" ? t("status.disabled") : t("status.unknown");
  elements.autostartToggle.checked = state.autostart.status === "enabled";
  elements.autostartToggle.disabled = state.busy || state.autostart.status === "unknown";
  elements.clientAutostartButtonText.textContent = state.clientAutostart.status === "enabled" ? t("status.enabled") : state.clientAutostart.status === "disabled" ? t("status.disabled") : t("status.unknown");
  elements.clientAutostartToggle.checked = state.clientAutostart.status === "enabled";
  elements.clientAutostartToggle.disabled = state.busy || state.clientAutostart.status === "unknown";
  if (state.busy) return;
  elements.buttons.forEach((button) => {
    button.disabled = false;
  });
  elements.startBtn.disabled = state.service.running;
  elements.stopBtn.disabled = !state.service.running;
  elements.openBtn.disabled = !state.service.url;
  elements.launchButtons.forEach((button) => {
    button.disabled = !state.service.url;
  });
  elements.autostartToggle.disabled = state.autostart.status === "unknown";
  elements.clientAutostartToggle.disabled = state.clientAutostart.status === "unknown";
}

function parseKeyedLine(text, key) {
  const line = text.split("\n").find((item) => item.startsWith(`${key}:`));
  return line ? line.split(":").slice(1).join(":").trim() : "";
}

function parseStatus(text) {
  const running = text.includes("CQClaw: running");
  const healthLine = text.split("\n").find((line) => line.startsWith("health:")) || "";
  const url = parseKeyedLine(text, "url");
  let port = "";
  try {
    port = url ? new URL(url).port : "";
  } catch {
    port = "";
  }
  return {
    running,
    url,
    port,
    pid: parseKeyedLine(text, "pid"),
    home: parseKeyedLine(text, "home"),
    log: parseKeyedLine(text, "log"),
    pidAlive: /pid=(true|True|1)/.test(healthLine),
    httpConnected: /http=(true|True|1)/.test(healthLine),
  };
}

function parseAutostart(text) {
  return {
    status: text.includes("enabled") ? "enabled" : text.includes("disabled") ? "disabled" : "unknown",
    target: parseKeyedLine(text, "target"),
  };
}

function parseDevices(text) {
  try {
    const payload = JSON.parse(text);
    const data = payload.data || {};
    return Array.isArray(data.devices) ? data.devices : [];
  } catch {
    return [];
  }
}

async function runCli(args, options = {}) {
  if (!isTauri) {
    const result = mockRunCli(args);
    appendLog(`$ cqclaw ${args.join(" ")}\n${result.stdout || ""}${result.stderr || ""}`);
    return result;
  }
  const result = await invoke("run_cqclaw", { args, timeoutSecs: options.timeoutSecs || 30 });
  appendLog(`$ cqclaw ${args.join(" ")}\n${result.stdout || ""}${result.stderr || ""}`);
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error((result.stderr || result.stdout || t("error.exitCode", { code: result.code })).trim());
  }
  return result;
}

function mockRunCli(args) {
  const command = args.join(" ");
  if (command === "status") {
    return {
      code: 0,
      stdout: [
        "CQClaw: running",
        "pid: 79902",
        "url: http://127.0.0.1:8771/log-insight.html",
        "health: pid=True http=False",
        "home: /Users/chujue/Documents/Codex/cqclaq-2.0.12",
        "log: /Users/chujue/Documents/Codex/cqclaq-2.0.12/data/runtime/cqclaw.log",
      ].join("\n"),
      stderr: "",
    };
  }
  if (command === "autostart status") {
    return {
      code: 0,
      stdout: "autostart: disabled\ntarget: /Users/chujue/Library/LaunchAgents/com.cqclaw.app.plist\n",
      stderr: "",
    };
  }
  if (command.startsWith("agent devices")) {
    return {
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        command: "devices",
        data: {
          ok: true,
          count: 1,
          devices: [{ serial: "BEVKNVA6R8DMHEGA", state: "device", model: "PKB110" }],
        },
        errors: [],
      }, null, 2),
      stderr: "",
    };
  }
  return { code: 0, stdout: `${t("mock.preview")}\n`, stderr: "" };
}

async function invoke(command, payload = {}) {
  if (isTauri) {
    return tauriInvoke(command, payload);
  }
  if (command === "client_info") {
    return {
      home: "/Users/chujue/Documents/Codex/cqclaq-2.0.12",
      python: "/usr/bin/python3",
    };
  }
  if (command === "client_autostart_status") {
    return {
      enabled: false,
      target: "/Users/chujue/Library/LaunchAgents/com.cqclaw.client.plist",
      command: "",
    };
  }
  if (command === "client_autostart_set") {
    return {
      enabled: Boolean(payload.enabled),
      target: "/Users/chujue/Library/LaunchAgents/com.cqclaw.client.plist",
      command: "CQClaw --hidden",
    };
  }
  throw new Error(t("error.tauriUnavailable", { command }));
}

function serviceTone() {
  if (!state.service.running) return "stopped";
  if (state.service.running && state.service.httpConnected) return "running";
  return "degraded";
}

function renderService() {
  const tone = serviceTone();
  elements.serviceHero.dataset.state = tone;
  elements.healthPill.dataset.state = tone;

  elements.healthPill.textContent = t(`hero.${tone}.badge`);
  elements.serviceStateLabel.textContent = t(`hero.${tone}.label`);
  elements.serviceTitle.textContent = t(`hero.${tone}.title`);
  elements.serviceSubtitle.textContent = t(`hero.${tone}.subtitle`);
  elements.sideHeadline.textContent = t(`hero.${tone}.sideTitle`);
  elements.sideDescription.textContent = t(`hero.${tone}.sideText`);

  setText(elements.serverStatus, state.service.running ? t("status.running") : t("status.stopped"));
  setText(elements.portStatus, state.service.port ? `:${state.service.port}` : "-");
  setText(elements.connectionStatus, state.service.httpConnected ? t("status.httpOk") : state.service.running ? t("status.offline") : t("status.notConnected"));
  setText(elements.autostartStatus, state.autostart.status === "enabled" ? t("status.enabled") : state.autostart.status === "disabled" ? t("status.disabled") : t("status.unknown"));
  setText(elements.deviceCount, String(state.devices.length));
  setText(elements.homePath, state.service.home);
  setText(elements.serverUrl, state.service.url);
  setText(elements.portDetail, state.service.port ? `${state.service.port} / ${state.service.httpConnected ? t("status.reachable") : t("status.notReachable")}` : "-");
  setText(elements.pidDetail, state.service.pid ? `${state.service.pid} / ${state.service.pidAlive ? t("status.alive") : t("status.unknown")}` : "-");
  setText(elements.pythonPath, state.python);
  setText(elements.autostartTarget, state.autostart.target);
  setText(elements.logPath, state.service.log);
  elements.lastRefresh.textContent = t("last.refreshed", { time: nowLabel() });
  applyButtonState();
}

function renderDevices() {
  elements.deviceList.replaceChildren();
  if (!state.devices.length) {
    elements.deviceSummary.textContent = t("device.none.summary");
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<svg class="ui-icon"><use href="#icon-alert"></use></svg><div><strong></strong><span></span></div>`;
    empty.querySelector("strong").textContent = t("device.none.title");
    empty.querySelector("span").textContent = t("device.none.text");
    elements.deviceList.append(empty);
    return;
  }

  elements.deviceSummary.textContent = t("device.online", { count: state.devices.length });
  state.devices.forEach((device) => {
    const item = document.createElement("article");
    item.className = "device-item";

    const icon = document.createElement("div");
    icon.className = "device-icon";
    icon.innerHTML = `<svg class="ui-icon"><use href="#icon-device"></use></svg>`;

    const body = document.createElement("div");
    body.className = "device-body";

    const title = document.createElement("strong");
    title.textContent = device.model || t("device.fallbackName");
    const serial = document.createElement("code");
    serial.textContent = device.serial || t("device.unknownSerial");

    body.append(title, serial);

    const stateBadge = document.createElement("span");
    stateBadge.className = "device-badge";
    stateBadge.textContent = device.state === "device" ? t("device.state.device") : device.state || t("device.state.device");

    item.append(icon, body, stateBadge);
    elements.deviceList.append(item);
  });
}

function renderActivity() {
  elements.activityList.replaceChildren();
  if (!state.activities.length) {
    const empty = document.createElement("li");
    empty.className = "activity-empty";
    empty.textContent = t("activity.empty");
    elements.activityList.append(empty);
    return;
  }

  state.activities.forEach((activity) => {
    const item = document.createElement("li");
    item.className = "activity-item";
    item.dataset.tone = activity.tone;

    const dot = document.createElement("span");
    dot.className = "activity-dot";

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t(activity.titleKey, activity.params);
    const detail = document.createElement("span");
    detail.textContent = activityDetailText(activity.detail);
    body.append(title, detail);

    const time = document.createElement("time");
    time.textContent = activity.time;

    item.append(dot, body, time);
    elements.activityList.append(item);
  });
}

function serviceOrigin() {
  if (!state.service.url) return "";
  try {
    return new URL(state.service.url).origin;
  } catch {
    return "";
  }
}

function featureUrl(path) {
  const origin = serviceOrigin();
  if (!origin) return "";
  return new URL(path || "/index.html", origin).toString();
}

async function openWebConsole(path = "", activeControl = null) {
  setBusy(true, activeControl);
  appendActivity("activity.commandRunning.title", path ? featureUrl(path) || path : t("action.openWeb"), "neutral");
  if (!state.service.url) {
    await refresh(activeControl);
    setBusy(true, activeControl);
  }
  try {
    const targetUrl = path ? featureUrl(path) : state.service.url;
    if (!targetUrl) {
      appendActivity("activity.openSkipped.title", { key: "activity.openSkipped.detail" }, "warn");
      appendLog(path ? t("log.featureUrlMissing") : t("log.webUrlMissing"));
      return;
    }
    if (!isTauri) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      appendActivity(path ? "activity.openedPath.title" : "activity.opened.title", targetUrl, "ok");
      appendLog(`Opened ${targetUrl}`);
      return;
    }
    const result = await invoke("open_url", { url: targetUrl });
    appendActivity(path ? "activity.openedPath.title" : "activity.opened.title", result.url, "ok");
    appendLog(`Opened ${result.url}`);
  } finally {
    setBusy(false);
    applyButtonState();
  }
}

async function refresh(activeControl = null) {
  setBusy(true, activeControl);
  if (activeControl) appendActivity("activity.commandRunning.title", t("action.refresh"), "neutral");
  try {
    const [status, autostart, clientAutostart, devices, info] = await Promise.all([
      runCli(["status"], { allowFailure: true, timeoutSecs: 8 }),
      runCli(["autostart", "status"], { allowFailure: true, timeoutSecs: 8 }),
      invoke("client_autostart_status").catch((error) => ({ enabled: false, target: "", command: "", error: String(error) })),
      runCli(["agent", "devices", "--online", "--timeout", "5"], { allowFailure: true, timeoutSecs: 14 }),
      invoke("client_info"),
    ]);

    state.service = parseStatus(status.stdout || "");
    state.autostart = parseAutostart(autostart.stdout || "");
    state.clientAutostart = {
      status: clientAutostart.enabled ? "enabled" : clientAutostart.error ? "unknown" : "disabled",
      target: clientAutostart.target || "",
      command: clientAutostart.command || "",
    };
    state.devices = parseDevices(devices.stdout || "");
    state.python = info.python || "";
    if (!state.service.home) state.service.home = info.home || "";

    renderService();
    renderDevices();
    appendActivity(
      "activity.refreshed.title",
      { key: "activity.refreshed.detail", params: { count: state.devices.length, tone: { key: `tone.${serviceTone()}` } } },
      serviceTone() === "running" ? "ok" : serviceTone() === "degraded" ? "warn" : "neutral",
    );
  } catch (error) {
    appendLog(String(error));
    elements.healthPill.textContent = t("hero.error.badge");
    elements.healthPill.dataset.state = "error";
    elements.serviceHero.dataset.state = "error";
    elements.serviceStateLabel.textContent = t("hero.error.label");
    elements.serviceTitle.textContent = t("hero.error.title");
    elements.serviceSubtitle.textContent = String(error);
    appendActivity("activity.refreshFailed.title", String(error), "error");
  } finally {
    setBusy(false);
    applyButtonState();
  }
}

async function runAndRefresh(args, options = {}) {
  const command = `cqclaw ${args.join(" ")}`;
  setBusy(true, options.activeControl || null);
  appendActivity("activity.commandRunning.title", command, "neutral");
  appendLog(`Running ${command}`);
  try {
    await runCli(args, options);
    appendActivity("activity.commandDone.title", command, "ok");
  } catch (error) {
    appendActivity("activity.commandFailed.title", `${command}: ${String(error)}`, "error");
    appendLog(String(error));
  } finally {
    setBusy(false);
    await refresh();
  }
}

async function setClientAutostart(enabled) {
  setBusy(true, elements.clientAutostartToggle);
  appendActivity("activity.commandRunning.title", enabled ? t("action.enableAutostart") : t("action.disableAutostart"), "neutral");
  try {
    const result = await invoke("client_autostart_set", { enabled });
    state.clientAutostart = {
      status: result.enabled ? "enabled" : "disabled",
      target: result.target || "",
      command: result.command || "",
    };
    appendActivity("activity.commandDone.title", enabled ? t("log.clientAutostartEnabled") : t("log.clientAutostartDisabled"), "ok");
    appendLog(enabled ? t("log.clientAutostartEnabled") : t("log.clientAutostartDisabled"));
  } catch (error) {
    appendActivity("activity.commandFailed.title", String(error), "error");
    appendLog(String(error));
  } finally {
    setBusy(false);
    await refresh();
  }
}

elements.refreshBtn.addEventListener("click", () => refresh(elements.refreshBtn));
elements.startBtn.addEventListener("click", () => runAndRefresh(["start", "--no-open"], { timeoutSecs: 20, activeControl: elements.startBtn }));
elements.stopBtn.addEventListener("click", () => runAndRefresh(["stop"], { timeoutSecs: 20, activeControl: elements.stopBtn }));
elements.openBtn.addEventListener("click", () => openWebConsole(elements.openBtn.dataset.openPath || "", elements.openBtn).catch((error) => appendActivity("activity.openFailed.title", String(error), "error")));
elements.launchButtons.forEach((button) => {
  if (button.id === "openBtn") return;
  button.addEventListener("click", () => openWebConsole(button.dataset.openPath || "", button).catch((error) => appendActivity("activity.openFailed.title", String(error), "error")));
});
elements.autostartToggle.addEventListener("change", () => {
  const args = elements.autostartToggle.checked ? ["autostart", "enable", "--no-open"] : ["autostart", "disable"];
  runAndRefresh(args, { timeoutSecs: 20, activeControl: elements.autostartToggle });
});
elements.clientAutostartToggle.addEventListener("change", () => {
  setClientAutostart(elements.clientAutostartToggle.checked);
});
elements.clearLogBtn.addEventListener("click", () => {
  elements.outputLog.textContent = "";
  state.activities = [];
  renderActivity();
});
elements.langZhBtn.addEventListener("click", () => setLanguage("zh"));
elements.langEnBtn.addEventListener("click", () => setLanguage("en"));
elements.themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeMode));
});

applyTheme(state.theme);
setLanguage(state.language);
refresh();
