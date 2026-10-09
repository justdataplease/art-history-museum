// The screening room's glow of the lens, drawn once on a canvas (no image files).

import * as THREE from "three";

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round glow (white centre), for the lens and the lamps. */
export function glowTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.12, "rgba(255,255,255,0.75)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.18)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
