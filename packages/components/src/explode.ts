import * as THREE from 'three';

/**
 * Pure geometry math for "explode / assemble" choreography.
 *
 * Everything here is a pure function of (parts, options, t) — no Date.now(),
 * no Math.random(), no frame deltas. That is what makes the result
 * reproducible across machines and across renders (see spec delta
 * openspec/changes/2026-11-05-glb-explode-openmotion/specs/glb-scene-recipe).
 */

export type ExplodeField = 'radial' | 'hierarchical' | 'symmetric-fan' | 'manual';
export type ExplodeEasing = 'linear' | 'easeOutCubic' | 'easeInOutCubic';
export type ExplodeDelay = 'none' | 'by-depth' | 'by-radius';

export interface ExplodeOptions {
  /** How the direction of every part is derived. */
  field?: ExplodeField;
  /** Scale of the displacement. 1.0 == "one model radius" for outer parts. */
  lambda?: number;
  /** Width of the time window (in normalised time 0..1) each part uses. */
  window?: number;
  /** How parts are staggered in time. */
  delay?: ExplodeDelay;
  /** Step between consecutive depths when delay = 'by-depth'. */
  delayStep?: number;
  /** Easing applied to each part's own 0..1 progress. */
  easing?: ExplodeEasing;
  /** Number of full turns a part makes while travelling. */
  spin?: number;
  /**
   * Lower bound for the distance of a part, relative to the model radius.
   * Keeps parts that sit exactly on the centroid from staying still.
   */
  minDistanceFactor?: number;
  /** Explicit directions per part name (used by field = 'manual'). */
  manualDirections?: Record<string, [number, number, number]>;
}

export interface PartInfo {
  name: string;
  object: THREE.Object3D;
  /** Parent object in the three.js graph (used to convert root-space offsets). */
  parent: THREE.Object3D | null;
  /** Bounding-box centre expressed in the root object's local space. */
  center: THREE.Vector3;
  /** Local position captured before any displacement is applied. */
  basePosition: THREE.Vector3;
  /** Local Y rotation captured before any spin is applied. */
  baseRotationY: number;
  /** Distance from the model root (number of ancestors). */
  depth: number;
  /** Diagonal of the part's bounding box. */
  size: number;
  /** Distance from the model centroid. */
  radius: number;
}

export interface ExplodeResult {
  part: PartInfo;
  /** Offset in root-local space, already scaled by the eased progress. */
  offset: THREE.Vector3;
  /** Spin in radians, already scaled by the eased progress. */
  spinAngle: number;
}

const EPS = 1e-6;

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function easingFactor(name: ExplodeEasing, x: number): number {
  const t = clamp01(x);
  switch (name) {
    case 'easeOutCubic':
      return 1 - Math.pow(1 - t, 3);
    case 'easeInOutCubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'linear':
    default:
      return t;
  }
}

function isMeshLike(object: THREE.Object3D): boolean {
  const anyObject = object as unknown as { isMesh?: boolean; geometry?: unknown };
  return Boolean(anyObject.isMesh) && Boolean(anyObject.geometry);
}

/**
 * Collects every named mesh below `root` as an addressable "part".
 * Parts without a name are skipped: unnamed nodes cannot be addressed by a
 * recipe, which is the whole point of the named-node contract.
 */
export function collectParts(root: THREE.Object3D, names?: string[]): PartInfo[] {
  const wanted = names && names.length > 0 ? new Set(names) : null;
  const parts: PartInfo[] = [];

  root.updateWorldMatrix(true, true);

  const walk = (object: THREE.Object3D, depth: number) => {
    if (object.name && isMeshLike(object)) {
      if (!wanted || wanted.has(object.name)) {
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        root.worldToLocal(center);
        const size = box.getSize(new THREE.Vector3()).length();
        parts.push({
          name: object.name,
          object,
          parent: object.parent,
          center,
          basePosition: object.position.clone(),
          baseRotationY: object.rotation.y,
          depth,
          size,
          radius: 0,
        });
      }
    }
    for (const child of object.children) {
      walk(child, object === root ? depth : depth + 1);
    }
  };

  walk(root, 0);

  // Centroid of all parts, in root-local space.
  const centroid = new THREE.Vector3();
  for (const part of parts) centroid.add(part.center);
  if (parts.length > 0) centroid.multiplyScalar(1 / parts.length);
  for (const part of parts) part.radius = part.center.distanceTo(centroid);

  return parts;
}

/** Nearest ancestor that is itself a part (for the hierarchical field). */
function nearestPartParent(part: PartInfo, parts: PartInfo[]): PartInfo | null {
  const byObject = new Map(parts.map((p) => [p.object, p]));
  let current = part.parent;
  while (current) {
    const found = byObject.get(current);
    if (found) return found;
    current = current.parent;
  }
  return null;
}

function radialDirection(part: PartInfo, centroid: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  const dir = part.center.clone().sub(centroid);
  if (dir.length() < EPS) return fallback.clone();
  return dir.normalize();
}

/**
 * Groups parts that are (nearly) the same size — the signature of a
 * symmetric group such as four chair legs or a set of vertebrae.
 */
function groupBySize(parts: PartInfo[]): PartInfo[][] {
  const groups: PartInfo[][] = [];
  const sorted = [...parts].sort((a, b) => a.size - b.size);
  const maxSize = sorted.length > 0 ? sorted[sorted.length - 1].size : 0;
  const tol = Math.max(maxSize * 0.03, EPS);
  for (const part of sorted) {
    const bucket = groups.find((g) => Math.abs(g[0].size - part.size) <= tol);
    if (bucket) bucket.push(part);
    else groups.push([part]);
  }
  return groups;
}

/**
 * Computes the direction of every part, in root-local space.
 */
export function computeDirections(
  parts: PartInfo[],
  field: ExplodeField,
  centroid: THREE.Vector3,
  manual?: Record<string, [number, number, number]>,
): Map<string, THREE.Vector3> {
  const directions = new Map<string, THREE.Vector3>();
  if (parts.length === 0) return directions;

  const maxRadius = Math.max(...parts.map((p) => p.radius), EPS);
  const fallback = new THREE.Vector3(0, 1, 0);

  if (field === 'hierarchical') {
    for (const part of parts) {
      const parent = nearestPartParent(part, parts);
      if (!parent) {
        directions.set(part.name, radialDirection(part, centroid, fallback));
        continue;
      }
      const dir = part.center.clone().sub(parent.center);
      if (dir.length() < EPS) {
        directions.set(part.name, radialDirection(part, centroid, fallback));
      } else {
        directions.set(part.name, dir.normalize());
      }
    }
    return directions;
  }

  if (field === 'symmetric-fan') {
    for (const part of parts) {
      directions.set(part.name, radialDirection(part, centroid, fallback));
    }
    for (const group of groupBySize(parts)) {
      if (group.length < 2) continue;
      const groupCentroid = new THREE.Vector3();
      for (const part of group) groupCentroid.add(part.center);
      groupCentroid.multiplyScalar(1 / group.length);

      const axis = groupCentroid.clone().sub(centroid);
      if (axis.length() < EPS) continue;
      axis.normalize();

      const u = new THREE.Vector3(0, 1, 0).cross(axis);
      if (u.length() < EPS) u.set(1, 0, 0);
      u.normalize();
      const v = axis.clone().cross(u).normalize();

      const n = group.length;
      group.forEach((part, index) => {
        const theta = (2 * Math.PI * index) / n;
        const dir = u
          .clone()
          .multiplyScalar(Math.cos(theta))
          .add(v.clone().multiplyScalar(Math.sin(theta)))
          .add(axis.clone().multiplyScalar(0.3));
        if (dir.length() > EPS) directions.set(part.name, dir.normalize());
      });
    }
    return directions;
  }

  if (field === 'manual' && manual) {
    for (const part of parts) {
      const explicit = manual[part.name];
      if (!explicit) {
        directions.set(part.name, radialDirection(part, centroid, fallback));
        continue;
      }
      const dir = new THREE.Vector3(explicit[0], explicit[1], explicit[2]);
      if (dir.length() < EPS) directions.set(part.name, radialDirection(part, centroid, fallback));
      else directions.set(part.name, dir.normalize());
    }
    return directions;
  }

  for (const part of parts) {
    directions.set(part.name, radialDirection(part, centroid, fallback));
  }
  return directions;
}

/**
 * The choreography itself: given parts and normalised time t (0..1), returns
 * the displacement of every part. Reversing t (t -> 1 - t) reassembles.
 */
export function computeExplode(
  parts: PartInfo[],
  options: ExplodeOptions,
  t: number,
): ExplodeResult[] {
  const {
    field = 'radial',
    lambda = 0.35,
    window: windowWidth = 0.35,
    delay = 'by-radius',
    delayStep = 0.08,
    easing = 'easeInOutCubic',
    spin = 0,
    minDistanceFactor = 0.35,
    manualDirections,
  } = options;

  if (parts.length === 0) return [];

  const centroid = new THREE.Vector3();
  for (const part of parts) centroid.add(part.center);
  centroid.multiplyScalar(1 / parts.length);

  const maxRadius = Math.max(...parts.map((p) => p.radius), EPS);
  const directions = computeDirections(parts, field, centroid, manualDirections);
  const win = Math.max(windowWidth, EPS);

  return parts.map((part) => {
    const direction = directions.get(part.name) ?? new THREE.Vector3(0, 1, 0);

    let delay_i = 0;
    if (delay === 'by-depth') {
      delay_i = part.depth * delayStep;
    } else if (delay === 'by-radius') {
      delay_i = (part.radius / maxRadius) * (1 - win);
    }
    delay_i = Math.min(delay_i, Math.max(0, 1 - win));

    const progress = easingFactor(easing, (t - delay_i) / win);

    const distance = lambda * Math.max(part.radius, minDistanceFactor * maxRadius);
    const offset = direction.multiplyScalar(distance * progress);
    const spinAngle = spin * Math.PI * 2 * progress;

    return { part, offset, spinAngle };
  });
}
