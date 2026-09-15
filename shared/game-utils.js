// Shared helpers used by every game. Keep this dependency-free (no imports)
// so any game can load it directly as an ES module.

/** Prevent the browser from scrolling/zooming/long-press-menu on an element
 * used as a game's touch surface (canvas or a full-screen root div). */
export function lockViewport(el) {
  el.style.touchAction = "none";
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * Attach unified pointer input to `el`. Handlers: onDown(x, y, e), onMove(x, y, e),
 * onUp(x, y, e). Coordinates are in CSS pixels relative to `el`'s bounding box.
 * Uses Pointer Events exclusively (never separate touch/mouse listeners) and
 * registers with { passive: false } so preventDefault() reliably blocks
 * scroll/zoom gestures during gameplay.
 */
export function onPointer(el, { onDown, onMove, onUp } = {}) {
  function toLocal(e) {
    const rect = el.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function handleDown(e) {
    e.preventDefault();
    const [x, y] = toLocal(e);
    onDown && onDown(x, y, e);
  }
  function handleMove(e) {
    e.preventDefault();
    const [x, y] = toLocal(e);
    onMove && onMove(x, y, e);
  }
  function handleUp(e) {
    e.preventDefault();
    const [x, y] = toLocal(e);
    onUp && onUp(x, y, e);
  }

  el.addEventListener("pointerdown", handleDown, { passive: false });
  el.addEventListener("pointermove", handleMove, { passive: false });
  el.addEventListener("pointerup", handleUp, { passive: false });
  el.addEventListener("pointercancel", handleUp, { passive: false });

  return function detach() {
    el.removeEventListener("pointerdown", handleDown);
    el.removeEventListener("pointermove", handleMove);
    el.removeEventListener("pointerup", handleUp);
    el.removeEventListener("pointercancel", handleUp);
  };
}

/** Read a numeric value from localStorage, tolerating private-browsing/quota errors. */
export function loadHighScore(key, defaultVal = 0) {
  try {
    const raw = localStorage.getItem(key);
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultVal;
  } catch {
    return defaultVal;
  }
}

/** Persist a numeric value to localStorage, tolerating private-browsing/quota errors. */
export function saveHighScore(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore — private browsing / quota exceeded
  }
}

/**
 * A requestAnimationFrame loop with delta-time in seconds, capped to avoid a
 * "spiral of death" after the tab is backgrounded and resumed.
 * update(dt) runs the simulation; render() draws the current state.
 */
export function createLoop({ update, render }) {
  let rafId = null;
  let lastTime = null;
  const MAX_DT = 0.05;

  function frame(time) {
    if (lastTime == null) lastTime = time;
    const dt = Math.min((time - lastTime) / 1000, MAX_DT);
    lastTime = time;
    update && update(dt);
    render && render();
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      lastTime = null;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTime = null;
    },
  };
}

/**
 * Size a canvas's backing store for the device pixel ratio while keeping its
 * CSS size at 100% of its parent. Returns the current CSS width/height in px.
 * Re-runs automatically on resize/orientationchange.
 */
export function fitCanvasToScreen(canvas, onResize) {
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width || window.innerWidth);
    const h = Math.round(rect.height || window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize && onResize(w, h);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  return () => {
    window.removeEventListener("resize", resize);
    window.removeEventListener("orientationchange", resize);
  };
}

/** Show a brief floating toast (e.g. "PERFECT") using the shared .toast CSS class. */
export function showToast(el, text, duration = 600) {
  el.textContent = text;
  el.classList.remove("show");
  // Force reflow so the animation restarts if triggered again quickly.
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}
