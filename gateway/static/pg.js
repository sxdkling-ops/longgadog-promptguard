// Shared app shell for the gateway pages: sidebar, top bar, theme toggle, local-AI status, toasts, icons.
// Load synchronously right after <div id="shell"></div> so the shell is in place before the page paints.
(() => {
  const ICONS = {
    shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.700-7-5.500-7-10V6l7-3zM9 12l2 2 4-4',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    chat: 'M21 12a8 8 0 0 1-11.6 7.100L4 20l1-4.500A8 8 0 1 1 21 12z',
    menu: 'M4 6h16M4 12h16M4 18h16',
    x: 'M6 6l12 12M18 6L6 18',
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.600 5.600L4.200 4.200M19.800 19.800l-1.400-1.400M5.600 18.400l-1.400 1.400M19.800 4.200l-1.400 1.400M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    moon: 'M21 12.800A9 9 0 1 1 11.200 3a7 7 0 0 0 9.800 9.800z',
    alert: 'M12 9v4M12 17h.01M10.300 3.900L2.400 18a2 2 0 0 0 1.700 3h15.800a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z',
    info: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
    check: 'M20 6L9 17l-5-5',
    checkCircle: 'M9 12l2 2 4-4M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
    lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
    clip: 'M21 11.500l-8.600 8.600a5.500 5.500 0 0 1-7.800-7.800l8.600-8.600a3.700 3.700 0 0 1 5.200 5.200l-8.600 8.600a1.800 1.800 0 0 1-2.600-2.600l7.900-7.900',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    search: 'M21 21l-4.300-4.300M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
    sort: 'M8 9l4-4 4 4M8 15l4 4 4-4',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.500 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.500-7z',
    cloud: 'M17.500 19a4.500 4.500 0 0 0 .500-9A6 6 0 0 0 6.300 11.200 4 4 0 0 0 7 19h10.500z',
  };
  const NAV = [
    { group: 'Monitor', items: [{ id: 'dashboard', href: '/dashboard', label: 'Audit overview', icon: 'chart' }] },
    { group: 'Policy', items: [{ id: 'policy', href: '/policy', label: 'Detection policy', icon: 'list' }] },
    { group: 'Demo', items: [{ id: 'proof', href: '/proof', label: 'Local proof', icon: 'shield' }] },
  ];

  const icon = (name, cls) => `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  const current = document.body.dataset.page;
  const root = document.documentElement;

  document.getElementById('shell').innerHTML = `
    <div class="backdrop" id="pg-backdrop" hidden></div>
    <aside class="sidebar" id="pg-sidebar" aria-label="Main navigation">
      <div class="side-brand"><span class="brand-mark">${icon('shield')}</span>
        <div><div class="brand-name">PromptGuard PH</div><div class="brand-sub">Local AI firewall</div></div></div>
      <nav class="nav">${NAV.map((g) => `<div><div class="nav-group" id="g-${g.group}">${g.group}</div><ul aria-labelledby="g-${g.group}">${g.items.map((i) =>
        `<li><a href="${i.href}"${i.id === current ? ' aria-current="page"' : ''}>${icon(i.icon)}${i.label}</a></li>`).join('')}</ul></div>`).join('')}</nav>
    </aside>
    <header class="topbar">
      <button class="icon-btn menu-btn" id="pg-menu" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="pg-sidebar">${icon('menu')}</button>
      <span class="spacer"></span>
      <span class="badge" id="pg-llm" role="status">Checking local AI…</span>
      <button class="icon-btn" id="pg-theme" type="button"></button>
    </header>
    <div class="toasts" id="pg-toasts" role="status" aria-live="polite"></div>`;

  // ----- mobile drawer -----
  const sidebar = document.getElementById('pg-sidebar'), backdrop = document.getElementById('pg-backdrop'), menu = document.getElementById('pg-menu');
  function setDrawer(open) {
    sidebar.classList.toggle('open', open);
    backdrop.hidden = !open;
    menu.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a').focus(); else menu.focus();
  }
  menu.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false); });

  // ----- theme -----
  const themeBtn = document.getElementById('pg-theme');
  function paintTheme() {
    const dark = root.classList.contains('dark');
    root.dataset.theme = dark ? 'dark' : 'light';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  themeBtn.addEventListener('click', () => {
    const dark = !root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    try { localStorage.setItem('pgph.theme', dark ? 'dark' : 'light'); } catch (_) { /* storage blocked */ }
    paintTheme();
  });
  paintTheme();

  // ----- local AI status -----
  const llm = document.getElementById('pg-llm');
  async function health() {
    try {
      const h = await fetch('/health').then((r) => r.json());
      llm.className = 'badge ' + (h.llm.available ? 'green' : 'amber');
      llm.innerHTML = icon(h.llm.available ? 'check' : 'alert') + (h.llm.available ? `Local AI: ${h.llm.model}` : 'Local AI off');
      llm.title = h.llm.available ? 'Runs on this device through Ollama' : h.llm.reason;
    } catch (_) {
      llm.className = 'badge red';
      llm.innerHTML = icon('alert') + 'Gateway offline';
    }
  }
  health();
  setInterval(health, 5000);

  function toast(message, tone) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = icon(tone === 'error' ? 'alert' : 'checkCircle');
    el.append(message);
    document.getElementById('pg-toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }

  window.PG = { icon, toast };
})();
