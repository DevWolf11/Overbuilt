'use strict';
// Multiplayer networking: rooms joined by a short code. The game has no server, so the host's browser is the
// room: everyone connects to the host and the host passes messages on (a star). Two ways to connect:
//  - 'p2p': WebRTC data channels through PeerJS (js/vendor/peer.min.js). Its free cloud server only
//    introduces the browsers to each other; STUN, and TURN relays for strict networks, come with it.
//  - 'local': tabs of the same browser on this device, through a BroadcastChannel (offline, and handy for testing).
// Messages are small plain objects { t: type, ... }. Net stamps the sender's player id on them as `f`.

const NET_VERSION = 1;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'rss-room-';

const Net = (() => {
  const handlers = new Map();
  const N = {
    active: false, isHost: false, me: 0, code: '', transport: 'p2p', name: '',
    maxPlayers: 6, locked: false, lockReason: '',
    names: new Map(),     // pid -> name (everyone, kept by the host and sent round in `state`)
    pings: new Map(),     // pid -> round trip (ms), on the host
    hostOffset: 0,        // host clock minus ours (ms)
    bytesIn: 0, bytesOut: 0,
  };
  const HOST_ONLY = new Set(['hello', 'welcome', 'reject', 'ping', 'closed', 'join', 'leave', 'warn', 'state', 'result']);
  let joinGen = 0;
  let peer = null, chan = null, link = null, cid = '', nextPid = 2, pingTimer = 0, watchTimer = 0, lastHeard = 0;
  const links = new Map(); // host: pid -> { send, close, heard }
  const offsets = [];

  // ---------------------------------------------------------------- events
  N.on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type).delete(fn); };
  N.off = (type, fn) => { if (handlers.has(type)) handlers.get(type).delete(fn); };
  function emit(msg) {
    const hs = handlers.get(msg.t);
    if (!hs) return;
    for (const fn of [...hs]) { try { fn(msg); } catch (e) { console.error('Net handler', msg.t, e); } }
  }

  // ---------------------------------------------------------------- helpers
  N.hostNow = () => performance.now() + N.hostOffset;
  N.makeCode = () => { let s = ''; for (let i = 0; i < 5; i++) s += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]; return s; };
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const size = (m) => { try { return JSON.stringify(m).length; } catch (e) { return 0; } };
  N.players = () => [...N.names.keys()].sort((a, b) => a - b);

  // ---------------------------------------------------------------- sending
  // to: a player id, or nothing for everyone else. Clients send through the host, which passes it on.
  N.send = (msg, to) => {
    if (!N.active) return;
    msg.f = N.me;
    if (to != null) msg.to = to; else delete msg.to;
    if (N.isHost) route(msg, N.me);
    else if (link) { N.bytesOut += size(msg); link.send(msg); }
  };
  // host: deliver a message from `from` (or the host itself) to its addressees
  function route(msg, from) {
    if (msg.to != null) {
      if (msg.to === N.me) { if (from !== N.me) emit(msg); return; }
      const l = links.get(msg.to);
      if (l) { N.bytesOut += size(msg); l.send(msg); }
      return;
    }
    for (const [pid, l] of links) if (pid !== from) { N.bytesOut += size(msg); l.send(msg); }
    if (from !== N.me) emit(msg);
  }

  // ---------------------------------------------------------------- host
  N.host = ({ transport = 'p2p', name = 'Pilot', maxPlayers = 6 } = {}) => new Promise((resolve, reject) => {
    N.leave();
    joinGen++; // (any join still pending is stale now)
    Object.assign(N, { transport, name, maxPlayers, isHost: true, me: 1, locked: false, hostOffset: 0, bytesIn: 0, bytesOut: 0 });
    N.names = new Map([[1, name]]); N.pings = new Map([[1, 0]]);
    nextPid = 2;
    let tries = 0;
    const open = (code) => {
      N.code = code;
      if (transport === 'local') {
        chan = new BroadcastChannel(PEER_PREFIX + code);
        chan.onmessage = (e) => hostLocal(e.data);
        // nobody else answers to this room code? (a second tab already hosting it would)
        start(); resolve(code);
        return;
      }
      if (typeof Peer === 'undefined') { reject(new Error('Online play isn’t available (the networking library didn’t load)')); return; }
      peer = new Peer(PEER_PREFIX + code, { debug: 0 });
      peer.on('open', () => { start(); resolve(code); });
      peer.on('connection', (conn) => hostConn(conn));
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && ++tries < 4) { peer.destroy(); open(N.makeCode()); return; }
        if (!N.active) { reject(new Error(netError(e))); return; }
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') emit({ t: 'warn', text: 'Lost the connection to the matchmaking server: players already in the room stay connected' });
      });
      peer.on('disconnected', () => { if (N.active && peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (err) { /* gone */ } }, 1500); });
    };
    open(N.makeCode());
  });
  function start() {
    N.active = true;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      const now = performance.now();
      for (const [pid, l] of links) {
        if (now - l.heard > 20000) { dropPlayer(pid, 'timed out'); continue; } // (a phone can stall for seconds loading a flight)
        l.send({ t: 'ping', f: 1, ts: now, rtt: N.pings.get(pid) || 0 });
      }
    }, 2000);
  }
  // a new client: assign it an id once it says hello
  function accept(hello, sendFn, closeFn) {
    if (hello.ver !== NET_VERSION) { sendFn({ t: 'reject', reason: 'Different game versions: reload the page on both devices' }); return 0; }
    if (N.locked) { sendFn({ t: 'reject', reason: N.lockReason || 'The match has already started' }); return 0; }
    if (N.names.size >= N.maxPlayers) { sendFn({ t: 'reject', reason: `The room is full (${N.maxPlayers} players)` }); return 0; }
    const pid = nextPid++;
    const nm = String(hello.name || 'Pilot').slice(0, 18) || 'Pilot';
    links.set(pid, { send: sendFn, close: closeFn, heard: performance.now() });
    N.names.set(pid, nm); N.pings.set(pid, 0);
    sendFn({ t: 'welcome', f: 1, pid, code: N.code, names: [...N.names] });
    emit({ t: 'join', f: pid, pid, name: nm });
    return pid;
  }
  function fromClient(pid, msg) {
    const l = links.get(pid);
    if (!l || !msg || typeof msg.t !== 'string') return;
    l.heard = performance.now();
    N.bytesIn += size(msg);
    msg.f = pid; // never trust the sender's own claim
    if (msg.t === 'pong') { N.pings.set(pid, Math.round(performance.now() - msg.ts)); return; }
    if (msg.t === 'bye') { dropPlayer(pid, 'left'); return; }
    if (HOST_ONLY.has(msg.t)) return; // (a client can't close the room, add or remove players, or set the clock)
    route(msg, pid);
  }
  function dropPlayer(pid, why) {
    const l = links.get(pid);
    if (!l) return;
    links.delete(pid);
    try { l.close(); } catch (e) { /* already closed */ }
    N.names.delete(pid); N.pings.delete(pid);
    emit({ t: 'leave', f: pid, pid, why });
  }
  N.kick = (pid, reason = 'Removed by the host') => {
    const l = links.get(pid);
    if (l) l.send({ t: 'closed', f: 1, reason });
    dropPlayer(pid, 'kicked');
  };
  function hostConn(conn) {
    let pid = 0;
    conn.on('data', (msg) => {
      if (!pid) { if (msg && msg.t === 'hello') pid = accept(msg, (m) => conn.send(m), () => conn.close()); if (!pid) setTimeout(() => conn.close(), 500); return; }
      fromClient(pid, msg);
    });
    conn.on('close', () => { if (pid) dropPlayer(pid, 'left'); });
    conn.on('error', () => { if (pid) dropPlayer(pid, 'connection error'); });
  }
  const localPids = new Map(); // client channel id -> pid
  function hostLocal(env) {
    if (!env || env.to !== 'H' || !env.msg) return;
    let pid = localPids.get(env.from);
    if (!pid) {
      if (env.msg.t !== 'hello') return;
      const to = env.from, post = (m) => chan && chan.postMessage({ to, msg: m });
      pid = accept(env.msg, post, () => { localPids.delete(to); });
      if (pid) localPids.set(to, pid);
      return;
    }
    fromClient(pid, env.msg);
  }

  // ---------------------------------------------------------------- client
  N.join = (code, { transport = 'p2p', name = 'Pilot' } = {}) => new Promise((resolve, reject) => {
    N.leave();
    code = cleanCode(code);
    if (code.length < 4) { reject(new Error('Enter the room code')); return; }
    Object.assign(N, { transport, name, isHost: false, me: 0, code, hostOffset: 0, bytesIn: 0, bytesOut: 0 });
    N.names = new Map();
    let done = false;
    const gen = ++joinGen; // (a later join or host makes this attempt stale: it must not tear that one down)
    const fail = (text) => { if (done) return; done = true; if (gen === joinGen) N.leave(); reject(new Error(text)); };
    const timer = setTimeout(() => fail(transport === 'local' ? 'No room with that code is open in another tab' : 'Couldn’t reach the room: check the code and that the host is still in the lobby'), 15000);
    const onMsg = (msg) => {
      if (!msg || typeof msg.t !== 'string') return;
      N.bytesIn += size(msg);
      lastHeard = performance.now();
      if (!done) {
        if (msg.t === 'reject') { clearTimeout(timer); fail(msg.reason || 'The host turned the request down'); return; }
        if (msg.t !== 'welcome') return;
        done = true; clearTimeout(timer);
        N.me = msg.pid; N.names = new Map(msg.names); N.active = true;
        watch();
        resolve(msg.pid);
        return;
      }
      if (HOST_ONLY.has(msg.t) && msg.f !== 1) return; // (only the host closes the room or sets the clock)
      if (msg.t === 'ping') {
        link.send({ t: 'pong', ts: msg.ts });
        if (msg.rtt > 0) { // host clock now = ts + about half a round trip
          offsets.push(msg.ts + msg.rtt / 2 - performance.now());
          if (offsets.length > 7) offsets.shift();
          const s = [...offsets].sort((a, b) => a - b);
          N.hostOffset = s[Math.floor(s.length / 2)];
        }
        return;
      }
      if (msg.t === 'closed') { closeAll(msg.reason || 'The room closed'); return; }
      emit(msg);
    };
    const hello = { t: 'hello', name, ver: NET_VERSION };
    if (transport === 'local') {
      cid = 'c' + Math.random().toString(36).slice(2, 10);
      chan = new BroadcastChannel(PEER_PREFIX + code);
      chan.onmessage = (e) => { const env = e.data; if (env && env.to === cid) onMsg(env.msg); };
      link = { send: (m) => chan && chan.postMessage({ to: 'H', from: cid, msg: m }), close: () => {} };
      link.send(hello);
      return;
    }
    if (typeof Peer === 'undefined') { clearTimeout(timer); fail('Online play isn’t available (the networking library didn’t load)'); return; }
    peer = new Peer({ debug: 0 });
    peer.on('error', (e) => {
      if (!done) { clearTimeout(timer); fail(e.type === 'peer-unavailable' ? 'No room with that code: check it, or ask the host to create the room again' : netError(e)); return; }
      if (e.type === 'peer-unavailable') closeAll('Lost the connection to the host');
      else emit({ t: 'warn', text: 'Lost the connection to the matchmaking server: the room carries on' }); // (the link to the host is separate)
    });
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      link = { send: (m) => { try { conn.send(m); } catch (e) { /* closing */ } }, close: () => conn.close() };
      conn.on('open', () => conn.send(hello));
      conn.on('data', onMsg);
      conn.on('close', () => { if (done) closeAll('The host left the room'); });
      conn.on('error', () => { if (done) closeAll('Lost the connection to the host'); });
    });
  });
  // the host has gone quiet for too long: give up
  function watch() {
    lastHeard = performance.now();
    clearInterval(watchTimer);
    watchTimer = setInterval(() => { if (N.active && !N.isHost && performance.now() - lastHeard > 25000) closeAll('Lost the connection to the host'); }, 2000);
  }
  function closeAll(reason) {
    if (!N.active) return;
    N.leave(true);
    emit({ t: 'closed', reason });
  }

  // ---------------------------------------------------------------- leaving
  N.leave = (quiet) => {
    const was = N.active;
    if (was && !quiet) {
      if (N.isHost) for (const [, l] of links) { try { l.send({ t: 'closed', f: 1, reason: 'The host closed the room' }); } catch (e) { /* gone */ } }
      else if (link) { try { link.send({ t: 'bye' }); } catch (e) { /* gone */ } }
    }
    N.active = false;
    clearInterval(pingTimer); clearInterval(watchTimer);
    for (const [, l] of links) { try { l.close(); } catch (e) { /* gone */ } }
    links.clear(); localPids.clear();
    if (link) { try { link.close(); } catch (e) { /* gone */ } }
    link = null;
    // let the goodbyes go out before the connections drop
    const p = peer, c = chan;
    peer = null; chan = null;
    setTimeout(() => { try { if (p) p.destroy(); } catch (e) { /* gone */ } try { if (c) c.close(); } catch (e) { /* gone */ } }, was ? 300 : 0);
    N.isHost = false; N.me = 0; N.code = ''; N.locked = false;
    offsets.length = 0;
  };
  N.lock = (on, reason) => { N.locked = !!on; N.lockReason = reason || ''; };

  function netError(e) {
    switch (e && e.type) {
      case 'browser-incompatible': return 'This browser can’t do peer-to-peer connections';
      case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Couldn’t reach the matchmaking server: check the internet connection';
      case 'unavailable-id': return 'That room code is taken: try again';
      default: return (e && e.message) || 'Connection failed';
    }
  }
  addEventListener('pagehide', () => { if (N.active) N.leave(); });
  return N;
})();
