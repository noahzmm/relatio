// Diagramm-Layout & SVG-Rendering für alle Notationen (gemeinsam für Editor, Vorschau und PDF)
(function () {
  const R = (window.R = window.R || {});
  const FONT = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  const ACCENT = '#FF3B30';
  const PAPER = '#fff';
  let T = R.THEMES.classic; // aktives Farbschema, wird je Rendervorgang gesetzt
  R.FONT = FONT;
  R.ACCENT = ACCENT;

  const ctx = document.createElement('canvas').getContext('2d');
  const tw = (t, size = 14, weight = 500) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(String(t ?? '')).width;
  };
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const n1 = (v) => Math.round(v * 10) / 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  R.esc = esc;
  R.tw = tw;

  const isChen = (notation) => (R.NOTATIONS[notation] || R.NOTATIONS.chen).family === 'chen';
  R.isChen = isChen;

  // ---------- Geometrie ----------
  const umlAttr = (a) => `${a.name || '—'}${a.type ? ' : ' + a.type : ''}${a.pk ? ' {PK}' : ''}`;

  function entityGeom(e, notation) {
    if (isChen(notation)) {
      const w = Math.max(130, Math.ceil((tw(e.name, 15, 700) + 48) / 10) * 10);
      const h = 56;
      return { x: e.x, y: e.y, w, h, cx: e.x + w / 2, cy: e.y + h / 2 };
    }
    const uml = notation === 'uml';
    const headH = 42;
    const rowH = 27;
    const pad = 14;
    const attrs = e.attributes || [];
    const hasPk = attrs.some((a) => a.pk);
    let w = tw(e.name, 15, 700) + pad * 2 + 20;
    for (const a of attrs) {
      const aw = uml
        ? tw(umlAttr(a), 13, a.pk ? 700 : 500) + pad * 2
        : (hasPk ? 34 : 0) + tw(a.name || '—', 13, a.pk ? 700 : 500) + (a.type ? tw(a.type, 11.5, 500) + 24 : 0) + pad * 2;
      w = Math.max(w, aw);
    }
    w = Math.max(180, Math.ceil(w / 10) * 10);
    const h = headH + Math.max(1, attrs.length) * rowH + 10;
    return { x: e.x, y: e.y, w, h, cx: e.x + w / 2, cy: e.y + h / 2, headH, rowH, pad, hasPk };
  }

  function chenAttrGeoms(e, g, ring = { x: 100, y: 62 }) {
    const attrs = e.attributes || [];
    const n = attrs.length;
    const rx = g.w / 2 + ring.x;
    const ry = g.h / 2 + ring.y;
    const step = n <= 1 ? 0 : Math.min(40, 320 / n);
    return attrs.map((a, i) => {
      const w = Math.max(84, Math.ceil(tw(a.name || '—', 13, a.pk ? 700 : 500) + 38));
      const h = 38;
      let cx;
      let cy;
      if (typeof a.dx === 'number' && typeof a.dy === 'number') {
        cx = g.cx + a.dx;
        cy = g.cy + a.dy;
      } else {
        const ang = ((-90 + (i - (n - 1) / 2) * step) * Math.PI) / 180;
        cx = g.cx + rx * Math.cos(ang);
        cy = g.cy + ry * Math.sin(ang);
      }
      return { a, cx, cy, w, h };
    });
  }
  R.chenAttrGeoms = chenAttrGeoms;

  function clipRect(g, tx, ty, ox, oy) {
    const cx = ox ?? g.cx;
    const cy = oy ?? g.cy;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx ? (dx > 0 ? (g.x + g.w - cx) / dx : (g.x - cx) / dx) : Infinity;
    const sy = dy ? (dy > 0 ? (g.y + g.h - cy) / dy : (g.y - cy) / dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  function clipDiamond(d, tx, ty) {
    const dx = tx - d.cx;
    const dy = ty - d.cy;
    const k = Math.abs(dx) / (d.w / 2) + Math.abs(dy) / (d.h / 2);
    if (!k) return { x: d.cx, y: d.cy };
    return { x: d.cx + dx / k, y: d.cy + dy / k };
  }
  function clipEllipse(c, tx, ty) {
    const dx = tx - c.cx;
    const dy = ty - c.cy;
    const k = Math.sqrt((dx * dx) / (c.w / 2) ** 2 + (dy * dy) / (c.h / 2) ** 2);
    if (!k) return { x: c.cx, y: c.cy };
    return { x: c.cx + dx / k, y: c.cy + dy / k };
  }
  const unit = (dx, dy) => {
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  const perpUp = (u) => {
    let n = { x: -u.y, y: u.x };
    if (n.y > 0.01 || (Math.abs(n.y) <= 0.01 && n.x < 0)) n = { x: -n.x, y: -n.y };
    return n;
  };

  function diamondSize(rel) {
    return { w: Math.max(124, Math.ceil(tw(rel.name, 13, 600) * 1.6 + 46)), h: 72 };
  }

  const pairKey = (r) => (r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`);

  // ---------- Leitungsführung für die Kasten-Notationen (Crow's Foot, UML) ----------
  // Linien verlassen die Kästen immer rechtwinklig: gerade, wenn sich die Kästen gegenüberstehen,
  // sonst mit einem Knick (L) oder einem Versatz (Z). Mehrere Linien an einer Seite teilen sich den Platz.
  const horiz = (side) => side === 'r' || side === 'l';
  const sidePoint = (g, side, c) =>
    side === 'r' ? { x: g.x + g.w, y: c } : side === 'l' ? { x: g.x, y: c } : side === 'b' ? { x: c, y: g.y + g.h } : { x: c, y: g.y };
  const sideRange = (g, side) => (horiz(side) ? [g.y + 14, g.y + g.h - 14] : [g.x + 14, g.x + g.w - 14]);
  const segHits = (p, q, g, m = 8) =>
    Math.max(p.x, q.x) > g.x - m && Math.min(p.x, q.x) < g.x + g.w + m && Math.max(p.y, q.y) > g.y - m && Math.min(p.y, q.y) < g.y + g.h + m;

  function planRoute(r, A, B, idx, cnt, geoms) {
    const MIN = 28;
    const gapX = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
    const gapY = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
    const ovY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    const ovX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const hs = B.cx >= A.cx ? ['r', 'l'] : ['l', 'r'];
    const vs = B.cy >= A.cy ? ['b', 't'] : ['t', 'b'];
    const off = (idx - (cnt - 1) / 2) * 26;
    if (gapX >= MIN && ovY >= 26) {
      const lo = Math.max(A.y, B.y) + 12;
      const hi = Math.min(A.y + A.h, B.y + B.h) - 12;
      return { kind: 'straight', a: { side: hs[0] }, b: { side: hs[1] }, lo, hi, c: clamp((lo + hi) / 2 + off, lo, hi), off };
    }
    if (gapY >= MIN && ovX >= 26) {
      const lo = Math.max(A.x, B.x) + 12;
      const hi = Math.min(A.x + A.w, B.x + B.w) - 12;
      return { kind: 'straight', a: { side: vs[0] }, b: { side: vs[1] }, lo, hi, c: clamp((lo + hi) / 2 + off, lo, hi), off };
    }
    if (gapX >= MIN && gapY >= MIN) {
      // zwei mögliche Ecken – die nehmen, die weniger andere Entitäten kreuzt
      const opts = [
        { kind: 'L', a: { side: hs[0], c: A.cy }, b: { side: vs[1], c: B.cx } },
        { kind: 'L', a: { side: vs[0], c: A.cx }, b: { side: hs[1], c: B.cy } },
      ];
      const cost = (o) => {
        const pa = sidePoint(A, o.a.side, o.a.c);
        const pb = sidePoint(B, o.b.side, o.b.c);
        const corner = horiz(o.a.side) ? { x: pb.x, y: pa.y } : { x: pa.x, y: pb.y };
        let n = 0;
        for (const [id, g] of geoms) if (id !== r.from && id !== r.to && (segHits(pa, corner, g) || segHits(corner, pb, g))) n++;
        return n;
      };
      if (cost(opts[1]) < cost(opts[0])) opts.reverse();
      return opts[idx % 2];
    }
    if (gapX >= MIN) return { kind: 'Z', a: { side: hs[0], c: A.cy }, b: { side: hs[1], c: B.cy } };
    if (gapY >= MIN) return { kind: 'Z', a: { side: vs[0], c: A.cx }, b: { side: vs[1], c: B.cx } };
    return null; // Kästen überlappen sich: schräge Linie von Mitte zu Mitte
  }

  function routeBoxes(project, geoms, gens, pairIdx, pairCount) {
    const taken = new Map(); // "Entität|Seite" → belegte Positionen
    const tk = (id, side) => {
      const k = `${id}|${side}`;
      if (!taken.has(k)) taken.set(k, []);
      return taken.get(k);
    };
    const pick = (c0, lo, hi, lists, prefer) => {
      if (lo > hi) return c0;
      c0 = clamp(c0, lo, hi);
      const ok = (c) => c >= lo && c <= hi && lists.every((l) => l.every((t) => Math.abs(t - c) >= 18));
      for (let k = 0; k <= 8; k++)
        for (const s of k ? [prefer, -prefer] : [1]) {
          const c = c0 + s * k * 22;
          if (ok(c)) return c;
        }
      return c0;
    };

    for (const G of gens)
      if (G.tree) {
        tk(G.gen.parent, G.tree.dir > 0 ? 'b' : 't').push(G.tree.stemX);
        G.kidIds.forEach((id, i) => tk(id, G.tree.dir > 0 ? 't' : 'b').push(G.tree.kidPts[i].x));
      }

    const routes = new Map();
    const plans = [];
    for (const r of project.relationships) {
      const A = geoms.get(r.from);
      const B = geoms.get(r.to);
      if (!A || !B) continue;
      const idx = pairIdx.get(r.id);
      if (r.from === r.to) {
        const o = idx * 22;
        const sx = A.x + A.w - 36 - o;
        const top = A.y - 42 - o;
        const right = A.x + A.w + 44 + o;
        const ey = A.y + 32 + o;
        tk(r.from, 't').push(sx);
        tk(r.from, 'r').push(ey);
        routes.set(r.id, [
          { x: sx, y: A.y },
          { x: sx, y: top },
          { x: right, y: top },
          { x: right, y: ey },
          { x: A.x + A.w, y: ey },
        ]);
        continue;
      }
      const cnt = pairCount.get(pairKey(r));
      const pl = planRoute(r, A, B, idx, cnt, geoms);
      if (pl) plans.push({ r, A, B, pl });
      else {
        const u = unit(B.cx - A.cx, B.cy - A.cy);
        const nn = r.from < r.to ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
        const off = (idx - (cnt - 1) / 2) * 30;
        const [ax, ay, bx, by] = [A.cx + nn.x * off, A.cy + nn.y * off, B.cx + nn.x * off, B.cy + nn.y * off];
        routes.set(r.id, [clipRect(A, bx, by, ax, ay), clipRect(B, ax, ay, bx, by)]);
      }
    }
    // gerade Verbindungen zuerst: ihre Position ist durch die Überlappung vorgegeben
    for (const { r, A, B, pl } of plans) {
      if (pl.kind !== 'straight') continue;
      const la = tk(r.from, pl.a.side);
      const lb = tk(r.to, pl.b.side);
      const c = pick(pl.c, pl.lo, pl.hi, [la, lb], pl.off < 0 ? -1 : 1);
      la.push(c);
      lb.push(c);
      routes.set(r.id, [sidePoint(A, pl.a.side, c), sidePoint(B, pl.b.side, c)]);
    }
    for (const { r, A, B, pl } of plans) {
      if (pl.kind === 'straight') continue;
      const place = (id, g, end, want) => {
        const [lo, hi] = sideRange(g, end.side);
        const l = tk(id, end.side);
        const c = pick(end.c, lo, hi, [l], want < end.c ? -1 : 1);
        l.push(c);
        return sidePoint(g, end.side, c);
      };
      const pa = place(r.from, A, pl.a, horiz(pl.a.side) ? B.cy : B.cx);
      const pb = place(r.to, B, pl.b, horiz(pl.b.side) ? A.cy : A.cx);
      let pts;
      if (pl.kind === 'L') pts = [pa, horiz(pl.a.side) ? { x: pb.x, y: pa.y } : { x: pa.x, y: pb.y }, pb];
      else if (horiz(pl.a.side)) {
        const mx = (pa.x + pb.x) / 2;
        pts = Math.abs(pa.y - pb.y) < 0.5 ? [pa, pb] : [pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb];
      } else {
        const my = (pa.y + pb.y) / 2;
        pts = Math.abs(pa.x - pb.x) < 0.5 ? [pa, pb] : [pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb];
      }
      routes.set(r.id, pts);
    }
    return routes;
  }

  /** Berechnet alle Positionen des Diagramms. */
  R.layout = function (project) {
    const notation = project.notation;
    const chen = isChen(notation);
    const geoms = new Map();
    const attrGeoms = new Map();
    const byId = new Map(project.entities.map((e) => [e.id, e]));
    for (const e of project.entities) {
      const g = entityGeom(e, notation);
      geoms.set(e.id, g);
      if (chen) attrGeoms.set(e.id, chenAttrGeoms(e, g));
    }

    // Parallele Beziehungen zwischen demselben Paar auffächern
    const pairCount = new Map();
    const pairIdx = new Map();
    for (const r of project.relationships) {
      const k = pairKey(r);
      pairIdx.set(r.id, pairCount.get(k) || 0);
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }

    // Generalisierungen: Verteilerpunkt (hub) zwischen Obertyp und Untertypen
    const gens = [];
    for (const gen of project.generalizations || []) {
      const P = geoms.get(gen.parent);
      const kidIds = (gen.children || []).filter((id) => id !== gen.parent && geoms.has(id));
      const kids = kidIds.map((id) => geoms.get(id));
      if (!P || !kids.length) continue;
      let hub;
      if (typeof gen.x === 'number' && typeof gen.y === 'number') hub = { x: gen.x, y: gen.y };
      else {
        const mx = kids.reduce((s, g) => s + g.cx, 0) / kids.length;
        // bei Chen die Attribut-Ellipsen mitzählen, damit das Dreieck nicht darin landet
        const ext = (id, g) => {
          const ags = attrGeoms.get(id) || [];
          return {
            top: Math.min(g.y, ...ags.map((a) => a.cy - a.h / 2)),
            bottom: Math.max(g.y + g.h, ...ags.map((a) => a.cy + a.h / 2)),
          };
        };
        const pExt = ext(gen.parent, P);
        const top = Math.min(...kidIds.map((id) => ext(id, geoms.get(id)).top));
        const bottom = Math.max(...kidIds.map((id) => ext(id, geoms.get(id)).bottom));
        if (top > P.y + P.h + 40) hub = { x: P.cx, y: (P.y + P.h + top) / 2 };
        else if (bottom < pExt.top - 40) hub = { x: P.cx, y: (pExt.top + bottom) / 2 };
        else {
          const my = kids.reduce((s, g) => s + g.cy, 0) / kids.length;
          const edge = clipRect(P, mx, my);
          hub = { x: edge.x + (mx - edge.x) * 0.45, y: edge.y + (my - edge.y) * 0.45 };
        }
      }
      // Kasten-Notationen: liegen alle Untertypen unter (oder über) dem Obertyp, wird daraus ein rechtwinkliger Baum
      let tree = null;
      let label = '';
      if (!chen) {
        const below = hub.y >= P.y + P.h + 22 && kids.every((k) => k.y >= hub.y + 14);
        const above = hub.y <= P.y - 22 && kids.every((k) => k.y + k.h <= hub.y - 14);
        if (below || above) {
          const stemX = clamp(hub.x, P.x + 16, P.x + P.w - 16);
          hub = { x: stemX, y: hub.y };
          tree = { dir: below ? 1 : -1, stemX, tip: { x: stemX, y: below ? P.y + P.h : P.y }, kidPts: kids.map((k) => ({ x: k.cx, y: below ? k.y : k.y + k.h })) };
        }
        label = `{${gen.disjoint === false ? 'überlappend' : 'disjunkt'}, ${gen.total ? 'total' : 'partiell'}}`;
      }
      const pEnd = clipRect(P, hub.x, hub.y);
      gens.push({ gen, P, kids, kidIds, hub, pEnd, kidEnds: kids.map((g) => clipRect(g, hub.x, hub.y)), tree, label });
    }

    // Chen: eine rekursive Beziehung kommt an die Seite, an der nichts anderes hängt
    const DIRS = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
    const selfDir = (id, A) => {
      const blocked = { r: false, l: false, b: false, t: (attrGeoms.get(id) || []).length > 0 };
      const mark = (other) => {
        const B = geoms.get(other);
        if (!B || other === id) return;
        const dx = B.cx - A.cx;
        const dy = B.cy - A.cy;
        if (Math.abs(dx) >= Math.abs(dy)) blocked[dx > 0 ? 'r' : 'l'] = true;
        else blocked[dy > 0 ? 'b' : 't'] = true;
      };
      for (const r of project.relationships) {
        if (r.from === id) mark(r.to);
        if (r.to === id) mark(r.from);
      }
      for (const g of project.generalizations || []) {
        if (g.parent === id) (g.children || []).forEach(mark);
        else if ((g.children || []).includes(id)) mark(g.parent);
      }
      return ['r', 'l', 'b', 't'].find((d) => !blocked[d]) || 'r';
    };

    const routes = chen ? null : routeBoxes(project, geoms, gens, pairIdx, pairCount);

    const rels = [];
    for (const r of project.relationships) {
      const A = geoms.get(r.from);
      const B = geoms.get(r.to);
      if (!A || !B) continue;
      const cnt = pairCount.get(pairKey(r));
      const idx = pairIdx.get(r.id);
      const self = r.from === r.to;

      if (chen) {
        const size = diamondSize(r);
        let cx;
        let cy;
        if (typeof r.x === 'number' && typeof r.y === 'number') {
          cx = r.x;
          cy = r.y;
        } else if (self) {
          const [ux, uy] = DIRS[selfDir(r.from, A)];
          const dist = ux ? A.w / 2 + 90 + size.w / 2 : A.h / 2 + 70 + size.h / 2;
          cx = A.cx + ux * dist + Math.abs(uy) * idx * (size.w + 30);
          cy = A.cy + uy * dist + Math.abs(ux) * idx * 100;
        } else {
          const u = unit(B.cx - A.cx, B.cy - A.cy);
          const nn = r.from < r.to ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
          const off = (idx - (cnt - 1) / 2) * 110;
          cx = (A.cx + B.cx) / 2 + nn.x * off;
          cy = (A.cy + B.cy) / 2 + nn.y * off;
        }
        const d = { cx, cy, w: size.w, h: size.h };
        const mk = (G, own, other, isFrom, shift) => {
          const u0 = unit(d.cx - G.cx, d.cy - G.cy);
          const nn = { x: -u0.y, y: u0.x };
          const ox = G.cx + nn.x * shift;
          const oy = G.cy + nn.y * shift;
          const p = clipRect(G, d.cx + nn.x * shift, d.cy + nn.y * shift, ox, oy);
          const q0 = clipDiamond(d, ox, oy);
          const q = { x: q0.x + nn.x * shift * 0.5, y: q0.y + nn.y * shift * 0.5 };
          // Doppellinie = totale Teilnahme; in (min,max) steckt das schon im Intervall
          return { p, q, u: unit(q.x - p.x, q.y - p.y), own, other, isFrom, total: notation === 'chen' && other.min === 1 };
        };
        const ends = [mk(A, r.cardFrom, r.cardTo, true, self ? -16 : 0), mk(B, r.cardTo, r.cardFrom, false, self ? 16 : 0)];
        rels.push({ rel: r, kind: 'chen', d, ends, identifying: R.isIdentifying(r, byId.get(r.from), byId.get(r.to)) });
        if ((r.attributes || []).length) attrGeoms.set(r.id, chenAttrGeoms(r, d, { x: 40, y: 46 }));
      } else {
        const pts = routes.get(r.id);
        const last = pts.length - 1;
        const ends = [
          { p: pts[0], u: unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y), own: r.cardFrom, other: r.cardTo, isFrom: true },
          { p: pts[last], u: unit(pts[last - 1].x - pts[last].x, pts[last - 1].y - pts[last].y), own: r.cardTo, other: r.cardFrom, isFrom: false },
        ];
        // Beschriftung auf dem längsten Teilstück
        let mid;
        let mu;
        if (self) {
          mid = { x: (pts[1].x + pts[2].x) / 2, y: pts[1].y - 12 };
          mu = { x: 1, y: 0 };
        } else {
          let best = 0;
          let len = -1;
          for (let i = 0; i < last; i++) {
            const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
            if (l > len + 0.5) [best, len] = [i, l];
          }
          mid = { x: (pts[best].x + pts[best + 1].x) / 2, y: (pts[best].y + pts[best + 1].y) / 2 };
          mu = unit(pts[best + 1].x - pts[best].x, pts[best + 1].y - pts[best].y);
        }
        // Attribute der Beziehung: eigener Kasten, gestrichelt an der Linie (wie UML-Assoziationsklasse)
        let abox = null;
        if ((r.attributes || []).length) {
          const fake = { name: r.name || 'Attribute', x: 0, y: 0, attributes: r.attributes };
          const g0 = entityGeom(fake, notation);
          const dir = self ? { x: 0, y: -1 } : perpUp(mu);
          const dist = 46 + (Math.abs(dir.y) * g0.h) / 2 + (Math.abs(dir.x) * g0.w) / 2;
          const cx = mid.x + dir.x * dist + (r.bdx || 0);
          const cy = mid.y + dir.y * dist + (r.bdy || 0);
          abox = entityGeom({ ...fake, x: Math.round(cx - g0.w / 2), y: Math.round(cy - g0.h / 2) }, notation);
        }
        rels.push({ rel: r, kind: 'box', pts, ends, mid, mu, self, abox });
      }
    }

    // Bounding Box
    const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const grow = (x1, y1, x2, y2) => {
      bb.minX = Math.min(bb.minX, x1);
      bb.minY = Math.min(bb.minY, y1);
      bb.maxX = Math.max(bb.maxX, x2);
      bb.maxY = Math.max(bb.maxY, y2);
    };
    for (const g of geoms.values()) grow(g.x, g.y, g.x + g.w, g.y + g.h);
    for (const list of attrGeoms.values()) for (const a of list) grow(a.cx - a.w / 2, a.cy - a.h / 2, a.cx + a.w / 2, a.cy + a.h / 2);
    for (const r of rels) {
      if (r.kind === 'chen') grow(r.d.cx - r.d.w / 2, r.d.cy - r.d.h / 2, r.d.cx + r.d.w / 2, r.d.cy + r.d.h / 2);
      else {
        for (const p of r.pts) grow(p.x - 20, p.y - 20, p.x + 20, p.y + 20);
        if (r.rel.name) {
          const hw = tw(r.rel.name, 12.5, 600) / 2 + 16;
          grow(r.mid.x - hw, r.mid.y - 16, r.mid.x + hw, r.mid.y + 16);
        }
      }
      for (const e of r.ends) grow(e.p.x - 40, e.p.y - 26, e.p.x + 40, e.p.y + 26);
      if (r.abox) grow(r.abox.x, r.abox.y, r.abox.x + r.abox.w, r.abox.y + r.abox.h);
    }
    for (const g of gens) {
      grow(g.hub.x - 60, g.hub.y - 40, g.hub.x + 60, g.hub.y + 40);
      if (g.label) grow(g.hub.x, g.hub.y - 24, g.hub.x + 22 + tw(g.label, 11.5, 600), g.hub.y);
    }
    const bbox = Number.isFinite(bb.minX) ? bb : null;
    return { notation, chen, geoms, attrGeoms, rels, gens, bbox };
  };

  // ---------- SVG-Bausteine ----------
  const text = (x, y, s, { size = 13, weight = 500, fill = T.ink, anchor = 'middle', halo = false, cls = '', italic = false } = {}) => {
    // Halo als weißer Hintergrund (statt Text-Kontur, die im PDF doppelten Text erzeugt)
    let bg = '';
    if (halo) {
      const w = tw(s, size, weight) + 8;
      const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + 4 : x - 4;
      bg = `<rect x="${n1(bx)}" y="${n1(y - size / 2 - 3)}" width="${n1(w)}" height="${n1(size + 6)}" rx="4" fill="${PAPER}"/>`;
    }
    return `${bg}<text x="${n1(x)}" y="${n1(y)}" dy="0.35em" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${
      italic ? ' font-style="italic"' : ''
    }${cls ? ` class="${cls}"` : ''}>${esc(s)}</text>`;
  };

  const line = (a, b, { stroke = T.line, width = 1.6, extra = '' } = {}) =>
    `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;

  /** Linienzug mit abgerundeten Ecken. */
  function pathD(pts, r = 8) {
    let d = `M${n1(pts[0].x)},${n1(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const a = pts[i - 1];
      const b = pts[i + 1];
      const la = Math.hypot(p.x - a.x, p.y - a.y);
      const lb = Math.hypot(b.x - p.x, b.y - p.y);
      const rr = Math.min(r, la / 2, lb / 2);
      if (rr < 1) {
        d += ` L${n1(p.x)},${n1(p.y)}`;
        continue;
      }
      d += ` L${n1(p.x + ((a.x - p.x) / la) * rr)},${n1(p.y + ((a.y - p.y) / la) * rr)} Q${n1(p.x)},${n1(p.y)} ${n1(p.x + ((b.x - p.x) / lb) * rr)},${n1(
        p.y + ((b.y - p.y) / lb) * rr
      )}`;
    }
    const e = pts[pts.length - 1];
    return `${d} L${n1(e.x)},${n1(e.y)}`;
  }

  /** Position einer Beschriftung neben einem Linienende: `dist` entlang der Linie, seitlich so weit, dass der Text die Linie nicht berührt. */
  function besideEnd(e, dist, label, size) {
    const n = perpUp(e.u);
    const off = 7 + (Math.abs(n.x) * tw(label, size, 700)) / 2 + (Math.abs(n.y) * size) / 2;
    return { x: e.p.x + e.u.x * dist + n.x * off, y: e.p.y + e.u.y * dist + n.y * off };
  }

  // Krähenfuß-Symbole: innen (an der Entität) das Maximum, außen das Minimum
  function crowEnd(p, u, card, stroke) {
    const n = { x: -u.y, y: u.x };
    const at = (d, s) => ({ x: p.x + u.x * d + n.x * s, y: p.y + u.y * d + n.y * s });
    const many = card.max === 'N';
    let s = '';
    if (many) {
      const q = at(14, 0);
      s += line(q, at(0, -8), { stroke }) + line(q, at(0, 8), { stroke });
    } else {
      s += line(at(8, -7), at(8, 7), { stroke });
    }
    if (card.min === 1) {
      const d = many ? 20 : 14;
      s += line(at(d, -7), at(d, 7), { stroke });
    } else {
      const c = at(many ? 25 : 19, 0);
      s += `<circle cx="${n1(c.x)}" cy="${n1(c.y)}" r="5" fill="${PAPER}" stroke="${stroke}" stroke-width="1.6"/>`;
    }
    return s;
  }

  const diamondD = (d, inset = 0) => {
    // Raute, um `inset` Pixel parallel nach innen versetzt
    const a = d.w / 2;
    const b = d.h / 2;
    const hyp = Math.hypot(a, b);
    const a2 = a - (inset * hyp) / b;
    const b2 = b - (inset * hyp) / a;
    return `M${n1(d.cx)},${n1(d.cy - b2)} L${n1(d.cx + a2)},${n1(d.cy)} L${n1(d.cx)},${n1(d.cy + b2)} L${n1(d.cx - a2)},${n1(d.cy)} Z`;
  };

  /** Bezeichnung einer Beziehung auf der Linie; in UML zeigt ein kleines Dreieck die Leserichtung. */
  function nameLabel(r, notation, fill) {
    const size = 12.5;
    const weight = 600;
    const name = r.rel.name;
    if (notation !== 'uml' || r.self) return text(r.mid.x, r.mid.y, name, { size, weight, fill, halo: true });
    const w = tw(name, size, weight);
    const d = r.mu;
    const hz = Math.abs(d.x) >= Math.abs(d.y);
    const left = hz && d.x < 0;
    const full = w + 13;
    const x0 = r.mid.x - full / 2;
    const y = r.mid.y;
    const ax = left ? x0 + 4 : x0 + w + 9;
    const a = 4;
    const tri = hz
      ? d.x < 0
        ? `M${n1(ax - a)},${n1(y)} L${n1(ax + a)},${n1(y - a)} L${n1(ax + a)},${n1(y + a)} Z`
        : `M${n1(ax + a)},${n1(y)} L${n1(ax - a)},${n1(y - a)} L${n1(ax - a)},${n1(y + a)} Z`
      : d.y < 0
        ? `M${n1(ax)},${n1(y - a)} L${n1(ax - a)},${n1(y + a)} L${n1(ax + a)},${n1(y + a)} Z`
        : `M${n1(ax)},${n1(y + a)} L${n1(ax - a)},${n1(y - a)} L${n1(ax + a)},${n1(y - a)} Z`;
    return (
      `<rect x="${n1(x0 - 4)}" y="${n1(y - size / 2 - 3)}" width="${n1(full + 8)}" height="${n1(size + 6)}" rx="4" fill="${PAPER}"/>` +
      text(left ? x0 + 13 + w / 2 : x0 + w / 2, y, name, { size, weight, fill }) +
      `<path d="${tri}" fill="${fill}"/>`
    );
  }

  /**
   * Rendert den SVG-Inhalt (ohne <svg>-Wurzel).
   * opt: { sel: {kind,id,attr}, hover: entityId, pending: {from,x,y}, interactive: Platzhalter-Hinweise zeigen }
   */
  R.renderDiagram = function (project, opt = {}) {
    T = R.themeOf(project);
    const L = R.layout(project);
    const { notation, chen, geoms, attrGeoms, rels } = L;
    const sel = opt.sel || null;
    const isSelEntity = (id) => sel && (sel.kind === 'entity' || sel.kind === 'attr') && sel.id === id;
    const isSelAttr = (id, aid) => sel && sel.kind === 'attr' && sel.id === id && sel.attr === aid;
    const isSelRel = (id) => sel && (sel.kind === 'rel' || sel.kind === 'attr') && sel.id === id;
    const boxR = notation === 'crow' ? 12 : 2;

    const relLines = [];
    const attrLines = [];
    const nodes = [];
    const attrNodes = [];
    const diamonds = [];
    const labels = [];
    const overlay = [];

    // Beziehungen
    for (const r of rels) {
      const selected = isSelRel(r.rel.id);
      const stroke = selected ? ACCENT : T.line;
      const id = esc(r.rel.id);
      if (r.kind === 'chen') {
        let ls = '';
        for (const e of r.ends) {
          if (e.total) ls += line(e.p, e.q, { stroke, width: 6.4 }) + line(e.p, e.q, { stroke: PAPER, width: 2.2 });
          else ls += line(e.p, e.q, { stroke, width: 1.8 });
          ls += line(e.p, e.q, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
          const lab = R.endLabel(notation, e.own, e.other, e.isFrom);
          const size = notation === 'minmax' ? 12.5 : 14;
          const at = besideEnd(e, notation === 'minmax' ? 34 : 20, lab, size);
          labels.push(text(at.x, at.y, lab, { size, weight: 700, fill: selected ? ACCENT : T.ink, halo: true }));
        }
        relLines.push(`<g data-kind="rel" data-id="${id}">${ls}</g>`);
        const d = r.d;
        for (const ag of attrGeoms.get(r.rel.id) || []) {
          attrLines.push(line(clipDiamond(d, ag.cx, ag.cy), clipEllipse(ag, d.cx, d.cy), { width: 1.4 }));
          attrNodes.push(chenAttrNode(r.rel.id, ag, isSelAttr(r.rel.id, ag.a.id), false));
        }
        const dStroke = selected ? ACCENT : T.relStroke;
        diamonds.push(
          `<g data-kind="rel" data-id="${id}" class="node">` +
            `<path class="body" d="${diamondD(d)}" fill="${T.relFill}" stroke="${dStroke}" stroke-width="2" stroke-linejoin="round"/>` +
            // identifizierende Beziehung einer schwachen Entität: doppelte Raute
            (r.identifying ? `<path d="${diamondD(d, 5)}" fill="none" stroke="${dStroke}" stroke-width="1.5" stroke-linejoin="round"/>` : '') +
            text(d.cx, d.cy, r.rel.name || ' ', { size: 13, weight: 600 }) +
            `</g>`
        );
      } else {
        const dd = pathD(r.pts);
        let ls = `<path d="${dd}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
        ls += `<path class="hit" d="${dd}" fill="none" stroke="transparent" stroke-width="14"/>`;
        for (const e of r.ends) {
          if (notation === 'crow') ls += crowEnd(e.p, e.u, e.own, stroke);
          else {
            const lab = R.endLabel(notation, e.own, e.other, e.isFrom);
            const at = besideEnd(e, 18, lab, 12.5);
            labels.push(text(at.x, at.y, lab, { size: 12.5, weight: 700, fill: selected ? ACCENT : T.ink, halo: true }));
          }
        }
        relLines.push(`<g data-kind="rel" data-id="${id}">${ls}</g>`);
        if (r.abox) {
          const g = r.abox;
          const fake = { id: r.rel.id, attributes: r.rel.attributes };
          const p = clipRect(g, r.mid.x, r.mid.y);
          relLines.push(line(r.mid, p, { stroke, width: 1.4, extra: 'stroke-dasharray="5 4"' }));
          let s = `<g data-kind="rbox" data-id="${id}" class="node">`;
          s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${boxR}" fill="${T.entFill}"/>`;
          s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.headH}" rx="${boxR}" fill="${T.soft}"/>`;
          s += `<rect x="${n1(g.x)}" y="${n1(g.y + g.headH - 12)}" width="${g.w}" height="12" fill="${T.soft}"/>`;
          s += line({ x: g.x, y: g.y + g.headH }, { x: g.x + g.w, y: g.y + g.headH }, { width: 1.2, stroke: T.entStroke });
          s += text(g.cx, g.y + g.headH / 2, r.rel.name || 'Attribute', { size: 14, weight: 700, fill: T.sub, italic: !r.rel.name });
          s += '</g>';
          s += boxRows(fake, g, notation, isSelAttr, false);
          s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${boxR}" fill="none" stroke="${selected ? ACCENT : T.entStroke}" stroke-width="1.4" pointer-events="none"/>`;
          diamonds.push(s);
        }
        if (r.rel.name && !r.abox) labels.push(`<g data-kind="rel" data-id="${id}">${nameLabel(r, notation, selected ? ACCENT : T.sub)}</g>`);
      }
    }

    // Generalisierungen
    for (const G of L.gens) {
      const selected = sel && sel.kind === 'gen' && sel.id === G.gen.id;
      const stroke = selected ? ACCENT : T.line;
      const { hub, pEnd } = G;
      const id = esc(G.gen.id);
      const u = unit(pEnd.x - hub.x, pEnd.y - hub.y); // Richtung zum Obertyp
      const n = { x: -u.y, y: u.x };
      let ls = '';
      let hit = '';
      const seg = (a, b, width = 1.6) => {
        ls += line(a, b, { stroke, width });
        hit += line(a, b, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
      };
      if (chen) {
        const TW = 74;
        const TH = 54;
        const apex = { x: hub.x + u.x * (TH / 2), y: hub.y + u.y * (TH / 2) };
        const base = { x: hub.x - u.x * (TH / 2), y: hub.y - u.y * (TH / 2) };
        if (G.gen.total) {
          ls += line(apex, pEnd, { stroke, width: 6.4 }) + line(apex, pEnd, { stroke: PAPER, width: 2.2 });
          hit += line(apex, pEnd, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        } else seg(apex, pEnd, 1.8);
        G.kidEnds.forEach((k) => seg(base, k, 1.8));
        relLines.push(`<g data-kind="gen" data-id="${id}">${ls}${hit}</g>`);
        const b1 = { x: base.x + n.x * (TW / 2), y: base.y + n.y * (TW / 2) };
        const b2 = { x: base.x - n.x * (TW / 2), y: base.y - n.y * (TW / 2) };
        const lp = perpUp(u);
        const tStroke = selected ? ACCENT : T.relStroke;
        diamonds.push(
          `<g data-kind="gen" data-id="${id}" class="node">` +
            `<path class="body" d="M${n1(apex.x)},${n1(apex.y)} L${n1(b1.x)},${n1(b1.y)} L${n1(b2.x)},${n1(b2.y)} Z" fill="${T.relFill}" stroke="${tStroke}" stroke-width="2" stroke-linejoin="round"/>` +
            text(hub.x - u.x * 6, hub.y - u.y * 6, 'IS-A', { size: 11.5, weight: 800 }) +
            text(hub.x + lp.x * (TW / 2 + 6), hub.y + lp.y * (TW / 2 + 6), G.gen.disjoint === false ? 'o' : 'd', { size: 14, weight: 700, fill: selected ? ACCENT : T.ink, halo: true }) +
            `</g>`
        );
      } else {
        // UML-Stil: hohles Dreieck am Obertyp, Untertypen hängen an einer gemeinsamen Linie
        const AH = 16;
        let tip;
        let back;
        let tn;
        if (G.tree) {
          const { dir, stemX, kidPts } = G.tree;
          tip = G.tree.tip;
          back = { x: stemX, y: tip.y + dir * AH };
          tn = { x: 1, y: 0 };
          const xs = [stemX, ...kidPts.map((k) => k.x)];
          seg(back, { x: stemX, y: hub.y });
          seg({ x: Math.min(...xs), y: hub.y }, { x: Math.max(...xs), y: hub.y });
          kidPts.forEach((k) => seg({ x: k.x, y: hub.y }, k));
        } else {
          tip = pEnd;
          back = { x: tip.x - u.x * AH, y: tip.y - u.y * AH };
          tn = n;
          G.kidEnds.forEach((k) => seg(k, hub));
          seg(hub, back);
        }
        ls += `<path d="M${n1(tip.x)},${n1(tip.y)} L${n1(back.x + tn.x * 9)},${n1(back.y + tn.y * 9)} L${n1(back.x - tn.x * 9)},${n1(back.y - tn.y * 9)} Z" fill="${PAPER}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`;
        hit += line(back, tip, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        relLines.push(`<g data-kind="gen" data-id="${id}">${ls}${hit}</g>`);
        diamonds.push(
          `<g data-kind="gen" data-id="${id}" class="node">` +
            `<circle class="body" cx="${n1(hub.x)}" cy="${n1(hub.y)}" r="${selected ? 5 : 4}" fill="${stroke}"/>` +
            `<circle cx="${n1(hub.x)}" cy="${n1(hub.y)}" r="12" fill="transparent"/>` +
            text(hub.x + 14, hub.y - 13, G.label, { size: 11.5, weight: 600, fill: selected ? ACCENT : T.muted, anchor: 'start', halo: true }) +
            `</g>`
        );
      }
    }

    // Entitäten
    for (const e of project.entities) {
      const g = geoms.get(e.id);
      const selected = isSelEntity(e.id);
      const hover = opt.hover === e.id;
      let s = `<g data-kind="entity" data-id="${esc(e.id)}" class="node">`;
      if (chen) {
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="3" fill="${T.entFill}" stroke="${T.entStroke}" stroke-width="2"/>`;
        if (e.weak)
          s += `<rect x="${n1(g.x + 5)}" y="${n1(g.y + 5)}" width="${g.w - 10}" height="${g.h - 10}" rx="2" fill="none" stroke="${T.entStroke}" stroke-width="1.5"/>`;
        s += text(g.cx, g.cy, e.name || ' ', { size: 15, weight: 700 });
      } else if (notation === 'crow') {
        const r = boxR;
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${r}" fill="${T.entFill}"/>`;
        s += `<path d="M${n1(g.x)},${n1(g.y + g.headH)} V${n1(g.y + r)} Q${n1(g.x)},${n1(g.y)} ${n1(g.x + r)},${n1(g.y)} H${n1(
          g.x + g.w - r
        )} Q${n1(g.x + g.w)},${n1(g.y)} ${n1(g.x + g.w)},${n1(g.y + r)} V${n1(g.y + g.headH)} Z" fill="${T.head}"/>`;
        s += text(g.cx, g.y + g.headH / 2, e.name || ' ', { size: 15, weight: 700, fill: T.headText });
        s += boxRows(e, g, notation, isSelAttr, opt.interactive);
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${r}" fill="none" stroke="${T.entStroke}" stroke-width="1.6"/>`;
      } else {
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="2" fill="${T.entFill}"/>`;
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.headH}" rx="2" fill="${T.soft}"/>`;
        s += line({ x: g.x, y: g.y + g.headH }, { x: g.x + g.w, y: g.y + g.headH }, { width: 1.4, stroke: T.entStroke });
        s += text(g.cx, g.y + g.headH / 2, e.name || ' ', { size: 15, weight: 700 });
        s += boxRows(e, g, notation, isSelAttr, opt.interactive);
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="2" fill="none" stroke="${T.entStroke}" stroke-width="1.6"/>`;
      }
      s += '</g>';
      nodes.push(s);
      if (selected || hover) {
        overlay.push(
          `<rect class="sel-outline" x="${n1(g.x - 6)}" y="${n1(g.y - 6)}" width="${g.w + 12}" height="${g.h + 12}" rx="${chen ? 8 : 16}" fill="none" stroke="${ACCENT}" stroke-width="${
            selected ? 2 : 1.4
          }" ${selected ? '' : 'stroke-dasharray="5 4"'} pointer-events="none"/>`
        );
      }

      // Chen-Attribute
      if (chen) {
        for (const ag of attrGeoms.get(e.id) || []) {
          const p = clipRect(g, ag.cx, ag.cy);
          const q = clipEllipse(ag, g.cx, g.cy);
          attrLines.push(line(p, q, { width: 1.4 }));
          attrNodes.push(chenAttrNode(e.id, ag, isSelAttr(e.id, ag.a.id), !!e.weak));
        }
      }
    }

    if (opt.pending) {
      const g = geoms.get(opt.pending.from);
      if (g)
        overlay.push(
          `<line x1="${n1(g.cx)}" y1="${n1(g.cy)}" x2="${n1(opt.pending.x)}" y2="${n1(opt.pending.y)}" stroke="${ACCENT}" stroke-width="1.8" stroke-dasharray="6 5" pointer-events="none"/>`
        );
    }

    const svg =
      `<g font-family="${FONT}">` +
      relLines.join('') +
      attrLines.join('') +
      nodes.join('') +
      attrNodes.join('') +
      diamonds.join('') +
      labels.join('') +
      overlay.join('') +
      `</g>`;
    return { svg, bbox: L.bbox, layout: L };
  };

  function chenAttrNode(ownerId, ag, aSel, weakOwner) {
    let a = `<g data-kind="attr" data-id="${esc(ownerId)}" data-attr="${esc(ag.a.id)}" class="node">`;
    a += `<ellipse class="body" cx="${n1(ag.cx)}" cy="${n1(ag.cy)}" rx="${ag.w / 2}" ry="${ag.h / 2}" fill="${T.attrFill}" stroke="${aSel ? ACCENT : T.attrStroke}" stroke-width="${
      aSel ? 2 : 1.5
    }"/>`;
    a += text(ag.cx, ag.cy, ag.a.name || '—', { size: 13, weight: ag.a.pk ? 700 : 500 });
    if (ag.a.pk) {
      const hw = tw(ag.a.name || '—', 13, 700) / 2;
      // schwache Entität: der Schlüssel ist nur ein Teilschlüssel → gestrichelt unterstrichen
      a += line({ x: ag.cx - hw, y: ag.cy + 9 }, { x: ag.cx + hw, y: ag.cy + 9 }, { width: 1.3, stroke: T.ink, extra: weakOwner ? 'stroke-dasharray="4 3"' : '' });
    }
    return a + '</g>';
  }

  function boxRows(e, g, notation, isSelAttr, placeholder) {
    const attrs = e.attributes || [];
    let s = '';
    if (!attrs.length) {
      // der Hinweis gehört nur in den Editor, nicht in Vorschau und PDF
      return placeholder ? text(g.x + g.pad, g.y + g.headH + 5 + g.rowH / 2, 'Keine Attribute', { size: 12, fill: T.muted, anchor: 'start', italic: true }) : '';
    }
    attrs.forEach((a, i) => {
      const y0 = g.y + g.headH + 5 + i * g.rowH;
      const cy = y0 + g.rowH / 2;
      const selected = isSelAttr(e.id, a.id);
      s += `<g data-kind="attr" data-id="${esc(e.id)}" data-attr="${esc(a.id)}">`;
      s += `<rect x="${n1(g.x + 4)}" y="${n1(y0)}" width="${g.w - 8}" height="${g.rowH}" rx="6" fill="${selected ? '#FFF0EE' : 'transparent'}"/>`;
      if (notation === 'crow') {
        let x = g.x + g.pad;
        if (g.hasPk) {
          if (a.pk) {
            s += `<rect x="${n1(x)}" y="${n1(cy - 8)}" width="26" height="16" rx="5" fill="${T.pkBg}"/>`;
            s += text(x + 13, cy, 'PK', { size: 9.5, weight: 800, fill: T.pkFg });
          }
          x += 34;
        }
        s += text(x, cy, a.name || '—', { size: 13, weight: a.pk ? 700 : 500, anchor: 'start' });
        if (a.type) s += text(g.x + g.w - g.pad, cy, a.type, { size: 11.5, weight: 500, fill: T.muted, anchor: 'end' });
        if (i < attrs.length - 1)
          s += line({ x: g.x + g.pad, y: y0 + g.rowH }, { x: g.x + g.w - g.pad, y: y0 + g.rowH }, { stroke: T.rowLine, width: 1 });
      } else {
        s += text(g.x + g.pad, cy, umlAttr(a), { size: 13, weight: a.pk ? 700 : 500, anchor: 'start' });
      }
      s += '</g>';
    });
    return s;
  }

  /**
   * Ordnet das ganze Diagramm automatisch an (verändert das Projekt).
   * Kräftebasiert: Beziehungen ziehen Entitäten zusammen, Abstände verhindern Überlappung,
   * Untertypen landen unter ihrem Obertyp. Manuelle Positionen von Rauten/Attributen werden zurückgesetzt.
   */
  R.autoLayout = function (project) {
    const notation = project.notation;
    const chen = isChen(notation);
    const ents = project.entities;
    if (!ents.length) return;

    for (const e of ents) for (const a of e.attributes || []) delete a.dx, delete a.dy;
    for (const r of project.relationships) {
      delete r.x;
      delete r.y;
      delete r.bdx;
      delete r.bdy;
      for (const a of r.attributes || []) delete a.dx, delete a.dy;
    }
    for (const g of project.generalizations || []) delete g.x, delete g.y;

    // Platzbedarf je Entität (bei Chen inkl. Attribut-Ellipsen)
    const N = ents.map((e) => {
      const g = entityGeom({ ...e, x: 0, y: 0 }, notation);
      let [l, t, r, b] = [0, 0, g.w, g.h];
      if (chen)
        for (const ag of chenAttrGeoms(e, g)) {
          l = Math.min(l, ag.cx - ag.w / 2);
          t = Math.min(t, ag.cy - ag.h / 2);
          r = Math.max(r, ag.cx + ag.w / 2);
          b = Math.max(b, ag.cy + ag.h / 2);
        }
      return { e, ox: l, oy: t, W: r - l, H: b - t, x: 0, y: 0 };
    });
    const idx = new Map(ents.map((e, i) => [e.id, i]));

    // Kanten: Beziehungen (mit Platz für Raute bzw. Beschriftung) und Generalisierungen
    const edges = [];
    const seen = new Set();
    for (const r of project.relationships) {
      const a = idx.get(r.from);
      const b = idx.get(r.to);
      if (a === undefined || b === undefined || a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const extra = (r.attributes || []).length ? 60 : 0;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ a, b, gap: (chen ? 190 : 130) + extra });
    }
    const gens = [];
    for (const g of project.generalizations || []) {
      const p = idx.get(g.parent);
      if (p === undefined) continue;
      for (const c of g.children || []) {
        const ci = idx.get(c);
        if (ci === undefined || ci === p) continue;
        gens.push({ p, c: ci });
        edges.push({ a: p, b: ci, gap: chen ? 170 : 110 });
      }
    }

    // Startpositionen: Breitensuche ab der Entität mit den meisten Verbindungen, im Raster
    const deg = N.map(() => 0);
    const adj = N.map(() => []);
    for (const ed of edges) {
      deg[ed.a]++;
      deg[ed.b]++;
      adj[ed.a].push(ed.b);
      adj[ed.b].push(ed.a);
    }
    // Jede Entität in eine freie Rasterzelle direkt neben ihrem Nachbarn (Untertypen bevorzugt darunter),
    // so entstehen keine Ketten, die quer durch andere Entitäten laufen.
    const isSub = new Set(gens.map((g) => `${g.p}>${g.c}`));
    const cellW = Math.max(...N.map((n) => n.W)) + (chen ? 190 : 130);
    const cellH = Math.max(...N.map((n) => n.H)) + (chen ? 170 : 110);
    const occ = new Map();
    const cell = N.map(() => null);
    const put = (i, cx, cy) => {
      cell[i] = [cx, cy];
      occ.set(`${cx},${cy}`, i);
    };
    const SIDE = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const BELOW = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [2, 1], [-2, 1]];
    const free = (from, dirs) => {
      for (let r = 1; r < 6; r++) for (const [dx, dy] of dirs) if (!occ.has(`${from[0] + dx * r},${from[1] + dy * r}`)) return [from[0] + dx * r, from[1] + dy * r];
      return null;
    };
    const byDeg = N.map((_, i) => i).sort((x, y) => deg[y] - deg[x] || x - y);
    let nextCol = 0;
    for (const s of byDeg) {
      if (cell[s]) continue;
      // neue Zusammenhangskomponente rechts neben die bisherigen
      const used = [...occ.keys()].map((k) => +k.split(',')[0]);
      nextCol = used.length ? Math.max(...used) + 2 : 0;
      put(s, nextCol, 0);
      const q = [s];
      while (q.length) {
        const i = q.shift();
        for (const j of adj[i].slice().sort((x, y) => deg[y] - deg[x] || x - y)) {
          if (cell[j]) continue;
          const dirs = isSub.has(`${i}>${j}`) ? BELOW : isSub.has(`${j}>${i}`) ? BELOW.map(([x, y]) => [x, -y]) : SIDE;
          const c = free(cell[i], dirs) || [nextCol + occ.size, 0];
          put(j, c[0], c[1]);
          q.push(j);
        }
      }
    }
    N.forEach((n, i) => {
      n.x = cell[i][0] * cellW;
      n.y = cell[i][1] * cellH;
    });

    // Abstand zwischen Mittelpunkt und Rechteckrand in Richtung u
    const reach = (n, ux, uy) => Math.min(ux ? n.W / 2 / Math.abs(ux) : Infinity, uy ? n.H / 2 / Math.abs(uy) : Infinity);
    const minGap = chen ? 70 : 60;

    const ITER = 450;
    for (let it = 0; it < ITER; it++) {
      const cool = 1 - it / ITER;
      const fx = N.map(() => 0);
      const fy = N.map(() => 0);
      // Federn entlang der Kanten
      for (const ed of edges) {
        const A = N[ed.a];
        const B = N[ed.b];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const ux = dx / d;
        const uy = dy / d;
        const target = reach(A, ux, uy) + reach(B, ux, uy) + ed.gap;
        const f = (d - target) * 0.08;
        fx[ed.a] += ux * f;
        fy[ed.a] += uy * f;
        fx[ed.b] -= ux * f;
        fy[ed.b] -= uy * f;
      }
      // Abstoßung zwischen allen Paaren
      for (let i = 0; i < N.length; i++)
        for (let j = i + 1; j < N.length; j++) {
          const A = N[i];
          const B = N[j];
          let dx = B.x - A.x;
          let dy = B.y - A.y;
          if (!dx && !dy) dx = 1;
          const d = Math.hypot(dx, dy);
          const ux = dx / d;
          const uy = dy / d;
          const sep = d - reach(A, ux, uy) - reach(B, ux, uy); // Lücke zwischen den Rechtecken
          let f = 0;
          if (sep < minGap) f = (minGap - sep) * 0.4;
          f += 1800 / Math.max(d, 50); // schwache Fernwirkung, damit lose Teile nicht kleben
          fx[i] -= ux * f;
          fy[i] -= uy * f;
          fx[j] += ux * f;
          fy[j] += uy * f;
        }
      // Untertypen unter den Obertyp
      for (const { p, c } of gens) {
        const P = N[p];
        const C = N[c];
        const want = P.y + P.H / 2 + C.H / 2 + (chen ? 170 : 110);
        if (C.y < want) {
          const f = (want - C.y) * 0.35;
          fy[c] += f;
          fy[p] -= f * 0.5;
        }
        // Untertypen zur Spalte des Obertyps ziehen (Geschwister stoßen sich gegenseitig ab)
        const fxg = (P.x - C.x) * 0.03;
        fx[c] += fxg;
        fx[p] -= fxg * 0.5;
      }
      // leichte Schwerkraft zur Mitte, damit das Diagramm kompakt bleibt
      const mx = N.reduce((s, n) => s + n.x, 0) / N.length;
      const my = N.reduce((s, n) => s + n.y, 0) / N.length;
      const maxStep = 60 * cool + 2;
      N.forEach((n, i) => {
        fx[i] += (mx - n.x) * 0.004;
        fy[i] += (my - n.y) * 0.006; // etwas stärker vertikal: Diagramme eher breit als hoch
        const l = Math.hypot(fx[i], fy[i]);
        const s = l > maxStep ? maxStep / l : 1;
        n.x += fx[i] * s;
        n.y += fy[i] * s;
      });
    }

    // Restliche Überlappungen achsenweise auflösen
    for (let pass = 0; pass < 120; pass++) {
      let moved = false;
      // harte Regel: Untertyp unterhalb des Obertyps
      for (const { p, c } of gens) {
        const want = N[p].y + N[p].H / 2 + N[c].H / 2 + (chen ? 150 : 90);
        if (N[c].y < want - 0.5) {
          N[c].y = want;
          moved = true;
        }
      }
      for (let i = 0; i < N.length; i++)
        for (let j = i + 1; j < N.length; j++) {
          const A = N[i];
          const B = N[j];
          const ox = (A.W + B.W) / 2 + minGap - Math.abs(B.x - A.x);
          const oy = (A.H + B.H) / 2 + minGap - Math.abs(B.y - A.y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) {
            const s = (B.x >= A.x ? 1 : -1) * (ox / 2 + 1);
            A.x -= s;
            B.x += s;
          } else {
            const s = (B.y >= A.y ? 1 : -1) * (oy / 2 + 1);
            A.y -= s;
            B.y += s;
          }
        }
      if (!moved) break;
    }

    // Übernehmen: linke obere Ecke auf (60, 60), Raster 10
    const minX = Math.min(...N.map((n) => n.x - n.W / 2));
    const minY = Math.min(...N.map((n) => n.y - n.H / 2));
    for (const n of N) {
      n.e.x = Math.round((n.x - n.W / 2 - minX + 60 - n.ox) / 10) * 10;
      n.e.y = Math.round((n.y - n.H / 2 - minY + 60 - n.oy) / 10) * 10;
    }
  };

  /** Vollständiges, eigenständiges SVG (für PDF-Export und Vorschaubilder). */
  R.diagramSvg = function (project, { padding = 30 } = {}) {
    const r = R.renderDiagram(project, {});
    if (!r.bbox) return null;
    const x = r.bbox.minX - padding;
    const y = r.bbox.minY - padding;
    const w = r.bbox.maxX - r.bbox.minX + padding * 2;
    const h = r.bbox.maxY - r.bbox.minY + padding * 2;
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(x)} ${n1(y)} ${n1(w)} ${n1(h)}" width="${n1(w)}" height="${n1(
        h
      )}">${r.svg}</svg>`,
      width: w,
      height: h,
    };
  };
})();
