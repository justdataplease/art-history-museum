// The cinema's surfaces, drawn once on canvases (no image files): acoustic fabric for the walls, a patterned
// carpet, dark wood, and the radial glow of the lens.

import * as THREE from "three";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

/** Acoustic wall fabric: a fine vertical weave with soft unevenness. */
export function fabricTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(512, (g, n) => {
    const r = rng(7);
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
      g.fillRect(x, 0, 1, n);
    }
    for (let y = 0; y < n; y += 3) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
      g.fillRect(0, y, n, 1);
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
      g.fillRect(r() * n, r() * n, 1 + r() * 3, 6 + r() * 30);
    }
  });
}

/** The carpet: deep red with a small repeating motif. */
export function carpetTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, n) => {
    const r = rng(11);
    g.fillStyle = "#3d0c12";
    g.fillRect(0, 0, n, n);
    const cell = n / 8;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const cx = i * cell + cell / 2;
        const cy = j * cell + cell / 2;
        g.save();
        g.translate(cx, cy);
        g.rotate(Math.PI / 4);
        g.fillStyle = "rgba(196, 140, 60, 0.22)";
        g.fillRect(-cell * 0.16, -cell * 0.16, cell * 0.32, cell * 0.32);
        g.fillStyle = "#3d0c12";
        g.fillRect(-cell * 0.09, -cell * 0.09, cell * 0.18, cell * 0.18);
        g.restore();
        g.fillStyle = "rgba(196, 140, 60, 0.16)";
        g.beginPath();
        g.arc(i * cell, j * cell, cell * 0.05, 0, Math.PI * 2);
        g.fill();
      }
    }
    // pile: speckle
    const img = g.getImageData(0, 0, n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = (r() - 0.5) * 26;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + k));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + k * 0.6));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + k * 0.6));
    }
    g.putImageData(img, 0, 0);
  });
}

/** Dark stained wood along its grain (x). */
export function woodTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, n) => {
    const r = rng(23);
    g.fillStyle = "#2a1810";
    g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y++) {
      const v = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 4) * 0.5 + 0.5;
      g.fillStyle = `rgba(${90 + v * 40}, ${52 + v * 26}, ${30 + v * 14}, ${0.18 + r() * 0.1})`;
      g.fillRect(0, y, n, 1);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(10,5,2,${r() * 0.25})`;
      g.fillRect(r() * n, r() * n, 20 + r() * 120, 1);
    }
  });
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

/** "EXIT" in green, for the sign over the door. */
export function exitTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b3d1d";
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#7dffaf";
  g.font = "bold 64px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("EXIT", 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
