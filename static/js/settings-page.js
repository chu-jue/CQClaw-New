(async function(){
  const $ = id => document.getElementById(id);
  async function api(path, options){ const r = await fetch(path, {headers:{'Content-Type':'application/json'}, ...(options||{})}); return r.json(); }
  const state = { settings: {} };
  function status(msg){ $('settingsStatus').textContent = msg; }
  async function load(){
    const data = await api('/api/settings');
    state.settings = {adbPath:'adb', quickOutputDir:'', localTempDir:'', agentApkPath:'', ...(data.settings||{})};
    ['adbPath','quickOutputDir','localTempDir','agentApkPath'].forEach(k => $(k).value = state.settings[k] || '');
    if (data.effectiveAgentApkPath) $('agentApkPath').placeholder = `企业默认：${data.effectiveAgentApkPath}`;
    status('设置已读取。修改后点击右上角“保存设置”。');
  }
  async function save(){
    ['adbPath','quickOutputDir','localTempDir','agentApkPath'].forEach(k => state.settings[k] = $(k).value.trim());
    if (!state.settings.adbPath) state.settings.adbPath = 'adb';
    const data = await api('/api/settings', {method:'POST', body: JSON.stringify({settings: state.settings})});
    status(data.ok ? '保存成功。' : '保存失败。');
    await load();
  }
  async function pick(inputId, options){
    const data = await api('/api/pick-path', {method:'POST', body: JSON.stringify(options)});
    if (data.ok && data.path) { $(inputId).value = data.path; await save(); }
  }
  $('saveSettings').addEventListener('click', save);
  $('pickAdbPath').addEventListener('click', () => pick('adbPath', {mode:'file', title:'选择 adb 可执行文件', filter:'ADB (adb.exe;adb)|adb.exe;adb|所有文件 (*.*)|*.*'}));
  $('pickQuickOutputDir').addEventListener('click', () => pick('quickOutputDir', {mode:'directory', title:'选择默认输出目录'}));
  $('pickLocalTempDir').addEventListener('click', () => pick('localTempDir', {mode:'directory', title:'选择本机临时目录'}));
  $('pickAgentApkPath').addEventListener('click', () => pick('agentApkPath', {mode:'file', title:'选择 CQClawAgent.apk', filter:'Android APK (*.apk)|*.apk|所有文件 (*.*)|*.*'}));
  try { await load(); } catch(e) { status('读取失败：' + e.message); }
})();
