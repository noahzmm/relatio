// Diagramm-Layout & SVG-Rendering für alle Notationen (gemeinsam für Editor, Vorschau und PDF)
(function () {
  const R = (window.R = window.R || {});
  const FONT = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  const INK = '#141416';
  const INK2 = '#3A3A40';
  const MUTED = '#8E8E93';
  const ACCENT = '#FF3B30';
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
        ? tw(umlAttr(a), 13, 500) + pad * 2
        : (hasPk ? 34 : 0) + tw(a.name || '—', 13, a.pk ? 600 : 500) + (a.type ? tw(a.type, 11.5, 500) + 24 : 0) + pad * 2;
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

  /** Berechnet alle Positionen des Diagramms. */
  R.layout = function (project) {
    const notation = project.notation;
    const chen = isChen(notation);
    const geoms = new Map();
    const attrGeoms = new Map();
    for (const e of project.entities) {
      const g = entityGeom(e, notation);
      geoms.set(e.id, g);
      if (chen) attrGeoms.set(e.id, chenAttrGeoms(e, g));
    }

    // Parallele Beziehungen zwischen demselben Paar auffächern
    const pairCount = new Map();
    const pairIdx = new Map();
    for (const r of project.relationships) {
      const k = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      pairIdx.set(r.id, pairCount.get(k) || 0);
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }

    const rels = [];
    for (const r of project.relationships) {
      const A = geoms.get(r.from);
      const B = geoms.get(r.to);
      if (!A || !B) continue;
      const k = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      const cnt = pairCount.get(k);
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
          cx = A.x + A.w + 90 + size.w / 2;
          cy = A.cy + idx * 100;
        } else {
          const u = unit(B.cx - A.cx, B.cy - A.cy);
          const nn = r.from < r.to ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
          const off = (idx - (cnt - 1) / 2) * 110;
          cx = (A.cx + B.cx) / 2 + nn.x * off;
          cy = (A.cy + B.cy) / 2 + nn.y * off;
        }
        const d = { cx, cy, w: size.w, h: size.h };
        const ends = [];
        const mk = (G, own, other, isFrom, shift) => {
          const u0 = unit(d.cx - G.cx, d.cy - G.cy);
          const nn = { x: -u0.y, y: u0.x };
          const ox = G.cx + nn.x * shift;
          const oy = G.cy + nn.y * shift;
          const p = clipRect(G, d.cx + nn.x * shift, d.cy + nn.y * shift, ox, oy);
          const q0 = clipDiamond(d, ox, oy);
          const q = { x: q0.x + nn.x * shift * 0.5, y: q0.y + nn.y * shift * 0.5 };
          return { p, q, u: unit(q.x - p.x, q.y - p.y), own, other, isFrom, total: other.min === 1 };
        };
        ends.push(mk(A, r.cardFrom, r.cardTo, true, self ? -16 : 0));
        ends.push(mk(B, r.cardTo, r.cardFrom, false, self ? 16 : 0));
        rels.push({ rel: r, kind: 'chen', d, ends });
        if ((r.attributes || []).length) attrGeoms.set(r.id, chenAttrGeoms(r, d, { x: 40, y: 46 }));
      } else {
        let pts;
        if (self) {
          const o = idx * 22;
          const sx = A.x + A.w - 36 - o;
          const top = A.y - 42 - o;
          const right = A.x + A.w + 44 + o;
          const ey = A.y + 32 + o;
          pts = [
            { x: sx, y: A.y },
            { x: sx, y: top },
            { x: right, y: top },
            { x: right, y: ey },
            { x: A.x + A.w, y: ey },
          ];
        } else {
          const u = unit(B.cx - A.cx, B.cy - A.cy);
          const nn = r.from < r.to ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
          const off = (idx - (cnt - 1) / 2) * 30;
          const ax = A.cx + nn.x * off;
          const ay = A.cy + nn.y * off;
          const bx = B.cx + nn.x * off;
          const by = B.cy + nn.y * off;
          pts = [clipRect(A, bx, by, ax, ay), clipRect(B, ax, ay, bx, by)];
        }
        const last = pts.length - 1;
        const ends = [
          { p: pts[0], u: unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y), own: r.cardFrom, other: r.cardTo, isFrom: true },
          {
            p: pts[last],
            u: unit(pts[last - 1].x - pts[last].x, pts[last - 1].y - pts[last].y),
            own: r.cardTo,
            other: r.cardFrom,
            isFrom: false,
          },
        ];
        let mid;
        if (self) mid = { x: (pts[1].x + pts[2].x) / 2, y: pts[1].y - 12 };
        else mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        // Attribute der Beziehung: eigener Kasten, gestrichelt an der Linie (wie UML-Assoziationsklasse)
        let abox = null;
        if ((r.attributes || []).length) {
          const fake = { name: r.name || 'Attribute', x: 0, y: 0, attributes: r.attributes };
          const g0 = entityGeom(fake, notation);
          const dir = self ? { x: 0, y: -1 } : perpUp(unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
          const dist = 46 + (Math.abs(dir.y) * g0.h) / 2 + (Math.abs(dir.x) * g0.w) / 2;
          const cx = mid.x + dir.x * dist + (r.bdx || 0);
          const cy = mid.y + dir.y * dist + (r.bdy || 0);
          abox = entityGeom({ ...fake, x: Math.round(cx - g0.w / 2), y: Math.round(cy - g0.h / 2) }, notation);
        }
        rels.push({ rel: r, kind: 'box', pts, ends, mid, self, abox });
      }
    }

    // Generalisierungen: Verteilerpunkt (hub) zwischen Obertyp und Untertypen
    const gens = [];
    for (const gen of project.generalizations || []) {
      const P = geoms.get(gen.parent);
      const kids = (gen.children || []).filter((id) => id !== gen.parent).map((id) => geoms.get(id)).filter(Boolean);
      if (!P || !kids.length) continue;
      let hub;
      if (typeof gen.x === 'number' && typeof gen.y === 'number') hub = { x: gen.x, y: gen.y };
      else {
        const mx = kids.reduce((s, g) => s + g.cx, 0) / kids.length;
        const top = Math.min(...kids.map((g) => g.y));
        const bottom = Math.max(...kids.map((g) => g.y + g.h));
        if (top > P.y + P.h + 40) hub = { x: P.cx, y: (P.y + P.h + top) / 2 };
        else if (bottom < P.y - 40) hub = { x: P.cx, y: (P.y + bottom) / 2 };
        else {
          const my = kids.reduce((s, g) => s + g.cy, 0) / kids.length;
          const pe = clipRect(P, mx, my);
          hub = { x: pe.x + (mx - pe.x) * 0.45, y: pe.y + (my - pe.y) * 0.45 };
        }
      }
      const pEnd = clipRect(P, hub.x, hub.y);
      gens.push({ gen, P, kids, hub, pEnd, kidEnds: kids.map((g) => clipRect(g, hub.x, hub.y)) });
    }

    // Bounding Box
    const bb ={ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
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
          const hw = tw(r.rel.name, 12.5, 600) / 2 + 6;
          grow(r.mid.x - hw, r.mid.y - 16, r.mid.x + hw, r.mid.y + 16);
        }
      }
      for (const e of r.ends) grow(e.p.x - 40, e.p.y - 26, e.p.x + 40, e.p.y + 26);
      if (r.abox) grow(r.abox.x, r.abox.y, r.abox.x + r.abox.w, r.abox.y + r.abox.h);
    }
    for (const g of gens) grow(g.hub.x - 60, g.hub.y - 40, g.hub.x + 60, g.hub.y + 40);
    const bbox = Number.isFinite(bb.minX) ? bb : null;
    return { notation, chen, geoms, attrGeoms, rels, gens, bbox };
  };

  // ---------- SVG-Bausteine ----------
  const text = (x, y, s, { size = 13, weight = 500, fill = INK, anchor = 'middle', halo = false, cls = '', italic = false } = {}) => {
    // Halo als weißer Hintergrund (statt Text-Kontur, die im PDF doppelten Text erzeugt)
    let bg = '';
    if (halo) {
      const w = tw(s, size, weight) + 8;
      const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + 4 : x - 4;
      bg = `<rect x="${n1(bx)}" y="${n1(y - size / 2 - 3)}" width="${n1(w)}" height="${n1(size + 6)}" rx="4" fill="#fff"/>`;
    }
    return `${bg}<text x="${n1(x)}" y="${n1(y)}" dy="0.35em" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${
      italic ? ' font-style="italic"' : ''
    }${cls ? ` class="${cls}"` : ''}>${esc(s)}</text>`;
  };

  const line = (a, b, { stroke = INK, width = 1.6, extra = '' } = {}) =>
    `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;

  function crowEnd(p, u, card, stroke) {
    const n = { x: -u.y, y: u.x };
    const at = (d, s) => ({ x: p.x + u.x * d + n.x * s, y: p.y + u.y * d + n.y * s });
    let s = '';
    if (card.max === 'N') {
      const q = at(18, 0);
      s += line(q, at(0, -9), { stroke, width: 1.6 }) + line(q, at(0, 0), { stroke, width: 1.6 }) + line(q, at(0, 9), { stroke, width: 1.6 });
    } else {
      s += line(at(9, -8), at(9, 8), { stroke, width: 1.6 });
    }
    if (card.min === 1) {
      s += line(at(25, -8), at(25, 8), { stroke, width: 1.6 });
    } else {
      const c = at(30, 0);
      s += `<circle cx="${n1(c.x)}" cy="${n1(c.y)}" r="5.5" fill="#fff" stroke="${stroke}" stroke-width="1.6"/>`;
    }
    return s;
  }

  /**
   * Rendert den SVG-Inhalt (ohne <svg>-Wurzel).
   * opt: { sel: {kind,id,attr}, hover: entityId, pending: {from,x,y} }
   */
  R.renderDiagram = function (project, opt = {}) {
    const L = R.layout(project);
    const { notation, chen, geoms, attrGeoms, rels } = L;
    const sel = opt.sel || null;
    const isSelEntity = (id) => sel && (sel.kind === 'entity' || sel.kind === 'attr') && sel.id === id;
    const isSelAttr = (id, aid) => sel && sel.kind === 'attr' && sel.id === id && sel.attr === aid;
    const isSelRel = (id) => sel && sel.kind === 'rel' && sel.id === id;

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
      const stroke = selected ? ACCENT : INK;
      if (r.kind === 'chen') {
        let ls = '';
        for (const e of r.ends) {
          if (e.total) {
            ls += line(e.p, e.q, { stroke, width: 6.4 }) + line(e.p, e.q, { stroke: '#fff', width: 2.2 });
          } else {
            ls += line(e.p, e.q, { stroke, width: 1.8 });
          }
          ls += line(e.p, e.q, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
          const n = perpUp(e.u);
          const lab = R.endLabel(notation, e.own, e.other, e.isFrom);
          const dist = notation === 'minmax' ? 34 : 20;
          labels.push(
            text(e.p.x + e.u.x * dist + n.x * 13, e.p.y + e.u.y * dist + n.y * 13, lab, {
              size: notation === 'minmax' ? 12.5 : 14,
              weight: 700,
              fill: selected ? ACCENT : INK,
              halo: true,
            })
          );
        }
        relLines.push(`<g data-kind="rel" data-id="${esc(r.rel.id)}">${ls}</g>`);
        const d = r.d;
        for (const ag of attrGeoms.get(r.rel.id) || []) {
          attrLines.push(line(clipDiamond(d, ag.cx, ag.cy), clipEllipse(ag, d.cx, d.cy), { width: 1.4 }));
          attrNodes.push(chenAttrNode(r.rel.id, ag, isSelAttr(r.rel.id, ag.a.id)));
        }
        diamonds.push(
          `<g data-kind="rel" data-id="${esc(r.rel.id)}" class="node">` +
            `<path class="body" d="M${n1(d.cx)},${n1(d.cy - d.h / 2)} L${n1(d.cx + d.w / 2)},${n1(d.cy)} L${n1(d.cx)},${n1(
              d.cy + d.h / 2
            )} L${n1(d.cx - d.w / 2)},${n1(d.cy)} Z" fill="#fff" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>` +
            text(d.cx, d.cy, r.rel.name || ' ', { size: 13, weight: 600, fill: INK }) +
            `</g>`
        );
      } else {
        const pts = r.pts.map((p) => `${n1(p.x)},${n1(p.y)}`).join(' ');
        let ls = `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`;
        ls += `<polyline class="hit" points="${pts}" fill="none" stroke="transparent" stroke-width="14"/>`;
        for (const e of r.ends) {
          if (notation === 'crow') ls += crowEnd(e.p, e.u, e.own, stroke);
          else {
            const n = perpUp(e.u);
            labels.push(
              text(e.p.x + e.u.x * 18 + n.x * 12, e.p.y + e.u.y * 18 + n.y * 12, R.endLabel(notation, e.own, e.other, e.isFrom), {
                size: 12.5,
                weight: 700,
                fill: selected ? ACCENT : INK,
                halo: true,
              })
            );
          }
        }
        relLines.push(`<g data-kind="rel" data-id="${esc(r.rel.id)}">${ls}</g>`);
        if (r.abox) {
          const g = r.abox;
          const id = esc(r.rel.id);
          const fake = { id: r.rel.id, attributes: r.rel.attributes };
          const p = clipRect(g, r.mid.x, r.mid.y);
          relLines.push(line(r.mid, p, { stroke, width: 1.4, extra: 'stroke-dasharray="5 4"' }));
          let s = `<g data-kind="rbox" data-id="${id}" class="node">`;
          s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${notation === 'crow' ? 12 : 2}" fill="#fff"/>`;
          s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.headH}" rx="${notation === 'crow' ? 12 : 2}" fill="#F3F3F5"/>`;
          s += `<rect x="${n1(g.x)}" y="${n1(g.y + g.headH - 12)}" width="${g.w}" height="12" fill="#F3F3F5"/>`;
          s += line({ x: g.x, y: g.y + g.headH }, { x: g.x + g.w, y: g.y + g.headH }, { width: 1.2, stroke: INK2 });
          s += text(g.cx, g.y + g.headH / 2, r.rel.name || 'Attribute', { size: 14, weight: 700, fill: INK2, italic: !r.rel.name });
          s += '</g>';
          s += boxRows(fake, g, notation, isSelAttr);
          s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${notation === 'crow' ? 12 : 2}" fill="none" stroke="${stroke}" stroke-width="1.4" pointer-events="none"/>`;
          diamonds.push(s);
        }
        if (r.rel.name && !r.abox) {
          labels.push(
            `<g data-kind="rel" data-id="${esc(r.rel.id)}">` +
              text(r.mid.x, r.mid.y, r.rel.name, { size: 12.5, weight: 600, fill: selected ? ACCENT : INK2, halo: true, italic: notation === 'uml' }) +
              `</g>`
          );
        }
      }
    }

    // Generalisierungen
    for (const G of L.gens) {
      const selected = sel && sel.kind === 'gen' && sel.id === G.gen.id;
      const stroke = selected ? ACCENT : INK;
      const { hub, pEnd } = G;
      const id = esc(G.gen.id);
      const u = unit(pEnd.x - hub.x, pEnd.y - hub.y); // Richtung zum Obertyp
      const n = { x: -u.y, y: u.x };
      let ls = '';
      let hit = '';
      if (chen) {
        const TW = 74;
        const TH = 54;
        const apex = { x: hub.x + u.x * (TH / 2), y: hub.y + u.y * (TH / 2) };
        const base = { x: hub.x - u.x * (TH / 2), y: hub.y - u.y * (TH / 2) };
        if (G.gen.total) ls += line(apex, pEnd, { stroke, width: 6.4 }) + line(apex, pEnd, { stroke: '#fff', width: 2.2 });
        else ls += line(apex, pEnd, { stroke, width: 1.8 });
        hit += line(apex, pEnd, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        G.kids.forEach((kg, i) => {
          ls += line(base, G.kidEnds[i], { stroke, width: 1.8 });
          hit += line(base, G.kidEnds[i], { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        });
        relLines.push(`<g data-kind="gen" data-id="${id}">${ls}${hit}</g>`);
        const b1 = { x: base.x + n.x * (TW / 2), y: base.y + n.y * (TW / 2) };
        const b2 = { x: base.x - n.x * (TW / 2), y: base.y - n.y * (TW / 2) };
        const lp = perpUp(u);
        diamonds.push(
          `<g data-kind="gen" data-id="${id}" class="node">` +
            `<path class="body" d="M${n1(apex.x)},${n1(apex.y)} L${n1(b1.x)},${n1(b1.y)} L${n1(b2.x)},${n1(b2.y)} Z" fill="#fff" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>` +
            text(hub.x - u.x * 6, hub.y - u.y * 6, 'IS-A', { size: 11.5, weight: 800, fill: INK }) +
            text(hub.x + lp.x * (TW / 2 + 6), hub.y + lp.y * (TW / 2 + 6), G.gen.disjoint === false ? 'o' : 'd', { size: 14, weight: 700, fill: stroke, halo: true }) +
            `</g>`
        );
      } else {
        // UML-Stil: Linien treffen sich im Verteiler, hohles Dreieck am Obertyp
        G.kids.forEach((kg, i) => {
          ls += line(G.kidEnds[i], hub, { stroke, width: 1.6 });
          hit += line(G.kidEnds[i], hub, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        });
        const AH = 16;
        const tip = pEnd;
        const back = { x: tip.x - u.x * AH, y: tip.y - u.y * AH };
        ls += line(hub, back, { stroke, width: 1.6 });
        hit += line(hub, tip, { stroke: 'transparent', width: 14, extra: 'class="hit"' });
        ls += `<path d="M${n1(tip.x)},${n1(tip.y)} L${n1(back.x + n.x * 9)},${n1(back.y + n.y * 9)} L${n1(back.x - n.x * 9)},${n1(back.y - n.y * 9)} Z" fill="#fff" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`;
        relLines.push(`<g data-kind="gen" data-id="${id}">${ls}${hit}</g>`);
        const lab = `{${G.gen.disjoint === false ? 'überlappend' : 'disjunkt'}, ${G.gen.total ? 'total' : 'partiell'}}`;
        diamonds.push(
          `<g data-kind="gen" data-id="${id}" class="node">` +
            `<circle class="body" cx="${n1(hub.x)}" cy="${n1(hub.y)}" r="${selected ? 5 : 4}" fill="${stroke}"/>` +
            `<circle cx="${n1(hub.x)}" cy="${n1(hub.y)}" r="12" fill="transparent"/>` +
            text(hub.x + 14, hub.y - 12, lab, { size: 11.5, weight: 600, fill: selected ? ACCENT : MUTED, anchor: 'start', halo: true, italic: true }) +
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
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="3" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
        if (e.weak)
          s += `<rect x="${n1(g.x + 5)}" y="${n1(g.y + 5)}" width="${g.w - 10}" height="${g.h - 10}" rx="2" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
        s += text(g.cx, g.cy, e.name || ' ', { size: 15, weight: 700 });
      } else if (notation === 'crow') {
        const r = 12;
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${r}" fill="#fff"/>`;
        s += `<path d="M${n1(g.x)},${n1(g.y + g.headH)} V${n1(g.y + r)} Q${n1(g.x)},${n1(g.y)} ${n1(g.x + r)},${n1(g.y)} H${n1(
          g.x + g.w - r
        )} Q${n1(g.x + g.w)},${n1(g.y)} ${n1(g.x + g.w)},${n1(g.y + r)} V${n1(g.y + g.headH)} Z" fill="${INK}"/>`;
        s += text(g.cx, g.y + g.headH / 2, e.name || ' ', { size: 15, weight: 700, fill: '#fff' });
        s += boxRows(e, g, notation, isSelAttr);
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="${r}" fill="none" stroke="${INK}" stroke-width="1.6"/>`;
      } else {
        s += `<rect class="body" x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="2" fill="#fff"/>`;
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.headH}" rx="2" fill="#F3F3F5"/>`;
        s += line({ x: g.x, y: g.y + g.headH }, { x: g.x + g.w, y: g.y + g.headH }, { width: 1.4 });
        s += text(g.cx, g.y + g.headH / 2, e.name || ' ', { size: 15, weight: 700 });
        s += boxRows(e, g, notation, isSelAttr);
        s += `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${g.w}" height="${g.h}" rx="2" fill="none" stroke="${INK}" stroke-width="1.6"/>`;
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
          attrNodes.push(chenAttrNode(e.id, ag, isSelAttr(e.id, ag.a.id)));
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

  function chenAttrNode(ownerId, ag, aSel) {
    let a = `<g data-kind="attr" data-id="${esc(ownerId)}" data-attr="${esc(ag.a.id)}" class="node">`;
    a += `<ellipse class="body" cx="${n1(ag.cx)}" cy="${n1(ag.cy)}" rx="${ag.w / 2}" ry="${ag.h / 2}" fill="#fff" stroke="${aSel ? ACCENT : INK}" stroke-width="${
      aSel ? 2 : 1.5
    }"/>`;
    a += text(ag.cx, ag.cy, ag.a.name || '—', { size: 13, weight: ag.a.pk ? 700 : 500 });
    if (ag.a.pk) {
      const hw = tw(ag.a.name || '—', 13, 700) / 2;
      a += line({ x: ag.cx - hw, y: ag.cy + 9 }, { x: ag.cx + hw, y: ag.cy + 9 }, { width: 1.3 });
    }
    return a + '</g>';
  }

  function boxRows(e, g, notation, isSelAttr) {
    const attrs = e.attributes || [];
    let s = '';
    if (!attrs.length) {
      return text(g.x + g.pad, g.y + g.headH + 5 + g.rowH / 2, 'Keine Attribute', { size: 12, fill: '#B4B4BA', anchor: 'start', italic: true });
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
            s += `<rect x="${n1(x)}" y="${n1(cy - 8)}" width="26" height="16" rx="5" fill="#FFE9E5"/>`;
            s += text(x + 13, cy, 'PK', { size: 9.5, weight: 800, fill: '#E5402F' });
          }
          x += 34;
        }
        s += text(x, cy, a.name || '—', { size: 13, weight: a.pk ? 700 : 500, anchor: 'start' });
        if (a.type) s += text(g.x + g.w - g.pad, cy, a.type, { size: 11.5, weight: 500, fill: MUTED, anchor: 'end' });
        if (i < attrs.length - 1)
          s += line({ x: g.x + g.pad, y: y0 + g.rowH }, { x: g.x + g.w - g.pad, y: y0 + g.rowH }, { stroke: '#EFEFF2', width: 1 });
      } else {
        s += text(g.x + g.pad, cy, umlAttr(a), { size: 13, weight: a.pk ? 700 : 500, anchor: 'start' });
      }
      s += '</g>';
    });
    return s;
  }

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
