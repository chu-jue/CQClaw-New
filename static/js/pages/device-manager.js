(function () {
  const $ = window.$ || ((id) => document.getElementById(id));

  const state = {
    devices: [],
    activeSerial: "",
    settings: {},
    agent: {},
    details: null,
    topActivity: null,
    screenshot: null,
    resultItems: [],
    remoteEntries: [],
    remoteSelectedEntry: null,
    remoteSelectedPath: "",
    sync: {
      running: false,
      serial: "",
      direction: "both",
      timer: null,
      busy: false,
      lastPhoneText: "",
      lastComputerText: "",
      pendingPhoneText: "",
      focusWarningShown: false,
      ticks: 0
    }
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function attr(value) {
    return escapeHtml(value);
  }

  function nowText() {
    return new Date().toLocaleTimeString();
  }

  function hashText(value) {
    const text = String(value || "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `${text.length}:${hash}`;
  }

  function comparableClipboardText(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n+$/g, "");
  }

  function clipboardSignature(value) {
    return hashText(comparableClipboardText(value));
  }

  function isNewClipboardText(text, ...knownTexts) {
    if (!text) return false;
    const signature = clipboardSignature(text);
    return knownTexts.every((known) => clipboardSignature(known) !== signature);
  }

  function currentSyncDirection() {
    const checked = document.querySelector('input[name="clipboardSyncMode"]:checked');
    return checked?.value || "both";
  }

  function canSyncPhoneToComputer(direction = state.sync.direction) {
    return direction === "both" || direction === "phone_to_computer";
  }

  function canSyncComputerToPhone(direction = state.sync.direction) {
    return direction === "both" || direction === "computer_to_phone";
  }

  function syncDirectionLabel(direction = state.sync.direction) {
    if (direction === "computer_to_phone") return "电脑 → 手机";
    if (direction === "phone_to_computer") return "手机 → 电脑";
    return "双向";
  }

  function renderSyncModeVisual(direction = currentSyncDirection()) {
    const flow = $("clipboardFlow");
    if (!flow) return;
    flow.className = `clip-flow-visual mode-${direction}`;
  }

  function deviceLabel(deviceOrSerial) {
    const device = typeof deviceOrSerial === "string"
      ? state.devices.find((item) => item.serial === deviceOrSerial)
      : deviceOrSerial;
    if (!device) return String(deviceOrSerial || "未选择设备");
    return device.alias || device.model || device.product || device.serial;
  }

  function activeDevice() {
    return state.devices.find((device) => device.serial === state.activeSerial) || null;
  }

  function requireDevice() {
    if (!state.activeSerial) throw new Error("请先选择一台在线设备");
    return state.activeSerial;
  }

  async function postJson(url, payload) {
    return window.api(url, { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function deviceApi(url, payload = {}) {
    return postJson(url, { serial: requireDevice(), ...payload });
  }

  async function desktopClipboardRead() {
    const data = await postJson("/api/desktop/clipboard", { operation: "read", timeout: 5 });
    if (!data.ok) throw new Error(data.stderr || data.error || "读取电脑剪切板失败");
    return data.text || "";
  }

  async function desktopClipboardWrite(text) {
    const data = await postJson("/api/desktop/clipboard", { operation: "write", text: text || "", timeout: 5 });
    if (!data.ok) throw new Error(data.stderr || data.error || "写入电脑剪切板失败");
    return data;
  }

  function resultText(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    const result = data.result || data.pullResult || {};
    return [
      data.stdout,
      data.stderr,
      data.error,
      data.raw,
      result.commandText,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n").trim();
  }

  function addResult(title, status, body = "", extraHtml = "") {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      status,
      body,
      extraHtml,
      time: nowText()
    };
    state.resultItems.unshift(item);
    state.resultItems = state.resultItems.slice(0, 80);
    renderResults();
    const readable = status === "success" ? "成功" : status === "failed" ? "失败" : "进行中";
    $("resultMeta").textContent = `${title} · ${readable}`;
    setActionFeedback(title, status, body ? String(body).split("\n")[0].slice(0, 72) : "可在下方执行结果查看详情");
  }

  function renderResults() {
    const box = $("resultTimeline");
    if (!box) return;
    if (!state.resultItems.length) {
      box.innerHTML = `<div class="result-item"><div class="result-body">还没有执行结果。</div></div>`;
      return;
    }
    box.innerHTML = state.resultItems.map((item) => `
      <article class="result-item ${attr(item.status)}">
        <div class="result-headline">
          <span>${escapeHtml(item.title)}</span>
          <span class="device-muted">${escapeHtml(item.time)}</span>
        </div>
        ${item.body ? `<pre>${escapeHtml(item.body)}</pre>` : ""}
        ${item.extraHtml || ""}
      </article>
    `).join("");
    bindResultButtons();
  }

  function setBusy(buttonId, busy, label) {
    const btn = $(buttonId);
    if (!btn) return () => {};
    const oldHtml = btn.innerHTML;
    btn.disabled = busy;
    btn.classList.toggle("is-busy", Boolean(busy));
    if (busy && label) {
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
      setActionFeedback(label, "running", "正在执行，请稍候…");
    }
    return () => {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.innerHTML = oldHtml;
    };
  }

  function setActionFeedback(title, status = "idle", detail = "") {
    const text = $("actionFeedbackText");
    const dot = document.querySelector(".action-feedback-card .feedback-dot");
    const card = document.querySelector(".action-feedback-card");
    if (!text || !card) return;
    const statusLabel = status === "success" ? "已完成" : status === "failed" ? "失败" : status === "running" ? "执行中" : "等待操作";
    text.textContent = `${statusLabel} · ${title}${detail ? `：${detail}` : ""}`;
    card.classList.remove("is-success", "is-failed", "is-running", "is-idle");
    card.classList.add(`is-${status || "idle"}`);
    if (dot) {
      dot.className = `feedback-dot ${status || "idle"}`;
    }
  }

  function badge(id, text, kind = "muted") {
    const node = $(id);
    if (!node) return;
    node.textContent = text;
    const classMap = { ok: "badge-success", warn: "badge-warning", fail: "badge-danger", muted: "badge-muted" };
    node.className = `badge ${classMap[kind] || "badge-muted"}`;
  }

  function renderDevices() {
    const keyword = ($("deviceSearchInput")?.value || "").trim().toLowerCase();
    const list = $("deviceList");
    const devices = state.devices.filter((device) => {
      const haystack = [device.serial, device.alias, device.model, device.product, device.groups, device.state].join(" ").toLowerCase();
      return !keyword || haystack.includes(keyword);
    });
    const onlineCount = state.devices.filter((device) => device.state === "device").length;
    $("deviceCountMeta").textContent = `${state.devices.length} 台 · 在线 ${onlineCount} 台`;
    if (!devices.length) {
      list.innerHTML = `<div class="device-card-pro"><div class="device-muted">没有匹配设备</div></div>`;
      return;
    }
    list.innerHTML = devices.map((device) => {
      const active = device.serial === state.activeSerial;
      const syncActive = state.sync.running && state.sync.serial === device.serial;
      return `
        <div class="device-card-pro ${active ? "active" : ""}" role="button" tabindex="0" data-device="${attr(device.serial)}">
          <div class="device-card-top">
            <div class="device-name-line">
              <span class="badge ${device.state === "device" ? "ok" : "warn"}">${escapeHtml(device.state || "unknown")}</span>
              <span>${escapeHtml(deviceLabel(device))}</span>
            </div>
            <button class="device-sync-mini ${syncActive ? "active" : ""}" type="button" data-device-sync="${attr(device.serial)}" title="${syncActive ? "停止剪切板同步" : "开启这台设备的剪切板同步"}"><span class="sync-dot"></span>${syncActive ? "同步中" : "剪切板同步"}</button>
          </div>
          <div class="device-serial-line">${escapeHtml(device.serial)}</div>
          <div class="device-model-line">${escapeHtml([device.product, device.model, device.transport ? `transport ${device.transport}` : ""].filter(Boolean).join(" / ") || "-")}</div>
        </div>
      `;
    }).join("");
    document.querySelectorAll("[data-device]").forEach((button) => {
      button.addEventListener("click", () => selectDevice(button.dataset.device || ""));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectDevice(button.dataset.device || "");
        }
      });
    });
    document.querySelectorAll("[data-device-sync]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const serial = button.dataset.deviceSync || "";
        if (state.activeSerial !== serial) {
          state.activeSerial = serial;
          renderActiveSummary();
          await refreshActiveDevice();
        }
        await toggleClipboardSync();
      });
    });
  }

  function renderActiveSummary() {
    const device = activeDevice();
    const name = device ? deviceLabel(device) : "请选择设备";
    $("activeDeviceName").textContent = name;
    $("deviceAvatar").textContent = (name || "D").slice(0, 1).toUpperCase();
    $("activeDeviceMeta").textContent = device
      ? `${device.serial}${device.model ? ` · ${device.model}` : ""}${device.product ? ` · ${device.product}` : ""}`
      : "连接设备后可查看详情和执行操作。";
    badge("adbStatusBadge", device?.state === "device" ? "ADB 在线" : "ADB 未选择", device?.state === "device" ? "ok" : "muted");
    const agent = state.agent[state.activeSerial] || {};
    const serverRunning = agent.clipboardServer?.running || (state.sync.running && state.sync.serial === state.activeSerial);
    const agentText = serverRunning ? "剪切板同步服务中" : agent.installed ? "手机端能力已就绪" : agent.apkConfigured ? "手机端能力可安装" : "手机端能力未配置";
    badge("agentStatusBadge", agentText, serverRunning || agent.installed ? "ok" : agent.apkConfigured ? "warn" : "muted");
    const runningSyncHere = state.sync.running && state.sync.serial === state.activeSerial;
    badge("syncStatusBadge", runningSyncHere ? `同步中 · ${syncDirectionLabel()}` : "剪切板未同步", runningSyncHere ? "ok" : "muted");
    const syncBtn = $("toggleClipboardSyncBtn");
    if (syncBtn) {
      const runningHere = runningSyncHere;
      syncBtn.innerHTML = `<svg class="ui-icon"><use href="/assets/icons/cqclaw-ui-icons.svg#refresh"></use></svg>${runningHere ? "停止同步" : "开启同步"}`;
      syncBtn.classList.toggle("is-running", runningHere);
    }
    renderSyncModeVisual();
    renderDevices();
  }

  function infoTile(label, value) {
    return `<div class="info-tile"><span>${escapeHtml(label)}</span><strong title="${attr(value || "-")}">${escapeHtml(value || "-")}</strong></div>`;
  }

  function renderTopActivityInline() {
    const panel = $("topActivityInline");
    const body = $("topActivityInlineBody");
    if (!panel || !body) return;
    const top = state.topActivity || {};
    const pkg = top.package || "";
    const act = top.activity || top.component || "";
    if (!pkg && !act) {
      panel.hidden = true;
      body.innerHTML = "";
      return;
    }
    panel.hidden = false;
    body.innerHTML = `
      <div class="top-activity-field">
        <span>包名</span>
        <strong title="${attr(pkg || "-")}">${escapeHtml(pkg || "-")}</strong>
      </div>
      <div class="top-activity-field">
        <span>Activity</span>
        <strong title="${attr(act || "-")}">${escapeHtml(act || "-")}</strong>
      </div>
    `;
  }

  function renderDeviceInfo() {
    const grid = $("deviceInfoGrid");
    const details = state.details || {};
    const props = details.props || {};
    const battery = details.battery || {};
    const screen = details.screen || {};
    const storage = details.storage || {};
    const top = state.topActivity || {};
    const agent = state.agent[state.activeSerial] || {};
    grid.innerHTML = [
      infoTile("Android", props["ro.build.version.release"] ? `${props["ro.build.version.release"]} / SDK ${props["ro.build.version.sdk"] || "-"}` : ""),
      infoTile("型号", props["ro.product.model"] || activeDevice()?.model),
      infoTile("屏幕", [screen.size, screen.density ? `${screen.density} dpi` : ""].filter(Boolean).join(" / ")),
      infoTile("电量", battery.level ? `${battery.level}%` : ""),
      infoTile("顶部包名", top.package || ""),
      infoTile("顶部 Activity", top.activity || top.component || ""),
      infoTile("WLAN IP", details.network?.wlan0 || ""),
      infoTile("存储", storage.size ? `${storage.used || "-"} / ${storage.size} (${storage.use || storage["use%"] || "-"})` : storage.raw),
      infoTile("手机端能力", agent.installed ? "已就绪" : agent.apkConfigured ? "可安装" : "未配置"),
      infoTile("剪切板服务", agent.clipboardServer?.running ? `运行中 :${agent.clipboardServer?.session?.port || "-"}` : agent.serverJarConfigured ? "已配置" : "未配置"),
      infoTile("输入法", "按需切换，支持自动恢复")
    ].join("");
    renderTopActivityInline();
  }

  async function selectDevice(serial) {
    state.activeSerial = serial;
    renderActiveSummary();
    clearScreenshot();
    if (!serial) return;
    await refreshActiveDevice();
  }

  async function loadDevices(forceProcess = false) {
    const restore = setBusy("refreshDevicesBtn", true, "刷新中");
    try {
      const data = await window.api(`/api/devices?includeProcessPackages=1&refreshProcessPackages=${forceProcess ? "1" : "0"}`);
      state.devices = data.devices || [];
      const firstOnline = state.devices.find((device) => device.state === "device");
      if (!state.activeSerial || !state.devices.some((device) => device.serial === state.activeSerial)) {
        state.activeSerial = firstOnline?.serial || state.devices[0]?.serial || "";
      }
      renderDevices();
      renderActiveSummary();
      if (state.activeSerial) await refreshActiveDevice();
    } catch (error) {
      addResult("刷新设备", "failed", error.message);
    } finally {
      restore();
    }
  }

  async function loadSettings() {
    try {
      const data = await window.api("/api/settings");
      state.settings = data.settings || {};
    } catch (error) {
      addResult("读取设置", "failed", error.message);
    }
  }

  async function refreshAgentStatus() {
    if (!state.activeSerial) return;
    try {
      const data = await deviceApi("/api/device/agent-status");
      state.agent[state.activeSerial] = data;
      renderActiveSummary();
    } catch (error) {
      state.agent[state.activeSerial] = { installed: false, apkConfigured: false, error: error.message };
      renderActiveSummary();
    }
  }

  async function refreshActiveDevice() {
    if (!state.activeSerial) return;
    $("deviceInfoMeta").textContent = "读取中...";
    try {
      const [details, top] = await Promise.allSettled([
        deviceApi("/api/device/details"),
        deviceApi("/api/device/top-activity"),
        refreshAgentStatus()
      ]);
      if (details.status === "fulfilled") state.details = details.value;
      if (top.status === "fulfilled") state.topActivity = top.value;
      renderDeviceInfo();
      $("deviceInfoMeta").textContent = "详情已更新";
    } catch (error) {
      addResult("刷新详情", "failed", error.message);
    }
  }

  function clearScreenshot() {
    state.screenshot = null;
    const frame = document.querySelector(".phone-frame");
    const img = $("screenshotImage");
    if (frame) frame.classList.remove("has-image");
    if (img) img.removeAttribute("src");
    $("screenshotPath").textContent = "点击截图后显示当前屏幕";
  }

  async function captureScreenshot() {
    const restore = setBusy("captureScreenshotBtn", true, "截图中");
    try {
      const data = await deviceApi("/api/device/screenshot");
      if (!data.ok) throw new Error(data.stderr || data.error || "截图失败");
      state.screenshot = data;
      $("screenshotImage").src = data.imageData || "";
      document.querySelector(".phone-frame")?.classList.add("has-image");
      $("screenshotPath").textContent = data.path || "截图完成";
      addResult("截图", "success", data.path || "", `<button class="btn btn-secondary" data-copy="${attr(data.path || "")}" type="button">复制路径</button>`);
    } catch (error) {
      addResult("截图", "failed", error.message);
    } finally {
      restore();
    }
  }

  async function showTopActivity() {
    try {
      const data = await deviceApi("/api/device/top-activity");
      state.topActivity = data;
      renderDeviceInfo();
      addResult("顶部 Activity", data.ok ? "success" : "failed", [
        `Package: ${data.package || "-"}`,
        `Activity: ${data.activity || "-"}`,
        `Component: ${data.component || "-"}`,
        "",
        data.raw || data.error || data.stderr || ""
      ].join("\n"));
    } catch (error) {
      addResult("顶部 Activity", "failed", error.message);
    }
  }

  async function showDeviceDetails() {
    try {
      const data = await deviceApi("/api/device/details");
      state.details = data;
      renderDeviceInfo();
      addResult("设备详情", data.ok ? "success" : "failed", JSON.stringify({
        props: data.props,
        screen: data.screen,
        battery: data.battery,
        network: data.network,
        storage: data.storage
      }, null, 2));
    } catch (error) {
      addResult("设备详情", "failed", error.message);
    }
  }

  async function runShell(command) {
    const value = (command || $("shellCommandInput").value || "").trim();
    if (!value) {
      addResult("Shell", "failed", "请输入 Shell 命令");
      return;
    }
    const restore = setBusy("runShellBtn", true, "执行中");
    try {
      const data = await deviceApi("/api/device/shell", { command: value });
      addResult(`Shell: ${value}`, data.ok ? "success" : "failed", resultText(data) || JSON.stringify(data.result || {}, null, 2));
    } catch (error) {
      addResult("Shell", "failed", error.message);
    } finally {
      restore();
    }
  }

  async function readClipboard(manageIme = true) {
    try {
      const data = await deviceApi("/api/device/clipboard", { operation: "read", manageIme });
      if (!data.ok) throw new Error(data.stderr || data.error || "读取失败");
      const text = data.text || "";
      state.sync.lastPhoneText = text;
      $("phoneClipboardText").value = text;
      $("clipboardMeta").textContent = `手机剪切板 ${text.length} 个字符`;
      addResult("读取手机剪切板", "success", text || "剪切板为空");
      return text;
    } catch (error) {
      addResult("读取手机剪切板", "failed", error.message);
      return "";
    }
  }

  async function writeClipboard(paste = false, manageIme = true) {
    const text = $("writeClipboardText").value;
    try {
      const data = await deviceApi("/api/device/clipboard", { operation: "write", text, manageIme });
      if (!data.ok) throw new Error(data.stderr || data.error || "写入失败");
      state.sync.lastPhoneText = text;
      $("phoneClipboardText").value = text;
      if (paste) await runShell("input keyevent 279");
      addResult(paste ? "写入并粘贴" : "写入手机剪切板", "success", `已写入 ${text.length} 个字符`);
    } catch (error) {
      addResult(paste ? "写入并粘贴" : "写入手机剪切板", "failed", error.message);
    }
  }

  async function copyPhoneClipboardToComputer() {
    const text = $("phoneClipboardText").value || state.sync.lastPhoneText || "";
    try {
      await desktopClipboardWrite(text);
      state.sync.lastComputerText = text;
      addResult("复制到电脑", "success", `已复制 ${text.length} 个字符`);
    } catch (error) {
      addResult("复制到电脑", "failed", error.message || "电脑剪切板写入失败");
    }
  }

  async function clipboardSyncTick() {
    if (!state.sync.running || state.sync.busy || !state.sync.serial) return;
    state.sync.busy = true;
    try {
      const direction = currentSyncDirection();
      state.sync.direction = direction;
      if (canSyncPhoneToComputer(direction)) {
        const phoneData = await postJson("/api/device/clipboard", {
          serial: state.sync.serial,
          operation: "read",
          manageIme: false,
          timeout: 10
        });
        if (phoneData.ok) {
          const phoneText = phoneData.text || "";
          if (isNewClipboardText(phoneText, state.sync.lastPhoneText, state.sync.lastComputerText)) {
            state.sync.lastPhoneText = phoneText;
            if (state.activeSerial === state.sync.serial) $("phoneClipboardText").value = phoneText;
            await desktopClipboardWrite(phoneText);
            state.sync.lastComputerText = phoneText;
            state.sync.pendingPhoneText = "";
            state.sync.focusWarningShown = false;
            addResult("剪切板同步", "success", `手机到电脑：${phoneText.length} 个字符`);
          }
        }
      }

      if (canSyncComputerToPhone(direction)) {
        const computerText = await desktopClipboardRead();
        if (isNewClipboardText(computerText, state.sync.lastComputerText, state.sync.lastPhoneText)) {
          const writeData = await postJson("/api/device/clipboard", {
            serial: state.sync.serial,
            operation: "write",
            text: computerText,
            manageIme: false,
            timeout: 10
          });
          if (!writeData.ok) throw new Error(writeData.stderr || writeData.error || "写入手机剪切板失败");
          state.sync.lastComputerText = computerText;
          state.sync.lastPhoneText = computerText;
          if (state.activeSerial === state.sync.serial) $("phoneClipboardText").value = computerText;
          addResult("剪切板同步", "success", `电脑到手机：${computerText.length} 个字符`);
        }
      }
      state.sync.ticks += 1;
      $("clipboardMeta").textContent = `同步中 · ${syncDirectionLabel(direction)} · ${state.sync.ticks} 次检查`;
    } catch (error) {
      stopClipboardSync(false);
      addResult("剪切板同步停止", "failed", error.message || "同步失败");
    } finally {
      state.sync.busy = false;
      renderActiveSummary();
    }
  }

  async function startClipboardSync() {
    const serial = requireDevice();
    await stopClipboardSync(false);
    const server = await deviceApi("/api/device/clipboard-server", { action: "start", timeout: 8 });
    if (!server.ok) {
      addResult("启动 Jar 剪切板服务", "failed", server.stderr || server.error || "启动失败");
      state.agent[serial] = { ...(state.agent[serial] || {}), clipboardServer: server };
      renderActiveSummary();
      return;
    }
    state.agent[serial] = { ...(state.agent[serial] || {}), clipboardServer: { running: true, ...(server || {}) } };
    try {
      state.sync.lastComputerText = await desktopClipboardRead();
    } catch (error) {
      state.sync.lastComputerText = "";
      addResult("启动剪切板同步", "running", `手机端服务已启动，但暂时不能读取电脑剪切板：${error.message}`);
    }
    state.sync.running = true;
    state.sync.serial = serial;
    state.sync.direction = currentSyncDirection();
    state.sync.lastPhoneText = $("phoneClipboardText").value || "";
    state.sync.pendingPhoneText = "";
    state.sync.ticks = 0;
    renderActiveSummary();
    addResult("剪切板同步", "running", `Jar 服务已启动，正在${syncDirectionLabel()}同步。\n端口: ${server.session?.port || "-"}\nSocket: ${server.session?.socketName || "-"}`);
    await clipboardSyncTick();
    state.sync.timer = setInterval(clipboardSyncTick, 1500);
  }

  async function stopClipboardSync(showResult = true) {
    const serial = state.sync.serial || state.activeSerial;
    if (state.sync.timer) clearInterval(state.sync.timer);
    state.sync.timer = null;
    state.sync.running = false;
    state.sync.serial = "";
    state.sync.busy = false;
    if (serial) {
      try {
        await postJson("/api/device/clipboard-server", { serial, action: "stop" });
        state.agent[serial] = { ...(state.agent[serial] || {}), clipboardServer: { running: false } };
      } catch (error) {
        if (showResult) addResult("停止剪切板服务", "failed", error.message || "停止失败");
      }
    }
    renderActiveSummary();
    if (showResult) addResult("剪切板同步", "success", "已停止同步。");
  }

  async function toggleClipboardSync() {
    if (state.sync.running && state.sync.serial === state.activeSerial) {
      await stopClipboardSync(true);
      return;
    }
    await startClipboardSync();
  }

  async function installAgent() {
    const restore = setBusy("installAgentBtn", true, "安装中");
    try {
      const data = await deviceApi("/api/device/agent-install");
      state.agent[state.activeSerial] = data;
      renderActiveSummary();
      addResult("安装手机端能力", data.ok ? "success" : "failed", resultText(data) || data.stderr || data.error || "安装完成");
    } catch (error) {
      addResult("安装手机端能力", "failed", error.message);
    } finally {
      restore();
    }
  }

  async function loadApps() {
    try {
      const data = await deviceApi("/api/device/apps", { includeSystem: true, refreshMode: "quick", skipPermissions: true, resolveLabels: false });
      const apps = (data.apps || []).slice(0, 20);
      const html = `<div class="app-list-mini">${apps.map((app) => `
        <div class="app-entry-mini">
          <div>
            <strong>${escapeHtml(app.appName || app.label || app.packageName)}</strong>
            <div class="device-muted">${escapeHtml(app.packageName || "")}</div>
          </div>
          <button class="btn btn-ghost" data-package="${attr(app.packageName || "")}" type="button">填入</button>
        </div>
      `).join("")}</div>`;
      addResult("App 列表", data.ok ? "success" : "failed", `${data.count || apps.length} 个 App；显示前 ${apps.length} 个。`, html);
    } catch (error) {
      addResult("App 列表", "failed", error.message);
    }
  }

  function packageName() {
    const value = ($("packageNameInput").value || "").trim();
    if (!value) throw new Error("请先输入包名");
    return value;
  }

  async function launchApp() {
    const pkg = packageName();
    await runShell(`monkey -p '${pkg.replaceAll("'", "'\\''")}' -c android.intent.category.LAUNCHER 1`);
  }

  async function stopApp() {
    const pkg = packageName();
    await runShell(`am force-stop '${pkg.replaceAll("'", "'\\''")}'`);
  }

  async function openPermissionPage() {
    const pkg = packageName();
    await runShell(`am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:'${pkg.replaceAll("'", "'\\''")}'`);
  }

  function remoteParent(path) {
    const clean = String(path || "/").replace(/\/+$/, "");
    if (!clean || clean === "/") return "/";
    const parent = clean.slice(0, clean.lastIndexOf("/")) || "/";
    return parent || "/";
  }

  function remoteSerialOptions() {
    const serials = state.devices
      .filter((device) => device.state === "device")
      .map((device) => device.serial);
    if (state.activeSerial && !serials.includes(state.activeSerial)) serials.unshift(state.activeSerial);
    return serials;
  }

  function resetRemoteSelection() {
    state.remoteSelectedEntry = null;
    state.remoteSelectedPath = "";
    updateRemoteSelectionUi();
  }

  function openRemoteBrowser(pathValue) {
    const path = pathValue || ($("remotePathInput").value || "/sdcard/Download").trim();
    $("remotePathInput").value = path;
    const modal = $("remoteModal");
    const serials = remoteSerialOptions();
    $("remoteSerial").innerHTML = serials.map((serial) => `<option value="${attr(serial)}">${escapeHtml(deviceLabel(serial))}</option>`).join("");
    if (state.activeSerial) $("remoteSerial").value = state.activeSerial;
    $("remotePath").value = path;
    $("remoteSearch").value = "";
    $("remoteTitle").textContent = state.activeSerial ? `手机文件管理器：${deviceLabel(state.activeSerial)}` : "手机文件管理器";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (!serials.length) {
      $("remoteCrumbs").innerHTML = "";
      $("remoteEntries").innerHTML = `<div class="empty">没有在线设备</div>`;
      $("remoteStatus").textContent = "请先连接并选择一台在线设备";
      return;
    }
    listRemote(path);
  }

  function closeRemoteBrowser() {
    $("remoteModal")?.classList.remove("open");
    $("remoteModal")?.setAttribute("aria-hidden", "true");
    resetRemoteSelection();
  }

  function renderRemoteCrumbs(path) {
    const cleaned = (path || "/").trim() || "/";
    const parts = cleaned.split("/").filter(Boolean);
    const crumbs = [`<button class="btn btn-ghost" data-remote-crumb="/" title="/" type="button">/</button>`];
    let current = "";
    parts.forEach((part) => {
      current += `/${part}`;
      crumbs.push(`<button class="btn btn-ghost" data-remote-crumb="${attr(current)}" title="${attr(current)}" type="button">${escapeHtml(part)}</button>`);
    });
    $("remoteCrumbs").innerHTML = crumbs.join("");
    document.querySelectorAll("[data-remote-crumb]").forEach((button) => {
      button.addEventListener("click", () => {
        $("remotePath").value = button.dataset.remoteCrumb || "/";
        listRemote($("remotePath").value);
      });
    });
  }

  function formatRemoteSize(entry) {
    if (!entry || entry.type === "directory") return "-";
    const raw = entry.sizeBytes ?? entry.size;
    const bytes = Number(raw);
    if (!Number.isFinite(bytes)) return entry.size || "-";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${unit}`;
  }

  function remoteTypeLabel(entry) {
    if (entry.type === "directory") return "目录";
    if (entry.type === "symlink") return "链接";
    return "文件";
  }

  function remoteEntryTarget(entry) {
    if (!entry) return "";
    if (entry.type === "symlink") return entry.targetPath || entry.linkTarget || entry.path;
    return entry.path;
  }

  function remoteEntryCanEnter(entry) {
    return entry && (entry.type === "directory" || entry.type === "symlink");
  }

  function selectRemoteEntry(entry) {
    state.remoteSelectedEntry = entry || null;
    state.remoteSelectedPath = entry?.path || "";
    updateRemoteSelectionUi();
    if (entry) $("remoteStatus").textContent = `已选中：${entry.path}`;
  }

  function updateRemoteSelectionUi() {
    document.querySelectorAll(".device-remote-modal .remote-entry").forEach((row) => {
      row.classList.toggle("selected", !!state.remoteSelectedPath && row.dataset.path === state.remoteSelectedPath);
    });
    const entry = state.remoteSelectedEntry;
    $("remoteEnterSelected").disabled = !remoteEntryCanEnter(entry);
    $("remoteOpenFile").disabled = !(entry && entry.type === "file");
    $("remoteCopySelected").disabled = !(entry || ($("remotePath")?.value || "").trim());
  }

  async function listRemote(pathValue) {
    const path = pathValue || ($("remotePath").value || $("remotePathInput").value || "/sdcard/Download").trim();
    $("remotePath").value = path;
    $("remotePathInput").value = path;
    resetRemoteSelection();
    renderRemoteCrumbs(path);
    const serial = $("remoteSerial")?.value || state.activeSerial;
    if (!serial) {
      $("remoteEntries").innerHTML = `<div class="empty">请先选择一台在线设备</div>`;
      $("remoteStatus").textContent = "";
      return;
    }
    $("remoteStatus").textContent = "读取中...";
    $("remoteEntries").innerHTML = `<div class="empty">读取中...</div>`;
    try {
      const data = await postJson("/api/remote-list", { serial, path });
      $("remoteStatus").textContent = data.ok ? `${data.entries.length} 项` : (data.stderr || data.error || "读取失败");
      if (!data.ok) {
        $("remoteEntries").innerHTML = `<div class="empty">${escapeHtml(data.stderr || data.error || "读取失败")}</div>`;
        addResult("手机文件", "failed", data.stderr || data.error || "读取失败");
        return;
      }
      $("remotePath").value = data.path || path;
      $("remotePathInput").value = data.path || path;
      renderRemoteCrumbs($("remotePath").value);
      state.remoteEntries = data.entries || [];
      renderRemoteEntries();
      addResult("手机文件", "success", `${state.remoteEntries.length} 项 · ${data.path || path}`);
    } catch (error) {
      $("remoteStatus").textContent = `读取失败：${error.message}`;
      $("remoteEntries").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      addResult("手机文件", "failed", error.message);
    }
  }

  function renderRemoteEntries() {
    const keyword = ($("remoteSearch").value || "").trim().toLowerCase();
    const sort = $("remoteSort").value || "name";
    let entries = [...(state.remoteEntries || [])];
    if (keyword) {
      entries = entries.filter((entry) => [entry.name, entry.path, entry.type, entry.mode, entry.owner, entry.group, entry.modified, entry.linkTarget].join(" ").toLowerCase().includes(keyword));
    }
    entries.sort((a, b) => {
      const dir = (a.type === "directory" ? 0 : 1) - (b.type === "directory" ? 0 : 1);
      if (dir) return dir;
      if (sort === "size") return (Number(b.sizeBytes ?? b.size) || 0) - (Number(a.sizeBytes ?? a.size) || 0);
      if (sort === "modified") return String(b.modified || "").localeCompare(String(a.modified || ""));
      if (sort === "type") return String(a.type || "").localeCompare(String(b.type || "")) || a.name.localeCompare(b.name, "zh-CN");
      return a.name.localeCompare(b.name, "zh-CN");
    });
    if (!entries.length) {
      $("remoteEntries").innerHTML = `<div class="empty">目录为空</div>`;
      updateRemoteSelectionUi();
      return;
    }
    $("remoteEntries").innerHTML = entries.map((entry, index) => `
      <div class="remote-entry ${state.remoteSelectedPath === entry.path ? "selected" : ""}" data-remote-index="${index}" data-path="${attr(entry.path)}" tabindex="0">
        <span class="badge ${entry.type === "directory" ? "ok" : entry.type === "symlink" ? "warn" : ""}">${remoteTypeLabel(entry)}</span>
        <span class="remote-name" title="${attr(entry.path)}">
          <span>${escapeHtml(entry.type === "directory" ? `${entry.name}/` : entry.name)}</span>
          ${entry.linkTarget ? `<small>-> ${escapeHtml(entry.linkTarget)}</small>` : ""}
        </span>
        <span class="remote-meta">${escapeHtml(formatRemoteSize(entry))}</span>
        <span class="remote-meta">${escapeHtml(entry.modified || "-")}</span>
        <span class="remote-meta">${escapeHtml([entry.mode, entry.owner, entry.group].filter(Boolean).join(" ") || "-")}</span>
        <div class="remote-actions">
          ${remoteEntryCanEnter(entry)
            ? `<button class="btn btn-ghost" data-remote-enter="${index}" type="button">进入</button>`
            : `<button class="btn btn-ghost" data-remote-file-open="${index}" type="button">本机打开</button>`}
          <button class="btn btn-ghost" data-copy-remote-path="${index}" type="button">复制</button>
        </div>
      </div>
    `).join("");
    document.querySelectorAll(".device-remote-modal .remote-entry").forEach((row) => {
      row.addEventListener("click", () => selectRemoteEntry(entries[Number(row.dataset.remoteIndex)]));
      row.addEventListener("dblclick", () => {
        const entry = entries[Number(row.dataset.remoteIndex)];
        if (remoteEntryCanEnter(entry)) enterRemoteEntry(entry);
        else openRemoteFile(entry?.path || "");
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const entry = entries[Number(row.dataset.remoteIndex)];
        if (remoteEntryCanEnter(entry)) enterRemoteEntry(entry);
        else openRemoteFile(entry?.path || "");
      });
    });
    document.querySelectorAll("[data-remote-enter]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        enterRemoteEntry(entries[Number(button.dataset.remoteEnter)]);
      });
    });
    document.querySelectorAll("[data-remote-file-open]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openRemoteFile(entries[Number(button.dataset.remoteFileOpen)]?.path || "");
      });
    });
    document.querySelectorAll("[data-copy-remote-path]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entry = entries[Number(button.dataset.copyRemotePath)];
        await copyText(entry?.path || "", "复制手机路径");
        $("remoteStatus").textContent = "路径已复制";
      });
    });
    updateRemoteSelectionUi();
  }

  function enterRemoteEntry(entry) {
    if (!remoteEntryCanEnter(entry)) {
      $("remoteStatus").textContent = "请选择目录或链接";
      return;
    }
    $("remotePath").value = remoteEntryTarget(entry) || entry.path;
    listRemote($("remotePath").value);
  }

  function openSelectedRemoteFile() {
    const entry = state.remoteSelectedEntry;
    if (!entry) {
      $("remoteStatus").textContent = "请选择文件";
      return;
    }
    if (entry.type !== "file") {
      $("remoteStatus").textContent = "目录请进入，文件才可本机打开";
      return;
    }
    openRemoteFile(entry.path);
  }

  async function copySelectedRemotePath() {
    const path = state.remoteSelectedEntry?.path || ($("remotePath").value || "").trim();
    if (!path) return;
    await copyText(path, "复制手机路径");
    $("remoteStatus").textContent = "路径已复制";
  }

  async function openRemoteFile(path) {
    try {
      const serial = $("remoteSerial")?.value || state.activeSerial;
      const remotePath = (path || state.remoteSelectedEntry?.path || $("remotePath")?.value || "").trim();
      if (!serial) throw new Error("请先选择一台在线设备");
      if (!remotePath || remotePath.endsWith("/")) throw new Error("请选择具体文件");
      $("remoteStatus").textContent = "正在临时复制并用本机默认应用打开...";
      const data = await postJson("/api/remote-open", { serial, path: remotePath });
      $("remoteStatus").textContent = data.ok ? `已打开：${data.localPath}` : (data.stderr || data.error || "打开失败");
      addResult("本机打开手机文件", data.ok ? "success" : "failed", resultText(data) || data.localPath || "");
    } catch (error) {
      if ($("remoteStatus")) $("remoteStatus").textContent = error.message;
      addResult("本机打开手机文件", "failed", error.message);
    }
  }

  async function copyText(text, title = "复制") {
    try {
      await navigator.clipboard.writeText(text || "");
      addResult(title, "success", text || "");
    } catch (error) {
      addResult(title, "failed", error.message || "复制失败");
    }
  }

  function bindResultButtons() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", () => copyText(button.dataset.copy || "", "复制"));
    });
    document.querySelectorAll("[data-package]").forEach((button) => {
      button.addEventListener("click", () => {
        $("packageNameInput").value = button.dataset.package || "";
        addResult("填入包名", "success", button.dataset.package || "");
      });
    });
    document.querySelectorAll("[data-remote-path]").forEach((button) => {
      button.addEventListener("click", () => listRemote(button.dataset.remotePath || "/"));
    });
    document.querySelectorAll("[data-open-remote]").forEach((button) => {
      button.addEventListener("click", () => openRemoteFile(button.dataset.openRemote || ""));
    });
  }

  async function fillTopPackage() {
    try {
      if (!state.topActivity?.package) {
        const data = await deviceApi("/api/device/top-activity");
        state.topActivity = data;
        renderDeviceInfo();
        renderTopActivityInline();
      }
      const pkg = state.topActivity?.package || "";
      if (!pkg) throw new Error("暂时没有读取到顶部包名");
      $("packageNameInput").value = pkg;
      addResult("填入当前包名", "success", pkg);
    } catch (error) {
      addResult("填入当前包名", "failed", error.message);
    }
  }

  function bindOptional(id, eventName, handler) {
    const node = $(id);
    if (node) node.addEventListener(eventName, handler);
  }

  function bindRequired(id, eventName, handler) {
    const node = $(id);
    if (!node) {
      console.warn(`[device-manager] missing required control: #${id}`);
      return;
    }
    node.addEventListener(eventName, handler);
  }

  function bindClick(id, handler, options = {}) {
    const node = $(id);
    if (!node) {
      console.warn(`[device-manager] missing action button: #${id}`);
      return;
    }
    node.addEventListener("click", async (event) => {
      event.preventDefault();
      const busyText = options.busyText || "执行中";
      const restore = options.busy ? setBusy(id, true, busyText) : () => {};
      if (options.feedback) setActionFeedback(options.feedback, "running", options.detail || "正在执行…");
      try {
        await handler(event);
      } catch (error) {
        addResult(options.failTitle || options.feedback || "操作", "failed", error.message || String(error));
      } finally {
        restore();
      }
    });
  }

  function bindEvents() {
    bindClick("refreshDevicesBtn", () => loadDevices(true), { busy: false, feedback: "刷新设备" });
    bindRequired("deviceSearchInput", "input", renderDevices);
    bindClick("refreshDeviceInfoBtn", refreshActiveDevice, { busy: true, busyText: "刷新中", feedback: "刷新设备详情" });
    bindClick("captureScreenshotBtn", captureScreenshot, { busy: false, feedback: "刷新截图" });
    bindClick("captureScreenshotBtnDock", captureScreenshot, { busy: true, busyText: "截图中", feedback: "刷新截图" });
    bindClick("topActivityBtn", showTopActivity, { busy: true, busyText: "读取中", feedback: "读取顶部 Activity" });
    bindClick("fillTopPackageBtn", fillTopPackage, { busy: true, busyText: "填入中", feedback: "填入当前包名" });
    bindClick("topActivityInlineFillBtn", fillTopPackage, { busy: false, feedback: "填入当前包名" });
    bindClick("scrollResultBtn", () => {
      document.querySelector(".result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActionFeedback("执行结果", "idle", "已定位到详细输出区域");
    }, { feedback: "查看执行结果" });

    bindClick("runShellBtn", () => runShell(), { busy: false, feedback: "执行 Shell" });
    bindRequired("shellCommandInput", "keydown", (event) => {
      if (event.key === "Enter") runShell();
    });
    document.querySelectorAll("[data-shell-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.dataset.shellShortcut || "";
        $("shellCommandInput").value = command;
        setActionFeedback("执行 Shell 快捷命令", "running", command);
        runShell(command);
      });
    });

    bindClick("readClipboardBtn", () => readClipboard(true), { busy: true, busyText: "读取中", feedback: "读取手机剪切板" });
    bindClick("copyClipboardBtn", copyPhoneClipboardToComputer, { busy: true, busyText: "复制中", feedback: "复制到电脑" });
    bindClick("writeClipboardBtn", () => writeClipboard(false, true), { busy: true, busyText: "写入中", feedback: "写入手机剪切板" });
    bindClick("pasteClipboardBtn", () => writeClipboard(true, true), { busy: true, busyText: "粘贴中", feedback: "写入并粘贴" });
    bindClick("toggleClipboardSyncBtn", toggleClipboardSync, { busy: false, feedback: "切换剪切板同步" });
    document.querySelectorAll('input[name="clipboardSyncMode"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.sync.direction = currentSyncDirection();
        renderSyncModeVisual();
        if (state.sync.running && state.sync.serial === state.activeSerial) {
          $("clipboardMeta").textContent = `同步中 · ${syncDirectionLabel()} · ${state.sync.ticks} 次检查`;
          addResult("切换同步方向", "running", `当前方向：${syncDirectionLabel()}`);
        }
        renderActiveSummary();
      });
    });
    bindClick("installAgentBtn", installAgent, { busy: false, feedback: "安装手机端能力" });

    bindClick("loadAppsBtn", loadApps, { busy: true, busyText: "读取中", feedback: "读取 App 列表" });
    bindClick("launchAppBtn", launchApp, { busy: true, busyText: "启动中", feedback: "启动 App", failTitle: "启动 App" });
    bindClick("stopAppBtn", stopApp, { busy: true, busyText: "停止中", feedback: "停止 App", failTitle: "停止 App" });
    bindClick("permissionPageBtn", openPermissionPage, { busy: true, busyText: "打开中", feedback: "打开权限页", failTitle: "权限设置" });
    bindClick("listRemoteBtn", () => openRemoteBrowser(), { busy: false, feedback: "浏览手机文件" });
    document.querySelectorAll("[data-remote-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = button.dataset.remoteShortcut || "/sdcard/";
        setActionFeedback("浏览手机目录", "running", path);
        openRemoteBrowser(path);
      });
    });
    bindRequired("remoteClose", "click", closeRemoteBrowser);
    bindRequired("remoteOpen", "click", () => listRemote($("remotePath").value));
    bindRequired("remoteEnterSelected", "click", () => enterRemoteEntry(state.remoteSelectedEntry));
    bindRequired("remoteOpenFile", "click", openSelectedRemoteFile);
    bindRequired("remoteCopySelected", "click", copySelectedRemotePath);
    bindRequired("remoteUseCurrent", "click", () => {
      const path = ($("remotePath").value || "").trim() || "/sdcard/";
      $("remotePathInput").value = path;
      closeRemoteBrowser();
      setActionFeedback("手机文件路径", "success", `已使用 ${path}`);
    });
    bindRequired("remoteUp", "click", () => {
      $("remotePath").value = remoteParent($("remotePath").value || "/");
      listRemote($("remotePath").value);
    });
    bindRequired("remoteSerial", "change", () => {
      state.activeSerial = $("remoteSerial").value || state.activeSerial;
      $("remoteTitle").textContent = state.activeSerial ? `手机文件管理器：${deviceLabel(state.activeSerial)}` : "手机文件管理器";
      listRemote($("remotePath").value);
    });
    bindRequired("remoteSearch", "input", renderRemoteEntries);
    bindRequired("remoteSort", "change", renderRemoteEntries);
    bindRequired("remotePath", "keydown", (event) => {
      if (event.key === "Enter") listRemote($("remotePath").value);
    });
    $("remoteModal")?.addEventListener("click", (event) => {
      if (event.target === $("remoteModal")) closeRemoteBrowser();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("remoteModal")?.classList.contains("open")) closeRemoteBrowser();
    });
    document.querySelectorAll("[data-remote-modal-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        $("remotePath").value = button.dataset.remoteModalShortcut || "/sdcard/";
        listRemote($("remotePath").value);
      });
    });

    bindClick("dumpBtn", () => {
      setActionFeedback("打开节点解析", "running", "正在跳转…");
      window.location.href = state.activeSerial ? `/dump.html?serial=${encodeURIComponent(state.activeSerial)}` : "/dump.html";
    }, { feedback: "打开节点解析" });
    bindClick("logInsightBtn", () => {
      setActionFeedback("打开日志洞察", "running", "正在跳转…");
      window.location.href = "/log-insight.html";
    }, { feedback: "打开日志洞察" });
    bindClick("copySerialBtn", () => copyText(state.activeSerial, "复制 serial"), { feedback: "复制 serial" });
    bindClick("copyAdbPrefixBtn", () => copyText(state.activeSerial ? `adb -s ${state.activeSerial}` : "adb", "复制 adb 前缀"), { feedback: "复制 adb 前缀" });
    bindClick("wakeDeviceBtn", () => runShell("input keyevent 26"), { feedback: "发送电源键" });
    bindClick("homeDeviceBtn", () => runShell("input keyevent 3"), { feedback: "返回桌面" });
    bindClick("clearResultBtn", () => {
      state.resultItems = [];
      $("resultMeta").textContent = "已清空";
      renderResults();
      setActionFeedback("清空执行结果", "success", "已清空详细输出");
    }, { feedback: "清空执行结果" });
  }

  async function init() {
    bindEvents();
    renderResults();
    renderDeviceInfo();
    await loadSettings();
    await loadDevices(false);
  }

  window.addEventListener("beforeunload", () => stopClipboardSync(false));
  document.addEventListener("DOMContentLoaded", init);
})();
