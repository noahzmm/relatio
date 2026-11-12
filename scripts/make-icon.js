// Erzeugt build/icon.png (256×256) aus dem Relatio-Logo: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true });
  const fontCss = path.join(__dirname, '..', 'node_modules', '@fontsource', 'plus-jakarta-sans', '800.css').replace(/\\/g, '/');
  const html = `<!doctype html><html><head><link rel="stylesheet" href="file:///${fontCss}"><style>
    html,body{margin:0;width:256px;height:256px;background:transparent;overflow:hidden}
    div{width:256px;height:256px;border-radius:64px;background:radial-gradient(120% 120% at 35% 25%,#3b3b3f 0%,#1c1c1e 55%,#111113 100%);
      color:#fff;display:grid;place-items:center;font:800 150px 'Plus Jakarta Sans',sans-serif;letter-spacing:-6px}
    i{position:absolute;right:52px;top:52px;width:22px;height:22px;border-radius:50%;background:#ff3b30}
  </style></head><body><div>R</div><i></i></body></html>`;
  const tmp = path.join(app.getPath('temp'), 'relatio-icon.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript(`document.fonts.load('800 150px "Plus Jakarta Sans"').then(() => document.fonts.ready)`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 256, height: 256 }).toPNG());
  console.log('icon written');
  app.quit();
});
