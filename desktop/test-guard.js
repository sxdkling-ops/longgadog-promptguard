// Tests the clipboard guard logic with a fake clipboard and a fake gateway. Run: npm test
'use strict';
const assert = require('assert');
const { ClipboardGuard, classify } = require('./guard');

function setup(scan) {
  let clip = { kind: 'empty', sig: 'empty' };
  const reports = [];
  const snap = (kind, text) => ({ kind, text, sig: kind + ':' + (text || '') });
  const io = {
    read: () => clip,
    writeText: (t) => { clip = snap('text', t); return clip.sig; },
    clear: () => { clip = { kind: 'empty', sig: 'empty' }; return clip.sig; },
    restore: (s) => { clip = s; return clip.sig; },
    scanText: scan,
    scanFile: async () => ({ out_b64: Buffer.from('Customer: [PERSON_1]').toString('base64'), counts: { PERSON: 1 } }),
    report: (e) => reports.push(e),
  };
  const guard = new ClipboardGuard(io);
  const go = (kind, name) => { guard.onFocus(kind, name, name); guard.onClipboard(clip); };
  const copy = (kind, text) => { clip = kind === 'image' ? { kind: 'image', sig: 'image:' + text, png: Buffer.from('x') } : snap(kind, text); guard.onClipboard(clip); };
  return { guard, go, copy, reports, clip: () => clip, tick: () => new Promise((ok) => setTimeout(ok, 5)) };
}

const dirty = async (text) => ({ findings: [{ type: 'PERSON' }, { type: 'TIN' }], sanitized: text.replace('Maria Santos', '[PERSON_1]').replace('123-456-789-000', '[TIN_1]') });
const clean = async (text) => ({ findings: [], sanitized: text });
const SECRET = 'kay Maria Santos, TIN 123-456-789-000';
const SAFE = 'kay [PERSON_1], TIN [TIN_1]';

(async () => {
  // 1. Copy in a trusted app, paste into chat apps: sanitized. Back in a trusted app: original.
  let t = setup(dirty);
  t.go('trusted', 'EXCEL');
  t.copy('text', SECRET); await t.tick();
  assert.strictEqual(t.clip().text, SECRET, 'untouched in the app it was copied from');
  t.go('guarded', 'Viber');
  assert.strictEqual(t.clip().text, SAFE, 'sanitized in Viber');
  t.go('guarded', 'Telegram');
  assert.strictEqual(t.clip().text, SAFE, 'still sanitized in Telegram');
  t.go('guarded', 'Discord');
  assert.strictEqual(t.clip().text, SAFE, 'still sanitized in Discord');
  assert.strictEqual(t.reports.length, 1, 'one notice per copied item, not one per app');
  assert.deepStrictEqual(t.reports[0].counts, { PERSON: 1, TIN: 1 });
  t.go('trusted', 'WINWORD');
  assert.strictEqual(t.clip().text, SECRET, 'original in another trusted app');

  // 2. An unknown app is guarded by default.
  t = setup(dirty);
  t.go('trusted', 'EXCEL'); t.copy('text', SECRET); await t.tick();
  t.go(classify('SomeNewApp', 'Whatever', { trusted_processes: ['EXCEL'] }), 'SomeNewApp');
  assert.strictEqual(t.clip().text, SAFE);

  // 3. Copy inside a guarded window: original while you stay in that window, sanitized in any other.
  t = setup(dirty);
  t.go('guarded', 'chrome\tCRM - Customer 42');
  t.copy('text', SECRET); await t.tick();
  assert.strictEqual(t.clip().text, SECRET, 'same window keeps the original');
  t.go('guarded', 'chrome\tChatGPT');
  assert.strictEqual(t.clip().text, SAFE, 'another tab of the same browser is a different window');
  t.go('guarded', 'chrome\tCRM - Customer 42');
  assert.strictEqual(t.clip().text, SECRET, 'back in the source window');

  // 4. Clean text is never touched and never reported.
  t = setup(clean);
  t.go('trusted', 'notepad'); t.copy('text', 'See you at 3pm'); await t.tick();
  t.go('guarded', 'Telegram');
  assert.strictEqual(t.clip().text, 'See you at 3pm');
  assert.deepStrictEqual(t.reports.map((r) => r.kind), ['clean'], 'clean items are reported once, so the mascot can smile');
  t.go('guarded', 'Viber');
  assert.strictEqual(t.reports.length, 1);

  // 5. Switching before the check finishes: clipboard is empty, then filled with the safe copy.
  let release;
  t = setup((text) => new Promise((ok) => { release = () => ok(dirty(text)); }));
  t.go('trusted', 'EXCEL'); t.copy('text', SECRET);
  t.go('guarded', 'Discord');
  assert.strictEqual(t.clip().kind, 'empty', 'nothing can be pasted while the check is running');
  release(); await t.tick(); await t.tick();
  assert.strictEqual(t.clip().text, SAFE);

  // 6. Gateway down: paste is blocked everywhere except trusted apps.
  t = setup(() => Promise.reject(new Error('down')));
  t.go('trusted', 'EXCEL'); t.copy('text', SECRET); await t.tick();
  t.go('guarded', 'Viber');
  assert.strictEqual(t.clip().kind, 'empty');
  assert.strictEqual(t.reports[0].kind, 'blocked');
  t.go('trusted', 'notepad');
  assert.strictEqual(t.clip().text, SECRET);

  // 7. The gateway refuses (local AI off): blocked.
  t = setup(async () => ({ refused: 'The local AI check is not running', findings: [] }));
  t.go('trusted', 'EXCEL'); t.copy('text', 'anything at all'); await t.tick();
  t.go('guarded', 'Viber');
  assert.strictEqual(t.clip().kind, 'empty');

  // 8. Copied files: fine between trusted apps, blocked elsewhere, and back again afterwards.
  t = setup(clean);
  t.go('trusted', 'explorer'); t.copy('files', 'C:/x/loans.xlsx'); await t.tick();
  assert.strictEqual(t.clip().kind, 'files');
  t.go('guarded', 'Telegram');
  assert.strictEqual(t.clip().kind, 'empty');
  assert.strictEqual(t.reports[0].kind, 'blocked');
  t.go('trusted', 'explorer');
  assert.strictEqual(t.clip().kind, 'files', 'file copy still works in File Explorer afterwards');

  // 9. A copied image becomes the sanitized text read from it; the image returns in trusted apps.
  t = setup(clean);
  t.go('trusted', 'SnippingTool'); t.copy('image', 'screenshot-1'); await t.tick();
  t.go('guarded', 'Viber');
  assert.strictEqual(t.clip().text, 'Customer: [PERSON_1]');
  t.go('trusted', 'mspaint');
  assert.strictEqual(t.clip().kind, 'image');

  // 10. The taskbar and Alt+Tab do not change anything.
  t = setup(dirty);
  t.go('trusted', 'EXCEL'); t.copy('text', SECRET); await t.tick();
  t.go('guarded', 'Viber');
  t.guard.onFocus('neutral', 'explorer\t', 'explorer');
  assert.strictEqual(t.clip().text, SAFE, 'still sanitized while on the taskbar');

  // 11. A new copy is checked afresh.
  t = setup(dirty);
  t.go('trusted', 'EXCEL'); t.copy('text', 'first Maria Santos'); await t.tick();
  t.go('guarded', 'Viber'); t.go('trusted', 'EXCEL');
  t.copy('text', 'second Maria Santos'); await t.tick();
  t.go('guarded', 'Viber');
  assert.strictEqual(t.clip().text, 'second [PERSON_1]');
  assert.strictEqual(t.reports.length, 2);

  // Window classification: everything is guarded unless trusted.
  const apps = { trusted_processes: ['explorer', 'EXCEL', 'notepad'], trusted_titles: ['Intranet'], shell_processes: ['SearchHost'] };
  for (const name of ['Viber', 'Telegram', 'Discord', 'WhatsApp', 'chrome', 'msedge', 'OUTLOOK', 'ms-teams', 'ChatGPT', 'Claude', 'AnyUnknownApp']) {
    assert.strictEqual(classify(name, 'Some window', apps), 'guarded', name + ' must be guarded');
  }
  assert.strictEqual(classify('excel', 'Loans.xlsx - Excel', apps), 'trusted');
  assert.strictEqual(classify('explorer', 'Documents', apps), 'trusted');
  assert.strictEqual(classify('explorer', '', apps), 'neutral');
  assert.strictEqual(classify('explorer', 'Program Manager', apps), 'neutral');
  assert.strictEqual(classify('SearchHost', 'Search', apps), 'neutral');
  assert.strictEqual(classify('', '', apps), 'neutral');
  assert.strictEqual(classify('chrome', 'HR Intranet - Google Chrome', apps), 'trusted');

  console.log('guard tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
