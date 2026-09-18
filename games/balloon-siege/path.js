// Path geometry. Bloons are positioned by distance travelled along the track,
// which makes "first"/"last" targeting exact and movement independent of how
// the waypoints happen to be spaced.

import { PATH_RADIUS } from "./config.js";

export function buildPath(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    segs.push({ x1, y1, x2, y2, dx: dx / len, dy: dy / len, len, start: total });
    total += len;
  }
  return { points, segs, length: total };
}

/** World position at `dist` along the path. Clamped at both ends. */
export function pointAt(path, dist) {
  const segs = path.segs;
  if (dist <= 0) return { x: segs[0].x1, y: segs[0].y1, dx: segs[0].dx, dy: segs[0].dy };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (dist <= s.start + s.len) {
      const d = dist - s.start;
      return { x: s.x1 + s.dx * d, y: s.y1 + s.dy * d, dx: s.dx, dy: s.dy };
    }
  }
  const last = segs[segs.length - 1];
  return { x: last.x2, y: last.y2, dx: last.dx, dy: last.dy };
}

/** Shortest distance from a point to the track centreline. */
export function distanceToPath(path, x, y) {
  let best = Infinity;
  for (const s of path.segs) {
    const px = x - s.x1;
    const py = y - s.y1;
    let t = px * s.dx + py * s.dy;
    t = Math.max(0, Math.min(s.len, t));
    const cx = s.x1 + s.dx * t;
    const cy = s.y1 + s.dy * t;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Is this spot clear of the track? Towers still have to clear each other and
 * the map bounds — see canPlace in game.js. */
export function offPath(path, x, y, radius) {
  return distanceToPath(path, x, y) > PATH_RADIUS + radius;
}
