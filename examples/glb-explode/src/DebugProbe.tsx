import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@open-motion/components';

/**
 * Dumps scene state into window.__DEBUG__ so headless tooling can inspect
 * what the renderer actually sees (camera, bounds, part count).
 */
export const DebugProbe: React.FC = () => {
  const { scene, camera, renderer } = useThree();

  useEffect(() => {
    const dump = () => {
      const box = new THREE.Box3().setFromObject(scene);
      const meshes: Array<{ name: string; size: number }> = [];
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const b = new THREE.Box3().setFromObject(mesh);
        meshes.push({
          name: object.name,
          size: b.isEmpty() ? 0 : b.getSize(new THREE.Vector3()).length(),
        });
      });
      (window as any).__DEBUG__ = {
        camera: {
          position: camera.position.toArray(),
          fov: (camera as THREE.PerspectiveCamera).fov,
        },
        bounds: {
          min: box.min.toArray(),
          max: box.max.toArray(),
          size: box.getSize(new THREE.Vector3()).toArray(),
        },
        meshCount: meshes.length,
        firstMeshes: meshes.slice(0, 8),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    };

    dump();
    const timer = setInterval(dump, 500);
    return () => clearInterval(timer);
  }, [scene, camera, renderer]);

  return null;
};
