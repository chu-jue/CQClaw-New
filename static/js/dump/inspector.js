
// Standalone Dump node inspector page.
const dumpState = {
  devices: [],
  settings: { deviceAliases: {}, deviceGroups: {} },
  nodes: [],
  xml: "",
  screenshot: "",
  imageWidth: 0,
  imageHeight: 0,
  boundsWidth: 0,
  boundsHeight: 0,
  selectedId: "",
  zoom: 0,
  fitMode: "height",
  serial: "",
  view: "tree",
  collapsed: new Set()
};

const DUMP_SHOT_WIDTH_KEY = "cqclaw.dump.shotWidth";

function loadImageSize(src) {
  return new Promise(resolve => {
    if (!src) {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

function qParam(name) { return new URLSearchParams(location.search).get(name) || ""; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function attr(value) { return escapeHtml(value); }
function iconSvg(name, extraClass = "") {
  const classes = ["ui-icon", extraClass].filter(Boolean).join(" ");
  return `<svg class="${attr(classes)}" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${attr(name)}"></use></svg>`;
}
function iconLabel(icon, label) {
  return `${iconSvg(icon)}<span>${escapeHtml(label)}</span>`;
}
function deviceAlias(serial) { return dumpState.settings.deviceAliases?.[serial] || ""; }
function deviceLabel(serial) { const alias = deviceAlias(serial); return alias ? `${alias} (${serial})` : serial; }
function setStatus(text) { $("dumpStatus").textContent = text || ""; }

async function initDumpPage() {
  initDumpResizableColumns();
  bindDumpEvents();
  await loadDumpDevices();
  const initial = qParam("serial");
  if (initial && [...$("dumpSerial").options].some(o => o.value === initial)) $("dumpSerial").value = initial;
  if ($("dumpSerial").value) await loadDumpAnalyze();
}

async function loadDumpDevices() {
  const [devicesData, settingsData] = await Promise.all([api("/api/devices"), api("/api/settings")]);
  dumpState.settings = settingsData.settings || dumpState.settings;
  dumpState.devices = (devicesData.devices || []).filter(d => d.state === "device");
  $("dumpSerial").innerHTML = dumpState.devices.map(d => `<option value="${attr(d.serial)}">${escapeHtml(deviceLabel(d.serial))}</option>`).join("");
  if (!dumpState.devices.length) setStatus("没有在线设备，请先确认 adb devices -l 能看到设备");
}

function bindDumpEvents() {
  $("dumpRefresh").addEventListener("click", loadDumpAnalyze);
  $("dumpSerial").addEventListener("change", loadDumpAnalyze);
  $("dumpSearch").addEventListener("input", renderDumpAnalyzer);
  $("dumpShowAll").addEventListener("change", renderDumpAnalyzer);
  $("dumpCopyXml").addEventListener("click", async () => { await navigator.clipboard.writeText(dumpState.xml || ""); setStatus("XML 已复制"); });
  $("dumpBack")?.addEventListener("click", () => location.href = "/");
  $("dumpZoomIn").addEventListener("click", () => setZoom((dumpState.zoom > 0 ? dumpState.zoom : fitDumpZoom()) + 0.1));
  $("dumpZoomOut").addEventListener("click", () => setZoom(Math.max(0.2, (dumpState.zoom > 0 ? dumpState.zoom : fitDumpZoom()) - 0.1)));
  $("dumpZoomReset").addEventListener("click", resetDumpZoomToFit);
  document.querySelectorAll("[data-dump-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      dumpState.view = btn.dataset.dumpView;
      renderDumpAnalyzer();
    });
  });
}

function fitDumpZoom(mode = dumpState.fitMode || "width") {
  const scroll = $("dumpImageScroll");
  const stage = $("dumpStage");
  const baseW = Number(stage.dataset.baseWidth || Math.max(1, ...dumpState.nodes.map(n => n.bounds?.x2 || 0)) || 1);
  const baseH = Number(stage.dataset.baseHeight || Math.max(1, ...dumpState.nodes.map(n => n.bounds?.y2 || 0)) || 1);

  const availableW = Math.max(1, scroll.clientWidth - 24);
  const availableH = Math.max(1, scroll.clientHeight - 24);

  if (mode === "height") {
    return Math.max(0.05, availableH / baseH);
  }
  return Math.max(0.05, availableW / baseW);
}

function currentDumpZoom() {
  return dumpState.zoom > 0 ? dumpState.zoom : fitDumpZoom(dumpState.fitMode || "width");
}

function applyDumpZoom() {
  renderDumpAnalyzer();
}

function setZoom(value) {
  dumpState.zoom = Math.round(value * 100) / 100;
  renderDumpAnalyzer();
}

function resetDumpZoomToFit() {
  dumpState.zoom = 0;
  dumpState.fitMode = "width";
  renderDumpAnalyzer();
}

function resetDumpZoomToHeight() {
  dumpState.zoom = 0;
  dumpState.fitMode = "height";
  renderDumpAnalyzer();
}

async function loadDumpAnalyze() {
  const serial = $("dumpSerial").value;
  if (!serial) return;
  dumpState.serial = serial;
  $("dumpRefresh").disabled = true;
  setStatus("正在截图并 Dump UI...");
  $("dumpStage").innerHTML = `<div class="empty">正在获取截图和 UI XML...</div>`;
  $("dumpTree").innerHTML = "";
  $("dumpDetail").innerHTML = `<div class="empty">等待节点数据...</div>`;
  try {
    const data = await api("/api/device/dump-analyze", { method: "POST", body: JSON.stringify({ serial }) });
    if (!data.ok && !data.xml) throw new Error(data.error || "Dump 失败");
    dumpState.xml = data.xml || "";
    dumpState.screenshot = data.imageData || "";
    dumpState.nodes = parseDumpXml(dumpState.xml);
    const imgSize = await loadImageSize(dumpState.screenshot);
    dumpState.imageWidth = imgSize.width;
    dumpState.imageHeight = imgSize.height;
    dumpState.selectedId = "";
    dumpState.collapsed = defaultCollapsedNodes(dumpState.nodes);
    renderDumpAnalyzer();
    $("dumpImageHint").textContent = data.screenshotPath ? "截图已更新" : "";
    setStatus(`已解析 ${dumpState.nodes.length} 个节点`);
  } catch (error) {
    setStatus(`Dump 失败：${error.message}`);
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
      const raw = Object.fromEntries([...element.attributes].map(a => [a.name, a.value]));
      const node = {
        id, parentId, depth,
        index: raw.index || "",
        text: raw.text || "",
        resourceId: raw["resource-id"] || "",
        className: raw.class || "",
        packageName: raw.package || "",
        contentDesc: raw["content-desc"] || "",
        clickable: raw.clickable === "true",
        enabled: raw.enabled !== "false",
        scrollable: raw.scrollable === "true",
        bounds,
        raw,
        children: []
      };
      nodes.push(node);
      [...element.children].forEach(child => {
        const childId = walk(child, depth + 1, id);
        if (childId !== null && childId !== undefined) node.children.push(String(childId));
      });
      return id;
    } else {
      [...element.children].forEach(child => walk(child, depth, parentId));
    }
    return null;
  };
  walk(doc.documentElement, 0, "");
  const childSet = new Set();
  nodes.forEach(node => (node.children || []).forEach(child => childSet.add(child)));
  nodes.forEach(node => {
    node.hasChildren = (node.children || []).length > 0;
    node.isRoot = !childSet.has(node.id);
  });
  return nodes;
}

function parseBounds(value) {
  const m = String(value || "").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4]);
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), raw: value };
}

function renderDumpAnalyzer() {
  const keyword = $("dumpSearch").value.trim();
  const nodes = dumpState.nodes.filter(node => isNodeVisible(node, keyword));
  renderDumpImage(nodes);
  renderDumpMiddle(nodes, keyword);
  renderDumpDetail(dumpState.selectedId);
  $("dumpTreeHint").textContent = keyword ? `匹配 ${nodes.length}/${dumpState.nodes.length}` : `${dumpState.nodes.length} 节点`;
  document.querySelectorAll("[data-dump-view]").forEach(btn => btn.classList.toggle("blue", btn.dataset.dumpView === dumpState.view));
}

function nodeSearchText(node) { return [node.text, node.contentDesc, node.resourceId, node.className, node.packageName, node.raw?.bounds].join(" ").toLowerCase(); }
function nodeMainValue(node) { return node.text || node.contentDesc || node.resourceId || node.className || `node ${node.id}`; }
function classShort(node) { return String(node.className || "node").split(".").pop() || "node"; }
function nodePrimaryKind(node) {
  if (node.text) return "text";
  if (node.contentDesc) return "desc";
  if (node.resourceId) return "id";
  return "";
}
function nodePrimaryValue(node) {
  return node.text || node.contentDesc || node.resourceId || "";
}
function nodeCompactFlags(node) {
  return [
    node.clickable ? "click" : "",
    node.scrollable ? "scroll" : "",
    node.enabled ? "" : "off"
  ].filter(Boolean);
}
function defaultCollapsedNodes(nodes) {
  return new Set(nodes.filter(node => node.hasChildren && node.depth >= 1).map(node => String(node.id)));
}
function isNodeVisible(node, keyword) {
  const lower = String(keyword || "").toLowerCase();
  if (lower && !nodeSearchText(node).includes(lower)) return false;
  if ($("dumpShowAll").checked) return true;
  return node.clickable || node.text || node.contentDesc || node.resourceId || node.id === dumpState.selectedId;
}

function renderDumpMiddle(nodes, keyword) {
  if (dumpState.view === "xml") {
    $("dumpMiddleTitle").textContent = "原始 XML";
    $("dumpTree").innerHTML = renderXmlReader(dumpState.xml);
    return;
  }
  if (dumpState.view === "list") {
    $("dumpMiddleTitle").textContent = "列表视图";
    renderDumpList(nodes);
    return;
  }
  if (dumpState.view === "matrix") {
    $("dumpMiddleTitle").textContent = "截图矩阵";
    $("dumpTree").innerHTML = `<div class="empty">截图矩阵在左侧，可用缩放和“显示所有节点框”查看 bounds。点击框后会在右侧显示详情。</div>`;
    return;
  }
  $("dumpMiddleTitle").textContent = "树形视图";
  renderDumpTree(treeNodesForView(keyword));
}

function renderXmlReader(xmlText) {
  if (!xmlText) return `<div class="empty">暂无 XML。请先刷新截图 + Dump。</div>`;
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return `<pre class="dump-xml-view">${escapeHtml(xmlText)}</pre>`;
  }
  const lines = [];
  const walk = (element, depth = 0) => {
    if (!element || element.nodeType !== 1) return;
    const attrs = [...element.attributes].map(attrNode => ({
      name: attrNode.name,
      value: attrNode.value
    }));
    const children = [...element.children].filter(child => child.nodeType === 1);
    const important = attrs.filter(item => ["index", "text", "resource-id", "class", "package", "content-desc", "bounds"].includes(item.name));
    const rest = attrs.filter(item => !important.some(known => known.name === item.name));
    const attrHtml = [...important, ...rest].map(item => (
      `<span class="xml-attr"><span class="xml-key">${escapeHtml(item.name)}</span>=<span class="xml-value">"${escapeHtml(item.value)}"</span></span>`
    )).join("");
    lines.push(`<div class="xml-line" style="--xml-depth:${depth}"><span class="xml-indent" aria-hidden="true"></span><span class="xml-tag">&lt;${escapeHtml(element.tagName)}</span>${attrHtml}<span class="xml-tag">${children.length ? "&gt;" : " /&gt;"}</span></div>`);
    children.forEach(child => walk(child, depth + 1));
    if (children.length) {
      lines.push(`<div class="xml-line xml-close" style="--xml-depth:${depth}"><span class="xml-indent" aria-hidden="true"></span><span class="xml-tag">&lt;/${escapeHtml(element.tagName)}&gt;</span></div>`);
    }
  };
  walk(doc.documentElement, 0);
  return `<div class="dump-xml-reader" role="tree" aria-label="展开后的 XML">${lines.join("")}</div>`;
}

function nodeMatchesKeyword(node, keyword) {
  const lower = String(keyword || "").toLowerCase();
  return !lower || nodeSearchText(node).includes(lower);
}

function treeNodesForView(keyword) {
  const lower = String(keyword || "").toLowerCase();
  const byId = new Map(dumpState.nodes.map(node => [node.id, node]));
  const descendantMatches = (node) => !!node && (nodeMatchesKeyword(node, lower) || (node.children || []).some(id => descendantMatches(byId.get(id))));
  return dumpState.nodes.filter(node => {
    if (lower && !descendantMatches(node)) return false;
    let parentId = node.parentId;
    while (parentId) {
      if (!lower && dumpState.collapsed.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId || "";
    }
    return $("dumpShowAll").checked || lower || node.clickable || node.text || node.contentDesc || node.resourceId || node.hasChildren || node.id === dumpState.selectedId;
  });
}

function renderDumpImage(nodes) {
  // 稳定策略：以 XML bounds 作为唯一坐标系。
  // 截图铺满 bounds 画布；节点框也直接画在同一个 bounds 画布上。
  // 这样不会因为截图 naturalSize、浏览器缩放、设备返回尺寸差异导致错位。
  const baseW = Math.max(1, ...dumpState.nodes.map(n => n.bounds?.x2 || 0));
  const baseH = Math.max(1, ...dumpState.nodes.map(n => n.bounds?.y2 || 0));

  const zoom = currentDumpZoom();
  const viewW = Math.round(baseW * zoom);
  const viewH = Math.round(baseH * zoom);

  const boxes = nodes.filter(n => n.bounds).map(n => {
    const b = n.bounds;
    const x = Math.round(b.x1 * zoom);
    const y = Math.round(b.y1 * zoom);
    const w = Math.max(2, Math.round(b.width * zoom));
    const h = Math.max(2, Math.round(b.height * zoom));
    const cls = ["dump-box", n.clickable ? "clickable" : "", (n.text || n.contentDesc) ? "has-text" : "", n.id === dumpState.selectedId ? "selected" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-dump-node-id="${attr(n.id)}" title="${attr(nodeMainValue(n))}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
  }).join("");

  $("dumpStage").dataset.baseWidth = String(baseW);
  $("dumpStage").dataset.baseHeight = String(baseH);
  $("dumpStage").style.width = `${viewW}px`;
  $("dumpStage").style.height = `${viewH}px`;
  $("dumpStage").innerHTML = `
    <div class="dump-stage-inner" style="width:${viewW}px;height:${viewH}px">
      ${dumpState.screenshot ? `<img class="dump-screenshot-img" src="${attr(dumpState.screenshot)}" alt="设备截图">` : ""}
      ${boxes}
    </div>`;
  $("dumpZoomValue").textContent = dumpState.zoom > 0 ? `${Math.round(zoom * 100)}%` : (dumpState.fitMode === "height" ? "适应高度" : "适应宽度");
  $("dumpFitMirror")?.classList.toggle("active", dumpState.zoom === 0 && dumpState.fitMode !== "height");
  $("dumpFitHeightMirror")?.classList.toggle("active", dumpState.zoom === 0 && dumpState.fitMode === "height");
  if (typeof syncDumpZoomMirrorLabel === "function") syncDumpZoomMirrorLabel();

  $("dumpStage").querySelectorAll("[data-dump-node-id]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      selectNode(el.dataset.dumpNodeId, { scrollTree: true });
    });
  });
}

function line(k, v, primary=false) {
  if (v === undefined || v === null || v === "") return "";
  const tag = k === "resource-id" || k === "bounds" || k === "package" || k === "class" ? "code" : "span";
  return `<div class="dump-node-line${primary ? " primary" : ""}"><span class="k">${escapeHtml(k)}</span><${tag} class="v">${escapeHtml(String(v))}</${tag}></div>`;
}

function renderDumpTree(nodes) {
  if (!nodes.length) { $("dumpTree").innerHTML = `<div class="empty">没有匹配节点</div>`; return; }
  $("dumpTree").innerHTML = nodes.map(n => {
    const primaryKind = nodePrimaryKind(n);
    const primaryValue = nodePrimaryValue(n);
    const flags = nodeCompactFlags(n).map(flag => `<span class="dump-node-tag${flag === "click" ? " strong" : ""}">${escapeHtml(flag)}</span>`).join("");
    const childCount = n.children?.length ? `<span class="dump-node-count">${n.children.length}</span>` : "";
    return `<div class="dump-tree-row${n.id === dumpState.selectedId ? " selected" : ""}${n.hasChildren ? " has-children" : ""}" data-dump-row-id="${attr(n.id)}" style="--tree-indent:${Math.min(n.depth * 18, 162)}px">
      <div class="dump-tree-head">
        <span class="dump-tree-rail" aria-hidden="true"></span>
        ${n.hasChildren ? `<button class="dump-collapse" type="button" data-dump-collapse="${attr(n.id)}" aria-expanded="${dumpState.collapsed.has(n.id) ? "false" : "true"}" title="${dumpState.collapsed.has(n.id) ? "展开" : "收起"}">${dumpState.collapsed.has(n.id) ? "▸" : "⌄"}</button>` : `<span class="dump-collapse empty-collapse"></span>`}
        <button class="dump-node-content" type="button" data-dump-tree-id="${attr(n.id)}" title="查看节点详情">
          <span class="dump-node-class">${escapeHtml(classShort(n))}</span>
          ${primaryValue ? `<span class="dump-node-primary" title="${attr(primaryValue)}">${primaryKind ? `<em>${escapeHtml(primaryKind)}</em>` : ""}${escapeHtml(primaryValue)}</span>` : ""}
          ${flags}
          ${childCount}
          <span class="dump-node-depth">#${escapeHtml(n.id)}</span>
        </button>
      </div>
    </div>`;
  }).join("");
  $("dumpTree").querySelectorAll("[data-dump-tree-id]").forEach(el => {
    el.addEventListener("click", () => selectNode(el.dataset.dumpTreeId, { scrollImage: true }));
  });
  $("dumpTree").querySelectorAll("[data-dump-collapse]").forEach(el => el.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const id = el.dataset.dumpCollapse;
    dumpState.collapsed.has(id) ? dumpState.collapsed.delete(id) : dumpState.collapsed.add(id);
    renderDumpAnalyzer();
  }));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyDumpShotWidth(value) {
  const shell = document.querySelector(".dump-workbench");
  if (!shell) return;
  const width = clampNumber(Number(value) || 360, 280, 620);
  shell.style.setProperty("--dump-shot-width", `${Math.round(width)}px`);
}

function initDumpResizableColumns() {
  const saved = Number(localStorage.getItem(DUMP_SHOT_WIDTH_KEY) || 0);
  applyDumpShotWidth(saved || 360);

  const handle = $("dumpShotResizer");
  const shell = document.querySelector(".dump-workbench");
  if (!handle || !shell || handle.dataset.boundResize) return;
  handle.dataset.boundResize = "1";

  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const onMove = event => {
    if (!dragging) return;
    const next = clampNumber(startWidth + event.clientX - startX, 280, 620);
    applyDumpShotWidth(next);
  };
  const onUp = event => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("dump-resizing");
    const rect = document.querySelector(".dump-shot-card")?.getBoundingClientRect();
    if (rect) localStorage.setItem(DUMP_SHOT_WIDTH_KEY, String(Math.round(rect.width)));
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (dumpState.zoom === 0) renderDumpAnalyzer();
  };

  handle.addEventListener("pointerdown", event => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = document.querySelector(".dump-shot-card")?.getBoundingClientRect().width || 360;
    document.body.classList.add("dump-resizing");
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function renderDumpList(nodes) {
  if (!nodes.length) { $("dumpTree").innerHTML = `<div class="empty">没有匹配节点</div>`; return; }
  $("dumpTree").innerHTML = `<div class="dump-list-table">
    <div class="dump-list-row head"><span>class</span><span>text</span><span>desc</span><span>resource-id</span><span>bounds</span><span>flags</span></div>
    ${nodes.map(n => `<div class="dump-list-row${n.id === dumpState.selectedId ? " selected" : ""}" role="button" tabindex="0" data-dump-list-id="${attr(n.id)}">
      <span>${escapeHtml(classShort(n))}</span>
      <span>${escapeHtml(n.text || "")}</span>
      <span>${escapeHtml(n.contentDesc || "")}</span>
      <span>${escapeHtml(n.resourceId || "")}</span>
      <span>${escapeHtml(n.bounds?.raw || n.raw?.bounds || "")}</span>
      <span>${[n.clickable ? "clickable" : "", n.scrollable ? "scrollable" : "", n.enabled ? "" : "disabled"].filter(Boolean).join(" ")}</span>
    </div>`).join("")}
  </div>`;
  $("dumpTree").querySelectorAll("[data-dump-list-id]").forEach(el => {
    el.addEventListener("click", () => selectNode(el.dataset.dumpListId, { scrollImage: true }));
    el.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(el.dataset.dumpListId, { scrollImage: true });
      }
    });
  });
}

function expandNodeAncestors(id) {
  const byId = new Map(dumpState.nodes.map(node => [String(node.id), node]));
  let node = byId.get(String(id));
  let guard = 0;
  while (node && node.parentId && guard < 2000) {
    dumpState.collapsed.delete(String(node.parentId));
    node = byId.get(String(node.parentId));
    guard += 1;
  }
}

function selectNode(id, options={}) {
  dumpState.selectedId = String(id || "");
  // 从截图框点击节点时，如果中间树的父节点被收起，需要先展开全部父链。
  expandNodeAncestors(dumpState.selectedId);
  renderDumpAnalyzer();
  requestAnimationFrame(() => {
    if (options.scrollTree) {
      const target = document.querySelector(`#dumpTree [data-dump-tree-id="${CSS.escape(dumpState.selectedId)}"]`);
      target?.scrollIntoView({ block: "center", inline: "nearest" });
      target?.classList.add("locating");
      setTimeout(() => target?.classList.remove("locating"), 900);
    }
    if (options.scrollImage) {
      document.querySelector(`#dumpStage [data-dump-node-id="${CSS.escape(dumpState.selectedId)}"]`)?.scrollIntoView({ block: "center", inline: "center" });
    }
  });
}

function selectedNode() { return dumpState.nodes.find(n => n.id === dumpState.selectedId) || null; }

function commandCandidates(node) {
  if (!node) return [];
  const b = node.bounds;
  const cmds = [];
  if (node.resourceId) cmds.push({ title: "按 resource-id 点击（最稳定）", text: `tapById("${node.resourceId}")`, addable: true, runnable: true });
  if (node.resourceId) cmds.push({ title: "按 resource-id 长按", text: `longPressId("${node.resourceId}")`, addable: true, runnable: true });
  if (node.resourceId) cmds.push({ title: "等待 resource-id", text: `waitId("${node.resourceId}", 5000)`, addable: true, runnable: true });
  if (node.resourceId) cmds.push({ title: "断言 resource-id", text: `assertId("${node.resourceId}")`, addable: true, runnable: true });
  if (node.text) cmds.push({ title: "按 text 点击", text: `tapText("${node.text.replace(/"/g, '\\"')}", { strict: true })`, addable: true, runnable: true });
  if (node.text) cmds.push({ title: "等待 text", text: `waitText("${node.text.replace(/"/g, '\\"')}", 5000)`, addable: true, runnable: true });
  if (node.text) cmds.push({ title: "断言 text", text: `assertText("${node.text.replace(/"/g, '\\"')}")`, addable: true, runnable: true });
  if (node.contentDesc) cmds.push({ title: "按 desc 点击", text: `tapText("${node.contentDesc.replace(/"/g, '\\"')}", { matchFields: "content-desc", strict: true })`, addable: true, runnable: true });
  if (b) cmds.push({ title: "按中心坐标点击", text: `adb shell input tap ${b.cx} ${b.cy}`, addable: true, runnable: true, runnable: true });
  if (b) cmds.push({ title: "按百分比点击", text: `tapPercent(${(b.cx / Math.max(1, maxScreenX()) * 100).toFixed(2)}, ${(b.cy / Math.max(1, maxScreenY()) * 100).toFixed(2)})`, addable: true, runnable: true });
  if (node.text) cmds.push({ title: "等待 text 再点击", text: `waitTextAndTap("${node.text.replace(/"/g, '\\"')}", 5000)`, addable: true, runnable: true });
  return cmds;
}
function maxScreenX() { return Math.max(1, ...dumpState.nodes.map(n => n.bounds?.x2 || 0)); }
function maxScreenY() { return Math.max(1, ...dumpState.nodes.map(n => n.bounds?.y2 || 0)); }

function renderDumpDetail(id) {
  const node = dumpState.nodes.find(n => n.id === String(id));
  if (!node) {
    $("dumpDetail").innerHTML = `<div class="empty dump-empty-guide">
      <span class="ui-icon-chip">${iconSvg("target")}</span>
      <strong>等待选择节点</strong>
      <span>点击截图中的控件，或在中间选择节点后，这里会显示属性、bounds 和可复制的推荐命令。</span>
    </div>`;
    return;
  }
  const b = node.bounds || {};
  const commands = commandCandidates(node);
  $("dumpDetail").innerHTML = `
    <h2>${escapeHtml(classShort(node))} ${escapeHtml(nodeMainValue(node))}</h2>
    ${line("text", node.text)}${line("resource-id", node.resourceId)}${line("content-desc", node.contentDesc)}${line("class", node.className)}${line("package", node.packageName)}${line("clickable", node.clickable)}${line("enabled", node.enabled)}${line("scrollable", node.scrollable)}${line("bounds", b.raw || node.raw?.bounds)}${line("center", b.cx ? `${b.cx}, ${b.cy}` : "")}
    <h2 class="dump-detail-section-title">推荐命令</h2>
    ${commands.map((c,i)=>`<div class="dump-command-card"><strong>${escapeHtml(c.title)}</strong><code>${escapeHtml(c.text)}</code><div class="row"><button data-copy-cmd="${i}">${iconLabel("copy", "复制")}</button><button class="blue" data-run-cmd="${i}">${iconLabel("play", "执行")}</button></div></div>`).join("") || `<div class="empty">没有可生成命令</div>`}
    <h2 class="dump-detail-section-title">原始属性</h2><pre>${escapeHtml(JSON.stringify(node.raw || {}, null, 2))}</pre>`;
  $("dumpDetail").querySelectorAll("[data-copy-cmd]").forEach(btn => btn.addEventListener("click", async()=>{ await navigator.clipboard.writeText(commands[Number(btn.dataset.copyCmd)].text); setStatus("命令已复制"); }));
  $("dumpDetail").querySelectorAll("[data-run-cmd]").forEach(btn => btn.addEventListener("click", async()=>{ await runAdbCommand(commands[Number(btn.dataset.runCmd)].text, btn); }));
}


async function runAdbCommand(command, button = null) {
  if (!dumpState.serial || !command) {
    setStatus("没有设备或命令为空");
    return;
  }

  const card = button?.closest(".dump-command-card");
  let feedback = card?.querySelector(".dump-command-feedback");
  if (!feedback && card) {
    feedback = document.createElement("div");
    feedback.className = "dump-command-feedback";
    card.appendChild(feedback);
  }

  const oldText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "执行中...";
    button.classList.add("running");
  }
  if (feedback) {
    feedback.className = "dump-command-feedback running";
    feedback.textContent = "正在执行，请稍等...";
  }
  setStatus(`正在执行推荐命令：${command}`);

  try {
    const run = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({
        devices: [dumpState.serial],
        stopOnError: true,
        steps: [{
          kind: "adb_script",
          name: "Dump 推荐命令",
          commands: command,
          continueOnLineError: false,
          continueOnError: false,
          timeout: 30
        }]
      })
    });

    const result = run?.steps?.[0]?.results?.[0];
    const ok = Boolean(run?.ok && (!result || result.ok !== false));
    const summary = result
      ? (result.stdout || result.stderr || result.error || (ok ? "执行成功" : "执行失败"))
      : (ok ? "执行成功" : "执行失败");

    setStatus(ok ? "推荐命令执行成功" : "推荐命令执行失败");

    if (feedback) {
      feedback.className = `dump-command-feedback ${ok ? "ok" : "fail"}`;
      feedback.innerHTML = `
        <strong>${ok ? "✅ 执行成功" : "❌ 执行失败"}</strong>
        <pre>${escapeHtml(String(summary || "").trim() || (ok ? "执行成功" : "执行失败"))}</pre>
      `;
    }
  } catch (error) {
    setStatus(`执行失败：${error.message}`);
    if (feedback) {
      feedback.className = "dump-command-feedback fail";
      feedback.innerHTML = `<strong>❌ 执行失败</strong><pre>${escapeHtml(error.message)}</pre>`;
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "执行";
      button.classList.remove("running");
    }
  }
}

window.addEventListener("resize", () => { if (dumpState.zoom === 0) renderDumpAnalyzer(); });
document.addEventListener("DOMContentLoaded", initDumpPage);


// Dump page redesign mirror controls.
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dumpRefreshMirror")?.addEventListener("click", () => {
    document.getElementById("dumpRefresh")?.click();
  });
  document.getElementById("dumpFitMirror")?.addEventListener("click", () => {
    document.getElementById("dumpZoomReset")?.click();
  });
});



// Dump screenshot-card zoom mirrors.
document.addEventListener("DOMContentLoaded", () => {
  const bindMirror = () => {
    document.getElementById("dumpZoomOutMirror")?.addEventListener("click", () => document.getElementById("dumpZoomOut")?.click());
    document.getElementById("dumpZoomInMirror")?.addEventListener("click", () => document.getElementById("dumpZoomIn")?.click());
    const sync = () => {
      const src = document.getElementById("dumpZoomValue");
      const dst = document.getElementById("dumpZoomValueMirror");
      if (src && dst) dst.textContent = src.textContent || "适应宽度";
    };
    sync();
    const src = document.getElementById("dumpZoomValue");
    if (src && !src.dataset.mirrorObserved) {
      src.dataset.mirrorObserved = "1";
      new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
    }
  };
  bindMirror();
});


function bindFitHeightButton() {
  const btn = document.getElementById("dumpFitHeightMirror");
  if (!btn || btn.dataset.boundFitHeight) return;
  btn.dataset.boundFitHeight = "1";
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    resetDumpZoomToHeight();
  });
}

document.addEventListener("DOMContentLoaded", bindFitHeightButton);
new MutationObserver(bindFitHeightButton).observe(document.documentElement, { childList: true, subtree: true });


function syncDumpZoomMirrorLabel() {
  const src = document.getElementById("dumpZoomValue");
  const dst = document.getElementById("dumpZoomValueMirror");
  if (src && dst) dst.textContent = src.textContent || "适应宽度";
}

document.addEventListener("DOMContentLoaded", () => {
  syncDumpZoomMirrorLabel();
  const src = document.getElementById("dumpZoomValue");
  if (src && !src.dataset.zoomMirrorSync) {
    src.dataset.zoomMirrorSync = "1";
    new MutationObserver(syncDumpZoomMirrorLabel).observe(src, { childList: true, characterData: true, subtree: true });
  }
});
