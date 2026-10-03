/**
 * WebGL capability detection (plan §"WebGL Detection and Fallback" —
 * M8 Phase 2, plan screen 18).
 *
 * Taken verbatim from the plan: the 3D floor needs a working WebGL
 * context, and screen 18 mandates an automatic 2D fallback when one is
 * not available ("3D view requires WebGL. Showing 2D view."). Safe to
 * call anywhere — the try/catch turns a missing window/document (SSR,
 * vitest node environment) into `false`, so the fallback path is also
 * the server's path.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}
