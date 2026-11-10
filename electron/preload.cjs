// 렌더러에 window.reaFs 하나만 노출 (Node API는 직접 노출하지 않는다)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reaFs", {
  pickVault: () => ipcRenderer.invoke("vault:pick"),
  load: (root) => ipcRenderer.invoke("vault:load", root),
  write: (root, p, c) => ipcRenderer.invoke("vault:write", root, p, c),
  mkdir: (root, p) => ipcRenderer.invoke("vault:mkdir", root, p),
  remove: (root, p) => ipcRenderer.invoke("vault:remove", root, p),
  rename: (root, a, b) => ipcRenderer.invoke("vault:rename", root, a, b),
});
