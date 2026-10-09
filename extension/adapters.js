// Site adapters. Detection is generic first (any chat box, any "Send" button, any file input), so the guard keeps
// working when a site changes its markup. Per-site selectors below are only hints that are tried first.
(() => {
  const SITES = [
    {
      name: 'chatgpt', hosts: ['chatgpt.com', 'chat.openai.com'],
      composer: ['#prompt-textarea', '#mobile-composer-prompt'],
      send: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send message"]', 'button[aria-label="Send prompt"]'],
      file: ['#octane-mobile-composer-files-input'],
      answer: ['[data-message-author-role="assistant"]'],
    },
    {
      name: 'gemini', hosts: ['gemini.google.com'],
      composer: ['rich-textarea .ql-editor', '.ql-editor[contenteditable="true"]'],
      send: ['button.send-button', 'button[aria-label="Send message"]'],
      answer: ['model-response message-content', 'model-response'],
    },
    {
      name: 'claude', hosts: ['claude.ai'],
      composer: ['[data-testid="chat-input"]', 'div.ProseMirror[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]'],
      file: ['input[data-testid="file-upload"]'],
      answer: ['.font-claude-response', '.font-claude-message'],
    },
    { name: 'copilot', hosts: ['copilot.microsoft.com', 'm365.cloud.microsoft'] },
    { name: 'perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'] },
    { name: 'deepseek', hosts: ['chat.deepseek.com'] },
    { name: 'mistral', hosts: ['chat.mistral.ai'] },
    { name: 'grok', hosts: ['grok.com'] },
    { name: 'poe', hosts: ['poe.com'] },
    { name: 'meta-ai', hosts: ['www.meta.ai', 'meta.ai'] },

    // ---- webmail: Enter is a new line, so only the Send button and Ctrl+Enter are guarded; the subject is checked too
    { name: 'google-chat', hosts: ['chat.google.com', 'mail.google.com'], path: '/chat' },
    {
      name: 'gmail', hosts: ['mail.google.com'], mail: true,
      composer: ['div[aria-label="Message Body"]', 'div[g_editable="true"][role="textbox"]'],
      send: ['div[role="button"][data-tooltip^="Send"]', 'div[role="button"][aria-label^="Send"]'],
      subject: 'input[name="subjectbox"]',
    },
    {
      name: 'outlook', hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'], mail: true,
      composer: ['div[aria-label="Message body"]', 'div[role="textbox"][aria-label*="Message body" i]'],
      send: ['button[aria-label="Send"]', 'button[title^="Send"]'],
      subject: 'input[aria-label="Add a subject"], input[placeholder="Add a subject"]',
    },
    {
      name: 'yahoo-mail', hosts: ['mail.yahoo.com'], mail: true,
      composer: ['div[data-test-id="rte"]', 'div[aria-label="Message body"]'],
      send: ['button[data-test-id="compose-send-button"]'],
      subject: 'input[data-test-id="compose-subject"]',
    },
    { name: 'proton-mail', hosts: ['mail.proton.me'], mail: true },
    { name: 'zoho-mail', hosts: ['mail.zoho.com'], mail: true },
    { name: 'icloud-mail', hosts: ['www.icloud.com'], mail: true },

    // ---- chat and social sites: Enter sends
    { name: 'whatsapp', hosts: ['web.whatsapp.com'] },
    { name: 'telegram', hosts: ['web.telegram.org'] },
    { name: 'messenger', hosts: ['www.messenger.com', 'www.facebook.com'] },
    { name: 'discord', hosts: ['discord.com'] },
    { name: 'teams', hosts: ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'] },
    { name: 'slack', hosts: ['app.slack.com'] },
    { name: 'skype', hosts: ['web.skype.com'] },
    { name: 'viber', hosts: ['web.viber.com'] },
    { name: 'instagram', hosts: ['www.instagram.com'] },
    { name: 'linkedin', hosts: ['www.linkedin.com'] },
    { name: 'x', hosts: ['x.com', 'twitter.com'], enter: false },
    { name: 'reddit', hosts: ['www.reddit.com'], enter: false },
  ];

  const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]';
  // Recipient fields are left alone: an address pasted into "To" must stay an address.
  const NOT_COMPOSER = '.ql-clipboard, [aria-hidden="true"], [readonly], [disabled], [aria-label^="To" i], [aria-label^="Cc" i], '
    + '[aria-label^="Bcc" i], [aria-label*="recipient" i], [type="search"], [role="searchbox"], [role="combobox"]';
  const SUBJECT = 'input[name*="subject" i], input[aria-label*="subject" i], input[placeholder*="subject" i]';
  const BUTTON = 'button, [role="button"], input[type="submit"]';
  const SEND_WORDS = /\b(send|submit|post|reply|ipadala)\b/i;

  const visible = (el) => !!(el && (el.offsetParent || el.getClientRects().length));
  const first = (selectors) => {
    for (const s of selectors || []) {
      const el = [...document.querySelectorAll(s)].find(visible);
      if (el) return el;
    }
    return null;
  };

  function build(site) {
    const sendSelector = (site.send || []).join(', ');

    function composer(target) {
      if (target instanceof Element) {
        const el = target.closest(EDITABLE);
        return el && !el.matches(NOT_COMPOSER) ? el : null;
      }
      const hinted = first(site.composer);
      if (hinted) return hinted;
      const active = document.activeElement;
      if (active && active.matches && active.matches(EDITABLE) && !active.matches(NOT_COMPOSER)) return active;
      const all = [...document.querySelectorAll(EDITABLE)].filter((el) => visible(el) && !el.matches(NOT_COMPOSER));
      return all.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
    }

    function isSend(target) {
      if (!(target instanceof Element)) return false;
      const btn = target.closest(BUTTON);
      if (!btn) return false;
      if (sendSelector && btn.matches(sendSelector)) return true;
      const label = [btn.getAttribute('aria-label'), btn.getAttribute('title'), btn.dataset.testid, btn.textContent.trim().slice(0, 30)].filter(Boolean).join(' ');
      if (SEND_WORDS.test(label)) return true;
      const form = btn.closest('form');
      return !!(form && btn.type === 'submit' && form.querySelector(EDITABLE));
    }

    function sendButton(from) {
      const hinted = first(site.send);
      if (hinted) return hinted;
      let scope = from || composer();
      for (let i = 0; scope && i < 8; i++, scope = scope.parentElement) {
        const btn = [...scope.querySelectorAll(BUTTON)].find((b) => visible(b) && isSend(b));
        if (btn) return btn;
      }
      return null;
    }

    function fileInput() {
      for (const s of site.file || []) {
        const el = document.querySelector(s);
        if (el) return el;
      }
      const all = [...document.querySelectorAll('input[type="file"]')];
      return all.find((i) => !/^image\//.test(i.accept || '') && !i.hasAttribute('capture')) || all[0] || null;
    }

    function lastAnswer() {
      for (const s of site.answer || []) {
        const all = document.querySelectorAll(s);
        if (all.length) return all[all.length - 1].innerText;
      }
      return String(getSelection() || '').trim();
    }

    // Other fields that leave with the message. For mail: the subject line.
    function extras(from) {
      if (!site.mail) return [];
      const scope = (from && from.closest('form, [role="dialog"], [role="region"], [role="main"]')) || document;
      return [...scope.querySelectorAll(site.subject || SUBJECT)].filter(visible);
    }

    return { name: site.name, mode: 'full', mail: !!site.mail, enterSends: !site.mail && site.enter !== false, known: !!(site.answer && site.answer.length),
      composer, isSend, sendButton, fileInput, lastAnswer, extras };
  }

  globalThis.PGPH_ADAPTERS = SITES.map((site) => ({
    match: (l) => site.hosts.includes(l.hostname) && (!site.path || l.pathname.startsWith(site.path)),
    ...build(site),
  }));

  // Every other website gets the basic guard: uploads and pasted text are checked. Typing is not intercepted there,
  // because a site that is not on the list above may use Enter or its buttons in ways the guard cannot predict.
  globalThis.PGPH_ADAPTERS.push({
    match: (l) => /^https?:$/.test(l.protocol),
    ...build({ name: 'web' }),
    mode: 'basic',
  });
})();
