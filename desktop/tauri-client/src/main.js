const tauriInvoke = window.__TAURI__?.core?.invoke;
const isTauri = typeof tauriInvoke === "function";

const elements = {
  healthPill: document.getElementById("healthPill"),
  serverStatus: document.getElementById("serverStatus"),
  autostartStatus: document.getElementById("autostartStatus"),
  deviceCount: document.getElementById("deviceCount"),
  homePath: document.getElementById("homePath"),
  serverUrl: document.getElementById("serverUrl"),
  pythonPath: document.getElementById("pythonPath"),
  outputLog: document.getElementById("outputLog"),
  buttons: [...document.querySelectorAll("button")],
};

function appendLog(text) {
  if (!text) return;
  const next = `${elements.outputLog.textContent}${text.trimEnd()}\n`;
  elements.outputLog.textContent = next.slice(Math.max(0, next.length - 12000));
  elements.outputLog.scrollTop = elements.outputLog.scrollHeight;
}

function setBusy(value) {
  elements.buttons.forEach((button) => {
    if (button.id !== "clearLogBtn") button.disabled = value;
  });
  elements.healthPill.textContent = value ? "Running" : "Ready";
  elements.healthPill.classList.toggle("is-warn", value);
}

function parseStatus(text) {
  const running = text.includes("CQClaw: running");
  const urlLine = text.split("\n").find((line) => line.startsWith("url:"));
  return {
    running,
    url: urlLine ? urlLine.split(":").slice(1).join(":").trim() : "",
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
        "health: pid=true http=true",
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
    elements.serverStatus.textContent = parsedStatus.running ? "running" : "stopped";
    elements.serverUrl.textContent = parsedStatus.url || "-";
    elements.autostartStatus.textContent = parseAutostart(autostart.stdout || "");
    elements.deviceCount.textContent = parsedDevices.label;
    elements.homePath.textContent = info.home;
    elements.pythonPath.textContent = info.python;
    elements.healthPill.textContent = parsedStatus.running ? "Running" : "Stopped";
    elements.healthPill.classList.toggle("is-ok", parsedStatus.running);
    elements.healthPill.classList.toggle("is-warn", !parsedStatus.running);
  } catch (error) {
    appendLog(String(error));
    elements.healthPill.textContent = "Error";
    elements.healthPill.classList.remove("is-ok");
    elements.healthPill.classList.add("is-warn");
  } finally {
    setBusy(false);
  }
}

async function runAndRefresh(args, options = {}) {
  setBusy(true);
  try {
    await runCli(args, options);
  } catch (error) {
    appendLog(String(error));
  } finally {
    setBusy(false);
    await refresh();
  }
}

document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("startBtn").addEventListener("click", () => runAndRefresh(["start", "--no-open"], { timeoutSecs: 20 }));
document.getElementById("stopBtn").addEventListener("click", () => runAndRefresh(["stop"], { timeoutSecs: 20 }));
document.getElementById("openBtn").addEventListener("click", () => runCli(["open"], { timeoutSecs: 10 }).catch((error) => appendLog(String(error))));
document.getElementById("enableAutostartBtn").addEventListener("click", () => runAndRefresh(["autostart", "enable", "--no-open"], { timeoutSecs: 20 }));
document.getElementById("disableAutostartBtn").addEventListener("click", () => runAndRefresh(["autostart", "disable"], { timeoutSecs: 20 }));
document.getElementById("clearLogBtn").addEventListener("click", () => {
  elements.outputLog.textContent = "";
});

refresh();
