(async function(){
  const $ = id => document.getElementById(id);
  async function api(path, options){ const r = await fetch(path, {headers:{'Content-Type':'application/json'}, ...(options||{})}); return r.json(); }
  function row(label, value, tone='') { return `<div class="cq-status-row"><span>${label}</span><b class="${tone}">${value || '—'}</b></div>`; }
  async function loadDevices(){
    const top=$('topDevicePill'), badge=$('deviceBadge'), box=$('deviceSummary'), hero=$('heroDeviceCount');
    try{
      const data = await api('/api/devices');
      const devices = data.devices || [];
      const online = devices.filter(d=>d.state==='device');
      hero.textContent = online.length;
      top.innerHTML = `<svg class="ui-icon"><use href="/assets/icons/cqclaw-ui-icons.svg#device"></use></svg><span>${online[0]?.alias || online[0]?.serial || (online.length? '已连接设备':'未连接设备')}</span>`;
      badge.textContent = online.length ? `${online.length} 台在线` : '无在线设备';
      badge.className = 'cq-badge ' + (online.length ? 'success' : 'warning');
      box.innerHTML = row('在线设备', `${online.length} / ${devices.length}`) + row('当前设备', online[0]?.serial || '请连接后刷新') + row('状态', data.ok ? 'ADB 可用' : 'ADB 异常', data.ok ? 'ok':'bad');
    }catch(e){ box.innerHTML = row('设备读取失败', e.message, 'bad'); badge.textContent='异常'; badge.className='cq-badge danger'; }
  }
  async function loadSettings(){
    const box=$('envSummary');
    try{
      const data = await api('/api/settings'); const s = data.settings || {};
      box.innerHTML = row('ADB', s.adbPath || 'adb') + row('输出目录', s.quickOutputDir || '未设置') + row('临时目录', s.localTempDir || '未设置') + row('Agent APK', s.agentApkPath || data.effectiveAgentApkPath || '可选');
    }catch(e){ box.innerHTML = row('设置读取失败', e.message, 'bad'); }
  }
  async function loadProfiles(){
    const box=$('profileSummary'), badge=$('profileBadge');
    try{
      const data = await api('/api/profiles'); const ps = data.profiles || [];
      badge.textContent = `${ps.length} 个`;
      box.innerHTML = ps.slice(0,3).map(p=>row(p.name || '未命名方案', `${(p.steps||[]).length} 步`)).join('') || '<span class="cq-muted">还没有保存方案，去自动化页创建第一个工作流。</span>';
    }catch(e){ box.innerHTML = row('方案读取失败', e.message, 'bad'); }
  }
  $('refreshDevices')?.addEventListener('click', loadDevices);
  await Promise.all([loadDevices(), loadSettings(), loadProfiles()]);
})();
