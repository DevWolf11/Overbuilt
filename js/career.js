'use strict';
// Career and sandbox modes: funds, part costs, tech tiers and missions.

const MISSIONS = (() => {
  const list = [
    { id: 'alt1k', title: 'First Hop', desc: 'Climb to 1 km.', reward: 6000, flag: 'alt1k' },
    { id: 'space', title: 'Edge of Space', desc: 'Get above Earth’s 30 km atmosphere.', reward: 15000, flag: 'space' },
    { id: 'recoverSpace', title: 'Safe Return', desc: 'Recover a craft on Earth after it reached space.', reward: 12000, flag: 'recoveredSpace' },
    { id: 'orbitEarth', title: 'Into Orbit', desc: 'Reach a stable orbit around Earth.', reward: 30000, flag: 'orbit:earth' },
    { id: 'splash', title: 'Splashdown', desc: 'Land in an ocean and recover the craft.', reward: 8000, flag: 'splashdown' },
  ];
  const tier = { moon: 1, venus: 2, mars: 2, mercury: 3, phobos: 3, jupiter: 4, europa: 5 };
  for (const b of [MOON, VENUS, MARS, MERCURY, PHOBOS, JUPITER, EUROPA]) {
    const d = tier[b.id];
    list.push({ id: `soi:${b.id}`, title: `${b.name} Flyby`, desc: `Enter ${b.name}’s sphere of influence.`, reward: 22000 * d, flag: `soi:${b.id}`, body: b });
    list.push({ id: `orbit:${b.id}`, title: `${b.name} Orbit`, desc: `Reach a stable orbit around ${b.name}.`, reward: 30000 * d, flag: `orbit:${b.id}`, body: b });
    if (b !== JUPITER) {
      list.push({ id: `land:${b.id}`, title: `${b.name} Landing`, desc: `Touch down on ${b.name} in one piece.`, reward: 55000 * d, flag: `land:${b.id}`, body: b });
      list.push({ id: `home:${b.id}`, title: `Return from ${b.name}`, desc: `Land on ${b.name}, then recover the craft on Earth.`, reward: 80000 * d, flag: `home:${b.id}`, body: b });
    }
  }
  list.push({ id: 'escapeSun', title: 'Interstellar', desc: 'Reach escape velocity from the Sun.', reward: 60000, flag: 'escapeSun' });
  list.push({ id: 'sunDive', title: 'Icarus', desc: 'Pass within 3,000 km of the Sun’s surface.', reward: 90000, flag: 'sunDive' });
  return list;
})();

const Career = {
  data: null,
  load() {
    this.data = Object.assign({ mode: null, funds: 50000, tier: 0, done: {}, flights: 0 }, store.get('rss.career', {}));
    return this;
  },
  save() { store.set('rss.career', this.data); },
  get mode() { return this.data.mode; },
  get sandbox() { return this.data.mode !== 'career'; },
  setMode(m) { this.data.mode = m; this.save(); },
  reset() { const mode = this.data.mode; this.data = { mode, funds: 50000, tier: 0, done: {}, flights: 0 }; this.save(); },

  unlocked(def) { return this.sandbox || def.tier <= this.data.tier; },
  canAfford(cost) { return this.sandbox || this.data.funds >= cost; },
  spend(cost) { if (!this.sandbox) { this.data.funds -= cost; this.save(); } },
  earn(amount) { if (!this.sandbox && amount > 0) { this.data.funds += Math.round(amount); this.save(); } },
  nextTier() { return TIERS[this.data.tier + 1] || null; },
  buyTier() {
    const t = this.nextTier();
    if (!t || this.data.funds < t.cost) return false;
    this.data.funds -= t.cost; this.data.tier++; this.save();
    return true;
  },
  isDone(id) { return !!this.data.done[id]; },

  // Called whenever a flight flag is raised; returns missions completed by it.
  onFlag(flag) {
    const out = [];
    for (const m of MISSIONS) {
      if (m.flag !== flag || this.data.done[m.id]) continue;
      this.data.done[m.id] = Date.now();
      if (!this.sandbox) this.data.funds += m.reward;
      out.push(m);
    }
    if (out.length) this.save();
    return out;
  },
  progress() {
    const done = MISSIONS.filter((m) => this.data.done[m.id]).length;
    return { done, total: MISSIONS.length };
  },
};
Career.load();

function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
