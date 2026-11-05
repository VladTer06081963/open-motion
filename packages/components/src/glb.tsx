import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { continueRender, delayRender, useCurrentFrame } from '@open-motion/core';
import { useThree } from './three-context';
import {
  clamp01,
  collectParts,
  computeExplode,
  ExplodeDelay,
  ExplodeEasing,
  ExplodeField,
  ExplodeOptions,
} from './explode';

/**
 * GLB / glTF 2.0 support for OpenMotion.
 *
 * The loader is meshopt-ready: a single extra line (`setMeshoptDecoder`) is
 * what it takes to read a gltfpack-compressed asset (EXT_meshopt_compression).
 */

export interface LoadedGltf {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface UseGltfResult {
  gltf: LoadedGltf | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Loads a GLB file. The load is registered with delayRender/continueRender so
 * that a headless render never captures a half-loaded model.
 */
export function useGltf(src: string): UseGltfResult {
  const [gltf, setGltf] = useState<LoadedGltf | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        continueRender(handle);
      }
    };
    const handle = delayRender(`Loading GLB: ${src}`);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
      src,
      (data) => {
        if (cancelled) {
          release();
          return;
        }
        setGltf({ scene: data.scene, animations: data.animations });
        release();
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        release();
      }
    );

    return () => {
      cancelled = true;
      release();
    };
  }, [src]);

  return { gltf, error, loading: gltf === null && error === null };
}

/**
 * Loads a GLB and adds it to the scene of the enclosing <ThreeCanvas>.
 */
export const Glb: React.FC<{
  src: string;
  /** Optional transforms applied to the loaded root. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  /** Called once the model is in the scene. */
  onLoad?: (gltf: LoadedGltf) => void;
}> = ({ src, position, rotation, scale, onLoad }) => {
  const { scene } = useThree();
  const { gltf, error } = useGltf(src);
  const addedRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!gltf) return;
    const object = gltf.scene;
    if (position) object.position.set(position[0], position[1], position[2]);
    if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (typeof scale === 'number') object.scale.setScalar(scale);
    else if (scale) object.scale.set(scale[0], scale[1], scale[2]);

    scene.add(object);
    addedRef.current = object;
    onLoad?.(gltf);

    return () => {
      scene.remove(object);
      addedRef.current = null;
    };
  }, [gltf, scene, position, rotation, scale, onLoad]);

  if (error) {
    throw new Error(`Failed to load GLB "${src}": ${error.message}`);
  }

  return null;
};

export interface ExplodeProps extends ExplodeOptions {
  /** Root object whose named mesh nodes are the parts. */
  target: THREE.Object3D | null;
  /** Restrict the effect to these node names. Default: every named mesh node. */
  parts?: string[];
  /** Frame at which the explosion starts. */
  startFrame?: number;
  /** Number of frames the explosion takes. */
  durationInFrames?: number;
  /** Play the choreography backwards (assemble). */
  reverse?: boolean;
}

/**
 * Explode / assemble choreography.
 *
 * The whole effect is a pure function of the current frame: no dt, no
 * wall-clock, no randomness. Frame N always produces the same picture.
 */
export const Explode: React.FC<ExplodeProps> = ({
  target,
  parts,
  startFrame = 0,
  durationInFrames = 30,
  reverse = false,
  ...options
}) => {
  const frame = useCurrentFrame();
  const { invalidate } = useThree();

  const optionsKey = JSON.stringify({
    field: options.field,
    lambda: options.lambda,
    window: options.window,
    delay: options.delay,
    delayStep: options.delayStep,
    easing: options.easing,
    spin: options.spin,
    minDistanceFactor: options.minDistanceFactor,
    manualDirections: options.manualDirections,
  });
  const stableOptions = useMemo(
    () => JSON.parse(optionsKey) as ExplodeOptions,
    [optionsKey]
  );

  const partsKey = parts ? parts.join('|') : '';
  const partList = useMemo(() => {
    if (!target) return [];
    return collectParts(target, partsKey ? partsKey.split('|') : undefined);
  }, [target, partsKey]);

  // Remember the untouched transforms so that every frame starts from the
  // authored pose and the effect stays reversible.
  const baseRef = useRef(new Map<string, { position: THREE.Vector3; rotationY: number }>());
  if (baseRef.current.size === 0 && partList.length > 0) {
    for (const part of partList) {
      baseRef.current.set(part.name, {
        position: part.object.position.clone(),
        rotationY: part.object.rotation.y,
      });
    }
  }

  useEffect(() => {
    if (!target || partList.length === 0) return;

    const progress = clamp01((frame - startFrame) / Math.max(durationInFrames, 1));
    const t = reverse ? 1 - progress : progress;

    const results = computeExplode(partList, stableOptions, t);

    for (const { part, offset, spinAngle } of results) {
      const base = baseRef.current.get(part.name);
      if (!base) continue;

      // The offset is computed in the root's local space; convert it into the
      // parent's space when a part is nested deeper than one level.
      let localOffset = offset;
      const parent = part.parent;
      if (parent && parent !== target) {
        const q = new THREE.Quaternion();
        parent.getWorldQuaternion(q);
        q.invert();
        localOffset = offset.clone().applyQuaternion(q);
      }

      part.object.position.copy(base.position).add(localOffset);
      part.object.rotation.y = base.rotationY + spinAngle;
    }

    // The transforms changed outside of a frame change when the model
    // arrived; ask the canvas to redraw.
    invalidate();
  }, [frame, target, partList, stableOptions, startFrame, durationInFrames, reverse, invalidate]);

  return null;
};

export interface CutawayProps {
  /** Root object to clip. */
  target: THREE.Object3D | null;
  /** Clipping planes in world space. */
  planes: Array<{ normal: [number, number, number]; constant: number }>;
  /** Which nodes to clip. Default: every mesh node below target. */
  parts?: string[];
}

/**
 * Cutaway without semantic parts: three.js local clipping planes.
 *
 * This is the second, orthogonal "disassembly" mechanism — it needs geometry
 * only, no named parts, and works with any model.
 */
export const Cutaway: React.FC<CutawayProps> = ({ target, planes, parts }) => {
  const { renderer, invalidate } = useThree();

  useEffect(() => {
    renderer.localClippingEnabled = true;
    return () => {
      renderer.localClippingEnabled = false;
    };
  }, [renderer]);

  useEffect(() => {
    if (!target) return;

    const threePlanes = planes.map(
      (plane) => new THREE.Plane(new THREE.Vector3(...plane.normal), plane.constant)
    );

    const wanted = parts && parts.length > 0 ? new Set(parts) : null;
    const touched: THREE.Mesh[] = [];

    target.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (wanted && (!mesh.name || !wanted.has(mesh.name))) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        material.clippingPlanes = threePlanes;
        material.clipShadows = true;
        material.needsUpdate = true;
      }
      touched.push(mesh);
    });

    return () => {
      for (const mesh of touched) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (!material) continue;
          material.clippingPlanes = null;
          material.needsUpdate = true;
        }
      }
    };
  }, [target, planes, parts]);

  useEffect(() => {
    invalidate();
  }, [invalidate, planes]);

  return null;
};

export interface LabelsProps {
  target: THREE.Object3D | null;
  /** Node names to label. Default: every named mesh node. */
  parts?: string[];
  /** Label text override. */
  format?: (name: string) => string;
  style?: React.CSSProperties;
}

/**
 * HTML labels pinned to the parts of a model. Labels follow the parts during
 * an explosion because they are projected from the live world positions.
 */
export const Labels: React.FC<LabelsProps> = ({ target, parts, format, style }) => {
  const { camera, width, height } = useThree();
  const frame = useCurrentFrame();
  const [items, setItems] = useState<Array<{ name: string; x: number; y: number }>>([]);

  useEffect(() => {
    if (!target) {
      setItems([]);
      return;
    }
    const list = collectParts(target, parts);
    const next = list.map((part) => {
      const world = part.object.getWorldPosition(new THREE.Vector3());
      const projected = world.clone().project(camera);
      return {
        name: part.name,
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height,
      };
    });
    setItems(next);
  }, [target, parts, camera, width, height, frame]);

  return (
    <>
      {items.map((item) => (
        <div
          key={item.name}
          style={{
            position: 'absolute',
            left: item.x,
            top: item.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
            ...style,
          }}
        >
          {format ? format(item.name) : item.name}
        </div>
      ))}
    </>
  );
};
