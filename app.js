// app.js: Lotus nebula WEB page (glue: panel, keyframes, meter UI, export button, hooks). Bones: ifs.js, renderer.js, ply.js.
// Eval pass (one texel = one point: position, Σ, colour, flatness) → instanced splats into a
// float sum → flame tone map. Re-evaluated whenever a parameter changes; addresses stay fixed, so points roll.
import { PRESETS, rot, autoKS, sceneU, fitL, fitFrame, macrosAt as sceneMacrosAt } from './ifs.js';
import { createRenderer } from './renderer.js';
import { writePly } from './ply.js';

const $ = (id) => document.getElementById(id);
const err = (m) => { $('err').textContent += m + '\n'; console.error(m); };
window.addEventListener('error', e => err(e.message));
const url = new URLSearchParams(location.search);

// ---------- GL (bones: renderer.js) ----------
const canvas = $('gl');
const RD = createRenderer(canvas, { preserveDrawingBuffer: url.get('pdb') === '1' }), gl = RD.gl, GPU = RD.GPU;
let pts = null;
function makePoints(W) { pts = RD.setPoints(W); }

// ---------- state ----------
const S = {
  preset: url.get('preset') ?? 'lotus', macros: {}, A: {}, B: {}, t: +(url.get('t') ?? 0), playing: url.get('play') !== '0', dir: 1, hold: 0,
  ease: 'smooth', dur: 4, seedMode: 'fixed', seed: 0, frame: 0,
  view: { xw: 0, yw: 0, zw: 0 }, wspin: false, turn: url.get('turn') !== '0',
  cam: { az: .4, el: .5, dist: 3, ctr: [0, 0, 0], fov: 40 * Math.PI / 180 }, R: 1, sigma: 1, L: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  N: +(url.get('N') ?? 512), style: +(url.get('style') ?? 2), K: 24, KS: 8, size: 1, floor: .3, exposure: .5, gamma: 2.2, palette: 'lotus', whue: .25, eop: .12,
  dirtyEval: true, dirtyDraw: true, U: null, xfs: null,
};
const R4 = () => rot({ xw: S.view.xw, yw: S.view.yw, zw: S.view.zw });
const params = () => ({ K: S.K, KS: S.KS, seed: S.seed, R4: R4(), L: S.L });

const macrosAt = (t) => sceneMacrosAt(S.preset, S.A, S.B, S.macros, t, S.ease);
function rebuild() { Object.assign(S, sceneU(S.preset, S.macros)); refreshL(); S.dirtyEval = true; }
// Σ_A follows the attractor as it eases (a small CPU sample, ~2 ms); the camera does not (recentre does that)
function refreshL() { Object.assign(S, fitL(S.U, params())); }

// attractor centre / radius from a CPU sample (float64 mirror), so camera and σ follow the preset
function recentre() {
  const f = fitFrame([S.U, sceneU(S.preset, macrosAt(0)).U, sceneU(S.preset, macrosAt(1)).U], params());
  S.cam.ctr = f.ctr; S.R = f.R; S.cam.dist = 1.4 * f.R / Math.tan(S.cam.fov / 2); refreshL(); S.dirtyEval = true;
}

// ---------- passes ----------
// state for the bones' passes
function st() { const ui = $('ui'), side = !ui.classList.contains('folded') && innerWidth > 640;
  return { U: S.U, K: S.K, KS: S.KS, seed: S.seed, R4: R4(), L: S.L, style: S.style, size: S.size, floor: S.floor, exposure: S.exposure, gamma: S.gamma, palette: S.palette, whue: S.whue, sigma: S.sigma, shift: side ? -(ui.offsetWidth + 10) / innerWidth : 0 }; }
const evalPass = () => RD.evalPass(st()), drawPass = () => RD.drawPass(st(), S.cam), readback = (rows) => RD.readback(rows);

// ---------- flatness meter ----------
let flatStats = null, flatDue = 0;
function meter() {
  const rows = Math.max(1, Math.min(pts.H, Math.ceil(16384 / pts.W))), [, , p2] = readback(rows), n = pts.W * rows, f = [];
  for (let i = 0; i < n; i++) { const v = p2[i * 4 + 3]; if (Number.isFinite(v)) f.push(v); }
  f.sort((a, b) => a - b); const bins = new Array(40).fill(0); f.forEach(v => bins[Math.min(39, Math.floor(v * 40))]++);
  flatStats = { n: f.length, median: f[f.length >> 1], p10: f[Math.floor(f.length * .1)], p90: f[Math.floor(f.length * .9)], bins };
  const cv = $('hist'), g = cv.getContext('2d'), W = cv.width, H = cv.height, mx = Math.max(...bins);
  g.clearRect(0, 0, W, H); g.fillStyle = '#d48fc0';
  bins.forEach((b, k) => { const h = (H - 22) * b / mx; g.fillRect(k * W / 40 + 1, H - 16 - h, W / 40 - 2, h); });
  g.fillStyle = '#7fd0d8'; g.fillRect(flatStats.median * W - 1, 0, 3, H - 16);
  g.fillStyle = '#8d87a0'; g.font = '20px system-ui'; g.fillText('sheet 0', 4, H - 1); g.fillText('1 solid', W - 66, H - 1);
  $('flatnote').textContent = `median ${flatStats.median.toFixed(3)} · p10 ${flatStats.p10.toFixed(3)} · p90 ${flatStats.p90.toFixed(3)} (n ${f.length}) — 0 = sheet/thread, 1 = solid`;
}

// ---------- 3DGS .ply export (bones: ply.js) ----------
const exportPly = ({ limit = pts.N, quatOrder = 'wxyz', minScale = 1e-4 } = {}) => writePly(readback(), { N: Math.min(limit, pts.N), size: S.size, R: S.R, sigma: S.sigma, palette: S.palette, whue: S.whue, opacity: S.eop, minScale, quatOrder, comment: `Lotus nebula preset=${S.preset} K=${S.K} KS=${S.KS} size=${S.size}` });

function downloadPly() {
  const t0 = performance.now(), { buf, n } = exportPly(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })); a.download = `lotus_${S.preset}_${n}.ply`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status(`exported ${n} splats, ${(buf.byteLength / 1e6).toFixed(1)} MB in ${(performance.now() - t0).toFixed(0)} ms`);
}

// ---------- UI ----------
let statusMsg = '';
const status = (m) => { statusMsg = m; };
function slider(id, key, fmt = 2, obj = S, onchange) {
  const el = $(id), v = $(id + '_v'); el.value = obj[key];
  const show = () => v && (v.textContent = (+obj[key]).toFixed(fmt)); show();
  el.addEventListener('input', () => { obj[key] = +el.value; show(); (onchange ?? (() => { S.dirtyDraw = true; }))(); });
  return { el, show };
}
function buildMacroUI() {
  const box = $('macros'); box.innerHTML = ''; const pr = PRESETS[S.preset];
  for (const [k, [def, lo, hi, st]] of Object.entries(pr.macros)) {
    const lab = document.createElement('label'); lab.innerHTML = `<span>${k}</span><input id="m_${k}" type="range" min="${lo}" max="${hi}" step="${st}"><b id="m_${k}_v"></b>`; box.append(lab);
    slider(`m_${k}`, k, st >= 1 ? 0 : 2, S.macros, () => { S.playing = false; syncPlay(); if (k !== 'petals') { S.A[k] = S.B[k] = undefined; } rebuild(); });
  }
}
function showMacros() { for (const k of Object.keys(S.macros)) { const el = $(`m_${k}`), v = $(`m_${k}_v`); if (el) { el.value = S.macros[k]; v.textContent = (+S.macros[k]).toFixed(k === 'petals' ? 0 : 2); } } }
function setPreset(name) {
  S.preset = name; const pr = PRESETS[name];
  S.macros = Object.fromEntries(Object.entries(pr.macros).map(([k, v]) => [k, v[0]])); S.A = { ...pr.A }; S.B = { ...pr.B };
  Object.assign(S.view, { xw: pr.view.xw, yw: pr.view.yw, zw: pr.view.zw }); S.cam.el = pr.view.el; S.cam.az = pr.view.az;
  buildMacroUI(); Object.assign(S.macros, macrosAt(S.t)); rebuild();
  S.KS = autoKS(S.xfs, pts.N); ['xw', 'yw', 'zw'].forEach(k => { $(k).value = S.view[k]; $(k + '_v').textContent = S.view[k].toFixed(2); });
  $('KS').value = S.KS; $('KS_v').textContent = S.KS; showMacros(); recentre();
}
const syncPlay = () => { $('play').textContent = S.playing ? '❚❚ Pause' : '▶ Bloom'; $('play').classList.toggle('on', S.playing); };

function initUI() {
  const sel = $('preset'); for (const [k, p] of Object.entries(PRESETS)) sel.add(new Option(p.label, k)); sel.value = S.preset;
  sel.onchange = () => setPreset(sel.value);
  $('play').onclick = () => { S.playing = !S.playing; syncPlay(); };
  $('setA').onclick = () => { S.A = { ...S.macros }; status('A = current'); };
  $('setB').onclick = () => { S.B = { ...S.macros }; status('B = current'); };
  slider('t', 't', 3, S, () => { S.playing = false; syncPlay(); Object.assign(S.macros, macrosAt(S.t)); showMacros(); rebuild(); });
  $('ease').value = S.ease; $('ease').onchange = () => { S.ease = $('ease').value; };
  slider('dur', 'dur', 1);
  $('seedmode').onchange = () => { S.seedMode = $('seedmode').value; S.seed = 0; S.dirtyEval = true; };
  for (const k of ['xw', 'yw', 'zw']) slider(k, k, 2, S.view, () => { S.dirtyEval = true; });
  $('wspin').onclick = () => { S.wspin = !S.wspin; $('wspin').classList.toggle('on', S.wspin); };
  $('turn').onclick = () => { S.turn = !S.turn; $('turn').classList.toggle('on', S.turn); }; $('turn').classList.toggle('on', S.turn);
  $('recentre').onclick = recentre;
  $('N').value = S.N; $('N').onchange = () => { S.N = +$('N').value; makePoints(S.N); S.KS = autoKS(S.xfs, pts.N); $('KS').value = S.KS; $('KS_v').textContent = S.KS; S.dirtyEval = true; };
  $('style').value = S.style; $('style').onchange = () => { S.style = +$('style').value; S.dirtyDraw = true; };
  slider('K', 'K', 0, S, () => { S.dirtyEval = true; }); const ks = slider('KS', 'KS', 0, S, () => { S.dirtyEval = true; });
  for (const [k, f] of [['size', 2], ['floor', 2], ['exposure', 2], ['gamma', 2], ['whue', 2], ['eop', 2]]) slider(k, k, f);
  $('palette').onchange = () => { S.palette = $('palette').value; S.dirtyDraw = true; };
  $('ply').onclick = downloadPly;
  $('fold').onclick = () => { $('ui').classList.toggle('folded'); $('fold').textContent = $('ui').classList.contains('folded') ? '+' : '–'; S.dirtyDraw = true; };
  syncPlay(); ks.show();
  // orbit: drag = camera only (the 4-D turn has its own sliders); wheel = zoom
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drag) return; S.cam.az -= (e.clientX - drag[0]) * .006; S.cam.el = Math.max(-1.5, Math.min(1.5, S.cam.el + (e.clientY - drag[1]) * .006)); drag = [e.clientX, e.clientY]; S.dirtyDraw = true; });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist *= Math.exp(e.deltaY * .001); S.dirtyDraw = true; }, { passive: false });
}

// ---------- loop ----------
let last = performance.now(), fpsAvg = 0, evalCount = 0;
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now; fpsAvg = fpsAvg * .9 + .1 / Math.max(dt, 1e-3);
  if (S.playing) {
    if (S.hold > 0) S.hold -= dt;
    else { S.t += S.dir * dt / S.dur; if (S.t >= 1 || S.t <= 0) { S.t = Math.max(0, Math.min(1, S.t)); S.dir *= -1; S.hold = .8; } }
    $('t').value = S.t; $('t_v').textContent = S.t.toFixed(3); Object.assign(S.macros, macrosAt(S.t)); showMacros(); rebuild();
  }
  if (S.wspin) { S.view.xw = ((S.view.xw + dt * .35 + Math.PI) % (2 * Math.PI)) - Math.PI; $('xw').value = S.view.xw; $('xw_v').textContent = S.view.xw.toFixed(2); S.dirtyEval = true; }
  if (S.turn) { S.cam.az += dt * .12; S.dirtyDraw = true; }
  if (S.seedMode === 'reseed') { S.seed = Math.imul(++S.frame, 2654435761) >>> 0; S.dirtyEval = true; }
  const w = Math.floor(innerWidth * Math.min(devicePixelRatio, 1.5)), h = Math.floor(innerHeight * Math.min(devicePixelRatio, 1.5));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; S.dirtyDraw = true; }
  if (S.dirtyEval) { evalPass(); evalCount++; S.dirtyEval = false; S.dirtyDraw = true; flatDue = now + 400; }
  if (S.dirtyDraw) { drawPass(); S.dirtyDraw = false; }
  if (flatDue && now > flatDue && !S.playing) { meter(); flatDue = 0; }
  $('status').textContent = `GPU ${GPU}\n${pts.N.toLocaleString()} points · ${S.xfs.length} maps · K ${S.K} · splat depth ${S.KS}\n${fpsAvg.toFixed(0)} fps · ${canvas.width}×${canvas.height}${statusMsg ? '\n' + statusMsg : ''}`;
  requestAnimationFrame(frame);
}

// ---------- boot ----------
makePoints(S.N);
initUI();
setPreset(S.preset);
for (const k of ['xw', 'yw', 'zw']) if (url.has(k)) { S.view[k] = +url.get(k); $(k).value = S.view[k]; $(k + '_v').textContent = S.view[k].toFixed(2); }
if (url.has('t')) { Object.assign(S.macros, macrosAt(S.t)); showMacros(); rebuild(); }
requestAnimationFrame(frame);

// hooks for the controls (tools/check.mjs)
window.__lotus = {
  gpu: GPU, S, params, readback: (rows) => { if (S.dirtyEval) { evalPass(); S.dirtyEval = false; } return readback(rows).map(a => Array.from(a)); },
  U: () => { const F = S.U.F, arr = (a) => Array.from(a); return { A: arr(S.U.A), B: arr(S.U.B), V: arr(S.U.V), V2: arr(S.U.V2), n: S.U.n, F: F.on ? { on: 1, petal: arr(F.petal), RM: arr(F.RM), RG: arr(F.RG), haze: arr(F.haze), haze2: arr(F.haze2) } : { on: 0 } }; },
  setT: (t) => { S.playing = false; syncPlay(); S.t = t; $('t').value = t; $('t_v').textContent = t.toFixed(3); Object.assign(S.macros, macrosAt(t)); showMacros(); rebuild(); evalPass(); S.dirtyEval = false; S.dirtyDraw = true; },
  setSeed: (seed) => { S.seed = seed >>> 0; evalPass(); S.dirtyEval = false; },
  setPreset: (p) => { S.playing = false; syncPlay(); $('preset').value = p; setPreset(p); evalPass(); S.dirtyEval = false; S.dirtyDraw = true; },
  set: (o) => { Object.assign(S, o); if (o.N) makePoints(o.N); evalPass(); S.dirtyEval = false; drawPass(); S.dirtyDraw = false; },
  litFraction: () => { evalPass(); drawPass(); const p = new Uint8Array(canvas.width * canvas.height * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p); let lit = 0; for (let i = 0; i < p.length; i += 4) if (p[i] + p[i + 1] + p[i + 2] > 60) lit++; return lit / (p.length / 4); },
  meter: () => { meter(); return flatStats; },
  exportPly: (o) => { const r = exportPly(o); return { bytes: Array.from(new Uint8Array(r.buf, 0, Math.min(r.buf.byteLength, r.headerBytes + (o?.sample ?? 2000) * r.props.length * 4))), n: r.n, headerBytes: r.headerBytes, size: S.size }; },
  ready: true,
};
