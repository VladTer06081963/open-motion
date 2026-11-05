import * as THREE from 'three';
import React from 'react';

/**
 * Context published by <ThreeCanvas>. Gives child components (Glb, Explode,
 * Cutaway, Labels) access to the live scene/camera/renderer without the caller
 * having to thread them through renderScene() by hand.
 */
export interface ThreeState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  /**
   * Requests a re-render of the canvas.
   *
   * The canvas re-renders on every frame change, but children may also
   * change the scene outside of a frame change — a GLB that finished
   * loading, for example. Without this hook such a change would stay
   * invisible until the next frame, and in a headless render that captured
   * the frame would be blank.
   */
  invalidate: () => void;
}

export const ThreeContext = React.createContext<ThreeState | null>(null);

export function useThree(): ThreeState {
  const ctx = React.useContext(ThreeContext);
  if (!ctx) {
    throw new Error('useThree() must be called inside <ThreeCanvas>');
  }
  return ctx;
}
