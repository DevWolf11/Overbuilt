'use strict';
// Part catalogue and part drawing. Units: metres, tonnes, kN, seconds.

const PART_CATEGORIES = [
  { id: 'command', name: 'Command' },
  { id: 'fuel', name: 'Fuel' },
  { id: 'engine', name: 'Engines' },
  { id: 'coupling', name: 'Coupling' },
  { id: 'utility', name: 'Utility' },
];

const FUEL_PER_M2 = 0.55; // tonnes of propellant per m² of tank side area

function tank(name, w, h, desc) {
  const fuel = +(w * h * FUEL_PER_M2).toFixed(2);
  return { cat: 'fuel', name, w, h, fuel, mass: +(fuel / 9).toFixed(3), shape: 'tank', desc };
}

const PARTS = {
  pod: { cat: 'command', name: 'Command Pod', w: 2, h: 2, mass: 1.2, control: 2, torque: 25000, shape: 'pod', aero: true, breakSpeed: 12,
    desc: 'Crew capsule with a reaction wheel. Put a parachute on top to bring it home.' },
  probe: { cat: 'command', name: 'Probe Core', w: 1, h: 1, mass: 0.25, control: 1, torque: 6000, shape: 'probe',
    desc: 'Light uncrewed controller. Weak reaction wheel.' },

  tankS: tank('Fuel Tank S', 2, 1, 'Short tank. Good for fine-tuning stages.'),
  tankM: tank('Fuel Tank M', 2, 2, 'Standard tank.'),
  tankL: tank('Fuel Tank L', 2, 4, 'Long tank for core stages.'),
  tankThin: tank('Slim Tank', 1, 2, 'Narrow tank for landers and probes.'),
  tankWide: tank('Wide Tank', 3, 3, 'Heavy tank sized for the Titan.'),

  hawk: { cat: 'engine', name: 'Hawk', w: 2, h: 2, mass: 1.4, thrust: 200, ispSL: 250, ispVac: 290, gimbal: 0.07, shape: 'engine',
    mount: 0.34, bellTop: 0.36, bellBot: 0.86, desc: 'Reliable first-stage engine. Strong at sea level.' },
  titan: { cat: 'engine', name: 'Titan', w: 3, h: 3, mass: 3.6, thrust: 520, ispSL: 260, ispVac: 300, gimbal: 0.06, shape: 'engine',
    mount: 0.3, bellTop: 0.34, bellBot: 0.9, desc: 'Heavy lifter for big rockets.' },
  valiant: { cat: 'engine', name: 'Valiant', w: 2, h: 1.5, mass: 0.55, thrust: 50, ispSL: 190, ispVac: 345, gimbal: 0.08, shape: 'engine',
    mount: 0.28, bellTop: 0.3, bellBot: 1.0, desc: 'Vacuum engine. Weak in the air, very efficient in space.' },
  kolibri: { cat: 'engine', name: 'Kolibri', w: 1, h: 1, mass: 0.12, thrust: 12, ispSL: 230, ispVac: 315, gimbal: 0.1, shape: 'engine',
    mount: 0.35, bellTop: 0.4, bellBot: 0.9, desc: 'Tiny engine for landers and probes.' },

  separator: { cat: 'coupling', name: 'Separator', w: 2, h: 0.5, mass: 0.08, separator: true, shape: 'sep',
    desc: 'Splits the rocket in two. Stays attached to the part that falls away.' },
  sideSep: { cat: 'coupling', name: 'Side Separator', w: 0.5, h: 2, mass: 0.06, separator: true, side: true, shape: 'sep',
    desc: 'Attach boosters to the side of a stage.' },

  nose: { cat: 'utility', name: 'Nose Cone', w: 2, h: 1.5, mass: 0.08, aero: true, shape: 'nose',
    desc: 'Cuts drag when it leads the way.' },
  chute: { cat: 'utility', name: 'Parachute', w: 1, h: 0.5, mass: 0.1, chute: true, shape: 'chute',
    desc: 'Deploy below 250 m/s in an atmosphere for a gentle landing.' },
  leg: { cat: 'utility', name: 'Landing Leg', w: 0.5, h: 3, mass: 0.08, leg: true, breakSpeed: 16, shape: 'leg',
    desc: 'Mount on a side. Absorbs harder touchdowns.' },
};
for (const k in PARTS) PARTS[k].type = k;

function partDryKg(def) { return def.mass * 1000; }
function partFuelKg(def) { return (def.fuel || 0) * 1000; }

let _partSeq = 1;
function makePart(type, x, y, extra) {
  const def = PARTS[type];
  const p = { id: _partSeq++, type, def, x, y, flip: x < 0, fuel: partFuelKg(def), active: false, deployed: 0 };
  if (extra) Object.assign(p, extra);
  return p;
}
function partRect(p) {
  const d = p.def;
  return { l: p.x - d.w / 2, r: p.x + d.w / 2, b: p.y - d.h / 2, t: p.y + d.h / 2 };
}

// Two parts are attached if they share an edge segment.
function partsTouch(a, b) {
  const A = partRect(a), B = partRect(b), eps = 0.02, minOverlap = 0.1;
  const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
  const oy = Math.min(A.t, B.t) - Math.max(A.b, B.b);
  if (ox > minOverlap && (Math.abs(A.t - B.b) < eps || Math.abs(B.t - A.b) < eps)) return true;
  if (oy > minOverlap && (Math.abs(A.r - B.l) < eps || Math.abs(B.r - A.l) < eps)) return true;
  return false;
}
function partsOverlap(a, b) {
  const A = partRect(a), B = partRect(b);
  return Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0.02 && Math.min(A.t, B.t) - Math.max(A.b, B.b) > 0.02;
}

function buildAdjacency(parts) {
  const adj = new Map();
  for (const p of parts) adj.set(p.id, new Set());
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (partsTouch(parts[i], parts[j])) { adj.get(parts[i].id).add(parts[j].id); adj.get(parts[j].id).add(parts[i].id); }
  return adj;
}

function componentOf(startId, adj, skip) {
  const seen = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    for (const n of adj.get(id) || []) if (!seen.has(n) && !(skip && skip(n))) { seen.add(n); stack.push(n); }
  }
  return seen;
}

function findControlPart(parts) {
  let best = null;
  for (const p of parts) if (p.def.control && (!best || p.def.control > best.def.control)) best = p;
  return best;
}

// ---------------------------------------------------------------------------
// Staging heuristic.
// Segments are the pieces left after removing separators. The segment with the
// control part is the root; each separator joins a segment to one deeper in the tree.
// Stage 1 ignites every engine at the bottom of its column. Each following stage
// fires the deepest remaining separators and ignites engines that are now exposed.

function computeStages(parts, adj, controlId) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const isSep = (id) => byId.get(id).def.separator;
  const segOf = new Map();
  const segs = [];
  for (const p of parts) {
    if (p.def.separator || segOf.has(p.id)) continue;
    const comp = componentOf(p.id, adj, isSep);
    const idx = segs.length;
    segs.push({ ids: comp, depth: -1, below: [] });
    for (const id of comp) segOf.set(id, idx);
  }
  const root = segOf.get(controlId);
  if (root == null) return [];
  segs[root].depth = 0;
  const seps = [];
  const queue = [root];
  while (queue.length) {
    const si = queue.shift();
    for (const id of segs[si].ids) for (const n of adj.get(id)) {
      if (!isSep(n) || seps.find((s) => s.id === n)) continue;
      const sp = byId.get(n);
      for (const m of adj.get(n)) {
        if (isSep(m)) continue;
        const sj = segOf.get(m);
        if (sj === si || segs[sj].depth >= 0) continue;
        segs[sj].depth = segs[si].depth + 1;
        seps.push({ id: n, far: sj, near: si, depth: segs[sj].depth });
        // a vertical separator hanging under the near segment's engines blocks them until it fires
        if (!sp.def.side && [...segs[si].ids].some((i) => byId.get(i).def.thrust && sp.y < byId.get(i).y)) segs[si].below.push(sj);
        queue.push(sj);
      }
    }
  }
  const attachedSegs = segs.map((s, i) => i).filter((i) => segs[i].depth >= 0);
  const enginesIn = (si) => [...segs[si].ids].map((i) => byId.get(i)).filter((q) => q.def.thrust);
  const stages = [];
  const ignited = new Set();
  const dropped = new Set();
  const exposed = (si) => segs[si].below.every((sj) => dropped.has(sj));
  const igniteExposed = (list) => {
    for (const si of attachedSegs) {
      if (dropped.has(si) || !exposed(si)) continue;
      for (const e of enginesIn(si)) if (!ignited.has(e.id)) { ignited.add(e.id); list.push(e.id); }
    }
  };
  const first = [];
  igniteExposed(first);
  if (first.length) stages.push(first);
  const maxDepth = Math.max(0, ...seps.map((s) => s.depth));
  for (let d = maxDepth; d >= 1; d--) {
    const st = [];
    for (const s of seps) if (s.depth === d) {
      if (!st.includes(s.id)) st.push(s.id);
      // drop the far segment and everything beyond it
      const stack = [s.far];
      while (stack.length) {
        const k = stack.pop(); dropped.add(k);
        for (const t of seps) if (t.near === k) stack.push(t.far);
      }
    }
    igniteExposed(st);
    if (st.length) stages.push(st);
  }
  const chutes = parts.filter((p) => p.def.chute && segOf.get(p.id) != null && segs[segOf.get(p.id)].depth >= 0).map((p) => p.id);
  if (chutes.length) stages.push(chutes);
  return stages;
}

function describeStage(ids, byId) {
  const counts = {};
  for (const id of ids) {
    const p = byId.get(id); if (!p) continue;
    const verb = p.def.thrust ? 'Ignite ' + p.def.name : p.def.separator ? 'Separate' : p.def.chute ? 'Deploy parachute' : p.def.name;
    counts[verb] = (counts[verb] || 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => (n > 1 && !k.startsWith('Separate') ? `${k} ×${n}` : k)).join(' · ') || '—';
}

// Delta-v estimate (vacuum) by replaying the stage list.
function estimateDeltaV(parts, adj, controlId, stages, useSeaLevel) {
  if (!controlId) return { total: 0, perStage: [] };
  const P = parts.map((p) => ({ ...p, fuel: p.fuel }));
  const byId = new Map(P.map((p) => [p.id, p]));
  const A = new Map([...adj].map(([k, v]) => [k, new Set(v)]));
  let attached = componentOf(controlId, A);
  const active = new Set();
  const perStage = [];
  let total = 0;
  for (const st of stages) {
    for (const id of st) {
      const p = byId.get(id);
      if (!attached.has(id)) continue;
      if (p.def.thrust) active.add(id);
      if (p.def.separator) {
        cutSeparator(id, A, controlId);
        attached = componentOf(controlId, A);
      }
    }
    let dv = 0;
    for (let guard = 0; guard < 20; guard++) {
      const groups = fuelGroups([...attached].map((i) => byId.get(i)), A);
      let F = 0, mdot = 0;
      const burning = [];
      for (const g of groups) {
        const fuel = g.tanks.reduce((s, t) => s + t.fuel, 0);
        const eng = g.engines.filter((e) => active.has(e.id));
        if (fuel <= 1e-6 || !eng.length) continue;
        let gm = 0;
        for (const e of eng) {
          const isp = useSeaLevel ? e.def.ispSL : e.def.ispVac;
          F += e.def.thrust * 1000; gm += e.def.thrust * 1000 / (isp * G0);
        }
        mdot += gm; burning.push({ g, fuel, gm });
      }
      if (!burning.length) break;
      const tBurn = Math.min(...burning.map((b) => b.fuel / b.gm));
      const m0 = [...attached].reduce((s, i) => s + byId.get(i).def.mass * 1000 + byId.get(i).fuel, 0);
      const m1 = m0 - mdot * tBurn;
      dv += (F / mdot) * Math.log(m0 / m1);
      for (const b of burning) {
        const used = b.gm * tBurn;
        for (const t of b.g.tanks) t.fuel -= used * (t.fuel / b.fuel);
      }
    }
    perStage.push(dv);
    total += dv;
  }
  return { total, perStage };
}

// Fire a separator: cut its links on the control part's side, so it stays with the piece that falls away.
function cutSeparator(sepId, adj, controlId) {
  for (const n of [...adj.get(sepId)]) {
    adj.get(sepId).delete(n); adj.get(n).delete(sepId);
    if (!componentOf(controlId, adj).has(n)) { adj.get(sepId).add(n); adj.get(n).add(sepId); }
  }
}

// Fuel flows freely inside a segment; separators block it.
function fuelGroups(parts, adj) {
  const ids = new Set(parts.map((p) => p.id));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set();
  const groups = [];
  for (const p of parts) {
    if (seen.has(p.id) || p.def.separator) continue;
    const comp = componentOf(p.id, adj, (n) => !ids.has(n) || byId.get(n).def.separator);
    const g = { tanks: [], engines: [] };
    for (const id of comp) {
      seen.add(id);
      const q = byId.get(id);
      if (q.def.fuel) g.tanks.push(q);
      if (q.def.thrust) g.engines.push(q);
    }
    groups.push(g);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Drawing. Called with a transform where 1 unit = 1 metre and +y is up.

const PAL = {
  ink: '#1a1f27', steel: '#79828d', steelLight: '#c4cbd3', steelDark: '#4d545d',
  orange: '#ff7a1a', glass: '#7fd8ff', gold: '#d9a441', hazard: '#ffc93c', chuteA: '#ff7a1a', chuteB: '#f3f1ea',
};
const _gradCache = new WeakMap();
function hullGradient(ctx, l, r) {
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#9da6b0'); g.addColorStop(0.3, '#f5f7f9'); g.addColorStop(0.55, '#e6e9ed'); g.addColorStop(1, '#8e97a1');
  return g;
}
function metalGradient(ctx, l, r) {
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#3f454d'); g.addColorStop(0.35, '#b8c0c9'); g.addColorStop(0.6, '#8a939d'); g.addColorStop(1, '#353a41');
  return g;
}

function drawPart(ctx, p, lw) {
  const d = p.def, x = p.x, y = p.y, w = d.w, h = d.h;
  const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,11,16,0.9)';
  switch (d.shape) {
    case 'pod': {
      const tw = w * 0.42;
      ctx.beginPath(); ctx.moveTo(l, b); ctx.lineTo(r, b); ctx.lineTo(x + tw / 2, t); ctx.lineTo(x - tw / 2, t); ctx.closePath();
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, h * 0.09);
      ctx.fillStyle = PAL.orange; ctx.fillRect(x - tw / 2, t - h * 0.08, tw, h * 0.08);
      ctx.beginPath(); ctx.arc(x - w * 0.1, y + h * 0.02, w * 0.14, 0, TAU);
      ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l, b); ctx.lineTo(r, b); ctx.lineTo(x + tw / 2, t); ctx.lineTo(x - tw / 2, t); ctx.closePath(); ctx.stroke();
      break;
    }
    case 'probe': {
      const bh = h * 0.7;
      ctx.beginPath();
      const c = 0.18 * w;
      ctx.moveTo(l + c, b); ctx.lineTo(r - c, b); ctx.lineTo(r, b + c); ctx.lineTo(r, b + bh - c); ctx.lineTo(r - c, b + bh);
      ctx.lineTo(l + c, b + bh); ctx.lineTo(l, b + bh - c); ctx.lineTo(l, b + c); ctx.closePath();
      ctx.fillStyle = PAL.gold; ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - w * 0.22, b + bh * 0.3, w * 0.44, bh * 0.4);
      ctx.fillStyle = PAL.glass; ctx.fillRect(x - w * 0.1, b + bh * 0.42, w * 0.2, bh * 0.16);
      ctx.beginPath(); ctx.moveTo(x + w * 0.2, b + bh); ctx.lineTo(x + w * 0.2, t - 0.04);
      ctx.lineWidth = lw * 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x + w * 0.2, t - 0.06, 0.06, 0, TAU); ctx.fillStyle = PAL.orange; ctx.fill();
      break;
    }
    case 'tank': {
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h);
      const band = Math.min(0.16, h * 0.12);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, band); ctx.fillRect(l, t - band, w, band);
      if (h >= 2) {
        ctx.fillStyle = 'rgba(255,122,26,0.95)';
        ctx.fillRect(l + w * 0.14, b + band, Math.min(0.18, w * 0.09), h - band * 2);
      }
      if (h >= 3) {
        ctx.strokeStyle = 'rgba(20,26,34,0.35)';
        for (let yy = b + 2; yy < t - 0.5; yy += 2) { ctx.beginPath(); ctx.moveTo(l, yy); ctx.lineTo(r, yy); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      }
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'engine': {
      const mh = h * d.mount;
      ctx.fillStyle = metalGradient(ctx, l + w * 0.12, r - w * 0.12);
      ctx.fillRect(l + w * 0.12, t - mh, w * 0.76, mh);
      ctx.strokeRect(l + w * 0.12, t - mh, w * 0.76, mh);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l + w * 0.12, t - mh * 0.35, w * 0.76, mh * 0.12);
      const tw = w * d.bellTop / 2, bw = w * d.bellBot / 2, yt = t - mh;
      ctx.beginPath();
      ctx.moveTo(x - tw, yt);
      ctx.bezierCurveTo(x - tw, yt - (yt - b) * 0.45, x - bw * 0.95, b + (yt - b) * 0.2, x - bw, b);
      ctx.lineTo(x + bw, b);
      ctx.bezierCurveTo(x + bw * 0.95, b + (yt - b) * 0.2, x + tw, yt - (yt - b) * 0.45, x + tw, yt);
      ctx.closePath();
      ctx.fillStyle = metalGradient(ctx, x - bw, x + bw); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(10,12,16,0.6)'; ctx.fillRect(x - bw, b, bw * 2, Math.min(0.1, h * 0.05));
      if (p.active && p.flameout) { ctx.fillStyle = 'rgba(255,93,93,0.5)'; ctx.fillRect(x - bw, b, bw * 2, 0.08); }
      break;
    }
    case 'sep': {
      ctx.save();
      ctx.beginPath(); ctx.rect(l, b, w, h); ctx.clip();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, h);
      ctx.fillStyle = PAL.hazard;
      const s = 0.28, span = w + h;
      for (let k = -span; k < span; k += s * 2) {
        ctx.beginPath();
        ctx.moveTo(l + k, b); ctx.lineTo(l + k + s, b); ctx.lineTo(l + k + s + h, t); ctx.lineTo(l + k + h, t); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'nose': {
      ctx.beginPath(); ctx.moveTo(l, b);
      ctx.bezierCurveTo(l, b + h * 0.6, x - w * 0.18, t, x, t);
      ctx.bezierCurveTo(x + w * 0.18, t, r, b + h * 0.6, r, b);
      ctx.closePath();
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.orange; ctx.fillRect(l, t - h * 0.22, w, h * 0.22);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.1); ctx.restore();
      ctx.beginPath(); ctx.moveTo(l, b);
      ctx.bezierCurveTo(l, b + h * 0.6, x - w * 0.18, t, x, t);
      ctx.bezierCurveTo(x + w * 0.18, t, r, b + h * 0.6, r, b);
      ctx.closePath(); ctx.stroke();
      break;
    }
    case 'chute': {
      if (p.used) { ctx.fillStyle = PAL.steelDark; ctx.fillRect(l + w * 0.1, b, w * 0.8, h * 0.4); ctx.strokeRect(l + w * 0.1, b, w * 0.8, h * 0.4); break; }
      ctx.fillStyle = PAL.steelLight; ctx.fillRect(l + w * 0.1, b, w * 0.8, h * 0.4);
      ctx.beginPath(); ctx.moveTo(l + w * 0.1, b + h * 0.4);
      ctx.quadraticCurveTo(x, t + h * 0.4, r - w * 0.1, b + h * 0.4); ctx.closePath();
      ctx.fillStyle = p.deployed > 0 ? PAL.steel : PAL.orange; ctx.fill(); ctx.stroke();
      ctx.strokeRect(l + w * 0.1, b, w * 0.8, h * 0.4);
      break;
    }
    case 'leg': {
      const s = p.flip ? -1 : 1;
      const inner = x - s * w / 2, outer = x + s * w / 2;
      ctx.fillStyle = PAL.steelDark;
      ctx.fillRect(Math.min(inner, inner + s * 0.18), t - 0.9, 0.18, 0.9);
      ctx.strokeStyle = PAL.steelLight; ctx.lineCap = 'round';
      ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(inner + s * 0.09, t - 0.15); ctx.lineTo(outer - s * 0.12, b + 0.16); ctx.stroke();
      ctx.lineWidth = 0.08; ctx.strokeStyle = PAL.steel;
      ctx.beginPath(); ctx.moveTo(inner + s * 0.09, t - 0.85); ctx.lineTo(outer - s * 0.16, b + 0.5); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.min(outer, outer - s * 0.48), b, 0.48, 0.12);
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      break;
    }
  }
}

// Canopy for an opened parachute, drawn in part space.
function drawCanopy(ctx, p, lw) {
  const k = p.deployed;
  if (k <= 0 || p.used) return;
  const x = p.x, base = p.y + p.def.h / 2;
  const cw = 2.5 + 6.5 * k, ch = 3 + 6 * k;
  const top = base + ch;
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(230,230,230,0.7)';
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(x, base); ctx.lineTo(x + (i / 2) * cw / 2, top - ch * 0.12); }
  ctx.stroke();
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = Math.PI - (i / segs) * Math.PI, a1 = Math.PI - ((i + 1) / segs) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, top - ch * 0.12);
    ctx.ellipse(x, top - ch * 0.12, cw / 2, ch * 0.42, 0, -a0, -a1, false);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? PAL.chuteB : PAL.chuteA;
    ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(x, top - ch * 0.12, cw / 2, ch * 0.42, 0, Math.PI, TAU); ctx.strokeStyle = 'rgba(8,11,16,0.6)'; ctx.stroke();
}

// Render a part onto a small canvas for the palette.
function renderPartIcon(type, size, dpr) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d');
  const def = PARTS[type];
  const s = (size * dpr * 0.78) / Math.max(def.w, def.h, 1.2);
  ctx.setTransform(s, 0, 0, -s, c.width / 2, c.height / 2);
  const p = { def, type, x: 0, y: 0, flip: false, deployed: 0 };
  drawPart(ctx, p, 1.4 / s * dpr);
  return c;
}
