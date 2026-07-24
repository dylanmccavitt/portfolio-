/**
 * Pure frame-timing values and helpers for the device renderer.
 *
 * These live outside `device-renderer.ts` so they can be imported and asserted
 * directly by tests: `device-renderer.ts` pulls in `three` and touches
 * `window`/`document`, so nothing in it is reachable from a Node test process.
 */

/**
 * Pointer parallax amplitude, in radians. Deliberately tiny: the DOM overlays
 * are projected from the unrotated surface rectangles, so the chassis tilt must
 * stay small enough that the resulting screen-space drift remains sub-pixel.
 */
export const POINTER_TILT_Z = 0.009;
export const POINTER_TILT_X = 0.006;

/**
 * Tuned pointer settle, expressed as the fraction of the remaining distance
 * closed in one frame at 60Hz. {@link frameSmoothingAlpha} generalises it to
 * any frame rate.
 */
export const POINTER_SETTLE_PER_FRAME = 0.045;

/** Frame deltas are clamped so a resumed loop never applies one huge step. */
export const MAX_FRAME_DELTA = 0.05;

/** Reference rate the per-frame smoothing constants were tuned against. */
export const REFERENCE_FRAME_RATE = 60;

/**
 * Seconds elapsed between two `performance.now()` readings, clamped to
 * {@link MAX_FRAME_DELTA}. Animation time is accumulated from these clamped
 * deltas rather than read from the wall clock, so paused frames do not pile up
 * into a single jump when the loop resumes.
 */
export function frameDelta(now: number, last: number): number {
  return Math.min((now - last) / 1000, MAX_FRAME_DELTA);
}

/**
 * Frame-rate independent exponential smoothing alpha.
 *
 * `perFrameAlpha` is the settle tuned at {@link REFERENCE_FRAME_RATE}; the
 * returned alpha reproduces it exactly at that rate and converges to the same
 * wall-clock curve at any other rate.
 */
export function frameSmoothingAlpha(perFrameAlpha: number, dt: number): number {
  return 1 - Math.pow(1 - perFrameAlpha, dt * REFERENCE_FRAME_RATE);
}
