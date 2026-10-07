// Lotus nebula controls. Each arm prints ok/FIRE; each has a planted fault that MUST fire (else the arm is decoration).
//  G  GPU float32 eval vs CPU float64 mirror: position err/R p99 < 1e-4, Σ rel err p99 < 1e-2.   PLANT: CPU seed+1
//  J  analytic Jacobian (IFS chain + final map) vs central finite difference, rel err p99 < 1e-5.  PLANT: DFᵀ per step
//  R  rolling: same address, t → t+dt moves points by O(dt) (median/R < 1e-2, and ∝ dt).          PLANT: reseeded addresses
//  F  flatness meter: thin sheet median < .05, solid sponge > .9 (the two references ARE the control)
//  X  .ply round trip: Σ rebuilt from scale+quaternion vs displayed Σ, floor off, rel err p99 < 1e-4. PLANT: quaternion xyzw
//  V  every preset draws (lit fraction > 2%)
// Run from the repository root:  node tools/check.mjs   (needs Node 22.7+ and playwright with Firefox:
// npm i playwright && npx playwright install firefox). It serves this folder itself on a private port.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import * as I from '../ifs.js';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const body = await readFile(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
// LOTUS_BASE=https://bristorbrot.org/lotus/demo/ checks a hosted copy instead (its files must equal this folder's:
// the CPU mirror below is this folder's ifs.js).
const REMOTE = process.env.LOTUS_BASE;
if (!REMOTE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = REMOTE ? REMOTE.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/`;
console.log(`checking ${REMOTE ? BASE : 'this folder (private server)'}`);
const b = await firefox.launch({ headless: true }); let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FIRE ') + m); };
const plant = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'DEAD ') + 'planted ' + m); };   // a planted fault that did NOT fire = dead control
const p = await b.newPage({ viewport: { width: 1000, height: 700 } }); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`${BASE}?play=0&turn=0&N=256&v=${Date.now()}`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__lotus?.ready, null, { timeout: 60000 });
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const fro = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));
const symFro = (S) => Math.sqrt(S[0] ** 2 + S[3] ** 2 + S[5] ** 2 + 2 * (S[1] ** 2 + S[2] ** 2 + S[4] ** 2));
const fl = (a) => Float32Array.from(a);
async function state(pre, t, extra = {}) {
  return p.evaluate(({ pre, t, extra }) => { const L = window.__lotus; L.setPreset(pre); L.setT(t); if (extra.xw !== undefined) { L.S.view.xw = extra.xw; } L.set({}); const rb = L.readback(4);
    return { U: L.U(), P: L.params(), R: L.S.R, W: L.S.N, rb, size: L.S.size }; }, { pre, t, extra });
}
const toU = (u) => ({ A: fl(u.A), B: fl(u.B), V: fl(u.V), V2: fl(u.V2), n: u.n, F: u.F.on ? { on: 1, petal: fl(u.F.petal), RM: fl(u.F.RM), RG: fl(u.F.RG), haze: fl(u.F.haze), haze2: fl(u.F.haze2) } : { on: 0 } });

// ---------- G + J ----------
for (const [pre, t, extra] of [['lotus', .5, { xw: .7 }], ['lotus', 1, {}], ['sponge', 0, {}], ['sheet', 1, {}], ['flower', .5, {}]]) {
  const st = await state(pre, t, extra), U = toU(st.U), P = st.P, [p0, p1, p2] = st.rb, n = 400, eY = [], eS = [], eYp = [], eJ = [], eJp = [];
  for (let k = 0; k < n; k++) {
    const i = (k * 37) % (st.W * 4), g = { y: [p0[i * 4], p0[i * 4 + 1], p0[i * 4 + 2]], S: [p1[i * 4], p1[i * 4 + 1], p1[i * 4 + 2], p2[i * 4], p2[i * 4 + 1], p2[i * 4 + 2]] };
    const c = I.evalCPU(i, P, U), cp = I.evalCPU(i, { ...P, seed: P.seed + 1 }, U);
    eY.push(fro(g.y.map((v, a) => v - c.y[a])) / st.R); eYp.push(fro(g.y.map((v, a) => v - cp.y[a])) / st.R);
    eS.push(symFro(g.S.map((v, a) => v - c.Sig[a])) / Math.max(symFro(c.Sig), 1e-300));
    // J: rebuild the address, stop before the outer KS maps, finite-difference the outer chain (+ final)
    const { K, KS, seed } = P, pick = (u) => { for (let tt = 0; tt < U.n; tt++) if (u < U.V2[tt * 4 + 3]) return tt; return U.n - 1; };
    let X = [0, 1, 2, 3].map(cc => 2 * I.h01(i, 4096 + cc, seed) - 1);
    for (let j = K - 1; j >= KS; j--) X = I.mapCPU(X, pick(I.h01(i, j, seed)), U).y;
    const outer = (Y) => { let Z = Y; for (let j = KS - 1; j >= 0; j--) Z = I.mapCPU(Z, pick(I.h01(i, j, seed)), U).y; if (U.F.on) Z = I.finalCPU(Z, i, seed, U.F).x; return Z; };
    const h = 1e-6 * (1 + fro(X)), FD = new Array(16);
    for (let cc = 0; cc < 4; cc++) { const a = X.slice(), bb = X.slice(); a[cc] += h; bb[cc] -= h; const ya = outer(a), yb = outer(bb); for (let r = 0; r < 4; r++) FD[r * 4 + cc] = (ya[r] - yb[r]) / (2 * h); }
    const Jp = I.evalCPU(i, P, U, { transposeStep: true }).J;
    eJ.push(fro(c.J.map((v, a) => v - FD[a])) / fro(FD)); eJp.push(fro(Jp.map((v, a) => v - FD[a])) / fro(FD));
  }
  const tag = `${pre} t=${t}${extra.xw ? ' xw=' + extra.xw : ''}`;
  ok(q(eY, .99) < 1e-4 && q(eS, .99) < 1e-2, `G ${tag}: pos err/R p99 ${q(eY, .99).toExponential(2)}, Σ rel p50 ${q(eS, .5).toExponential(2)} p99 ${q(eS, .99).toExponential(2)}`);
  plant(q(eYp, .5) > 1e-2, `G seed+1 → pos err/R p50 ${q(eYp, .5).toExponential(2)} (must be > 1e-2)`);
  ok(q(eJ, .99) < 1e-5, `J ${tag}: analytic vs FD rel p50 ${q(eJ, .5).toExponential(2)} p99 ${q(eJ, .99).toExponential(2)}`);
  if (pre !== 'sponge') plant(q(eJp, .5) > 1e-3, `J DFᵀ → rel p50 ${q(eJp, .5).toExponential(2)} (must be > 1e-3)`);
  else console.log(`     (sponge: DFᵀ = DF for its symmetric maps, planted arm not applicable: p50 ${q(eJp, .5).toExponential(2)})`);
}

// ---------- R ----------
const disp = await p.evaluate(() => { const L = window.__lotus; L.setPreset('lotus'); const R = L.S.R;
  const at = (t, seed = 0) => { L.setT(t); L.setSeed(seed); return L.readback(8)[0]; };
  const d = (a, b) => { const o = []; for (let i = 0; i < a.length; i += 4) o.push(Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]) / R); o.sort((x, y) => x - y); return o[o.length >> 1]; };
  const a = at(.5), b1 = at(.502), b2 = at(.504), rs = at(.5, 12345); return { d1: d(a, b1), d2: d(a, b2), dr: d(a, rs) }; });
ok(disp.d1 < 1e-2 && disp.d2 / disp.d1 > 1.6 && disp.d2 / disp.d1 < 2.4, `R rolling: median move/R dt=.002 ${disp.d1.toExponential(2)}, dt=.004 ${disp.d2.toExponential(2)} (ratio ${(disp.d2 / disp.d1).toFixed(2)}, want ≈2)`);
plant(disp.dr > .1, `R reseeded addresses → median move/R ${disp.dr.toFixed(3)} (must be > .1)`);

// ---------- F ----------
const fm = await p.evaluate(() => { const L = window.__lotus, o = {}; for (const [pre, t] of [['sheet', 0], ['sheet', 1], ['sponge', 0], ['lotus', 0], ['lotus', 1]]) { L.setPreset(pre); L.setT(t); L.set({}); o[pre + t] = L.meter().median; } return o; });
ok(fm.sheet0 < .05 && fm.sponge0 > .9, `F flatness: thin sheet ${fm.sheet0.toFixed(3)} (<.05), thick sheet ${fm.sheet1.toFixed(3)}, sponge ${fm.sponge0.toFixed(3)} (>.9) · lotus bud ${fm.lotus0.toFixed(3)} bloom ${fm.lotus1.toFixed(3)}`);

// ---------- X ----------
for (const [order, minScale] of [['wxyz', 0], ['wxyz', 1e-4], ['xyzw', 0]]) {
  const r = await p.evaluate(({ order, minScale }) => { const L = window.__lotus; L.setPreset('lotus'); L.setT(.6); L.set({}); const e = L.exportPly({ sample: 1500, quatOrder: order, minScale }); const rb = L.readback(); return { ...e, p1: rb[1].slice(0, 6000 * 4), p2: rb[2].slice(0, 6000 * 4), p0: rb[0].slice(0, 6000 * 4) }; }, { order, minScale });
  const bytes = Uint8Array.from(r.bytes), head = new TextDecoder().decode(bytes.slice(0, r.headerBytes));
  const props = [...head.matchAll(/property float (\w+)/g)].map(m => m[1]), np = props.length, dv = new DataView(bytes.buffer, r.headerBytes);
  const ix = Object.fromEntries(props.map((k, j) => [k, j])), errs2 = [];
  let src = 0;
  for (let n = 0; n < 1500; n++) {
    while (!(Number.isFinite(r.p0[src * 4]) && Number.isFinite(r.p1[src * 4]) && Number.isFinite(r.p2[src * 4 + 2]))) src++;
    const g = (k) => dv.getFloat32((n * np + ix[k]) * 4, true);
    const [w, x, y, z] = ['rot_0', 'rot_1', 'rot_2', 'rot_3'].map(g), s = ['scale_0', 'scale_1', 'scale_2'].map(k => Math.exp(g(k)));
    const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
    const Sg = (a, c) => R[a][0] * R[c][0] * s[0] ** 2 + R[a][1] * R[c][1] * s[1] ** 2 + R[a][2] * R[c][2] * s[2] ** 2;
    const rec = [Sg(0, 0), Sg(0, 1), Sg(0, 2), Sg(1, 1), Sg(1, 2), Sg(2, 2)], ref = [r.p1[src * 4], r.p1[src * 4 + 1], r.p1[src * 4 + 2], r.p2[src * 4], r.p2[src * 4 + 1], r.p2[src * 4 + 2]].map(v => v * r.size * r.size);
    const pos = Math.hypot(g('x') - r.p0[src * 4], g('y') - r.p0[src * 4 + 1], g('z') - r.p0[src * 4 + 2]);
    errs2.push(Math.max(symFro(rec.map((v, a) => v - ref[a])) / Math.max(symFro(ref), 1e-300), pos)); src++;
  }
  if (order === 'wxyz' && minScale) console.log(`     X with the export floor (1e-4·R on the thin axis, deliberate): Σ rel p50 ${q(errs2, .5).toExponential(2)} p99 ${q(errs2, .99).toExponential(2)}`);
  else if (order === 'wxyz') ok(q(errs2, .99) < 1e-4, `X ply round trip (encoding, floor off): Σ rel err p50 ${q(errs2, .5).toExponential(2)} p99 ${q(errs2, .99).toExponential(2)} (${r.n} splats, ${props.length} props)`);
  else plant(q(errs2, .5) > 1e-2, `X quaternion written xyzw → p50 ${q(errs2, .5).toExponential(2)} (must be > 1e-2)`);
}

// ---------- V ----------
for (const pre of Object.keys(I.PRESETS)) { const lit = await p.evaluate((pre) => { const L = window.__lotus; L.setPreset(pre); L.setT(.5); return L.litFraction(); }, pre); ok(lit > .02, `V ${pre} lit ${(100 * lit).toFixed(1)}%`); }
{ const pb = await b.newPage({ viewport: { width: 900, height: 600 } }), eb = []; pb.on('pageerror', e => eb.push(e.message)); pb.on('console', m => { if (m.type() === 'error') eb.push(m.text()); });
  await pb.goto(`${BASE}bare.html?v=${Date.now()}`, { waitUntil: 'networkidle' }); await pb.waitForFunction(() => window.__bare?.ready, null, { timeout: 60000 }).catch(() => {});
  await pb.waitForTimeout(800); await pb.screenshot({ path: join(tmpdir(), 'lotus_bare.png') });
  const lit = await pb.evaluate(() => window.__bare.lit());   // same-task read (step readpixels-in-raf: a drawImage read came back 0% on a visibly rendering canvas)
  ok(lit > .02 && eb.length === 0 && !(await pb.textContent('#err')), `V bare.html (bones only): lit ${(100 * lit).toFixed(1)}%, errors ${eb.length ? eb.join(' | ') : 'none'}`); }
ok(errs.length === 0, `page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log(fails ? `\n${fails} FIRED` : '\nall ok'); await b.close(); server.close(); process.exit(fails ? 1 : 0);
