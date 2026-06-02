    function defaultOutputDir() {
      return state.settings.quickOutputDir || "";
    }

    const templates = {
      install_apk: () => ({ kind: "install_apk", name: "安装 APK", path: "", options: "-r -d", recursiveApkSearch: false, continueOnApkError: false, timeout: 180 }),
      pull_file: () => ({ kind: "pull_file", name: "提取文件", remotePath: "/sdcard/Download/", destDir: defaultOutputDir(), continueOnError: true, timeout: 180 }),
      push_file: () => ({ kind: "push_file", name: "保存到手机", localPath: "", remotePath: "/sdcard/Download/", continueOnError: true, timeout: 180 }),
      screenshot: () => ({ kind: "screenshot", name: "截图保存", destDir: defaultOutputDir(), filename: "screenshot_{serial}_{datetime}.png", continueOnError: true, timeout: 30 }),
      screen_record: () => ({ kind: "screen_record", name: "录屏保存", destDir: defaultOutputDir(), filename: "record_{serial}_{datetime}.mp4", remoteTempDir: "", seconds: 10, continueOnError: true, timeout: 240 }),
      app_action: () => ({ kind: "app_action", name: "应用操作", operation: "force_stop", packageName: "", activity: "", continueOnError: true, timeout: 30 }),
      permission_grant: () => ({ kind: "permission_grant", name: "权限授权", packageName: "", permissionMode: "settings_page", permissions: "CAMERA\nRECORD_AUDIO\nACCESS_FINE_LOCATION", continueOnPermissionError: true, verifyAfterGrant: true, continueOnError: true, timeout: 60 }),
      tap_text: () => ({ kind: "tap_text", name: "智能点击", keyword: "确定", matchType: "contains", matchIndex: 0, retry: 3, retryIntervalMs: 700, area: "", fallbackOcr: false, onlyOcr: false, ocrLanguages: "ch_sim,en", enabledOnly: true, ignoreCase: false, continueOnError: true, timeout: 30 }),
      adb_shell: () => ({ kind: "adb_shell", name: "Shell 命令", command: "pm list packages | head", timeout: 30 }),
      adb_raw: () => ({ kind: "adb_raw", name: "ADB 参数", command: "reboot", timeout: 30 }),
      adb_script: () => ({
        kind: "adb_script",
        name: "ADB/自动化脚本",
        commands: "adb shell getprop ro.product.model\ntapText(\"确定\")\nwaitTextAndTap(\"登录\", 5000)",
        cwd: "",
        allowLocalCommands: false,
        continueOnLineError: false,
        continueOnError: true,
        timeout: 60
      }),
      input_text: () => ({ kind: "input_text", name: "输入文本", text: "", inputMode: "auto", timeout: 30 }),
      set_clipboard: () => ({ kind: "set_clipboard", name: "复制到手机剪切板", text: "", timeout: 30 }),
      agent_clipboard: () => ({ kind: "agent_clipboard", name: "剪切板读写", operation: "read", text: "", timeout: 30 }),
      keyevent: () => ({ kind: "keyevent", name: "按键事件", key: "ENTER", timeout: 15 }),
      script: () => ({ kind: "script", name: "本机脚本", path: "", args: "", cwd: "", timeout: 300 }),
      inline_script: () => ({ kind: "inline_script", name: "页面脚本", language: "python", code: "print('hello from inline script')", args: "", cwd: "", timeout: 300 })
    };

    function deviceAlias(serial) {
      return (state.settings.deviceAliases || {})[serial] || "";
    }

    function deviceGroups(serial) {
      return (state.settings.deviceGroups || {})[serial] || "";
    }

    function deviceLabel(serial) {
      const alias = deviceAlias(serial);
      return alias ? `${alias} (${serial})` : serial;
    }

    function knownGroups() {
      const names = new Set();
      Object.values(state.settings.deviceGroups || {}).forEach(value => {
        String(value || "").split(",").map(item => item.trim()).filter(Boolean).forEach(item => names.add(item));
      });
      return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
    }

    function renderGroupOptions() {
      const groups = knownGroups();
      $("groupSelect").innerHTML = groups.length
        ? groups.map(name => `<option value="${attr(name)}">${escapeHtml(name)}</option>`).join("")
        : `<option value="">暂无分组</option>`;
      $("selectGroup").disabled = !groups.length;
    }

    function renderDevices() {
      $("selectedCount").textContent = `${state.selected.size} 台`;
      renderGroupOptions();
      if (!state.devices.length) {
        $("devices").innerHTML = `<div class="empty device-empty">没有设备。请确认已开启 USB 调试并运行 adb。</div>`;
        updateFlowGuide();
        return;
      }
      $("devices").innerHTML = state.devices.map(device => {
        const checked = state.selected.has(device.serial) ? "checked" : "";
        const disabled = device.state !== "device" ? "disabled" : "";
        const online = device.state === "device";
        const cls = online ? (checked ? "selected" : "") : "offline";
        const title = [device.model, device.product].filter(Boolean).join(" / ") || "未知型号";
        const alias = deviceAlias(device.serial);
        const groups = deviceGroups(device.serial);
        const name = alias || device.model || device.serial;
        return `
          <div class="device ${cls}">
            <div class="device-main">
              <label>
                <input type="checkbox" data-device="${device.serial}" ${checked} ${disabled}>
                <span>
                  <strong class="serial">📱 ${escapeHtml(name)}</strong>
                  <span class="muted tiny">${escapeHtml(alias ? device.serial : title)}</span>
                </span>
              </label>
              <button class="icon-button" data-device-more="${device.serial}" title="更多操作">⋯</button>
            </div>
            <div class="device-meta">
              <span class="badge ${online ? "ok" : "fail"}">${online ? "在线" : escapeHtml(device.state)}</span>
              ${device.transport ? `<span class="badge">transport ${escapeHtml(device.transport)}</span>` : ""}
            </div>
            <div class="device-subline tiny muted">${escapeHtml(title)}</div>
            <details class="device-edit">
              <summary>备注 / 分组</summary>
              <div class="grid2">
                <label><span>设备名称</span><input data-alias="${device.serial}" value="${attr(alias)}" placeholder="例如：三星主测"></label>
                <label><span>分组</span><input data-groups="${device.serial}" value="${attr(groups)}" placeholder="例如：回归, 三星"></label>
              </div>
            </details>
          </div>`;
      }).join("");
      document.querySelectorAll("[data-device]").forEach(input => {
        input.addEventListener("change", () => {
          input.checked ? state.selected.add(input.dataset.device) : state.selected.delete(input.dataset.device);
          renderDevices();
        });
      });
      document.querySelectorAll("[data-device-more]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          openDeviceActions(btn.dataset.deviceMore);
        });
      });
      document.querySelectorAll("[data-alias]").forEach(input => {
        input.addEventListener("input", () => {
          state.settings.deviceAliases ||= {};
          state.settings.deviceAliases[input.dataset.alias] = input.value.trim();
        });
      });
      document.querySelectorAll("[data-groups]").forEach(input => {
        input.addEventListener("input", () => {
          state.settings.deviceGroups ||= {};
          state.settings.deviceGroups[input.dataset.groups] = input.value.trim();
          renderGroupOptions();
        });
      });
      updateFlowGuide();
    }

    function renderProfiles() {
      if (!state.profiles.length) {
        $("profiles").innerHTML = `<div class="empty">还没有保存的方案</div>`;
        return;
      }
      $("profiles").innerHTML = state.profiles.map((profile, index) => `
        <div class="profile saved-profile-card">
          <div class="profile-main">
            <strong title="${attr(profile.name || "未命名方案")}">${escapeHtml(profile.name || "未命名方案")}</strong>
            <div class="muted tiny">${profile.steps.length} 个动作</div>
          </div>
          <div class="profile-actions">
            <button data-load-profile="${index}" title="载入方案">${iconLabel("import", "载入")}</button>
            <button class="danger" data-delete-profile="${index}" title="删除方案">${iconLabel("trash", "删除")}</button>
          </div>
        </div>
      `).join("");
      document.querySelectorAll("[data-load-profile]").forEach(btn => {
        btn.addEventListener("click", () => {
          const profile = state.profiles[Number(btn.dataset.loadProfile)];
          state.steps = structuredClone(profile.steps);
          $("profileName").value = profile.name || "";
          renderSteps();
        });
      });
      document.querySelectorAll("[data-delete-profile]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const index = Number(btn.dataset.deleteProfile);
          const profile = state.profiles[index];
          if (!profile) return;
          if (!confirm(`确定删除方案「${profile.name || "未命名方案"}」吗？`)) return;
          state.profiles.splice(index, 1);
          await saveProfiles();
          renderProfiles();
        });
      });
    }

    function iconSvg(name, extraClass = "") {
      const classes = ["ui-icon", extraClass].filter(Boolean).join(" ");
      return `<svg class="${attr(classes)}" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${attr(name)}"></use></svg>`;
    }

    function iconLabel(icon, label) {
      return `${iconSvg(icon)}<span>${escapeHtml(label)}</span>`;
    }

    function stepIcon(kind) {
      const icon = {
        install_apk: "package",
        pull_file: "import",
        push_file: "export",
        screenshot: "screenshot",
        screen_record: "record",
        app_action: "app",
        permission_grant: "shield",
        tap_text: "target",
        adb_shell: "terminal",
        adb_raw: "terminal",
        adb_script: "terminal",
        input_text: "keyboard",
        set_clipboard: "clipboard",
        agent_clipboard: "clipboard",
        keyevent: "keyboard",
        script: "script",
        inline_script: "script"
      }[kind] || "workflow";
      return iconSvg(icon);
    }

    function stepSummary(step) {
      if (step.kind === "install_apk") return step.path || "选择 APK 文件";
      if (step.kind === "app_action") return [step.operation, step.packageName].filter(Boolean).join(" · ") || "配置应用操作";
      if (step.kind === "screenshot") return step.filename || "截图保存";
      if (step.kind === "screen_record") return `${step.seconds || 10}s · ${step.filename || "录屏"}`;
      if (step.kind === "input_text") return step.text || "输入文本";
      if (step.kind === "set_clipboard") return step.text || "复制文本到手机剪切板";
      if (step.kind === "agent_clipboard") return {
        read: "读取手机剪切板",
        set: "写入手机剪切板",
        set_and_paste: "直接输入到焦点",
        enable_ime: "启用 CQClaw 输入法",
        status: "检查手机端服务"
      }[step.operation || "read"] || "剪切板读写";
      if (step.kind === "tap_text") return step.keyword || "点击文本";
      if (step.kind === "pull_file") return step.remotePath || "手机路径";
      if (step.kind === "push_file") return step.localPath || "本机文件";
      if (step.kind === "permission_grant") return step.packageName || "选择包名";
      if (step.kind === "keyevent") return step.key || "KeyCode";
      if (step.kind === "adb_script") return "ADB/自动化脚本";
      if (step.kind === "script") return step.path || "本机脚本";
      if (step.kind === "inline_script") return step.language || "页面脚本";
      return stepTargetLabel(step);
    }

    function activeStepIndex() {
      if (!state.steps.length) return -1;
      if (typeof state.activeStep !== "number" || state.activeStep < 0 || state.activeStep >= state.steps.length) {
        state.activeStep = 0;
      }
      return state.activeStep;
    }

    function renderSteps() {
      if (!state.steps.length) {
        state.activeStep = -1;
        $("steps").classList.add("is-empty-flow");
        $("steps").innerHTML = `
          <div class="empty workflow-empty">
            <div class="empty-visual-card workflow-empty-card">
              <div class="empty-visual-media" aria-hidden="true">
                <img class="module-theme-art module-theme-art-light" src="/assets/workbench/workflow-automation-hero-light.png" alt="">
                <img class="module-theme-art module-theme-art-dark" src="/assets/workbench/workflow-automation-hero-dark.png" alt="">
              </div>
              <div class="empty-visual-copy">
                <strong>还没有动作</strong>
                <span>从左侧动作库添加第一个动作，或导入已有编排。建议先从安装 APK、智能点击、自动化脚本这些高频动作开始。</span>
                <div class="empty-visual-actions">
                  <button class="btn btn-primary" type="button" data-empty-add="install_apk">${iconLabel("package", "安装 APK")}</button>
                  <button class="btn btn-secondary" type="button" data-empty-add="tap_text">${iconLabel("target", "智能点击")}</button>
                  <button class="btn btn-secondary" type="button" data-empty-add="adb_script">${iconLabel("terminal", "自动化脚本")}</button>
                  <button class="btn btn-ghost" type="button" data-empty-import>${iconLabel("import", "导入编排")}</button>
                </div>
              </div>
            </div>
          </div>`;
        updateFlowGuide();
        updateRunControls();
        return;
      }
      $("steps").classList.remove("is-empty-flow");
      updateFlowGuide();
      const active = activeStepIndex();
      const current = state.steps[active];
      const nodes = state.steps.map((step, index) => `
        <div class="flow-node ${index === active ? "active" : ""} ${step.enabled === false ? "disabled-step" : ""} ${state.runningStep === index ? "is-running" : ""}" data-node-select="${index}">
          <div class="drag-handle">⋮⋮</div>
          <div class="step-index">${index + 1}</div>
          <div class="node-icon">${stepIcon(step.kind)}</div>
          <div class="node-main">
            <div class="node-title">${escapeHtml(step.name || kindLabel(step.kind))}</div>
            <div class="node-desc">${escapeHtml(stepSummary(step))}</div>
          </div>
          <div class="node-status ${step.enabled === false ? "off" : "on"}">${step.enabled === false ? "停用" : "启用"}</div>
          ${(() => {
            const runState = stepRunState(step, index);
            const canRun = runState.canRun && state.runningStep === null;
            return `
              <div class="node-readiness ${runState.css}" title="${attr(runState.title)}">${escapeHtml(runState.label)}</div>
              <div class="node-inline-actions">
                <button type="button" class="node-run-btn" data-node-action="run" data-node-index="${index}" title="${attr(runState.title)}" ${canRun ? "" : "disabled"}>${state.runningStep === index ? "执行中" : iconSvg("play")}</button>
                <button type="button" class="node-primary-action" data-node-action="toggle" data-node-index="${index}" title="${step.enabled === false ? "启用该节点" : "停用该节点"}">${step.enabled === false ? "启用" : "停用"}</button>
                <button type="button" class="node-secondary-action" data-node-action="top" data-node-index="${index}" title="置顶" ${index === 0 ? "disabled" : ""}>⇤</button>
                <button type="button" class="node-secondary-action" data-node-action="up" data-node-index="${index}" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="node-secondary-action" data-node-action="down" data-node-index="${index}" title="下移" ${index === state.steps.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="node-secondary-action" data-node-action="bottom" data-node-index="${index}" title="置底" ${index === state.steps.length - 1 ? "disabled" : ""}>⇥</button>
                <button type="button" class="danger node-secondary-action" data-node-action="delete" data-node-index="${index}" title="删除">${iconSvg("trash")}</button>
              </div>
              ${runState.ok ? "" : `<div class="node-validation" title="${attr(runState.messages.join("；"))}">${escapeHtml(runState.hint)}</div>`}
            `;
          })()}
        </div>
      `).join(`<div class="node-line"></div>`);

      $("steps").innerHTML = `
        <div class="flow-canvas">
          <div class="flow-canvas-head">
            <strong>当前流程（${state.steps.length}）</strong>
            <span class="muted tiny">点击节点配置参数，可用 ↑ ↓ 调整顺序</span>
          </div>
          <div class="node-list">${nodes}</div>
          <div class="drop-hint">拖拽动作到这里添加节点（当前版本点击左侧动作添加）</div>
        </div>
        <div class="step node-config ${current.enabled === false ? "disabled-step" : ""}" data-step="${active}">
          <div class="config-head">
            <div class="node-icon big">${stepIcon(current.kind)}</div>
            <div class="grow">
              <h3>${escapeHtml(current.name || kindLabel(current.kind))}</h3>
              <div class="muted tiny">配置当前节点参数</div>
            </div>
            <div class="config-head-actions">
              <button type="button" class="config-copy-node" data-node-action="duplicate" data-node-index="${active}" title="复制当前节点">${iconLabel("copy", "复制节点")}</button>
              <label class="switch tiny"><input type="checkbox" data-field="enabled" ${current.enabled !== false ? "checked" : ""}> 启用</label>
            </div>
          </div>
          <div class="config-note tiny">此区域配置当前节点参数；复制节点、启用状态也可在右侧直接操作，排序和删除在左侧节点列表完成。</div>
          <div class="grid2 step-title-grid config-title-grid">
            <label><span>动作名称</span><input data-field="name" value="${attr(current.name || "")}"></label>
            <label><span>类型</span><select data-field="kind">${kindOptions(current.kind)}</select></label>
          </div>
          <div class="step-body">${fieldsFor(current)}</div>
        </div>
      `;
      bindStepEvents();
    }

    function kindOptions(current) {
      const labels = {
        install_apk: "安装 APK",
        pull_file: "提取文件",
        push_file: "保存到手机",
        screenshot: "截图保存",
        screen_record: "录屏保存",
        app_action: "应用操作",
        permission_grant: "权限授权",
        tap_text: "智能点击",
        adb_shell: "ADB Shell",
        adb_raw: "ADB 参数",
        adb_script: "ADB/自动化脚本",
        input_text: "输入文本",
        set_clipboard: "复制到剪切板",
        agent_clipboard: "剪切板读写",
        keyevent: "按键事件",
        script: "本机脚本",
        inline_script: "页面脚本"
      };
      return Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");
    }

    function kindLabel(kind) {
      const labels = {
        install_apk: "安装 APK",
        pull_file: "提取文件",
        push_file: "保存到手机",
        screenshot: "截图保存",
        screen_record: "录屏保存",
        app_action: "应用操作",
        permission_grant: "权限授权",
        tap_text: "智能点击",
        adb_shell: "ADB Shell",
        adb_raw: "ADB 参数",
        adb_script: "ADB/自动化脚本",
        input_text: "输入文本",
        set_clipboard: "复制到剪切板",
        agent_clipboard: "剪切板读写",
        keyevent: "按键事件",
        script: "本机脚本",
        inline_script: "页面脚本"
      };
      return labels[kind] || kind || "动作";
    }

    function stepTargetLabel(step) {
      return ["script", "inline_script"].includes(step.kind) ? "本机执行" : "选中设备";
    }

    function outputDirValue(step) {
      return step.destDir || defaultOutputDir();
    }

    function renderAdbSnippetButtons() {
      const groups = state.adbSnippets?.groups || [];
      return `<div class="snippet-panel">
        <div class="row">
          <strong class="tiny grow">快捷命令</strong>
          <button type="button" data-adb-snippets-open title="${attr(state.adbSnippetsPath || "打开配置文件")}">打开配置</button>
          <button type="button" data-adb-snippets-reload>重新加载</button>
        </div>
        ${state.adbSnippetsPath ? `<div class="muted tiny">${escapeHtml(state.adbSnippetsPath)}</div>` : ""}
        ${groups.length ? groups.map((group, groupIndex) => `
          <div class="snippet-group">
            <div class="snippet-title">${escapeHtml(group.title)}</div>
            <div class="snippet-buttons">
              ${(group.items || []).map((snippet, itemIndex) => {
                const ref = `${groupIndex}:${itemIndex}`;
                return `<button type="button" data-adb-snippet="${attr(ref)}" title="${attr(snippet.title || snippet.label)}">${escapeHtml(snippet.label)}</button>`;
              }).join("")}
            </div>
          </div>
        `).join("") : `<div class="empty">没有快捷命令。点“打开配置”添加。</div>`}
      </div>`;
    }

    function fieldsFor(step) {
      const common = `<label><span>超时秒数</span><input type="number" min="0" data-field="timeout" value="${attr(step.timeout || "")}" placeholder="0 表示不限制"></label>`;
      if (step.kind === "install_apk") {
        return `<div class="grid2">
          <div class="path-field">
            <label><span>APK 文件或文件夹</span><input data-field="path" value="${attr(step.path || "")}" placeholder="/path/app.apk 或 /path/apk-folder"></label>
            <div class="row">
              <button data-pick="apk" data-target="path">选 APK</button>
              <button data-pick="apk_folder" data-target="path">选文件夹</button>
            </div>
          </div>
          <label><span>安装参数</span><input data-field="options" value="${attr(step.options || "-r -d")}" placeholder="-r -d -g"></label>
          <label class="row tiny"><input type="checkbox" data-field="recursiveApkSearch" ${step.recursiveApkSearch ? "checked" : ""} style="width:auto"> 包含子文件夹 APK</label>
          <label class="row tiny"><input type="checkbox" data-field="continueOnApkError" ${step.continueOnApkError ? "checked" : ""} style="width:auto"> 某个 APK 失败时继续安装</label>
          ${common}
        </div>`;
      }
      if (step.kind === "pull_file") {
        return `<div class="grid2">
          <div class="path-field">
            <label><span>手机路径</span><input data-field="remotePath" value="${attr(step.remotePath || "")}" placeholder="/sdcard/Download/a.txt 或 /sdcard/Logs/"></label>
            <button data-remote-pick data-target="remotePath">浏览</button>
          </div>
          <div class="path-field">
            <label><span>电脑保存目录</span><input data-field="destDir" value="${attr(outputDirValue(step))}" placeholder="${attr(defaultOutputDir())}"></label>
            <button data-pick="directory" data-target="destDir">选择</button>
          </div>
          <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          ${common}
        </div>`;
      }
      if (step.kind === "push_file") {
        return `<div class="grid2">
          <div class="path-field">
            <label><span>电脑文件或目录</span><input data-field="localPath" value="${attr(step.localPath || "")}" placeholder="/Users/you/Desktop/a.txt 或 C:\\files\\a.txt"></label>
            <div class="row">
              <button data-pick="file" data-target="localPath">选文件</button>
              <button data-pick="directory" data-target="localPath">选目录</button>
            </div>
          </div>
          <div class="path-field">
            <label><span>手机保存路径</span><input data-field="remotePath" value="${attr(step.remotePath || "")}" placeholder="/sdcard/Download/ 或 /sdcard/Download/a.txt"></label>
            <button data-remote-pick data-target="remotePath">浏览</button>
          </div>
          <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          ${common}
        </div>`;
      }
      if (step.kind === "screenshot") {
        return `<div class="grid2">
          <div class="path-field">
            <label><span>电脑保存目录</span><input data-field="destDir" value="${attr(outputDirValue(step))}" placeholder="${attr(defaultOutputDir())}"></label>
            <button data-pick="directory" data-target="destDir">选择</button>
          </div>
          <label><span>文件名</span><input data-field="filename" value="${attr(step.filename || "screenshot_{serial}_{datetime}.png")}" placeholder="screenshot_{serial}_{datetime}.png"></label>
          <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          ${common}
        </div>`;
      }
      if (step.kind === "screen_record") {
        return `<div class="grid2">
          <div class="path-field">
            <label><span>电脑保存目录</span><input data-field="destDir" value="${attr(outputDirValue(step))}" placeholder="${attr(defaultOutputDir())}"></label>
            <button data-pick="directory" data-target="destDir">选择</button>
          </div>
          <label><span>文件名</span><input data-field="filename" value="${attr(step.filename || "record_{serial}_{datetime}.mp4")}" placeholder="record_{serial}_{datetime}.mp4"></label>
          <label><span>手机临时目录</span><input data-field="remoteTempDir" value="${attr(step.remoteTempDir || "")}" placeholder="自动：Download / Movies / DCIM / data/local/tmp"></label>
          <label><span>录屏秒数</span><input type="number" min="1" max="180" data-field="seconds" value="${attr(step.seconds || 10)}"></label>
          <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          ${common}
        </div>`;
      }
      if (step.kind === "app_action") {
        return `<div class="grid2">
          <label><span>操作</span><select data-field="operation">
            <option value="force_stop" ${step.operation === "force_stop" ? "selected" : ""}>强制停止</option>
            <option value="clear_data" ${step.operation === "clear_data" ? "selected" : ""}>清除数据</option>
            <option value="start_app" ${step.operation === "start_app" ? "selected" : ""}>启动应用</option>
            <option value="start_activity" ${step.operation === "start_activity" ? "selected" : ""}>启动 Activity</option>
            <option value="uninstall" ${step.operation === "uninstall" ? "selected" : ""}>卸载应用</option>
          </select></label>
          <div class="path-field">
            <label><span>应用包名</span><input data-field="packageName" value="${attr(step.packageName || "")}" placeholder="com.example.app"></label>
            <button data-app-pick data-target="packageName">选择 App</button>
          </div>
          <label><span>Activity</span><input data-field="activity" value="${attr(step.activity || "")}" placeholder="com.example.app/.MainActivity"></label>
          <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          ${common}
        </div>`;
      }
      if (step.kind === "permission_grant") {
        return `<div class="stack">
          <div class="grid2">
            <div class="path-field">
              <label><span>应用包名</span><input data-field="packageName" value="${attr(step.packageName || "")}" placeholder="com.example.app"></label>
              <button data-app-pick data-target="packageName">选择 App</button>
            </div>
            <label><span>授权模式</span><select data-field="permissionMode">
              <option value="settings_page" ${step.permissionMode !== "common" && step.permissionMode !== "declared_dangerous" && step.permissionMode !== "custom" ? "selected" : ""}>权限页可见权限（推荐）</option>
              <option value="declared_dangerous" ${step.permissionMode === "declared_dangerous" ? "selected" : ""}>App 声明可授权权限</option>
              <option value="common" ${step.permissionMode === "common" ? "selected" : ""}>常用危险权限</option>
              <option value="custom" ${step.permissionMode === "custom" ? "selected" : ""}>自定义权限列表</option>
            </select></label>
          </div>
          <label><span>自定义权限列表</span><textarea data-field="permissions" placeholder="CAMERA&#10;RECORD_AUDIO&#10;android.permission.POST_NOTIFICATIONS">${escapeHtml(step.permissions || "")}</textarea></label>
          <div class="grid2">
            <label class="row tiny"><input type="checkbox" data-field="continueOnPermissionError" ${step.continueOnPermissionError !== false ? "checked" : ""} style="width:auto"> 某个权限失败时继续</label>
            <label class="row tiny"><input type="checkbox" data-field="verifyAfterGrant" ${step.verifyAfterGrant !== false ? "checked" : ""} style="width:auto"> 授权后复查权限页状态</label>
            <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
            ${common}
          </div>
          <div class="variable-help tiny">
            <span>推荐模式会读取该 App 的 <code>runtime permissions</code>，目标是让系统设置里的 App 权限页可见权限尽量全部变成已授权。</span>
            <span>普通权限会执行 <code>pm grant &lt;package&gt; &lt;permission&gt;</code>。</span>
            <span>特殊权限会尝试 <code>appops</code> / <code>cmd deviceidle</code>，失败时日志会提示需要手动到系统设置确认。</span>
          </div>
        </div>`;
      }
      if (step.kind === "tap_text") {
        return `<div class="stack">
          <div class="grid2">
            <label><span>要点击的文字</span><input data-field="keyword" value="${attr(step.keyword || "")}" placeholder="确定 / 登录 / 继续"></label>
            <label><span>匹配方式</span><select data-field="matchType">
              <option value="contains" ${step.matchType !== "exact" && step.matchType !== "regex" ? "selected" : ""}>包含</option>
              <option value="exact" ${step.matchType === "exact" ? "selected" : ""}>完全一致</option>
              <option value="regex" ${step.matchType === "regex" ? "selected" : ""}>正则</option>
            </select></label>
          </div>
          <div class="grid3">
            <label><span>命中序号</span><input type="number" min="0" data-field="matchIndex" value="${attr(step.matchIndex ?? 0)}" placeholder="0 表示第一个"></label>
            <label><span>尝试次数</span><input type="number" min="1" max="30" data-field="retry" value="${attr(step.retry || 3)}"></label>
            <label><span>间隔毫秒</span><input type="number" min="0" data-field="retryIntervalMs" value="${attr(step.retryIntervalMs ?? 700)}"></label>
          </div>
          <div class="grid2">
            <label><span>限定区域</span><input data-field="area" value="${attr(step.area || "")}" placeholder="可选：x1,y1,x2,y2"></label>
            <label><span>OCR 语言</span><input data-field="ocrLanguages" value="${attr(step.ocrLanguages || "ch_sim,en")}" placeholder="ch_sim,en"></label>
          </div>
          <div class="grid2">
            <label class="row tiny"><input type="checkbox" data-field="enabledOnly" ${step.enabledOnly !== false ? "checked" : ""} style="width:auto"> 只点击可用节点</label>
            <label class="row tiny"><input type="checkbox" data-field="ignoreCase" ${step.ignoreCase ? "checked" : ""} style="width:auto"> 忽略英文大小写</label>
            <label class="row tiny"><input type="checkbox" data-field="fallbackOcr" ${step.fallbackOcr ? "checked" : ""} style="width:auto"> 找不到时尝试 OCR</label>
            <label class="row tiny"><input type="checkbox" data-field="onlyOcr" ${step.onlyOcr ? "checked" : ""} style="width:auto"> 只用 OCR</label>
            <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
          </div>
          <div class="variable-help tiny">
            <span>执行逻辑：先 dump 当前 UI 节点，匹配 <code>text</code> / <code>content-desc</code> 后点击 bounds 中心点。</span>
            <span>多个命中会先按编辑距离排序：越像关键字越靠前；命中序号仍可选择第 2、第 3 个。</span>
            <span>OCR 兜底适合 WebView、图片按钮、游戏界面；只用 OCR 会跳过 UI 节点识别。</span>
          </div>
          <div class="grid2">${common}</div>
        </div>`;
      }
      if (step.kind === "adb_shell") {
        return `<div class="grid2"><label><span>Shell 命令</span><textarea data-field="command">${escapeHtml(step.command || "")}</textarea></label>${common}</div>`;
      }
      if (step.kind === "adb_raw") {
        return `<div class="grid2"><label><span>adb -s 设备 后面的参数</span><textarea data-field="command">${escapeHtml(step.command || "")}</textarea></label>${common}</div>`;
      }
      if (step.kind === "adb_script") {
        return `<div class="stack">
          <label><span>ADB/自动化脚本</span><textarea class="code-box" data-field="commands" placeholder="adb shell getprop ro.product.model&#10;tapText(&quot;确定&quot;)&#10;longPressText(&quot;微信&quot;)&#10;waitTextAndTap(&quot;登录&quot;, 5000)&#10;ifTextExists(&quot;更新&quot;) {&#10;  tapText(&quot;取消&quot;)&#10;}">${escapeHtml(step.commands || "")}</textarea></label>
          ${renderAdbSnippetButtons()}
          <div class="variable-help tiny">
            <span>每一行都会先替换变量。以 <code>adb</code> 开头且没有 <code>-s</code> / <code>-d</code> / <code>-e</code> / <code>-t</code> 时，会自动按当前设备补 <code>-s</code>。</span>
            <span>写 <code>adb -s {serial} ...</code> 会随设备替换；写固定序列号时，只在匹配那台选中设备上执行。</span>
            <span>同一个脚本里也能写自动化 DSL：<code>tapText("确定")</code>、<code>longPressText("微信")</code>、<code>longPressId("com.demo:id/item")</code>、<code>waitAnyText(["允许","拒绝"], 5000)</code>、<code>retry(3) { ... }</code>、<code>ifTextExists("更新") { ... } else { ... }</code>。</span>
            <span>文字识别可写 <code>{ fallbackOcr: true }</code> 或 <code>{ onlyOcr: true }</code>；多个命中会优先选择编辑距离最小的结果。长按可写 <code>longPressText("微信", 1200)</code> 指定毫秒时长。</span>
            <span><code>tapText</code> 找不到目标时默认只输出 warning 并继续；需要强制失败可写 <code>tapText("登录", { strict: true })</code>。<code>retry</code> / <code>ifText...</code> 支持多层嵌套，也支持 <code>else ifTextExists(...) { ... }</code>。</span>
          </div>
          <div class="grid2">
            <div class="path-field">
              <label><span>执行目录</span><input data-field="cwd" value="${attr(step.cwd || "")}" placeholder="可选，影响相对路径"></label>
              <button data-pick="directory" data-target="cwd">选择</button>
            </div>
            ${common}
          </div>
          <div class="grid2">
            <label class="row tiny"><input type="checkbox" data-field="continueOnLineError" ${step.continueOnLineError ? "checked" : ""} style="width:auto"> 某行失败时继续后续行</label>
            <label class="row tiny"><input type="checkbox" data-field="continueOnError" ${step.continueOnError !== false ? "checked" : ""} style="width:auto"> 某台失败时继续执行</label>
            <label class="row tiny"><input type="checkbox" data-field="allowLocalCommands" ${step.allowLocalCommands ? "checked" : ""} style="width:auto"> 允许非 adb 行按本机命令执行</label>
          </div>
        </div>`;
      }
      if (step.kind === "input_text") {
        return `<div class="stack">
          <label><span>输入到手机的文本</span><textarea data-field="text">${escapeHtml(step.text || "")}</textarea></label>
          <div class="grid2">
            <label><span>输入方式</span><select data-field="inputMode">
              <option value="auto" ${["", "auto", "clipboard_paste"].includes(step.inputMode || "auto") ? "selected" : ""}>自动输入（剪切板可用则粘贴，否则短文本分段输入）</option>
              <option value="adb_input" ${step.inputMode === "adb_input" ? "selected" : ""}>强制 ADB input text（英文/数字）</option>
            </select></label>
            ${common}
          </div>
          <div class="muted tiny">自动模式会优先使用手机端桥接输入：临时切到专用输入通道，提交文本后自动恢复原输入法。</div>
        </div>`;
      }
      if (step.kind === "set_clipboard") {
        return `<div class="stack">
          <label><span>复制到手机剪切板的文本</span><textarea data-field="text">${escapeHtml(step.text || "")}</textarea></label>
          <div class="grid2">${common}</div>
          <div class="muted tiny">优先通过手机端桥接能力写入剪切板；必要时会临时切换输入通道，完成后自动恢复。</div>
        </div>`;
      }
      if (step.kind === "agent_clipboard") {
        const operation = step.operation || "read";
        const needsText = ["set", "set_and_paste"].includes(operation);
        return `<div class="stack">
          <div class="grid2">
            <label><span>操作</span><select data-field="operation">
              <option value="read" ${operation === "read" ? "selected" : ""}>读取手机剪切板</option>
              <option value="set" ${operation === "set" ? "selected" : ""}>写入手机剪切板</option>
              <option value="set_and_paste" ${operation === "set_and_paste" ? "selected" : ""}>直接输入到当前焦点</option>
              <option value="enable_ime" ${operation === "enable_ime" ? "selected" : ""}>切换到 CQClaw 输入法（调试）</option>
              <option value="status" ${operation === "status" ? "selected" : ""}>检查手机端服务</option>
            </select></label>
            ${common}
          </div>
          ${needsText ? `<label><span>剪切板文本</span><textarea data-field="text">${escapeHtml(step.text || "")}</textarea></label>` : ""}
          <div class="muted tiny">使用手机端桥接能力完成读写与直接输入；读取/复制会做校验，直接输入会自动恢复原输入法。</div>
        </div>`;
      }
      if (step.kind === "keyevent") {
        return `<div class="grid2"><label><span>KeyCode</span><input data-field="key" value="${attr(step.key || "")}" placeholder="ENTER / HOME / 66"></label>${common}</div>`;
      }
      if (step.kind === "inline_script") {
        return `<div class="stack">
          <div class="grid2">
            <label><span>脚本类型</span><select data-field="language">
              <option value="python" ${step.language === "python" ? "selected" : ""}>Python</option>
              <option value="bash" ${step.language === "bash" ? "selected" : ""}>Bash</option>
              <option value="powershell" ${step.language === "powershell" ? "selected" : ""}>PowerShell</option>
              <option value="batch" ${step.language === "batch" ? "selected" : ""}>Bat/Cmd</option>
            </select></label>
            <label><span>参数</span><input data-field="args" value="${attr(step.args || "")}" placeholder="--name test"></label>
          </div>
          <div class="grid2">
            <div class="path-field">
              <label><span>执行目录</span><input data-field="cwd" value="${attr(step.cwd || "")}" placeholder="可选，脚本运行时的工作目录"></label>
              <button data-pick="directory" data-target="cwd">选择</button>
            </div>
            ${common}
          </div>
          <label><span>脚本代码</span><textarea class="code-box" data-field="code">${escapeHtml(step.code || "")}</textarea></label>
        </div>`;
      }
      return `<div class="grid2">
        <div class="path-field">
          <label><span>脚本路径</span><input data-field="path" value="${attr(step.path || "")}" placeholder="/path/task.py、task.sh、task.bat"></label>
          <button data-pick="script" data-target="path">选择</button>
        </div>
        <label><span>参数</span><input data-field="args" value="${attr(step.args || "")}" placeholder="--apk /path/app.apk --env test"></label>
        <div class="path-field">
          <label><span>工作目录</span><input data-field="cwd" value="${attr(step.cwd || "")}" placeholder="可选"></label>
          <button data-pick="directory" data-target="cwd">选择</button>
        </div>
        ${common}
      </div>`;
    }

    function bindStepEvents() {
      document.querySelectorAll("[data-node-select]").forEach(node => {
        node.addEventListener("click", event => {
          if (event.target.closest("[data-node-action]")) return;
          syncAllStepFields();
          state.activeStep = Number(node.dataset.nodeSelect);
          renderSteps();
        });
      });

      document.querySelectorAll("[data-node-action]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();

          syncAllStepFields();

          const index = Number(btn.dataset.nodeIndex);
          const action = btn.dataset.nodeAction;
          if (!Number.isInteger(index) || index < 0 || index >= state.steps.length) return;

          if (action === "run") {
            state.activeStep = index;
            runStep(index);
            return;
          }

          if (action === "toggle") {
            state.steps[index].enabled = state.steps[index].enabled === false;
            state.activeStep = index;
            renderSteps();
            return;
          }

          if (action === "delete") {
            state.steps.splice(index, 1);
            state.activeStep = Math.min(index, state.steps.length - 1);
            renderSteps();
            return;
          }

          if (action === "duplicate") {
            const copy = structuredClone(state.steps[index]);
            copy.name = `${copy.name || kindLabel(copy.kind)} 副本`;
            state.steps.splice(index + 1, 0, copy);
            state.activeStep = index + 1;
            renderSteps();
            return;
          }

          let target = index;
          if (action === "top") target = 0;
          if (action === "up") target = index - 1;
          if (action === "down") target = index + 1;
          if (action === "bottom") target = state.steps.length - 1;

          if (target < 0 || target >= state.steps.length || target === index) return;

          const [item] = state.steps.splice(index, 1);
          state.steps.splice(target, 0, item);
          state.activeStep = target;
          renderSteps();
        });
      });
      document.querySelectorAll("[data-step]").forEach(card => {
        const index = Number(card.dataset.step);
        card.querySelectorAll("[data-field]").forEach(field => {
          if (!["checkbox", "number"].includes(field.type) && field.tagName !== "SELECT") {
            field.addEventListener("focus", () => {
              state.activeField = field;
            });
          }
          field.addEventListener("input", () => {
            state.steps[index][field.dataset.field] = field.type === "number" ? Number(field.value) : field.type === "checkbox" ? field.checked : field.value;
            updateStepNodeShell(index);
            updateRunControls();
          });
          field.addEventListener("change", () => {
            const key = field.dataset.field;
            if (key === "kind") {
              const next = templates[field.value]();
              state.steps[index] = { ...next, name: state.steps[index].name || next.name };
              state.activeStep = index;
              renderSteps();
            } else {
              state.steps[index][key] = field.type === "number" ? Number(field.value) : field.type === "checkbox" ? field.checked : field.value;
              renderSteps();
            }
          });
        });
        const remove = card.querySelector("[data-remove]");
        if (remove) {
          remove.addEventListener("click", () => {
            state.steps.splice(index, 1);
            state.activeStep = Math.min(index, state.steps.length - 1);
            renderSteps();
          });
        }
        const duplicate = card.querySelector("[data-duplicate]");
        if (duplicate) {
          duplicate.addEventListener("click", () => {
            const copy = structuredClone(state.steps[index]);
            copy.name = `${copy.name || kindLabel(copy.kind)} 副本`;
            state.steps.splice(index + 1, 0, copy);
            state.activeStep = index + 1;
            renderSteps();
          });
        }
        const runStepButton = card.querySelector("[data-run-step]");
        if (runStepButton) {
          runStepButton.addEventListener("click", () => runStep(index));
        }
        card.querySelectorAll("[data-move]").forEach(btn => {
          btn.addEventListener("click", () => {
            const to = index + Number(btn.dataset.move);
            if (to < 0 || to >= state.steps.length) return;
            const [item] = state.steps.splice(index, 1);
            state.steps.splice(to, 0, item);
            state.activeStep = to;
            renderSteps();
          });
        });
        card.querySelectorAll("[data-move-to]").forEach(btn => {
          btn.addEventListener("click", () => {
            const to = btn.dataset.moveTo === "top" ? 0 : state.steps.length - 1;
            if (to === index) return;
            const [item] = state.steps.splice(index, 1);
            state.steps.splice(to, 0, item);
            state.activeStep = to;
            renderSteps();
          });
        });
        card.querySelectorAll("[data-pick]").forEach(btn => {
          btn.addEventListener("click", () => withButtonBusy(btn, "选择中...", () => pickIntoStep(index, btn.dataset.target, btn.dataset.pick)));
        });
        card.querySelectorAll("[data-remote-pick]").forEach(btn => {
          btn.addEventListener("click", async () => {
            openRemotePicker(index, btn.dataset.target);
          });
        });
        card.querySelectorAll("[data-app-pick]").forEach(btn => {
          btn.addEventListener("click", () => openAppManager({ mode: "pick", index, target: btn.dataset.target }));
        });
        card.querySelectorAll("[data-adb-snippet]").forEach(btn => {
          btn.addEventListener("click", () => insertAdbSnippet(index, btn.dataset.adbSnippet));
        });
        card.querySelectorAll("[data-adb-snippets-reload]").forEach(btn => {
          btn.addEventListener("click", () => withButtonBusy(btn, "加载中...", () => loadAdbSnippets(true), "正在重新加载快捷命令..."));
        });
        card.querySelectorAll("[data-adb-snippets-open]").forEach(btn => {
          btn.addEventListener("click", () => withButtonBusy(btn, "打开中...", openAdbSnippetsConfig, "正在打开快捷命令配置..."));
        });
      });
    }

    async function pickPath(options) {
      const data = await api("/api/pick-path", { method: "POST", body: JSON.stringify(options) });
      if (!data.ok) throw new Error(data.stderr || data.error || "选择路径失败");
      return data.path || "";
    }

    function pickOptions(type) {
      if (type === "apk") return { mode: "file", title: "选择 APK 文件", filter: "Android APK (*.apk)|*.apk|所有文件 (*.*)|*.*" };
      if (type === "apk_folder") return { mode: "directory", title: "选择 APK 文件夹" };
      if (type === "file") return { mode: "file", title: "选择文件", filter: "所有文件 (*.*)|*.*" };
      if (type === "script") return { mode: "file", title: "选择脚本文件", filter: "脚本文件 (*.py;*.sh;*.bat;*.cmd)|*.py;*.sh;*.bat;*.cmd|所有文件 (*.*)|*.*" };
      if (type === "adb") return { mode: "file", title: "选择 adb 可执行文件", filter: "ADB (adb.exe;adb)|adb.exe;adb|所有文件 (*.*)|*.*" };
      return { mode: "directory", title: "选择工作目录" };
    }

    async function pickIntoStep(index, target, type) {
      syncAllStepFields();
      const current = state.steps[index][target] || "";
      const hasPathSeparator = current.includes("/") || current.includes("\\");
      const isDirectoryPick = type === "directory" || type === "apk_folder";
      const startDir = isDirectoryPick
        ? (/\.apk$/i.test(current) && hasPathSeparator ? current.replace(/[\\/][^\\/]*$/, "") : current)
        : (hasPathSeparator ? current.replace(/[\\/][^\\/]*$/, "") : "");
      const chosen = await pickPath({ ...pickOptions(type), startDir });
      if (!chosen) return;
      state.steps[index][target] = chosen;
      renderSteps();
    }

    function setRemoteUseButtonsVisible(visible) {
      $("remoteUse").style.display = visible ? "" : "none";
      $("remoteUseFooter").style.display = visible ? "" : "none";
    }

    function onlineDeviceSerials() {
      return state.devices.filter(device => device.state === "device").map(device => device.serial);
    }

    function remoteSerialOptions(preferred = "") {
      const online = onlineDeviceSerials();
      const selected = [...state.selected].filter(serial => online.includes(serial));
      const base = selected.length ? selected : online;
      const serials = preferred && online.includes(preferred)
        ? [preferred, ...base.filter(serial => serial !== preferred), ...online.filter(serial => serial !== preferred && !base.includes(serial))]
        : base;
      return [...new Set(serials)];
    }

    function resetRemoteSelection() {
      state.remoteSelectedPath = "";
      state.remoteSelectedEntry = null;
      updateRemoteSelectionUi();
    }

    function openRemotePicker(index, target) {
      syncAllStepFields();
      state.remotePicker = { mode: "pick", index, target };
      state.remoteEntries = [];
      state.remoteSearch = "";
      resetRemoteSelection();
      const serials = remoteSerialOptions();
      $("remoteTitle").textContent = "手机路径浏览";
      $("remoteSerial").innerHTML = serials.map(serial => `<option value="${attr(serial)}">${escapeHtml(deviceLabel(serial))}</option>`).join("");
      $("remotePath").value = state.steps[index][target] || "/sdcard/";
      $("remoteSearch").value = "";
      setRemoteUseButtonsVisible(true);
      $("remoteModal").classList.add("open");
      $("remoteModal").setAttribute("aria-hidden", "false");
      loadRemoteEntries();
    }

    function openRemoteBrowser(serial = "", path = "/sdcard/") {
      state.remotePicker = { mode: "browse" };
      state.remoteEntries = [];
      state.remoteSearch = "";
      resetRemoteSelection();
      const serials = remoteSerialOptions(serial);
      const preferred = serial && serials.includes(serial) ? serial : (serials[0] || "");
      $("remoteTitle").textContent = preferred ? `手机资源管理器：${deviceLabel(preferred)}` : "手机资源管理器";
      $("remoteSerial").innerHTML = serials.map(item => `<option value="${attr(item)}">${escapeHtml(deviceLabel(item))}</option>`).join("");
      if (preferred) $("remoteSerial").value = preferred;
      $("remotePath").value = path;
      $("remoteSearch").value = "";
      setRemoteUseButtonsVisible(false);
      $("remoteModal").classList.add("open");
      $("remoteModal").setAttribute("aria-hidden", "false");
      if (preferred) loadRemoteEntries();
      else {
        $("remoteCrumbs").innerHTML = "";
        $("remoteEntries").innerHTML = `<div class="empty">没有在线设备</div>`;
        $("remoteStatus").textContent = "";
      }
    }

    function closeRemotePicker() {
      $("remoteModal").classList.remove("open");
      $("remoteModal").setAttribute("aria-hidden", "true");
      const returnSerial = state.returnToDeviceActionAfterRemote;
      state.returnToDeviceActionAfterRemote = null;
      state.remotePicker = null;
      setRemoteUseButtonsVisible(true);
      resetRemoteSelection();

      // 如果是从设备操作弹窗进入资源管理器，关闭资源管理器后回到原设备操作弹窗。
      if (returnSerial) {
        setTimeout(() => openDeviceActions(returnSerial), 80);
      }
    }

    function remoteParentPath(path) {
      const cleaned = (path || "/").trim().replace(/\/+$/, "") || "/";
      if (cleaned === "/") return "/";
      return cleaned.replace(/\/[^/]*$/, "") || "/";
    }

    function renderRemoteCrumbs(path) {
      const cleaned = (path || "/").trim() || "/";
      const parts = cleaned.split("/").filter(Boolean);
      const crumbs = [`<button data-remote-crumb="/" title="/">/</button>`];
      let current = "";
      parts.forEach(part => {
        current += `/${part}`;
        crumbs.push(`<button data-remote-crumb="${attr(current)}" title="${attr(current)}">${escapeHtml(part)}</button>`);
      });
      $("remoteCrumbs").innerHTML = crumbs.join("");
      document.querySelectorAll("[data-remote-crumb]").forEach(btn => {
        btn.addEventListener("click", () => {
          $("remotePath").value = btn.dataset.remoteCrumb || "/";
          loadRemoteEntries();
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
      for (let i = 1; i < units.length && value >= 1024; i += 1) {
        value /= 1024;
        unit = units[i];
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
      if (entry) $("remoteStatus").textContent = `已选中：${entry.name}`;
    }

    function updateRemoteSelectionUi() {
      const selectedPath = state.remoteSelectedPath || "";
      document.querySelectorAll(".remote-entry").forEach(row => {
        row.classList.toggle("selected", !!selectedPath && row.dataset.path === selectedPath);
      });
      const entry = state.remoteSelectedEntry;
      if ($("remoteEnterSelected")) $("remoteEnterSelected").disabled = !remoteEntryCanEnter(entry);
      if ($("remoteOpenFile")) $("remoteOpenFile").disabled = !(entry && entry.type === "file");
      if ($("remoteCopySelected")) $("remoteCopySelected").disabled = !(entry || ($("remotePath")?.value || "").trim());
    }

    async function loadRemoteEntries() {
      const serial = $("remoteSerial").value;
      const path = $("remotePath").value.trim() || "/sdcard/";
      resetRemoteSelection();
      renderRemoteCrumbs(path);
      if (!serial) {
        $("remoteEntries").innerHTML = `<div class="empty">请先选择一台在线设备</div>`;
        $("remoteStatus").textContent = "";
        return;
      }
      $("remoteStatus").textContent = "读取中...";
      $("remoteEntries").innerHTML = `<div class="empty">读取中...</div>`;
      try {
        const data = await api("/api/remote-list", { method: "POST", body: JSON.stringify({ serial, path }) });
        $("remoteStatus").textContent = data.ok ? `${data.entries.length} 项` : (data.stderr || data.error || "读取失败");
        if (!data.ok) {
          $("remoteEntries").innerHTML = `<div class="empty">${escapeHtml(data.stderr || data.error || "读取失败")}</div>`;
          return;
        }
        $("remotePath").value = data.path || path;
        renderRemoteCrumbs($("remotePath").value);
        state.remoteEntries = data.entries || [];
        renderRemoteEntries();
      } catch (error) {
        $("remoteStatus").textContent = `读取失败：${error.message}`;
        $("remoteEntries").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    function renderRemoteEntries() {
      const keyword = ($("remoteSearch").value || "").trim().toLowerCase();
      const sort = $("remoteSort").value || "name";
      let entries = [...(state.remoteEntries || [])];
      if (keyword) {
        entries = entries.filter(entry => [entry.name, entry.path, entry.type, entry.mode, entry.owner, entry.group, entry.modified, entry.linkTarget].join(" ").toLowerCase().includes(keyword));
      }
      entries.sort((a, b) => {
        const dir = (a.type === "directory" ? 0 : 1) - (b.type === "directory" ? 0 : 1);
        if (dir) return dir;
        if (sort === "size") return (Number(b.sizeBytes ?? b.size) || 0) - (Number(a.sizeBytes ?? a.size) || 0);
        if (sort === "modified") return String(b.modified || "").localeCompare(String(a.modified || ""));
        if (sort === "type") return String(a.type || "").localeCompare(String(b.type || "")) || a.name.localeCompare(b.name, "zh-CN");
        return a.name.localeCompare(b.name, "zh-CN");
      });
      if (state.remoteSelectedPath && !entries.some(entry => entry.path === state.remoteSelectedPath)) {
        state.remoteSelectedPath = "";
        state.remoteSelectedEntry = null;
      }
      if (!entries.length) {
        $("remoteEntries").innerHTML = `<div class="empty">目录为空</div>`;
        updateRemoteSelectionUi();
        return;
      }
      $("remoteEntries").innerHTML = entries.map((entry, index) => `
        <div class="remote-entry ${state.remoteSelectedPath === entry.path ? "selected" : ""}" data-remote-index="${index}" data-path="${attr(entry.path)}" tabindex="0">
          <span class="badge ${entry.type === "directory" ? "ok" : entry.type === "symlink" ? "warn" : ""}">${remoteTypeLabel(entry)}</span>
          <span class="remote-name" title="${attr(entry.path)}">
            <span>${escapeHtml(entry.name)}</span>
            ${entry.linkTarget ? `<small>-> ${escapeHtml(entry.linkTarget)}</small>` : ""}
          </span>
          <span class="remote-meta">${escapeHtml(formatRemoteSize(entry))}</span>
          <span class="remote-meta">${escapeHtml(entry.modified || "-")}</span>
          <span class="remote-meta">${escapeHtml([entry.mode, entry.owner, entry.group].filter(Boolean).join(" "))}</span>
          <div class="remote-actions">
            ${remoteEntryCanEnter(entry)
              ? `<button data-remote-enter="${index}">进入</button>`
              : `<button data-remote-file-open="${index}">本机打开</button>`}
            ${state.remotePicker?.mode === "pick" ? `<button data-remote-select="${index}">选中</button>` : ""}
            <button data-copy-remote-path="${index}">复制</button>
          </div>
        </div>
      `).join("");
      document.querySelectorAll(".remote-entry").forEach(row => {
        row.addEventListener("click", () => selectRemoteEntry(entries[Number(row.dataset.remoteIndex)]));
        row.addEventListener("dblclick", () => {
          const entry = entries[Number(row.dataset.remoteIndex)];
          if (remoteEntryCanEnter(entry)) enterRemoteEntry(entry);
          else openRemoteFile(entry.path);
        });
        row.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          const entry = entries[Number(row.dataset.remoteIndex)];
          if (remoteEntryCanEnter(entry)) enterRemoteEntry(entry);
          else openRemoteFile(entry.path);
        });
      });
      document.querySelectorAll("[data-remote-enter]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          enterRemoteEntry(entries[Number(btn.dataset.remoteEnter)]);
        });
      });
      document.querySelectorAll("[data-remote-file-open]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          const entry = entries[Number(btn.dataset.remoteFileOpen)];
          openRemoteFile(entry?.path || "");
        });
      });
      document.querySelectorAll("[data-remote-select]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          const entry = entries[Number(btn.dataset.remoteSelect)];
          if (!entry) return;
          $("remotePath").value = entry.path;
          selectRemoteEntry(entry);
          $("remoteStatus").textContent = `已选中路径：${entry.path}`;
        });
      });
      document.querySelectorAll("[data-copy-remote-path]").forEach(btn => {
        btn.addEventListener("click", async event => {
          event.stopPropagation();
          const entry = entries[Number(btn.dataset.copyRemotePath)];
          await navigator.clipboard.writeText(entry?.path || "");
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
      loadRemoteEntries();
    }

    async function copySelectedRemotePath() {
      const path = state.remoteSelectedEntry?.path || ($("remotePath").value || "").trim();
      if (!path) return;
      await navigator.clipboard.writeText(path);
      $("remoteStatus").textContent = "路径已复制";
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

    async function openRemoteFile(path) {
      const serial = $("remoteSerial").value;
      const remotePath = (path || $("remotePath").value || "").trim();
      if (!serial) {
        $("remoteStatus").textContent = "请先选择一台在线设备";
        return;
      }
      if (!remotePath || remotePath.endsWith("/")) {
        $("remoteStatus").textContent = "请选择具体文件";
        return;
      }
      $("remoteStatus").textContent = "正在临时复制并用本机默认应用打开...";
      const data = await api("/api/remote-open", { method: "POST", body: JSON.stringify({ serial, path: remotePath }) });
      $("remoteStatus").textContent = data.ok
        ? `已打开：${data.localPath}`
        : (data.stderr || data.error || "打开失败");
      if (data.ok) $("remotePath").value = remotePath;
    }

    function useRemotePath() {
      if (!state.remotePicker || state.remotePicker.mode !== "pick") return;
      const { index, target } = state.remotePicker;
      state.steps[index][target] = $("remotePath").value.trim() || "/sdcard/";
      closeRemotePicker();
      renderSteps();
    }

    function currentActionDevice() {
      return state.devices.find(device => device.serial === state.deviceActionSerial) || { serial: state.deviceActionSerial || "" };
    }

    function openDeviceActions(serial) {
      state.deviceActionSerial = serial;
      const device = currentActionDevice();
      $("deviceActionTitle").textContent = `设备操作：${deviceLabel(serial)}`;
      $("deviceShellCommand").value = "";
      $("deviceActionStatus").textContent = "";
      if ($("deviceClipboardText")) $("deviceClipboardText").value = "";
      if ($("deviceClipboardResult")) $("deviceClipboardResult").textContent = "尚未读取";
      updateClipboardSyncButton();
      updateDeviceAgentCard({ checking: true });
      const current = $("deviceActionCurrentSerial");
      if (current) current.textContent = deviceLabel(serial);
      setDeviceOperationState("idle", "未开始", "请选择左侧操作或输入 Shell 命令后执行。");
      $("deviceActionResult").innerHTML = renderDeviceOverview(device, serial);
      $("deviceActionModal").classList.add("open");
      $("deviceActionModal").setAttribute("aria-hidden", "false");
      refreshDeviceAgentStatus();
    }

    function closeDeviceActions() {
      $("deviceActionModal").classList.remove("open");
      $("deviceActionModal").setAttribute("aria-hidden", "true");
      state.deviceActionSerial = null;
    }

    function setDeviceStatus(text) {
      $("deviceActionStatus").textContent = text || "";
    }

    function setDeviceOperationState(stateName, label, detail = "") {
      const chip = $("deviceActionOpState");
      if (chip) {
        chip.className = `operation-state ${stateName || "idle"}`;
        chip.textContent = label || "未开始";
        chip.title = detail || label || "";
      }
      setDeviceStatus(detail || label || "");
    }

    function renderDeviceOverview(device, serial) {
      return `
        <div class="operation-overview">
          <div class="operation-stage idle"><strong>未开始</strong><span>请选择一个操作。</span></div>
          <div class="device-detail-grid">
            <div class="device-kv"><span>设备</span><strong>${escapeHtml(deviceLabel(serial))}</strong></div>
            <div class="device-kv"><span>状态</span><strong>${escapeHtml(device.state || "未知")}</strong></div>
            <div class="device-kv"><span>型号</span><strong>${escapeHtml(device.model || "未知")}</strong></div>
            <div class="device-kv"><span>产品</span><strong>${escapeHtml(device.product || "未知")}</strong></div>
          </div>
        </div>`;
    }

    function operationStage(status, title, detail = "") {
      return `<div class="operation-stage ${attr(status)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
    }

    function showDeviceLoading(text) {
      setDeviceOperationState("running", "执行中", text);
      $("deviceActionResult").innerHTML = `${operationStage("running", "执行中", text)}<div class="empty">${escapeHtml(text)}</div>`;
    }

    async function deviceApi(path, payload = {}) {
      if (!state.deviceActionSerial) throw new Error("没有选择设备");
      return api(path, { method: "POST", body: JSON.stringify({ serial: state.deviceActionSerial, ...payload }) });
    }

    function updateDeviceAgentCard(data = {}) {
      const title = $("deviceAgentStatus");
      const hint = $("deviceAgentHint");
      const button = $("deviceAgentInstall");
      if (!title || !hint || !button) return;
      button.style.display = "";
      if (data.checking) {
        title.textContent = "手机端服务检测中";
        hint.textContent = "正在确认剪切板与输入增强能力是否可用。";
        button.disabled = true;
        return;
      }
      if (data.installed) {
        title.textContent = "手机端服务可用";
        hint.textContent = "可以读取/写入手机剪切板，也可以直接输入到当前焦点。";
        button.disabled = true;
        button.style.display = "none";
        return;
      }
      title.textContent = "手机端服务不可用";
      if (!data.apkConfigured) {
        hint.textContent = "未配置手机端桥接服务路径。普通用户通常无需配置；如不可用，请在设置页修复。";
        button.disabled = true;
        return;
      }
      if (!data.apkExists) {
        hint.textContent = `手机端桥接服务文件不存在：${data.apkPath || "-"}`;
        button.disabled = true;
        return;
      }
      hint.textContent = `将从已配置路径安装：${data.apkPath}`;
      button.disabled = false;
    }

    async function refreshDeviceAgentStatus() {
      if (!state.deviceActionSerial) return;
      try {
        const data = await deviceApi("/api/device/agent-status");
        updateDeviceAgentCard(data);
      } catch (error) {
        updateDeviceAgentCard({ installed: false, apkConfigured: false });
        if ($("deviceAgentHint")) $("deviceAgentHint").textContent = error.message || "手机端服务检测失败";
      }
    }

    async function installDeviceAgent() {
      if (!state.deviceActionSerial) return;
      const btn = $("deviceAgentInstall");
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "安装中...";
      showDeviceLoading("修复手机端服务...");
      try {
        const data = await deviceApi("/api/device/agent-install");
        updateDeviceAgentCard(data);
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "安装完成" : "安装失败", data.ok ? "CQClaw手机端服务可用到手机" : (data.stderr || data.error || "安装失败"));
        $("deviceActionResult").innerHTML = data.ok ? `
          ${operationStage("success", "安装完成", "CQClaw手机端服务可用到手机。")}
          ${renderCommandBlock(data.commandText || data.result?.commandText || data.stdout || "")}` :
          `${operationStage("failed", "安装失败", data.stderr || data.error || "安装失败")}${renderCommandBlock(data.commandText || data.stderr || data.error || "")}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "修复手机端服务失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
        await refreshDeviceAgentStatus();
      } finally {
        btn.textContent = oldText;
      }
    }

    function appModalSerials() {
      const online = state.devices.filter(device => device.state === "device").map(device => device.serial);
      const selected = [...state.selected].filter(serial => online.includes(serial));
      return selected.length ? selected : online;
    }

    function openAppManager(options = {}) {
      syncAllStepFields();
      state.appPicker = options.mode === "pick" ? options : { mode: "browse" };
      state.appEntries = [];
      const serials = appModalSerials();
      const preferred = options.serial || state.deviceActionSerial || [...state.selected][0] || serials[0] || "";
      $("appModalTitle").textContent = state.appPicker.mode === "pick" ? "选择 App" : "App 管理";
      $("appSerial").innerHTML = serials.map(serial => `<option value="${attr(serial)}">${escapeHtml(deviceLabel(serial))}</option>`).join("");
      if (preferred && [...$("appSerial").options].some(option => option.value === preferred)) $("appSerial").value = preferred;
      $("appSearch").value = "";
      $("appStatus").textContent = serials.length ? "正在读取缓存..." : "没有在线设备";
      $("appEntries").innerHTML = serials.length ? `<div class="empty">正在读取缓存；中文名和图标会在可视区自动补齐，也可以手动刷新。</div>` : `<div class="empty">没有在线设备</div>`;
      state.appIconQueue = [];
      state.appIconFailedUrls = new Set();
      state.appMetaQueue = [];
      state.appMetaRefreshedPackages = new Set();
      $("appModal").classList.add("open");
      $("appModal").setAttribute("aria-hidden", "false");
      if (serials.length) loadAppEntries("cached");
    }

    function closeAppManager() {
      $("appModal").classList.remove("open");
      $("appModal").setAttribute("aria-hidden", "true");
      const returnSerial = state.returnToDeviceActionAfterApp;
      state.returnToDeviceActionAfterApp = null;
      state.appPicker = null;
      if (state.appIconObserver) {
        state.appIconObserver.disconnect();
        state.appIconObserver = null;
      }
      state.appIconQueue = [];

      // 如果是从设备操作弹窗进入 App 管理，关闭 App 管理后回到原设备操作弹窗。
      if (returnSerial) {
        setTimeout(() => openDeviceActions(returnSerial), 80);
      }
    }

    function formatAppCacheStatus(cache) {
      if (!cache) return "";
      if (cache.source === "fresh") return `，缓存已更新 ${cache.updatedAt || ""}`;
      if (cache.source === "cache") {
        return cache.stale
          ? `，缓存 ${cache.updatedAt || "-"}（超过 7 天，可点刷新名称/Icon）`
          : `，缓存 ${cache.updatedAt || "-"}（7 天内有效）`;
      }
      if (cache.source === "quick") return "，无缓存：当前仅快读包名，点“刷新名称/Icon”解析中文名";
      if (cache.source === "miss") return "，无缓存";
      return "";
    }

    async function loadAppEntries(mode = "cached", options = {}) {
      const serial = $("appSerial").value;
      if (!serial) return;
      if (!state.appRefreshingPackages) state.appRefreshingPackages = new Set();
      if (!state.appMetaRefreshedPackages) state.appMetaRefreshedPackages = new Set();
      if (mode !== "cached") state.appIconFailedUrls = new Set();
      if (mode === "light") state.appMetaRefreshedPackages = new Set();
      const targetPackage = (options.targetPackage || "").trim();

      const btns = [$("appReload"), $("appLightRefresh")].filter(Boolean);
      if (mode === "single") {
        if (!targetPackage) {
          $("appStatus").textContent = "刷新失败：缺少包名";
          return;
        }
        if (state.appRefreshingPackages.has(targetPackage)) return;
        state.appRefreshingPackages.add(targetPackage);
        state.appEntries = (state.appEntries || []).map(app => app.packageName === targetPackage ? { ...app, labelSource: "pending", labelError: "" } : app);
        renderAppEntries();
      } else {
        btns.forEach(b => b.disabled = true);
      }

      const labels = {
        cached: "读取 App 缓存中...",
        light: "正在刷新名称，图标会按可视区域加载...",
        single: "正在刷新选中 App...",
      };
      const placeholders = {
        cached: state.appEntries.length ? "" : `<div class="empty">正在读取缓存；无缓存时只会快读包名。</div>`,
        light: `<div class="empty">正在刷新 App 中文名；图标会在滚动到可视区时自动更新。</div>`,
        single: `<div class="empty">正在刷新选中 App...</div>`,
      };

      $("appStatus").textContent = labels[mode] || "读取中...";
      if (state.appEntries.length === 0 || mode === "light") {
        $("appEntries").innerHTML = placeholders[mode] || placeholders.cached;
      }
      state.appForceIconRefresh = mode === "light";

      try {
        const data = await api("/api/device/apps", {
          method: "POST",
          body: JSON.stringify({
            serial,
            includeSystem: $("appIncludeSystem").checked,
            refreshMode: mode,
            targetPackage,
            resolveLabels: true,
            labelTimeout: 90,
            permissionTimeout: 30,
            skipPermissions: mode === "light",
          }),
        });

        if (mode === "single") {
          const incoming = data.apps || [];
          const incomingMap = {};
          incoming.forEach(app => { incomingMap[app.packageName] = app; });
          state.appEntries = state.appEntries.map(app => {
            const updated = incomingMap[app.packageName];
            if (!updated) return app;
            return {
              ...app,
              ...updated,
              labelError: updated.labelError || "",
              labelSource: updated.labelSource || app.labelSource || "package",
            };
          });
          if (!state.appEntries.some(app => app.packageName === targetPackage) && incomingMap[targetPackage]) {
            state.appEntries.push(incomingMap[targetPackage]);
          }
        } else {
          state.appEntries = data.apps || [];
        }

        const labelStatus = data.labelStatus || {};
        const permissionStatus = data.permissionStatus || {};
        const labelText = labelStatus.resolved ? `，名称 ${labelStatus.resolved} 个` : "";
        const labelWarn = labelStatus.failed ? `，${labelStatus.failed} 个名称未解析` : "";
        const labelSkip = labelStatus.skipped ? `，${labelStatus.skipped} 个待继续解析` : "";
        const labelCached = labelStatus.cached ? `，名称/缓存 ${labelStatus.cached} 个` : "";
        const permissionText = permissionStatus.updated ? `，权限 ${permissionStatus.updated} 个` : "";
        const permissionSkip = permissionStatus.skipped ? `，${permissionStatus.skipped} 个权限待继续解析` : "";
        const permissionCached = permissionStatus.cached ? `，权限/缓存 ${permissionStatus.cached} 个` : "";
        const prefix = mode === "single"
          ? (data.ok ? `已刷新 ${targetPackage}` : `刷新失败 ${targetPackage}`)
          : `${state.appEntries.length} 个 App`;
        $("appStatus").textContent = data.ok
          ? `${prefix}${formatAppCacheStatus(data.cache)}${permissionText}${permissionCached}${labelText}${labelCached}${labelWarn}${labelSkip}${permissionSkip}`
          : `${prefix}：${data.stderr || "读取失败"}`;
        renderAppEntries();
      } catch (error) {
        $("appStatus").textContent = mode === "single" && targetPackage ? `刷新失败 ${targetPackage}：${error.message}` : `读取失败：${error.message}`;
        if (!state.appEntries.length) {
          $("appEntries").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
        }
      } finally {
        if (mode === "single") {
          state.appRefreshingPackages.delete(targetPackage);
          state.appEntries = (state.appEntries || []).map(app => app.packageName === targetPackage && app.labelSource === "pending" ? { ...app, labelSource: "package" } : app);
          renderAppEntries();
        } else {
          btns.forEach(b => b.disabled = false);
        }
      }
    }


    function appIconFallbackText(app) {
      const name = (app.appName || app.packageName || "APP").trim();
      const ch = [...name][0] || "A";
      return ch.toUpperCase();
    }

    function appIconUrl(app, force = false) {
      const serial = $("appSerial").value || "";
      const params = new URLSearchParams({
        serial,
        package: app.packageName || "",
        includeSystem: $("appIncludeSystem").checked ? "true" : "false",
      });
      if (app.versionCode) params.set("v", app.versionCode);
      if (force) params.set("force", "true");
      return `/api/device/app-icon?${params.toString()}`;
    }

    function setupAppIconLazyLoad() {
      const nodes = [...document.querySelectorAll("[data-app-icon-img]")];
      if (!nodes.length) return;
      if (state.appIconObserver) state.appIconObserver.disconnect();
      state.appIconQueue = [];
      state.appIconActive = state.appIconActive || 0;
      state.appIconLoadedUrls = state.appIconLoadedUrls || new Set();
      state.appIconFailedUrls = state.appIconFailedUrls || new Set();
      state.appMetaQueue = state.appMetaQueue || [];
      state.appMetaRefreshingPackages = state.appMetaRefreshingPackages || new Set();
      state.appMetaRefreshedPackages = state.appMetaRefreshedPackages || new Set();
      const maxActive = 4;
      const maxMetaActive = 2;
      const pumpMeta = () => {
        state.appMetaActive = state.appMetaActive || 0;
        while (state.appMetaActive < maxMetaActive && state.appMetaQueue.length) {
          const packageName = state.appMetaQueue.shift();
          if (!packageName || state.appMetaRefreshingPackages.has(packageName)) continue;
          state.appMetaRefreshingPackages.add(packageName);
          state.appMetaActive += 1;
          refreshAppMetadataSilently(packageName)
            .catch(() => {})
            .finally(() => {
              state.appMetaRefreshingPackages.delete(packageName);
              state.appMetaActive = Math.max(0, state.appMetaActive - 1);
              pumpMeta();
            });
        }
      };
      const queueMetaRefresh = (packageName) => {
        if (!packageName) return;
        if (state.appMetaRefreshedPackages.has(packageName) || state.appMetaRefreshingPackages.has(packageName)) return;
        if (state.appMetaQueue.includes(packageName)) return;
        state.appMetaQueue.push(packageName);
        pumpMeta();
      };
      const pump = () => {
        while (state.appIconActive < maxActive && state.appIconQueue.length) {
          const img = state.appIconQueue.shift();
          if (!img || img.dataset.iconLoading === "1" || img.dataset.iconLoaded === "1") continue;
          const url = img.dataset.iconUrl;
          const shell = img.closest(".app-icon");
          if (!url || state.appIconFailedUrls.has(url)) {
            shell?.classList.add("failed");
            continue;
          }
          if (state.appIconLoadedUrls.has(url)) {
            img.src = url;
            img.dataset.iconLoaded = "1";
            shell?.classList.add("loaded");
            continue;
          }
          img.dataset.iconLoading = "1";
          state.appIconActive += 1;
          shell?.classList.add("loading");
          img.onload = () => {
            state.appIconLoadedUrls.add(url);
            img.dataset.iconLoaded = "1";
            img.dataset.iconLoading = "0";
            shell?.classList.remove("loading", "failed");
            shell?.classList.add("loaded");
            state.appIconActive = Math.max(0, state.appIconActive - 1);
            pump();
          };
          img.onerror = () => {
            state.appIconFailedUrls.add(url);
            img.dataset.iconLoading = "0";
            shell?.classList.remove("loading");
            shell?.classList.add("failed");
            state.appIconActive = Math.max(0, state.appIconActive - 1);
            pump();
          };
          img.src = url;
        }
      };
      const loadIcon = (node) => {
        if (!node || node.dataset.iconLoading === "1" || node.dataset.iconLoaded === "1") return;
        const url = node.dataset.iconUrl;
        if (!url) return;
        queueMetaRefresh(node.dataset.packageName || "");
        state.appIconQueue.push(node);
        pump();
      };
      if ("IntersectionObserver" in window) {
        const root = $("appEntries");
        state.appIconObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              loadIcon(entry.target);
              state.appIconObserver?.unobserve(entry.target);
            }
          });
        }, { root, rootMargin: "240px" });
        nodes.forEach(node => state.appIconObserver.observe(node));
      } else {
        nodes.slice(0, 40).forEach(loadIcon);
      }
    }

    async function refreshAppMetadataSilently(packageName) {
      const serial = $("appSerial")?.value || "";
      if (!serial || !packageName) return;
      const data = await api("/api/device/apps", {
        method: "POST",
        body: JSON.stringify({
          serial,
          includeSystem: $("appIncludeSystem").checked,
          refreshMode: "single",
          targetPackage: packageName,
          resolveLabels: true,
          labelTimeout: 45,
        }),
      });
      const incoming = data.apps || [];
      const updated = incoming.find(app => app.packageName === packageName);
      if (!updated) return;
      state.appMetaRefreshedPackages.add(packageName);
      state.appEntries = (state.appEntries || []).map(app => app.packageName === packageName ? { ...app, ...updated } : app);
      patchRenderedAppEntry(updated);
    }

    function labelSourceBadge(app) {
      if (app.labelSource === "pending") return `<span class="badge warn">名称刷新中</span>`;
      if (app.labelSource && app.labelSource !== "package") return `<span class="badge">名称 ${escapeHtml(app.labelSource)}</span>`;
      return "";
    }

    function patchRenderedAppEntry(app) {
      if (!app?.packageName || !window.CSS?.escape) return;
      const entry = document.querySelector(`.app-entry[data-app-package="${CSS.escape(app.packageName)}"]`);
      if (!entry) return;
      const displayName = app.appName || app.packageName;
      const nameNode = entry.querySelector("[data-app-name]");
      const letterNode = entry.querySelector("[data-app-icon-letter]");
      const iconShell = entry.querySelector(".app-icon");
      const labelNode = entry.querySelector("[data-app-label-source]");
      const errorNode = entry.querySelector("[data-app-label-error]");
      if (nameNode) nameNode.textContent = displayName;
      if (letterNode) letterNode.textContent = appIconFallbackText(app);
      if (iconShell) iconShell.title = displayName;
      if (labelNode) labelNode.innerHTML = labelSourceBadge(app);
      if (errorNode) errorNode.textContent = app.labelError ? `名称解析：${app.labelError}` : "";
    }

    function appPermissionDetails(title, values, className = "") {
      const list = [...new Set(values || [])].filter(Boolean);
      if (!list.length) return `<div class="app-permission-empty">${escapeHtml(title)}：-</div>`;
      const preview = list.slice(0, 4).join(", ");
      return `<details class="app-permission-details ${className}">
        <summary>${escapeHtml(title)}：${list.length} 项 <span>${escapeHtml(preview)}${list.length > 4 ? " ..." : ""}</span></summary>
        <div class="app-permission-list">${list.map(item => `<code>${escapeHtml(item)}</code>`).join("")}</div>
      </details>`;
    }

    function renderAppEntries() {
      const keyword = ($("appSearch").value || "").trim().toLowerCase();
      let apps = [...(state.appEntries || [])];
      if (keyword) {
        apps = apps.filter(app => [
          app.appName,
          app.labelSource,
          app.labelError,
          app.packageName,
          app.versionName,
          app.versionCode,
          app.targetSdk,
          ...(app.declaredPermissions || []),
          ...(app.runtimePermissions || []),
          ...(app.deniedRuntimePermissions || []),
          ...(app.grantablePermissions || []),
          ...(app.grantedPermissions || [])
        ].join(" ").toLowerCase().includes(keyword));
      }
      if (!apps.length) {
        $("appEntries").innerHTML = `<div class="empty">没有匹配 App</div>`;
        return;
      }
      $("appEntries").innerHTML = apps.map((app, index) => {
        const declared = app.declaredPermissions || [];
        const runtime = app.runtimePermissions || [];
        const denied = app.deniedRuntimePermissions || [];
        const granted = app.grantedPermissions || [];
        return `<div class="app-entry" data-app-package="${attr(app.packageName || "")}">
          <div class="app-identity">
            <div class="app-icon" title="${attr(app.appName || app.packageName || "")}">
              <span class="app-icon-letter" data-app-icon-letter>${escapeHtml(appIconFallbackText(app))}</span>
              <img class="app-icon-img" data-app-icon-img data-package-name="${attr(app.packageName || "")}" data-icon-url="${attr(appIconUrl(app, state.appForceIconRefresh))}" alt="" loading="lazy" decoding="async">
            </div>
            <div class="app-title">
              <strong data-app-name>${escapeHtml(app.appName || app.packageName)}</strong>
              <code>${escapeHtml(app.packageName || "")}</code>
            <div class="app-meta">
              <span class="badge">${escapeHtml(app.versionName || "-")}</span>
              <span class="badge">code ${escapeHtml(app.versionCode || "-")}</span>
              <span class="badge">target ${escapeHtml(app.targetSdk || "-")}</span>
              ${app.system ? `<span class="badge">系统</span>` : `<span class="badge ok">用户</span>`}
              ${app.disabled ? `<span class="badge fail">禁用</span>` : ""}
              <span data-app-label-source>${labelSourceBadge(app)}</span>
            </div>
            <span class="muted tiny">${escapeHtml(app.installPath || "")}</span>
            <span class="muted tiny" data-app-label-error>${app.labelError ? `名称解析：${escapeHtml(app.labelError)}` : ""}</span>
              <span class="muted tiny">首次安装：${escapeHtml(app.firstInstallTime || "-")}　更新：${escapeHtml(app.lastUpdateTime || "-")}</span>
            </div>
          </div>
          <div class="app-permissions">
            ${appPermissionDetails("声明权限", declared)}
            ${appPermissionDetails("权限页可见", runtime, "runtime")}
            ${appPermissionDetails("未授权", denied, denied.length ? "warn" : "")}
            ${appPermissionDetails("已授权", granted, "granted")}
          </div>
          <div class="remote-actions">
            ${state.appPicker?.mode === "pick" ? `<button class="primary" data-use-app="${index}">使用包名</button>` : ""}
            <button data-copy-app="${index}">复制包名</button>
            <button data-refresh-app="${index}" ${state.appRefreshingPackages?.has(app.packageName) ? "disabled" : ""}>${state.appRefreshingPackages?.has(app.packageName) ? "刷新中..." : "刷新名称"}</button>
          </div>
        </div>`;
      }).join("");
      setupAppIconLazyLoad();
      document.querySelectorAll("[data-use-app]").forEach(btn => {
        btn.addEventListener("click", () => useAppPackage(apps[Number(btn.dataset.useApp)]?.packageName || ""));
      });
      document.querySelectorAll("[data-copy-app]").forEach(btn => {
        btn.addEventListener("click", async () => {
          await navigator.clipboard.writeText(apps[Number(btn.dataset.copyApp)]?.packageName || "");
          $("appStatus").textContent = "包名已复制";
        });
      });
      document.querySelectorAll("[data-refresh-app]").forEach(btn => {
        btn.addEventListener("click", () => {
          const app = apps[Number(btn.dataset.refreshApp)];
          if (!app) return;
          loadAppEntries("single", { targetPackage: app.packageName });
        });
      });
    }

    function useAppPackage(packageName) {
      if (!packageName || !state.appPicker || state.appPicker.mode !== "pick") return;
      const { index, target } = state.appPicker;
      state.steps[index][target] = packageName;
      closeAppManager();
      renderSteps();
    }

    function openDeviceFileManager() {
      const serial = state.deviceActionSerial;
      if (!serial) return;
      // 从设备操作弹窗进入手机资源管理器时，记录返回上下文。
      state.returnToDeviceActionAfterRemote = serial;
      closeDeviceActions();
      openRemoteBrowser(serial);
    }

    function openDeviceAppManager() {
      const serial = state.deviceActionSerial;
      if (!serial) return;
      // 从设备操作弹窗进入 App 管理时，记录返回上下文。
      state.returnToDeviceActionAfterApp = serial;
      closeDeviceActions();
      openAppManager({ mode: "browse", serial, fromDeviceAction: true });
    }

    function renderCommandBlock(command) {
      return `<div class="preview-command">${escapeHtml(command)}</div>`;
    }

    function kv(label, value) {
      return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
    }

    async function showTopActivity() {
      showDeviceLoading("读取顶部 Activity...");
      try {
        const data = await deviceApi("/api/device/top-activity");
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "成功" : "失败", data.ok ? "顶部 Activity 读取完成" : "未解析到 Activity");
        $("deviceActionResult").innerHTML = `
          <div class="detail-grid">
            ${kv("包名", data.package)}
            ${kv("Activity", data.activity)}
            ${kv("组件", data.component)}
            ${kv("来源", data.sourceLine)}
          </div>
          ${renderCommandBlock(data.raw || data.stderr || data.error || "")}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "读取失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    async function showDeviceDetails() {
      showDeviceLoading("读取设备详情...");
      try {
        const data = await deviceApi("/api/device/details");
        const props = data.props || {};
        const screen = data.screen || {};
        const battery = data.battery || {};
        const network = data.network || {};
        const storage = data.storage || {};
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "成功" : "部分失败", data.ok ? "设备详情读取完成" : "部分信息读取失败");
        $("deviceActionResult").innerHTML = `
          <div class="detail-grid">
            ${kv("品牌", props["ro.product.brand"] || props["ro.product.manufacturer"])}
            ${kv("型号", props["ro.product.model"])}
            ${kv("Android", props["ro.build.version.release"] ? `${props["ro.build.version.release"]} / SDK ${props["ro.build.version.sdk"] || "-"}` : "")}
            ${kv("安全补丁", props["ro.build.version.security_patch"])}
            ${kv("CPU ABI", props["ro.product.cpu.abi"])}
            ${kv("屏幕", [screen.size, screen.density ? `${screen.density} dpi` : ""].filter(Boolean).join(" / "))}
            ${kv("电量", battery.level ? `${battery.level}%` : "")}
            ${kv("温度", battery.temperature ? `${Number(battery.temperature) / 10}°C` : "")}
            ${kv("WLAN IP", network.wlan0)}
            ${kv("存储", storage.size ? `${storage.used || "-"} / ${storage.size} (${storage.use || storage["use%"] || "-"})` : storage.raw)}
          </div>
          ${renderCommandBlock([
            data.raw?.battery ? `Battery:\n${data.raw.battery.trim()}` : "",
            data.raw?.network ? `Network:\n${data.raw.network.trim()}` : "",
            data.raw?.storage ? `Storage:\n${data.raw.storage.trim()}` : ""
          ].filter(Boolean).join("\n\n"))}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "读取失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }


    let screenshotViewerScale = 1;
    let screenshotViewerMode = "fit";
    let screenshotViewerSrc = "";

    function updateScreenshotViewerTransform() {
      const img = $("screenshotFullscreenImage");
      const label = $("screenshotZoomLabel");
      if (!img) return;

      if (screenshotViewerMode === "fit") {
        img.classList.add("fit");
        img.style.width = "";
        img.style.height = "";
        img.style.maxWidth = "100%";
        img.style.maxHeight = "100%";
        img.style.transform = "";
        if (label) label.textContent = "适应";
        return;
      }

      img.classList.remove("fit");
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
      img.style.width = `${Math.max(10, Math.round(img.naturalWidth * screenshotViewerScale))}px`;
      img.style.height = "auto";
      img.style.transform = "";
      if (label) label.textContent = `${Math.round(screenshotViewerScale * 100)}%`;
    }

    function openScreenshotViewer(src, savePath = "") {
      screenshotViewerSrc = src || "";
      screenshotViewerMode = "fit";
      screenshotViewerScale = 1;

      $("screenshotFullscreenImage").src = screenshotViewerSrc;
      $("screenshotViewerPath").textContent = savePath || "未返回保存路径";
      $("screenshotOpenImage").disabled = !screenshotViewerSrc;
      $("screenshotFullscreenModal").classList.add("open");
      $("screenshotFullscreenModal").setAttribute("aria-hidden", "false");

      setTimeout(updateScreenshotViewerTransform, 30);
    }

    function bindScreenshotFullscreenButtons() {
      document.querySelectorAll("[data-screenshot-fullscreen]").forEach(btn => {
        btn.addEventListener("click", () => {
          openScreenshotViewer(btn.dataset.screenshotFullscreen || "", btn.dataset.screenshotPath || "");
        });
      });
    }

    function closeScreenshotFullscreen() {
      $("screenshotFullscreenModal").classList.remove("open");
      $("screenshotFullscreenModal").setAttribute("aria-hidden", "true");
      $("screenshotFullscreenImage").src = "";
      screenshotViewerSrc = "";
    }

    function zoomScreenshotViewer(delta) {
      screenshotViewerMode = "zoom";
      screenshotViewerScale = Math.min(4, Math.max(0.2, screenshotViewerScale + delta));
      updateScreenshotViewerTransform();
    }

    function fitScreenshotViewer() {
      screenshotViewerMode = "fit";
      updateScreenshotViewerTransform();
    }

    function actualScreenshotViewer() {
      screenshotViewerMode = "zoom";
      screenshotViewerScale = 1;
      updateScreenshotViewerTransform();
    }

    async function captureDeviceScreenshot() {
      showDeviceLoading("截图中...");
      try {
        const data = await deviceApi("/api/device/screenshot");
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "成功" : "失败", data.ok ? "截图完成" : "截图失败");
        const savePath = data.path || data.localPath || "";
        $("deviceActionResult").innerHTML = data.ok ? `
          <div class="screenshot-result-card">
            <div class="screenshot-preview-wrap">
              <div class="phone-preview-frame">
                <img class="screenshot-preview" src="${attr(data.imageData)}" alt="设备截图">
              </div>
              <button class="screenshot-fullscreen-btn" data-screenshot-fullscreen="${attr(data.imageData)}" data-screenshot-path="${attr(savePath)}">全屏清晰查看</button>
            </div>
            <div class="screenshot-save-card">
              <div>
                <div class="screenshot-save-label">截图已保存到本机</div>
                <div class="screenshot-save-path" title="${attr(savePath)}">${escapeHtml(savePath || "未返回保存路径")}</div>
              </div>
              <button data-copy-text="${attr(savePath)}" ${savePath ? "" : "disabled"}>复制路径</button>
            </div>
          </div>` : `<div class="empty">${escapeHtml(data.stderr || "截图失败")}</div>`;
        bindCopyButtons();
        bindScreenshotFullscreenButtons();
      } catch (error) {
        setDeviceOperationState("failed", "失败", "截图失败");
        $("deviceActionResult").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    async function runDeviceShell() {
      const command = $("deviceShellCommand").value.trim();
      if (!command) {
        setDeviceOperationState("failed", "失败", "请输入 Shell 命令");
        return;
      }
      showDeviceLoading("执行 Shell...");
      try {
        const data = await deviceApi("/api/device/shell", { command });
        const result = data.result || {};
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "成功" : "失败", data.ok ? "Shell 执行完成" : "Shell 执行失败");
        $("deviceActionResult").innerHTML = `
          <div class="detail-grid">
            ${kv("退出码", result.code ?? "n/a")}
            ${kv("耗时", `${result.durationMs || 0}ms`)}
          </div>
          ${renderCommandBlock(`$ adb -s ${state.deviceActionSerial} shell ${command}\n\n${result.stdout || ""}${result.stderr ? "\n[stderr]\n" + result.stderr : ""}`)}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "执行失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    function renderClipboardResultText(text) {
      const value = text == null ? "" : String(text);
      return value || "剪切板为空";
    }

    function updateDeviceClipboardOutput(text, writeBack = false) {
      const output = $("deviceClipboardResult");
      const value = text == null ? "" : String(text);
      state.deviceClipboard.lastText = value;
      if (output) output.textContent = renderClipboardResultText(value);
      if (writeBack && $("deviceClipboardText")) $("deviceClipboardText").value = text == null ? "" : String(text);
    }

    function clipboardTextHash(text) {
      const value = String(text || "");
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return `${value.length}:${hash}`;
    }

    function updateClipboardSyncButton() {
      const btn = $("deviceClipboardSync");
      if (!btn) return;
      const runningHere = state.deviceClipboard.syncRunning && state.deviceClipboard.syncSerial === state.deviceActionSerial;
      btn.textContent = runningHere ? "停止同步" : "开启同步";
      btn.classList.toggle("danger", runningHere);
      btn.classList.toggle("primary", !runningHere);
    }

    async function copyDeviceClipboardToComputer() {
      const text = state.deviceClipboard.lastText || $("deviceClipboardText")?.value || "";
      try {
        await navigator.clipboard.writeText(text);
        state.deviceClipboard.lastComputerText = text;
        setDeviceOperationState("success", "已复制", `已复制 ${text.length} 个字符到电脑剪切板`);
      } catch (error) {
        setDeviceOperationState("failed", "复制失败", error.message || "浏览器拒绝访问电脑剪切板");
      }
    }

    async function readDeviceClipboard() {
      showDeviceLoading("读取手机剪切板...");
      updateDeviceClipboardOutput("读取中...");
      try {
        const data = await deviceApi("/api/device/clipboard", { operation: "read" });
        const text = data.text || "";
        state.deviceClipboard.lastPhoneText = text;
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "读取完成" : "读取失败", data.ok ? `已读取 ${data.length || 0} 个字符` : "读取手机剪切板失败");
        if (data.ok) updateDeviceClipboardOutput(text, true);
        else updateDeviceClipboardOutput(data.stderr || data.error || "读取失败");
        $("deviceActionResult").innerHTML = data.ok ? `
          ${operationStage("success", "读取完成", `手机剪切板 ${data.length || 0} 个字符`)}
          <div class="device-clipboard-result-card">
            <div class="device-clipboard-result-title">手机剪切板内容</div>
            <pre>${escapeHtml(renderClipboardResultText(text))}</pre>
          </div>
          ${renderCommandBlock(data.result?.commandText || data.result?.stdout || "")}` :
          `${operationStage("failed", "读取失败", data.stderr || data.error || "读取失败")}${renderCommandBlock(data.result?.commandText || data.stderr || data.error || "")}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "读取手机剪切板失败");
        updateDeviceClipboardOutput(error.message || "读取失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    async function writeDeviceClipboard() {
      const text = $("deviceClipboardText").value;
      showDeviceLoading("写入手机剪切板...");
      try {
        const data = await deviceApi("/api/device/clipboard", { operation: "write", text });
        if (data.ok) state.deviceClipboard.lastPhoneText = text;
        setDeviceOperationState(data.ok ? "success" : "failed", data.ok ? "写入完成" : "写入失败", data.ok ? `已写入 ${data.length || 0} 个字符并完成校验` : "写入手机剪切板失败");
        if (data.ok) updateDeviceClipboardOutput(text);
        else updateDeviceClipboardOutput(data.stderr || data.error || "写入失败");
        $("deviceActionResult").innerHTML = data.ok ? `
          ${operationStage("success", "写入完成", `已写入 ${data.length || 0} 个字符，并读取校验通过。`)}
          <div class="device-clipboard-result-card">
            <div class="device-clipboard-result-title">写入内容</div>
            <pre>${escapeHtml(renderClipboardResultText(text))}</pre>
          </div>
          ${renderCommandBlock(data.result?.commandText || data.result?.stdout || "")}` :
          `${operationStage("failed", "写入失败", data.stderr || data.error || "写入失败")}${renderCommandBlock(data.result?.commandText || data.stderr || data.error || "")}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", "写入手机剪切板失败");
        updateDeviceClipboardOutput(error.message || "写入失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "失败", error.message)}<div class="empty">${escapeHtml(error.message)}</div>`;
      }
    }

    async function clipboardSyncTick() {
      const sync = state.deviceClipboard;
      if (!sync.syncRunning || sync.busy || !sync.syncSerial) return;
      sync.busy = true;
      try {
        const payload = { serial: sync.syncSerial, operation: "read", timeout: 10, manageIme: false };
        const phoneData = await api("/api/device/clipboard", { method: "POST", body: JSON.stringify(payload) });
        if (phoneData.ok) {
          const phoneText = phoneData.text || "";
          const phoneHash = clipboardTextHash(phoneText);
          if (phoneText && phoneHash !== clipboardTextHash(sync.lastPhoneText) && phoneHash !== clipboardTextHash(sync.lastComputerText)) {
            await navigator.clipboard.writeText(phoneText);
            sync.lastPhoneText = phoneText;
            sync.lastComputerText = phoneText;
            updateDeviceClipboardOutput(phoneText, state.deviceActionSerial === sync.syncSerial);
            setDeviceOperationState("success", "同步中", `手机 -> 电脑：${phoneText.length} 个字符`);
          }
        }

        let computerText = "";
        try {
          computerText = await navigator.clipboard.readText();
        } catch (error) {
          throw new Error(`浏览器读取电脑剪切板失败：${error.message}`);
        }
        const computerHash = clipboardTextHash(computerText);
        if (computerText && computerHash !== clipboardTextHash(sync.lastComputerText) && computerHash !== clipboardTextHash(sync.lastPhoneText)) {
          const writeData = await api("/api/device/clipboard", {
            method: "POST",
            body: JSON.stringify({ serial: sync.syncSerial, operation: "write", text: computerText, timeout: 10, manageIme: false })
          });
          if (!writeData.ok) throw new Error(writeData.stderr || writeData.error || "写入手机剪切板失败");
          sync.lastComputerText = computerText;
          sync.lastPhoneText = computerText;
          updateDeviceClipboardOutput(computerText, state.deviceActionSerial === sync.syncSerial);
          setDeviceOperationState("success", "同步中", `电脑 -> 手机：${computerText.length} 个字符`);
        }
        sync.ticks += 1;
      } catch (error) {
        stopClipboardSync(false);
        setDeviceOperationState("failed", "同步停止", error.message || "剪切板同步失败");
        $("deviceActionResult").innerHTML = `${operationStage("failed", "同步停止", error.message || "剪切板同步失败")}<div class="empty">${escapeHtml(error.message || "剪切板同步失败")}</div>`;
      } finally {
        sync.busy = false;
      }
    }

    async function startClipboardSync() {
      const serial = state.deviceActionSerial;
      if (!serial) return;
      stopClipboardSync(false);
      let computerText = "";
      try {
        computerText = await navigator.clipboard.readText();
      } catch (error) {
        setDeviceOperationState("failed", "启动失败", `浏览器读取电脑剪切板失败：${error.message}`);
        return;
      }
      state.deviceClipboard.syncRunning = true;
      state.deviceClipboard.syncSerial = serial;
      state.deviceClipboard.lastComputerText = computerText || "";
      state.deviceClipboard.lastPhoneText = "";
      state.deviceClipboard.ticks = 0;
      updateClipboardSyncButton();
      setDeviceOperationState("running", "同步中", "正在同步手机和电脑剪切板。");
      $("deviceActionResult").innerHTML = `${operationStage("running", "同步中", "手机和电脑剪切板会双向同步；再次点击可停止。")}`;
      await clipboardSyncTick();
      state.deviceClipboard.syncTimer = setInterval(clipboardSyncTick, 1500);
    }

    function stopClipboardSync(showStatus = true) {
      const sync = state.deviceClipboard;
      if (sync.syncTimer) clearInterval(sync.syncTimer);
      sync.syncTimer = null;
      sync.syncRunning = false;
      sync.syncSerial = "";
      sync.busy = false;
      updateClipboardSyncButton();
      if (showStatus) setDeviceOperationState("idle", "已停止", "剪切板同步已停止。");
    }

    async function toggleClipboardSync() {
      const runningHere = state.deviceClipboard.syncRunning && state.deviceClipboard.syncSerial === state.deviceActionSerial;
      if (runningHere) {
        stopClipboardSync(true);
        return;
      }
      await startClipboardSync();
    }

    async function copyDeviceText(type) {
      const serial = state.deviceActionSerial;
      if (!serial) return;
      const adbPath = $("adbPath").value.trim() || state.settings.adbPath || "adb";
      const text = type === "prefix" ? `${adbPath} -s ${serial}` : serial;
      try {
        await navigator.clipboard.writeText(text);
        setDeviceOperationState("success", "成功", type === "prefix" ? "已复制 adb 前缀" : "已复制序列号");
        $("deviceActionResult").innerHTML = `${operationStage("success", "成功", type === "prefix" ? "已复制 adb 前缀" : "已复制序列号")} ${renderCommandBlock(text)}`;
      } catch (error) {
        setDeviceOperationState("failed", "失败", `复制失败：${error.message}`);
      }
    }

    function bindCopyButtons() {
      document.querySelectorAll("[data-copy-text]").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(btn.dataset.copyText || "");
            setDeviceOperationState("success", "成功", "已复制");
          } catch (error) {
            setDeviceOperationState("failed", "失败", `复制失败：${error.message}`);
          }
        });
      });
    }

    function insertIntoField(field, text) {
      if (!field) return 0;
      field.focus();
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
      const cursor = start + text.length;
      field.setSelectionRange?.(cursor, cursor);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      state.activeField = field;
      return cursor;
    }

    function insertVariable(token) {
      let field = state.activeField;
      if (!field || !document.body.contains(field)) {
        field = document.querySelector("#steps input[data-field]:not([type='checkbox']):not([type='number']), #steps textarea[data-field]");
      }
      insertIntoField(field, token);
    }

    function adbSnippetByRef(ref) {
      const [groupIndex, itemIndex] = String(ref || "").split(":").map(Number);
      return state.adbSnippets?.groups?.[groupIndex]?.items?.[itemIndex] || null;
    }

    function insertAdbSnippet(index, ref) {
      const snippet = adbSnippetByRef(ref);
      const card = document.querySelector(`[data-step="${index}"]`);
      const field = card?.querySelector('textarea[data-field="commands"]');
      if (!snippet || !field) return;
      syncAllStepFields();
      const before = field.value.slice(0, field.selectionStart ?? field.value.length);
      const prefix = before && !before.endsWith("\n") ? "\n" : "";
      const text = `${prefix}${snippet.text.replace(/\s+$/, "")}\n`;
      const cursor = insertIntoField(field, text);
      Object.assign(state.steps[index], snippet.patch || {});
      state.steps[index].commands = field.value;
      renderSteps();
      const nextField = document.querySelector(`[data-step="${index}"] textarea[data-field="commands"]`);
      if (nextField) {
        nextField.focus();
        nextField.setSelectionRange?.(cursor, cursor);
        state.activeField = nextField;
      }
    }

    async function refreshDevices() {
      $("refreshDevices").disabled = true;
      try {
        const data = await api("/api/devices");
        state.devices = data.devices;
        const serials = new Set(state.devices.map(d => d.serial));
        state.selected = new Set([...state.selected].filter(serial => serials.has(serial)));
        renderDevices();
        if (!data.ok) writeLog(formatResult({ steps: [{ name: "adb devices -l", ok: false, results: [data.result] }] }));
      } finally {
        $("refreshDevices").disabled = false;
      }
    }

    async function loadProfiles() {
      const data = await api("/api/profiles");
      state.profiles = data.profiles || [];
      renderProfiles();
    }

    async function loadSettings() {
      const data = await api("/api/settings");
      state.enterprise = data.enterprise || {};
      state.effectiveAgentApkPath = data.effectiveAgentApkPath || "";
      state.settings = { adbPath: "adb", quickOutputDir: "", localTempDir: "", agentApkPath: "", deviceAliases: {}, deviceGroups: {}, ...(data.settings || {}) };
      $("adbPath").value = state.settings.adbPath || "adb";
      $("quickOutputDir").value = state.settings.quickOutputDir || "";
      $("localTempDir").value = state.settings.localTempDir || "";
      $("agentApkPath").value = state.settings.agentApkPath || "";
      $("agentApkPath").placeholder = state.effectiveAgentApkPath ? `企业默认：${state.effectiveAgentApkPath}` : "可留空使用默认配置；仅企业分发时需要自定义";
      renderGroupOptions();
      renderSteps();
    }

    async function loadAdbSnippets(showStatus = false) {
      const data = await api("/api/adb-snippets");
      state.adbSnippets = data.config || { groups: [] };
      state.adbSnippetsPath = data.path || "";
      renderSteps();
      if (!data.ok) {
        setWorkflowStatus(data.error || "ADB 快捷命令配置读取失败");
        return;
      }
      if (showStatus) setWorkflowStatus("ADB 快捷命令已重新加载");
    }

    async function openAdbSnippetsConfig() {
      const data = await api("/api/adb-snippets/open", { method: "POST", body: JSON.stringify({}) });
      if (!data.ok) throw new Error(data.stderr || data.error || "打开配置失败");
      setWorkflowStatus(`已打开配置：${data.path}`);
    }

    async function saveSettings(options = { refreshDevices: true }) {
      state.settings.adbPath = $("adbPath").value.trim() || "adb";
      state.settings.quickOutputDir = $("quickOutputDir").value.trim();
      state.settings.localTempDir = $("localTempDir").value.trim();
      state.settings.agentApkPath = $("agentApkPath").value.trim();
      const data = await api("/api/settings", { method: "POST", body: JSON.stringify({ settings: state.settings }) });
      state.enterprise = data.enterprise || state.enterprise || {};
      state.effectiveAgentApkPath = data.effectiveAgentApkPath || "";
      state.settings = { adbPath: "adb", quickOutputDir: "", localTempDir: "", agentApkPath: "", deviceAliases: {}, deviceGroups: {}, ...(data.settings || state.settings) };
      $("adbPath").value = state.settings.adbPath || "adb";
      $("quickOutputDir").value = state.settings.quickOutputDir || "";
      $("localTempDir").value = state.settings.localTempDir || "";
      $("agentApkPath").value = state.settings.agentApkPath || "";
      $("agentApkPath").placeholder = state.effectiveAgentApkPath ? `企业默认：${state.effectiveAgentApkPath}` : "可留空使用默认配置；仅企业分发时需要自定义";
      renderSteps();
      if (options.refreshDevices) await refreshDevices();
    }

    async function saveDeviceMeta() {
      document.querySelectorAll("[data-alias]").forEach(input => {
        state.settings.deviceAliases ||= {};
        state.settings.deviceAliases[input.dataset.alias] = input.value.trim();
      });
      document.querySelectorAll("[data-groups]").forEach(input => {
        state.settings.deviceGroups ||= {};
        state.settings.deviceGroups[input.dataset.groups] = input.value.trim();
      });
      await saveSettings({ refreshDevices: false });
      renderDevices();
    }

    function selectCurrentGroup() {
      const group = $("groupSelect").value;
      if (!group) return;
      state.selected = new Set(state.devices
        .filter(device => device.state === "device")
        .filter(device => String(deviceGroups(device.serial)).split(",").map(item => item.trim()).includes(group))
        .map(device => device.serial));
      renderDevices();
    }

    async function pickAdbPath() {
      const chosen = await pickPath({ ...pickOptions("adb"), startDir: $("adbPath").value.replace(/[\\/][^\\/]*$/, "") });
      if (!chosen) return;
      $("adbPath").value = chosen;
      await saveSettings();
    }

    async function pickSettingsDirectory(inputId, title) {
      const current = $(inputId).value.trim();
      const chosen = await pickPath({ mode: "directory", title, startDir: current });
      if (!chosen) return;
      $(inputId).value = chosen;
      await saveSettings({ refreshDevices: false });
    }

    async function pickAgentApkPath() {
      const current = $("agentApkPath").value.trim() || state.effectiveAgentApkPath || "";
      const startDir = current.replace(/[\\/][^\\/]*$/, "");
      const chosen = await pickPath({ ...pickOptions("apk"), title: "选择手机端桥接服务包", startDir });
      if (!chosen) return;
      $("agentApkPath").value = chosen;
      await saveSettings({ refreshDevices: false });
    }

    async function saveProfiles() {
      await api("/api/profiles", { method: "POST", body: JSON.stringify({ profiles: state.profiles }) });
    }

    function workflowPayload() {
      syncAllStepFields();
      return {
        type: "cqclaw-workflow",
        version: 1,
        name: $("profileName").value.trim() || "未命名编排",
        exportedAt: new Date().toISOString(),
        stopOnError: $("stopOnError").checked,
        steps: structuredClone(state.steps)
      };
    }

    function workflowFileName(name) {
      const base = String(name || "workflow").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "workflow";
      return `${base}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;
    }

    function setWorkflowStatus(text) {
      $("workflowStatus").textContent = text;
      if (!text) return;
      setTimeout(() => {
        if ($("workflowStatus").textContent === text) $("workflowStatus").textContent = "";
      }, 3500);
    }

    async function withButtonBusy(button, busyText, task, statusText = "等待系统选择窗口...") {
      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
      setWorkflowStatus(statusText);
      try {
        await task();
      } catch (error) {
        setWorkflowStatus(`选择失败：${error.message}`);
      } finally {
        button.disabled = false;
        button.textContent = previousText;
      }
    }

    function exportWorkflow() {
      const payload = workflowPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = workflowFileName(payload.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setWorkflowStatus(`已导出 ${payload.steps.length} 个动作`);
    }

    function normalizeWorkflowPayload(payload) {
      if (Array.isArray(payload)) {
        return { name: "导入的编排", stopOnError: $("stopOnError").checked, steps: payload };
      }
      if (!payload || typeof payload !== "object") {
        throw new Error("文件内容不是有效的编排 JSON");
      }
      const steps = payload.steps || payload.workflow?.steps;
      if (!Array.isArray(steps)) {
        throw new Error("没有找到 steps 动作列表");
      }
      const unknown = steps.find(step => !step || !templates[step.kind]);
      if (unknown) {
        throw new Error(`包含不支持的动作类型：${unknown.kind || "未知"}`);
      }
      return {
        name: payload.name || payload.workflow?.name || "导入的编排",
        stopOnError: typeof payload.stopOnError === "boolean" ? payload.stopOnError : $("stopOnError").checked,
        steps
      };
    }

    function triggerImportWorkflow() {
      if (state.steps.length && !window.confirm("导入会替换当前动作编排，继续吗？")) return;
      $("workflowImportFile").value = "";
      $("workflowImportFile").click();
    }

    async function importWorkflowFile(file) {
      if (!file) return;
      try {
        const workflow = normalizeWorkflowPayload(JSON.parse(await file.text()));
        state.steps = structuredClone(workflow.steps);
        $("profileName").value = workflow.name || "";
        $("stopOnError").checked = workflow.stopOnError;
        renderSteps();
        setWorkflowStatus(`已导入 ${state.steps.length} 个动作`);
      } catch (error) {
        setWorkflowStatus("导入失败");
        writeLog(`导入编排失败：${error.message}`);
      }
    }


    function onlineDevices() {
      return state.devices.filter(device => device.state === "device");
    }

    function selectedDevices() {
      return [...state.selected].filter(serial => onlineDevices().some(device => device.serial === serial));
    }

    function updateFlowGuide() {
      const guideSteps = [...document.querySelectorAll(".flow-guide .flow-step")];
      if (!guideSteps.length) return;
      const hasDevice = selectedDevices().length > 0;
      const hasAction = state.steps.length > 0;
      const stage = hasDevice ? (hasAction ? 2 : 1) : 0;
      guideSteps.forEach((node, index) => {
        node.classList.toggle("active", index <= stage);
        node.classList.toggle("current", index === stage);
        node.classList.toggle("pending", index > stage);
      });
    }

    function showDefaultDeviceConfirm() {
      const first = onlineDevices()[0];
      if (!first) return Promise.resolve([]);

      $("defaultDeviceName").textContent = deviceLabel(first.serial);
      $("defaultDeviceMeta").textContent = [
        first.serial,
        first.model || first.product || "",
        first.transport ? `transport ${first.transport}` : ""
      ].filter(Boolean).join(" · ");
      $("defaultDeviceStatus").textContent = "";

      $("defaultDeviceModal").classList.add("open");
      $("defaultDeviceModal").setAttribute("aria-hidden", "false");

      return new Promise(resolve => {
        const cleanup = result => {
          $("defaultDeviceModal").classList.remove("open");
          $("defaultDeviceModal").setAttribute("aria-hidden", "true");
          $("defaultDeviceConfirm").onclick = null;
          $("defaultDeviceCancel").onclick = null;
          $("defaultDeviceCancelTop").onclick = null;
          resolve(result);
        };

        $("defaultDeviceConfirm").onclick = () => {
          state.selected.clear();
          state.selected.add(first.serial);
          renderDevices();
          cleanup([first.serial]);
        };
        $("defaultDeviceCancel").onclick = () => cleanup([]);
        $("defaultDeviceCancelTop").onclick = () => cleanup([]);
      });
    }

    async function devicesForExecution() {
      const selected = selectedDevices();
      if (selected.length) return selected;

      const online = onlineDevices();
      if (!online.length) return [];

      return await showDefaultDeviceConfirm();
    }


    function enabledStepsForRun() {
      return state.steps.filter(step => step?.enabled !== false);
    }

    function enabledStepValidationIssues() {
      return state.steps
        .map((step, index) => ({ step, index, validation: validateStepForRun(step) }))
        .filter(item => item.step?.enabled !== false && !item.validation.ok);
    }

    function executionReadiness() {
      const enabledSteps = enabledStepsForRun();
      const invalid = enabledStepValidationIssues();
      if (!state.steps.length) {
        return { ok: false, blocked: true, invalid, enabledSteps, message: "还没有添加节点", detail: "请先从左侧动作库添加至少一个节点。" };
      }
      if (!enabledSteps.length) {
        return { ok: false, blocked: true, invalid, enabledSteps, message: "没有启用节点", detail: "停用节点会被视为用户暂不使用，不参与预览和执行；请至少启用一个节点。" };
      }
      if (invalid.length) {
        const first = invalid[0];
        return {
          ok: false,
          blocked: true,
          invalid,
          enabledSteps,
          message: `${invalid.length} 个启用节点未配置`,
          detail: `第 ${first.index + 1} 个节点「${first.step.name || kindLabel(first.step.kind)}」：${first.validation.messages.join("；")}。停用的未配置节点不会阻止整个工作流。`
        };
      }
      return { ok: true, blocked: false, invalid, enabledSteps, message: "可以执行", detail: `将执行 ${enabledSteps.length} 个启用节点；停用节点会自动跳过。` };
    }

    function updateRunControls() {
      const readiness = executionReadiness();
      const runAll = $("runAll");
      const previewRun = $("previewRun");
      const previewRunNow = $("previewRunNow");
      const reason = readiness.ok ? "执行当前方案" : `${readiness.message}：${readiness.detail}`;

      [runAll, previewRunNow].filter(Boolean).forEach(button => {
        button.classList.toggle("run-blocked", !readiness.ok);
        button.setAttribute("aria-disabled", readiness.ok ? "false" : "true");
        button.title = reason;
      });

      if (previewRun) {
        previewRun.classList.remove("run-needs-attention", "run-blocked");
        previewRun.setAttribute("aria-disabled", "false");
        previewRun.title = "预览当前方案（停用节点会自动跳过，不会阻止预览）";
      }

      return readiness;
    }

    function explainBlockedExecution(readiness = executionReadiness()) {
      if (readiness.ok) return false;
      if (readiness.invalid?.length) {
        const lines = readiness.invalid.map(item => `#${item.index + 1} ${item.step.name || kindLabel(item.step.kind)}：${item.validation.messages.join("；")}`);
        state.activeStep = readiness.invalid[0].index;
        renderSteps();
        renderRunSummary(null);
        setWorkflowStatus(readiness.message);
        writeLog(`执行方案已阻止：${readiness.message}。\n${lines.join("\n")}\n请先补齐上面标记的节点配置，或停用这些节点。`);
      } else {
        renderRunSummary(null);
        setWorkflowStatus(readiness.message);
        writeLog(`执行方案已阻止：${readiness.detail}`);
      }
      return true;
    }

    async function runAll() {
      syncAllStepFields();
      const readiness = updateRunControls();
      if (explainBlockedExecution(readiness)) return;
      const devices = await devicesForExecution();
      if (!devices.length) {
        writeLog("未选择设备，已取消执行。");
        return;
      }
      const payload = {
        devices,
        steps: enabledStepsForRun(),
        stopOnError: $("stopOnError").checked
      };
      $("runAll").disabled = true;
      writeLog(`执行中，目标设备：${devices.map(deviceLabel).join("、")}\n`);
      try {
        const run = await api("/api/run", { method: "POST", body: JSON.stringify(payload) });
        state.lastRun = run;
        renderRunSummary(run);
        writeLog(formatRun(run));
      } catch (error) {
        renderRunSummary(null);
        writeLog(`执行失败：${error.message}`);
      } finally {
        $("runAll").disabled = false;
        updateRunControls();
      }
    }

    function validateStepForRun(step) {
      const messages = [];
      const required = (condition, message) => { if (!condition) messages.push(message); };
      const text = value => String(value ?? "").trim();
      if (!step || !step.kind || !templates[step.kind]) {
        return { ok: false, messages: ["未知动作类型"] };
      }
      switch (step.kind) {
        case "install_apk":
          required(text(step.path), "APK 路径不能为空");
          break;
        case "pull_file":
          required(text(step.remotePath), "手机路径不能为空");
          required(text(outputDirValue(step)), "电脑保存目录不能为空");
          break;
        case "push_file":
          required(text(step.localPath), "电脑文件或目录不能为空");
          required(text(step.remotePath), "手机保存路径不能为空");
          break;
        case "screenshot":
          required(text(outputDirValue(step)), "电脑保存目录不能为空");
          required(text(step.filename), "截图文件名不能为空");
          break;
        case "screen_record":
          required(text(outputDirValue(step)), "电脑保存目录不能为空");
          required(text(step.filename), "录屏文件名不能为空");
          required(Number(step.seconds) > 0, "录屏秒数必须大于 0");
          break;
        case "app_action": {
          const op = text(step.operation || "force_stop");
          if (op === "start_activity") required(text(step.activity), "Activity 不能为空");
          else required(text(step.packageName), "应用包名不能为空");
          break;
        }
        case "permission_grant":
          required(text(step.packageName), "应用包名不能为空");
          required(text(step.permissions) || text(step.permissionMode) === "settings_page", "权限列表不能为空");
          break;
        case "tap_text":
          required(text(step.keyword), "要点击的文字不能为空");
          break;
        case "adb_shell":
        case "adb_raw":
          required(text(step.command), "命令不能为空");
          break;
        case "adb_script":
          required(text(step.commands), "ADB/自动化脚本不能为空");
          break;
        case "input_text":
          required(text(step.text), "输入文本不能为空");
          break;
        case "set_clipboard":
          required(text(step.text), "剪切板文本不能为空");
          break;
        case "agent_clipboard":
          if (["set", "set_and_paste"].includes(text(step.operation || "read"))) {
            required(text(step.text), "剪切板文本不能为空");
          }
          break;
        case "keyevent":
          required(text(step.key), "KeyCode 不能为空");
          break;
        case "script":
          required(text(step.path), "本机脚本路径不能为空");
          break;
        case "inline_script":
          required(text(step.code), "页面脚本不能为空");
          break;
      }
      return { ok: messages.length === 0, messages };
    }

    function stepRunState(step, index = -1) {
      if (state.runningStep === index) {
        return { ok: true, canRun: false, css: "running", label: "执行中", title: "该节点正在执行", messages: [], hint: "执行中" };
      }
      if (step?.enabled === false) {
        return { ok: true, canRun: false, css: "skipped", label: "已跳过", title: "节点已停用：不会参与预览和执行，也不会阻止整个工作流", messages: [], hint: "已停用：执行方案时会跳过" };
      }
      const validation = validateStepForRun(step);
      if (!validation.ok) {
        return { ok: false, canRun: false, css: "invalid", label: "需配置", title: `配置未完成：${validation.messages.join("；")}`, messages: validation.messages, hint: `未配置：${validation.messages[0] || "请补齐配置"}` };
      }
      return { ok: true, canRun: true, css: "ready", label: "可执行", title: "执行此节点", messages: [], hint: "可执行" };
    }

    function updateStepNodeShell(index) {
      const step = state.steps[index];
      const node = document.querySelector(`[data-node-select="${index}"]`);
      if (!node || !step) return;
      const runState = stepRunState(step, index);
      const desc = node.querySelector(".node-desc");
      if (desc) desc.textContent = stepSummary(step);
      const status = node.querySelector(".node-status");
      if (status) {
        status.textContent = step.enabled === false ? "停用" : "启用";
        status.classList.toggle("off", step.enabled === false);
        status.classList.toggle("on", step.enabled !== false);
      }
      const readiness = node.querySelector(".node-readiness");
      if (readiness) {
        readiness.className = `node-readiness ${runState.css}`;
        readiness.textContent = runState.label;
        readiness.title = runState.title;
      }
      const runButton = node.querySelector('[data-node-action="run"]');
      if (runButton) {
        runButton.disabled = !(runState.canRun && state.runningStep === null);
        runButton.title = runState.title;
      }
      let message = node.querySelector(".node-validation");
      if (runState.ok) {
        message?.remove();
      } else if (message) {
        message.textContent = runState.hint;
        message.title = runState.messages.join("；");
      }
    }

    async function runStep(index) {
      syncAllStepFields();
      const step = state.steps[index];
      if (!step) return;
      state.activeStep = index;
      const validation = validateStepForRun(step);
      if (step.enabled === false) {
        renderSteps();
        renderRunSummary(null);
        writeLog(`节点 #${index + 1} 已停用，不能执行。请先启用该节点。`);
        return;
      }
      if (!validation.ok) {
        renderSteps();
        renderRunSummary(null);
        writeLog(`节点 #${index + 1} 配置未完成，不能执行：${validation.messages.join("；")}。`);
        return;
      }
      const devices = await devicesForExecution();
      if (!devices.length) {
        writeLog("未选择设备，已取消单步执行。");
        return;
      }
      const payload = {
        devices,
        steps: [{ ...step, enabled: true }],
        stopOnError: $("stopOnError").checked
      };
      state.runningStep = index;
      renderSteps();
      document.querySelectorAll("[data-run-step], [data-node-action='run']").forEach(btn => btn.disabled = true);
      writeLog(`开始执行单节点 #${index + 1}：${step.name || kindLabel(step.kind)}，目标设备：${devices.map(deviceLabel).join("、")}\n`);
      try {
        const run = await api("/api/run", { method: "POST", body: JSON.stringify(payload) });
        state.lastRun = run;
        renderRunSummary(run);
        writeLog(`${formatRun(run)}\n单节点 #${index + 1} 执行完成。\n`);
      } catch (error) {
        renderRunSummary(null);
        writeLog(`执行单节点 #${index + 1} 失败。\n错误信息：${error.message}`);
      } finally {
        state.runningStep = null;
        renderSteps();
      }
    }

    function previewDiagnosticHeader({ enabledSteps, disabledSteps, invalid }) {
      const readyCount = enabledSteps.length - invalid.length;
      return `
        <div class="preview-diagnostic-head">
          <strong>执行预览诊断</strong>
          <span>可执行 ${readyCount} 个 · 需配置 ${invalid.length} 个 · 跳过 ${disabledSteps.length} 个停用节点</span>
          <span class="muted tiny">停用节点表示用户暂不使用，不参与预览和执行；只有启用但未配置完整的节点会阻止正式执行。</span>
        </div>`;
    }

    function previewSkippedSection(disabledSteps) {
      if (!disabledSteps.length) return "";
      return `
        <div class="preview-section-title">已跳过</div>
        ${disabledSteps.map(item => `
          <div class="preview-item is-skipped">
            <div class="row"><span class="badge">跳过</span><strong>#${item.index + 1} ${escapeHtml(item.step.name || kindLabel(item.step.kind))}</strong></div>
            <div class="preview-command">该节点已停用，不会参与预览和执行。</div>
          </div>
        `).join("")}`;
    }

    function previewInvalidSection(invalid) {
      if (!invalid.length) return "";
      return `
        <div class="preview-section-title">需要处理</div>
        ${invalid.map(item => `
          <div class="preview-item is-invalid">
            <div class="row">
              <span class="badge fail">需配置</span>
              <strong>#${item.index + 1} ${escapeHtml(item.step.name || kindLabel(item.step.kind))}</strong>
            </div>
            <div class="preview-command">${escapeHtml(item.validation.messages.join("；"))}</div>
          </div>
        `).join("")}`;
    }

    async function previewCurrentRun() {
      syncAllStepFields();
      const readiness = updateRunControls();
      const enabledSteps = enabledStepsForRun();
      const disabledItems = state.steps.map((step, index) => ({ step, index })).filter(item => item.step?.enabled === false);
      const disabledCount = disabledItems.length;
      const invalid = enabledStepValidationIssues();
      const devices = selectedDevices();

      $("previewModal").classList.add("open");
      $("previewModal").setAttribute("aria-hidden", "false");
      $("previewEntries").innerHTML = `<div class="empty">生成预览中...</div>`;
      $("previewStatus").textContent = disabledCount ? `已跳过 ${disabledCount} 个停用节点` : "";

      if (!state.steps.length) {
        $("previewStatus").textContent = "还没有添加节点";
        $("previewEntries").innerHTML = `<div class="empty">请先从左侧动作库添加节点。</div>`;
        return;
      }

      if (!enabledSteps.length) {
        $("previewStatus").textContent = `没有启用节点，已跳过 ${disabledCount} 个停用节点`;
        $("previewEntries").innerHTML = `<div class="empty">当前没有可执行动作。停用节点表示用户暂不使用，不会阻止预览；启用至少一个节点后可生成命令预览。</div>`;
        return;
      }

      if (invalid.length) {
        $("previewStatus").textContent = `${invalid.length} 个启用节点未配置完整${disabledCount ? `，已跳过 ${disabledCount} 个停用节点` : ""}`;
        $("previewEntries").innerHTML = `${previewDiagnosticHeader({ enabledSteps, disabledSteps: disabledItems, invalid })}${previewInvalidSection(invalid)}${previewSkippedSection(disabledItems)}<div class="empty">请补齐上面启用节点的配置，或停用这些节点。停用节点不会阻止预览。</div>`;
        state.activeStep = invalid[0].index;
        renderSteps();
        return;
      }

      const payload = {
        devices: devices.length ? devices : onlineDevices().slice(0, 1).map(device => device.serial),
        steps: enabledSteps,
        stopOnError: $("stopOnError").checked
      };
      try {
        const data = await api("/api/preview", { method: "POST", body: JSON.stringify(payload) });
        const warningText = data.warnings?.length ? data.warnings.join("；") : `${data.items.length} 条命令`;
        $("previewStatus").textContent = disabledCount ? `${warningText}，已跳过 ${disabledCount} 个停用节点` : warningText;
        if (!data.items.length) {
          $("previewEntries").innerHTML = `<div class="empty">没有可执行的动作</div>`;
          return;
        }
        const readyHtml = data.items.map(item => `
          <div class="preview-item ${item.ok ? "is-ready" : "is-invalid"}">
            <div class="row">
              <span class="badge ${item.ok ? "ok" : "fail"}">${item.ok ? "将执行" : "错误"}</span>
              <strong>${escapeHtml(item.name || "动作")}</strong>
              <span class="muted tiny">${escapeHtml(item.target ? deviceLabel(item.target) : "本机")}</span>
            </div>
            ${item.warnings?.length ? `<div class="muted tiny">${escapeHtml(item.warnings.join("；"))}</div>` : ""}
            ${item.ok ? `<div class="preview-command">${escapeHtml(commandDisplay(item))}</div>` : `<div class="preview-command">${escapeHtml(item.error || "预览失败")}</div>`}
          </div>
        `).join("");
        $("previewEntries").innerHTML = `${previewDiagnosticHeader({ enabledSteps, disabledSteps: disabledItems, invalid })}<div class="preview-section-title">将执行</div>${readyHtml}${previewSkippedSection(disabledItems)}`;
      } catch (error) {
        $("previewStatus").textContent = "预览失败";
        $("previewEntries").innerHTML = `<div class="preview-item"><span class="badge fail">错误</span><div class="preview-command">${escapeHtml(error.message)}</div></div>`;
      } finally {
        updateRunControls();
      }
    }

    function closePreview() {
      $("previewModal").classList.remove("open");
      $("previewModal").setAttribute("aria-hidden", "true");
    }

    function failedDevices(run) {
      const devices = new Set();
      for (const step of run?.steps || []) {
        for (const result of step.results || []) {
          if (result.serial && !result.ok) devices.add(result.serial);
        }
      }
      return [...devices];
    }

    async function retryFailedDevices() {
      if (!state.lastRun) return;
      const devices = failedDevices(state.lastRun);
      if (!devices.length) return;
      const payload = {
        devices,
        steps: state.lastRun.sourceSteps || state.steps,
        stopOnError: $("stopOnError").checked
      };
      $("retryFailed").disabled = true;
      writeLog("重试失败设备中...\n");
      try {
        const run = await api("/api/run", { method: "POST", body: JSON.stringify(payload) });
        state.lastRun = run;
        renderRunSummary(run);
        writeLog(formatRun(run));
      } catch (error) {
        writeLog(`重试失败：${error.message}`);
      }
    }

    function resultSummaryText(result) {
      const text = result.ok ? (result.stdout || "成功") : (result.stderr || result.stdout || "失败");
      return text.split("\n").map(line => line.trim()).filter(Boolean)[0] || "";
    }

    function renderRunSummary(run) {
      const failed = failedDevices(run);
      $("retryFailed").disabled = !failed.length;
      if (!run || !run.steps?.length) {
        $("resultSummary").innerHTML = "";
        return;
      }
      const rows = [];
      for (const step of run.steps) {
        if (step.error) {
          rows.push({ step: step.name, device: "-", status: "失败", duration: "-", summary: step.error, ok: false });
        }
        for (const result of step.results || []) {
          rows.push({
            step: step.name,
            device: result.serial ? deviceLabel(result.serial) : "本机",
            status: result.ok ? "成功" : "失败",
            duration: `${result.durationMs || 0}ms`,
            summary: resultSummaryText(result),
            ok: result.ok
          });
        }
      }
      $("resultSummary").innerHTML = `
        <div class="result-table">
          <div class="result-row result-head">
            <span>状态</span><span>设备</span><span>动作</span><span>耗时</span><span>摘要</span>
          </div>
          ${rows.map(row => `
            <div class="result-row">
              <span><span class="badge ${row.ok ? "ok" : "fail"}">${row.status}</span></span>
              <span class="result-cell" title="${attr(row.device)}">${escapeHtml(row.device)}</span>
              <span class="result-cell" title="${attr(row.step)}">${escapeHtml(row.step)}</span>
              <span class="result-cell">${escapeHtml(row.duration)}</span>
              <span class="result-cell" title="${attr(row.summary)}">${escapeHtml(row.summary)}</span>
            </div>
          `).join("")}
        </div>`;
    }


    function openDumpAnalyzer(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();

      const serials = state.devices.filter(device => device.state === "device").map(device => device.serial);
      const selected = state.deviceActionSerial || [...state.selected][0] || serials[0] || "";
      const url = selected ? `/dump.html?serial=${encodeURIComponent(selected)}` : "/dump.html";
      const absoluteUrl = new URL(url, window.location.origin).toString();

      // 只打开新标签页，不再让当前页面跳转，也不关闭设备操作弹窗。
      window.open(absoluteUrl, "_blank", "noopener,noreferrer");
      setDeviceStatus("已在新标签页打开 Dump 节点解析");
      return false;
    }

    function closeDumpAnalyzer() {
      $("dumpModal").classList.remove("open");
      $("dumpModal").setAttribute("aria-hidden", "true");
    }

    async function loadDumpAnalyze() {
      const serial = $("dumpSerial").value || state.deviceActionSerial;
      if (!serial) return;
      $("dumpRefresh").disabled = true;
      $("dumpStatus").textContent = "Dump 中...";
      $("dumpStage").innerHTML = `<div class="empty">正在获取截图和 UI XML...</div>`;
      $("dumpTree").innerHTML = "";
      $("dumpDetail").innerHTML = `<div class="empty">等待节点数据...</div>`;
      try {
        const data = await api("/api/device/dump-analyze", { method: "POST", body: JSON.stringify({ serial }) });
        state.dumpXml = data.xml || "";
        state.dumpScreenshot = data.imageData || "";
        state.dumpNodes = parseDumpXml(state.dumpXml);
        state.dumpSelectedNodeId = "";
        renderDumpAnalyzer();
        $("dumpStatus").textContent = data.ok ? `已解析 ${state.dumpNodes.length} 个节点` : (data.error || "Dump 失败");
      } catch (error) {
        $("dumpStatus").textContent = `Dump 失败：${error.message}`;
        $("dumpStage").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      } finally {
        $("dumpRefresh").disabled = false;
      }
    }

    function parseDumpXml(xmlText) {
      if (!xmlText) return [];
      const doc = new DOMParser().parseFromString(xmlText, "application/xml");
      const nodes = [];
      const walk = (element, depth, parentId) => {
        if (element.nodeType !== 1) return;
        if (element.tagName === "node") {
          const id = String(nodes.length);
          const bounds = parseBounds(element.getAttribute("bounds") || "");
          const item = {
            id,
            parentId,
            depth,
            index: element.getAttribute("index") || "",
            text: element.getAttribute("text") || "",
            resourceId: element.getAttribute("resource-id") || "",
            className: element.getAttribute("class") || "",
            packageName: element.getAttribute("package") || "",
            contentDesc: element.getAttribute("content-desc") || "",
            clickable: element.getAttribute("clickable") === "true",
            enabled: element.getAttribute("enabled") !== "false",
            scrollable: element.getAttribute("scrollable") === "true",
            bounds,
            raw: Object.fromEntries([...element.attributes].map(attr => [attr.name, attr.value]))
          };
          nodes.push(item);
          [...element.children].forEach(child => walk(child, depth + 1, id));
        } else {
          [...element.children].forEach(child => walk(child, depth, parentId));
        }
      };
      walk(doc.documentElement, 0, "");
      return nodes;
    }

    function parseBounds(value) {
      const match = String(value || "").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!match) return null;
      const [, x1, y1, x2, y2] = match.map(Number);
      return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
    }

    function dumpNodeLabel(node) {
      return node.text || node.contentDesc || node.resourceId || node.className || `node ${node.id}`;
    }

    function dumpNodeClassShort(node) {
      return String(node.className || "node").split(".").pop() || "node";
    }

    function dumpNodePrimaryText(node) {
      return node.text || node.contentDesc || node.resourceId || "";
    }

    function dumpNodeDisplayLines(node) {
      const b = node.bounds;
      const lines = [];
      const push = (key, value, options = {}) => {
        if (value === undefined || value === null || String(value) === "") return;
        const tag = options.code ? "code" : "span";
        const cls = options.primary ? " primary" : "";
        lines.push(`<div class="dump-node-line${cls}"><span class="k">${escapeHtml(key)}</span><${tag} class="v">${escapeHtml(value)}</${tag}></div>`);
      };
      push("text", node.text, { primary: true });
      push("desc", node.contentDesc, { primary: !node.text });
      push("res-id", node.resourceId, { code: true });
      push("class", node.className, { code: true });
      push("package", node.packageName, { code: true });
      if (b) {
        push("bounds", `[${b.x1},${b.y1}][${b.x2},${b.y2}]  center=${b.cx},${b.cy}`, { code: true });
      }
      return lines.join("");
    }

    function dumpNodeSubLines(node) {
      return dumpNodeDisplayLines(node);
    }

    function isDumpNodeVisible(node, keyword) {
      if (!node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0) return false;
      if (keyword && !dumpNodeSearchText(node).includes(keyword.toLowerCase())) return false;
      if ($("dumpShowAll").checked) return true;
      return node.clickable || !!node.text || !!node.contentDesc || !!node.resourceId || node.id === state.dumpSelectedNodeId;
    }

    function renderDumpAnalyzer() {
      const keyword = $("dumpSearch").value.trim();
      const visibleNodes = state.dumpNodes.filter(node => isDumpNodeVisible(node, keyword));
      $("dumpImageHint").textContent = `${visibleNodes.length} 个框`;
      $("dumpTreeHint").textContent = keyword ? `${state.dumpNodes.filter(node => dumpNodeSearchText(node).includes(keyword.toLowerCase())).length}/${state.dumpNodes.length} 个节点` : `${state.dumpNodes.length} 个节点`;
      renderDumpImage(visibleNodes);
      renderDumpTree(keyword);
      if (state.dumpSelectedNodeId) renderDumpDetail(state.dumpSelectedNodeId);
    }

    function renderDumpImage(visibleNodes) {
      const maxX = Math.max(1, ...state.dumpNodes.map(node => node.bounds?.x2 || 0));
      const maxY = Math.max(1, ...state.dumpNodes.map(node => node.bounds?.y2 || 0));
      $("dumpStage").style.width = `${maxX}px`;
      $("dumpStage").style.height = `${maxY}px`;
      $("dumpStage").innerHTML = `
        ${state.dumpScreenshot ? `<img src="${attr(state.dumpScreenshot)}" alt="设备截图">` : ""}
        ${visibleNodes.map(node => {
          const b = node.bounds;
          const cls = ["dump-box", node.clickable ? "clickable" : "", (node.text || node.contentDesc) ? "has-text" : "", node.id === state.dumpSelectedNodeId ? "selected" : ""].filter(Boolean).join(" ");
          return `<div class="${cls}" data-dump-node-id="${attr(node.id)}" title="${attr(dumpNodeLabel(node))}" style="left:${b.x1}px;top:${b.y1}px;width:${Math.max(4, b.width)}px;height:${Math.max(4, b.height)}px"></div>`;
        }).join("")}`;
      document.querySelectorAll("#dumpStage [data-dump-node-id]").forEach(box => {
        box.addEventListener("click", event => {
          event.stopPropagation();
          selectDumpNode(box.dataset.dumpNodeId, { scrollTree: true });
        });
        box.addEventListener("dblclick", event => {
          event.stopPropagation();
          const node = state.dumpNodes.find(item => item.id === box.dataset.dumpNodeId);
          if (node?.bounds) navigator.clipboard.writeText(`tap(${node.bounds.cx}, ${node.bounds.cy})`);
        });
      });
    }

    function dumpNodeBestValue(node) {
      if (node.text) return { label: "text", value: node.text };
      if (node.contentDesc) return { label: "desc", value: node.contentDesc };
      if (node.resourceId) return { label: "id", value: node.resourceId };
      if (node.packageName) return { label: "pkg", value: node.packageName };
      return { label: "", value: "无文字/ID" };
    }

    function dumpNodeSearchText(node) {
      const b = node.bounds;
      return [
        node.text,
        node.contentDesc,
        node.resourceId,
        node.className,
        node.packageName,
        b ? `[${b.x1},${b.y1}][${b.x2},${b.y2}] ${b.cx},${b.cy}` : ""
      ].join(" ").toLowerCase();
    }

    function renderDumpTree(keyword = "") {
      const lower = keyword.trim().toLowerCase();
      const rows = state.dumpNodes.filter(node => !lower || dumpNodeSearchText(node).includes(lower));
      const line = (key, value, options = {}) => {
        if (value === undefined || value === null || String(value) === "") return "";
        const tag = options.code ? "code" : "span";
        const primary = options.primary ? " primary" : "";
        return `<div class="dump-node-line${primary}"><span class="k">${escapeHtml(key)}</span><${tag} class="v">${escapeHtml(String(value))}</${tag}></div>`;
      };
      $("dumpTree").innerHTML = rows.map(node => {
        const b = node.bounds;
        const classShort = dumpNodeClassShort(node);
        const firstLabel = node.text ? "text" : node.contentDesc ? "desc" : node.resourceId ? "res-id" : "node";
        const firstValue = node.text || node.contentDesc || node.resourceId || "无 text / desc / resource-id";
        const tags = [
          node.clickable ? `<span class="dump-node-tag strong">clickable</span>` : "",
          node.enabled ? `<span class="dump-node-tag">enabled</span>` : `<span class="dump-node-tag">disabled</span>`,
          node.scrollable ? `<span class="dump-node-tag">scrollable</span>` : "",
          node.index !== "" ? `<span class="dump-node-tag">index ${escapeHtml(node.index)}</span>` : "",
          node.parentId !== "" ? `<span class="dump-node-tag">parent ${escapeHtml(node.parentId)}</span>` : "",
          b ? `<span class="dump-node-tag">${b.width}×${b.height}</span>` : ""
        ].filter(Boolean).join("");
        const indent = `<span class="dump-tree-indent" style="width:${Math.min(120, Number(node.depth || 0) * 12)}px"></span>`;
        const lines = [
          line(firstLabel, firstValue, { primary: true, code: firstLabel === "res-id" }),
          node.text && firstLabel !== "text" ? line("text", node.text) : "",
          node.contentDesc && firstLabel !== "desc" ? line("desc", node.contentDesc) : "",
          node.resourceId && firstLabel !== "res-id" ? line("res-id", node.resourceId, { code: true }) : "",
          line("class", node.className, { code: true }),
          line("package", node.packageName, { code: true }),
          b ? line("bounds", `[${b.x1},${b.y1}][${b.x2},${b.y2}]  center=${b.cx},${b.cy}`, { code: true }) : ""
        ].filter(Boolean).join("");
        return `
        <div class="dump-tree-row ${node.id === state.dumpSelectedNodeId ? "selected" : ""}" data-dump-tree-id="${attr(node.id)}" title="${attr(dumpNodeLabel(node))}">
          <div class="dump-tree-head">
            ${indent}<span class="dump-node-depth">D${escapeHtml(node.depth)} #${escapeHtml(node.id)}</span>
            <span class="dump-node-class">${escapeHtml(classShort)}</span>
            ${node.clickable ? `<span class="badge ok">click</span>` : ""}
          </div>
          ${lines}
          ${tags ? `<div class="dump-node-tags">${tags}</div>` : ""}
        </div>`;
      }).join("") || `<div class="empty">没有匹配节点</div>`;
      document.querySelectorAll("#dumpTree [data-dump-tree-id]").forEach(row => {
        row.addEventListener("click", () => selectDumpNode(row.dataset.dumpTreeId, { scrollImage: true }));
      });
    }

    function selectDumpNode(nodeId, options = {}) {
      state.dumpSelectedNodeId = String(nodeId || "");
      document.querySelectorAll("[data-dump-node-id], [data-dump-tree-id]").forEach(el => {
        const id = el.dataset.dumpNodeId || el.dataset.dumpTreeId;
        el.classList.toggle("selected", id === state.dumpSelectedNodeId);
      });
      renderDumpDetail(state.dumpSelectedNodeId);
      renderDumpImage(state.dumpNodes.filter(node => isDumpNodeVisible(node, $("dumpSearch").value.trim())));
      renderDumpTree($("dumpSearch").value.trim());
      requestAnimationFrame(() => {
        if (options.scrollTree) document.querySelector(`#dumpTree [data-dump-tree-id="${CSS.escape(state.dumpSelectedNodeId)}"]`)?.scrollIntoView({ block: "center" });
        if (options.scrollImage) document.querySelector(`#dumpStage [data-dump-node-id="${CSS.escape(state.dumpSelectedNodeId)}"]`)?.scrollIntoView({ block: "center", inline: "center" });
      });
    }

    function renderDumpDetail(nodeId) {
      const node = state.dumpNodes.find(item => item.id === String(nodeId));
      if (!node) {
        $("dumpDetail").innerHTML = `<div class="empty">点击截图框或节点树查看详情</div>`;
        return;
      }
      const label = node.text || node.contentDesc || "";
      const commands = [];
      if (node.resourceId) commands.push({ title: "按 resource-id 点击（最稳定）", text: `tapText("${escapeJs(label || node.resourceId)}", { matchFields: "resource-id", strict: true })` });
      if (node.resourceId) commands.push({ title: "按 resource-id 长按", text: `longPressId("${escapeJs(node.resourceId)}")` });
      if (label) commands.push({ title: "按文字点击", text: `tapText("${escapeJs(label)}")` });
      if (label) commands.push({ title: "按文字长按", text: `longPressText("${escapeJs(label)}")` });
      if (node.bounds) commands.push({ title: "按中心坐标点击", text: `adb shell input tap ${node.bounds.cx} ${node.bounds.cy}` });
      $("dumpDetail").innerHTML = `
        <div class="detail-grid">
          <div class="kv"><span>class</span><strong>${escapeHtml(node.className)}</strong></div>
          <div class="kv"><span>package</span><strong>${escapeHtml(node.packageName)}</strong></div>
          <div class="kv"><span>clickable</span><strong>${node.clickable}</strong></div>
          <div class="kv"><span>bounds / center</span><strong>${node.bounds ? `[${node.bounds.x1},${node.bounds.y1}][${node.bounds.x2},${node.bounds.y2}] / ${node.bounds.cx}, ${node.bounds.cy}` : "-"}</strong></div>
        </div>
        ${commands.map(command => `<div class="dump-command-card"><strong>${escapeHtml(command.title)}</strong><code>${escapeHtml(command.text)}</code><div class="row"><button data-copy-dump-command="${attr(command.text)}">复制</button>${command.text.startsWith("adb shell ") ? `<button class="blue" data-run-dump-command="${attr(command.text)}">执行</button>` : ""}</div></div>`).join("")}
        <strong>原始属性</strong><pre>${escapeHtml(JSON.stringify(node.raw, null, 2))}</pre>`;
      document.querySelectorAll("[data-copy-dump-command]").forEach(btn => btn.addEventListener("click", () => navigator.clipboard.writeText(btn.dataset.copyDumpCommand)));
      document.querySelectorAll("[data-run-dump-command]").forEach(btn => btn.addEventListener("click", () => runDumpCommand(btn.dataset.runDumpCommand)));
    }

    async function runDumpCommand(commandText) {
      const serial = $("dumpSerial").value;
      const command = String(commandText || "").startsWith("adb shell ") ? commandText.replace(/^adb shell\s+/, "") : commandText;
      $("dumpStatus").textContent = "执行中...";
      try {
        const data = await api("/api/device/shell", { method: "POST", body: JSON.stringify({ serial, command }) });
        $("dumpStatus").textContent = data.ok ? "执行成功" : "执行失败";
      } catch (error) {
        $("dumpStatus").textContent = `执行失败：${error.message}`;
      }
    }

    function escapeJs(value) {
      return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function syncAllStepFields() {
      document.querySelectorAll("[data-step]").forEach(card => {
        const index = Number(card.dataset.step);
        card.querySelectorAll("[data-field]").forEach(field => {
          state.steps[index][field.dataset.field] = field.type === "number" ? Number(field.value) : field.type === "checkbox" ? field.checked : field.value;
        });
      });
    }

    function commandDisplay(item) {
      if (item?.commandText) return item.commandText;
      const command = item?.command || [];
      return Array.isArray(command) ? command.join(" ") : String(command || "");
    }

    function formatMultilineBlock(title, text) {
      const value = String(text || "").trimEnd();
      if (!value) return [];
      return [`  ${title}:`, indent(value)];
    }

    function formatRun(run) {
      const steps = run?.steps || [];
      const devices = (run?.devices || []).map(deviceLabel).join(", ") || "无";
      const okCount = steps.flatMap(step => step.results || []).filter(result => result.ok).length;
      const failCount = steps.flatMap(step => step.results || []).filter(result => !result.ok).length;
      const lines = [
        "# 执行概览",
        `状态: ${run?.ok ? "成功" : "失败"}`,
        `时间: ${run?.startedAt || "-"} -> ${run?.finishedAt || "-"}`,
        `设备: ${devices}`,
        `Run ID: ${run?.id || "-"}`,
        `动作数: ${steps.length}`,
        `结果: 成功 ${okCount} / 失败 ${failCount}`,
        ""
      ];

      for (const step of steps) {
        lines.push(`## 动作 #${Number(step.index ?? 0) + 1}: ${step.name} (${stepTargetLabel(step)})`);
        lines.push(`状态: ${step.ok ? "成功" : "失败"}`);
        if (step.error) lines.push(`失败原因: ${step.error}`);
        lines.push("");

        for (const result of step.results || []) {
          const target = result.serial ? deviceLabel(result.serial) : "local";
          const command = commandDisplay(result);
          lines.push("### 命令明细");
          lines.push(`设备: ${target}`);
          if (result.traceId) lines.push(`Trace ID: ${result.traceId}`);
          lines.push(`状态: ${result.ok ? "成功" : "失败"}`);
          lines.push(`退出码: ${result.code ?? "n/a"}`);
          lines.push(`耗时: ${result.durationMs || 0}ms`);
          if (command) {
            lines.push("实际命令:");
            lines.push(indent(command));
          }
          lines.push("");

          lines.push("### stdout");
          lines.push((result.stdout || "<empty>").trimEnd());
          lines.push("");
          lines.push("### stderr");
          lines.push((result.stderr || "<empty>").trimEnd());
          lines.push("");

          const advice = diagnosticAdviceForResult(result);
          if (!result.ok && advice.length) {
            lines.push("### 诊断建议");
            advice.forEach((item, adviceIndex) => lines.push(`${adviceIndex + 1}. ${item}`));
            lines.push("");
          }
        }
      }
      return lines.join("\n");
    }

    function formatResult(run) {
      return formatRun({ ok: false, startedAt: "", finishedAt: "", devices: [], steps: run.steps });
    }

    function indent(text) {
      return text.split("\n").map(line => `    ${line}`).join("\n");
    }

    function logFilterSections(text, filter) {
      const value = String(text || "");
      if (!value || filter === "all") return value;
      const lines = value.split("\n");
      const wanted = {
        overview: ["# 执行概览", "状态:", "时间:", "设备:", "动作数:", "结果:"],
        commands: ["### 命令明细", "实际命令:", "设备:", "退出码:", "耗时:"],
        stdout: ["### stdout"],
        stderr: ["### stderr"],
        advice: ["### 诊断建议"]
      }[filter] || [];
      if (!wanted.length) return value;
      const chunks = [];
      let keep = false;
      for (const line of lines) {
        if (/^# |^## |^### /.test(line)) {
          keep = wanted.some(token => line.startsWith(token));
        } else if (filter === "overview" && wanted.some(token => line.startsWith(token))) {
          keep = true;
        }
        if (keep) chunks.push(line);
      }
      return chunks.join("\n").trim() || "当前日志没有该分层内容。";
    }

    function renderLogFilters() {
      const bar = $("logFilters");
      if (!bar) return;
      bar.querySelectorAll("[data-log-filter]").forEach(button => {
        button.classList.toggle("active", button.dataset.logFilter === state.logFilter);
      });
    }

    function writeLog(text, options = {}) {
      const log = $("log");
      if (!options.keepFilter) state.logFilter = "all";
      state.logFullText = String(text || "");
      log.textContent = logFilterSections(state.logFullText, state.logFilter);
      log.scrollTop = 0;
      renderLogFilters();
    }

    function diagnosticAdviceForResult(result) {
      const output = `${result?.stdout || ""}
${result?.stderr || ""}`;
      const advice = [];
      if (/UIAutomator|命中 0 个|找不到|not found|No node/i.test(output)) {
        advice.push("重新 Dump 当前页面，确认目标控件仍然存在");
        advice.push("检查 text / resource-id / class 是否和当前页面一致");
        advice.push("降低智能点击匹配条件，避免 text、resource-id、class 同时过严");
        advice.push("尝试改用坐标点击，或在点击前增加等待节点");
      }
      if (/device offline|no devices|unauthorized|not found/i.test(output)) {
        advice.push("检查设备连接、授权状态和 adb devices 输出");
      }
      if (/Permission|denied|SecurityException/i.test(output)) {
        advice.push("检查应用权限、系统限制或是否需要先授权");
      }
      return [...new Set(advice)];
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function attr(value) {
      return escapeHtml(value).replace(/`/g, "&#96;");
    }

    document.querySelectorAll("[data-add]").forEach(btn => {
      btn.setAttribute("draggable", "true");
      btn.addEventListener("dragstart", event => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/adb-action-kind", btn.dataset.add);
      });
      btn.addEventListener("click", () => {
        state.steps.push(templates[btn.dataset.add]());
        state.activeStep = state.steps.length - 1;
        renderSteps();
      });
    });

    document.addEventListener("click", (event) => {
      const emptyAdd = event.target.closest("[data-empty-add]");
      const emptyImport = event.target.closest("[data-empty-import]");
      if (emptyAdd) {
        const template = templates[emptyAdd.dataset.emptyAdd];
        if (!template) return;
        state.steps.push(template());
        state.activeStep = state.steps.length - 1;
        renderSteps();
        return;
      }
      if (emptyImport) {
        triggerImportWorkflow();
      }
    });

    document.addEventListener("dragover", event => {
      const zone = event.target.closest(".node-list, .drop-hint");
      if (!zone) return;
      if (!event.dataTransfer.types.includes("text/adb-action-kind")) return;
      event.preventDefault();
      zone.classList.add("drag-over");
    });

    document.addEventListener("dragleave", event => {
      const zone = event.target.closest(".node-list, .drop-hint");
      if (zone) zone.classList.remove("drag-over");
    });

    document.addEventListener("drop", event => {
      const zone = event.target.closest(".node-list, .drop-hint");
      if (!zone) return;
      const kind = event.dataTransfer.getData("text/adb-action-kind");
      if (!kind || !templates[kind]) return;
      event.preventDefault();
      zone.classList.remove("drag-over");

      const list = zone.classList.contains("node-list") ? zone : document.querySelector(".node-list");
      const nodes = [...document.querySelectorAll("[data-node-select]")];
      let insertAt = state.steps.length;
      if (list && nodes.length) {
        const y = event.clientY;
        const hit = nodes.find(node => {
          const box = node.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        if (hit) insertAt = Number(hit.dataset.nodeSelect);
      }

      state.steps.splice(insertAt, 0, templates[kind]());
      state.activeStep = insertAt;
      renderSteps();
    });
    document.querySelectorAll("[data-variable]").forEach(btn => {
      btn.addEventListener("click", () => insertVariable(btn.dataset.variable));
    });
    $("refreshDevices").addEventListener("click", refreshDevices);
    $("saveSettings").addEventListener("click", () => saveSettings());
    $("pickAdbPath").addEventListener("click", event => withButtonBusy(event.currentTarget, "选择中...", pickAdbPath));
    $("pickQuickOutputDir").addEventListener("click", event => withButtonBusy(event.currentTarget, "选择中...", () => pickSettingsDirectory("quickOutputDir", "选择默认输出目录")));
    $("pickLocalTempDir").addEventListener("click", event => withButtonBusy(event.currentTarget, "选择中...", () => pickSettingsDirectory("localTempDir", "选择本机临时目录")));
    $("pickAgentApkPath").addEventListener("click", event => withButtonBusy(event.currentTarget, "选择中...", pickAgentApkPath));
    $("saveDeviceMeta").addEventListener("click", saveDeviceMeta);
    $("selectGroup").addEventListener("click", selectCurrentGroup);
    $("selectOnline").addEventListener("click", () => {
      state.selected = new Set(state.devices.filter(d => d.state === "device").map(d => d.serial));
      renderDevices();
    });
    $("clearDevices").addEventListener("click", () => {
      state.selected.clear();
      renderDevices();
    });
    $("clearSteps").addEventListener("click", () => {
      state.steps = [];
      renderSteps();
    });
    $("exportWorkflow").addEventListener("click", exportWorkflow);
    $("importWorkflow").addEventListener("click", triggerImportWorkflow);
    $("workflowImportFile").addEventListener("change", event => importWorkflowFile(event.target.files?.[0]));
    $("saveProfile").addEventListener("click", async () => {
      syncAllStepFields();
      const name = $("profileName").value.trim() || `方案 ${new Date().toLocaleString()}`;
      const existing = state.profiles.findIndex(item => item.name === name);
      const profile = { name, steps: structuredClone(state.steps) };
      if (existing >= 0) state.profiles[existing] = profile;
      else state.profiles.push(profile);
      await saveProfiles();
      renderProfiles();
    });
    $("runAll").addEventListener("click", runAll);
    $("previewRun").addEventListener("click", previewCurrentRun);
    $("previewClose").addEventListener("click", closePreview);
    $("previewRunNow").addEventListener("click", async () => {
      closePreview();
      await runAll();
    });
    $("retryFailed").addEventListener("click", retryFailedDevices);
    $("copyLog").addEventListener("click", async () => navigator.clipboard.writeText(state.logFullText || $("log").textContent));
    document.querySelectorAll("[data-log-filter]").forEach(button => {
      button.addEventListener("click", () => {
        state.logFilter = button.dataset.logFilter || "all";
        const log = $("log");
        log.textContent = logFilterSections(state.logFullText || log.textContent, state.logFilter);
        log.scrollTop = 0;
        renderLogFilters();
      });
    });
    $("loadRuns").addEventListener("click", async () => {
      const data = await api("/api/runs?limit=1");
      if (data.runs && data.runs[0]) {
        state.lastRun = data.runs[0];
        renderRunSummary(state.lastRun);
        writeLog(formatRun(state.lastRun));
      }
    });
    $("remoteClose").addEventListener("click", closeRemotePicker);
    $("remoteOpen").addEventListener("click", loadRemoteEntries);
    $("remoteEnterSelected").addEventListener("click", () => enterRemoteEntry(state.remoteSelectedEntry));
    $("remoteCopySelected").addEventListener("click", copySelectedRemotePath);
    $("remoteUse").addEventListener("click", useRemotePath);
    $("remoteUseFooter").addEventListener("click", useRemotePath);
    $("remoteSerial").addEventListener("change", loadRemoteEntries);
    $("remoteSearch").addEventListener("input", renderRemoteEntries);
    $("remoteSort").addEventListener("change", renderRemoteEntries);
    document.querySelectorAll("[data-remote-shortcut]").forEach(btn => {
      btn.addEventListener("click", () => {
        $("remotePath").value = btn.dataset.remoteShortcut;
        loadRemoteEntries();
      });
    });
    $("remoteOpenFile").addEventListener("click", openSelectedRemoteFile);
    $("remoteUp").addEventListener("click", async () => {
      const path = $("remotePath").value.trim() || "/";
      $("remotePath").value = remoteParentPath(path);
      await loadRemoteEntries();
    });
    $("remotePath").addEventListener("keydown", event => {
      if (event.key === "Enter") loadRemoteEntries();
    });
    $("screenshotFullscreenClose").addEventListener("click", closeScreenshotFullscreen);
    $("screenshotFit").addEventListener("click", fitScreenshotViewer);
    $("screenshotActual").addEventListener("click", actualScreenshotViewer);
    $("screenshotZoomOut").addEventListener("click", () => zoomScreenshotViewer(-0.2));
    $("screenshotZoomIn").addEventListener("click", () => zoomScreenshotViewer(0.2));
    $("screenshotOpenImage").addEventListener("click", () => {
      if (screenshotViewerSrc) window.open(screenshotViewerSrc, "_blank", "noopener,noreferrer");
    });
    $("screenshotFullscreenImage").addEventListener("load", updateScreenshotViewerTransform);
    $("deviceActionClose").addEventListener("click", closeDeviceActions);
    $("deviceActionCloseFooter").addEventListener("click", closeDeviceActions);
    $("deviceFileManager").addEventListener("click", openDeviceFileManager);
    $("deviceAppManager").addEventListener("click", openDeviceAppManager);
    $("deviceTopActivity").addEventListener("click", showTopActivity);
    $("deviceDetails").addEventListener("click", showDeviceDetails);
    $("deviceScreenshot").addEventListener("click", captureDeviceScreenshot);
    $("deviceDumpAnalyze").addEventListener("click", event => openDumpAnalyzer(event));
    $("deviceCopySerial").addEventListener("click", () => copyDeviceText("serial"));
    $("deviceCopyPrefix").addEventListener("click", () => copyDeviceText("prefix"));
    $("deviceClipboardRead").addEventListener("click", readDeviceClipboard);
    $("deviceClipboardCopy").addEventListener("click", copyDeviceClipboardToComputer);
    $("deviceClipboardWrite").addEventListener("click", writeDeviceClipboard);
    $("deviceClipboardSync").addEventListener("click", toggleClipboardSync);
    $("deviceAgentInstall").addEventListener("click", installDeviceAgent);
    $("deviceRunShell").addEventListener("click", runDeviceShell);
    $("deviceShellCommand").addEventListener("keydown", event => {
      if (event.key === "Enter") runDeviceShell();
    });
    $("openAppManager").addEventListener("click", () => openAppManager({ mode: "browse" }));
    $("openRemoteManager").addEventListener("click", () => openRemoteBrowser());
    $("appClose").addEventListener("click", closeAppManager);
    $("appCloseFooter").addEventListener("click", closeAppManager);
    $("appReload").addEventListener("click", () => loadAppEntries("cached"));
    $("appLightRefresh").addEventListener("click", () => loadAppEntries("light"));
    $("appSerial").addEventListener("change", () => loadAppEntries("cached"));
    $("appSearch").addEventListener("input", renderAppEntries);
    $("appIncludeSystem").addEventListener("change", () => loadAppEntries("cached"));

    if ($("dumpClose")) $("dumpClose").addEventListener("click", closeDumpAnalyzer);
    if ($("dumpCloseFooter")) $("dumpCloseFooter").addEventListener("click", closeDumpAnalyzer);
    if ($("dumpRefresh")) $("dumpRefresh").addEventListener("click", loadDumpAnalyze);
    if ($("dumpSerial")) $("dumpSerial").addEventListener("change", loadDumpAnalyze);
    if ($("dumpSearch")) $("dumpSearch").addEventListener("input", renderDumpAnalyzer);
    if ($("dumpShowAll")) $("dumpShowAll").addEventListener("change", renderDumpAnalyzer);
    if ($("dumpCopyXml")) $("dumpCopyXml").addEventListener("click", () => navigator.clipboard.writeText(state.dumpXml || ""));

    async function init() {
      renderSteps();
      renderDevices();
      await Promise.allSettled([loadSettings(), loadProfiles(), loadAdbSnippets()]);
      await refreshDevices().catch(() => {});
      const health = await api("/api/health").catch(() => null);
      if (health) $("health").textContent = `${health.python} / ${health.platform}`;
    }
    init();
