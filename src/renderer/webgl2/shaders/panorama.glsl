// pano.gl panorama shader, WebGL2 backend.
//
// A line-by-line transcription of src/renderer/webgpu/shaders/panorama.wgsl as
// it stands AFTER P3's Task 8 -- that is, including the `- lat` term the three
// non-linear projections gained when latitude stopped being ignored (defect
// F5). Transcribing the earlier version of that file loses the latitude term,
// and gate C fails on every state whose povLatitude is not zero.
//
// Transcribed by hand rather than generated: the two languages differ enough
// that a translator would be a project of its own, and a translator that got
// the projections subtly wrong would be worse than two files a human can read
// side by side.
//
// The cost of hand transcription is drift. Gate C is what prevents it: every
// camera state is rendered through both backends and the pixels are compared.
// If you change a formula here, change it in the WGSL too, and check
// src/core/reference.ts -- the CPU reference is the arbiter when the two
// backends disagree.
//
// THREE THINGS IN THIS FILE LOOK WRONG AND ARE NOT. Each has already been
// wrong once, which is why each has a test that names it:
//
//   1. `to_uv` has no `+ 0.5`. Adding one rotates the panorama half a turn.
//   2. `to_uv` flips v (`1.0 - phi / PI`). Removing the flip renders it upside
//      down.
//   3. No `atan2` anywhere, and no `theta -= lng` with a converted longitude.
//      The quadrant fixups and the `povLongitude / 4.0` are transcriptions of
//      v0.2.2, bugs included. See the comments at each site.
//
// WHAT IS *NOT* SHARED: the uniform layout. WebGPU packs the camera into one
// 96-byte block; WebGL2 uses named uniforms. The semantics are shared, the
// storage is not. See the plan's "关键设计决定".
//
// The fragment stage inverts the camera matrix to recover the surface point the
// legacy rasteriser would have interpolated. Both depth conventions put the far
// plane at ndc z = +1, so this file does not need to know which convention
// built the matrix.

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

// Equirectangular coordinate from an angle pair.
//
// Wrapping happens here rather than in the sampler. The legacy shader did none
// at all: it handed texture2D a raw ratio and the texture object's default
// REPEAT wrap did the work. The WebGPU backend's external-texture entry point
// has no wrap-capable sampler at all (textureSampleBaseClampToEdge clamps), so
// both backends wrap in the shader to stay identical.
//
// `mod` is x - y * floor(x / y), the same function as WGSL's `fract` for a
// divisor of 1.0. WGSL's `%` is NOT the same (it truncates toward zero) and
// would put a seam in the panorama wherever theta is negative. If you copy this
// line back to the WGSL, `fract` is the one to use.
//
// v is FLIPPED. The legacy upload set UNPACK_FLIP_Y_WEBGL, so its sampler read
// a vertically mirrored image compared with the source file. P3 decided the
// flip lives in the shader once, for every source path, so the two backends
// cannot disagree about it -- which means this backend uploads with
// UNPACK_FLIP_Y_WEBGL explicitly false (see backend.ts) and reverses the flip
// here. Removing it from one side only flips the picture, and removing it from
// both would break gate A against the baseline.
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
// consume. The degree conversion, and the `/ 4.0` that is NOT a degree
// conversion, happen at the call site in main().

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

  float m = 1.0 + z * z + y * y;

  float p = (2.0 * z) / m;
  float q = (2.0 * y) / m;
  float r = (m - 2.0) / m;

  float theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI - lat;
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

  // `CameraState.povLongitude` is in DEGREES. The legacy shader declared
  // `float lng = u_CamPOVLongitude / 2.0` at file scope and each non-linear
  // projection then subtracted `lng / 2.0`, so what actually came off a radian
  // angle was `povLongitude / 4` -- degrees subtracted from radians. That is a
  // bug in v0.2.2, reproduced on purpose: the acceptance criterion is "renders
  // what v0.2.2 rendered", and correcting it changes panning sensitivity, which
  // v1 deliberately does not do -- recorded as a retention in spec §11.4 (B1),
  // which is where this note, P3's WGSL copy and `lngOffset()` in
  // src/core/reference.ts all point.
  //
  // `/ 4.0`. NOT `* PI / 180.0`. The two differ by a factor of about 29, and
  // the wrong one still renders a plausible-looking panorama.
  float lng = u_povLongitude / 4.0;

  // Latitude, by contrast, IS converted and used. The legacy non-linear cameras
  // ignored it completely (defect F5: the uniform was declared and never read,
  // and the inner ortho camera was built with latitude 0 and never updated).
  // P3's Task 8 turns that into a deliberate, separately tested behaviour
  // change, in the WGSL and in the reference at the same time. Both shaders
  // carry the `- lat` term; neither carries it alone.
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
