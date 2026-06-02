/* CQClaw - Storage Center */

const storageById = (id) => document.getElementById(id);

let lastPreview = null;
let currentStorageCategory = "";

const STORAGE_CATEGORY_META = {
  screenshots: {
    icon: "screenshot",
    tone: "blue",
    hint: "截图和设备预览图片，通常可以按时间清理。"
  },
  dump: {
    icon: "dump",
    tone: "purple",
    hint: "截图 + XML Dump 调试产物，数量多时优先清理旧文件。"
  },
  logs: {
    icon: "log",
    tone: "green",
    hint: "运行日志和导入日志，排查结束后可归档或清理。"
  },
  apk: {
    icon: "package",
    tone: "orange",
    hint: "安装包缓存，体积通常较大，清理前确认是否还要复用。"
  },
  app_cache: {
    icon: "app",
    tone: "blue",
    hint: "App 信息、图标和名称缓存，清理后会按需重新生成。"
  },
  default_output: {
    icon: "folder-open",
    tone: "green",
    hint: "默认输出目录，可能包含用户主动导出的文件。"
  },
  local_temp: {
    icon: "storage",
    tone: "orange",
    hint: "本机临时目录和手机文件预览缓存，适合定期清理。"
  },
  tmp_scripts: {
    icon: "script",
    tone: "purple",
    hint: "页面脚本、本机脚本等临时执行文件。"
  },
  workflow_exports: {
    icon: "workflow",
    tone: "green",
    hint: "Workflow 导出文件，确认已分发后再清理。"
  }
};

function storageEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStorageStatus(text) {
  storageById("storageStatus").textContent = text;
}

async function loadStorageStats() {
  setStorageStatus("读取中...");
  storageById("storageRows").innerHTML = `<div class="storage-loading-card">正在扫描本机资源...</div>`;
  storageById("storageSummary").innerHTML = "";
  try {
    const data = await api("/api/storage/stats");
    renderStorageRows(data.categories || []);
    renderStorageSummary(data.categories || []);
    setStorageStatus(`已更新 · ${new Date().toLocaleString()}`);
  } catch (error) {
    setStorageStatus(`读取失败：${error.message}`);
    storageById("storageRows").innerHTML = `<div class="empty-state">资源扫描失败：${storageEscape(error.message)}</div>`;
  }
}

function formatStorageSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function storageIcon(id) {
  return `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${id}"></use></svg>`;
}

function categoryMeta(key) {
  return STORAGE_CATEGORY_META[key] || { icon: "storage", tone: "blue", hint: "本地资源文件。" };
}

function storageTotals(categories) {
  const totalSize = categories.reduce((sum, item) => sum + Number(item.totalSize || 0), 0);
  const totalCount = categories.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const largest = [...categories].sort((a, b) => Number(b.totalSize || 0) - Number(a.totalSize || 0))[0] || null;
  const active = categories.filter((item) => Number(item.count || 0) > 0).length;
  return { totalSize, totalCount, largest, active };
}

function renderStorageSummary(categories) {
  const totals = storageTotals(categories);
  const largestLabel = totals.largest?.label || "暂无占用";
  const largestSize = totals.largest ? storageEscape(totals.largest.totalSizeText || formatStorageSize(totals.largest.totalSize)) : "0 B";
  const recommendation = totals.totalCount
    ? `建议先预览「${largestLabel}」，再按 7 天前规则清理；受保护文件会自动保留。`
    : "当前没有明显缓存压力，可以稍后再扫描。";
  storageById("storageRecommendation").textContent = recommendation;
  storageById("storageSummary").innerHTML = `
    <div class="storage-summary-card">
      <span>${storageIcon("storage")}总占用</span>
      <strong>${storageEscape(formatStorageSize(totals.totalSize))}</strong>
      <em>${totals.totalCount} 个文件</em>
    </div>
    <div class="storage-summary-card">
      <span>${storageIcon("target")}最大来源</span>
      <strong>${storageEscape(largestLabel)}</strong>
      <em>${largestSize}</em>
    </div>
    <div class="storage-summary-card">
      <span>${storageIcon("broom")}可治理类型</span>
      <strong>${totals.active}</strong>
      <em>类资源有文件</em>
    </div>
  `;
}

function renderStorageRows(categories) {
  const maxSize = Math.max(...categories.map((item) => Number(item.totalSize || 0)), 1);
  storageById("storageRows").innerHTML = categories.map((item) => {
    const meta = categoryMeta(item.key);
    const percent = Math.max(3, Math.round((Number(item.totalSize || 0) / maxSize) * 100));
    const isActive = item.key === currentStorageCategory;
    return `
    <article class="storage-row storage-category-card ${isActive ? "is-active" : ""}" data-storage-tone="${storageEscape(meta.tone)}">
      <div class="storage-card-top">
        <span class="storage-card-icon">${storageIcon(meta.icon)}</span>
        <span class="badge badge-muted">${item.count} 个</span>
      </div>
      <div class="storage-card-main">
        <strong>${storageEscape(item.label)}</strong>
        <span>${storageEscape(item.totalSizeText)}</span>
      </div>
      <div class="storage-card-meter" aria-hidden="true"><i style="--storage-meter:${percent}%"></i></div>
      <p>${storageEscape(meta.hint)}</p>
      <div class="storage-card-footer">
        <span class="storage-meta">${storageEscape(item.lastModified || "暂无修改记录")}</span>
        <span class="storage-actions">
          <button class="btn btn-secondary" type="button" data-preview-category="${storageEscape(item.key)}">${storageIcon("eye")}预览</button>
          <button class="btn btn-danger" type="button" data-clean-category="${storageEscape(item.key)}">${storageIcon("trash")}清理</button>
        </span>
      </div>
    </article>`;
  }).join("");
  if (!categories.length) {
    storageById("storageRows").innerHTML = `<div class="empty-state">没有可治理的缓存类别。</div>`;
  }
}

function setActiveStorageCategory(category) {
  currentStorageCategory = category || "";
  document.querySelectorAll(".storage-category-card").forEach((card) => {
    card.classList.toggle("is-active", card.querySelector("[data-preview-category]")?.dataset.previewCategory === currentStorageCategory);
  });
}

function categoryLabel(category) {
  if (category === "older_than_days") return "7 天前文件";
  const option = storageById("previewCategory")?.querySelector(`option[value="${CSS.escape(category)}"]`);
  return option?.textContent || category || "资源";
}

function renderPreviewEmpty() {
  storageById("storagePreview").innerHTML = `
    <div class="storage-preview-empty">
      ${storageIcon("broom")}
      <strong>先预览，再清理</strong>
      <span>选择左侧资源类型，或使用 7 天前规则，确认文件列表后再执行清理。</span>
    </div>
  `;
}

function previewPayload(category, olderThanDays) {
  const payload = { category, limit: 300 };
  const days = Number(olderThanDays);
  if (Number.isFinite(days) && days > 0) payload.olderThanDays = days;
  return payload;
}

async function previewStorage(category, olderThanDays = "") {
  const payload = previewPayload(category, olderThanDays);
  lastPreview = payload;
  setActiveStorageCategory(category);
  storageById("previewMeta").textContent = `正在预览 ${categoryLabel(category)}...`;
  storageById("storagePreview").innerHTML = `<div class="storage-loading-card">正在生成清理预览...</div>`;
  try {
    const data = await api("/api/storage/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    storageById("previewMeta").textContent = `${categoryLabel(category)} · 可清理 ${data.count} 个 · ${data.totalSizeText}${data.truncated ? " · 已截断" : ""}`;
    renderPreview(data.items || []);
  } catch (error) {
    storageById("previewMeta").textContent = `预览失败：${error.message}`;
  }
}

function renderPreview(items) {
  storageById("storagePreview").innerHTML = items.length ? items.map((item) => `
    <div class="storage-preview-row">
      <span class="storage-preview-kind">${storageIcon(categoryMeta(item.category).icon)}</span>
      <div>
        <strong>${storageEscape(item.label || item.category)}</strong>
        <span class="storage-path">${storageEscape(item.path)}</span>
      </div>
      <span class="storage-meta">${storageEscape(item.sizeText)} · ${storageEscape(item.modified)}</span>
    </div>
  `).join("") : `<div class="storage-preview-empty">${storageIcon("shield")}<strong>没有匹配文件</strong><span>当前筛选下没有可清理资源，或者文件仍受保护。</span></div>`;
}

async function cleanStorage(payload) {
  const confirmed = window.confirm("确认清理预览中的文件？这会逐个删除文件，受保护文件会自动跳过。");
  if (!confirmed) return;
  try {
    const data = await api("/api/storage/clean", {
      method: "POST",
      body: JSON.stringify({ ...payload, confirm: true }),
    });
    storageById("previewMeta").textContent = `已清理 ${data.deletedCount} 个 · 释放 ${data.freedSizeText}`;
    renderPreview(data.deleted || []);
    await loadStorageStats();
  } catch (error) {
    storageById("previewMeta").textContent = `清理失败：${error.message}`;
  }
}

function bindStorageEvents() {
  storageById("refreshStorageBtn").addEventListener("click", loadStorageStats);
  storageById("previewCategoryBtn").addEventListener("click", () => {
    previewStorage(storageById("previewCategory").value, storageById("olderThanDays").value);
  });
  storageById("previewOldBtn").addEventListener("click", () => previewStorage("older_than_days", 7));
  storageById("cleanOldBtn").addEventListener("click", () => cleanStorage({ category: "older_than_days", olderThanDays: 7 }));
  document.addEventListener("click", (event) => {
    const preview = event.target.closest("[data-preview-category]");
    const clean = event.target.closest("[data-clean-category]");
    if (preview) {
      storageById("previewCategory").value = preview.dataset.previewCategory;
      previewStorage(preview.dataset.previewCategory, storageById("olderThanDays").value);
    }
    if (clean) {
      cleanStorage(previewPayload(clean.dataset.cleanCategory, storageById("olderThanDays").value));
    }
  });
}

bindStorageEvents();
renderPreviewEmpty();
loadStorageStats();
