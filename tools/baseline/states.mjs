/*
 * The camera-state matrix every baseline capture walks. Kept in one module so the
 * capture driver and the fixture verifier cannot drift apart -- a verifier that
 * checks a different set of states than the capture wrote is worse than none.
 *
 * Angles are degrees, matching the legacy public API. `zoom` is the number of
 * discrete zoom steps applied via viewer.zoom(), not a scale factor: v0.2.2's
 * cameras implement zoom(delta) as `zoomValue += delta / 20`, so one step is a
 * +0.05 change to the uniform the shader actually receives. The captured
 * u_CamZoom values in each fixture's uniforms are the authoritative record of
 * what a given state really produced -- read those, not this comment.
 */

/** One point in camera-parameter space. */
export const STATES = [
  { id: 'origin',     lat: 0,   lng: 0,   zoom: 0 },
  { id: 'tilt',       lat: 30,  lng: 45,  zoom: 0 },
  { id: 'south',      lat: -60, lng: 180, zoom: 0 },
  { id: 'zoomed',     lat: 10,  lng: 300, zoom: 1 }
]

/** The camera types registered in v0.2.2's CameraFactory. OrthoCamera is not
 *  registered upstream and is deliberately absent here too. */
export const CAMERAS = ['perspective', 'cylindrical', 'planet', 'pannini']

/** Fixed capture resolution. Small enough to commit, large enough that all four
 *  projections differ visibly from each other. */
export const CANVAS_SIZE = 128

/** Stable identifier for one capture, used as its fixture path. */
export function captureId (camera, state) {
  return `${camera}/${state.id}`
}
