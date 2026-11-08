// Starts the page's background animation: the 3D scene where WebGL works, the flat one otherwise.

import { wireFlow } from './flow.js';
import { reduceMotion } from './util.js';

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// The 3D scene loads separately, so the site still works if WebGL or the CDN isn't available.
export async function startHeroScene() {
  if (!reduceMotion && webglAvailable()) {
    try {
      const { wireFlow3D } = await import('./flow3d.js');
      wireFlow3D();
      return;
    } catch (err) {
      console.warn('3D scene unavailable, using the flat animation.', err);
    }
  }
  document.documentElement.classList.add('no-3d');
  wireFlow();
}
