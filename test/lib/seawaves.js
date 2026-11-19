// The sea's waves as the ships update's spec has them (§5.1), for the sea package's browser tests and bench while the
// hydro core's Ship.wave and Ship.waveUniforms are still the contract's stubs (every answer 0): run in the page
// (page.evaluate(seaWaves)), it puts this copy in their place and returns true; once the real ones are there (any answer
// not 0) it leaves them alone and returns false. Four directional sines, SHIP.WAVES × the sea state's SHIP.SEA factors,
// deep-water dispersion (k = ω²/g), each running toward SHIP.swellDir + its angle (° from game north, clockwise: its
// unit (east, north) = (sin, cos)); waveUniforms packs, per component, [east, north, k, amplitude, ω, phase at (e0, n0)
// at time t (mod 2π)], the layout render3d's swell reads.
export function seaWaves() {
  if (typeof Ship === 'undefined') return false;
  const o = Ship.wave(10, 20, 3, [0, 0, 0]), q = Ship.wave(-37, 5, 1.3, [0, 0, 0]);
  if (o[0] || o[1] || o[2] || q[0] || q[1] || q[2]) return false;
  const g = 9.81, comps = () => {
    const st = SHIP.SEA[Ship.sea()] || SHIP.SEA.moderate;
    return SHIP.WAVES.map(([A, P, th, ph]) => { const a = A * st.a, T = P * st.t, w = (2 * Math.PI) / T, k = (w * w) / g, br = ((SHIP.swellDir + th) * Math.PI) / 180; return { a, w, k, de: Math.sin(br), dn: Math.cos(br), ph }; });
  };
  Ship.wave = (e, n, t, out) => {
    out = out || [0, 0, 0]; out[0] = out[1] = out[2] = 0;
    for (const c of comps()) { const p = c.k * (c.de * e + c.dn * n) - c.w * t + c.ph, s = Math.sin(p), co = Math.cos(p); out[0] += c.a * s; out[1] += c.a * c.k * c.de * co; out[2] += c.a * c.k * c.dn * co; }
    return out;
  };
  Ship.waveUniforms = (e0, n0, t, out) => {
    out = out || new Float32Array(SHIP.WAVES.length * 6);
    comps().forEach((c, i) => { const p = (c.k * (c.de * e0 + c.dn * n0) - c.w * t + c.ph) % (2 * Math.PI); out[i * 6] = c.de; out[i * 6 + 1] = c.dn; out[i * 6 + 2] = c.k; out[i * 6 + 3] = c.a; out[i * 6 + 4] = c.w; out[i * 6 + 5] = p; });
    return out;
  };
  window.__seaMock = true;
  return true;
}
