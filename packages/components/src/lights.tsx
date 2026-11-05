import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from './three-context';

export interface LightsProps {
  /** Key light direction (normalised internally). */
  key?: [number, number, number];
  keyIntensity?: number;
  fill?: [number, number, number];
  fillIntensity?: number;
  ambient?: number;
  /** Distance used for the directional light; 0 = directional (infinite). */
  distance?: number;
}

/**
 * Default three-point lighting.
 *
 * A GLB carries no lights, so a scene without lights renders as a black
 * silhouette. This component makes a recipe renderable without any manual
 * scene setup.
 */
export const Lights: React.FC<LightsProps> = ({
  key: keyDirection = [1, 1.5, 2],
  keyIntensity = 2.2,
  fill: fillDirection = [-1.5, 0.8, 1],
  fillIntensity = 0.8,
  ambient = 0.6,
  distance = 0,
}) => {
  const { scene } = useThree();

  useEffect(() => {
    const group = new THREE.Group();
    group.name = 'openmotion-lights';

    const ambientLight = new THREE.AmbientLight(0xffffff, ambient);

    const key = new THREE.DirectionalLight(0xffffff, keyIntensity);
    key.position.set(...keyDirection).normalize().multiplyScalar(distance || 1);
    if (distance) {
      key.position.multiplyScalar(distance);
    }

    const fill = new THREE.DirectionalLight(0xffffff, fillIntensity);
    fill.position.set(...fillDirection).normalize().multiplyScalar(distance || 1);
    if (distance) {
      fill.position.multiplyScalar(distance);
    }

    group.add(ambientLight, key, fill);
    scene.add(group);

    return () => {
      scene.remove(group);
      group.clear();
    };
  }, [scene, keyDirection, keyIntensity, fillDirection, fillIntensity, ambient, distance]);

  return null;
};
