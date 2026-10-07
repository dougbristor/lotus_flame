// ifs.js: Lotus nebula. A 4-D IFS flame evaluated per point from a FIXED ADDRESS, with the Jacobian of the outer maps.
// No Bristorian algebra anywhere: plain R^4 affine maps + flame variations. The CPU float64 mirror (evalCPU) and
// the GLSL (EVAL_FS) are written side by side and must stay in step; tools/check.mjs compares them.
//
//   point i, address a_0..a_{K-1} (a_0 outermost):  x = f_{a0} o f_{a1} o ... o f_{a(K-1)} (x0)
//   splat:  J = D(f_{a0} o ... o f_{a(KS-1)}) at its input,  Sigma3 = P R4 J Sigma_A J^T R4^T P^T,  Sigma_A = L L^T
//   Sigma is the footprint of the depth-KS copy of the whole fractal (covariance Sigma_A) that the point sits in.
//   (First version used a round ball, sigma^2 J J^T: wrong for a flat attractor, since a map that turns w into z puffs the
//   ball's w extent into a sheet's thickness. The copy is J·(attractor), not J·(ball). Caught by the flat preset, 10-07.)
//
// Rolling: the address depends only on (i, seed), never on the parameters, so a slider move or an eased keyframe slides
// every point to its new place as the same point. Reseed mode (seed changes per frame) is the classic chaos game, kept
// as the comparison and as the control's planted fault.

export const MAXT = 24;
export const VARS = ['lin', 'sph', 'swirl', 'bubble', 'sin'];

// ---------- hash (bit-identical in JS and GLSL) ----------
export function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
export const h01 = (i, j, seed) => (pcg((pcg(i) ^ ((Math.imul(j, 0x9E3779B9) + seed) >>> 0)) >>> 0) >>> 8) / 16777216;

// ---------- 4-D rotations ----------
const PLANES = { xy: [0, 1], xz: [0, 2], xw: [0, 3], yz: [1, 2], yw: [1, 3], zw: [2, 3] };
const eye4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(A, B) { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c]; C[r * 4 + c] = s; } return C; }
function planeRot(a, b, t) { const M = eye4(), c = Math.cos(t), s = Math.sin(t); M[a * 4 + a] = c; M[a * 4 + b] = -s; M[b * 4 + a] = s; M[b * 4 + b] = c; return M; }
// rot({xy:.., zw:..}) = R_xy · R_xz · R_xw · R_yz · R_yw · R_zw (row-major)
export function rot(ang = {}) { let M = eye4(); for (const k of Object.keys(PLANES)) if (ang[k]) M = mul4(M, planeRot(...PLANES[k], ang[k])); return M; }
const xf = (o) => ({ w: 1, s: 1, ang: {}, b: [0, 0, 0, 0], v: { lin: 1 }, col: 0, speed: .5, diag: null, ...o });

// ---------- presets: each is a builder from macro values (the keyframes ease the macros, not the matrices) ----------
export const PRESETS = {
  lotus: {
    label: 'Lotus nebula (4-D)',
    // the petal is a flame-textured SHEET (an IFS on the unit square u,v with z,w thickness: four quarter maps + a midrib
    // and two side veins that lift into w); a FINAL map (outermost, never recursed) cups it into a petal and places it on
    // one of three rings × n petals, or on the nebula halo. Bloom = the ring tilt angles easing from upright to open.
    macros: { petals: [8, 4, 14, 1], open: [0, 0, 1, .01], curl: [.9, 0, 1.6, .01], bend: [.25, -.5, 1, .01], twist: [0, -1.6, 1.6, .01], haze: [.2, 0, 1, .01], vein: [.12, 0, .5, .01], lift: [.2, 0, 1, .01] },
    A: { open: 0, curl: 1.05, bend: .15, twist: 0, haze: .12, vein: .06, lift: .1 },
    B: { open: 1, curl: .45, bend: .55, twist: .3, haze: .45, vein: .22, lift: .45 },
    view: { xw: 0, yw: 0, zw: 0, el: .62, az: .5 },
    build(m) {
      const out = [];
      for (const [a, c, col] of [[0, 0, .2], [1, 0, .07], [0, 1, .24], [1, 1, .05]])   // base paler, tip deeper
        out.push(xf({ w: 1, s: .5, b: [.5 * a, .5 * c, 0, .04 * (a - c)], v: { lin: 1 }, col }));   // (a sin warp here left a seam at u = 1)
      out.push(xf({ w: .55, diag: [1, .05, .5, .5], b: [0, .475, .015, m.vein], v: { lin: 1 }, col: .82 }));            // midrib
      for (const vv of [.27, .73]) out.push(xf({ w: .22, diag: [.5, .035, .5, .5], b: [.5, vv - .0175, .008, .6 * m.vein], v: { lin: 1 }, col: .62 }));  // side veins
      return out;
    },
    final(m) {
      const n = Math.round(m.petals), mix = (a, b) => a + (b - a) * m.open;
      const rings = [0, 1, 2].map(k => ({ sc: [1, .78, .55][k], th: mix([1.36, 1.44, 1.52][k], [.1, .55, 1.0][k]), z0: [0, .05, .1][k] * (1 + 2 * m.lift), ph: k * Math.PI / n + m.twist * k, col: [.04, .24, .44][k], w: [1, .61, .3][k] }));
      return { n, petal: [.38, m.curl * .5, m.bend * .5, 1], rings, haze: { p: .35 * m.haze, R0: .5, R1: .8 + .4 * m.haze, zh: -.06, Hz: .5, col: .62, spin: m.twist } };
    },
  },
  flower: {
    label: 'Flame flower (symmetry inside the IFS)',
    macros: { petals: [6, 3, 12, 1], open: [.15, 0, 1.2, .01], curl: [.25, -1.5, 1.5, .01], twist: [.3, -3.14, 3.14, .01], haze: [.35, 0, 1, .01], lift: [.3, -.4, .8, .01] },
    A: { open: .05, curl: .15, twist: .1, haze: .25, lift: .15 },
    B: { open: 1.05, curl: .9, twist: 1.1, haze: .45, lift: .45 },
    view: { xw: 0, yw: 0, zw: 0, el: .55, az: .4 },
    build(m) {
      const n = Math.round(m.petals);
      return [
        xf({ w: 1.0, ang: { xy: 2 * Math.PI / n }, speed: 0 }),                                                     // D_n symmetry: rotation only
        xf({ w: 1.0, s: .56, ang: { xz: .25 + .9 * m.open, zw: m.curl }, b: [.52, 0, .04, 0], v: { lin: .85, bubble: .15 }, col: .08 }), // outer petal
        xf({ w: .7, s: .42, ang: { xy: Math.PI / n, xz: .55 + 1.1 * m.open, zw: -.7 * m.curl }, b: [.27, 0, .12 + .3 * m.lift, .06], v: { lin: .9, swirl: .1 }, col: .42 }), // inner petal
        xf({ w: .35, s: .3, ang: { xy: m.twist, zw: .5 * m.twist }, b: [0, 0, .25 + .5 * m.lift, 0], v: { sph: .25, bubble: .75 }, col: .86 }), // core
        xf({ w: .05 + .5 * m.haze, s: .74, ang: { xw: .6, yz: .4, zw: m.twist }, b: [0, 0, -.05, .22], v: { sin: .6, swirl: .4 }, col: .64 }), // nebula haze
      ];
    },
  },
  sheet: {
    label: 'Flat flame → thick (the 2-D-sheet problem)',
    macros: { thick: [.04, 0, 1, .01], swirl: [.35, 0, 1.5, .01], tilt: [0, -1.5, 1.5, .01] },
    A: { thick: .02, swirl: .3, tilt: 0 },
    B: { thick: .9, swirl: .6, tilt: .6 },
    view: { xw: 0, yw: 0, zw: 0, el: .9, az: .3 },
    build(m) {
      const corner = (k) => [.5 * Math.cos(k * 2.0944 + 1.5708), .5 * Math.sin(k * 2.0944 + 1.5708), 0, 0];
      // classic 3-map gasket in xy; z contracts by 'thick' (≈0 → every map squashes z → a sheet); tilt mixes z into x,y
      return [0, 1, 2].map(k => xf({ w: 1, diag: [.5, .5, .5 * m.thick, .5], ang: { xz: m.tilt * (k - 1), yz: .5 * m.tilt }, b: corner(k).map((c, a) => a === 2 ? .25 * m.thick * (k - 1) : c), v: { lin: 1 - .25 * m.swirl, swirl: .25 * m.swirl }, col: k / 2 }));
    },
  },
  sponge: {
    label: 'Menger sponge (solid 3-D reference)',
    macros: { gap: [.333, .2, .4, .001], twist: [0, -.6, .6, .01], wlift: [0, 0, .5, .01] },
    A: { gap: .333, twist: 0, wlift: 0 },
    B: { gap: .3, twist: .35, wlift: .3 },
    view: { xw: 0, yw: 0, zw: 0, el: .5, az: .6 },
    build(m) {
      const out = [];
      for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
        if ((i === 0) + (j === 0) + (k === 0) >= 2) continue;
        out.push(xf({ w: 1, s: m.gap, ang: { xy: m.twist * i, zw: m.wlift }, b: [2 * i / 3, 2 * j / 3, 2 * k / 3, 0], v: { lin: 1 }, col: (i + j + k + 3) / 6 }));
      }
      return out;
    },
  },
};

// one map's linear part, row-major 4x4
export function linOf(t) {
  let A = rot(t.ang);
  const d = t.diag ?? [t.s, t.s, t.s, t.s];
  return A.map((x, idx) => x * d[idx % 4]);   // A·diag(d): scale then rotate
}

// ---------- uniform packing (what the GPU gets; the CPU mirror reads the SAME arrays) ----------
export function pack(xfs, fin = null) {
  if (xfs.length > MAXT) throw new Error(`too many maps: ${xfs.length} > ${MAXT}`);
  const A = new Float32Array(MAXT * 16), B = new Float32Array(MAXT * 4), V = new Float32Array(MAXT * 4), V2 = new Float32Array(MAXT * 4);
  const tot = xfs.reduce((s, t) => s + t.w, 0); let cum = 0;
  xfs.forEach((t, k) => {
    const L = linOf(t);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) A[k * 16 + c * 4 + r] = L[r * 4 + c];   // column-major for GLSL mat4
    B.set(t.b, k * 4);
    V.set([t.v.lin ?? 0, t.v.sph ?? 0, t.v.swirl ?? 0, t.v.bubble ?? 0], k * 4);
    cum += t.w / tot;
    V2.set([t.v.sin ?? 0, t.col, t.speed, k === xfs.length - 1 ? 1 : cum], k * 4);
  });
  return { A, B, V, V2, n: xfs.length, F: packFinal(fin) };
}
// final map uniforms (Float32, so the CPU mirror sees exactly what the GPU sees)
function packFinal(f) {
  if (!f) return { on: 0 };
  const RM = new Float32Array(48), RG = new Float32Array(12), tot = f.rings.reduce((s, r) => s + r.w, 0); let cum = 0;
  f.rings.forEach((r, k) => {
    const c = Math.cos(r.th), s = Math.sin(r.th), sc = r.sc;   // Tilt(θ)·diag(sc,sc,sc,1), column-major
    RM.set([sc * c, 0, sc * s, 0, 0, sc, 0, 0, -sc * s, 0, sc * c, 0, 0, 0, 0, 1], k * 16);
    cum += r.w / tot; RG.set([r.z0, r.ph, k === 2 ? 1 : cum, r.col], k * 4);
  });
  const h = f.haze;
  return { on: 1, petal: new Float32Array(f.petal), RM, RG, haze: new Float32Array([h.p, h.R0, h.R1, h.zh]), haze2: new Float32Array([h.Hz, h.col, h.spin, f.n]) };
}

// ---------- CPU float64 mirror of EVAL_FS ----------
// opts.transposeStep: planted fault for control J (uses DFᵀ in the chain instead of DF, final map included)
export function evalCPU(i, P, U, opts = {}) {
  const { K, KS, seed, R4, L } = P;
  const x = [0, 1, 2, 3].map(c => 2 * h01(i, 4096 + c, seed) - 1);
  let c = h01(i, 8191, seed);
  let J = eye4();
  let X = x;
  const pick = (u) => { for (let t = 0; t < U.n; t++) if (u < U.V2[t * 4 + 3]) return t; return U.n - 1; };
  for (let j = K - 1; j >= 0; j--) {
    const t = pick(h01(i, j, seed));
    const { y, D } = mapCPU(X, t, U);
    if (j < KS) J = mul4(opts.transposeStep ? tr4(D) : D, J);
    X = y; c = c + (U.V2[t * 4 + 1] - c) * U.V2[t * 4 + 2];
  }
  const Xs = X;
  if (U.F.on) { const r = finalCPU(X, i, seed, U.F); X = r.x; J = mul4(opts.transposeStep ? tr4(r.D) : r.D, J); c = c + (r.col - c) * .35; }
  return { ...finish(X, J, c, R4, L), x: Xs };
}
// column-major 16 → row-major
const cm2rm = (a, o = 0) => { const M = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) M[r * 4 + c] = a[o + c * 4 + r]; return M; };
export function finalCPU(X, i, seed, F) {
  const uf = h01(i, 9001, seed), TAU = 6.2831853;
  if (uf < F.haze[0]) {
    const al = TAU * X[0] + F.haze2[2], rho = F.haze[1] + F.haze[2] * X[1], ca = Math.cos(al), sa = Math.sin(al), R1 = F.haze[2], Hz = F.haze2[0];
    return { x: [rho * ca, rho * sa, F.haze[3] + Hz * X[2], X[3]], D: [-TAU * rho * sa, R1 * ca, 0, 0, TAU * rho * ca, R1 * sa, 0, 0, 0, 0, Hz, 0, 0, 0, 0, 1], col: F.haze2[1] };
  }
  const uu = (uf - F.haze[0]) / (1 - F.haze[0]), k = uu < F.RG[2] ? 0 : uu < F.RG[6] ? 1 : 2;
  const n = F.haze2[3], m = Math.floor(h01(i, 9002, seed) * n), ph = F.RG[k * 4 + 1] + TAU * m / n, cp = Math.cos(ph), sp = Math.sin(ph);
  const [Wd, Cup, Bend, Th] = F.petal, u = X[0], s = 2 * (X[1] - .5), hw = Wd * 4 * u * (1 - u), dhw = Wd * 4 * (1 - 2 * u);
  const loc = [u, hw * s, Cup * hw * s * s + Bend * u * u + Th * X[2], X[3]];
  const Jl = [1, 0, 0, 0, dhw * s, 2 * hw, 0, 0, Cup * dhw * s * s + 2 * Bend * u, 4 * Cup * hw * s, Th, 0, 0, 0, 0, 1];   // row-major
  const Rp = [cp, -sp, 0, 0, sp, cp, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], M = mul4(Rp, cm2rm(F.RM, k * 16));
  const x = [0, 1, 2, 3].map(r => M[r * 4] * loc[0] + M[r * 4 + 1] * loc[1] + M[r * 4 + 2] * loc[2] + M[r * 4 + 3] * loc[3] + (r === 2 ? F.RG[k * 4] : 0));
  return { x, D: mul4(M, Jl), col: F.RG[k * 4 + 3] };
}
export function mapCPU(X, t, U) {
  const A = U.A.subarray(t * 16, t * 16 + 16), b = U.B.subarray(t * 4, t * 4 + 4);
  const q = [0, 1, 2, 3].map(r => A[r] * X[0] + A[4 + r] * X[1] + A[8 + r] * X[2] + A[12 + r] * X[3] + b[r]);
  const Am = []; for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) Am[r * 4 + cc] = A[cc * 4 + r];
  const [wl, ws, wsw, wb] = U.V.subarray(t * 4, t * 4 + 4), wsn = U.V2[t * 4];
  const { v, D } = variations(q, wl, ws, wsw, wb, wsn);
  return { y: v, D: mul4(D, Am) };
}
export function variations(q, wl, ws, wsw, wb, wsn) {
  const r2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  const v = [0, 0, 0, 0], D = new Array(16).fill(0);
  const addI = (k) => { for (let a = 0; a < 4; a++) D[a * 5] += k; };
  const addQQ = (k) => { for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) D[a * 4 + b] += k * q[a] * q[b]; };
  if (wl) { for (let a = 0; a < 4; a++) v[a] += wl * q[a]; addI(wl); }
  if (ws) { const e = r2 + 1e-6; for (let a = 0; a < 4; a++) v[a] += ws * q[a] / e; addI(ws / e); addQQ(-2 * ws / (e * e)); }
  if (wsw) {
    const cs = Math.cos(r2), sn = Math.sin(r2);
    const V = [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs, q[2] * cs - q[3] * sn, q[2] * sn + q[3] * cs];
    const dV = [-q[0] * sn - q[1] * cs, q[0] * cs - q[1] * sn, -q[2] * sn - q[3] * cs, q[2] * cs - q[3] * sn];
    for (let a = 0; a < 4; a++) v[a] += wsw * V[a];
    const Rm = [cs, -sn, 0, 0, sn, cs, 0, 0, 0, 0, cs, -sn, 0, 0, sn, cs];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) D[a * 4 + b] += wsw * (Rm[a * 4 + b] + dV[a] * 2 * q[b]);
  }
  if (wb) { const k = 4 / (r2 + 4); for (let a = 0; a < 4; a++) v[a] += wb * k * q[a]; addI(wb * k); addQQ(-8 * wb / ((r2 + 4) * (r2 + 4))); }
  if (wsn) { for (let a = 0; a < 4; a++) { v[a] += wsn * Math.sin(q[a]); D[a * 5] += wsn * Math.cos(q[a]); } }
  return { v, D };
}
const tr4 = (M) => { const T = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) T[r * 4 + c] = M[c * 4 + r]; return T; };
function finish(X, J, c, R4, L) {
  const y = [0, 1, 2, 3].map(r => R4[r * 4] * X[0] + R4[r * 4 + 1] * X[1] + R4[r * 4 + 2] * X[2] + R4[r * 4 + 3] * X[3]);
  const M = mul4(mul4(R4, J), L);
  const S = (a, b) => (M[a * 4] * M[b * 4] + M[a * 4 + 1] * M[b * 4 + 1] + M[a * 4 + 2] * M[b * 4 + 2] + M[a * 4 + 3] * M[b * 4 + 3]);
  const Sig = [S(0, 0), S(0, 1), S(0, 2), S(1, 1), S(1, 2), S(2, 2)];
  return { x: X, y: y.slice(0, 3), w: y[3], c, J, Sig, flat: flatness(Sig) };
}
// sqrt(λ3/λ2) of the 3-D splat covariance: 0 = a sheet (or a thread), 1 = round in its two smallest directions
export function flatness([a00, a01, a02, a11, a12, a22]) {
  const tr = a00 + a11 + a22; if (!(tr > 0)) return 1;
  const n = [a00, a01, a02, a11, a12, a22].map(x => x / tr), e = eig3(n);
  return Math.sqrt(Math.max(e[2], 0) / Math.max(e[1], 1e-30));
}
export function eig3([a00, a01, a02, a11, a12, a22]) {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12, q = (a00 + a11 + a22) / 3;
  const p2 = (a00 - q) ** 2 + (a11 - q) ** 2 + (a22 - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  if (p < 1e-30) return [q, q, q];
  const b00 = (a00 - q) / p, b11 = (a11 - q) / p, b22 = (a22 - q) / p, b01 = a01 / p, b02 = a02 / p, b12 = a12 / p;
  const r = (b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02)) / 2;
  const phi = Math.acos(Math.min(1, Math.max(-1, r))) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
  return [e1, 3 * q - e1 - e3, e3];
}

// ---------- GLSL ----------
const HDR = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
export const FULL_VS = HDR + 'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}';

export const EVAL_FS = HDR + `
#define MAXT ${MAXT}
uniform mat4 uA[MAXT];uniform vec4 uB[MAXT],uV[MAXT],uV2[MAXT];uniform int uN,uK,uKS,uW;uniform uint uSeed;
uniform mat4 uR4,uL;uniform int uFinal;uniform vec4 uPetal,uRing[3],uHaze,uHaze2;uniform mat4 uRingM[3];
layout(location=0)out vec4 o0;layout(location=1)out vec4 o1;layout(location=2)out vec4 o2;
uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
float h01(uint i,uint j){return float(pcg(pcg(i)^(j*0x9E3779B9u+uSeed))>>8u)/16777216.;}
int pick(float u){for(int t=0;t<MAXT;t++){if(t>=uN)break;if(u<uV2[t].w)return t;}return uN-1;}
vec4 vars(vec4 q,int t,out mat4 D){
  float r2=dot(q,q);vec4 w=uV[t];float wsn=uV2[t].x;vec4 v=vec4(0);D=mat4(0);
  if(w.x!=0.){v+=w.x*q;D+=mat4(w.x);}
  if(w.y!=0.){float e=r2+1e-6;v+=w.y*q/e;D+=mat4(w.y/e)-outerProduct(q,q)*(2.*w.y/(e*e));}
  if(w.z!=0.){float cs=cos(r2),sn=sin(r2);
    vec4 V=vec4(q.x*cs-q.y*sn,q.x*sn+q.y*cs,q.z*cs-q.w*sn,q.z*sn+q.w*cs);
    vec4 dV=vec4(-q.x*sn-q.y*cs,q.x*cs-q.y*sn,-q.z*sn-q.w*cs,q.z*cs-q.w*sn);
    v+=w.z*V;D+=w.z*(mat4(cs,sn,0,0, -sn,cs,0,0, 0,0,cs,sn, 0,0,-sn,cs)+outerProduct(dV,2.*q));}
  if(w.w!=0.){float k=4./(r2+4.);v+=w.w*k*q;D+=mat4(w.w*k)-outerProduct(q,q)*(8.*w.w/((r2+4.)*(r2+4.)));}
  if(wsn!=0.){v+=wsn*sin(q);vec4 cq=cos(q);D+=mat4(wsn*cq.x,0,0,0, 0,wsn*cq.y,0,0, 0,0,wsn*cq.z,0, 0,0,0,wsn*cq.w);}
  return v;}
void main(){
  ivec2 px=ivec2(gl_FragCoord.xy);uint i=uint(px.y*uW+px.x);
  vec4 x=vec4(h01(i,4096u),h01(i,4097u),h01(i,4098u),h01(i,4099u))*2.-1.;
  float c=h01(i,8191u);mat4 J=mat4(1);
  for(int j=63;j>=0;j--){if(j>=uK)continue;
    int t=pick(h01(i,uint(j)));
    vec4 q=uA[t]*x+uB[t];mat4 D;vec4 y=vars(q,t,D);
    if(j<uKS)J=(D*uA[t])*J;
    x=y;c=c+(uV2[t].y-c)*uV2[t].z;}
  if(uFinal==1){float uf=h01(i,9001u);vec4 nx;mat4 DF;
    if(uf<uHaze.x){float al=6.2831853*x.x+uHaze2.z,rho=uHaze.y+uHaze.z*x.y,ca=cos(al),sa=sin(al);
      nx=vec4(rho*ca,rho*sa,uHaze.w+uHaze2.x*x.z,x.w);
      DF=mat4(-6.2831853*rho*sa,6.2831853*rho*ca,0,0, uHaze.z*ca,uHaze.z*sa,0,0, 0,0,uHaze2.x,0, 0,0,0,1);c=c+(uHaze2.y-c)*.35;}
    else{float uu=(uf-uHaze.x)/(1.-uHaze.x);int k=uu<uRing[0].z?0:uu<uRing[1].z?1:2;
      float n=uHaze2.w,m=floor(h01(i,9002u)*n),ph=uRing[k].y+6.2831853*m/n,cp=cos(ph),sp=sin(ph);
      float u=x.x,s=2.*(x.y-.5),hw=uPetal.x*4.*u*(1.-u),dhw=uPetal.x*4.*(1.-2.*u);
      vec4 loc=vec4(u,hw*s,uPetal.y*hw*s*s+uPetal.z*u*u+uPetal.w*x.z,x.w);
      mat4 Jl=mat4(1.,dhw*s,uPetal.y*dhw*s*s+2.*uPetal.z*u,0., 0.,2.*hw,4.*uPetal.y*hw*s,0., 0.,0.,uPetal.w,0., 0.,0.,0.,1.);
      mat4 Rp=mat4(cp,sp,0,0, -sp,cp,0,0, 0,0,1,0, 0,0,0,1),Mk=Rp*uRingM[k];
      nx=Mk*loc+vec4(0,0,uRing[k].x,0);DF=Mk*Jl;c=c+(uRing[k].w-c)*.35;}
    x=nx;J=DF*J;}
  vec4 yv=uR4*x;mat4 M=uR4*J*uL;
  vec4 r0=vec4(M[0][0],M[1][0],M[2][0],M[3][0]),r1=vec4(M[0][1],M[1][1],M[2][1],M[3][1]),r2=vec4(M[0][2],M[1][2],M[2][2],M[3][2]);
  float s2=1.;
  float a00=s2*dot(r0,r0),a01=s2*dot(r0,r1),a02=s2*dot(r0,r2),a11=s2*dot(r1,r1),a12=s2*dot(r1,r2),a22=s2*dot(r2,r2);
  // flatness: sqrt(l3/l2) of the trace-normalised covariance
  float tr=a00+a11+a22,fl=1.;
  if(tr>0.){float b00=a00/tr,b01=a01/tr,b02=a02/tr,b11=a11/tr,b12=a12/tr,b22=a22/tr;
    float p1=b01*b01+b02*b02+b12*b12,q=1./3.,p2=(b00-q)*(b00-q)+(b11-q)*(b11-q)+(b22-q)*(b22-q)+2.*p1,p=sqrt(p2/6.);
    if(p>1e-12){float c00=(b00-q)/p,c11=(b11-q)/p,c22=(b22-q)/p,c01=b01/p,c02=b02/p,c12=b12/p;
      float r=(c00*(c11*c22-c12*c12)-c01*(c01*c22-c12*c02)+c02*(c01*c12-c11*c02))/2.;
      float phi=acos(clamp(r,-1.,1.))/3.,e1=q+2.*p*cos(phi),e3=q+2.*p*cos(phi+2.0943951);
      fl=sqrt(max(e3,0.)/max(3.*q-e1-e3,1e-30));}}
  o0=vec4(yv.xyz,yv.w);o1=vec4(a00,a01,a02,c);o2=vec4(a11,a12,a22,fl);}`;

// Splats: instanced quad over the 3-sigma ellipse of the projected covariance (the melt's conic: perspective Jacobian,
// a floor in px², constant energy per point). Style 0 points, 1 round (same trace, no orientation), 2 b-splat (full Σ).
export const SPLAT_VS = HDR + `
uniform sampler2D uP0,uP1,uP2;uniform int uW,uStyle;uniform mat3 uCam;uniform vec3 uEye;uniform vec2 uRes;
uniform float uTan,uSize,uFloor,uMaxR,uEnergy,uWHue,uWScale,uShift;uniform vec3 uPa,uPb,uPc,uPd;
out vec2 vD;out vec3 vInv,vC;out float vA;
vec3 pal(float t){return uPa+uPb*cos(6.2831853*(uPc*t+uPd));}
void main(){int id=gl_VertexID,n=gl_InstanceID;ivec2 tx=ivec2(n%uW,n/uW);
  vec4 p0=texelFetch(uP0,tx,0),p1=texelFetch(uP1,tx,0),p2=texelFetch(uP2,tx,0);
  vec2 cr=vec2((id==1||id==2||id==4)?1.:-1.,(id==2||id==4||id==5)?1.:-1.);
  mat3 R=transpose(uCam);vec3 v=R*(p0.xyz-uEye);float zz=-v.z;
  if(zz<.02||any(isnan(p0))){gl_Position=vec4(2,2,2,1);vA=0.;vD=vec2(0);vInv=vec3(0);vC=vec3(0);return;}
  float f=uRes.y*.5/uTan;vec2 ndc=vec2(v.x/(zz*uTan*uRes.x/uRes.y),v.y/(zz*uTan));
  vec3 j0=vec3(f/zz,0.,f*v.x/(zz*zz)),j1=vec3(0.,f/zz,f*v.y/(zz*zz));
  mat3 S=mat3(p1.x,p1.y,p1.z, p1.y,p2.x,p2.y, p1.z,p2.y,p2.z);
  mat3 Sv=uStyle==0?mat3(0):uStyle==1?mat3((p1.x+p2.x+p2.z)/3.):R*S*transpose(R);
  float s2=uSize*uSize;
  float a00=dot(j0,Sv*j0)*s2+uFloor,a01=dot(j0,Sv*j1)*s2,a11=dot(j1,Sv*j1)*s2+uFloor;
  float det=max(a00*a11-a01*a01,1e-12),mid=.5*(a00+a11),dd=sqrt(max(mid*mid-det,0.)),l1=mid+dd,l2=max(mid-dd,1e-6);
  vec2 e1=abs(a01)>1e-9?normalize(vec2(a01,l1-a00)):(a00>=a11?vec2(1,0):vec2(0,1)),e2=vec2(-e1.y,e1.x);
  float r1=min(3.*sqrt(l1),uMaxR),r2=min(3.*sqrt(l2),uMaxR);
  vD=e1*cr.x*r1+e2*cr.y*r2;vInv=vec3(a11,-a01,a00)/det;
  gl_Position=vec4(ndc+vD/(uRes*.5)+vec2(uShift,0),0,1);
  vA=uEnergy/(6.2831853*sqrt(det));
  vec3 wc=.55+.45*cos(6.2831853*(clamp(p0.w*uWScale,-1.,1.)*.5+vec3(0.,.33,.67)));
  vC=mix(max(pal(p1.w),0.),wc,uWHue);}`;
export const SPLAT_FS = HDR + `in vec2 vD;in vec3 vInv,vC;in float vA;out vec4 o;
void main(){float pw=-.5*(vInv.x*vD.x*vD.x+2.*vInv.y*vD.x*vD.y+vInv.z*vD.y*vD.y);if(pw<-4.5)discard;float a=vA*exp(pw);o=vec4(vC*a,a);}`;
// Flame tone map: log density × mean colour, gamma, soft highlight.
export const TONE_FS = HDR + `uniform sampler2D uSum;uniform float uExposure,uGamma;uniform vec3 uBg;out vec4 o;
void main(){vec4 s=texelFetch(uSum,ivec2(gl_FragCoord.xy),0);
  if(s.a<=1e-8){o=vec4(uBg,1);return;}
  float L=pow(log(1.+s.a*uExposure)/log(1.+uExposure*4.),1./uGamma);
  vec3 c=1.-exp(-1.7*(s.rgb/s.a)*L);o=vec4(mix(uBg,c,min(1.,L*1.3)),1);}`;

export const PALETTES = {
  lotus: [[.62, .5, .62], [.38, .32, .3], [1, 1, 1], [.0, .12, .28]],
  ember: [[.5, .3, .2], [.5, .35, .25], [1, .8, .6], [0, .1, .2]],
  ice: [[.45, .6, .75], [.35, .3, .25], [1, 1, 1], [.55, .6, .65]],
  spectrum: [[.5, .5, .5], [.5, .5, .5], [1, 1, 1], [0, .33, .67]],
};
export function palCPU(name, t) { const [a, b, c, d] = PALETTES[name]; return [0, 1, 2].map(k => Math.max(0, a[k] + b[k] * Math.cos(2 * Math.PI * (c[k] * t + d[k])))); }

// entropy-based default splat depth: number of depth-KS copies ≈ N
export function autoKS(xfs, N) {
  const tot = xfs.reduce((s, t) => s + t.w, 0); const H = -xfs.reduce((s, t) => { const p = t.w / tot; return s + (p > 0 ? p * Math.log(p) : 0); }, 0);
  return Math.max(1, Math.min(16, Math.round(Math.log(N) / Math.max(H, .3))));
}

// attractor covariance (4-D, IFS space) from a sample of points, and its Cholesky factor L (row-major), Σ_A = L Lᵀ
export function attractorL(xs) {
  const n = xs.length, m = [0, 1, 2, 3].map(a => xs.reduce((s, x) => s + x[a], 0) / n), C = new Array(16).fill(0);
  for (const x of xs) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) C[a * 4 + b] += (x[a] - m[a]) * (x[b] - m[b]) / n;
  const tr = C[0] + C[5] + C[10] + C[15]; for (let a = 0; a < 4; a++) C[a * 5] += 1e-10 * tr + 1e-30;
  const L = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) { let s = C[i * 4 + j]; for (let k = 0; k < j; k++) s -= L[i * 4 + k] * L[j * 4 + k]; L[i * 4 + j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j * 4 + j]; }
  return { L, C, mean: m, rms: Math.sqrt(tr / 4) };
}

// ---------- scene helpers (bones): presets → uniforms, easing between keyframes, attractor fits ----------
export const EASE = {
  linear: t => t, smooth: t => t * t * (3 - 2 * t), cubic: t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  sine: t => -(Math.cos(Math.PI * t) - 1) / 2, back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
};
export const defaultMacros = (preset) => Object.fromEntries(Object.entries(PRESETS[preset].macros).map(([k, v]) => [k, v[0]]));
// macros at eased t between keyframes A and B (a key missing from A/B keeps base[k]; petals never eases)
export function macrosAt(preset, A, B, base, t, ease = 'smooth') {
  const e = EASE[ease](t), m = {};
  for (const k of Object.keys(PRESETS[preset].macros)) { const a = A[k] ?? base[k], b = B[k] ?? base[k]; m[k] = k === 'petals' ? base[k] : a + (b - a) * e; }
  return m;
}
export function sceneU(preset, m) { const pr = PRESETS[preset], xfs = pr.build(m); return { xfs, U: pack(xfs, pr.final?.(m)) }; }
// Σ_A = L Lᵀ of the IFS attractor (pre-final), from a CPU sample; refresh it whenever the maps change
export function fitL(U, P, n = 384) {
  const xs = []; for (let i = 0; i < n; i++) { const r = evalCPU(i * 977 + 13, { ...P, KS: 1 }, U); if (r.x.every(Number.isFinite)) xs.push(r.x); }
  const A = attractorL(xs); return { L: A.L, sigma: A.rms };
}
// camera frame over one or more scenes (e.g. both keyframes): centre and 95th-percentile radius of the displayed points
export function fitFrame(Us, P, n = 1500) {
  const ys = []; for (const U of Us) for (let i = 0; i < n / Us.length; i++) { const r = evalCPU(i * 977 + 13, { ...P, KS: 1 }, U); if (r.y.every(Number.isFinite)) ys.push(r.y); }
  const ctr = [0, 1, 2].map(a => ys.reduce((s, y) => s + y[a], 0) / ys.length);
  const d = ys.map(y => Math.hypot(y[0] - ctr[0], y[1] - ctr[1], y[2] - ctr[2])).sort((a, b) => a - b);
  return { ctr, R: d[Math.floor(d.length * .95)] || 1 };
}
