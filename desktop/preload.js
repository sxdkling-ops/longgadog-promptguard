'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pg', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (handler) => ipcRenderer.on('state', (_event, state) => handler(state)),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  // mascot window
  mascotReady: () => ipcRenderer.send('mascot-ready'),
  moveMascot: (dx, dy) => ipcRenderer.send('mascot-move', dx, dy),
  openStatus: () => ipcRenderer.send('open-status'),
  setupSensor: () => ipcRenderer.send('setup-sensor'),
  setMascotHit: (hit) => ipcRenderer.send('mascot-hit', hit),
  onCursor: (handler) => ipcRenderer.on('cursor', (_event, point) => handler(point)),
  onGuardEvent: (handler) => ipcRenderer.on('guard-event', (_event, entry) => handler(entry)),
});
