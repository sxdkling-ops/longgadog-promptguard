// PromptGuard PH content script. Runs on every website. On AI, mail, chat and social sites everything pasted, typed
// or uploaded is guarded; on all other sites pasted text and uploads are. An absolute guard: everything is
// checked by the local gateway first and sanitized automatically. There is nothing for the user to click, switch off
// or configure, and no original value is kept or shown. If the gateway cannot be reached, sending is blocked.
(() => {
  const root = document.documentElement;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
  const adapter = (globalThis.PGPH_ADAPTERS || []).find((a) => a.match(location));
  if (!adapter) return;
  // When the extension is installed or updated it is injected into tabs that are already open. A copy left over
  // from an earlier version may still be in the page: this copy takes over, and the older one goes quiet because
  // every listener first checks that its copy is still the current one.
  const EPOCH = Date.now() + '-' + Math.random().toString(36).slice(2);
  root.dataset.pgph = EPOCH;
  const current = () => root.dataset.pgph === EPOCH;
  const listen = (type, handler, capture) => document.addEventListener(type, (e) => { if (current()) return handler(e); }, capture);
  const stale = document.getElementById('pgph-host');
  if (stale) stale.remove();
  const FULL = adapter.mode === 'full';      // typed text is guarded too (AI, mail, chat and social sites)
  const TOP = window.top === window;

  const MAX_FILE = 20 * 1024 * 1024;
  const OFFLINE = 'PromptGuard cannot reach the local gateway, so nothing can be sent. Ask IT to start it.';
  const sid = crypto.randomUUID();
  const llmCache = new Map();
  let cleared = null;
  let verified = null;
  let bypassSend = false;
  let busy = false;

  async function gw(path, body) {
    const r = await chrome.runtime.sendMessage({ pgph: true, path, body });
    if (!r || !r.ok) throw new Error(r ? r.error : 'no response');
    return r.data;
  }

  // Slow checks (local AI, OCR) run as a job on the gateway that is polled, so no single request stays open for long.
  async function gwJob(path, body) {
    const started = await gw(path, { ...body, background: true });
    if (!started.job) return started;
    for (let i = 0; i < 1200; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      const r = await gw('/job/' + started.job);
      if (r.done) return r.result;
    }
    throw new Error('check timed out');
  }

  const scan = (text, llm) => (llm ? gwJob : gw)('/scan', { session_id: sid, text, llm, site: adapter.name });

  function llmScan(text) {
    if (!llmCache.has(text)) {
      if (llmCache.size >= 8) llmCache.delete(llmCache.keys().next().value);
      llmCache.set(text, scan(text, true).catch(() => null));
    }
    return llmCache.get(text);
  }

  const logDecision = (d) => gw('/decision', { site: adapter.name, ...d }).catch(() => {});
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const tally = (counts) => Object.entries(counts).map(([t, n]) => `${t} ×${n}`).join(', ');
  function countTypes(findings) {
    const counts = {};
    for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1;
    return counts;
  }

  // ---------- composer helpers ----------
  const isField = (el) => el.matches('textarea, input');
  const getText = (el) => (isField(el) ? el.value : el.innerText);

  function setFieldValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setText(el, text) {
    el.focus();
    if (isField(el)) return setFieldValue(el, text);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }

  function insertAtCursor(el, text) {
    el.focus();
    if (isField(el)) {
      const s = el.selectionStart, e = el.selectionEnd;
      setFieldValue(el, el.value.slice(0, s) + text + el.value.slice(e));
      el.selectionStart = el.selectionEnd = s + text.length;
    } else {
      document.execCommand('insertText', false, text);
    }
  }

  // ---------- UI: a passive status pill and notices. Nothing here is clickable (pointer-events: none). ----------
  const SVG = 'http://www.w3.org/2000/svg';
  const ICONS = {
    shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    info: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
    lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  };

  function icon(name) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function h(tag, cls, ...kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    for (const kid of kids) if (kid != null && kid !== '') el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap {
      --brand-300: oklch(85.5% 0.138 181.071); --brand-700: oklch(51.1% 0.096 186.391);
      --surface: #fff; --text: #0f172a; --muted: #475569; --border: #e2e8f0; --red: #991b1b; --red-bg: #fee2e2; --accent: var(--brand-700);
      --shadow: 0 10px 15px -3px rgb(0 0 0 / .15), 0 4px 6px -4px rgb(0 0 0 / .1);
      font: 16px/1.5 system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: var(--text); pointer-events: none;
    }
    .wrap.dark { --surface: #1e293b; --text: #f1f5f9; --muted: #cbd5e1; --border: #334155; --red: #fecaca; --red-bg: #450a0a; --accent: var(--brand-300);
      --shadow: 0 10px 15px -3px rgb(0 0 0 / .6), 0 4px 6px -4px rgb(0 0 0 / .5); }
    .icon { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
    .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px 6px 10px;
      border-radius: 999px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); font-size: 14px; font-weight: 600; }
    .pill .icon { color: var(--accent); }
    .pill.off { background: var(--red-bg); color: var(--red); border-color: var(--red); }
    .pill.off .icon { color: var(--red); }
    .toasts { position: fixed; right: 16px; bottom: 64px; z-index: 2147483001; display: grid; gap: 8px; width: min(26rem, calc(100vw - 32px)); }
    .toast { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border);
      box-shadow: var(--shadow); font-size: 15px; overflow-wrap: anywhere; }
    .toast .icon { color: var(--accent); margin-top: 2px; }
    .toast strong { display: block; }
    .toast span { color: var(--muted); }
    .toast.error { border-color: var(--red); }
    .toast.error .icon { color: var(--red); }
    @media (prefers-reduced-motion: no-preference) { .toast { animation: rise .2s ease-out; } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
  `;

  let ui = null;
  function isDark() {
    if (root.classList.contains('dark')) return true;
    if (root.classList.contains('light')) return false;
    const body = document.body ? document.body.className : '';
    if (/\bdark(-theme)?\b/.test(body)) return true;
    if (/\blight(-theme)?\b/.test(body)) return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function getUi() {
    if (ui) return ui;
    const host = document.createElement('div');
    host.id = 'pgph-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    const wrap = h('div', 'wrap');
    const label = h('span', null, 'PromptGuard on');
    const pill = h('div', 'pill', icon('shield'), label);
    pill.setAttribute('role', 'status');
    pill.hidden = !(FULL && TOP);            // on ordinary sites the pill only appears if the guard goes offline
    const toasts = h('div', 'toasts');
    toasts.setAttribute('role', 'status');
    toasts.setAttribute('aria-live', 'polite');
    wrap.append(pill, toasts);
    shadow.append(h('style', null, CSS), wrap);
    (document.body || root).append(host);
    const paint = () => wrap.classList.toggle('dark', isDark());
    paint();
    new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['class'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
    ui = { pill, label, toasts };
    return ui;
  }

  function setOnline(online) {
    const { pill, label } = getUi();
    pill.classList.toggle('off', !online);
    pill.hidden = online ? (!(FULL && TOP) || mascotAlive) : !TOP;
    pill.replaceChild(icon(online ? 'shield' : 'alert'), pill.firstChild);
    label.textContent = online ? 'PromptGuard on' : 'PromptGuard offline: sending blocked';
  }

  // When the desktop mascot is running, everything the guard has to say goes into its speech bubbles and nothing
  // is drawn on the page. Without the mascot, notices appear on the page as before.
  let mascotAlive = false;
  function refreshMascot() {
    // Also tells the gateway that this tab is being watched, so the mascot can spot a tab that is not.
    return gw('/tab', { title: document.title, site: adapter.name }).then((health) => {
      mascotAlive = !!health.mascot;
      if (ui) ui.pill.hidden = !(FULL && TOP) || mascotAlive;
      return true;
    }, () => { mascotAlive = false; return false; });
  }
  if (TOP) {
    const timer = setInterval(() => {
      if (!current()) return clearInterval(timer);
      if (document.visibilityState === 'visible') refreshMascot();
    }, 3000);
    addEventListener('focus', () => { if (current()) refreshMascot(); });
  }

  function toast(title, detail, kind, ms) {
    if (mascotAlive) {
      const mood = kind === 'error' ? 'angry' : kind === 'busy' ? 'busy' : /replaced/.test(title) ? 'angry' : /checked|protected/i.test(title) ? 'happy' : '';
      gw('/notice', { title, text: detail || '', mood, site: adapter.name }).catch(() => {});
      let open = kind === 'busy';
      return { remove() { if (open) { open = false; gw('/notice', { title: '', text: '', mood: 'done', site: adapter.name }).catch(() => {}); } } };
    }
    const el = h('div', 'toast ' + (kind || ''), icon(kind === 'error' ? 'lock' : kind === 'busy' ? 'info' : 'shield'),
      h('div', null, h('strong', null, title), detail && h('span', null, detail)));
    getUi().toasts.append(el);
    if (ms !== 0) setTimeout(() => el.remove(), ms || 7000);
    return el;
  }

  const offline = () => { setOnline(false); toast('Sending blocked', OFFLINE, 'error', 9000); };

  // ---------- typed text: checked and sanitized when the user sends ----------
  // Everything that leaves with the message: the body, plus the subject line on mail sites.
  const fieldsOf = (composer) => (composer ? [composer, ...adapter.extras(composer)].filter((f) => getText(f).trim()) : []);
  const keyOf = (fields) => fields.map(getText).join('\u0001');
  function needsCheck(composer) {
    const fields = fieldsOf(composer);
    const key = keyOf(fields);
    return fields.length > 0 && key !== cleared && key !== verified;
  }

  // In a mail body the text is replaced piece by piece, so formatting, links and pictures stay as they are.
  // The sender's own signature block is not rewritten.
  const PART = '\n␞\n';
  const SIGNATURE = '[class*="signature" i], [id*="signature" i], [data-smartmail*="signature" i]';
  function textPieces(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest(SIGNATURE))) nodes.push(n);
    }
    return nodes;
  }

  /** Checks one field with rules and the local AI and sanitizes it in place. Returns the scan result, or null. */
  async function checkField(field, rulesOnly) {
    const rich = adapter.mail && !isField(field);
    const nodes = rich ? textPieces(field) : null;
    if (rich && !nodes.length) return { findings: [] };
    const text = rich ? nodes.map((n) => n.nodeValue).join(PART) : getText(field);
    const res = rulesOnly ? await scan(text, false) : await llmScan(text);
    if (!res || res.refused || !res.findings.length) return res;
    const parts = rich ? res.sanitized.split(PART) : null;
    if (rich && parts.length === nodes.length) {
      nodes.forEach((n, i) => { if (n.nodeValue !== parts[i]) n.nodeValue = parts[i]; });
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setText(field, rich ? parts.join('\n') : res.sanitized);
    }
    return res;
  }

  // Sites differ in what makes their Send button act: a click, or the mouse going down or up. So the whole press is
  // replayed once the message has been checked.
  function fireSend(button) {
    bypassSend = true;
    try {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        button.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      }
    } finally {
      bypassSend = false;
    }
  }

  async function guardSend(ev, composer) {
    if (bypassSend || !needsCheck(composer)) return;
    if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    if (busy) return;
    busy = true;
    const fields = fieldsOf(composer);
    const waiting = toast('Checking on this device…', null, 'busy', 0);
    try {
      await scan(getText(fields[0]).slice(0, 2000), false);     // quick call: is the gateway there at all?
      setOnline(true);
      // Strict: the local AI check must run on every field. If it cannot, nothing is sent.
      const counts = {};
      let total = 0;
      for (const field of fields) {
        const res = await checkField(field);
        if (!res || res.refused) {
          waiting.remove();
          toast('Sending blocked', res ? res.refused : 'The local AI check did not answer, so this cannot be verified.', 'error', 9000);
          return;
        }
        total += res.findings.length;
        for (const [type, n] of Object.entries(countTypes(res.findings))) counts[type] = (counts[type] || 0) + n;
      }
      waiting.remove();
      if (total) {
        await new Promise((ok) => setTimeout(ok, 60));
        logDecision({ source: 'typed', action: 'redacted', counts, llm: true });
        toast(`${plural(total, 'item')} replaced before sending`, tally(counts));
      }
      cleared = keyOf(fieldsOf(composer));
      const button = adapter.sendButton(composer);
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        fireSend(button);
      } else {
        toast('Checked on this device', 'Press Send again to send the safe text.');
      }
    } catch (_) {
      offline();
    } finally {
      waiting.remove();
      busy = false;
    }
  }

  listen('keydown', (e) => {
    if (!FULL || e.isComposing) return;
    // The Send button itself, reached with the keyboard.
    if ((e.key === 'Enter' || e.key === ' ') && adapter.isSend(e.target)) { guardSend(e, adapter.composer()); return; }
    if (e.key !== 'Enter') return;
    // Ctrl+Enter sends almost everywhere. Plain Enter sends in chat boxes, but is a new line in mail.
    const sends = (e.ctrlKey || e.metaKey) || (!e.shiftKey && adapter.enterSends);
    if (!sends) return;
    const composer = adapter.composer(e.target);
    if (composer) guardSend(e, composer);
  }, true);

  // A press on a Send button is stopped from its very first event, because some sites send on mouse-down or mouse-up.
  let swallowUntil = 0;
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    listen(type, (e) => {
      if (!FULL || bypassSend || (e.button !== undefined && e.button !== 0) || !adapter.isSend(e.target)) return;
      const composer = adapter.composer();
      if (!needsCheck(composer)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowUntil = Date.now() + 1500;
      guardSend(null, composer);
    }, true);
  }
  for (const type of ['pointerup', 'mouseup', 'touchend', 'click']) {
    listen(type, (e) => {
      if (!FULL || bypassSend || !adapter.isSend(e.target)) return;
      if (Date.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (type === 'click') guardSend(e, adapter.composer());
    }, true);
  }

  // Guard while typing: each time the user pauses, the box is checked and anything sensitive is replaced on the spot,
  // first by the fast rules and then by the local AI. Nothing waits for Send. If the text is clean, Send later goes
  // straight through with no delay.
  let warmTimer = null, liveBusy = false;
  listen('input', (e) => {
    const composer = FULL && adapter.composer(e.target);
    if (!composer || e.isComposing) return;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(async () => {
      if (liveBusy || busy || !getText(composer).trim() || getText(composer) === cleared) return;
      liveBusy = true;
      try {
        const counts = {};
        let total = 0;
        for (const rulesOnly of [true, false]) {
          const before = getText(composer);
          const res = await checkField(composer, rulesOnly);
          setOnline(true);
          if (!res || res.refused) return;
          if (getText(composer) !== before && !res.findings.length) return;      // the user kept typing: check again later
          total += res.findings.length;
          for (const [type, n] of Object.entries(countTypes(res.findings))) counts[type] = (counts[type] || 0) + n;
        }
        if (total) {
          logDecision({ source: 'typed', action: 'redacted', counts, llm: true });
          toast(`${plural(total, 'item')} replaced as you typed`, tally(counts));
        } else {
          verified = getText(composer);
        }
      } catch (_) {
        setOnline(false);
      } finally {
        liveBusy = false;
      }
    }, 900);
  }, true);

  // ---------- pasted text: sanitized before it lands in the box ----------
  listen('paste', async (e) => {
    const composer = adapter.composer(e.target);
    if (!composer || !e.clipboardData) return;
    if (e.clipboardData.files.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const out = await guardFiles([...e.clipboardData.files]);
      if (out.length) attach(out, composer, null);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (!text || text.trim().length < 6) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // On fully guarded sites the local AI checks again at Send, so paste is cleaned by the fast rules. On every other
    // site nothing follows the paste, so the full check runs now.
    const waiting = FULL ? null : toast('Checking pasted text on this device…', null, 'busy', 0);
    try {
      const res = FULL ? await scan(text, false) : await scan(text, true);
      if (waiting) waiting.remove();
      setOnline(true);
      if (res.refused) {
        toast('Paste blocked', res.refused, 'error', 9000);
        return;
      }
      insertAtCursor(composer, res.sanitized);
      if (res.findings.length) {
        const counts = countTypes(res.findings);
        logDecision({ source: 'paste', action: 'redacted', counts });
        toast(`${plural(res.findings.length, 'item')} replaced in pasted text`, tally(counts));
      }
    } catch (_) {
      if (waiting) waiting.remove();
      offline();
    }
  }, true);

  // ---------- uploads: every file is checked; unreadable ones are blocked ----------
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function fromBase64(b64, name, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type });
  }

  async function guardFiles(fileList) {
    const waiting = toast(`Checking ${plural(fileList.length, 'file')} on this device…`, null, 'busy', 0);
    const safe = [];
    for (const file of fileList) {
      let r;
      if (file.size > MAX_FILE) {
        r = { blocked: true, reason: 'File is larger than 20 MB.' };
      } else {
        try {
          r = await gwJob('/scan-file', { session_id: sid, filename: file.name, data_b64: toBase64(await file.arrayBuffer()), llm: true, site: adapter.name,
            channel: adapter.mail ? 'mail' : '' });
          setOnline(true);
        } catch (_) {
          setOnline(false);
          r = { blocked: true, reason: 'The local gateway stopped answering while checking this file. Try again in a moment.' };
        }
      }
      if (r.blocked) {
        toast(`${adapter.mail ? 'Attachment' : 'Upload'} blocked: ${file.name}`, r.reason, 'error', 12000);
      } else if (r.passthrough) {
        safe.push(new File([file], r.out_name, { type: file.type }));
        toast(`${file.name} is password-protected`, `Attached as ${r.out_name}. Send the password separately, not in this email.`);
      } else if (r.out_b64) {
        safe.push(fromBase64(r.out_b64, r.out_name, r.out_mime));
        toast(r.total ? `${plural(r.total, 'item')} replaced in ${file.name}` : `${file.name} checked`,
          (r.total ? tally(r.counts) + '. ' : '') + `Attached as ${r.out_name}.`);
      } else {
        safe.push(new File([file], r.out_name, { type: file.type }));
        toast(`${file.name} checked`, `Nothing sensitive found. Attached as ${r.out_name}.`);
      }
    }
    waiting.remove();
    return safe;
  }

  function attach(fileList, dropTarget, sourceInput) {
    const dt = new DataTransfer();
    fileList.forEach((f) => dt.items.add(f));
    const input = sourceInput && sourceInput.isConnected ? sourceInput : adapter.fileInput();
    if (input) {
      input.__pgBypass = true;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (dropTarget) {
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      ev.__pgBypass = true;
      dropTarget.dispatchEvent(ev);
    } else {
      toast('Upload stopped', 'The safe copy could not be attached on this site.', 'error', 9000);
    }
  }

  listen('change', async (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files.length) return;
    if (input.__pgBypass) { input.__pgBypass = false; return; }
    e.stopImmediatePropagation();
    const picked = [...input.files];
    input.value = '';
    const out = await guardFiles(picked);
    if (out.length) attach(out, null, input);
  }, true);

  listen('drop', async (e) => {
    if (e.__pgBypass || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.target;
    const out = await guardFiles([...e.dataTransfer.files]);
    if (out.length) attach(out, target, null);
  }, true);

  // Ordinary sites stay silent until something is pasted or uploaded there.
  const boot = () => { if (TOP) refreshMascot().then((up) => { if (FULL) { getUi(); setOnline(up); } }); };
  if (document.body) boot(); else listen('DOMContentLoaded', boot);
})();
