// Runs inside the page itself (not the extension's isolated world), before the site's own scripts.
//
// Some sites, Gmail among them, open the file picker through a file input that is never added to the page. Events on
// such an input do not reach the document, so the guard would never see the chosen files. This hook adopts any file
// input into the page just before it is opened, which makes its "change" event visible to the guard.
(() => {
  if (window.__pgphHook) return;
  window.__pgphHook = true;

  function adopt(el) {
    try {
      if (el instanceof HTMLInputElement && el.type === 'file' && !el.isConnected) {
        el.style.display = 'none';
        el.setAttribute('data-pgph-adopted', '');
        document.documentElement.appendChild(el);
      }
    } catch (_) { /* leave the element as it is */ }
  }

  const click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { adopt(this); return click.apply(this, arguments); };

  if (HTMLInputElement.prototype.showPicker) {
    const showPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () { adopt(this); return showPicker.apply(this, arguments); };
  }

  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (event && event.type === 'click') adopt(this);
    return dispatch.apply(this, arguments);
  };

  // The newer file-picker API hands files straight to the page, where the guard cannot check them. With it switched
  // off, sites fall back to an ordinary file input.
  try { window.showOpenFilePicker = undefined; } catch (_) { /* read-only in this browser */ }
})();
