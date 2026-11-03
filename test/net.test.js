// Net (net.js) against a fake PeerJS and a fake clock: what a room hears when the matchmaking server drops.
//  - The host loses the server and it stays out of reach for 10 minutes: one warning, not one every couple of seconds
//    (the notice that never went away), tries again 2, 4, 8, 16 s apart, then every 30 s; the room and its links
//    carry on (no new code, nothing destroyed); Net.offline says joining is paused.
//  - The server comes back: one note saying so, and Net.offline is false again.
//  - A link that keeps dropping: told at most every 5 minutes (a drop and its return), nothing for the drops between.
//  - "That ID is taken" while the room is live doesn't start the room over under a new code.
//  - A player in the room hears nothing of their own matchmaking server going, and doesn't leave when the server says
//    the host isn't on it (as when the host's own link to it drops): the direct link to the host decides.
//   node test/net.test.js   (ROOT=<checkout> to run it against another one)
const vm = require('vm'), fs = require('fs'), path = require('path');
const G = require('./lib/game.js');
const t = G.checks('net: the matchmaking server lost and found');

function room() {
  let now = 0, seq = 0;
  const timers = new Map();
  const later = (f, ms, every) => { const id = ++seq; timers.set(id, { f, at: now + Math.max(0, ms || 0), every: every ? Math.max(1, ms || 0) : 0 }); return id; };
  const stop = (id) => timers.delete(id);
  const peers = [];
  class Peer { // the parts of PeerJS 1.5 net.js uses, behaving as it does when its socket to the server drops
    constructor(id) { this.id = typeof id === 'string' ? id : 'p' + peers.length; this.h = {}; this.disconnected = false; this.destroyed = false; this.open = false; this.reconnects = []; this.conns = []; peers.push(this); later(() => this.up(), 10); }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    fire(e, ...a) { for (const f of this.h[e] || []) f(...a); }
    up() { if (this.destroyed) return; this.open = true; this.disconnected = false; this.fire('open', this.id); }
    // the socket closed: PeerJS says 'network' ("Lost connection to server."), then disconnects
    drop(type = 'network') { this.open = false; this.fire('error', { type }); if (!this.disconnected) { this.disconnected = true; this.fire('disconnected', this.id); } }
    reconnect() {
      if (this.destroyed) throw Error('destroyed');
      if (!this.disconnected) throw Error('not disconnected');
      this.disconnected = false; this.reconnects.push(now);
      const ok = Peer.serverUp(now);
      later(() => (ok ? this.up() : this.drop()), 300); // (a try takes a moment to fail or get through)
    }
    destroy() { this.destroyed = true; this.open = false; }
    connect() { const c = new Conn(); this.conns.push(c); return c; }
  }
  Peer.serverUp = () => true;
  class Conn { constructor() { this.h = {}; this.sent = []; this.open = true; } on(e, f) { (this.h[e] = this.h[e] || []).push(f); } fire(e, ...a) { for (const f of this.h[e] || []) f(...a); } send(m) { this.sent.push(m); } close() { this.open = false; } }
  const ctx = {
    console, Math, JSON, Promise, Peer, performance: { now: () => now },
    setTimeout: (f, ms) => later(f, ms), clearTimeout: stop, setInterval: (f, ms) => later(f, ms, true), clearInterval: stop,
    addEventListener() {}, document: { addEventListener() {}, hidden: false },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(G.ROOT, 'js', 'net.js'), 'utf8') + '\nthis.Net = Net; this.NET_VERSION = NET_VERSION;', ctx, { filename: 'net.js' });
  // run the clock on to `until`, firing what falls due in order (and letting promises settle between)
  const run = async (ms) => {
    const until = now + ms;
    for (;;) {
      await new Promise((r) => setImmediate(r));
      let next = null;
      for (const [id, x] of timers) if (x.at <= until && (!next || x.at < next[1].at)) next = [id, x];
      if (!next) break;
      const [id, x] = next;
      now = Math.max(now, x.at);
      if (x.every) x.at = now + x.every; else timers.delete(id);
      x.f();
    }
    now = until;
  };
  return { ctx, Net: ctx.Net, peers, Peer, Conn, run, now: () => now };
}

(async () => {
  // ---- the host
  {
    const R = room(), N = R.Net, warns = [];
    N.on('warn', (m) => warns.push({ at: R.now(), ok: !!m.ok, text: m.text }));
    const hosting = N.host({ transport: 'p2p', name: 'Host', maxPlayers: 5 });
    await R.run(100);
    const code = await hosting, p = R.peers[0];
    t('the room opens on the matchmaking server', N.active && N.isHost && p && p.open && !N.offline, { code });
    // the server goes, and stays out of reach for 10 minutes
    R.Peer.serverUp = () => false;
    const t0 = R.now();
    p.drop();
    await R.run(10 * 60000);
    const lost = warns.filter((w) => !w.ok);
    t('10 minutes off the server: one warning (it used to come again every couple of seconds)', lost.length === 1 && /no one new can join/.test(lost[0].text), { warnings: lost.length, first: lost[0] && lost[0].text });
    const gaps = p.reconnects.map((x, i) => Math.round(((i ? x - p.reconnects[i - 1] : x - t0)) / 100) / 10);
    // (each gap: the wait, plus the 0.3 s the try before it took to fail)
    t('...it tries again 2, 4, 8, 16 s apart, then every 30 s', gaps.length >= 20 && gaps[0] === 2 && gaps[1] === 4.3 && gaps[2] === 8.3 && gaps[3] === 16.3 && gaps.slice(4).every((g) => g === 30.3), { tries: gaps.length, gaps: gaps.slice(0, 7) });
    t('...the room carries on: same code, its peer never destroyed, Net.offline says joining is paused', N.active && N.code === code && !p.destroyed && R.peers.length === 1 && N.offline === true);
    // it comes back
    R.Peer.serverUp = () => true;
    await R.run(31000);
    const back = warns.filter((w) => w.ok);
    t('the server back: one note saying so, and Net.offline is false', back.length === 1 && /friends can join again/.test(back[0].text) && N.offline === false && p.open, { back: back.map((w) => w.text) });
    // flapping: it drops again within the minute, comes back, drops again...
    const before = warns.length;
    const triesBefore = p.reconnects.length, burstAt = R.now();
    for (let i = 0; i < 6; i++) { p.drop(); await R.run(5000); }
    await R.run(60000);
    const burst = warns.slice(before);
    t('a link that keeps dropping (6 drops in 30 s): told of the first and of its return, then nothing', burst.length === 2 && !burst[0].ok && burst[1].ok && N.offline === false, { notices: burst.map((w) => w.text) });
    const burstTries = p.reconnects.slice(triesBefore).map((x) => (x - burstAt) / 1000);
    t('...and as it had held under a minute, one try, after the full 30 s (no quick-fire tries at a flapping server)', burstTries.length === 1 && burstTries[0] >= 30, { tries: burstTries });
    await R.run(2 * 60000);
    p.drop(); await R.run(5000);
    t('...nor of a drop 2 minutes on (5 minutes between notices)', warns.length === before + 2, { notices: warns.slice(before + 2).map((w) => w.text) });
    await R.run(3 * 60000);
    p.drop(); await R.run(5000);
    t('...a drop 5 minutes on is told again, and its return', warns.length === before + 4 && !warns[before + 2].ok && warns[before + 3].ok, { notices: warns.slice(before + 2).map((w) => w.text) });
    // "That ID is taken" while the room is live (a reconnect the server refused)
    R.Peer.serverUp = () => false;
    p.drop('unavailable-id');
    await R.run(60000);
    t('"ID taken" while live: the room isn’t started over under a new code, nothing destroyed', N.active && N.code === code && R.peers.length === 1 && !p.destroyed && N.offline === true, { peers: R.peers.length, code: N.code });
    N.leave();
    await R.run(60000);
    const tries = p.reconnects.length;
    await R.run(5 * 60000);
    t('leaving the room stops the tries', p.reconnects.length === tries && N.offline === false);
  }
  // ---- a reconnect still on its way when the host leaves; an error with no disconnect
  {
    const R = room(), N = R.Net, warns = [];
    N.on('warn', (m) => warns.push(m));
    const hosting = N.host({ transport: 'p2p', name: 'Host', maxPlayers: 5 });
    await R.run(100); await hosting;
    const p = R.peers[0];
    p.drop(); await R.run(2100); // (the try goes at 2 s and gets through 0.3 s later)
    const trying = p.reconnects.length;
    N.leave(); await R.run(5000);
    t('the host leaves while a reconnect is on its way: its late "open" doesn’t bring the room back', trying === 1 && !N.active && !N.isHost && !N.code, { trying, active: N.active });
    const R2 = room(), N2 = R2.Net, w2 = [];
    N2.on('warn', (m) => w2.push(m));
    const h2 = N2.host({ transport: 'p2p', name: 'Host', maxPlayers: 5 });
    await R2.run(100); await h2;
    R2.peers[0].fire('error', { type: 'socket-error' }); // (PeerJS always disconnects too; if it ever didn't, joining mustn't stay paused)
    await R2.run(3000);
    t('an error with no disconnect after it: joining isn’t left paused (the try finds the link open)', N2.offline === false && w2.length === 2 && w2[1].ok, w2.map((m) => m.text));
  }
  // ---- a player in the room
  {
    const R = room(), N = R.Net, warns = [], closed = [];
    N.on('warn', (m) => warns.push(m.text)); N.on('closed', (m) => closed.push(m.reason));
    const joining = N.join('ABCDE', { transport: 'p2p', name: 'Pilot' });
    await R.run(100);
    const p = R.peers[0], c = p && p.conns[0];
    c.fire('open'); c.fire('data', { t: 'welcome', f: 1, pid: 2, code: 'ABCDE', names: [[1, 'Host'], [2, 'Pilot']] });
    await R.run(10);
    const pid = await joining;
    t('a player joins (the fake host lets them in)', N.active && !N.isHost && pid === 2);
    for (let i = 0; i < 5; i++) { c.fire('data', { t: 'ping', f: 1, ts: R.now(), rtt: 0 }); p.drop(); await R.run(2000); }
    p.fire('error', { type: 'peer-unavailable' });
    for (let i = 0; i < 10; i++) { c.fire('data', { t: 'ping', f: 1, ts: R.now(), rtt: 0 }); await R.run(2000); }
    t('their matchmaking server dropping 5 times: no notice, still in the room', !warns.length && N.active && !closed.length, { warns, closed });
    t('...nor does the server saying the host isn’t on it (the host’s own link to it dropped) put them out', N.active && !closed.length);
    await R.run(30000);
    t('the host silent 25 s (gone for real): out of the room, told once', !N.active && closed.length === 1 && /Lost the connection to the host/.test(closed[0]), { closed });
  }
  t.done();
})();
