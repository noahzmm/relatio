// Notationen, Kardinalitäts-Beschriftungen und Beispieldiagramme
(function () {
  const R = (window.R = window.R || {});

  R.NOTATIONS = {
    chen: {
      id: 'chen',
      name: 'Chen',
      family: 'chen',
      color: 'orange',
      short: 'Klassisch',
      desc: 'Rechtecke für Entitäten, Rauten für Beziehungen und Ellipsen für Attribute. Kardinalitäten als 1, N und M.',
    },
    minmax: {
      id: 'minmax',
      name: '(min,max)',
      family: 'chen',
      color: 'purple',
      short: 'ISO',
      desc: 'Wie Chen, aber jede Kante trägt ein Intervall (min,max) – wie oft die Entität an der Beziehung teilnimmt.',
    },
    crow: {
      id: 'crow',
      name: "Crow's Foot",
      family: 'box',
      color: 'green',
      short: 'Martin',
      desc: 'Entitäten als Tabellen mit Attributliste, Krähenfüße und Striche zeigen die Kardinalität. Standard in der Praxis.',
    },
    uml: {
      id: 'uml',
      name: 'UML',
      family: 'box',
      color: 'blue',
      short: 'Klassendiagramm',
      desc: 'Entitäten als Klassen mit Attributen, Multiplizitäten wie 1, 0..1 oder 0..* an den Assoziationsenden.',
    },
  };
  R.NOTATION_ORDER = ['chen', 'minmax', 'crow', 'uml'];

  // Kardinalität eines Endes = "wie viele Instanzen dieser Entität gehören zu EINER Instanz der anderen"
  R.CARD_OPTIONS = [
    { v: '1-1', min: 1, max: '1', label: 'genau eine' },
    { v: '0-1', min: 0, max: '1', label: 'keine oder eine' },
    { v: '1-N', min: 1, max: 'N', label: 'eine oder mehrere' },
    { v: '0-N', min: 0, max: 'N', label: 'beliebig viele' },
  ];
  R.cardKey = (c) => `${c.min}-${c.max}`;
  R.cardFromKey = (k) => {
    const o = R.CARD_OPTIONS.find((x) => x.v === k) || R.CARD_OPTIONS[0];
    return { min: o.min, max: o.max };
  };
  R.cardSymbol = (notation, c) => {
    if (notation === 'minmax') return `(${c.min},${c.max === 'N' ? 'n' : '1'})`;
    if (notation === 'chen') return c.max === 'N' ? 'N' : '1';
    if (c.max === 'N') return c.min === 1 ? '1..*' : '0..*';
    return c.min === 1 ? '1' : '0..1';
  };

  /**
   * Beschriftung an der Kante zur Entität eines Endes.
   * own = Kardinalität dieses Endes, other = des anderen Endes.
   */
  R.endLabel = function (notation, own, other, isFromEnd) {
    switch (notation) {
      case 'chen':
        // N:M – wie überall in der Oberfläche: N an der ersten, M an der zweiten Entität
        if (own.max === 'N') return other.max === 'N' ? (isFromEnd ? 'N' : 'M') : 'N';
        return '1';
      case 'uml':
        if (own.max === 'N') return own.min === 1 ? '1..*' : '0..*';
        return own.min === 1 ? '1' : '0..1';
      case 'minmax':
        // Teilnahme: jede Instanz dieser Entität nimmt (other.min .. other.max)-mal teil
        return `(${other.min},${other.max === 'N' ? 'n' : '1'})`;
      default:
        return '';
    }
  };

  R.ratioLabel = (rel) => {
    const a = rel.cardFrom.max === 'N' ? 'N' : '1';
    const b = rel.cardTo.max === 'N' ? 'N' : '1';
    if (a === 'N' && b === 'N') return 'N:M';
    return `${a}:${b}`;
  };

  /**
   * Identifizierende Beziehung: verbindet eine schwache mit einer starken Entität,
   * und jede schwache Instanz gehört zu genau einer starken (ohne sie kann sie nicht existieren).
   */
  R.isIdentifying = function (rel, a, b) {
    if (!a || !b || !rel.cardFrom || !rel.cardTo) return false;
    const one = (c) => c.max !== 'N' && c.min === 1;
    return !!((b.weak && !a.weak && one(rel.cardFrom)) || (a.weak && !b.weak && one(rel.cardTo)));
  };

  // ---------- Farbschemata des Diagramms ----------
  const theme = (name, o = {}) => ({
    name,
    ink: '#141416', // Text
    sub: '#3A3A40', // Nebentext
    muted: '#8E8E93',
    line: '#141416', // Verbindungslinien
    entFill: '#FFFFFF',
    entStroke: '#141416',
    head: '#141416', // Tabellenkopf (Crow's Foot)
    headText: '#FFFFFF',
    soft: '#F3F3F5', // Klassenkopf (UML)
    relFill: '#FFFFFF',
    relStroke: '#141416',
    attrFill: '#FFFFFF',
    attrStroke: '#141416',
    rowLine: '#EFEFF2',
    pkBg: '#FFE9E5',
    pkFg: '#E5402F',
    ...o,
  });
  R.THEMES = {
    classic: theme('Klassisch'),
    graphite: theme('Graphit', {
      ink: '#1E2126', sub: '#3C424B', muted: '#7C828C', line: '#5B616B',
      entFill: '#F5F6F8', entStroke: '#5B616B', head: '#3C424B', soft: '#E4E6EA',
      relFill: '#ECEEF1', relStroke: '#5B616B', attrStroke: '#8A909A', rowLine: '#E3E5E9', pkBg: '#E1E4E8', pkFg: '#3C424B',
    }),
    ocean: theme('Ozean', {
      ink: '#0F2A47', sub: '#2C4A6B', muted: '#6F87A3', line: '#1F5FA8',
      entFill: '#F2F7FF', entStroke: '#1F5FA8', head: '#1F5FA8', soft: '#DCE9FB',
      relFill: '#E3EEFC', relStroke: '#1F5FA8', attrStroke: '#5B8FCB', rowLine: '#DCE7F5', pkBg: '#D6E6FB', pkFg: '#1F5FA8',
    }),
    forest: theme('Wald', {
      ink: '#12301F', sub: '#2C5540', muted: '#6E8F7C', line: '#2E7D4F',
      entFill: '#F1FAF4', entStroke: '#2E7D4F', head: '#2E7D4F', soft: '#D9F0E1',
      relFill: '#E2F4E8', relStroke: '#2E7D4F', attrStroke: '#5FA67C', rowLine: '#DAEDE1', pkBg: '#D5EFDE', pkFg: '#23693F',
    }),
    berry: theme('Beere', {
      ink: '#2E1436', sub: '#553060', muted: '#94789B', line: '#8E3A9D',
      entFill: '#FBF4FD', entStroke: '#8E3A9D', head: '#8E3A9D', soft: '#F0DDF5',
      relFill: '#F5E4F8', relStroke: '#8E3A9D', attrStroke: '#B57BC0', rowLine: '#EEDFF2', pkBg: '#F0D9F5', pkFg: '#7B2C8A',
    }),
    sunset: theme('Abendrot', {
      ink: '#3A1D0B', sub: '#6B3A1C', muted: '#A5846E', line: '#B24E14',
      entFill: '#FFF6EE', entStroke: '#B24E14', head: '#B24E14', soft: '#FCE3CD',
      relFill: '#FDEBD9', relStroke: '#B24E14', attrStroke: '#DD8B55', rowLine: '#F6E3D2', pkBg: '#FBDCC3', pkFg: '#A8480F',
    }),
    colorful: theme('Bunt', {
      line: '#3A3A40',
      entFill: '#E6F0FF', entStroke: '#2F6FDB', head: '#2F6FDB', soft: '#CFE0FB',
      relFill: '#FFF1CC', relStroke: '#C98A00', attrFill: '#E4F7EA', attrStroke: '#2BA85A', rowLine: '#D3E2F8', pkBg: '#CFE0FB', pkFg: '#2459B5',
    }),
  };
  R.THEME_ORDER = ['classic', 'graphite', 'ocean', 'forest', 'berry', 'sunset', 'colorful'];
  R.themeOf = (project) => R.THEMES[project && project.theme] || R.THEMES.classic;

  /**
   * Bringt ein geladenes oder importiertes Projekt in eine gültige Form,
   * damit eine beschädigte Datei nicht die ganze Oberfläche lahmlegt.
   */
  R.normalizeProject = function (p) {
    if (!p || typeof p !== 'object') throw new Error('Keine gültige Relatio-Datei');
    const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const str = (v, d = '') => (typeof v === 'string' ? v : d);
    const card = (c, d) => {
      const o = c && typeof c === 'object' ? c : d;
      return { min: o.min === 0 || o.min === '0' ? 0 : 1, max: o.max === 'N' ? 'N' : '1' };
    };
    const attrs = (list) =>
      (Array.isArray(list) ? list : [])
        .filter((a) => a && typeof a === 'object')
        .map((a) => {
          const o = { id: str(a.id) || R.uid(), name: str(a.name), pk: !!a.pk, type: str(a.type) };
          if (typeof a.dx === 'number' && typeof a.dy === 'number') Object.assign(o, { dx: a.dx, dy: a.dy });
          return o;
        });
    const pos = (src, dst, a, b) => {
      if (typeof src[a] === 'number' && typeof src[b] === 'number' && Number.isFinite(src[a]) && Number.isFinite(src[b])) Object.assign(dst, { [a]: src[a], [b]: src[b] });
    };

    p.name = str(p.name, 'Unbenannt');
    p.description = str(p.description);
    if (!R.NOTATIONS[p.notation]) p.notation = 'chen';
    if (!R.THEMES[p.theme]) p.theme = 'classic';
    p.entities = (Array.isArray(p.entities) ? p.entities : [])
      .filter((e) => e && typeof e === 'object')
      .map((e, i) => ({ id: str(e.id) || R.uid(), name: str(e.name), x: num(e.x, 60 + i * 40), y: num(e.y, 60 + i * 40), weak: !!e.weak, attributes: attrs(e.attributes) }));
    const ids = new Set(p.entities.map((e) => e.id));
    p.relationships = (Array.isArray(p.relationships) ? p.relationships : [])
      .filter((r) => r && typeof r === 'object' && ids.has(r.from) && ids.has(r.to))
      .map((r) => {
        const o = { id: str(r.id) || R.uid(), name: str(r.name), from: r.from, to: r.to, cardFrom: card(r.cardFrom, { min: 1, max: '1' }), cardTo: card(r.cardTo, { min: 0, max: 'N' }) };
        if (Array.isArray(r.attributes) && r.attributes.length) o.attributes = attrs(r.attributes);
        pos(r, o, 'x', 'y');
        pos(r, o, 'bdx', 'bdy');
        return o;
      });
    p.generalizations = (Array.isArray(p.generalizations) ? p.generalizations : [])
      .filter((g) => g && typeof g === 'object' && ids.has(g.parent))
      .map((g) => {
        const kids = [...new Set((Array.isArray(g.children) ? g.children : []).filter((c) => ids.has(c) && c !== g.parent))];
        const o = { id: str(g.id) || R.uid(), parent: g.parent, children: kids, total: !!g.total, disjoint: g.disjoint !== false, mapping: str(g.mapping, 'subtables') };
        pos(g, o, 'x', 'y');
        return o;
      })
      .filter((g) => g.children.length);
    return p;
  };

  /** true, wenn die Generalisierungen einen Kreis bilden (A ist Obertyp von B und umgekehrt). */
  R.hasGenCycle = function (gens) {
    const up = new Map(); // Untertyp → Obertypen
    for (const g of gens || []) for (const c of g.children || []) up.set(c, [...(up.get(c) || []), g.parent]);
    const state = new Map();
    const visit = (id) => {
      if (state.get(id) === 1) return true;
      if (state.get(id) === 2) return false;
      state.set(id, 1);
      for (const p of up.get(id) || []) if (visit(p)) return true;
      state.set(id, 2);
      return false;
    };
    return [...up.keys()].some(visit);
  };

  function attr(name, pk, type) {
    return { id: R.uid(), name, pk: !!pk, type: type || '' };
  }

  /** Beispiel: Kunde 1:N Bestellung N:M Produkt */
  R.sampleDiagram = function (notation, compact) {
    const chen = R.NOTATIONS[notation].family === 'chen';
    const gap = chen ? 470 : 440;
    const y = chen ? 240 : 80;
    const kunde = {
      id: R.uid(),
      name: 'Kunde',
      x: 60,
      y,
      weak: false,
      attributes: compact
        ? [attr('KundenNr', true, 'INT'), attr('Name', false, 'VARCHAR')]
        : [attr('KundenNr', true, 'INT'), attr('Name', false, 'VARCHAR'), attr('E-Mail', false, 'VARCHAR')],
    };
    const bestellung = {
      id: R.uid(),
      name: 'Bestellung',
      x: 60 + gap,
      y,
      weak: false,
      attributes: compact
        ? [attr('BestellNr', true, 'INT'), attr('Datum', false, 'DATE')]
        : [attr('BestellNr', true, 'INT'), attr('Datum', false, 'DATE'), attr('Status', false, 'VARCHAR')],
    };
    const entities = [kunde, bestellung];
    const relationships = [
      {
        id: R.uid(),
        name: 'gibt auf',
        from: kunde.id,
        to: bestellung.id,
        cardFrom: { min: 1, max: '1' },
        cardTo: { min: 0, max: 'N' },
      },
    ];
    if (!compact) {
      const produkt = {
        id: R.uid(),
        name: 'Produkt',
        x: 60 + gap * 2,
        y,
        weak: false,
        attributes: [attr('ArtikelNr', true, 'INT'), attr('Bezeichnung', false, 'VARCHAR'), attr('Preis', false, 'DECIMAL')],
      };
      entities.push(produkt);
      relationships.push({
        id: R.uid(),
        name: 'enthält',
        from: bestellung.id,
        to: produkt.id,
        cardFrom: { min: 0, max: 'N' },
        cardTo: { min: 1, max: 'N' },
      });
    }
    return { entities, relationships };
  };

  R.newProject = function ({ name, description, notation, withSample }) {
    const now = Date.now();
    const base = withSample ? R.sampleDiagram(notation, false) : { entities: [], relationships: [] };
    return {
      id: R.uid(),
      name: name || 'Neues Diagramm',
      description: description || '',
      notation,
      theme: 'classic',
      createdAt: now,
      updatedAt: now,
      entities: base.entities,
      relationships: base.relationships,
      generalizations: [],
    };
  };
})();
