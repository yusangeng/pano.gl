/**
 * Assembles the GLSL program sources.
 *
 * `#version` must be the very first thing in a shader source, before even a
 * comment, so the generated constants and the body are joined after it rather
 * than prepended to it. A source that starts with a comment and then `#version`
 * is a compile error whose message does not mention ordering.
 *
 * The constants come from the same generator as the WGSL ones
 * (scripts/gen-shader-constants.mjs reads src/core/projection-kinds.json), so
 * the numbers cannot drift even though the shader bodies are hand-transcribed.
 * GLSL gets them as `#define NAME value`, WGSL as `const NAME: u32 = valueu`,
 * which is why the JS side uploads an `int` here and a `u32` there.
 */

import { GLSL_CONSTANTS } from '../../shaders/generated'
import panoramaBody from './panorama.glsl?raw'

const VERTEX_SOURCE = `#version 300 es
${GLSL_CONSTANTS}
precision highp float;

out vec2 v_ndc;

void main () {
  // gl_VertexID is available in ES 3.00, so the fullscreen triangle needs no
  // vertex buffer, no attributes and no index buffer -- the same three corners
  // the WGSL vertex stage emits, in the same order. Nothing is bound to any
  // attribute, and there is no attribute to bind.
  vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  v_ndc = corners[gl_VertexID];
  gl_Position = vec4(v_ndc, 1.0, 1.0);
}`

const FRAGMENT_SOURCE = `#version 300 es
${GLSL_CONSTANTS}
${panoramaBody}`

export const PANORAMA_GLSL_VERTEX = VERTEX_SOURCE
export const PANORAMA_GLSL_FRAGMENT = FRAGMENT_SOURCE
