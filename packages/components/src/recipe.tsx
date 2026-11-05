import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useCurrentFrame } from '@open-motion/core';
import { useThree } from './three-context';
import { useGltf } from './glb';
import { Explode, Cutaway, Labels } from './glb';
import {
  ExplodeDelay,
  ExplodeEasing,
  ExplodeField,
  ExplodeOptions,
} from './explode';

/**
 * Scene recipe — the JSON contract an agent edits.
 *
 * The agent never edits JSX and never touches the binary GLB: it writes a
 * recipe (data), the engine turns it into a scene. That keeps every change
 * reviewable, diffable and reproducible.
 */

export interface RecipeModel {
  /** URL of the .glb asset (usually resolved from an asset manifest). */
  src: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

export interface RecipeCamera {
  position?: [number, number, number];
  target?: [number, number, number];
  fov?: number;
  /** Orbit the camera around the target over a frame window. */
  orbit?: {
    degrees: number;
    startFrame?: number;
    durationInFrames?: number;
  };
}

export interface ExplodeEffect extends ExplodeOptions {
  type: 'explode';
  parts?: string[];
  startFrame?: number;
  durationInFrames?: number;
  reverse?: boolean;
}

export interface CutawayEffect {
  type: 'cutaway';
  parts?: string[];
  planes: Array<{
    normal: [number, number, number];
    /** Constant of the clipping plane; may be animated from -> to. */
    constant: number;
    to?: number;
  }>;
  startFrame?: number;
  durationInFrames?: number;
}

export interface LabelsEffect {
  type: 'labels';
  parts?: string[];
  startFrame?: number;
  durationInFrames?: number;
}

export type RecipeEffect = ExplodeEffect | CutawayEffect | LabelsEffect;

export interface SceneRecipe {
  model: RecipeModel;
  camera?: RecipeCamera;
  background?: string;
  effects?: RecipeEffect[];
}

export function isExplodeEffect(effect: RecipeEffect): effect is ExplodeEffect {
  return effect.type === 'explode';
}

export function isCutawayEffect(effect: RecipeEffect): effect is CutawayEffect {
  return effect.type === 'cutaway';
}

export function isLabelsEffect(effect: RecipeEffect): effect is LabelsEffect {
  return effect.type === 'labels';
}

/** Normalised progress of a frame inside an effect window. */
export function effectProgress(
  frame: number,
  startFrame = 0,
  durationInFrames = 30
): number {
  if (durationInFrames <= 0) return 1;
  const t = (frame - startFrame) / durationInFrames;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function isWithinWindow(
  frame: number,
  startFrame = 0,
  durationInFrames = 30
): boolean {
  return frame >= startFrame && frame <= startFrame + durationInFrames;
}

/**
 * Fits the camera to the bounding sphere of an object so that a recipe does
 * not have to know the scale or the position of the asset.
 */
export function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  fov: number,
  margin = 1.25
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return { position: new THREE.Vector3(0, 0, 5), target: new THREE.Vector3(0, 0, 0) };
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = (sphere.radius * margin) / Math.sin((fov * Math.PI) / 360);
  const target = sphere.center.clone();
  const position = new THREE.Vector3(0, 0, distance).add(target);
  return { position, target };
}

/**
 * Renders a recipe inside a <ThreeCanvas>: loads the model, drives the
 * camera, and applies every effect for the current frame.
 */
export const Recipe: React.FC<{ recipe: SceneRecipe }> = ({ recipe }) => {
  const { scene, camera, invalidate } = useThree();
  const frame = useCurrentFrame();
  const { gltf, error } = useGltf(recipe.model.src);
  const [model, setModel] = useState<THREE.Object3D | null>(null);

  // Model transform (applied once, when the model arrives).
  useEffect(() => {
    if (!gltf) return;
    const object = gltf.scene;
    if (recipe.model.position) {
      object.position.set(...recipe.model.position);
    }
    if (recipe.model.rotation) {
      object.rotation.set(...recipe.model.rotation);
    }
    if (typeof recipe.model.scale === 'number') {
      object.scale.setScalar(recipe.model.scale);
    } else if (recipe.model.scale) {
      object.scale.set(...recipe.model.scale);
    }
    scene.add(object);
    setModel(object);
    // The model arrived outside of a frame change: ask the canvas to redraw,
    // otherwise the very first captured frame would be blank.
    invalidate();
    return () => {
      scene.remove(object);
      setModel(null);
    };
  }, [gltf, scene, invalidate, recipe.model.position, recipe.model.rotation, recipe.model.scale]);

  // Background colour.
  useEffect(() => {
    if (!recipe.background) return;
    scene.background = new THREE.Color(recipe.background);
    invalidate();
  }, [scene, invalidate, recipe.background]);

  // Camera: fov, position, target and optional orbit — pure function of frame.
  const cameraConfig = recipe.camera;
  useEffect(() => {
    if (!cameraConfig) return;
    const cam = camera as THREE.PerspectiveCamera;

    if (cameraConfig.fov && cam.fov !== cameraConfig.fov) {
      cam.fov = cameraConfig.fov;
      cam.updateProjectionMatrix();
    }

    const position = new THREE.Vector3(...(cameraConfig.position ?? [0, 0, 5]));
    const target = new THREE.Vector3(...(cameraConfig.target ?? [0, 0, 0]));

    if (cameraConfig.orbit) {
      const { degrees, startFrame = 0, durationInFrames = 60 } = cameraConfig.orbit;
      const progress = effectProgress(frame, startFrame, durationInFrames);
      const offset = position.clone().sub(target);
      const angle = (degrees * Math.PI) / 180 * progress;
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      position.copy(target).add(offset);
    }

    cam.position.copy(position);
    cam.lookAt(target);
    invalidate();
  }, [camera, cameraConfig, frame, invalidate]);

  // Auto-fit: when the recipe does not define a camera, frame the model.
  useEffect(() => {
    if (cameraConfig || !model) return;
    const cam = camera as THREE.PerspectiveCamera;
    const fit = fitCameraToObject(cam, model, cam.fov);
    cam.position.copy(fit.position);
    cam.lookAt(fit.target);
    invalidate();
  }, [camera, cameraConfig, model, invalidate]);

  const effects = recipe.effects ?? [];

  const explodeEffects = useMemo(() => effects.filter(isExplodeEffect), [effects]);
  const cutawayEffects = useMemo(() => effects.filter(isCutawayEffect), [effects]);
  const labelsEffects = useMemo(() => effects.filter(isLabelsEffect), [effects]);

  if (error) {
    throw new Error(`Recipe model failed to load: ${error.message}`);
  }

  return (
    <>
      {explodeEffects.map((effect, index) => (
        <Explode
          key={`explode-${index}`}
          target={model}
          parts={effect.parts}
          field={effect.field}
          lambda={effect.lambda}
          window={effect.window}
          delay={effect.delay as ExplodeDelay | undefined}
          delayStep={effect.delayStep}
          easing={effect.easing as ExplodeEasing | undefined}
          spin={effect.spin}
          minDistanceFactor={effect.minDistanceFactor}
          manualDirections={effect.manualDirections}
          startFrame={effect.startFrame}
          durationInFrames={effect.durationInFrames}
          reverse={effect.reverse}
        />
      ))}

      {cutawayEffects.map((effect, index) => {
        const progress = effectProgress(
          frame,
          effect.startFrame ?? 0,
          effect.durationInFrames ?? 30
        );
        const planes = effect.planes.map((plane) => ({
          normal: plane.normal,
          constant:
            plane.to !== undefined
              ? plane.constant + (plane.to - plane.constant) * progress
              : plane.constant,
        }));
        return (
          <Cutaway
            key={`cutaway-${index}`}
            target={model}
            parts={effect.parts}
            planes={planes}
          />
        );
      })}

      {labelsEffects.map((effect, index) =>
        isWithinWindow(frame, effect.startFrame ?? 0, effect.durationInFrames ?? 30) ? (
          <Labels
            key={`labels-${index}`}
            target={model}
            parts={effect.parts}
          />
        ) : null
      )}
    </>
  );
};
