// The mascot's browser sensor. Relays content-script requests to the local gateway, and tells the gateway that this
// browser has the sensor installed. The only host this extension can reach is 127.0.0.1:8787.
const GATEWAY = 'http://127.0.0.1:8787';

function browserName() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const has = (word) => brands.some((b) => b.brand.includes(word));
  return has('Edge') ? 'msedge' : has('Brave') ? 'brave' : has('Opera') ? 'opera' : has('Vivaldi') ? 'vivaldi' : 'chrome';
}

// Heartbeat: lets the desktop mascot know the sensor is present, so it can warn when it is not.
let lastBeat = 0;
function beat() {
  lastBeat = Date.now();
  fetch(GATEWAY + '/sensor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser: browserName(), version: chrome.runtime.getManifest().version }),
  }).catch(() => { /* gateway not running: the pages report that themselves */ });
}

// Tabs that were already open when the sensor was installed or updated do not have it yet. Put it into each of
// them now, so nobody has to remember to refresh.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (!tab.id || /^http:\/\/(127\.0\.0\.1|localhost):8787\//.test(tab.url || '')) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['page-hook.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['adapters.js', 'content.js'] });
    } catch (_) { /* a page the browser does not allow extensions on */ }
  }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('pgph-beat', { periodInMinutes: 0.5 }); beat(); injectIntoOpenTabs(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('pgph-beat', { periodInMinutes: 0.5 }); beat(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'pgph-beat') beat(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.pgph || typeof msg.path !== 'string' || !msg.path.startsWith('/')) return;
  if (Date.now() - lastBeat > 20000) beat();
  (async () => {
    try {
      const res = await fetch(GATEWAY + msg.path, {
        method: msg.method || (msg.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json' },
        body: msg.body ? JSON.stringify(msg.body) : undefined,
      });
      if (!res.ok) throw new Error('gateway ' + res.status);
      sendResponse({ ok: true, data: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});
