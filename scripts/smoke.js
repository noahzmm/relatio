// Smoke-Test: npx electron scripts/smoke.js <ausgabeordner>
// Startet die App mit temporären Daten, öffnet jede Notation im Editor, speichert Screenshots und exportiert PDFs.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const out = path.resolve(process.argv[process.argv.length - 1]);
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'relatio-smoke-')));

const { renderPdf } = require('../main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    await wait(1500);
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    await js(`(async () => {
      R.settings.userName = 'Ada';
      for (const n of ['chen','minmax','crow','uml']) {
        const p = R.newProject({ name: 'Online-Shop (' + n + ')', description: 'Kunden, Bestellungen und Produkte', notation: n, withSample: true });
        await R.api.save(p);
      }
      await R._debug.showHome();
    })()`);
    await wait(600);
    fs.writeFileSync(path.join(out, 'home.png'), (await win.webContents.capturePage()).toPNG());

    await js(`document.querySelector('#h-new').click()`);
    await wait(500);
    fs.writeFileSync(path.join(out, 'new-project.png'), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('[data-close]').click()`);

    const ids = await js(`R.api.list().then(l => l.map(p => [p.id, p.notation]))`);
    for (const [id, notation] of ids) {
      await js(`R._debug.openProject(${JSON.stringify(id)})`);
      await wait(500);
      fs.writeFileSync(path.join(out, `editor-${notation}.png`), (await win.webContents.capturePage()).toPNG());
      const payload = await js(`(() => {
        const p = R._debug.E.p, d = R.diagramSvg(p, { padding: 12 });
        return { svg: d.svg, width: d.width, height: d.height, title: p.name, subtitle: R.NOTATIONS[p.notation].name + '-Notation · Testexport', format: 'a4-landscape', header: true };
      })()`);
      fs.writeFileSync(path.join(out, `export-${notation}.pdf`), await renderPdf(payload));
      if (notation === 'crow') fs.writeFileSync(path.join(out, `export-${notation}-fit.pdf`), await renderPdf({ ...payload, format: 'fit', header: false }));
      if (notation === 'chen') {
        const tables = await js(`R.tablesHtml(R.toRelational(R._debug.E.p))`);
        const css = await js('R.TABLES_CSS');
        fs.writeFileSync(path.join(out, 'export-tables.pdf'), await renderPdf({ ...payload, diagram: false, tables, tablesCss: css }));
        fs.writeFileSync(path.join(out, 'export-both-fit.pdf'), await renderPdf({ ...payload, format: 'fit', tables, tablesCss: css }));
        await js(`document.querySelector('[data-mode="tables"]').click()`);
        await wait(300);
        fs.writeFileSync(path.join(out, 'editor-tables.png'), (await win.webContents.capturePage()).toPNG());
        await js(`document.querySelector('[data-mode="diagram"]').click()`);
      }
    }
    console.log('SMOKE OK', out);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    process.exitCode = 1;
  }
  app.quit();
});
