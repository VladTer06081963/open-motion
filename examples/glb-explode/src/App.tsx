import React, { useEffect, useState } from 'react';
import {
  Composition,
  CompositionProvider,
  continueRender,
  delayRender,
  useVideoConfig,
} from '@open-motion/core';
import { Recipe, SceneRecipe, ThreeCanvas, Lights } from '@open-motion/components';
import { DebugProbe } from './DebugProbe';

const CONFIG = {
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 120,
};

/**
 * Loads the recipe (pure data) from the public folder.
 *
 * This is the agent-facing surface: change the JSON, re-render, no code edits.
 */
const useRecipe = (url: string): SceneRecipe | null => {
  const [recipe, setRecipe] = useState<SceneRecipe | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = delayRender(`Loading recipe: ${url}`);
    fetch(url)
      .then((response) => response.json())
      .then((data: SceneRecipe) => {
        if (!cancelled) setRecipe(data);
        continueRender(handle);
      })
      .catch((error) => {
        console.error('Failed to load recipe', error);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return recipe;
};

const ExplodeScene: React.FC<{ recipeUrl: string }> = ({ recipeUrl }) => {
  const recipe = useRecipe(recipeUrl);
  const { width, height } = useVideoConfig();

  if (!recipe) {
    return <div style={{ width, height, background: '#05070d' }} />;
  }

  return (
    <ThreeCanvas
      width={width}
      height={height}
      renderScene={() => undefined}
    >
      <Lights />
      <Recipe recipe={recipe} />
      <DebugProbe />
    </ThreeCanvas>
  );
};

export const App: React.FC = () => {
  const isRendering = typeof (window as any).__OPEN_MOTION_FRAME__ === 'number';
  const compositionId = (window as any).__OPEN_MOTION_COMPOSITION_ID__ || 'glb-explode';
  const frame = (window as any).__OPEN_MOTION_FRAME__ || 0;

  if (isRendering) {
    return (
      <CompositionProvider config={CONFIG} frame={frame}>
        <ExplodeScene recipeUrl="/recipes/anatomy-explode.json" />
      </CompositionProvider>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#05070d' }}>
      <CompositionProvider config={CONFIG} frame={frame}>
        <ExplodeScene recipeUrl="/recipes/anatomy-explode.json" />
      </CompositionProvider>
      <div style={{ display: 'none' }}>
        <Composition id="glb-explode" component={ExplodeScene} {...CONFIG} />
      </div>
    </div>
  );
};
