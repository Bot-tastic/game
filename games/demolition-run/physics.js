// physics.js — collision between the car and the live props, plus the
// near-miss detector that feeds the combo system.

import { breakProp } from "./props.js";

const NEAR_MISS_GAP = 1.5; // extra clearance that still counts as a near miss

/**
 * Sweep every standing prop against the car box. Props tall enough to matter
 * are skipped while the car is airborne above them, so jumping actually
 * clears traffic. Calls onHit(rec, force, dirX) / onNearMiss(rec).
 */
export function checkCollisions(world, car, fx, onHit, onNearMiss) {
  const carMinX = car.x - car.halfWidth;
  const carMaxX = car.x + car.halfWidth;

  for (const rec of world.liveProps) {
    if (rec.state !== "standing") continue;
    if (rec.z > car.halfDepth + 6 || rec.z < -car.halfDepth - 6) continue;

    const overlapZ = Math.abs(rec.z) < rec.halfDepth + car.halfDepth;
    if (!overlapZ) continue;

    const minX = rec.x - rec.halfWidth;
    const maxX = rec.x + rec.halfWidth;
    const overlapX = carMaxX > minX && carMinX < maxX;

    if (overlapX) {
      // Flying over it? Only if the car is clearly above the prop's roof.
      if (car.y > rec.height + 0.25) continue;
      const force = Math.min(1.4, car.speed / 60 + (car.boosting ? 0.25 : 0));
      const dirX = Math.sign(car.x - rec.x) || 1;
      breakProp(world.pool, rec, fx, force, dirX);
      onHit(rec, force, dirX);
    } else if (!rec.def.pickup) {
      const gap = Math.min(Math.abs(minX - carMaxX), Math.abs(carMinX - maxX));
      if (gap < NEAR_MISS_GAP && !rec.nearMissed && car.speed > 35) {
        rec.nearMissed = true;
        onNearMiss(rec);
      }
    }
  }
}
