/**
 * Detects WebGL availability and reveals the #webgl-fallback message when it
 * is missing. Never throws — callers can rely on the boolean return value.
 */
export class WebGLCheck {
  /**
   * Returns true when a WebGL context can be created. Otherwise shows the
   * #webgl-fallback div (if present) and returns false.
   */
  static assert(): boolean {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") ??
        canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl");
      if (gl) {
        return true;
      }
    } catch {
      // Fall through — show the fallback instead of throwing.
    }
    WebGLCheck.showFallback();
    return false;
  }

  /** Reveals the #webgl-fallback div, if it exists in the DOM. */
  static showFallback(): void {
    const fallback = document.getElementById("webgl-fallback");
    if (fallback) {
      fallback.hidden = false;
    }
  }
}
