// The sand engine keeps its heightfield in R32F textures sampled LINEAR. That needs
// OES_texture_float_linear, which some phone GPUs don't expose (a customer's iPhone 13
// Pro on iOS 27.2.1, 2026-11-18; WebKit bug 282111; many Android GPUs). Without it those
// textures are INCOMPLETE and every read gives 0: the sand stays flat (no clear, no
// grooves) while the ball still moves and nothing reports an error.
//
// SandView injects this before the sand page loads (NOT into the page: the page is the
// engine's KEY, and a change there re-renders every hub preview). Only where the
// extension is missing, it makes the textures NEAREST (complete without it) and does
// the bilinear filtering in the shaders, the GPU's own formula, so the sand looks the
// same. Plain JS in a string: Hermes keeps no function source to stringify.
// `npm run check-sand-shim` renders a still with the extension hidden, with and without it.

const GLSL = `vec4 texLinear(sampler2D s, vec2 uv) {
  ivec2 hi = textureSize(s, 0) - 1;
  vec2 p = uv * vec2(hi + 1) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  vec4 a = texelFetch(s, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(s, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(s, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(s, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`

export const FLOAT_LINEAR_SHIM = `(() => {
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype
  if (!P) return
  const getExtension = P.getExtension
  const known = new WeakMap()
  const linear = (gl) => {
    if (!known.has(gl)) known.set(gl, !!getExtension.call(gl, 'OES_texture_float_linear'))
    return known.get(gl)
  }
  const texParameteri = P.texParameteri
  P.texParameteri = function (target, pname, param) {
    if (param === this.LINEAR && (pname === this.TEXTURE_MIN_FILTER || pname === this.TEXTURE_MAG_FILTER) && !linear(this)) param = this.NEAREST
    return texParameteri.call(this, target, pname, param)
  }
  const shaderSource = P.shaderSource
  P.shaderSource = function (shader, src) {
    if (!linear(this)) src = src.replace('precision highp float;', 'precision highp float;\\n' + ${JSON.stringify(GLSL)}).replace(/\\btexture\\(/g, 'texLinear(')
    return shaderSource.call(this, shader, src)
  }
})();`
