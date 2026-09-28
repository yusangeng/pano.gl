/**
 * Pure formatting helpers shared by the lab panels.
 *
 * No DOM, no viewer imports: every function is a plain value transform,
 * which is what keeps the panels thin enough to read as usage examples.
 */

/** Signed degrees, e.g. `+12.3°` / `-4.5°`. Pose readouts only. */
export function formatSignedDegrees (value: number, digits = 1): string {
  const magnitude = Math.abs(value).toFixed(digits)
  return `${value >= 0 ? '+' : '-'}${magnitude}°`
}

/** Two-decimal plain number for zoom and extent readouts. */
export function formatPlain (value: number): string {
  return value.toFixed(2)
}

/** `m:ss` for video timecodes; `--:--` before metadata arrives. */
export function formatTimecode (seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** `hh:mm:ss.mmm` stamp for log rows. */
export function formatStamp (date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/**
 * Compact one-line payload for a viewer event.
 *
 * `rotate` carries a delta, not an absolute pose (the absolute pose lives on
 * `viewer.cameraOptions`), so the log line says how far the camera moved.
 */
export function formatPayload (type: string, event: unknown): string {
  if (type === 'rotate') {
    const { lat, lng } = event as { lat: number, lng: number }
    return `lat ${formatSignedDegrees(lat)} lng ${formatSignedDegrees(lng)}`
  }
  if (type === 'zoom') {
    const { delta } = event as { delta: number }
    return `delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`
  }
  if (type === 'device-lost') {
    const lost = event as { reason: string, message: string }
    return `${lost.reason}: ${lost.message}`
  }
  if (type === 'media-error') {
    const { error } = event as { error: unknown }
    return String(error)
  }
  return ''
}
