"use client";

// Room numbers by a suite's doorways, as museums letter them: on each face
// of a cross wall, beside the door case at a little above head height (where
// the view keeps it clear of the HUD's title card and navigator at reading
// distance), the number of the room beyond and the real year span of the
// works hung in it ("II · 1460 – 1490"), on an ivory card in the wall labels'
// typography. All cards are one merged mesh (a single draw call, layer 1 so
// the floor does not reflect it) over one small atlas holding only the cards
// of the rooms around the visitor: the atlas has a fixed number of rows that
// are redrawn as the visitor moves on, so its size never grows with the suite.

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { roomNumeral, roomYears, type GalleryLayout } from "./layout";
import { blankPlacardTexture, fontFamilies, placardFontsReady } from "./exhibit-placard";
import { setRoomWindow, type IndexRange } from "./room-geometry";
import type { SuiteRuntime } from "./suite-runtime";

const PROP_LAYER = 1;
// surface effects may land on the signs
const FX_TARGET = { fxTarget: true };
/** Card proportions, size and texture row size. */
const CARD_ASPECT = 4.2;
const CARD_H = 0.22;
const TEX_W = 768;
const TEX_H = Math.round(TEX_W / CARD_ASPECT);
/** Card centre above the floor (never above a door's head less this). */
const CARD_Y = 2.25;
const BELOW_DOOR_HEAD = 0.7;
/** Clear wall between the door case's outer edge and the card. */
const CASE_REACH = 0.135;
const CASE_GAP = 0.25;
const STAND_OFF = 0.006;
/** Cards drawn (and held in the atlas) for rooms this far either side of the visitor's. */
const SIGN_REACH = 2;

interface Sign {
  /** Room the card names. */
  room: number;
  /** Room the card hangs in (seen from). */
  in: number;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
}

function planSigns(layout: GalleryLayout): Sign[] {
  const hw = (CARD_H * CARD_ASPECT) / 2;
  const signs: Sign[] = [];
  layout.doorways.forEach((d, i) => {
    const y = Math.min(CARD_Y, d.height - BELOW_DOOR_HEAD);
    // beside the door case, on the visitor's right as they face the doorway
    // (beyond a palace gallery's columns)
    const off = d.halfWidth + (d.columns ? 0.8 : CASE_REACH + CASE_GAP) + hw;
    if (off + hw > layout.hallWidth / 2 - 0.3) return;
    // approaching from the entrance (facing −z, right = +x): the room beyond
    signs.push({ room: i + 1, in: i, x: off, y, z: d.z + d.thickness / 2, facing: 1 });
    // looking back (facing +z, right = −x): the room before
    signs.push({ room: i, in: i + 1, x: -off, y, z: d.z - d.thickness / 2, facing: -1 });
  });
  // room by room, so the rooms around the visitor are one draw range
  return signs.sort((a, b) => a.in - b.in);
}

/** Each room's cards as an index range of the merged quads (6 per card). */
function signRanges(signs: Sign[], rooms: number): IndexRange[] {
  const ranges: IndexRange[] = Array.from({ length: rooms }, () => ({ start: 0, count: 0 }));
  for (const s of signs) ranges[s.in].count += 6;
  let at = 0;
  for (const range of ranges) {
    range.start = at;
    at += range.count;
  }
  return ranges;
}

/** Rooms whose cards are drawn with the visitor in `room`: [first, last]. */
function signWindow(room: number, rooms: number): [number, number] {
  return [Math.max(0, room - SIGN_REACH), Math.min(rooms - 1, room + SIGN_REACH)];
}

/** Most cards any window holds: the atlas's row count. */
function atlasRows(ranges: IndexRange[]): number {
  let most = 0;
  for (let r = 0; r < ranges.length; r++) {
    const [lo, hi] = signWindow(r, ranges.length);
    let count = 0;
    for (let i = lo; i <= hi; i++) count += ranges[i].count / 6;
    most = Math.max(most, count);
  }
  return Math.max(1, most);
}

function buildGeometry(signs: Sign[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  signs.forEach((s) => {
    const hw = (CARD_H * CARD_ASPECT) / 2;
    const hh = CARD_H / 2;
    const z = s.z + s.facing * STAND_OFF;
    // seen from its room the card's left edge is at -x (facing +z) or +x (facing -z)
    const xl = s.x - s.facing * hw;
    const xr = s.x + s.facing * hw;
    const base = pos.length / 3;
    pos.push(xl, s.y - hh, z, xr, s.y - hh, z, xr, s.y + hh, z, xl, s.y + hh, z);
    for (let k = 0; k < 4; k++) nor.push(0, 0, s.facing);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1); // set per atlas row as the card gets one
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const uvAttr = new THREE.Float32BufferAttribute(uv, 2);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("uv", uvAttr);
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function drawCard(ctx: CanvasRenderingContext2D, layout: GalleryLayout, s: Sign, y0: number): void {
  const { serif, sans } = fontFamilies();
  const ls = (px: string) => {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = px;
  };
  const k = TEX_W / 1024; // type sizes were set on a 1024 px card
  const bg = ctx.createLinearGradient(0, y0, 0, y0 + TEX_H);
  bg.addColorStop(0, "#f8f3e7");
  bg.addColorStop(1, "#efe8d6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, y0, TEX_W, TEX_H);
  ctx.strokeStyle = "rgba(110,92,58,0.32)";
  ctx.lineWidth = 3 * k;
  ctx.strokeRect(1.5 * k, y0 + 1.5 * k, TEX_W - 3 * k, TEX_H - 3 * k);

  const room = layout.rooms[s.room];
  const numeral = roomNumeral(s.room);
  // the room's phase of the artist's life, when the gallery follows them, before its years
  const years = room ? [room.title, roomYears(room)].filter(Boolean).join("  ·  ") : "";
  const mid = y0 + TEX_H / 2;
  ctx.textBaseline = "alphabetic";
  // numeral in serif capitals, the years in spaced sans, centred together
  const numFont = `600 ${Math.round(120 * k)}px ${serif}`;
  const yearFont = `500 ${Math.round(64 * k)}px ${sans}`;
  ctx.font = numFont;
  ls(`${6 * k}px`);
  const nW = ctx.measureText(numeral).width;
  ctx.font = yearFont;
  ls(`${5 * k}px`);
  const sep = "  ·  ";
  const tail = years ? sep + years : "";
  const tW = tail ? ctx.measureText(tail).width : 0;
  // Long catalogues have longer Roman numerals; fit the whole line on the card.
  const scale = Math.min(1, (TEX_W - 70 * k) / (nW + tW));
  ctx.save();
  ctx.translate(TEX_W / 2, mid);
  ctx.scale(scale, scale);
  let x = -(nW + tW) / 2;
  ctx.fillStyle = "#211d18";
  ctx.font = numFont;
  ls(`${6 * k}px`);
  ctx.fillText(numeral, x, 42 * k);
  x += nW;
  if (tail) {
    ctx.fillStyle = "#3a3226";
    ctx.font = yearFont;
    ls(`${5 * k}px`);
    ctx.fillText(tail, x, 40 * k);
  }
  ctx.restore();
  ls("0px");
  // a gold rule under the line, as on the wall labels
  const rule = ctx.createLinearGradient(TEX_W * 0.2, 0, TEX_W * 0.8, 0);
  rule.addColorStop(0, "rgba(168,133,60,0.05)");
  rule.addColorStop(0.5, "rgba(168,133,60,0.8)");
  rule.addColorStop(1, "rgba(168,133,60,0.05)");
  ctx.fillStyle = rule;
  ctx.fillRect(TEX_W * 0.2, y0 + TEX_H - 34 * k, TEX_W * 0.6, 3 * k);
}

/**
 * The cards' atlas: `rows` rows, each holding one card of the current
 * window. Cards entering the window take a free row (drawn there, their quad's
 * UVs pointed at it); cards leaving give theirs back.
 */
class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture | null = null;
  private ctx: CanvasRenderingContext2D;
  private rowOf: Int32Array;
  private free: number[];
  private drawn = false;

  constructor(
    private layout: GalleryLayout,
    private signs: Sign[],
    private geometry: THREE.BufferGeometry,
    private rows: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H * rows;
    this.ctx = this.canvas.getContext("2d")!;
    this.rowOf = new Int32Array(signs.length).fill(-1);
    this.free = Array.from({ length: rows }, (_, i) => rows - 1 - i);
  }

  /** Hold the cards of rooms lo..hi; returns whether any row changed. */
  show([lo, hi]: [number, number]): boolean {
    const uv = this.geometry.getAttribute("uv") as THREE.BufferAttribute;
    const fresh: number[] = [];
    this.signs.forEach((s, i) => {
      const want = s.in >= lo && s.in <= hi;
      if (!want && this.rowOf[i] >= 0) {
        this.free.push(this.rowOf[i]);
        this.rowOf[i] = -1;
      } else if (want && this.rowOf[i] < 0) fresh.push(i);
    });
    for (const i of fresh) {
      const row = this.free.pop();
      if (row === undefined) break; // (cannot happen: rows = the largest window)
      this.rowOf[i] = row;
      // canvas rows run top-down, texture v bottom-up
      const v0 = 1 - (row + 1) / this.rows;
      const v1 = 1 - row / this.rows;
      uv.setXY(4 * i, 0, v0);
      uv.setXY(4 * i + 1, 1, v0);
      uv.setXY(4 * i + 2, 1, v1);
      uv.setXY(4 * i + 3, 0, v1);
      if (this.drawn) drawCard(this.ctx, this.layout, this.signs[i], row * TEX_H);
    }
    if (!fresh.length) return false;
    uv.needsUpdate = true;
    if (this.texture) this.texture.needsUpdate = true;
    return true;
  }

  /** Fonts are in: draw every held card and make the texture. */
  draw(): THREE.CanvasTexture {
    this.drawn = true;
    this.signs.forEach((s, i) => {
      if (this.rowOf[i] >= 0) drawCard(this.ctx, this.layout, s, this.rowOf[i] * TEX_H);
    });
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture = tex;
    return tex;
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
  }
}

export function RoomSigns({ layout, runtime }: { layout: GalleryLayout; runtime: SuiteRuntime }) {
  const invalidate = useThree((s) => s.invalidate);
  const signs = useMemo(() => planSigns(layout), [layout]);
  const geometry = useMemo(() => (signs.length ? buildGeometry(signs) : null), [signs]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  // the wall labels' material (same program): ivory card, a little self-light
  // (a cross wall stands outside the spots' cones)
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: blankPlacardTexture(),
        roughness: 0.82,
        metalness: 0,
        emissive: new THREE.Color("#fff6e8"),
        emissiveIntensity: 0.16,
        emissiveMap: blankPlacardTexture(),
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // only the cards of the rooms around the visitor: drawn, and in the atlas
  useEffect(() => {
    if (!geometry) return;
    const rooms = layout.rooms.length;
    const ranges = signRanges(signs, rooms);
    const atlas = new SignAtlas(layout, signs, geometry, atlasRows(ranges));
    let alive = true;
    const apply = () => {
      const win = signWindow(runtime.currentRoom(), rooms);
      atlas.show(win);
      setRoomWindow(geometry, ranges, win);
      invalidate();
    };
    apply();
    const off = runtime.onWindowChange(apply);
    placardFontsReady().then(() => {
      if (!alive) return;
      const tex = atlas.draw();
      material.map = tex;
      material.emissiveMap = tex;
      invalidate();
    });
    return () => {
      alive = false;
      off();
      if (material.map === atlas.texture) material.map = blankPlacardTexture();
      if (material.emissiveMap === atlas.texture) material.emissiveMap = blankPlacardTexture();
      atlas.dispose();
    };
  }, [layout, signs, geometry, material, runtime, invalidate]);

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} matrixAutoUpdate={false} layers={PROP_LAYER} userData={FX_TARGET} />;
}
