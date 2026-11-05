// גשר בין החלון לשרת של מפקדה, בלי פורט ברשת: החלון שולח ומקבל הודעות WebSocket דרך התהליך הראשי,
// שמתחבר לשרת על קובץ השקע המקומי. רק ארבע פעולות חשופות, ורק לנתיבי ה-WebSocket של מפקדה.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mifkadaNet", {
  open: (id, path) => ipcRenderer.send("net:open", String(id), String(path)),
  send: (id, data) => ipcRenderer.send("net:send", String(id), String(data)),
  close: (id) => ipcRenderer.send("net:close", String(id)),
  onEvent: (cb) => {
    ipcRenderer.on("net:event", (_e, ev) => cb(ev));
  },
});
