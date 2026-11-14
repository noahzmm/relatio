// Oberfläche: Übersicht, Projekt-Dialog, Editor, Notationen, Einstellungen
(function () {
  const R = window.R;
  const I = R.icon;
  const esc = R.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $('#view');
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtShort = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  const fmtLong = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const state = { route: 'home', projects: [], current: null, osName: '' };

  // ---------- Hilfen ----------
  function toast(msg, { err = false, action = null } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => {
        action.fn();
        t.remove();
      };
      t.append(b);
    }
    $('#toast-root').append(t);
    setTimeout(() => t.remove(), action ? 6000 : 2600);
  }

  function modal(html, cls = '') {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${cls}">${html}</div>`;
    $('#modal-root').append(ov);
    const m = {
      el: ov.firstElementChild,
      onClose: null,
      close() {
        ov.remove();
        if (m.onClose) m.onClose();
      },
    };
    ov.addEventListener('mousedown', (e) => e.target === ov && m.close());
    $$('[data-close]', ov).forEach((b) => (b.onclick = () => m.close()));
    ov._modal = m;
    return m;
  }
  const topModal = () => {
    const ovs = $$('#modal-root .overlay');
    return ovs.length ? ovs[ovs.length - 1]._modal : null;
  };

  function confirmModal({ title, text, ok }) {
    return new Promise((res) => {
      const m = modal(
        `<h3>${esc(title)}</h3><p class="lead">${esc(text)}</p><div class="modal-foot"><button class="btn btn-ghost" data-close>Abbrechen</button><button class="btn btn-dark" data-ok>${esc(ok)}</button></div>`,
        'sm'
      );
      let done = false;
      m.onClose = () => !done && res(false);
      $('[data-ok]', m.el).onclick = () => {
        done = true;
        m.close();
        res(true);
      };
    });
  }

  function thumbSvg(p, padding = 16) {
    // ein beschädigtes Projekt darf die Übersicht nicht lahmlegen
    let d = null;
    try {
      d = R.diagramSvg(p, { padding });
    } catch (err) {
      console.warn('Vorschau fehlgeschlagen', err);
    }
    return d ? d.svg : `<span class="thumb-empty">${I.diagram}</span>`;
  }

  function setNav(route) {
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === route));
    $('.nav-btn[data-view="editor"]').disabled = !state.current;
  }

  function leaveEditor() {
    if (E.p && E.dirty) saveNow();
    $('#cv-hint') && $('#cv-hint').remove();
  }

  // ---------- Übersicht ----------
  async function showHome() {
    leaveEditor();
    state.route = 'home';
    setNav('home');
    state.projects = (await R.api.list()).flatMap((p) => {
      try {
        return [R.normalizeProject(p)];
      } catch {
        return [];
      }
    });
    const name = R.settings.userName || state.osName || 'du';
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const ents = state.projects.reduce((s, p) => s + (p.entities || []).length, 0);
    const rels = state.projects.reduce((s, p) => s + (p.relationships || []).length, 0);
    view.innerHTML = `
      <div class="page-head">
        <div><div class="date">${esc(today)}</div><h1 class="hello"><span>Hey,</span> ${esc(name)}</h1></div>
        <div class="head-actions">
          ${R.isDesktop ? `<button class="btn btn-light" id="h-import">${I.upload} Importieren</button>` : ''}
          <button class="btn btn-dark" id="h-new">${I.plus} Neues Projekt</button>
        </div>
      </div>
      <section class="hero">
        <div>
          <div class="hero-tag">Workspace</div>
          <h2>Deine ER-Diagramme</h2>
          <p>Projekte in deiner Bibliothek</p>
          <div class="hero-stats">
            <div class="hero-stat"><b>${ents}</b><span>Entitäten</span></div>
            <div class="hero-stat"><b>${rels}</b><span>Beziehungen</span></div>
          </div>
        </div>
        <div class="hero-num">${pad2(state.projects.length)}</div>
      </section>
      <div class="section-head">
        <div class="label">Alle Projekte</div>
        <label class="search">${I.search}<input id="h-q" placeholder="Projekte durchsuchen…" /></label>
      </div>
      <div class="scroll"><div class="list" id="h-list"></div></div>`;
    $('#h-new').onclick = newProjectModal;
    if ($('#h-import')) $('#h-import').onclick = importProject;
    $('#h-q').oninput = (e) => renderList(e.target.value);
    renderList('');
  }

  function renderList(q) {
    const list = $('#h-list');
    const term = q.trim().toLowerCase();
    const items = state.projects.filter((p) => !term || `${p.name} ${p.description}`.toLowerCase().includes(term));
    if (!state.projects.length) {
      list.innerHTML = `<div class="empty"><h3>Noch keine Projekte</h3><p>Lege dein erstes ER-Diagramm an und wähle dabei die passende Notation.</p><button class="btn btn-dark" id="e-new">${I.plus} Neues Projekt</button></div>`;
      $('#e-new').onclick = newProjectModal;
      return;
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty"><h3>Keine Treffer</h3><p>Für „${esc(q)}“ wurde kein Projekt gefunden.</p></div>`;
      return;
    }
    list.innerHTML = items
      .map((p, i) => {
        const n = R.NOTATIONS[p.notation] || R.NOTATIONS.chen;
        return `<div class="card" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 8) * 40}ms">
          <div class="thumb">${thumbSvg(p)}</div>
          <div class="card-body">
            <p class="card-title">${esc(p.name)}</p>
            <p class="card-desc">${esc(p.description || 'Keine Beschreibung')}</p>
            <div class="pills">
              <span class="pill">${I.calendar} ${esc(fmtShort(p.updatedAt || p.createdAt))}</span>
              <span class="pill ${n.color}">${esc(n.name)}</span>
              <span class="pill">${(p.entities || []).length} Entitäten</span>
            </div>
          </div>
          <div class="card-num">${pad2(i + 1)}</div>
          <button class="round-btn" data-del="${esc(p.id)}" title="Projekt löschen">${I.trash}</button>
        </div>`;
      })
      .join('');
    $$('.card', list).forEach((c) => (c.onclick = () => openProject(c.dataset.id)));
    $$('[data-del]', list).forEach(
      (b) =>
        (b.onclick = async (e) => {
          e.stopPropagation();
          const p = state.projects.find((x) => x.id === b.dataset.del);
          const ok = await confirmModal({
            title: 'Projekt löschen?',
            text: `„${p.name}“ wird ${R.isDesktop ? 'in den Papierkorb verschoben' : 'entfernt'}.`,
            ok: 'Löschen',
          });
          if (!ok) return;
          await R.api.remove(p.id);
          if (state.current && state.current.id === p.id) {
            state.current = null;
            E.p = null;
          }
          toast('Projekt gelöscht');
          showHome();
        })
    );
  }

  async function importProject() {
    try {
      const p = await R.api.importFile();
      if (!p) return;
      if (!p || !Array.isArray(p.entities) || !Array.isArray(p.relationships)) throw new Error('Keine gültige Relatio-Datei');
      R.normalizeProject(p);
      p.id = R.uid();
      p.updatedAt = Date.now();
      p.createdAt = typeof p.createdAt === 'number' ? p.createdAt : p.updatedAt;
      await R.api.save(p);
      toast('Projekt importiert');
      showHome();
    } catch (err) {
      toast(`Import fehlgeschlagen: ${err.message}`, { err: true });
    }
  }

  // ---------- Neues Projekt ----------
  function newProjectModal() {
    let notation = 'chen';
    const cards = R.NOTATION_ORDER.map((id) => {
      const n = R.NOTATIONS[id];
      const pv = R.diagramSvg({ notation: id, ...R.sampleDiagram(id, true) }, { padding: 14 });
      return `<button class="notation-card ${id === notation ? 'active' : ''}" data-n="${id}">
        <div class="prev">${pv.svg}</div><b>${esc(n.name)}</b><small>${esc(n.short)}</small><span class="tick">${I.check}</span></button>`;
    }).join('');
    const m = modal(`
      <h3>Neues Projekt</h3>
      <p class="lead">Gib deinem Diagramm einen Namen und wähle die Notation, in der gezeichnet wird.</p>
      <div class="row2">
        <label class="field"><span>Projektname</span><input id="np-name" placeholder="z. B. Online-Shop" maxlength="80" /></label>
        <label class="field"><span>Beschreibung (optional)</span><input id="np-desc" placeholder="Worum geht es?" maxlength="140" /></label>
      </div>
      <div class="field"><span>Notation</span></div>
      <div class="notation-grid">${cards}</div>
      <div class="notation-desc" id="np-ndesc"></div>
      <div class="modal-foot">
        <label class="check"><input type="checkbox" id="np-sample" /> Mit Beispieldiagramm starten</label>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-close>Abbrechen</button>
        <button class="btn btn-dark" id="np-create">${I.plus} Projekt erstellen</button>
      </div>`);
    const desc = () => ($('#np-ndesc', m.el).textContent = R.NOTATIONS[notation].desc);
    desc();
    $$('.notation-card', m.el).forEach(
      (c) =>
        (c.onclick = () => {
          notation = c.dataset.n;
          $$('.notation-card', m.el).forEach((x) => x.classList.toggle('active', x === c));
          desc();
        })
    );
    const create = async () => {
      const name = $('#np-name', m.el).value.trim();
      if (!name) {
        $('#np-name', m.el).focus();
        $('#np-name', m.el).style.borderColor = 'var(--accent)';
        return;
      }
      const p = R.newProject({ name, description: $('#np-desc', m.el).value.trim(), notation, withSample: $('#np-sample', m.el).checked });
      await R.api.save(p);
      m.close();
      openProject(p);
    };
    $('#np-create', m.el).onclick = create;
    $('#np-name', m.el).onkeydown = (e) => {
      if (e.key === 'Enter') create();
    };
    setTimeout(() => $('#np-name', m.el).focus(), 50);
  }

  // ---------- Editor ----------
  const E = {
    p: null,
    view: { x: 0, y: 0, k: 1 },
    tool: 'select',
    mode: 'diagram', // 'diagram' | 'tables'
    sel: null,
    undo: [],
    redo: [],
    drag: null,
    relFrom: null,
    pointer: null,
    hover: null,
    saveTimer: null,
    dirty: false,
    pendingSnap: null,
  };
  const snapV = (v) => (R.settings.snap ? Math.round(v / 10) * 10 : Math.round(v));
  const entity = (id) => E.p.entities.find((e) => e.id === id);
  const relation = (id) => E.p.relationships.find((r) => r.id === id);
  const generalization = (id) => E.p.generalizations.find((g) => g.id === id);
  // Attribute gehören zu einer Entität oder einer Beziehung
  const owner = (id) => {
    const o = entity(id) || relation(id);
    if (o && !o.attributes) o.attributes = [];
    return o;
  };
  const ownerSel = (id) => ({ kind: entity(id) ? 'entity' : 'rel', id });
  const PICK_TOOLS = ['rel', 'gen']; // Werkzeuge, die zwei Entitäten nacheinander anklicken

  async function openProject(idOrProject) {
    try {
      const p = typeof idOrProject === 'string' ? await R.api.load(idOrProject) : idOrProject;
      R.normalizeProject(p);
      state.current = p;
      Object.assign(E, { p, tool: 'select', sel: null, undo: [], redo: [], relFrom: null, hover: null, drag: null, dirty: false });
      showEditor(true);
    } catch (err) {
      toast(`Projekt konnte nicht geöffnet werden: ${err.message}`, { err: true });
    }
  }

  function showEditor(fit) {
    if (!E.p) return showHome();
    state.route = 'editor';
    setNav('editor');
    const n = R.NOTATIONS[E.p.notation];
    view.innerHTML = `
      <div class="ed-head">
        <button class="back-btn" id="ed-back" title="Zur Übersicht">${I.back}</button>
        <div class="ed-title">
          <div class="date"><span class="pill ${n.color}">${esc(n.name)}</span><span class="save-state" id="save-state">Gespeichert</span></div>
          <h1 id="ed-name">${esc(E.p.name)}</h1>
        </div>
        <div class="seg" id="ed-mode">
          <button data-mode="diagram" title="Diagramm (T)">${I.diagram} Diagramm</button>
          <button data-mode="tables" title="Tabellen (T)">${I.layout} Tabellen</button>
        </div>
        <div class="toolbar" id="ed-tools">
          <button class="tool" data-tool="select" title="Auswählen & verschieben (V)">${I.cursor}</button>
          <button class="tool" data-tool="entity" title="Entität hinzufügen (E)">${I.entity}</button>
          <button class="tool" data-tool="rel" title="Beziehung hinzufügen (R)">${I.relation}</button>
          <button class="tool" data-tool="gen" title="Generalisierung hinzufügen (G)">${I.gen}</button>
          <span class="tool-sep"></span>
          <button class="tool" id="t-undo" title="Rückgängig (Strg+Z)">${I.undo}</button>
          <button class="tool" id="t-redo" title="Wiederholen (Strg+Y)">${I.redo}</button>
          <span class="tool-sep"></span>
          <button class="tool" id="t-zout" title="Verkleinern">${I.minus}</button>
          <span class="zoom-val" id="zoom-val">100%</span>
          <button class="tool" id="t-zin" title="Vergrößern">${I.plus}</button>
          <button class="tool" id="t-fit" title="Ansicht einpassen (F)">${I.fit}</button>
          <span class="tool-sep"></span>
          <button class="tool" id="t-auto" title="Diagramm automatisch anordnen (L)">${I.layout}</button>
        </div>
        <button class="btn btn-dark" id="ed-pdf">${I.pdf} PDF exportieren</button>
      </div>
      <div class="ed-body">
        <div class="canvas-wrap" id="cw">
          <svg class="canvas" id="cv"><g id="vp"></g></svg>
          <div id="cv-overlay"></div>
          <button class="theme-chip" id="t-theme" title="Farbschema des Diagramms wählen"></button>
          <div class="theme-pop" id="theme-pop" hidden></div>
        </div>
        <div class="tables-wrap" id="tw" hidden>
          <div class="tables-bar">
            <div><b>Relationenmodell</b><span class="hint">Automatisch aus dem Diagramm abgeleitet – Änderungen machst du im Diagramm oder rechts im Panel.</span></div>
            <div class="tables-actions">
              <select class="input" id="sql-dialect" title="SQL-Dialekt">${Object.entries(R.SQL_DIALECTS)
                .map(([id, d]) => `<option value="${id}" ${id === R.settings.sqlDialect ? 'selected' : ''}>${esc(d.name)}</option>`)
                .join('')}</select>
              <button class="btn btn-light btn-sm" id="sql-copy">SQL kopieren</button>
              <button class="btn btn-light btn-sm" id="sql-save">${I.download} SQL speichern</button>
            </div>
          </div>
          <div class="tables-grid" id="tables"></div>
        </div>
        <aside class="panel" id="panel"></aside>
      </div>`;

    $('#ed-back').onclick = showHome;
    $('#ed-pdf').onclick = pdfModal;
    $$('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    $('#sql-dialect').onchange = (e) => {
      R.settings.sqlDialect = e.target.value;
      R.saveSettings();
    };
    $('#sql-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(R.toSql(E.p, R.settings.sqlDialect));
        toast('SQL in die Zwischenablage kopiert');
      } catch (err) {
        toast(`Kopieren fehlgeschlagen: ${err.message}`, { err: true });
      }
    };
    $('#sql-save').onclick = async () => {
      const file = await R.api.saveText({ name: `${E.p.name || 'Diagramm'}.sql`, content: R.toSql(E.p, R.settings.sqlDialect), filter: { name: 'SQL', extensions: ['sql'] } });
      if (file) toast('SQL gespeichert', { action: R.isDesktop ? { label: 'Öffnen', fn: () => R.api.openPath(file) } : null });
    };
    $('#tables').addEventListener('click', (ev) => {
      const card = ev.target.closest('[data-entity], [data-rel]');
      if (!card) return;
      E.sel = card.dataset.entity ? { kind: 'entity', id: card.dataset.entity } : { kind: 'rel', id: card.dataset.rel };
      renderCanvas();
      renderPanel();
    });
    $$('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $('#t-undo').onclick = undo;
    $('#t-redo').onclick = redo;
    $('#t-zin').onclick = () => zoomCenter(1.2);
    $('#t-zout').onclick = () => zoomCenter(1 / 1.2);
    $('#t-fit').onclick = fitView;
    $('#t-auto').onclick = autoArrange;
    $('#t-theme').onclick = () => toggleThemes();
    $('#theme-pop').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-theme]');
      if (b) setTheme(b.dataset.theme);
    });

    const cv = $('#cv');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', () => {
      if (PICK_TOOLS.includes(E.tool) && !E.drag) {
        E.pointer = null;
        E.hover = null;
        renderCanvas();
      }
    });
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    const panel = $('#panel');
    panel.addEventListener('focusin', (e) => {
      if (e.target.matches('input[type="text"], input:not([type]), textarea')) E.pendingSnap = snapshot();
    });
    panel.addEventListener('focusout', () => (E.pendingSnap = null));
    panel.addEventListener('input', onPanelInput);
    panel.addEventListener('change', onPanelChange);
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('keydown', onPanelKey);

    setTool(E.tool);
    setMode(E.mode);
    renderPanel();
    updateUndoButtons();
    if (fit) requestAnimationFrame(fitView);
    else applyView();
  }

  // ---------- Farbschema ----------
  const themeSwatch = (t) =>
    `<span class="theme-sw"><i style="background:${t.head}"></i><i style="background:${t.entFill};border-color:${t.entStroke}"></i><i style="background:${t.relFill};border-color:${t.relStroke}"></i><i style="background:${t.attrFill};border-color:${t.attrStroke}"></i></span>`;
  function updateThemeChip() {
    const chip = $('#t-theme');
    if (!chip || chip.dataset.theme === (E.p.theme || 'classic')) return;
    chip.dataset.theme = E.p.theme || 'classic';
    const t = R.themeOf(E.p);
    chip.innerHTML = `${themeSwatch(t)}<span>${esc(t.name)}</span>`;
  }
  function toggleThemes(open) {
    const pop = $('#theme-pop');
    if (!pop) return;
    const show = open === undefined ? pop.hidden : open;
    pop.hidden = !show;
    $('#t-theme').classList.toggle('active', show);
    if (!show) return;
    pop.innerHTML =
      `<div class="label">Farbschema</div>` +
      R.THEME_ORDER.map((id) => {
        const t = R.THEMES[id];
        return `<button class="theme-opt ${id === (E.p.theme || 'classic') ? 'active' : ''}" data-theme="${id}">
          ${themeSwatch(t)}<span>${esc(t.name)}</span>${I.check}</button>`;
      }).join('');
  }
  function setTheme(id) {
    if (!R.THEMES[id] || id === E.p.theme) return toggleThemes(false);
    pushUndo();
    E.p.theme = id;
    renderCanvas();
    changed();
    toggleThemes(true); // offen lassen, damit man Schemata durchprobieren kann
  }
  document.addEventListener('pointerdown', (ev) => {
    const pop = $('#theme-pop');
    if (pop && !pop.hidden && !ev.target.closest('#theme-pop, #t-theme')) toggleThemes(false);
  });

  function autoArrange() {
    if (!E.p.entities.length) return toast('Das Diagramm ist noch leer.', { err: true });
    pushUndo();
    R.autoLayout(E.p);
    renderCanvas();
    renderPanel();
    changed();
    fitView();
    toast('Diagramm angeordnet', { action: { label: 'Rückgängig', fn: undo } });
  }

  function setMode(mode) {
    E.mode = mode;
    const tables = mode === 'tables';
    $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#cw').hidden = tables;
    $('#tw').hidden = !tables;
    $('#ed-tools').hidden = tables;
    if (tables) {
      if (E.tool !== 'select') setTool('select');
      renderTables();
    } else requestAnimationFrame(applyView);
  }

  function renderTables() {
    const box = $('#tables');
    if (!box || E.mode !== 'tables') return;
    const tables = R.toRelational(E.p);
    if (!tables.length) {
      box.innerHTML = `<div class="canvas-empty" style="position:static;grid-column:1/-1;padding:60px 0"><div><b>Noch keine Tabellen</b>Lege im Diagramm Entitäten an – die Tabellen entstehen automatisch.</div></div>`;
      return;
    }
    box.innerHTML = R.tablesHtml(tables, { selectable: true });
    const s = E.sel;
    if (s) {
      const r = s.kind === 'rel' && relation(s.id);
      // bei 1:N-Beziehungen die Tabellen beider Entitäten markieren
      const ids = s.kind === 'rel' ? (r ? [r.from, r.to] : []) : [s.id];
      $$('[data-entity]', box).forEach((c) => c.classList.toggle('selected', ids.includes(c.dataset.entity)));
      $$('[data-rel]', box).forEach((c) => c.classList.toggle('selected', s.kind === 'rel' && c.dataset.rel === s.id));
    }
  }

  function setTool(t) {
    if (t !== E.tool || !PICK_TOOLS.includes(t)) {
      E.relFrom = null;
      E.hover = null;
    }
    E.tool = t;
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const cv = $('#cv');
    if (cv) cv.setAttribute('class', `canvas mode-${t}`);
    renderCanvas();
  }

  function renderCanvas() {
    const vp = $('#vp');
    if (!vp || !E.p) return;
    const pending = PICK_TOOLS.includes(E.tool) && E.relFrom && E.pointer ? { from: E.relFrom, x: E.pointer.x, y: E.pointer.y } : null;
    vp.innerHTML = R.renderDiagram(E.p, { sel: E.sel, hover: E.hover, pending, interactive: true }).svg;
    applyView();
    let ov = '';
    if (E.tool === 'entity') ov = `<div class="canvas-hint">Klicke auf die Fläche, um eine Entität zu platzieren · Esc bricht ab</div>`;
    else if (E.tool === 'rel')
      ov = `<div class="canvas-hint">${E.relFrom ? 'Jetzt die zweite Entität anklicken (gleiche Entität = rekursiv)' : 'Erste Entität der Beziehung anklicken'} · Esc bricht ab</div>`;
    else if (E.tool === 'gen')
      ov = `<div class="canvas-hint">${E.relFrom ? `Jetzt den Untertyp von „${esc(entity(E.relFrom)?.name || '')}“ anklicken` : 'Zuerst den Obertyp anklicken'} · Esc bricht ab</div>`;
    else if (!E.p.entities.length)
      ov = `<div class="canvas-empty"><div><b>Leere Zeichenfläche</b>Doppelklick oder <kbd>E</kbd> für eine neue Entität,<br/><kbd>R</kbd> verbindet zwei Entitäten mit einer Beziehung.</div></div>`;
    ov += `<div class="notation-badge"><span class="pill ${R.NOTATIONS[E.p.notation].color}">${esc(R.NOTATIONS[E.p.notation].name)}-Notation</span></div>`;
    $('#cv-overlay').innerHTML = ov;
    updateThemeChip();
    renderTables();
  }

  function applyView() {
    const vp = $('#vp');
    if (!vp) return;
    const { x, y, k } = E.view;
    vp.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    const cw = $('#cw');
    cw.style.backgroundSize = `${22 * k}px ${22 * k}px`;
    cw.style.backgroundPosition = `${x}px ${y}px`;
    $('#zoom-val').textContent = `${Math.round(k * 100)}%`;
  }

  function fitView() {
    const cv = $('#cv');
    if (!cv || !E.p) return;
    const bb = R.layout(E.p).bbox;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    // Fläche noch nicht ausgemessen (z. B. Fenster gerade erst sichtbar): gleich noch einmal versuchen
    if (W < 50 || H < 50) return void setTimeout(() => $('#cv') === cv && cv.clientWidth >= 50 && fitView(), 120);
    if (!bb) {
      E.view = { x: 0, y: 0, k: 1 };
      return applyView();
    }
    const padding = 70;
    const k = Math.min(1.2, Math.max(0.2, Math.min((W - padding * 2) / (bb.maxX - bb.minX), (H - padding * 2) / (bb.maxY - bb.minY))));
    E.view = { k, x: W / 2 - ((bb.minX + bb.maxX) / 2) * k, y: H / 2 - ((bb.minY + bb.maxY) / 2) * k };
    applyView();
  }

  function zoomAt(px, py, f) {
    const k2 = Math.min(3, Math.max(0.2, E.view.k * f));
    const r = k2 / E.view.k;
    E.view = { k: k2, x: px - (px - E.view.x) * r, y: py - (py - E.view.y) * r };
    applyView();
  }
  function zoomCenter(f) {
    const cv = $('#cv');
    zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, f);
  }
  function onWheel(ev) {
    ev.preventDefault();
    const rc = $('#cv').getBoundingClientRect();
    zoomAt(ev.clientX - rc.left, ev.clientY - rc.top, Math.exp(-ev.deltaY * 0.0015));
  }

  function toWorld(ev) {
    const rc = $('#cv').getBoundingClientRect();
    return { x: (ev.clientX - rc.left - E.view.x) / E.view.k, y: (ev.clientY - rc.top - E.view.y) / E.view.k };
  }
  function hitOf(ev) {
    const t = ev.target.closest && ev.target.closest('[data-kind]');
    return t ? { kind: t.dataset.kind, id: t.dataset.id, attr: t.dataset.attr } : null;
  }

  function onDown(ev) {
    const cv = $('#cv');
    const w = toWorld(ev);
    const hit = hitOf(ev);
    // Mittlere/rechte Maustaste: immer verschieben
    if (ev.button === 1 || ev.button === 2) {
      cv.setPointerCapture(ev.pointerId);
      E.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: E.view.x, oy: E.view.y };
      cv.classList.add('panning');
      return;
    }
    if (ev.button !== 0) return;
    if (E.tool === 'entity') return addEntity(w.x, w.y);
    if (PICK_TOOLS.includes(E.tool)) {
      if (hit && (hit.kind === 'entity' || hit.kind === 'attr') && entity(hit.id)) {
        if (!E.relFrom) {
          E.relFrom = hit.id;
          E.pointer = w;
          renderCanvas();
        } else if (E.tool === 'rel') addRelationship(E.relFrom, hit.id);
        else if (hit.id === E.relFrom) toast('Ein Untertyp muss eine andere Entität sein.', { err: true });
        else addGeneralization(E.relFrom, hit.id);
      } else setTool('select');
      return;
    }
    cv.setPointerCapture(ev.pointerId);
    // Doppelklick selbst erkennen: beim ersten Klick wird das SVG neu aufgebaut,
    // deshalb löst der Browser auf Elementen kein dblclick-Ereignis mehr aus.
    const key = hit ? `${hit.kind}|${hit.id}|${hit.attr || ''}` : '';
    const last = E.lastDown;
    const dbl = !!hit && !!last && last.key === key && ev.timeStamp - last.t < 450 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 6;
    E.lastDown = dbl ? null : { key, t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
    if (hit) {
      const prev = JSON.stringify(E.sel);
      E.sel = hit.kind === 'attr' ? { kind: 'attr', id: hit.id, attr: hit.attr } : { kind: hit.kind === 'rbox' ? 'rel' : hit.kind, id: hit.id };
      const L = R.layout(E.p);
      const relAttr = hit.kind === 'rbox' || (hit.kind === 'attr' && !entity(hit.id));
      if (relAttr && !L.chen) {
        // Attributkasten einer Beziehung verschieben
        const r = relation(hit.id);
        E.drag = { kind: 'rbox', id: hit.id, start: w, orig: { x: r.bdx || 0, y: r.bdy || 0 }, moved: false };
      } else if (relAttr) {
        const lr = L.rels.find((r) => r.rel.id === hit.id);
        const ag = (L.attrGeoms.get(hit.id) || []).find((x) => x.a.id === hit.attr);
        E.drag = lr && ag ? { kind: 'attr', id: hit.id, attr: hit.attr, start: w, orig: { x: ag.cx - lr.d.cx, y: ag.cy - lr.d.cy }, moved: false } : null;
      } else if (hit.kind === 'entity' || (hit.kind === 'attr' && !L.chen)) {
        const e = entity(hit.id);
        E.drag = { kind: 'entity', id: hit.id, start: w, orig: { x: e.x, y: e.y }, moved: false };
      } else if (hit.kind === 'attr') {
        const g = L.geoms.get(hit.id);
        const ag = (L.attrGeoms.get(hit.id) || []).find((x) => x.a.id === hit.attr);
        E.drag = { kind: 'attr', id: hit.id, attr: hit.attr, start: w, orig: { x: ag.cx - g.cx, y: ag.cy - g.cy }, moved: false };
      } else if (hit.kind === 'rel' && L.chen) {
        const lr = L.rels.find((r) => r.rel.id === hit.id);
        E.drag = lr ? { kind: 'rel', id: hit.id, start: w, orig: { x: lr.d.cx, y: lr.d.cy }, moved: false } : null;
      } else if (hit.kind === 'gen') {
        const lg = L.gens.find((g) => g.gen.id === hit.id);
        E.drag = lg ? { kind: 'gen', id: hit.id, start: w, orig: { x: lg.hub.x, y: lg.hub.y }, moved: false } : null;
      } else E.drag = null;
      renderCanvas();
      if (JSON.stringify(E.sel) !== prev) renderPanel();
      if (dbl) {
        E.drag = null;
        editHit(hit);
      }
    } else {
      if (E.sel) {
        E.sel = null;
        renderCanvas();
        renderPanel();
      }
      E.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: E.view.x, oy: E.view.y };
      cv.classList.add('panning');
    }
  }

  function onMove(ev) {
    const d = E.drag;
    if (!d && PICK_TOOLS.includes(E.tool)) {
      E.pointer = toWorld(ev);
      const hit = hitOf(ev);
      const hov = hit && (hit.kind === 'entity' || hit.kind === 'attr') && entity(hit.id) ? hit.id : null;
      if (E.relFrom || hov !== E.hover) {
        E.hover = hov;
        renderCanvas();
      }
      return;
    }
    if (!d) return;
    if (d.kind === 'pan') {
      E.view.x = d.ox + ev.clientX - d.sx;
      E.view.y = d.oy + ev.clientY - d.sy;
      return applyView();
    }
    const w = toWorld(ev);
    const dx = w.x - d.start.x;
    const dy = w.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * E.view.k < 3) return;
      pushUndo();
      d.moved = true;
    }
    if (d.kind === 'entity') {
      const e = entity(d.id);
      e.x = snapV(d.orig.x + dx);
      e.y = snapV(d.orig.y + dy);
    } else if (d.kind === 'rel') {
      const r = relation(d.id);
      r.x = snapV(d.orig.x + dx);
      r.y = snapV(d.orig.y + dy);
    } else if (d.kind === 'gen') {
      const g = generalization(d.id);
      g.x = snapV(d.orig.x + dx);
      g.y = snapV(d.orig.y + dy);
    } else if (d.kind === 'rbox') {
      const r = relation(d.id);
      r.bdx = Math.round(d.orig.x + dx);
      r.bdy = Math.round(d.orig.y + dy);
    } else if (d.kind === 'attr') {
      const a = owner(d.id).attributes.find((x) => x.id === d.attr);
      a.dx = Math.round(d.orig.x + dx);
      a.dy = Math.round(d.orig.y + dy);
    }
    renderCanvas();
  }

  function onUp() {
    const d = E.drag;
    E.drag = null;
    const cv = $('#cv');
    if (cv) cv.classList.remove('panning');
    if (d && d.moved) {
      changed();
      if (d.kind === 'attr') renderPanel();
    }
  }

  function onDbl(ev) {
    if (E.tool !== 'select') return;
    const hit = hitOf(ev);
    if (!hit) {
      const w = toWorld(ev);
      return addEntity(w.x, w.y);
    }
    editHit(hit);
  }

  /** Springt ins passende Namensfeld des angeklickten Elements. */
  function editHit(hit) {
    if (hit.kind === 'gen') return;
    focusField(hit.kind === 'rel' || hit.kind === 'rbox' ? '#f-rname' : hit.kind === 'attr' ? `.attr-row[data-attr="${hit.attr}"] input` : '#f-ename');
  }

  // ---------- Änderungen / Undo ----------
  function snapshot() {
    const { entities, relationships, generalizations, name, description, notation, theme } = E.p;
    return JSON.stringify({ entities, relationships, generalizations, name, description, notation, theme: theme || 'classic' });
  }
  function pushUndo(snap) {
    E.undo.push(snap || snapshot());
    if (E.undo.length > 150) E.undo.shift();
    E.redo = [];
    updateUndoButtons();
  }
  function restore(s) {
    const prevNotation = E.p.notation;
    Object.assign(E.p, JSON.parse(s));
    // Auswahl nur behalten, wenn es das Element nach dem Schritt noch gibt
    const c = E.sel;
    if (c && !(c.kind === 'gen' ? generalization(c.id) : c.kind === 'entity' ? entity(c.id) : c.kind === 'rel' ? relation(c.id) : owner(c.id))) E.sel = null;
    if (E.sel && E.sel.kind === 'attr' && !(owner(E.sel.id).attributes || []).some((a) => a.id === E.sel.attr)) E.sel = ownerSel(E.sel.id);
    changed();
    if (prevNotation !== E.p.notation) return showEditor(false);
    $('#ed-name').textContent = E.p.name || 'Unbenannt';
    if ($('#theme-pop') && !$('#theme-pop').hidden) toggleThemes(true);
    renderCanvas();
    renderPanel();
  }
  function undo() {
    if (!E.undo.length) return;
    E.redo.push(snapshot());
    restore(E.undo.pop());
    updateUndoButtons();
  }
  function redo() {
    if (!E.redo.length) return;
    E.undo.push(snapshot());
    restore(E.redo.pop());
    updateUndoButtons();
  }
  function updateUndoButtons() {
    if (!$('#t-undo')) return;
    $('#t-undo').disabled = !E.undo.length;
    $('#t-redo').disabled = !E.redo.length;
  }
  function changed() {
    E.p.updatedAt = Date.now();
    E.dirty = true;
    const s = $('#save-state');
    if (s) {
      s.textContent = 'Speichert …';
      s.classList.add('dirty');
    }
    clearTimeout(E.saveTimer);
    E.saveTimer = setTimeout(saveNow, 500);
  }
  async function saveNow() {
    clearTimeout(E.saveTimer);
    if (!E.p) return;
    try {
      await R.api.save(E.p);
      E.dirty = false;
      const s = $('#save-state');
      if (s) {
        s.textContent = 'Gespeichert';
        s.classList.remove('dirty');
      }
    } catch (err) {
      toast(`Speichern fehlgeschlagen: ${err.message}`, { err: true });
    }
  }

  function addEntity(x, y) {
    pushUndo();
    const chen = R.isChen(E.p.notation);
    let i = E.p.entities.length + 1;
    while (E.p.entities.some((e) => e.name === `Entität ${i}`)) i++;
    const e = {
      id: R.uid(),
      name: `Entität ${i}`,
      x: snapV(x - (chen ? 65 : 90)),
      y: snapV(y - (chen ? 28 : 45)),
      weak: false,
      attributes: [{ id: R.uid(), name: chen ? 'ID' : 'id', pk: true, type: 'INT' }],
    };
    E.p.entities.push(e);
    E.sel = { kind: 'entity', id: e.id };
    setTool('select');
    renderPanel();
    changed();
    focusField('#f-ename');
  }

  function addRelationship(from, to) {
    pushUndo();
    const chen = R.isChen(E.p.notation);
    const r = {
      id: R.uid(),
      name: chen ? 'hat' : '',
      from,
      to,
      cardFrom: { min: 1, max: '1' },
      cardTo: { min: 0, max: 'N' },
    };
    E.p.relationships.push(r);
    E.sel = { kind: 'rel', id: r.id };
    setTool('select');
    renderPanel();
    changed();
    focusField('#f-rname');
  }

  function addGeneralization(parent, child) {
    const gs = E.p.generalizations;
    let g = gs.find((x) => x.parent === parent);
    // erst prüfen, dann den Undo-Schritt anlegen – sonst geht bei einem Fehlversuch „Wiederholen“ verloren
    if (R.hasGenCycle([...gs, { parent, children: [child] }])) return toast('Das würde einen Kreis in der Vererbung erzeugen.', { err: true });
    if (g && g.children.includes(child)) toast('Diese Entität ist schon Untertyp.');
    else {
      pushUndo();
      if (g) g.children.push(child);
      else {
        g = { id: R.uid(), parent, children: [child], total: false, disjoint: true, mapping: 'subtables' };
        gs.push(g);
      }
    }
    E.sel = { kind: 'gen', id: g.id };
    // Werkzeug bleibt aktiv, damit weitere Untertypen direkt angeklickt werden können
    E.hover = null;
    renderCanvas();
    renderPanel();
    changed();
  }

  function deleteSelection() {
    const s = E.sel;
    if (!s) return;
    pushUndo();
    if (s.kind === 'entity') {
      E.p.entities = E.p.entities.filter((e) => e.id !== s.id);
      E.p.relationships = E.p.relationships.filter((r) => r.from !== s.id && r.to !== s.id);
      E.p.generalizations = E.p.generalizations
        .filter((g) => g.parent !== s.id)
        .map((g) => ({ ...g, children: g.children.filter((c) => c !== s.id) }))
        .filter((g) => g.children.length);
      E.sel = null;
    } else if (s.kind === 'gen') {
      E.p.generalizations = E.p.generalizations.filter((g) => g.id !== s.id);
      E.sel = null;
    } else if (s.kind === 'attr') {
      const e = owner(s.id);
      e.attributes = e.attributes.filter((a) => a.id !== s.attr);
      E.sel = ownerSel(s.id);
    } else if (s.kind === 'rel') {
      E.p.relationships = E.p.relationships.filter((r) => r.id !== s.id);
      E.sel = null;
    }
    renderCanvas();
    renderPanel();
    changed();
  }

  function focusField(sel) {
    setTimeout(() => {
      const el = $(sel);
      if (el) {
        el.focus();
        el.select();
      }
    }, 30);
  }

  // ---------- Eigenschaften-Panel ----------
  function renderPanel() {
    const panel = $('#panel');
    if (!panel) return;
    const s = E.sel;
    if (s && (s.kind === 'entity' || s.kind === 'attr') && entity(s.id)) panel.innerHTML = panelEntity(entity(s.id));
    else if (s && (s.kind === 'rel' || s.kind === 'attr') && relation(s.id)) panel.innerHTML = panelRel(relation(s.id));
    else if (s && s.kind === 'gen' && generalization(s.id)) panel.innerHTML = panelGen(generalization(s.id));
    else panel.innerHTML = panelProject();
  }

  function panelProject() {
    const p = E.p;
    return `
      <div class="panel-head"><h4>Projekt</h4><span class="pill">${esc(fmtShort(p.createdAt))}</span></div>
      <label class="field"><span>Name</span><input data-f="pname" value="${esc(p.name)}" maxlength="80" /></label>
      <label class="field"><span>Beschreibung</span><textarea data-f="pdesc" maxlength="200" placeholder="Optional">${esc(p.description)}</textarea></label>
      <label class="field"><span>Notation</span><select data-f="notation">${R.NOTATION_ORDER.map(
        (id) => `<option value="${id}" ${id === p.notation ? 'selected' : ''}>${esc(R.NOTATIONS[id].name)}</option>`
      ).join('')}</select></label>
      <div class="stats">
        <div class="stat"><b>${pad2(p.entities.length)}</b><span>Entitäten</span></div>
        <div class="stat"><b>${pad2(p.relationships.length)}</b><span>Beziehungen</span></div>
      </div>
      <div class="label" style="margin-bottom:12px">Tastenkürzel</div>
      <div class="shortcuts">
        <kbd>E</kbd><span>Entität platzieren</span>
        <kbd>R</kbd><span>Beziehung verbinden</span>
        <kbd>G</kbd><span>Generalisierung (IS-A)</span>
        <kbd>V</kbd><span>Auswählen & verschieben</span>
        <kbd>Entf</kbd><span>Auswahl löschen</span>
        <kbd>Strg Z</kbd><span>Rückgängig</span>
        <kbd>F</kbd><span>Ansicht einpassen</span>
        <kbd>L</kbd><span>Automatisch anordnen</span>
        <kbd>T</kbd><span>Diagramm / Tabellen</span>
        <kbd>Mausrad</kbd><span>Zoomen</span>
        <kbd>Ziehen</kbd><span>Fläche verschieben</span>
      </div>
      ${R.isDesktop ? `<button class="btn btn-light btn-sm" data-act="export-file" style="margin-top:22px;width:100%;justify-content:center">${I.download} Als Datei sichern</button>` : ''}`;
  }

  function attrRows(o, { pk = true, pkTitle = 'Primärschlüssel' } = {}) {
    // Der Typ ist in jeder Notation eingebbar: Chen zeigt ihn zwar nicht im Diagramm, Tabellen und SQL brauchen ihn aber
    return (o.attributes || [])
      .map(
        (a) => `<div class="attr-row ${E.sel.kind === 'attr' && E.sel.attr === a.id ? 'selected' : ''}" data-attr="${esc(a.id)}">
          ${pk ? `<button class="mini-btn pk ${a.pk ? 'on' : ''}" data-act="pk" title="${pkTitle}">${I.key}</button>` : ''}
          <input data-af="name" value="${esc(a.name)}" placeholder="Attributname" maxlength="200" title="${esc(a.name)}" />
          <input class="type" data-af="type" value="${esc(a.type)}" placeholder="Typ" maxlength="200" title="${esc(a.type)}" />
          <button class="mini-btn del" data-act="del-attr" title="Attribut entfernen">${I.x}</button>
        </div>`
      )
      .join('');
  }

  function panelEntity(e) {
    const chen = R.isChen(E.p.notation);
    const rows = attrRows(e);
    const moved = chen && (e.attributes || []).some((a) => typeof a.dx === 'number');
    return `
      <div class="panel-head"><h4>Entität</h4><span class="pill">${(e.attributes || []).length} Attribute</span></div>
      <label class="field"><span>Name</span><input id="f-ename" data-f="ename" value="${esc(e.name)}" maxlength="60" /></label>
      ${chen ? `<label class="check"><input type="checkbox" data-f="weak" ${e.weak ? 'checked' : ''} /> Schwache Entität (doppelter Rahmen)</label>` : ''}
      <div class="sub-head"><div class="label">Attribute</div><button class="link-btn" data-act="add-attr">${I.plus} Attribut</button></div>
      <div>${rows || '<p class="hint">Noch keine Attribute.</p>'}</div>
      <p class="hint">Der Schlüssel markiert den Primärschlüssel${chen ? (e.weak ? ' (gestrichelt unterstrichen, weil Teilschlüssel)' : ' (unterstrichen)') : ''}. <b>Enter</b> legt direkt ein weiteres Attribut an.${
        chen ? ' Der Typ erscheint in Tabellen und SQL. Attribut-Ellipsen kannst du auf der Fläche frei verschieben.' : ''
      }</p>
      ${moved ? `<button class="link-btn" data-act="reset-attrs">${I.layout} Attribute automatisch anordnen</button>` : ''}
      <button class="btn danger-btn btn-sm" data-act="del-entity">${I.trash} Entität löschen</button>`;
  }

  function panelRel(r) {
    const nt = E.p.notation;
    const A = entity(r.from);
    const B = entity(r.to);
    const ratio = R.ratioLabel(r);
    const opts = (c) =>
      R.CARD_OPTIONS.map((o) => `<option value="${o.v}" ${o.v === R.cardKey(c) ? 'selected' : ''}>${esc(o.label)} · ${esc(R.cardSymbol(nt === 'crow' ? 'uml' : nt, o))}</option>`).join('');
    const ents = (sel) => E.p.entities.map((e) => `<option value="${esc(e.id)}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    return `
      <div class="panel-head"><h4>Beziehung</h4><span class="pill ${R.NOTATIONS[nt].color}">${ratio}</span></div>
      <label class="field"><span>Bezeichnung</span><input id="f-rname" data-f="rname" value="${esc(r.name)}" placeholder="z. B. besitzt" maxlength="60" /></label>
      <div class="row2">
        <label class="field"><span>Von</span><select data-f="rfrom">${ents(r.from)}</select></label>
        <label class="field"><span>Nach</span><select data-f="rto">${ents(r.to)}</select></label>
      </div>
      <div class="label" style="margin:4px 0 10px">Kardinalität</div>
      <div class="presets">${['1:1', '1:N', 'N:M'].map((v) => `<button data-act="preset" data-v="${v}" class="${ratio === v ? 'active' : ''}">${v}</button>`).join('')}</div>
      <div class="card-box"><div class="q">Wie viele <b>${esc(A.name)}</b> gehören zu einer Instanz von <b>${esc(B.name)}</b>?</div><select data-f="cfrom">${opts(r.cardFrom)}</select></div>
      <div class="card-box"><div class="q">Wie viele <b>${esc(B.name)}</b> gehören zu einer Instanz von <b>${esc(A.name)}</b>?</div><select data-f="cto">${opts(r.cardTo)}</select></div>
      <button class="link-btn" data-act="swap">${I.swap} Richtung tauschen</button>
      ${R.isChen(nt) && typeof r.x === 'number' ? `<button class="link-btn" data-act="center-rel">${I.layout} Raute mittig setzen</button>` : ''}
      <div class="sub-head"><div class="label">Attribute</div><button class="link-btn" data-act="add-attr">${I.plus} Attribut</button></div>
      <div>${attrRows(r, { pk: ratio === 'N:M', pkTitle: 'Teil des Schlüssels der Verknüpfungstabelle' }) || '<p class="hint">Keine Attribute – z. B. Menge oder Datum der Beziehung.</p>'}</div>
      ${
        (r.attributes || []).length
          ? `<p class="hint">${
              ratio === 'N:M'
                ? 'Landen in der Verknüpfungstabelle. Der Schlüssel macht ein Attribut zum Teil ihres Primärschlüssels.'
                : 'Landen in der Tabelle, die den Fremdschlüssel trägt.'
            }</p>`
          : ''
      }
      ${(r.attributes || []).some((a) => typeof a.dx === 'number') || typeof r.bdx === 'number' ? `<button class="link-btn" data-act="reset-attrs">${I.layout} Attribute automatisch anordnen</button>` : ''}
      <button class="btn danger-btn btn-sm" data-act="del-rel">${I.trash} Beziehung löschen</button>`;
  }

  function panelGen(g) {
    const P = entity(g.parent);
    const free = E.p.entities.filter((e) => e.id !== g.parent && !g.children.includes(e.id));
    const kids = g.children
      .map(entity)
      .filter(Boolean)
      .map(
        (e) => `<div class="attr-row"><span class="gen-kid">${esc(e.name)}</span><button class="mini-btn del" data-act="gen-del-kid" data-id="${esc(e.id)}" title="Untertyp entfernen">${I.x}</button></div>`
      )
      .join('');
    const m = R.GEN_MAPPINGS[g.mapping] || R.GEN_MAPPINGS.subtables;
    return `
      <div class="panel-head"><h4>Generalisierung</h4><span class="pill">IS-A</span></div>
      <label class="field"><span>Obertyp</span><select data-f="gparent">${E.p.entities
        .map((e) => `<option value="${esc(e.id)}" ${e.id === g.parent ? 'selected' : ''}>${esc(e.name)}</option>`)
        .join('')}</select></label>
      <div class="sub-head"><div class="label">Untertypen</div><span class="pill">${g.children.length}</span></div>
      ${kids}
      ${free.length ? `<select class="input gen-add" data-f="gadd"><option value="">+ Untertyp hinzufügen …</option>${free.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select>` : ''}
      <div class="card-box" style="margin-top:16px">
        <div class="q">Muss jede Instanz von <b>${esc(P ? P.name : '')}</b> zu einem Untertyp gehören?</div>
        <div class="presets" style="margin:0"><button data-act="gen-total" data-v="0" class="${g.total ? '' : 'active'}">partiell</button><button data-act="gen-total" data-v="1" class="${g.total ? 'active' : ''}">total</button></div>
      </div>
      <div class="card-box">
        <div class="q">Darf eine Instanz zu mehreren Untertypen gehören?</div>
        <div class="presets" style="margin:0"><button data-act="gen-disj" data-v="1" class="${g.disjoint !== false ? 'active' : ''}">disjunkt</button><button data-act="gen-disj" data-v="0" class="${g.disjoint === false ? 'active' : ''}">überlappend</button></div>
      </div>
      <label class="field"><span>Abbildung in Tabellen</span><select data-f="gmap">${Object.entries(R.GEN_MAPPINGS)
        .map(([id, x]) => `<option value="${id}" ${id === g.mapping ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select></label>
      <p class="hint" style="margin-top:-6px">${esc(m.desc)}</p>
      ${typeof g.x === 'number' ? `<button class="link-btn" data-act="gen-center">Position zurücksetzen</button>` : ''}
      <p class="hint">Tipp: Mit dem Werkzeug <kbd>G</kbd> erst den Obertyp, dann nacheinander die Untertypen anklicken.</p>
      <button class="btn btn-sm danger-btn" data-act="del-gen">${I.trash} Generalisierung löschen</button>`;
  }

  function onPanelInput(ev) {
    const t = ev.target;
    if (t.matches('select, input[type="checkbox"]')) return;
    if (E.pendingSnap) {
      pushUndo(E.pendingSnap);
      E.pendingSnap = null;
    }
    const f = t.dataset.f;
    const af = t.dataset.af;
    if (f === 'pname') {
      E.p.name = t.value;
      $('#ed-name').textContent = t.value || 'Unbenannt';
    } else if (f === 'pdesc') E.p.description = t.value;
    else if (f === 'ename') entity(E.sel.id).name = t.value;
    else if (f === 'rname') relation(E.sel.id).name = t.value;
    else if (af) {
      const a = owner(E.sel.id).attributes.find((x) => x.id === t.closest('.attr-row').dataset.attr);
      a[af] = t.value;
    } else return;
    renderCanvas();
    changed();
  }

  function onPanelChange(ev) {
    const t = ev.target;
    const f = t.dataset.f;
    if (!['weak', 'notation', 'rfrom', 'rto', 'cfrom', 'cto', 'gparent', 'gadd', 'gmap'].includes(f)) return;
    if (f === 'gadd' && !t.value) return;
    if (f === 'gadd' || f === 'gparent') {
      // Kreise in der Vererbung verhindern (A Obertyp von B und B Obertyp von A)
      const cur = generalization(E.sel.id);
      const next = f === 'gadd' ? { ...cur, children: [...cur.children, t.value] } : { ...cur, parent: t.value, children: cur.children.filter((c) => c !== t.value) };
      if (R.hasGenCycle(E.p.generalizations.map((g) => (g === cur ? next : g)))) {
        toast('Das würde einen Kreis in der Vererbung erzeugen.', { err: true });
        return renderPanel();
      }
    }
    pushUndo();
    if (f === 'weak') entity(E.sel.id).weak = t.checked;
    else if (f === 'gparent' || f === 'gadd' || f === 'gmap') {
      const g = generalization(E.sel.id);
      if (f === 'gmap') g.mapping = t.value;
      else if (f === 'gadd') g.children.push(t.value);
      else {
        g.parent = t.value;
        g.children = g.children.filter((c) => c !== t.value);
        delete g.x;
        delete g.y;
        if (!g.children.length) E.p.generalizations = E.p.generalizations.filter((x) => x !== g);
        if (!g.children.length) E.sel = null;
      }
    }
    else if (f === 'notation') {
      E.p.notation = t.value;
      changed();
      return showEditor(true);
    } else {
      const r = relation(E.sel.id);
      if (f === 'rfrom') r.from = t.value;
      if (f === 'rto') r.to = t.value;
      if (f === 'cfrom') r.cardFrom = R.cardFromKey(t.value);
      if (f === 'cto') r.cardTo = R.cardFromKey(t.value);
      if (f === 'rfrom' || f === 'rto') {
        delete r.x;
        delete r.y;
      }
    }
    renderCanvas();
    renderPanel();
    changed();
  }

  function onPanelClick(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'export-file') {
      return R.api.exportFile(E.p).then((pth) => pth && toast('Projektdatei gespeichert'));
    }
    pushUndo();
    const s = E.sel;
    const row = b.closest('.attr-row');
    let focus = null;
    if (act === 'add-attr') {
      const a = { id: R.uid(), name: '', pk: false, type: '' };
      owner(s.id).attributes.push(a);
      focus = `.attr-row[data-attr="${a.id}"] input`;
    } else if (act === 'pk') {
      const a = owner(s.id).attributes.find((x) => x.id === row.dataset.attr);
      a.pk = !a.pk;
    } else if (act === 'del-attr') {
      const e = owner(s.id);
      e.attributes = e.attributes.filter((x) => x.id !== row.dataset.attr);
      if (s.kind === 'attr' && s.attr === row.dataset.attr) E.sel = ownerSel(s.id);
    } else if (act === 'reset-attrs') {
      const o = owner(s.id);
      delete o.bdx;
      delete o.bdy;
      o.attributes.forEach((a) => {
        delete a.dx;
        delete a.dy;
      });
    } else if (act === 'preset') {
      const r = relation(s.id);
      const map = {
        '1:1': [{ min: 1, max: '1' }, { min: 0, max: '1' }],
        '1:N': [{ min: 1, max: '1' }, { min: 0, max: 'N' }],
        'N:M': [{ min: 0, max: 'N' }, { min: 1, max: 'N' }],
      };
      [r.cardFrom, r.cardTo] = map[b.dataset.v];
    } else if (act === 'swap') {
      const r = relation(s.id);
      [r.from, r.to] = [r.to, r.from];
      [r.cardFrom, r.cardTo] = [r.cardTo, r.cardFrom];
    } else if (act === 'center-rel') {
      const r = relation(s.id);
      delete r.x;
      delete r.y;
    } else if (act === 'gen-total' || act === 'gen-disj') {
      generalization(s.id)[act === 'gen-total' ? 'total' : 'disjoint'] = b.dataset.v === '1';
    } else if (act === 'gen-center') {
      const g = generalization(s.id);
      delete g.x;
      delete g.y;
    } else if (act === 'gen-del-kid') {
      const g = generalization(s.id);
      g.children = g.children.filter((c) => c !== b.dataset.id);
      if (!g.children.length) {
        E.p.generalizations = E.p.generalizations.filter((x) => x !== g);
        E.sel = null;
      }
    } else if (act === 'del-entity' || act === 'del-rel' || act === 'del-gen') {
      E.undo.pop(); // deleteSelection legt selbst einen Undo-Schritt an
      return deleteSelection();
    }
    renderCanvas();
    renderPanel();
    changed();
    if (focus) focusField(focus);
  }

  function onPanelKey(ev) {
    if (ev.key === 'Enter' && ev.target.dataset.af === 'name') {
      ev.preventDefault();
      const btn = $('#panel [data-act="add-attr"]');
      if (btn) btn.click();
    }
  }

  // ---------- PDF ----------
  function pdfModal() {
    const d = R.diagramSvg(E.p, { padding: 12 });
    if (!d) return toast('Das Diagramm ist noch leer.', { err: true });
    let fmt = R.settings.pdfFormat;
    let content = E.mode === 'tables' ? 'tables' : R.settings.pdfContent || 'diagram';
    const contents = [
      ['diagram', 'Diagramm'],
      ['tables', 'Tabellen'],
      ['both', 'Beides'],
    ];
    const ratio = Math.max(0.4, Math.min(2.2, d.height / d.width));
    const formats = [
      ['a4-landscape', 'A4 Querformat', '297 × 210 mm', 40, 28],
      ['a4-portrait', 'A4 Hochformat', '210 × 297 mm', 28, 40],
      ['a3-landscape', 'A3 Querformat', '420 × 297 mm', 46, 32],
      ['fit', 'An Inhalt anpassen', 'Seite so groß wie das Diagramm', 36, Math.round(36 * ratio)],
    ];
    const m = modal(
      `<h3>Als PDF exportieren</h3>
      <p class="lead">Wird als Vektor-PDF gespeichert – gestochen scharf in jeder Größe.</p>
      <div class="label" style="margin-bottom:10px">Inhalt</div>
      <div class="presets" id="pdf-content">${contents
        .map(([id, t]) => `<button class="${id === content ? 'active' : ''}" data-content="${id}">${t}</button>`)
        .join('')}</div>
      <div class="label" style="margin:6px 0 10px">Format</div>
      <div class="choice-list">${formats
        .map(
          ([id, t, sub, w, h]) =>
            `<button class="choice ${id === fmt ? 'active' : ''}" data-fmt="${id}"><span class="sheet" style="width:${w * 0.7}px;height:${h * 0.7}px"></span><span><b>${t}</b><small>${sub}</small></span></button>`
        )
        .join('')}</div>
      <div style="margin-top:18px"><label class="check"><input type="checkbox" id="pdf-head" ${R.settings.pdfHeader ? 'checked' : ''} /> Titelzeile mit Projektname, Notation und Datum</label></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Abbrechen</button><button class="btn btn-dark" id="pdf-go">${I.pdf} Exportieren</button></div>`,
      'sm'
    );
    m.el.style.width = 'min(560px, calc(100vw - 60px))';
    $$('[data-fmt]', m.el).forEach(
      (b) =>
        (b.onclick = () => {
          fmt = b.dataset.fmt;
          $$('[data-fmt]', m.el).forEach((x) => x.classList.toggle('active', x === b));
        })
    );
    $$('[data-content]', m.el).forEach(
      (b) =>
        (b.onclick = () => {
          content = b.dataset.content;
          $$('[data-content]', m.el).forEach((x) => x.classList.toggle('active', x === b));
        })
    );
    $('#pdf-go', m.el).onclick = async () => {
      const header = $('#pdf-head', m.el).checked;
      R.settings.pdfFormat = fmt;
      R.settings.pdfHeader = header;
      R.settings.pdfContent = content;
      R.saveSettings();
      const tables = content === 'diagram' ? null : R.tablesHtml(R.toRelational(E.p));
      m.close();
      const n = R.NOTATIONS[E.p.notation];
      try {
        const file = await R.api.exportPdf({
          svg: d.svg,
          width: d.width,
          height: d.height,
          title: E.p.name,
          subtitle: `${n.name}-Notation · ${E.p.entities.length} Entitäten · ${E.p.relationships.length} Beziehungen · ${fmtLong(Date.now())}`,
          format: fmt,
          header,
          diagram: content !== 'tables',
          tables,
          tablesCss: R.TABLES_CSS,
        });
        if (file) toast('PDF gespeichert', { action: { label: 'Öffnen', fn: () => R.api.openPath(file) } });
      } catch (err) {
        toast(`PDF-Export fehlgeschlagen: ${err.message}`, { err: true });
      }
    };
  }

  // ---------- Notationen ----------
  const LEGENDS = {
    chen: [
      ['▭', 'Entität (doppelt = schwache Entität)'],
      ['◇', 'Beziehung (doppelt = identifiziert eine schwache Entität)'],
      ['⬭', 'Attribut, unterstrichen = Primärschlüssel, gestrichelt = Teilschlüssel'],
      ['1 · N · M', 'Kardinalität (Verhältnis)'],
      ['══', 'Doppellinie = totale Teilnahme'],
      ['△', 'Generalisierung (IS-A), d = disjunkt, o = überlappend'],
    ],
    minmax: [
      ['(0,1)', 'nimmt höchstens einmal teil'],
      ['(1,1)', 'nimmt genau einmal teil'],
      ['(0,n)', 'nimmt beliebig oft teil'],
      ['(1,n)', 'nimmt mindestens einmal teil'],
      ['◇◇', 'doppelte Raute = identifiziert eine schwache Entität'],
      ['△', 'Generalisierung (IS-A), Doppellinie = total'],
    ],
    crow: [
      ['—||', 'genau eine'],
      ['—o|', 'keine oder eine'],
      ['—|<', 'eine oder mehrere'],
      ['—o<', 'beliebig viele'],
      ['PK', 'Primärschlüssel'],
      ['—▷', 'Generalisierung zum Obertyp'],
    ],
    uml: [
      ['1', 'genau eine'],
      ['0..1', 'keine oder eine'],
      ['1..*', 'eine oder mehrere'],
      ['0..*', 'beliebig viele'],
      ['{PK}', 'Primärschlüssel'],
      ['name ▸', 'Bezeichnung mit Leserichtung'],
      ['—▷', 'Generalisierung zum Obertyp'],
    ],
  };

  function showGuide() {
    leaveEditor();
    state.route = 'guide';
    setNav('guide');
    view.innerHTML = `
      <div class="page-head"><div><div class="date">Nachschlagen</div><h1 class="hello"><span>Die</span> Notationen</h1></div></div>
      <div class="scroll"><div class="guide-grid">${R.NOTATION_ORDER.map((id) => {
        const n = R.NOTATIONS[id];
        return `<div class="guide-card">
          <h3>${esc(n.name)} <span class="pill ${n.color}">${esc(n.short)}</span></h3>
          <p>${esc(n.desc)}</p>
          <div class="prev">${thumbSvg({ notation: id, ...R.sampleDiagram(id, false) }, 20)}</div>
          <div class="legend">${LEGENDS[id].map(([a, b]) => `<code>${esc(a)}</code><span>${esc(b)}</span>`).join('')}</div>
        </div>`;
      }).join('')}</div></div>`;
  }

  // ---------- Einstellungen ----------
  function showSettings() {
    leaveEditor();
    state.route = 'settings';
    setNav('settings');
    const st = R.settings;
    // Electron trägt Name/Version der App in den User-Agent ein
    const version = (navigator.userAgent.match(/Relatio\/([\d.]+)/) || [])[1] || '';
    view.innerHTML = `
      <div class="page-head"><div><div class="date">${esc(`Relatio ${version}`.trim())}</div><h1 class="hello"><span>Deine</span> Einstellungen</h1></div></div>
      <div class="scroll">
        <div class="settings-card">
          <h3>Allgemein</h3>
          <label class="field"><span>Anzeigename</span><input id="s-name" value="${esc(st.userName)}" placeholder="${esc(state.osName || 'Dein Name')}" maxlength="40" /></label>
          <label class="check"><input type="checkbox" id="s-snap" ${st.snap ? 'checked' : ''} /> Elemente am 10-px-Raster ausrichten</label>
        </div>
        <div class="settings-card">
          <h3>PDF-Export</h3>
          <label class="field"><span>Standardformat</span><select id="s-pdf">
            ${[['a4-landscape', 'A4 Querformat'], ['a4-portrait', 'A4 Hochformat'], ['a3-landscape', 'A3 Querformat'], ['fit', 'An Inhalt anpassen']]
              .map(([v, l]) => `<option value="${v}" ${v === st.pdfFormat ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select></label>
          <label class="check"><input type="checkbox" id="s-head" ${st.pdfHeader ? 'checked' : ''} /> Titelzeile hinzufügen</label>
        </div>
        ${R.isDesktop ? `<div class="settings-card"><h3>Speicherort</h3><p class="hint" style="margin:0 0 14px">Projekte werden automatisch lokal gespeichert.</p><button class="btn btn-light btn-sm" id="s-folder">${I.folder} Projektordner öffnen</button></div>` : ''}
      </div>`;
    const save = () => {
      st.userName = $('#s-name').value.trim();
      st.snap = $('#s-snap').checked;
      st.pdfFormat = $('#s-pdf').value;
      st.pdfHeader = $('#s-head').checked;
      R.saveSettings();
    };
    $$('#view input, #view select').forEach((el) => el.addEventListener('change', save));
    $('#s-name').addEventListener('input', save);
    if ($('#s-folder')) $('#s-folder').onclick = () => R.api.openProjectsFolder();
  }

  // ---------- Global ----------
  document.addEventListener('keydown', (ev) => {
    const m = topModal();
    if (m) {
      if (ev.key === 'Escape') m.close();
      return;
    }
    if (state.route !== 'editor' || !E.p || typeof ev.key !== 'string') return;
    if (ev.key === 'Escape' && $('#theme-pop') && !$('#theme-pop').hidden) return toggleThemes(false);
    const typing = ev.target instanceof Element && ev.target.matches('input, textarea, select');
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (ctrl && k === 's') {
      ev.preventDefault();
      return saveNow().then(() => toast('Gespeichert'));
    }
    if (typing) {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    if (ctrl && k === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      return undo();
    }
    if (ctrl && (k === 'y' || (k === 'z' && ev.shiftKey))) {
      ev.preventDefault();
      return redo();
    }
    if (ctrl) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      return deleteSelection();
    }
    if (ev.key === 'Escape') {
      if (E.tool !== 'select') return setTool('select');
      if (E.sel) {
        E.sel = null;
        renderCanvas();
        renderPanel();
      }
      return;
    }
    if (k === 't') return setMode(E.mode === 'tables' ? 'diagram' : 'tables');
    if (E.mode === 'tables') return;
    if (k === 'v') setTool('select');
    else if (k === 'e') setTool('entity');
    else if (k === 'r') setTool('rel');
    else if (k === 'g') setTool('gen');
    else if (k === 'l') autoArrange();
    else if (k === 'f') fitView();
    else if (k === '+' || k === '=') zoomCenter(1.2);
    else if (k === '-') zoomCenter(1 / 1.2);
  });

  window.addEventListener('resize', () => state.route === 'editor' && applyView());
  window.addEventListener('beforeunload', () => E.dirty && saveNow());

  const ROUTES = { home: showHome, editor: () => showEditor(false), guide: showGuide, settings: showSettings };
  $$('.nav-btn').forEach((b) => {
    b.innerHTML = I[{ home: 'home', editor: 'diagram', guide: 'book', settings: 'settings' }[b.dataset.view]];
    b.onclick = () => ROUTES[b.dataset.view]();
  });

  (async function init() {
    await Promise.all(['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 14px "Plus Jakarta Sans"`).catch(() => {})));
    try {
      const n = await R.api.userName();
      state.osName = n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
    } catch {
      /* ohne Namen weiter */
    }
    showHome();
  })();

  R._debug = { E, state, openProject, showHome };
})();
