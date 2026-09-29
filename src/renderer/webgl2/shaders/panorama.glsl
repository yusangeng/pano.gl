// pano.gl panorama shader, WebGL2 backend.
//
// A line-by-line hand transcription of
// src/renderer/webgpu/shaders/panorama.wgsl -- nothing generates it and
// nothing type-checks the two against each other. Gate C is what holds them
// together: every camera state is rendered through both backends and the
// pixels are compared. If you change a formula here, change it in the WGSL
// too, and check src/core/reference.ts -- the CPU reference is the arbiter
// when the two backends disagree.
//
// THREE THINGS IN THIS FILE LOOK WRONG AND ARE NOT. Each has already been
// wrong once, which is why each has a test that names it:
//
//   1. `to_uv` has no `+ 0.5`. Adding one rotates the panorama half a turn.
//   2. `to_uv` flips v (`1.0 - phi / PI`). Removing the flip renders it upside
//      down.
//   3. No `atan2` anywhere: the quadrant fixups are transcriptions of v0.2.2,
//      and in pannini the two are not equivalent. See the comments at each
//      site.
//
// WHAT IS *NOT* SHARED: the uniform layout. WebGPU packs the camera into one
// 96-byte block; WebGL2 uses named uniforms. The semantics are shared, the
// storage is not.
//
// The fragment stage inverts the camera matrix to recover the surface point.
// Both depth conventions put the far plane at ndc z = +1, so this file does
// not need to know which convention built the matrix.

// `#define CAMERA_PROJECTION_*` and `#define TEXTURE_PROJECTION_EQUIRECTANGULAR`
// are prepended above this file by shaders/index.ts, generated from
// src/core/projection-kinds.json. They are the only place those numbers appear;
// there is no numeric literal for a projection kind anywhere below.

precision highp float;
// Not required by ES 3.00 in the fragment stage, but the projection codes are
// integers compared against the generated `#define`s, and that comparison has
// exactly one correct outcome. Pinning the precision removes one variable.
precision highp int;

// Interpolated from the vertex stage rather than derived from gl_FragCoord:
// the builtin is in framebuffer pixels, which would need the viewport size,
// which would mean another uniform and a resolution-dependent bug class.
in vec2 v_ndc;

uniform mat4 u_invClip;
uniform int u_projKind;
uniform int u_texProjKind;
uniform float u_povLatitude;
uniform float u_povLongitude;
uniform float u_zoom;

uniform sampler2D u_tex;

out vec4 outColor;

const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;
const float TWO_PI = 6.283185307179586;

// Equirectangular coordinate from an angle pair. Two deliberate choices,
// mirroring `to_uv` in the WGSL:
//
//   1. u is wrapped by `mod`, which is `x - y * floor(x / y)` -- the same
//      function as the WGSL's `fract(theta / TWO_PI)`, and NOT WGSL's `%`,
//      which truncates toward zero and would put a seam in the panorama
//      wherever theta is negative. The wrap stands in for the sampler's REPEAT
//      wherever that mode is unavailable, and the cross-seam and cross-pole
//      LINEAR blend is the sampler's, not this function's -- clamp-to-edge
//      cannot express it (gate A measured the seam blend at up to 124 LSB).
//      The sampler modes are set per source kind in backend.ts to mirror
//      WebGPU: still REPEAT on both axes, video clamp-to-edge.
//
//   2. v is FLIPPED. The flip lives in the shader once, for every source
//      path, so the two backends cannot disagree about it -- which means this
//      backend uploads with UNPACK_FLIP_Y_WEBGL explicitly false (see
//      backend.ts) and reverses the flip here. Removing it from one side only
//      flips the picture, and removing it from both would break gate A
//      against the baseline.
vec2 to_uv (float theta, float phi) {
  return vec2(mod(theta / TWO_PI, 1.0), 1.0 - phi / PI);
}

// The linear (perspective) projection. Scale-invariant -- every term is a
// ratio, which is why the cube could be replaced by a triangle.
//
// `atan(s.z / s.x)` plus the fixups is deliberately NOT `atan(s.z, s.x)`. The
// two agree here, but the same shape is load-bearing in project_pannini, where
// they do not, and keeping all four projections in the reference's shape is
// what makes the two files readable side by side.
vec2 project_linear (vec3 s) {
  float theta = atan(s.z / s.x);

  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  float phi = atan(s.y / sqrt(s.x * s.x + s.z * s.z)) + HALF_PI;
  return to_uv(theta, phi);
}

// The three non-linear projections read the MAGNITUDE of their input, so the
// size of the surface being projected is part of the projection. That size
// lives in the camera matrix (see `buildProjection` in src/core/matrix.ts) and
// arrives here already baked into `s`; this file never sees an extent.
//
// `lng` and `lat` are in RADIANS and are already the values the formulas
// consume; both degree conversions happen at the call site in main().

vec2 project_cylindrical (vec3 s, float zoom, float lng, float lat) {
  // `s.x` is deliberately unread, exactly as in the WGSL and in the legacy
  // shader, where the quad pinned it at 1.
  float y = s.y * zoom;
  float z = s.z * zoom;

  float theta = z * TWO_PI - lng;
  float phi = atan(y) + HALF_PI - lat;
  return to_uv(theta, phi);
}

vec2 project_planet (vec3 s, float zoom, float lng, float lat) {
  float y = s.y * zoom;
  // The negation is in the WGSL and in the legacy shader, and it is easy to
  // drop. Without it the planet projection renders mirrored and inside out.
  float z = -(s.z * zoom);

  // The tilt: a sphere rotation expressed as a Mobius transform of the plane
  // point w = z + i*y, rolling the source point at polar angle |lat| along
  // the screen-vertical meridian to the screen centre (2026-09-28
  // planet-drag-semantics spec, section 2.1). The rotation axis is the
  // horizontal screen axis (the fixed points are w = +-1) and the angle is
  // lat itself, no negation: drag down (lat < 0) rolls the centre so it
  // samples what was above it -- content follows the finger, the convention
  // the other three cameras use. At lat = 0 this is the identity term for
  // term, so the default little planet does not move by one bit -- except a
  // -0 -> +0 flip of theta's sign of zero on the z = 0 half-line, which no
  // consumer distinguishes.
  float tilt = lat;
  float ct = cos(tilt * 0.5);
  float st = sin(tilt * 0.5);

  // w' = (ct*w - i*st) / (-i*st*w + ct), expanded into real components:
  // numerator (ct*z, ct*y - st), denominator (ct + st*y, -st*z).
  float num_re = ct * z;
  float num_im = ct * y - st;
  float den_re = ct + st * y;
  float den_im = -st * z;
  // The excluded sphere point crosses the viewport at large tilts (spec
  // section 2.3): near its crossing d2 underflows toward zero and the
  // division below blows up. The floor's deliverable is that division -- it
  // keeps zn/yn finite and the fragment at its continuous limit, pinned with
  // the floor firing at z = 1e-8 off the pole by the f32 witness in
  // test/unit/reference.test.ts. Exactly ON the crossing the floor stops one
  // link short: at the lat = +-90 clamps, f32 sin and cos of the same f32
  // half-angle round to the same bits, den_re cancels to +0, the floor then
  // yields zn = yn = +-0, and atan(p / q) becomes atan(0 / 0) = NaN. The
  // tilt's own centre w' = 0 (y = tan(tilt / 2), exactly +-1 at those same
  // clamps) is a second such site with d2 = 2, beyond any floor. Both need
  // lat exactly at the clamp and a fragment centre landing exactly on them:
  // at zoom 1 that is odd width with height = 2 mod 4, and other zoom
  // values reach the same y = +-1 through other rational rows. Since
  // 2026-09-28 these branch points take the canonical value instead of the
  // NaN this comment used to record as kept (planet-review-followups spec,
  // section 2.2, superseding the faithful-NaN stance): the guard after
  // phi's formula below assigns theta and phi their +z-side one-sided
  // limits, measured identical at every branch point on the float64
  // arbiter. The float64 reference still carries no floor -- it is the
  // arbiter -- but it carries the same guard, which float64 reaches only
  // at exact tilt-centre hits whose ct * y - st cancels bit for bit:
  // the lat = 0 centre always, most other tilts per rounding luck, never
  // the +-90 sites (one ulp short there, their finite artifacts pinned
  // on the arbiter).
  float d2 = max(den_re * den_re + den_im * den_im, 1e-15);

  float zn = (num_re * den_re + num_im * den_im) / d2;
  float yn = (num_im * den_re - num_re * den_im) / d2;

  float m = 1.0 + zn * zn + yn * yn;

  float p = (2.0 * zn) / m;
  float q = (2.0 * yn) / m;
  float r = (m - 2.0) / m;

  float theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;

  // The Mobius reduction's branch points: p and q both exactly zero make
  // the atan above atan(0/0) and collapse phi's argument to -1/0. The
  // canonical values are the +z-side one-sided limits, measured identical
  // at every branch point on the float64 arbiter (2026-09-28
  // planet-review-followups spec, section 2.2): theta = 1.5*PI, and
  // phi = PI where the denominator is the zero factor (the Mobius pole,
  // num nonzero) versus 0 where the numerator is wholly zero. The lng
  // subtraction runs after the guard so the canonical theta receives it
  // like every other fragment's.
  if (p == 0.0 && q == 0.0) {
    theta = 1.5 * PI;
    phi = PI;
    if (num_re == 0.0 && num_im == 0.0) {
      phi = 0.0;
    }
  }

  theta -= lng;
  return to_uv(theta, phi);
}

vec2 project_pannini (vec3 s, float zoom, float lng, float lat) {
  float y = s.y * zoom;
  float z = s.z * zoom;

  // `z * 0.5 / s.x`, not `z * 0.5 * s.x`. This is the only term in any of the
  // four projections that reads the magnitude of x rather than its ratio, and
  // it is why the reconstruction has to recover x = 1 exactly instead of some
  // far-plane distance. See buildProjection in src/core/matrix.ts.
  float theta = 2.0 * atan((z * 0.5) / s.x);

  // These fixups test x and z AFTER theta has been doubled. `atan(z * 0.5 *
  // zoom, s.x) * 2.0` is not the same function: the two-argument atan is
  // quadrant-correct before the doubling, this one after.
  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  float phi = atan(y / sqrt(s.x * s.x + z * z)) + HALF_PI - lat;
  return to_uv(theta, phi);
}

void main () {
  // Recover the surface point the legacy rasteriser would have interpolated.
  //
  // The 1.0 in the z slot: both depth conventions put the far plane at ndc
  // z = +1, and the camera matrix is built so that inverting it there lands on
  // the legacy surface -- the far plane for the linear camera, whose direction
  // is all that matters, and exactly (1, y, z) for the other three, because
  // their ortho projection is built with far = 1. Do not change this to 0.0 for
  // WebGL2: the matrix was built with the GL convention, where the far plane is
  // at +1 just as it is under the ZO convention.
  vec4 homogeneous = u_invClip * vec4(v_ndc, 1.0, 1.0);
  vec3 surface = homogeneous.xyz / homogeneous.w;

  // `CameraState.povLongitude` is in DEGREES; converted here, honestly. It
  // was not always: v0.2.2 subtracted `povLongitude / 4` -- degrees from a
  // radian angle, ~14.3x oversensitive, and the wrong value still renders a
  // plausible-looking panorama -- until corrected by user adjudication
  // (2026-09-23, pan-zoom-semantics spec §1). The WGSL twin and `lngOffset`
  // in src/core/reference.ts -- which carries the full history -- must change
  // in the same commit; gate C holds the three formulas together.
  float lng = u_povLongitude * PI / 180.0;

  // Latitude, like `lng` above, is honestly converted, but it is an addition
  // rather than a correction: v0.2.2's non-linear cameras ignored it entirely
  // (defect F5), so the term was born with correct units. Gate B pins the
  // behaviour. On planet it is not subtracted from phi -- it is the tilt angle
  // of the Mobius pre-transform in project_planet (2026-09-28
  // planet-drag-semantics spec,
  // docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md);
  // cylindrical and pannini still subtract it.
  float lat = u_povLatitude * PI / 180.0;

  vec2 uv;
  // An if-chain rather than a switch. ES 3.00 does support switch, but the case
  // labels must be constant integral expressions and these constants arrive as
  // preprocessor #defines, which is a portability hazard across drivers. Four
  // branches on a uniform value, once per pixel: the cost is nil.
  if (u_projKind == CAMERA_PROJECTION_LINEAR) {
    uv = project_linear(surface);
  } else if (u_projKind == CAMERA_PROJECTION_CYLINDRICAL) {
    uv = project_cylindrical(surface, u_zoom, lng, lat);
  } else if (u_projKind == CAMERA_PROJECTION_PLANET) {
    uv = project_planet(surface, u_zoom, lng, lat);
  } else if (u_projKind == CAMERA_PROJECTION_PANNINI) {
    uv = project_pannini(surface, u_zoom, lng, lat);
  } else {
    // Unreachable: u_projKind comes from cameraProjectionCode() and the values
    // are generated from the same JSON the #defines are. The fallback exists
    // because a black panorama is better than a chromatic one, and it is the
    // same fallback the WGSL uses.
    uv = vec2(0.0, 0.0);
  }

  // The source's own projection. Only equirectangular exists today; a second
  // kind goes here, and the value is already uploaded so no CPU change is
  // needed to add one.
  if (u_texProjKind != TEXTURE_PROJECTION_EQUIRECTANGULAR) {
    uv = vec2(0.0, 0.0);
  }

  outColor = texture(u_tex, uv);
}
