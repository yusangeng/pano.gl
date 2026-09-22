/**
 * pano.gl -- a viewer for equirectangular 360 images and video.
 *
 * WebGPU first, WebGL2 as the fallback. The exported surface is deliberately
 * small and is FROZEN as of v1.0: everything else in `src/` is internal and may
 * be reorganised.
 */

export { FramelessImageViewer } from './viewer/image-viewer'
export { FramelessVideoViewer } from './viewer/video-viewer'
export type { ImageViewerOptions, VideoViewerOptions, ImageProjection } from './viewer/options'
export type { CameraOptions } from './viewer/types'
export type { Capabilities } from './renderer/backend'
export type { SelectedCapabilities } from './renderer/capabilities'
// Re-exported so an application can name the types it already receives from
// `viewer.cameraOptions` and `viewer.capabilities` without reaching into `src/`.
export type { CameraState, Projection } from './core/types'
export type { ProjectionKind, TextureProjection } from './core/constants'
// The one debugging export: without it, the diagnostics channels are unusable
// from outside the library, and "why is it falling back to WebGL2" is a
// question only an application can ask. See src/diagnostics.ts.
export { enableChannels } from './diagnostics'
export const VERSION = '1.0.0-alpha.0'
