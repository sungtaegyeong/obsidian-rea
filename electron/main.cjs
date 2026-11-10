// REA Notes 데스크톱 셸: 빌드된 웹 앱(dist/)을 창에 띄우고, preload로 로컬 파일 API를 노출한다
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

// 볼트 루트 밖으로 나가는 경로는 거부한다
const inside = (root, rel) => {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("볼트 밖 경로: " + rel);
  return full;
};

async function walk(root, dir, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (e.isDirectory()) {
      out.folders.push(rel);
      await walk(root, full, out);
    } else if (e.name.endsWith(".md")) {
      const st = await fs.stat(full);
      out.files.push({ path: rel, content: await fs.readFile(full, "utf8"), mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs });
    }
  }
}

ipcMain.handle("vault:pick", async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ["openDirectory", "createDirectory"], title: "볼트로 열 폴더 선택" });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("vault:load", async (_e, root) => {
  const out = { files: [], folders: [] };
  await walk(root, root, out);
  return out;
});
ipcMain.handle("vault:write", async (_e, root, rel, content) => {
  const full = inside(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
});
ipcMain.handle("vault:mkdir", (_e, root, rel) => fs.mkdir(inside(root, rel), { recursive: true }));
ipcMain.handle("vault:remove", (_e, root, rel) => fs.rm(inside(root, rel), { recursive: true, force: true }));
ipcMain.handle("vault:rename", async (_e, root, from, to) => {
  const dest = inside(root, to);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(inside(root, from), dest);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "REA Notes",
    backgroundColor: "#1c1c1f",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
