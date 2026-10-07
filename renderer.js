// renderer.js: Lotus nebula GL passes (bones). Eval (one texel = one point: position, Σ, colour, flatness) → instanced
// b-splats into a float sum → flame log-density tone map. No UI, no page state: every pass takes a plain state object.
//
//   st  = { U, K, KS, seed, R4 (row-major 4x4 array), L (row-major), style 0|1|2, size, floor, exposure (log10), gamma,
//           palette (name in PALETTES), whue, sigma, shift (NDC x offset, default 0) }
//   cam = { az, el, dist, ctr: [x,y,z], fov }   (z up)
import { PALETTES, FULL_VS, EVAL_FS, SPLAT_VS, SPLAT_FS, TONE_FS } from './ifs.js';

export function cameraOf(c) {
  const ce = Math.cos(c.el), dir = [ce * Math.cos(c.az), ce * Math.sin(c.az), Math.sin(c.el)];
  const eye = c.ctr.map((x, a) => x + c.dist * dir[a]), fwd = dir.map(x => -x);
  const n = (v) => { const l = Math.hypot(...v); return v.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const right = n(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
  return { eye, mat: new Float32Array([...right, ...up, ...fwd.map(x => -x)]), tan: Math.tan(c.fov / 2) };
}
const colMajor = (m) => { const o = new Float32Array(16); for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) o[b * 4 + a] = m[a * 4 + b]; return o; };

export function createRenderer(canvas, { preserveDrawingBuffer = false } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer });
  if (!gl) throw new Error('WebGL2 not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not available (float render targets)');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const GPU = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  function prog(vs, fs, name) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name} shader: ${gl.getShaderInfoLog(s)}`); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
    const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const nm = gl.getActiveUniform(p, k).name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, nm); }
    return { p, U, name };
  }
  // uniform-map guard: a key with no uniform throws at mount instead of silently doing nothing
  function need(P, keys) { const miss = keys.filter(k => !P.U[k]); if (miss.length) throw new Error(`${P.name}: no uniform for ${miss.join(', ')}`); }
  const EVAL = prog(FULL_VS, EVAL_FS, 'eval'), SPLAT = prog(SPLAT_VS, SPLAT_FS, 'splat'), TONE = prog(FULL_VS, TONE_FS, 'tone');
  need(EVAL, ['uA', 'uB', 'uV', 'uV2', 'uN', 'uK', 'uKS', 'uW', 'uSeed', 'uR4', 'uL', 'uFinal', 'uPetal', 'uRing', 'uRingM', 'uHaze', 'uHaze2']);
  need(SPLAT, ['uP0', 'uP1', 'uP2', 'uW', 'uStyle', 'uCam', 'uEye', 'uRes', 'uTan', 'uSize', 'uFloor', 'uMaxR', 'uEnergy', 'uWHue', 'uWScale', 'uShift', 'uPa', 'uPb', 'uPc', 'uPd']);
  need(TONE, ['uSum', 'uExposure', 'uGamma', 'uBg']);
  const vao = gl.createVertexArray();

  function tex(w, h, fmt) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; }
  function fbo(texs) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); texs.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0)); const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (s !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + s); return f; }

  let pts = null, sum = null;
  // W × H point textures (H = W, or 1024 for W = 2048)
  function setPoints(W) {
    if (pts) { pts.t.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(pts.f); }
    const H = W === 2048 ? 1024 : W, t = [0, 1, 2].map(() => tex(W, H, gl.RGBA32F)); pts = { W, H, N: W * H, t, f: fbo(t) };
    return pts;
  }
  function makeSum() { const w = canvas.width, h = canvas.height; if (sum?.w === w && sum?.h === h) return; if (sum) { gl.deleteTexture(sum.t); gl.deleteFramebuffer(sum.f); } const t = tex(w, h, gl.RGBA16F); sum = { w, h, t, f: fbo([t]) }; }

  function evalPass(st) {
    const U = st.U; gl.bindFramebuffer(gl.FRAMEBUFFER, pts.f); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, pts.W, pts.H); gl.disable(gl.BLEND); gl.useProgram(EVAL.p); const u = EVAL.U;
    gl.uniformMatrix4fv(u.uA, false, U.A); gl.uniform4fv(u.uB, U.B); gl.uniform4fv(u.uV, U.V); gl.uniform4fv(u.uV2, U.V2);
    gl.uniform1i(u.uN, U.n); gl.uniform1i(u.uK, st.K); gl.uniform1i(u.uKS, st.KS); gl.uniform1i(u.uW, pts.W); gl.uniform1ui(u.uSeed, st.seed >>> 0);
    gl.uniformMatrix4fv(u.uR4, false, colMajor(st.R4)); gl.uniformMatrix4fv(u.uL, false, colMajor(st.L));
    const F = U.F; gl.uniform1i(u.uFinal, F.on); if (F.on) { gl.uniform4fv(u.uPetal, F.petal); gl.uniform4fv(u.uRing, F.RG); gl.uniformMatrix4fv(u.uRingM, false, F.RM); gl.uniform4fv(u.uHaze, F.haze); gl.uniform4fv(u.uHaze2, F.haze2); }
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function drawPass(st, camState) {
    makeSum(); const cam = cameraOf(camState);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sum.f); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.viewport(0, 0, sum.w, sum.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(SPLAT.p); const u = SPLAT.U;
    pts.t.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.uniform1i(u.uP0, 0); gl.uniform1i(u.uP1, 1); gl.uniform1i(u.uP2, 2); gl.uniform1i(u.uW, pts.W); gl.uniform1i(u.uStyle, st.style);
    gl.uniformMatrix3fv(u.uCam, false, cam.mat); gl.uniform3fv(u.uEye, cam.eye); gl.uniform2f(u.uRes, sum.w, sum.h); gl.uniform1f(u.uTan, cam.tan);
    gl.uniform1f(u.uSize, st.size); gl.uniform1f(u.uFloor, st.floor); gl.uniform1f(u.uMaxR, 48); gl.uniform1f(u.uEnergy, sum.w * sum.h / pts.N);
    gl.uniform1f(u.uShift, st.shift ?? 0); gl.uniform1f(u.uWHue, st.whue); gl.uniform1f(u.uWScale, 1 / Math.max(st.sigma * 2, 1e-6));
    const [a, b, c, d] = PALETTES[st.palette]; gl.uniform3fv(u.uPa, a); gl.uniform3fv(u.uPb, b); gl.uniform3fv(u.uPc, c); gl.uniform3fv(u.uPd, d);
    gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pts.N);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(TONE.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sum.t); gl.uniform1i(TONE.U.uSum, 0);
    gl.uniform1f(TONE.U.uExposure, 10 ** st.exposure); gl.uniform1f(TONE.U.uGamma, st.gamma); gl.uniform3f(TONE.U.uBg, .027, .023, .043);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // rows [0, rows) of the point textures (addresses are i.i.d., so a strip is a fair sample): [pos+w, Σ0..2+colour, Σ3..5+flatness]
  function readback(rows = pts.H) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, pts.f); const out = [];
    for (let k = 0; k < 3; k++) { gl.readBuffer(gl.COLOR_ATTACHMENT0 + k); const a = new Float32Array(pts.W * rows * 4); gl.readPixels(0, 0, pts.W, rows, gl.RGBA, gl.FLOAT, a); out.push(a); }
    return out;
  }
  return { gl, GPU, setPoints, evalPass, drawPass, readback, get pts() { return pts; } };
}
