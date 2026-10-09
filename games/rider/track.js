// Track geometry: pieces (continuous polylines, possibly with loops) separated
// by gaps, plus a spatial grid for swept collision queries. Pure / DOM-free.

import { normAng } from "./physics.js";

const CELL = 256;
const WALL_DEPTH = 4000;
const CHUNK = 32;

class Piece {
  constructor(index, pts, loops, boosts, loopFlags) {
    this.index = index;
    const n = pts.length / 2;
    this.n = n;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i * 2];
      this.ys[i] = pts[i * 2 + 1];
    }
    this.loopFlag = loopFlags;
    this.segLen = new Float64Array(n - 1);
    this.stx = new Float64Array(n - 1);
    this.sty = new Float64Array(n - 1);
    this.s = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      const dx = this.xs[i + 1] - this.xs[i];
      const dy = this.ys[i + 1] - this.ys[i];
      const L = Math.hypot(dx, dy) || 1e-6;
      this.segLen[i] = L;
      this.stx[i] = dx / L;
      this.sty[i] = dy / L;
      this.s[i + 1] = this.s[i] + L;
    }
    this.len = this.s[n - 1];

    // Point tangents (average of neighbouring segments) and curvature.
    this.ptx = new Float64Array(n);
    this.pty = new Float64Array(n);
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 2, i);
      let tx = this.stx[a] + this.stx[b];
      let ty = this.sty[a] + this.sty[b];
      const L = Math.hypot(tx, ty) || 1;
      this.ptx[i] = tx / L;
      this.pty[i] = ty / L;
      if (i > 0 && i < n - 1) {
        const d = normAng(Math.atan2(this.sty[i], this.stx[i]) - Math.atan2(this.sty[i - 1], this.stx[i - 1]));
        k[i] = -d / ((this.segLen[i - 1] + this.segLen[i]) / 2);
      }
    }
    // Smooth curvature to hide polyline noise.
    this.k = new Float64Array(n);
    let src = k;
    for (let pass = 0; pass < 2; pass++) {
      const dst = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = src[Math.max(0, i - 1)];
        const b = src[Math.min(n - 1, i + 1)];
        dst[i] = a * 0.25 + src[i] * 0.5 + b * 0.25;
      }
      src = dst;
    }
    this.k = src;

    this.loops = loops; // [{s0, s1, cx, cy, r}]
    this.boosts = boosts; // [{s0, s1}]

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (this.xs[i] < minX) minX = this.xs[i];
      if (this.xs[i] > maxX) maxX = this.xs[i];
      if (this.ys[i] < minY) minY = this.ys[i];
      if (this.ys[i] > maxY) maxY = this.ys[i];
    }
    this.minX = minX; this.maxX = maxX; this.minY = minY; this.maxY = maxY;

    // Chunk bounding boxes for fast culling in the renderer.
    this.chunks = [];
    for (let c = 0; c < n - 1; c += CHUNK) {
      const e = Math.min(n - 1, c + CHUNK);
      let a = Infinity, b = -Infinity, ya = Infinity, yb = -Infinity;
      for (let i = c; i <= e; i++) {
        a = Math.min(a, this.xs[i]); b = Math.max(b, this.xs[i]);
        ya = Math.min(ya, this.ys[i]); yb = Math.max(yb, this.ys[i]);
      }
      this.chunks.push({ i0: c, i1: e, minX: a, maxX: b, minY: ya, maxY: yb });
    }
  }

  stickyAt(s) {
    for (const lp of this.loops) if (s >= lp.s0 - 4 && s <= lp.s1 + 4) return true;
    return false;
  }
}

export class Track {
  constructor() {
    this.pieces = [];
    this.grid = new Map();
    this.cellMaxY = new Map();
    this.gems = [];
    this.checkpoints = [];
    this.finish = null;
    this.maxY = 0;
    this._smp = { x: 0, y: 0, tx: 1, ty: 0, ang: 0, k: 0 };
    this._hit = { p: 0, i: 0, u: 0, t: 0, wall: false, side: 0, x: 0, y: 0 };
  }

  addPiece({ pts, loops = [], boosts = [], loopFlags, connect = false }) {
    const idx = this.pieces.length;
    const pc = new Piece(idx, pts, loops, boosts, loopFlags || new Uint8Array(pts.length / 2));
    pc.next = null;
    this.pieces.push(pc);
    const prev = connect ? this.pieces[idx - 1] : null;
    if (prev) {
      // Seamless continuation: ride straight from prev's end onto this piece.
      prev.next = idx;
      prev.endWall.disabled = true;
    }
    for (let i = 0; i < pc.n - 1; i++) {
      this._index({ p: idx, i, ax: pc.xs[i], ay: pc.ys[i], bx: pc.xs[i + 1], by: pc.ys[i + 1], wall: false, loop: !!pc.loopFlag[i] && !!pc.loopFlag[i + 1] });
    }
    const n = pc.n - 1;
    if (!prev) this._index({ p: idx, i: -1, ax: pc.xs[0], ay: pc.ys[0], bx: pc.xs[0], by: pc.ys[0] + WALL_DEPTH, wall: true });
    pc.endWall = { p: idx, i: -2, ax: pc.xs[n], ay: pc.ys[n], bx: pc.xs[n], by: pc.ys[n] + WALL_DEPTH, wall: true };
    this._index(pc.endWall);
    this.maxY = Math.max(this.maxY, pc.maxY);
    return pc;
  }

  _index(e) {
    const c0 = Math.floor(Math.min(e.ax, e.bx) / CELL);
    const c1 = Math.floor(Math.max(e.ax, e.bx) / CELL);
    if (!e.wall) {
      const sx = e.bx - e.ax;
      const sy = e.by - e.ay;
      const L = Math.hypot(sx, sy) || 1;
      e.nx = sy / L;
      e.ny = -sx / L;
    }
    for (let c = c0; c <= c1; c++) {
      let arr = this.grid.get(c);
      if (!arr) this.grid.set(c, (arr = []));
      arr.push(e);
      if (!e.wall) {
        const my = Math.max(e.ay, e.by);
        const cur = this.cellMaxY.get(c);
        if (cur === undefined || my > cur) this.cellMaxY.set(c, my);
      }
    }
  }

  /** Sample position/tangent/curvature at arc length s. `hint.seg` is reused and updated. */
  sample(pc, s, hint) {
    let i = hint && hint.seg != null ? hint.seg : 0;
    if (i > pc.n - 2) i = pc.n - 2;
    if (i < 0) i = 0;
    while (i < pc.n - 2 && pc.s[i + 1] < s) i++;
    while (i > 0 && pc.s[i] > s) i--;
    if (hint) hint.seg = i;
    const L = pc.segLen[i];
    let t = L > 0 ? (s - pc.s[i]) / L : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const o = this._smp;
    o.x = pc.xs[i] + (pc.xs[i + 1] - pc.xs[i]) * t;
    o.y = pc.ys[i] + (pc.ys[i + 1] - pc.ys[i]) * t;
    let tx = pc.ptx[i] + (pc.ptx[i + 1] - pc.ptx[i]) * t;
    let ty = pc.pty[i] + (pc.pty[i + 1] - pc.pty[i]) * t;
    const l = Math.hypot(tx, ty) || 1;
    o.tx = tx / l;
    o.ty = ty / l;
    o.ang = Math.atan2(o.ty, o.tx);
    o.k = pc.k[i] + (pc.k[i + 1] - pc.k[i]) * t;
    return o;
  }

  /** Earliest crossing of the motion p0->p1 with any track segment or wall. */
  sweep(x0, y0, x1, y1) {
    const c0 = Math.floor(Math.min(x0, x1) / CELL);
    const c1 = Math.floor(Math.max(x0, x1) / CELL);
    const rx = x1 - x0;
    const ry = y1 - y0;
    let bestT = Infinity;
    let best = null;
    for (let c = c0; c <= c1; c++) {
      const arr = this.grid.get(c);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const e = arr[k];
        if (e.disabled) continue;
        const sx = e.bx - e.ax;
        const sy = e.by - e.ay;
        const den = rx * sy - ry * sx;
        if (den > -1e-9 && den < 1e-9) continue;
        const qx = e.ax - x0;
        const qy = e.ay - y0;
        const t = (qx * sy - qy * sx) / den;
        if (t <= 1e-6 || t > 1 || t >= bestT) continue;
        const u = (qx * ry - qy * rx) / den;
        if (u < 0 || u > 1) continue;
        bestT = t;
        best = e;
        this._hit.u = u;
      }
    }
    if (!best) return null;
    const h = this._hit;
    h.p = best.p;
    h.i = best.i;
    h.t = bestT;
    h.wall = best.wall;
    h.x = x0 + rx * bestT;
    h.y = y0 + ry * bestT;
    h.side = best.wall ? 0 : (x0 - best.ax) * best.nx + (y0 - best.ay) * best.ny;
    return h;
  }

  /** Lowest track point near x (for fall-out detection). */
  floorAt(x) {
    const c = Math.floor(x / CELL);
    let m = -Infinity;
    for (let d = -3; d <= 3; d++) {
      const v = this.cellMaxY.get(c + d);
      if (v !== undefined && v > m) m = v;
    }
    return m === -Infinity ? this.maxY : m;
  }

  /** Surface height at x on non-loop track, or null over a gap. */
  heightAt(x) {
    const arr = this.grid.get(Math.floor(x / CELL));
    if (!arr) return null;
    let best = null;
    for (const e of arr) {
      if (e.wall || e.loop) continue;
      const a = Math.min(e.ax, e.bx);
      const b = Math.max(e.ax, e.bx);
      if (x < a || x > b || b - a < 1e-6) continue;
      const y = e.ay + ((x - e.ax) / (e.bx - e.ax)) * (e.by - e.ay);
      if (best === null || y < best) best = y;
    }
    return best;
  }

  sortGems() {
    this.gems.sort((a, b) => a.x - b.x);
  }
}
