(function () {
  const NAV_ITEMS = [
    { href: '/', label: '工作台', short: '工作台', icon: 'home' },
    { href: '/log-insight.html', label: '日志洞察', short: '日志', icon: 'log' },
    { href: '/automation.html', label: '自动化', short: '自动化', icon: 'workflow' },
    { href: '/device-manager.html', label: '设备', short: '设备', icon: 'device' },
    { href: '/dump.html', label: '节点解析', short: '节点', icon: 'dump' },
    { href: '/storage-center.html', label: '资源中心', short: '资源', icon: 'storage' },
    { href: '/settings.html', label: '设置', short: '设置', icon: 'settings' },
  ];

  function icon(name) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${name}"></use></svg>`;
  }

  function normalize(pathname) {
    if (!pathname || pathname === '/index.html') return '/';
    return pathname;
  }

  function buildSideNav() {
    const body = document.body;
    if (!body || !body.classList.contains('cq-side-nav-page')) return;
    if (document.querySelector('.cq-side-nav')) return;
    const current = normalize(window.location.pathname);
    const aside = document.createElement('aside');
    aside.className = 'cq-side-nav';
    aside.setAttribute('aria-label', 'CQClaw 主导航');
    const links = NAV_ITEMS.map((item) => {
      const active = normalize(item.href) === current;
      return `<a class="cq-side-link${active ? ' active' : ''}" href="${item.href}" title="${item.label}"${active ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${item.short}</span></a>`;
    }).join('');
    aside.innerHTML = `
      <a class="cq-side-brand" href="/" title="CQClaw 工作台">
        <span class="cq-side-brand-mark">${icon('terminal')}</span>
        <strong>CQ</strong>
      </a>
      <nav class="cq-side-links" aria-label="主导航">${links}</nav>
      <button class="cq-side-theme" type="button" data-theme-toggle aria-label="切换主题" title="切换主题">${icon('moon')}</button>
    `;
    body.insertBefore(aside, body.firstChild);
    body.classList.add('has-cq-side-nav');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSideNav);
  } else {
    buildSideNav();
  }
})();
