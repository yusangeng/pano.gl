// pano.gl panorama shader.
//
// One triangle, no vertex buffer, no vertex attributes. The vertex stage emits
// clip-space coordinates from the vertex index alone; everything else happens
// per fragment.
//
// The legacy renderer rasterised a cube (radius 100) for the linear camera and
// a quad (at x = 1) for the three non-linear ones, then fed the interpolated
// vertex position to the projection formula. That worked, but the surface was
// doing nothing except producing a coordinate -- the linear projection is
// scale-invariant and the shader never called normalize() on anything.
//
// Here the surface is reconstructed by inverting the camera matrix instead:
// given a screen position, `invClip` recovers the point the legacy rasteriser
// would have interpolated. For the linear camera that point is on the far plane
// and only its direction matters. For the non-linear cameras it is the quad
// point (1, y, z), which is exactly what their formulas read.
//
// Both conventions put the far plane at ndc z = +1, so this shader does not
// need to know which backend is running it.

struct Camera {
  invClip: mat4x4<f32>,
  projKind: u32,
  texProjKind: u32,
  povLatitude: f32,
  povLongitude: f32,
  zoom: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

// group(1) is the source. The two bindings are alternatives, not a pair:
// `fs_main` reads `samp` + `tex`, `fs_main_external` reads `ext`. Each pipeline
// layout declares only the ones its entry point uses -- see the note under the
// fragment stage.
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var ext: texture_external;

const PI: f32 = 3.141592653589793;
const HALF_PI: f32 = 1.5707963267948966;
const TWO_PI: f32 = 6.283185307179586;

// `CAMERA_PROJECTION_LINEAR/_CYLINDRICAL/_PLANET/_PANNINI` and
// `TEXTURE_PROJECTION_EQUIRECTANGULAR` are prepended above this file by
// `shaders/index.ts`, generated from `src/core/projection-kinds.json`. They are
// the only place these numbers appear -- there is no numeric literal for a
// projection kind anywhere below.

struct VertexOut {
  @builtin(position) clip: vec4f,
  // Passed through rather than derived from @builtin(position) in the fragment
  // stage: the builtin is in framebuffer pixels, which would need the viewport
  // size, which would mean another uniform and a resolution-dependent bug class.
  @location(0) ndc: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  // A single oversized triangle covering the clip volume. Two triangles would
  // work too; one is fewer vertices and has no shared edge to crack.
  var corners = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VertexOut;
  out.clip = vec4f(corners[index], 1.0, 1.0);
  out.ndc = corners[index];
  return out;
}

// Equirectangular coordinate from an angle pair.
//
// This differs from `toUV` in src/core/reference.ts in exactly two ways, and
// both are deliberate:
//
//   1. `fract` is applied to u. The legacy shader did no wrapping at all -- it
//      handed `texture2D` a raw ratio and the texture object's default REPEAT
//      wrap did the work. Wrapping is done explicitly here instead, because the
//      external-texture entry point below has no wrap-capable sampler
//      (`textureSampleBaseClampToEdge` clamps). Doing it in the shader means
//      both source paths wrap identically.
//
//      `fract` and not `%`: WGSL's `%` truncates toward zero while `fract` is
//      `x - floor(x)`, matching GLSL's `mod`. `%` would put a seam in the
//      panorama wherever theta is negative.
//
//   2. v is flipped. The legacy upload set `UNPACK_FLIP_Y_WEBGL`, so its
//      sampler read a vertically mirrored image compared with the source file.
//      Neither WebGPU source path can express that -- `importExternalTexture`
//      has no flip option at all, and using `copyExternalImageToTexture` with
//      `flipY` for stills would give the two paths opposite orientations, which
//      shows up as "the video is upside down but the photo is not". So one flip
//      lives here, for both paths, exactly as spec §4.4 decided.
//
// There is still NO `+ 0.5`. The legacy shader has none, and adding one rotates
// the panorama 180 degrees.
fn to_uv(theta: f32, phi: f32) -> vec2f {
  return vec2f(fract(theta / TWO_PI), 1.0 - phi / PI);
}

/*
 * The four projections are transcribed statement for statement from
 * cam_proj_* in `legacy/shader/fshader.glsl`, and line for line against
 * `src/core/reference.ts`. Two things that look like transcription errors and
 * are not:
 *
 *   - `atan(a / b)` plus explicit quadrant fixups is deliberately NOT
 *     simplified to `atan2`. The two agree for `linear` and `cylindrical` but
 *     not for `pannini`, whose fixups run AFTER theta has been doubled, so
 *     `2 * atan(b/a)` and `atan2` then `* 2` land in different quadrants.
 *   - Nothing wraps `theta`. Wrapping is the sampler's job.
 *
 * Keep all four in the same shape as the reference so the two can be read side
 * by side.
 */

// The linear (perspective) projection. Scale-invariant: every term is a ratio,
// so the magnitude of `s` carries no information. This is why the cube could be
// replaced by a triangle.
fn project_linear(s: vec3f) -> vec2f {
  var theta = atan(s.z / s.x);

  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  let phi = atan(s.y / sqrt(s.x * s.x + s.z * s.z)) + HALF_PI;
  return to_uv(theta, phi);
}

/*
 * The three non-linear projections below read the MAGNITUDE of their inputs, so
 * the size of the surface being projected is part of the projection. In the
 * legacy code that size lived in quad vertex coordinates; it now lives in the
 * camera matrix, and `invClip` delivers the right point without the shader
 * needing to know the extent.
 */

fn project_cylindrical(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  // `s.x` is deliberately unread, exactly as in the legacy shader, where the
  // quad pinned it at 1. See `project_pannini` for the one projection that
  // does read it.
  let y = s.y * zoom;
  let z = s.z * zoom;

  let theta = z * TWO_PI - lng;
  let phi = atan(y) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_planet(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  let y = s.y * zoom;
  // The negation is in the legacy shader and is easy to drop. Without it the
  // planet projection renders mirrored and inside out.
  let z = -(s.z * zoom);

  let m = 1.0 + z * z + y * y;

  let p = (2.0 * z) / m;
  let q = (2.0 * y) / m;
  let r = (m - 2.0) / m;

  var theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  let phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_pannini(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  let y = s.y * zoom;
  let z = s.z * zoom;

  // `z * 0.5 / s.x`, not `z * 0.5 * s.x`. This is the only term in any of the
  // four projections that reads the magnitude of x rather than its ratio, and
  // it is why the reconstruction has to recover x = 1 exactly instead of some
  // far-plane distance. See `buildProjection` in src/core/matrix.ts.
  var theta = 2.0 * atan((z * 0.5) / s.x);

  // These fixups test x and z AFTER theta has been doubled -- see the block
  // comment above.
  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  let phi = atan(y / sqrt(s.x * s.x + z * z)) + HALF_PI;
  return to_uv(theta, phi);
}

// Where in the source this pixel reads from. Shared by both fragment entry
// points: everything above this point is a function from a screen position to a
// texture coordinate, and nothing about it depends on how the source is bound.
fn panorama_uv(ndc: vec2f) -> vec2f {
  // Recover the surface point the legacy rasteriser would have interpolated.
  //
  // The 1.0 in the z slot: both depth conventions put the far plane at ndc
  // z = +1, and the camera matrix is built so that inverting it there lands on
  // the legacy surface -- the far plane for the linear camera, whose direction
  // is all that matters, and exactly (1, y, z) for the other three, because
  // their ortho projection is built with far = 1.
  let homogeneous = camera.invClip * vec4f(ndc, 1.0, 1.0);
  let surface = homogeneous.xyz / homogeneous.w;

  // `CameraState.povLongitude` is in degrees. The legacy shader declared
  // `float lng = u_CamPOVLongitude / 2.0` and each non-linear projection then
  // subtracted `lng / 2.0`, so what actually came off a radian angle was
  // `povLongitude / 4` -- degrees subtracted from radians. That is a bug in
  // v0.2.2, reproduced here on purpose: the acceptance criterion is "renders
  // what v0.2.2 rendered", and correcting it changes panning sensitivity, which
  // is a separate user-visible decision that v1 does not make. Recorded as a
  // deliberate retention in spec §11.4 (B1), which is where the three copies of
  // this note point. See `lngOffset` in src/core/reference.ts for the full
  // consequence.
  let lng = camera.povLongitude / 4.0;

  // `povLatitude` is read by nothing here. That is not an omission: the legacy
  // non-linear cameras ignored latitude too (defect F5), and reproducing that is
  // this phase's acceptance criterion. Task 8 Step 3 of this plan makes it a
  // deliberate, separately-tested behaviour change -- not a later phase's job.
  // It stays in the struct because removing
  // it would move every uniform offset after it, and that layout belongs to P2.
  var uv: vec2f;
  switch camera.projKind {
    case CAMERA_PROJECTION_LINEAR: { uv = project_linear(surface); }
    case CAMERA_PROJECTION_CYLINDRICAL: { uv = project_cylindrical(surface, camera.zoom, lng); }
    case CAMERA_PROJECTION_PLANET: { uv = project_planet(surface, camera.zoom, lng); }
    case CAMERA_PROJECTION_PANNINI: { uv = project_pannini(surface, camera.zoom, lng); }
    // WGSL requires a `switch` to be exhaustive. This is the one place a silent
    // fallback is allowed, because `projKind` can only come from the generated
    // constants above.
    default: { uv = vec2f(0.0, 0.0); }
  }

  // The source's own projection. Only equirectangular exists today; a second
  // kind goes here, and the value is already uploaded so no CPU change is
  // needed to add one.
  if camera.texProjKind != TEXTURE_PROJECTION_EQUIRECTANGULAR {
    uv = vec2f(0.0, 0.0);
  }

  return uv;
}

// Entry point for a still source, bound as `texture_2d<f32>` after one
// `copyExternalImageToTexture`.
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return textureSample(tex, samp, panorama_uv(in.ndc));
}

// Entry point for a video source, bound as `texture_external` -- zero copy, and
// a new import every frame.
//
// Two entry points rather than one because `texture_external` is a different
// WGSL type with a different sampling surface: there is no `textureSample`
// overload for it and no sampler, so the only way to read it is
// `textureSampleBaseClampToEdge`. A pipeline picks its entry point, so the
// backend builds one pipeline per source kind from this one module, and a
// texture_2d source never pays for the external path.
@fragment
fn fs_main_external(in: VertexOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(ext, panorama_uv(in.ndc));
}
