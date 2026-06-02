const tauriInvoke = window.__TAURI__?.core?.invoke;
const isTauri = typeof tauriInvoke === "function";

const elements = {
  healthPill: document.getElementById("healthPill"),
  serverStatus: document.getElementById("serverStatus"),
  portStatus: document.getElementById("portStatus"),
  connectionStatus: document.getElementById("connectionStatus"),
  autostartStatus: document.getElementById("autostartStatus"),
  deviceCount: document.getElementById("deviceCount"),
  homePath: document.getElementById("homePath"),
  serverUrl: document.getElementById("serverUrl"),
  portDetail: document.getElementById("portDetail"),
  pythonPath: document.getElementById("pythonPath"),
  outputLog: document.getElementById("outputLog"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  openBtn: document.getElementById("openBtn"),
  autostartBtn: document.getElementById("autostartBtn"),
  autostartButtonText: document.getElementById("autostartButtonText"),
  buttons: [...document.querySelectorAll("button")],
};

const state = {
  running: false,
  httpConnected: false,
  pidAlive: false,
  port: "",
  autostart: "unknown",
  url: "",
  busy: false,
};

function appendLog(text) {
  if (!text) return;
  const next = `${elements.outputLog.textContent}${text.trimEnd()}\n`;
  elements.outputLog.textContent = next.slice(Math.max(0, next.length - 12000));
  elements.outputLog.scrollTop = elements.outputLog.scrollHeight;
}

function applyButtonState() {
  if (state.busy) {
    elements.buttons.forEach((button) => {
      if (button.id !== "clearLogBtn") button.disabled = true;
    });
    return;
  }
  elements.buttons.forEach((button) => {
    button.disabled = false;
  });
  elements.startBtn.disabled = state.running;
  elements.stopBtn.disabled = !state.running;
  elements.openBtn.disabled = !state.url;
  elements.autostartButtonText.textContent = state.autostart === "enabled" ? "Disable Autostart" : "Enable Autostart";
}

function setBusy(value) {
  state.busy = value;
  elements.buttons.forEach((button) => {
    if (button.id !== "clearLogBtn") button.disabled = value;
  });
  if (value) {
    elements.healthPill.textContent = "Working";
    elements.healthPill.classList.add("is-warn");
  }
  applyButtonState();
}

function parseStatus(text) {
  const running = text.includes("CQClaw: running");
  const urlLine = text.split("\n").find((line) => line.startsWith("url:"));
  const healthLine = text.split("\n").find((line) => line.startsWith("health:")) || "";
  const pidAlive = /pid=(true|True|1)/.test(healthLine);
  const httpConnected = /http=(true|True|1)/.test(healthLine);
  const url = urlLine ? urlLine.split(":").slice(1).join(":").trim() : "";
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
    pidAlive,
    httpConnected,
  };
}

function parseAutostart(text) {
  if (text.includes("enabled")) return "enabled";
  if (text.includes("disabled")) return "disabled";
  return "unknown";
}

function parseDevices(text) {
  try {
    const payload = JSON.parse(text);
    const data = payload.data || {};
    const devices = data.devices || [];
    const count = Number(data.count || devices.length || 0);
    return {
      count,
      label: count ? `${count}: ${devices.map((device) => device.serial).filter(Boolean).join(", ")}` : "0",
    };
  } catch {
    return { count: 0, label: "unknown" };
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
    throw new Error((result.stderr || result.stdout || `Exit code ${result.code}`).trim());
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
      ].join("\n"),
      stderr: "",
    };
  }
  if (command === "autostart status") {
    return { code: 0, stdout: "autostart: disabled\n", stderr: "" };
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
  return { code: 0, stdout: "preview mode\n", stderr: "" };
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
  throw new Error(`Tauri command is unavailable in browser preview: ${command}`);
}

async function openWebConsole() {
  if (!state.url) {
    await refresh();
  }
  if (!state.url) {
    appendLog("Web console URL is not available. Start CQClaw first.");
    return;
  }
  if (!isTauri) {
    window.open(state.url, "_blank", "noopener,noreferrer");
    appendLog(`Opened ${state.url}`);
    return;
  }
  const result = await invoke("open_url", { url: state.url });
  appendLog(`Opened ${result.url}`);
}

async function refresh() {
  setBusy(true);
  try {
    const [status, autostart, devices, info] = await Promise.all([
      runCli(["status"], { allowFailure: true, timeoutSecs: 8 }),
      runCli(["autostart", "status"], { allowFailure: true, timeoutSecs: 8 }),
      runCli(["agent", "devices", "--online", "--timeout", "5"], { allowFailure: true, timeoutSecs: 14 }),
      invoke("client_info"),
    ]);

    const parsedStatus = parseStatus(status.stdout || "");
    const parsedDevices = parseDevices(devices.stdout || "");
    state.running = parsedStatus.running;
    state.url = parsedStatus.url || "";
    state.port = parsedStatus.port || "";
    state.pidAlive = parsedStatus.pidAlive;
    state.httpConnected = parsedStatus.httpConnected;
    state.autostart = parseAutostart(autostart.stdout || "");
    elements.serverStatus.textContent = state.running ? "Running" : "Stopped";
    elements.portStatus.textContent = state.port ? `:${state.port}` : "-";
    elements.connectionStatus.textContent = state.httpConnected ? "HTTP OK" : state.running ? "HTTP Offline" : "Not connected";
    elements.serverUrl.textContent = state.url || "-";
    elements.portDetail.textContent = state.port ? `${state.port} (${state.httpConnected ? "reachable" : "not reachable"})` : "-";
    elements.autostartStatus.textContent = state.autostart === "enabled" ? "Enabled" : state.autostart === "disabled" ? "Disabled" : "Unknown";
    elements.deviceCount.textContent = parsedDevices.label;
    elements.homePath.textContent = info.home;
    elements.pythonPath.textContent = info.python;
    elements.healthPill.textContent = state.running ? "Ready" : "Stopped";
    elements.healthPill.classList.toggle("is-ok", state.running);
    elements.healthPill.classList.toggle("is-warn", !state.running);
  } catch (error) {
    appendLog(String(error));
    elements.healthPill.textContent = "Error";
    elements.healthPill.classList.remove("is-ok");
    elements.healthPill.classList.add("is-warn");
  } finally {
    setBusy(false);
    applyButtonState();
  }
}

async function runAndRefresh(args, options = {}) {
  setBusy(true);
  let failed = false;
  let message = "";
  try {
    await runCli(args, options);
  } catch (error) {
    failed = true;
    message = String(error);
    appendLog(message);
  } finally {
    setBusy(false);
    await refresh();
    if (failed && args[0] === "autostart") {
      elements.autostartStatus.textContent = "Failed";
      elements.healthPill.textContent = "Autostart failed";
      elements.healthPill.classList.remove("is-ok");
      elements.healthPill.classList.add("is-warn");
      appendLog(`Autostart did not change. ${message}`);
    }
  }
}

document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("startBtn").addEventListener("click", () => runAndRefresh(["start", "--no-open"], { timeoutSecs: 20 }));
document.getElementById("stopBtn").addEventListener("click", () => runAndRefresh(["stop"], { timeoutSecs: 20 }));
document.getElementById("openBtn").addEventListener("click", () => openWebConsole().catch((error) => appendLog(String(error))));
document.getElementById("autostartBtn").addEventListener("click", () => {
  const args = state.autostart === "enabled" ? ["autostart", "disable"] : ["autostart", "enable", "--no-open"];
  runAndRefresh(args, { timeoutSecs: 20 });
});
document.getElementById("clearLogBtn").addEventListener("click", () => {
  elements.outputLog.textContent = "";
});

refresh();
