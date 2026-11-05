import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectParts, computeExplode } from '../src/explode.ts';

function makeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'model';
  const positions: Array<[string, number, number, number]> = [
    ['body', 0, 0, 0],
    ['head', 0, 1.2, 0],
    ['arm_l', -0.6, 0.2, 0],
    ['arm_r', 0.6, 0.2, 0],
  ];
  for (const [name, x, y, z] of positions) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
    mesh.name = name;
    mesh.position.set(x, y, z);
    root.add(mesh);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

const model = makeModel();
const parts = collectParts(model);
assert.equal(parts.length, 4, 'collects every named mesh');

// t=0 -> nothing moved
const at0 = computeExplode(parts, { field: 'radial', lambda: 0.5 }, 0);
for (const r of at0) {
  assert.ok(r.offset.length() < 1e-9, 'no displacement at t=0');
}

// t=1 -> every part moved, and none stayed on the centroid
const at1 = computeExplode(parts, { field: 'radial', lambda: 0.5 }, 1);
for (const r of at1) {
  assert.ok(r.offset.length() > 1e-6, `part ${r.part.name} moved at t=1`);
}

// symmetric group: arms have equal size -> symmetric-fan spreads them apart
const fan = computeExplode(parts, { field: 'symmetric-fan', lambda: 0.5, delay: 'none' }, 1);
const armL = fan.find((r) => r.part.name === 'arm_l')!;
const armR = fan.find((r) => r.part.name === 'arm_r')!;
assert.ok(armL.offset.dot(armR.offset) < 0, 'symmetric parts diverge');

// deterministic: same inputs -> same output
const a = computeExplode(parts, { field: 'radial', lambda: 0.4, delay: 'by-radius' }, 0.37);
const b = computeExplode(parts, { field: 'radial', lambda: 0.4, delay: 'by-radius' }, 0.37);
for (let i = 0; i < a.length; i++) {
  assert.ok(a[i].offset.distanceTo(b[i].offset) < 1e-12, 'deterministic');
}

// reversible: the position at 1-t is the mirror image of the position at t
// around the fully-exploded pose D (offset(t) + offset(1-t) === D).
const opts = { field: 'radial' as const, lambda: 0.5, delay: 'none' as const, window: 1 };
const fully = computeExplode(parts, opts, 1);
const fwd = computeExplode(parts, opts, 0.6);
const back = computeExplode(parts, opts, 0.4);
for (let i = 0; i < fwd.length; i++) {
  const sum = fwd[i].offset.clone().add(back[i].offset);
  const D = fully[i].offset;
  assert.ok(sum.distanceTo(D) < 1e-9, `part ${fwd[i].part.name} mirrors around the exploded pose`);
}

console.log('explode.test.ts: all assertions passed');
