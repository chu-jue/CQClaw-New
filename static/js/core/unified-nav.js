(function () {
  const ITEMS = [
    { href: '/', label: '工作台', icon: 'home', match: p => p === '/' || p.endsWith('/index.html') },
    { href: '/log-insight.html', label: '日志洞察', icon: 'log', match: p => p.endsWith('/log-insight.html') },
    { href: '/automation.html', label: '自动化', icon: 'workflow', match: p => p.endsWith('/automation.html') },
    { href: '/device-manager.html', label: '设备', icon: 'device', match: p => p.endsWith('/device-manager.html') },
    { href: '/dump.html', label: '节点解析', icon: 'dump', match: p => p.endsWith('/dump.html') },
    { href: '/storage-center.html', label: '资源中心', icon: 'storage', match: p => p.endsWith('/storage-center.html') },
    { href: '/settings.html', label: '设置', icon: 'settings', match: p => p.endsWith('/settings.html') }
  ];

  function icon(id) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons/cqclaw-ui-icons.svg#${id}"></use></svg>`;
  }

  function buildNav() {
    const path = window.location.pathname || '/';
    const nav = document.createElement('nav');
    nav.className = 'main-tabs cq-unified-topnav';
    nav.setAttribute('aria-label', '工作区导航');
    nav.innerHTML = ITEMS.map(item => {
      const active = item.match(path);
      return `<a class="nav-tab${active ? ' active' : ''}" href="${item.href}"${active ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span></a>`;
    }).join('');
    return nav;
  }

  function normalizeTopNav() {
    const containers = Array.from(document.querySelectorAll('.app-header-right.app-nav'));
    containers.forEach(container => {
      const oldNavs = Array.from(container.querySelectorAll('nav.main-tabs, nav.cq-unified-topnav, nav[aria-label="工作区导航"]'));
      const fresh = buildNav();
      if (oldNavs.length) {
        oldNavs[0].replaceWith(fresh);
        oldNavs.slice(1).forEach(n => n.remove());
      } else {
        const themeBtn = container.querySelector('[data-theme-toggle], .theme-switch-btn');
        container.insertBefore(fresh, themeBtn || null);
      }
    });

    /* Clean duplicated legacy navs left by older HTML patches, but never touch the fresh nav. */
    const canonical = new Set(Array.from(document.querySelectorAll('.app-header-right.app-nav > .cq-unified-topnav')));
    document.querySelectorAll('nav.main-tabs, nav[aria-label="工作区导航"]').forEach(nav => {
      if (!canonical.has(nav) && !nav.closest('.app-header-right.app-nav')) {
        nav.remove();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', normalizeTopNav);
  } else {
    normalizeTopNav();
  }
})();
