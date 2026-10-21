'use strict';
// Multiplayer networking: rooms joined by a short code. The game has no server, so the host's browser is the
// room: everyone connects to the host and the host passes messages on (a star). Two ways to connect:
//  - 'p2p': WebRTC data channels through PeerJS (js/vendor/peer.min.js). Its free cloud server only
//    introduces the browsers to each other. STUN finds a direct path between them; when there is none (some
//    routers, mobile networks, VPNs, school networks) a TURN relay carries the link, over port 443 if need be.
//    PeerJS's own relays are gone (their names no longer resolve), so the game brings its own (N.ice).
//  - 'local': tabs of the same browser on this device, through a BroadcastChannel (offline, and handy for testing).
// Messages are small plain objects { t: type, ... }. Net stamps the sender's player id on them as `f`.

const NET_VERSION = 3; // 2: parts have a depth, paint and a host in spawns (an older peer would see, and shoot at, a different craft); 3: big messages travel in pieces
const NET_MAX_BYTES = 256 * 1024; // the biggest message the host passes on
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'rss-room-';
// Relays (TURN) for when two devices can't reach each other directly (a school network that blocks UDP, say).
// Either list a relay account's servers in NET_TURN, e.g.
//   { urls: ['turn:relay.example.com:80', 'turns:relay.example.com:443?transport=tcp'], username: '…', credential: '…' }
// (the TCP/TLS one on port 443 is what gets through strict networks), or set NET_TURN_URL to the account's
// credentials address, which answers with such a list (Metered: https://APP.metered.live/api/v1/turn/credentials?apiKey=KEY).
// Without a relay, players with no direct path between them can't connect.
const NET_TURN = [];
const NET_TURN_URL = '';
const NET_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
const NET_PIECE = 4000; // characters of JSON per piece: PeerJS's JSON channel refuses a message of 16300 bytes or more

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
  const HOST_ONLY = new Set(['~', 'hello', 'welcome', 'reject', 'ping', 'closed', 'join', 'leave', 'warn', 'state', 'result']);
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
  // The ICE servers for a connection: STUN, then the relays (NET_TURN, and those fetched from NET_TURN_URL once
  // a session; a fetch that fails or takes over 4 s is tried again next time, and play goes on without it).
  const iceOk = (x) => x && typeof x === 'object' && [].concat(x.urls).every((u) => typeof u === 'string' && /^(stuns?|turns?):/.test(u))
    && (x.username == null || typeof x.username === 'string') && (x.credential == null || typeof x.credential === 'string');
  let relays = null;
  N.ice = () => {
    if (!relays) {
      relays = !NET_TURN_URL || typeof fetch !== 'function' ? Promise.resolve([]) : Promise.race([
        fetch(NET_TURN_URL, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((a) => (Array.isArray(a) ? a.filter(iceOk).slice(0, 12) : [])),
        new Promise((res) => setTimeout(() => res([]), 4000)),
      ]).catch(() => []);
      relays.then((a) => { if (!a.length && NET_TURN_URL) relays = null; });
    }
    return relays.then((fetched) => ({ iceServers: [...NET_STUN, ...NET_TURN, ...fetched] }));
  };
  // A PeerJS connection's send, splitting a big message into pieces ({ t: '~' }), and the matching
  // reassembly (which returns the whole message, or null while pieces are still to come or they're bad).
  function wire(conn) {
    let seq = 0;
    return (m) => {
      let s;
      try { s = JSON.stringify(m); } catch (e) { return; }
      try {
        if (s.length <= NET_PIECE) { conn.send(m); return; }
        const k = ++seq, n = Math.ceil(s.length / NET_PIECE);
        for (let i = 0; i < n; i++) conn.send({ t: '~', k, i, n, s: s.slice(i * NET_PIECE, (i + 1) * NET_PIECE) });
      } catch (e) { /* closing */ }
    };
  }
  function unwire() {
    const open = new Map();
    return (m) => {
      if (!m || m.t !== '~') return m;
      const { k, i, n, s } = m;
      if (!(Number.isInteger(n) && n > 1 && n <= Math.ceil(NET_MAX_BYTES / NET_PIECE) && Number.isInteger(i) && i >= 0 && i < n && typeof s === 'string' && s.length <= NET_PIECE)) return null;
      let p = open.get(k);
      if (!p) { open.clear(); p = { n, got: 0, s: [] }; open.set(k, p); } // (one message at a time: an ordered channel never interleaves them)
      if (p.n !== n || p.s[i] != null) return null;
      p.s[i] = s;
      if (++p.got < n) return null;
      open.delete(k);
      try { const w = JSON.parse(p.s.join('')); return w && w.t === '~' ? null : w; } catch (e) { return null; } // (never a piece in pieces)
    };
  }

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
    let tries = 0, config = null;
    const gen = joinGen;
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
      peer = new Peer(PEER_PREFIX + code, { debug: 0, config });
      peer.on('open', () => { start(); resolve(code); });
      peer.on('connection', (conn) => hostConn(conn));
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && ++tries < 4) { peer.destroy(); open(N.makeCode()); return; }
        if (!N.active) { reject(new Error(netError(e))); return; }
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') emit({ t: 'warn', text: 'Lost the connection to the matchmaking server: players already in the room stay connected' });
      });
      peer.on('disconnected', () => { if (N.active && peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (err) { /* gone */ } }, 1500); });
    };
    if (transport === 'local') { open(N.makeCode()); return; }
    N.ice().then((c) => { if (gen !== joinGen) { reject(new Error('Cancelled')); return; } config = c; open(N.makeCode()); }); // (unless something else started meanwhile)
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
    const n = size(msg);
    N.bytesIn += n;
    if (n > NET_MAX_BYTES) return; // (a padded message is not fanned out to everyone)
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
    let pid = 0; setTimeout(() => { if (!pid) conn.close(); }, 15000); // (a connection that never says hello goes)
    const send = wire(conn), whole = unwire();
    conn.on('data', (raw) => {
      if (!pid && raw && raw.t === '~') { conn.close(); return; } // (hello never comes in pieces)
      const msg = whole(raw);
      if (!msg) return;
      if (!pid) { if (msg.t === 'hello') pid = accept(msg, send, () => conn.close()); if (!pid) setTimeout(() => conn.close(), 500); return; }
      fromClient(pid, msg);
    });
    conn.on('close', () => { if (pid) dropPlayer(pid, 'left'); });
    conn.on('error', (e) => { if (pid && !(e && e.type === 'message-too-big')) dropPlayer(pid, 'connection error'); }); // (a refused message isn't a lost link)
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
  // Joining online goes through stages, each with its own patience and its own message: reaching the
  // matchmaking server; the room's host answering (a phone host can't while its screen is off or another app
  // is in front, so wait up to a minute and say so); the direct link (or relay) between the two devices; and
  // the host letting us in. status(text) hears how it's going.
  let pendingJoin = null; // the join under way: its fail(), so leaving can cancel it
  N.join = (code, { transport = 'p2p', name = 'Pilot', status = () => {} } = {}) => new Promise((resolve, reject) => {
    N.leave();
    code = cleanCode(code);
    if (code.length < 4) { reject(new Error('Enter the room code')); return; }
    Object.assign(N, { transport, name, isHost: false, me: 0, code, hostOffset: 0, bytesIn: 0, bytesOut: 0 });
    N.names = new Map();
    let done = false, timer = 0, tick = 0;
    const gen = ++joinGen; // (a later join or host makes this attempt stale: it must not tear that one down)
    const stop = () => { done = true; clearTimeout(timer); clearInterval(tick); if (pendingJoin === fail) pendingJoin = null; };
    function fail(text, quiet) { if (done) return; stop(); if (!quiet && gen === joinGen) N.leave(); reject(new Error(text)); }
    pendingJoin = fail;
    if (transport === 'local') timer = setTimeout(() => fail('No room with that code is open in another tab'), 15000);
    const whole = unwire();
    const onMsg = (raw) => {
      const msg = whole(raw);
      if (!msg || typeof msg.t !== 'string') return;
      N.bytesIn += size(msg);
      lastHeard = performance.now();
      if (!done) {
        if (msg.t === 'reject') { fail(msg.reason || 'The host turned the request down'); return; }
        if (msg.t !== 'welcome') return;
        stop();
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
    if (typeof Peer === 'undefined') { fail('Online play isn’t available (the networking library didn’t load)'); return; }
    const t0 = performance.now(), NO_LINK = 'Found the host, but couldn’t connect to their device. Some routers, mobile networks and VPNs block direct links: try another network (Wi-Fi or mobile data), or turn off a VPN';
    let tOpen = 0, tIce = 0, tLink = 0, ice = 'new', said = '';
    const say = (text) => { if (text !== said) { said = text; try { status(text); } catch (e) { /* the screen's gone */ } } };
    tick = setInterval(() => {
      const now = performance.now();
      if (!tOpen) { if (now - t0 > 15000) fail('Couldn’t reach the matchmaking server: check the internet connection'); return; }
      if (!tIce && !tLink) { // the room exists (no 'No room' within a few seconds), but its host hasn't answered yet
        if (now - tOpen > 8000) say('Found the room, but the host’s game isn’t answering yet. It can’t while their screen is off or another app is in front: ask them to come back to the game');
        else if (now - tOpen > 3000) say('Found the room. Waiting for the host’s game to answer…');
        if (now - tOpen > 60000) fail('The host’s game didn’t answer. Ask them to keep the game open on screen while you join, then try again');
        return;
      }
      if (!tLink) { // the host answered: now the two devices find a path to each other
        say('Connecting to the host…');
        if (ice === 'failed' || now - tIce > 20000) fail(NO_LINK);
        return;
      }
      if (now - tLink > 15000) fail('Connected, but the host’s game didn’t let you in. Check the room is still open, then try again');
    }, 250);
    N.ice().then((config) => { if (!done) connect(config); });
    function connect(config) { // (with the relays to hand)
      peer = new Peer({ debug: 0, config });
      peer.on('error', (e) => {
        if (!done) { fail(e.type === 'peer-unavailable' ? 'No room with that code right now. Check the code; if it’s right, the host’s game may have been in the background a while (screen off or another app open): ask them to come back to it and try again, as the same code still works' : netError(e)); return; }
        if (e.type === 'peer-unavailable') closeAll('Lost the connection to the host');
        else emit({ t: 'warn', text: 'Lost the connection to the matchmaking server: the room carries on' }); // (the link to the host is separate)
      });
      peer.on('open', () => {
        if (done) return;
        tOpen = performance.now();
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        const send = wire(conn);
        link = { send, close: () => conn.close() };
        conn.on('iceStateChanged', (s) => { ice = s; if (!tIce && s !== 'new') tIce = performance.now(); });
        const pc = conn.peerConnection; // (the host's answer is the host answering, even when ICE never gets as far as checking)
        if (pc) pc.addEventListener('signalingstatechange', () => { if (!tIce && pc.signalingState === 'stable') tIce = performance.now(); });
        conn.on('open', () => { tLink = performance.now(); if (!tIce) tIce = tLink; say('Connected. Waiting for the host to let you in…'); send(hello); });
        conn.on('data', onMsg);
        conn.on('close', () => { if (done) closeAll('The host left the room'); else fail(ice === 'failed' ? NO_LINK : 'The host’s device closed the connection: try again'); });
        conn.on('error', (e) => {
          if (e && e.type === 'message-too-big') return; // (a refused message isn't a lost link)
          if (done) closeAll('Lost the connection to the host');
          else if (e && e.type === 'negotiation-failed') ice = 'failed';
        });
      });
    }
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
    if (pendingJoin) { const f = pendingJoin; pendingJoin = null; f('Cancelled', true); } // (a join still under way stops here,
    joinGen++; //  and a room still waiting for its relays doesn't open after all)
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
  // A look at this network for online play (about 10 s at most): can it reach the matchmaking server, does a
  // STUN server answer over UDP (direct links can work), and does a relay get through, and how (relay: the
  // protocols the relay candidates came over, 'udp', 'tcp' or 'tls'; relaySetUp: is there one to try)?
  N.probe = async () => {
    const config = await N.ice();
    const res = { server: false, direct: false, relay: [], relaySetUp: config.iceServers.some((x) => [].concat(x.urls).some((u) => /^turns?:/.test(u))) };
    const server = new Promise((done) => {
      let p = null, t = 0;
      const end = (ok) => { clearTimeout(t); try { if (p) p.destroy(); } catch (e) { /* gone */ } done(ok); };
      if (typeof Peer === 'undefined') { end(false); return; }
      try { p = new Peer({ debug: 0, config }); } catch (e) { end(false); return; }
      t = setTimeout(() => end(false), 9000);
      p.on('open', () => end(true)); p.on('error', () => end(false));
    });
    const found = new Promise((done) => {
      const out = [];
      let pc = null, t = 0;
      const end = () => { clearTimeout(t); try { if (pc) pc.close(); } catch (e) { /* gone */ } done(out); };
      if (typeof RTCPeerConnection === 'undefined') { end(); return; }
      try { pc = new RTCPeerConnection(config); } catch (e) { end(); return; }
      t = setTimeout(end, 9000);
      pc.onicecandidate = (e) => { if (e.candidate) out.push(e.candidate); else end(); };
      pc.createDataChannel('probe');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(end);
    });
    const [ok, cands] = await Promise.all([server, found]);
    res.server = ok;
    for (const c of cands) {
      const type = c.type || (/ typ (\w+)/.exec(c.candidate || '') || [])[1];
      if (type === 'srflx') res.direct = true;
      if (type === 'relay') { const p = c.relayProtocol || 'udp'; if (!res.relay.includes(p)) res.relay.push(p); }
    }
    return res;
  };
  N._t = { wire, unwire, HOST_ONLY }; // (for the tests)
  addEventListener('pagehide', () => { if (N.active) N.leave(); });
  // back on screen after a phone put the game to sleep: get back onto the matchmaking server at once, so
  // friends waiting to join get through (the delayed reconnect on 'disconnected' still covers the rest)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && N.active && peer && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* gone */ } }
  });
  return N;
})();
