// Clipboard guard logic, free of Electron so it can be tested with plain Node (see test-guard.js).
//
// Every app on the PC is policed. Whatever the user copies is checked by the local gateway in the background.
// The original stays on the clipboard only while the user is in the window it was copied from, or in an app the
// administrator has marked as trusted. In every other app (chat apps, browsers, AI apps, anything unknown) the
// clipboard holds the sanitized copy, or nothing if it could not be checked.
'use strict';

class ClipboardGuard {
  /**
   * @param {object} io
   * @param {() => {kind: 'empty'|'text'|'image'|'files', text?: string, png?: Buffer, sig: string}} io.read
   * @param {(text: string) => string} io.writeText   writes text, returns the new clipboard signature
   * @param {() => string} io.clear                   empties the clipboard, returns the new signature
   * @param {(snapshot: object) => string} io.restore puts a snapshot back, returns the new signature
   * @param {(text: string) => Promise<object>} io.scanText
   * @param {(name: string, data: Buffer) => Promise<object>} io.scanFile
   * @param {(event: object) => void} io.report
   */
  constructor(io) {
    this.io = io;
    this.window = { kind: 'trusted', key: '', name: '' };   // window in front
    this.source = '';          // key of the window the current clipboard content was copied in
    this.original = null;      // snapshot the user copied
    this.verdict = null;       // { state: 'pending' | 'clean' | 'sanitized' | 'blocked', text?, counts?, reason? }
    this.ownSig = null;        // signature of what the guard itself last put on the clipboard
    this.swapped = false;      // true while the clipboard holds the guard's content instead of the original
    this.reported = false;
    this.seq = 0;
  }

  /** Call whenever the clipboard is polled. */
  onClipboard(snapshot) {
    if (snapshot.sig === this.ownSig) return;                  // our own write
    if (this.original && snapshot.sig === this.original.sig) return;
    this.ownSig = null;
    this.swapped = false;
    if (snapshot.kind === 'empty') { this.original = null; this.verdict = null; return; }
    this.original = snapshot;
    this.source = this.window.key;
    this.reported = false;
    this._check(snapshot);
  }

  /**
   * Call when the foreground window changes.
   * @param {'trusted'|'guarded'|'neutral'} kind  neutral = shell surfaces such as the taskbar: nothing changes
   * @param {string} key   identifies the window (process + title)
   * @param {string} name  shown in notices
   */
  onFocus(kind, key, name) {
    if (kind === 'neutral') return;
    this.window = { kind, key, name };
    this._sync();
  }

  _check(snapshot) {
    const seq = ++this.seq;
    this.verdict = { state: 'pending' };
    const job = snapshot.kind === 'text' ? this.io.scanText(snapshot.text)
      : snapshot.kind === 'image' ? this.io.scanFile('clipboard.png', snapshot.png)
        : Promise.resolve({ blocked: true, reason: 'Copied files can only be pasted into trusted apps.' });
    job.then((r) => this._verdictFrom(snapshot, r), () => ({ state: 'blocked', reason: 'The local gateway is not answering, so nothing can be pasted outside trusted apps.' }))
      .then((verdict) => {
        if (seq !== this.seq) return;                          // the user copied something else meanwhile
        this.verdict = verdict;
        this._sync();
      });
  }

  _verdictFrom(snapshot, r) {
    if (!r || r.blocked || r.refused) return { state: 'blocked', reason: (r && (r.reason || r.refused)) || 'This could not be checked.' };
    if (snapshot.kind === 'text') {
      const counts = {};
      for (const f of r.findings || []) counts[f.type] = (counts[f.type] || 0) + 1;
      return r.findings && r.findings.length ? { state: 'sanitized', text: r.sanitized, counts } : { state: 'clean' };
    }
    // An image is always replaced by the text read from it, sanitized. The picture itself never leaves.
    return { state: 'sanitized', text: Buffer.from(r.out_b64 || '', 'base64').toString('utf8'), counts: r.counts || {} };
  }

  /** Make the clipboard match what the window in front is allowed to receive. */
  _sync() {
    if (!this.original || !this.verdict) return;
    const allowOriginal = this.window.kind === 'trusted' || this.window.key === this.source || this.verdict.state === 'clean';
    if (this.verdict.state === 'clean' && this.window.kind === 'guarded' && this.window.key !== this.source && !this.reported) {
      this.reported = true;
      this.io.report({ kind: 'clean', app: this.window.name, source: this.original.kind });
    }
    if (allowOriginal) {
      if (this.swapped) {
        if (this.io.read().sig === this.ownSig) this.io.restore(this.original);
        this.swapped = false;
        this.ownSig = null;
      }
      return;
    }
    const v = this.verdict;
    if (v.state === 'sanitized') {
      this.ownSig = this.io.writeText(v.text);
    } else {
      this.ownSig = this.io.clear();                           // pending or blocked: fail closed
    }
    this.swapped = true;
    if (v.state !== 'pending' && !this.reported) {
      this.reported = true;
      this.io.report({ kind: v.state, app: this.window.name, source: this.original.kind, counts: v.counts, reason: v.reason });
    }
  }
}

const SHELL_TITLES = new Set(['', 'program manager', 'task switching', 'task view', 'search', 'start', 'notification center', 'system tray overflow window.']);

/** Decide how the window in front is treated. Everything is guarded unless the administrator trusts it. */
function classify(processName, title, apps) {
  const p = (processName || '').toLowerCase();
  const t = (title || '').trim();
  if (!p) return 'neutral';
  if ((apps.shell_processes || []).some((n) => p === n.toLowerCase())) return 'neutral';
  if (p === 'explorer' && SHELL_TITLES.has(t.toLowerCase())) return 'neutral';   // taskbar, desktop, Alt+Tab
  if ((apps.trusted_processes || []).some((n) => p === n.toLowerCase())) return 'trusted';
  if ((apps.trusted_titles || []).some((w) => w && t.toLowerCase().includes(w.toLowerCase()))) return 'trusted';
  return 'guarded';
}

module.exports = { ClipboardGuard, classify };
