// ply.js: 3DGS .ply writer (bones). Each splat's Σ (the displayed J Σ_A Jᵀ × size²) → eigen (Jacobi) → log scale and a
// rotation quaternion (w, x, y, z); colour → SH DC term. Binary little endian, the property set 3DGS viewers read.
import { palCPU } from './ifs.js';

export function jacobi3(a) {   // a = [a00,a01,a02,a11,a12,a22] → { l:[3], V: 3x3, columns = eigenvectors }
  const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2; if (off < 1e-30 * (A[0][0] ** 2 + A[1][1] ** 2 + A[2][2] ** 2) + 1e-300) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { l: [A[0][0], A[1][1], A[2][2]], V };
}
export function quatOf(V) {   // V columns = axes, det +1 → (w, x, y, z)
  const m00 = V[0][0], m01 = V[0][1], m02 = V[0][2], m10 = V[1][0], m11 = V[1][1], m12 = V[1][2], m20 = V[2][0], m21 = V[2][1], m22 = V[2][2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [(m21 - m12) / s, .25 * s, (m01 + m10) / s, (m02 + m20) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m02 - m20) / s, (m01 + m10) / s, .25 * s, (m12 + m21) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, .25 * s]; }
  const l = Math.hypot(...q); return q.map(x => x / l);
}
// rb = renderer.readback() arrays. opts: size, R (attractor radius, for the floor), sigma (w hue scale), palette, whue,
// opacity (0..1), minScale (× R; floors the sheet-thin axis, since 3DGS needs a scale > 0), quatOrder ('wxyz'), comment
export function writePly([p0, p1, p2], { N = p0.length / 4, size = 1, R = 1, sigma = 1, palette = 'lotus', whue = 0, opacity = .12, minScale = 1e-4, quatOrder = 'wxyz', comment = '' } = {}) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const valid = []; for (let i = 0; i < N; i++) if (Number.isFinite(p0[i * 4]) && Number.isFinite(p1[i * 4]) && Number.isFinite(p2[i * 4 + 2])) valid.push(i);
  const head = `ply\nformat binary_little_endian 1.0\n${comment ? `comment ${comment}\n` : ''}element vertex ${valid.length}\n` + props.map(p => `property float ${p}\n`).join('') + 'end_header\n';
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + valid.length * props.length * 4), dv = new DataView(buf, hb.length);   // DataView: the header length is not a multiple of 4
  new Uint8Array(buf).set(hb);
  const s2 = size * size, minS = Math.max(minScale * R, 1e-30), op = Math.log(opacity / (1 - opacity)), C0 = 0.28209479177387814;
  valid.forEach((i, n) => {
    const a = [p1[i * 4], p1[i * 4 + 1], p1[i * 4 + 2], p2[i * 4], p2[i * 4 + 1], p2[i * 4 + 2]].map(x => x * s2), { l, V } = jacobi3(a);
    const det = V[0][0] * (V[1][1] * V[2][2] - V[1][2] * V[2][1]) - V[0][1] * (V[1][0] * V[2][2] - V[1][2] * V[2][0]) + V[0][2] * (V[1][0] * V[2][1] - V[1][1] * V[2][0]);
    if (det < 0) for (let k = 0; k < 3; k++) V[k][2] = -V[k][2];
    const q = quatOf(V), qq = quatOrder === 'wxyz' ? q : [q[1], q[2], q[3], q[0]];
    const pc = palCPU(palette, p1[i * 4 + 3]), w = Math.max(-1, Math.min(1, p0[i * 4 + 3] / Math.max(sigma * 2, 1e-6)));
    const wc = [0, .33, .67].map(o => .55 + .45 * Math.cos(2 * Math.PI * (w * .5 + o))), rgb = pc.map((x, k) => x + (wc[k] - x) * whue);
    [p0[i * 4], p0[i * 4 + 1], p0[i * 4 + 2], 0, 0, 0, ...rgb.map(x => (x - .5) / C0), op, ...l.map(x => Math.log(Math.max(Math.sqrt(Math.max(x, 0)), minS))), ...qq].forEach((v, k) => dv.setFloat32((n * props.length + k) * 4, v, true));
  });
  return { buf, n: valid.length, headerBytes: hb.length, props };
}
