// ER-Modell → Relationenmodell (Tabellen) und SQL
//
// Regeln:
//  - jede Entität wird eine Tabelle, ohne Primärschlüssel wird "id" ergänzt
//  - 1:N  → Fremdschlüssel auf der N-Seite
//  - 1:1  → Fremdschlüssel (UNIQUE) auf der Seite, die zwingend teilnimmt
//  - N:M  → eigene Verknüpfungstabelle mit zusammengesetztem Primärschlüssel
//  - schwache Entität → Fremdschlüssel zur starken Entität wird Teil des Primärschlüssels
(function () {
  const R = (window.R = window.R || {});

  const GENERIC_PK = /^(id|nr|no|key)$/i;
  const clean = (s) => String(s || '').trim();

  function uniqueName(name, taken) {
    let n = name;
    let i = 2;
    while (taken.has(n.toLowerCase())) n = `${name}_${i++}`;
    taken.add(n.toLowerCase());
    return n;
  }

  // Abbildung von Generalisierungen
  R.GEN_MAPPINGS = {
    subtables: { name: 'Tabelle je Typ', desc: 'Obertyp und jeder Untertyp bekommen eine Tabelle. Untertypen erben den Primärschlüssel als Fremdschlüssel.' },
    single: { name: 'Eine Tabelle', desc: 'Alles in der Tabelle des Obertyps, eine Typ-Spalte unterscheidet die Untertypen.' },
    children: { name: 'Nur Untertypen', desc: 'Nur die Untertypen werden Tabellen und übernehmen alle Attribute des Obertyps.' },
  };

  R.toRelational = function (p) {
    const ents = p.entities || [];
    const byId = new Map(ents.map((e) => [e.id, e]));
    const tableNames = new Set();
    const raw = new Map(); // Entitäts-ID → Tabelle
    let group = 0;

    for (const e of ents) {
      const taken = new Set();
      const t = { kind: 'entity', entityId: e.id, name: uniqueName(clean(e.name) || 'Entität', tableNames), weak: !!e.weak, columns: [], notes: [], _taken: taken };
      for (const a of e.attributes || []) {
        const name = clean(a.name);
        if (!name) continue;
        t.columns.push({ name: uniqueName(name, taken), type: clean(a.type), pk: !!a.pk, fk: null, nullable: !a.pk, unique: false });
      }
      raw.set(e.id, t);
    }

    // ---- Generalisierungen ----
    const gens = (p.generalizations || [])
      .map((g) => ({ ...g, children: (g.children || []).filter((c) => byId.has(c) && c !== g.parent), mapping: R.GEN_MAPPINGS[g.mapping] ? g.mapping : 'subtables' }))
      .filter((g) => byId.has(g.parent) && g.children.length);
    const subOf = new Map(); // Untertyp → Generalisierung (erste gewinnt)
    for (const g of gens) for (const c of g.children) if (!subOf.has(c)) subOf.set(c, g);

    const done = new Set();
    function finalize(id, stack = new Set()) {
      if (done.has(id) || stack.has(id)) return;
      stack.add(id);
      const t = raw.get(id);
      const g = subOf.get(id);
      if (g && g.mapping !== 'single') {
        finalize(g.parent, stack);
        const P = raw.get(g.parent);
        if (t.columns.some((c) => c.pk)) t.notes.push(`Eigener Schlüssel ersetzt durch den Schlüssel von ${P.name}.`);
        t.columns.forEach((c) => {
          if (c.pk) {
            c.pk = false;
            c.unique = true;
          }
        });
        if (g.mapping === 'subtables') {
          addFk(t, P, { name: '' }, { asPk: true, inherit: true });
          t.notes.push(`Untertyp von ${P.name}.`);
        } else {
          // alle Spalten des Obertyps übernehmen
          const copies = P.columns.map((c) => ({ ...c, name: uniqueName(c.name, t._taken), fk: c.fk && { ...c.fk } }));
          t.columns.unshift(...copies);
          t.notes.push(`Enthält alle Attribute von ${P.name}.`);
        }
      } else if (!g && !t.columns.some((c) => c.pk)) {
        t.columns.unshift({ name: uniqueName('id', t._taken), type: 'INT', pk: true, fk: null, nullable: false, unique: false });
        t.notes.push('Kein Primärschlüssel festgelegt – „id“ wurde ergänzt.');
      }
      done.add(id);
    }

    // Fremdschlüsselspalten "child verweist auf parent" anlegen
    function addFk(child, parent, rel, { nullable = false, unique = false, asPk = false, role = '', inherit = false }) {
      const g = ++group;
      const relName = clean(rel.name).replace(/\s+/g, '_');
      const cols = [];
      for (const pc of parent.columns.filter((c) => c.pk)) {
        let base = inherit || !GENERIC_PK.test(pc.name) ? pc.name : `${parent.name}_${pc.name}`;
        if (role) base = `${role}_${base}`;
        else if (child === parent) base = `${relName || 'ref'}_${base}`;
        else if (child._taken.has(base.toLowerCase()) && relName) base = `${base}_${relName}`;
        cols.push({
          name: uniqueName(base.replace(/\s+/g, '_'), child._taken),
          type: pc.type || 'INT',
          pk: asPk,
          fk: { table: parent.name, column: pc.name, group: g },
          nullable: !asPk && nullable,
          unique: unique && !asPk,
        });
      }
      if (inherit) child.columns.unshift(...cols);
      else child.columns.push(...cols);
    }

    // Attribute einer Beziehung an die Tabelle hängen, die die Beziehung trägt
    function addRelAttrs(t, rel, { keys = false, nullable = false } = {}) {
      for (const a of rel.attributes || []) {
        const name = clean(a.name);
        if (!name) continue;
        const pk = keys && !!a.pk;
        t.columns.push({ name: uniqueName(name.replace(/\s+/g, '_'), t._taken), type: clean(a.type), pk, fk: null, nullable: !pk && nullable, unique: false });
      }
    }

    for (const e of ents) finalize(e.id);

    // "Eine Tabelle": Untertypen in den Obertyp einfalten
    const alias = new Map(); // Entitäts-ID → Tabelle, in der sie steckt
    const dropped = new Set(); // Entitäts-IDs ohne eigene Tabelle
    for (const g of gens.filter((x) => x.mapping === 'single')) {
      const P = raw.get(g.parent);
      const kids = g.children.filter((c) => subOf.get(c) === g);
      if (!kids.length) continue;
      if (g.disjoint !== false) {
        P.columns.push({ name: uniqueName('Typ', P._taken), type: 'VARCHAR', pk: false, fk: null, nullable: !g.total, unique: false });
        P.notes.push(`„Typ“ ist ${kids.map((c) => raw.get(c).name).join(', ')}${g.total ? '' : ' oder leer'}.`);
      } else {
        kids.forEach((c) => P.columns.push({ name: uniqueName(`ist_${raw.get(c).name}`, P._taken), type: 'BOOLEAN', pk: false, fk: null, nullable: false, unique: false }));
      }
      for (const c of kids) {
        const C = raw.get(c);
        C.columns.forEach((col) => P.columns.push({ ...col, name: uniqueName(col.name, P._taken), pk: false, nullable: true, unique: false }));
        alias.set(c, P);
        dropped.add(c);
      }
      P.notes.push(`Enthält die Untertypen ${kids.map((c) => raw.get(c).name).join(', ')}.`);
    }
    // "Nur Untertypen": Obertyp verschwindet
    const childrenOf = new Map();
    for (const g of gens.filter((x) => x.mapping === 'children')) {
      const kids = g.children.filter((c) => subOf.get(c) === g && !dropped.has(c));
      if (!kids.length) continue;
      dropped.add(g.parent);
      childrenOf.set(g.parent, kids.map((c) => raw.get(c)));
      if (!g.total) kids.forEach((c) => raw.get(c).notes.push(`Achtung: ${raw.get(g.parent).name} ist nicht total – reine ${raw.get(g.parent).name}-Instanzen haben keine Tabelle.`));
    }

    const tables = [];
    for (const e of ents) {
      if (alias.has(e.id) || dropped.has(e.id)) continue;
      tables.push(raw.get(e.id));
    }
    // Ziel-Tabellen einer Entität (bei "Nur Untertypen" alle Untertypen)
    const targets = (id) => {
      if (alias.has(id)) return [alias.get(id)];
      if (childrenOf.has(id)) return childrenOf.get(id).flatMap((t) => (t.entityId === id ? [t] : targets(t.entityId)));
      return [raw.get(id)];
    };

    const rels = (p.relationships || []).filter((r) => byId.has(r.from) && byId.has(r.to));
    // identifizierende Beziehungen schwacher Entitäten zuerst, damit deren Schlüssel vollständig sind
    const identifying = (r) => {
      const a = byId.get(r.from);
      const b = byId.get(r.to);
      return (b.weak && !a.weak && r.cardFrom.max !== 'N') || (a.weak && !b.weak && r.cardTo.max !== 'N') ? 1 : 0;
    };
    rels.sort((x, y) => identifying(y) - identifying(x));

    for (const r of rels) {
      const As = targets(r.from);
      const Bs = targets(r.to);
      if (As.length !== 1 || Bs.length !== 1) {
        // Beziehung zu einem aufgelösten Obertyp: nur möglich, wenn der Obertyp den Fremdschlüssel trägt
        const aMany = r.cardFrom.max === 'N';
        const bMany = r.cardTo.max === 'N';
        if (Bs.length > 1 && As.length === 1 && bMany && !aMany)
          Bs.forEach((B) => {
            addFk(B, As[0], r, { nullable: r.cardFrom.min !== 1 });
            addRelAttrs(B, r, { nullable: true });
          });
        else if (As.length > 1 && Bs.length === 1 && aMany && !bMany)
          As.forEach((A) => {
            addFk(A, Bs[0], r, { nullable: r.cardTo.min !== 1 });
            addRelAttrs(A, r, { nullable: true });
          });
        else [...As, ...Bs].forEach((t) => t.notes.push(`Beziehung „${clean(r.name) || 'ohne Namen'}“ verweist auf einen aufgelösten Obertyp und wurde nicht abgebildet.`));
        continue;
      }
      const A = As[0];
      const B = Bs[0];
      const aMany = r.cardFrom.max === 'N'; // viele A je B
      const bMany = r.cardTo.max === 'N'; // viele B je A
      if (aMany && bMany) {
        const t = {
          kind: 'junction',
          relId: r.id,
          name: uniqueName(clean(r.name) || `${A.name}_${B.name}`, tableNames),
          columns: [],
          notes: [`Verknüpfungstabelle für die N:M-Beziehung zwischen ${A.name} und ${B.name}.`],
          _taken: new Set(),
        };
        const self = A === B;
        addFk(t, A, r, { asPk: true, role: self ? 'von' : '' });
        addFk(t, B, r, { asPk: true, role: self ? 'zu' : '' });
        addRelAttrs(t, r, { keys: true, nullable: true });
        tables.push(t);
        continue;
      }
      // Fremdschlüssel in die Tabelle, deren Instanz höchstens EINEN Partner hat
      let child, parent, parentCard;
      if (bMany) [child, parent, parentCard] = [B, A, r.cardFrom];
      else if (aMany) [child, parent, parentCard] = [A, B, r.cardTo];
      else if (r.cardFrom.min === 1 || r.cardTo.min !== 1) [child, parent, parentCard] = [B, A, r.cardFrom];
      else [child, parent, parentCard] = [A, B, r.cardTo];
      // steckt der Untertyp in der Tabelle des Obertyps, muss der Fremdschlüssel leer sein dürfen
      const folded = alias.has(child === A ? r.from : r.to);
      addFk(child, parent, r, { nullable: folded || parentCard.min !== 1, unique: !aMany && !bMany, asPk: child.weak && !parent.weak && !folded });
      // bei optionaler Teilnahme kann der Wert fehlen
      addRelAttrs(child, r, { nullable: folded || parentCard.min !== 1 });
      if ((r.attributes || []).some((a) => a.pk && clean(a.name))) child.notes.push(`Schlüssel an Attributen von „${clean(r.name) || 'Beziehung'}“ gelten nur bei N:M.`);
    }

    for (const t of tables) {
      delete t._taken;
      t.columns.sort((x, y) => (y.pk ? 1 : 0) - (x.pk ? 1 : 0)); // Schlüssel nach vorne (stabil)
    }
    return tables;
  };

  // ---------- SQL ----------
  const dq = (s) => `"${s.replace(/"/g, '""')}"`;
  R.SQL_DIALECTS = {
    postgres: { name: 'PostgreSQL', q: dq },
    mysql: { name: 'MySQL', q: (s) => `\`${s.replace(/`/g, '``')}\`` },
    sqlite: { name: 'SQLite', q: dq },
    sqlserver: { name: 'SQL Server', q: (s) => `[${s.replace(/]/g, ']]')}]` },
  };

  function sqlType(type, dialect) {
    const t = clean(type).toUpperCase();
    if (!t || t === 'VARCHAR' || t === 'STRING') return dialect === 'sqlserver' ? 'NVARCHAR(255)' : 'VARCHAR(255)';
    if (t === 'BOOL' || t === 'BOOLEAN') return dialect === 'sqlserver' ? 'BIT' : 'BOOLEAN';
    if (t === 'DECIMAL' || t === 'NUMERIC') return 'DECIMAL(10,2)';
    if (t === 'DATETIME' && dialect === 'postgres') return 'TIMESTAMP';
    return clean(type);
  }

  R.toSql = function (p, dialect = 'postgres') {
    const D = R.SQL_DIALECTS[dialect] || R.SQL_DIALECTS.postgres;
    const q = D.q;
    const tables = R.toRelational(p);
    const out = [`-- ${clean(p.name) || 'Diagramm'}`, `-- erstellt mit Relatio (${D.name})`, ''];

    // Tabellen, deren Verweisziele schon existieren, zuerst; Zyklen über ALTER TABLE
    const order = [];
    const rest = tables.slice();
    while (rest.length) {
      const i = rest.findIndex((t) => t.columns.every((c) => !c.fk || c.fk.table === t.name || order.some((o) => o.name === c.fk.table)));
      order.push(...rest.splice(Math.max(i, 0), 1));
    }

    const created = new Set();
    const deferred = [];
    for (const t of order) {
      const lines = t.columns.map((c) => `  ${q(c.name)} ${sqlType(c.type, dialect)}${c.nullable ? '' : ' NOT NULL'}`);
      const pk = t.columns.filter((c) => c.pk).map((c) => q(c.name));
      if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(', ')})`);
      t.columns.filter((c) => c.unique).forEach((c) => lines.push(`  UNIQUE (${q(c.name)})`));
      const groups = new Map();
      t.columns.filter((c) => c.fk).forEach((c) => groups.set(c.fk.group, [...(groups.get(c.fk.group) || []), c]));
      for (const cols of groups.values()) {
        const ref = cols[0].fk.table;
        const fk = `FOREIGN KEY (${cols.map((c) => q(c.name)).join(', ')}) REFERENCES ${q(ref)} (${cols.map((c) => q(c.fk.column)).join(', ')})`;
        if (ref === t.name || created.has(ref)) lines.push(`  ${fk}`);
        else deferred.push(`ALTER TABLE ${q(t.name)} ADD ${fk};`);
      }
      out.push(`CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`, '');
      created.add(t.name);
    }
    if (deferred.length) out.push(...deferred, '');
    return out.join('\n');
  };

  // ---------- HTML (Ansicht & PDF) ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  R.tablesHtml = function (tables, { selectable = false } = {}) {
    return tables
      .map((t) => {
        const rows = t.columns
          .map(
            (c) => `<tr>
              <td class="tc-name ${c.pk ? 'is-pk' : ''}">${esc(c.name)}</td>
              <td class="tc-type">${esc(c.type || '–')}</td>
              <td class="tc-keys">${c.pk ? '<span class="k pk">PK</span>' : ''}${c.fk ? '<span class="k fk">FK</span>' : ''}${c.unique ? '<span class="k uq">UQ</span>' : ''}</td>
              <td class="tc-ref">${c.fk ? `→ ${esc(c.fk.table)}.${esc(c.fk.column)}` : c.nullable ? '' : '<span class="nn">NOT NULL</span>'}</td>
            </tr>`
          )
          .join('');
        const sel = !selectable ? '' : t.entityId ? ` data-entity="${esc(t.entityId)}"` : ` data-rel="${esc(t.relId)}"`;
        const tag = t.kind === 'junction' ? '<span class="tt-tag">N:M</span>' : t.weak ? '<span class="tt-tag">schwach</span>' : '';
        const schema = `${esc(t.name)} (${t.columns.map((c) => (c.pk ? `<u>${esc(c.name)}</u>` : esc(c.name)) + (c.fk ? '<sup>↑</sup>' : '')).join(', ')})`;
        return `<div class="ttable"${sel}>
          <div class="tt-head"><b>${esc(t.name)}</b>${tag}</div>
          <table>${rows}</table>
          <div class="tt-schema">${schema}</div>
          ${t.notes.map((n) => `<div class="tt-note">${esc(n)}</div>`).join('')}
        </div>`;
      })
      .join('');
  };

  // gemeinsame Optik für App und PDF
  R.TABLES_CSS = `
    .ttable { background: #fff; border: 1.5px solid #e8e8ec; border-radius: 16px; padding: 14px 16px 12px; break-inside: avoid; }
    .tt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .tt-head b { font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
    .tt-tag { font-size: 10.5px; font-weight: 700; color: #7b4ddb; background: #f1eaff; border-radius: 999px; padding: 2px 8px; }
    .ttable table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .ttable td { padding: 6px 4px; border-top: 1px solid #f0f0f3; vertical-align: middle; }
    .tc-name { font-weight: 600; }
    .tc-name.is-pk { text-decoration: underline; text-underline-offset: 3px; }
    .tc-type { color: #8e8e93; font-size: 11.5px; }
    .tc-keys { white-space: nowrap; width: 1%; }
    .tc-ref { color: #3d6be0; font-size: 11.5px; text-align: right; white-space: nowrap; }
    .k { display: inline-block; font-size: 10px; font-weight: 800; border-radius: 5px; padding: 1px 5px; margin-right: 3px; }
    .k.pk { background: #ffe9e5; color: #e5402f; }
    .k.fk { background: #e9f0ff; color: #3d6be0; }
    .k.uq { background: #e6f8ec; color: #2ba85a; }
    .nn { color: #b8b8bd; font-size: 10.5px; font-weight: 700; }
    .tt-schema { margin-top: 8px; font-size: 11.5px; color: #3a3a40; background: #f4f4f6; border-radius: 9px; padding: 7px 10px; line-height: 1.5; word-break: break-word; }
    .tt-schema u { text-underline-offset: 2px; }
    .tt-schema sup { color: #3d6be0; font-size: 9px; }
    .tt-note { margin-top: 6px; font-size: 11px; color: #8e8e93; }
  `;
  const style = document.createElement('style');
  style.textContent = R.TABLES_CSS;
  document.head.append(style);
})();
