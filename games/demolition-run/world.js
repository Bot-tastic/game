// world.js — street/segment generation, scrolling, and recycling.
//
// World coordinate convention (shared with car.js and Pass 2): the car is
// fixed at world Z=0 forever. "Driving forward" is simulated by scrolling
// everything else (road/sidewalk/building meshes and all live props)
// toward -Z by `carSpeed * dt` each frame. Segments are generated ahead of
// the car (positive Z) and recycled once they've scrolled behind it.
//
// createWorld(scene) builds the initial pool of segments (each with road,
// sidewalk and building meshes, plus any props.js-spawned props) and
// returns a world handle:
//   world.liveProps   — array of live prop-instance records (see props.js
//                        for the exact required shape). Pass 2's physics.js
//                        iterates this every frame for collision checks.
//                        world.js keeps this array in sync as segments
//                        recycle: records for recycled-out segments are
//                        removed, records for newly generated segments are
//                        added. world.js never removes a record just
//                        because Pass 2 marked it "flying"/"destroyed" —
//                        only segment recycling removes records.
//
// updateWorld(world, dt, carSpeed) scrolls every segment (and its props)
// by carSpeed*dt, and recycles/regenerates segments that have scrolled too
// far behind the car.
//
// props.js composition note: world.js is responsible for calling into
// props.js (spawnProp/despawnProp/updatePropTransform) to populate and
// recycle each segment's props. main.js does not import props.js directly.

import * as THREE from "three";
import { createPropsPool, spawnProp, despawnProp, updatePropTransform } from "./props.js";

export const SEGMENT_LENGTH = 40;
export const DRAW_DISTANCE = 300; // ~8 segments visible ahead
export const STREET_HALF_WIDTH = 6; // must match car.js's STREET_HALF_WIDTH exactly

// Segments are recycled once their far edge (the one still facing the
// camera, at Z = -7) has scrolled behind this threshold — a margin behind
// the camera so recycling happens only once the segment is fully offscreen.
const RECYCLE_BEHIND_Z = -20;

// Extra grace period (seconds) a segment waits *after* crossing
// RECYCLE_BEHIND_Z before it's actually recycled — a cushion so a segment
// never gets pulled away right at the edge of visibility, in case the fog
// distance, FOV, or camera framing lets a sliver of it peek back into view.
const RECYCLE_DELAY_SECONDS = 3;

const BUILDING_COLORS = [0x33394a, 0x3d3626, 0x2f4038, 0x402f3a];

// Number of segment slots kept in the active pool. Enough to cover the draw
// distance ahead plus a couple behind for recycle margin.
const NUM_SEGMENTS_IN_POOL = Math.ceil(DRAW_DISTANCE / SEGMENT_LENGTH) + 3;

// ---- seeded PRNG (mulberry32-style) ----
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSegmentMeshes(scene) {
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2a2d35, flatShading: true });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x3a3d47, flatShading: true });
  const buildingMat = new THREE.MeshLambertMaterial({ color: 0x33394a, flatShading: true });

  const roadGeo = new THREE.BoxGeometry(STREET_HALF_WIDTH * 2, 0.2, SEGMENT_LENGTH);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.y = -0.1;

  const sidewalkWidth = 3;
  const sidewalkGeo = new THREE.BoxGeometry(sidewalkWidth, 0.3, SEGMENT_LENGTH);
  const sidewalkL = new THREE.Mesh(sidewalkGeo, sidewalkMat);
  sidewalkL.position.set(-(STREET_HALF_WIDTH + sidewalkWidth / 2), -0.05, 0);
  const sidewalkR = new THREE.Mesh(sidewalkGeo, sidewalkMat);
  sidewalkR.position.set(STREET_HALF_WIDTH + sidewalkWidth / 2, -0.05, 0);

  // One building box per side per segment slot; height/color re-rolled on
  // each (re)generation via the seeded PRNG.
  const buildingGeo = new THREE.BoxGeometry(6, 1, SEGMENT_LENGTH * 0.9);
  const buildingL = new THREE.Mesh(buildingGeo, buildingMat.clone());
  const buildingR = new THREE.Mesh(buildingGeo, buildingMat.clone());

  const group = new THREE.Group();
  group.add(road, sidewalkL, sidewalkR, buildingL, buildingR);
  scene.add(group);

  return { group, road, sidewalkL, sidewalkR, buildingL, buildingR, offscreenTimer: 0 };
}

// Roll the per-segment spawn table deterministically off `rng`, capping the
// total number of spawned props at 4 (fixed priority order on overflow).
function rollSpawnPlan(rng, segmentIndex) {
  const plan = [];

  // 60%: 1 lamppost per side, x = ±4.3
  if (rng() < 0.6) {
    plan.push({ typeId: "lamppost", x: -4.3, rot: 0 });
    plan.push({ typeId: "lamppost", x: 4.3, rot: 0 });
  }
  // 35%: 1 parked car in shoulder band (|x| in [4.5, 6]), either side
  if (rng() < 0.35) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (4.5 + rng() * 1.5);
    const rot = (rng() - 0.5) * 0.3;
    plan.push({ typeId: "parkedcar", x, rot });
  }
  // 25%: cluster of 1-3 cones/trashcans near the shoulder
  if (rng() < 0.25) {
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * (4.6 + rng() * 1.2);
      const typeId = rng() < 0.5 ? "cone" : "trashcan";
      plan.push({ typeId, x, rot: 0 });
    }
  }
  // 15%: 1 sign/mailbox
  if (rng() < 0.15) {
    const side = rng() < 0.5 ? -1 : 1;
    plan.push({ typeId: "sign", x: side * 4.3, rot: 0 });
  }
  // 20%: 1-2 ragdoll pedestrians near the sidewalk edge
  if (rng() < 0.2) {
    const count = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * (6.5 + rng() * 1.5);
      plan.push({ typeId: "ragdoll", x, rot: rng() * Math.PI * 2 });
    }
  }
  // every 6th segment (deterministic): 1 barrier in the shoulder band,
  // sometimes overlapping into the drivable edge
  if (segmentIndex % 6 === 0) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (5 + rng() * 1.5);
    plan.push({ typeId: "barrier", x, rot: 0 });
  }

  // Fixed priority order on overflow: keep the first 4 in this priority.
  const priority = ["barrier", "parkedcar", "lamppost", "ragdoll", "sign", "cone", "trashcan"];
  plan.sort((a, b) => priority.indexOf(a.typeId) - priority.indexOf(b.typeId));

  return plan.slice(0, 4);
}

/** (Re)generate a segment slot's building look and props for `segmentIndex`,
 * placing it at `baseZ`. Removes this slot's previous prop records from
 * `liveProps` (if any) before spawning new ones. */
function generateSegment(slot, segmentIndex, baseZ, pool, liveProps) {
  const rng = mulberry32(segmentIndex);

  slot.segmentIndex = segmentIndex;
  slot.baseZ = baseZ;
  slot.group.position.z = baseZ;
  slot.offscreenTimer = 0;

  // Despawn this slot's previous props (if recycling). A record Pass 2's
  // physics.js already despawned early (state "despawned") has had its
  // instanceIndex freed back to the pool already, and that slot may since
  // have been reassigned to an unrelated live prop — despawning it again
  // here would push a duplicate index onto the free list and corrupt that
  // other prop's instance, so skip the redundant despawnProp call for it
  // (it still needs removing from liveProps like any other recycled record).
  if (slot.props && slot.props.length) {
    for (const record of slot.props) {
      if (record.state !== "despawned") despawnProp(pool, record);
      const idx = liveProps.indexOf(record);
      if (idx !== -1) liveProps.splice(idx, 1);
    }
  }

  // Re-roll building heights/colors for this segment.
  const heightL = 8 + rng() * 16;
  const heightR = 8 + rng() * 16;
  slot.buildingL.scale.y = heightL;
  slot.buildingL.position.set(-(STREET_HALF_WIDTH + 3 + 6 / 2), heightL / 2, 0);
  slot.buildingL.material.color.setHex(BUILDING_COLORS[Math.abs(segmentIndex) % BUILDING_COLORS.length]);

  slot.buildingR.scale.y = heightR;
  slot.buildingR.position.set(STREET_HALF_WIDTH + 3 + 6 / 2, heightR / 2, 0);
  slot.buildingR.material.color.setHex(BUILDING_COLORS[(Math.abs(segmentIndex) + 1) % BUILDING_COLORS.length]);

  // Roll and spawn this segment's props. Prop positions are given relative
  // to the segment's local Z span [-SEGMENT_LENGTH/2, SEGMENT_LENGTH/2]; we
  // scatter them across that span using the same rng stream.
  const plan = rollSpawnPlan(rng, segmentIndex);
  const props = [];
  for (const item of plan) {
    const localZ = (rng() - 0.5) * SEGMENT_LENGTH * 0.8;
    const worldZ = baseZ + localZ;
    const record = spawnProp(pool, item.typeId, item.x, worldZ, item.rot);
    if (record) {
      props.push(record);
      liveProps.push(record);
    }
  }
  slot.props = props;
}

/**
 * Build the initial segment pool and populate it with props. Returns the
 * world handle: { scene, pool, segments, liveProps }.
 */
export function createWorld(scene) {
  const pool = createPropsPool(scene);
  const liveProps = [];
  const segments = [];

  for (let i = 0; i < NUM_SEGMENTS_IN_POOL; i++) {
    const slot = buildSegmentMeshes(scene);
    segments.push(slot);
  }

  // Initial placement: segment 0 centered near the car (baseZ=0), segments
  // 1..N ahead at increasing positive Z.
  for (let i = 0; i < NUM_SEGMENTS_IN_POOL; i++) {
    const baseZ = i * SEGMENT_LENGTH;
    generateSegment(segments[i], i, baseZ, pool, liveProps);
  }

  return { scene, pool, segments, liveProps, nextSegmentIndex: NUM_SEGMENTS_IN_POOL };
}

/** Reset the world to its initial layout (called on Start/Retry). */
export function resetWorld(world) {
  for (let i = 0; i < world.segments.length; i++) {
    const baseZ = i * SEGMENT_LENGTH;
    generateSegment(world.segments[i], i, baseZ, world.pool, world.liveProps);
  }
  world.nextSegmentIndex = world.segments.length;
}

/**
 * Scroll every segment (and its props) by carSpeed*dt toward -Z. A segment
 * whose trailing edge has scrolled past RECYCLE_BEHIND_Z is left in place
 * (already invisible) for a further RECYCLE_DELAY_SECONDS before it's
 * actually recycled — moved back to the front of the active window and
 * re-rolled via the seeded PRNG. All segments share one uniform scroll
 * speed and stay exactly SEGMENT_LENGTH apart forever, so the pool remains
 * one contiguous strip regardless of how long any single slot's recycle is
 * delayed — delaying it never opens a gap ahead of the camera.
 */
export function updateWorld(world, dt, carSpeed) {
  const dz = carSpeed * dt;

  for (const slot of world.segments) {
    slot.baseZ -= dz;
    slot.group.position.z = slot.baseZ;

    for (const record of slot.props) {
      record.z -= dz;
      // Skip records Pass 2's physics.js has already despawned: their
      // instanceIndex was freed back to the pool and may already belong to
      // an unrelated live prop, so writing to it here would clobber that
      // prop's transform.
      if (record.state !== "despawned") updatePropTransform(world.pool, record);
    }

    // The camera sits behind the car looking toward +Z, and everything
    // scrolls toward -Z, so the edge that stays in view LONGEST is the one
    // with the larger Z (baseZ + SEGMENT_LENGTH/2) — only once that edge
    // has scrolled behind the camera is the whole segment actually
    // offscreen. Using the smaller-Z edge here would recycle a segment
    // while its far half is still clearly visible.
    const trailingEdge = slot.baseZ + SEGMENT_LENGTH / 2;
    if (trailingEdge < RECYCLE_BEHIND_Z) {
      slot.offscreenTimer += dt;
    } else {
      slot.offscreenTimer = 0;
    }
    if (slot.offscreenTimer >= RECYCLE_DELAY_SECONDS) {
      const newIndex = world.nextSegmentIndex++;
      const newBaseZ = slot.baseZ + world.segments.length * SEGMENT_LENGTH;
      generateSegment(slot, newIndex, newBaseZ, world.pool, world.liveProps);
    }
  }
}
