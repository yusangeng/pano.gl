# Changelog

## 1.2.0 (2026-10-09)

### Added

- Fifth camera model `'mercator'` — a conformal cylinder (uniform scale
  everywhere, poles at infinity), with `zoom` 0.01–1 and `extent` 1×1 like
  cylindrical. Held to the float64 CPU reference and gate C three-way
  agreement across the latitude and zoom range, poles included.
- Container aspect fit: under the new default `fit: 'container'`, the
  non-linear cameras' orthographic box resolves per axis from the container's
  aspect, so one pixel at the screen centre covers the same panorama angle
  horizontally and vertically on any viewport shape. `fit: 'extent'` restores
  the square frame shipped through v1.1.0 for a locked manual extent.

### Changed

- The `rotate` event's `lat` now reports the **applied** delta on every
  camera: a drag that runs into the ±90° latitude clamp emits the movement
  that actually happened, not what was requested. `lng` is unchanged (no
  clamp — requested is applied), and zero-delta rotations still emit
  (`lat: 0`). Summing `lat` across one drag now telescopes to the real pose
  change. This is a payload-semantics change on the cameras that existed in
  v1.1.0, released as minor by maintainer adjudication.

### Internal

- Exact float64 reference pins plus a gate C arbiter leg at lat 30 × zoom 0.5
  for all four non-linear cameras — closes the zoom-1-invisible gap, where a
  latitude-term × zoom error carried identically by both shaders was invisible
  to every gate.

Older releases (v1.0.0, v1.1.0) predate this changelog; see the git tags.
