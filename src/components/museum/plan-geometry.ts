// The architecture of one room of a real building's plan (plan-layout.ts): its four walls with their doors, its
// plinth, frieze and cornice, its ceiling (coves round a skylight, a round vault glazed along its crown, a painted
// vault with windows in it), its ornament (an attic of gilt panels, scrollwork or figures on the coves), its
// floor, its free-standing walls, the columns and arches across a gallery, its barriers and its seating. One
// merged geometry per material, in world space, as room-geometry.ts builds a suite's.
//
// A wall is built in its own frame (u along it, y up, out into the room) and a ceiling in the room's (x across,
// z along its long axis), then set where the plan has them.

import * as THREE from "three";
import {
  GeoBatch,
  GILT_BEAD,
  SKIRTING,
  VAULT_CORNICE,
  archSoffit,
  archSpandrel,
  buildBenchShadows,
  coveProfile,
  roomCeilingSpec,
  type CeilingSpec,
} from "./room-geometry";
import { TRACK_INSET, type GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import { buildFurnishing, furnitureOf } from "./furniture";
import { COLUMN } from "./plan-layout";
import { photoUV, type PhotoPatch, type PlanDoor, type PlanPhoto, type PlanShell, type Side } from "./plan-nav";

const UP = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const OPPOSITE: Record<Side, Side> = { n: "s", s: "n", w: "e", e: "w" };
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

export interface ShellGeometry {
  walls: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  gilt: THREE.BufferGeometry;
  /** Marble and stone, each part in its own colour (vertex colours): plinth, frieze, columns, an arch's piers. */
  marble: THREE.BufferGeometry;
  /** Painted and plain parts, each in its own colour: a gilt attic, a door of oak, a cove's panels, a rail. */
  paint: THREE.BufferGeometry;
  /** Ornament painted on the coves (UVs: one repeat of the scrollwork, textures.ts arabesqueTexture). */
  art: THREE.BufferGeometry;
  benchSeat: THREE.BufferGeometry;
  benchFrame: THREE.BufferGeometry;
  benchAccent: THREE.BufferGeometry;
  benchShadow: THREE.BufferGeometry;
  /** The floor: the room's, and its doors' thresholds. */
  floor: THREE.BufferGeometry;
  /** The ceiling's glass, one piece per bay (UVs 0..1 over each); a vault's windows. */
  glass: THREE.BufferGeometry;
  /** Photographs of the real ceiling, each laid on the surfaces it was taken of (UVs: where each point falls on
   *  the picture). */
  photos: { geometry: THREE.BufferGeometry; photo: PlanPhoto }[];
  /** The ceiling, in the room's own frame (x across, z along its long axis, about its centre). */
  spec: CeilingSpec;
  /** The room's frame: its centre, and its turn about y (0, or a quarter where its long axis runs along x). */
  cx: number;
  cz: number;
  turn: number;
  /** Half the room across, its height to the top of its ceiling, half its length (the room AO's box). */
  half: THREE.Vector3;
}

/** A wall's frame: its foot at one end, the direction along it, the way it faces, and the turn that sets a part
 *  modelled facing +z onto it. */
interface WallFrame {
  o: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  rotY: number;
  len: number;
  /** A place along the plan (x or z) as a distance along the wall. */
  u: (at: number) => number;
}

function wallFrame(sh: PlanShell, side: Side): WallFrame {
  switch (side) {
    case "n":
      return { o: V(sh.x0, 0, sh.z0), t: V(1, 0, 0), n: V(0, 0, 1), rotY: 0, len: sh.x1 - sh.x0, u: (at) => at - sh.x0 };
    case "s":
      return { o: V(sh.x1, 0, sh.z1), t: V(-1, 0, 0), n: V(0, 0, -1), rotY: Math.PI, len: sh.x1 - sh.x0, u: (at) => sh.x1 - at };
    case "w":
      return { o: V(sh.x0, 0, sh.z1), t: V(0, 0, -1), n: V(1, 0, 0), rotY: Math.PI / 2, len: sh.z1 - sh.z0, u: (at) => sh.z1 - at };
    default:
      return { o: V(sh.x1, 0, sh.z0), t: V(0, 0, 1), n: V(-1, 0, 0), rotY: -Math.PI / 2, len: sh.z1 - sh.z0, u: (at) => at - sh.z0 };
  }
}

/** A point of a wall: u along it, y up, d out from its face (negative: into the wall). */
const at = (f: WallFrame, u: number, y: number, d = 0) => f.o.clone().addScaledVector(f.t, u).addScaledVector(UP, y).addScaledVector(f.n, d);
/** The matrix that sets a part modelled about x = 0 on the plane z = 0 (facing +z) at u along a wall. */
const onWall = (f: WallFrame, u: number, d = 0) => new THREE.Matrix4().makeBasis(f.t, UP, f.n).setPosition(at(f, u, 0, d));

interface Opening {
  door: PlanDoor;
  u: number;
  /** This room builds the reveal through the wall (the door is named in it), and how deep the wall is. */
  owner: boolean;
  depth: number;
}

/** A stretch [lo, hi] less some holes. */
function cut(lo: number, hi: number, holes: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let p = lo;
  for (const [a, b] of [...holes].sort((x, y) => x[0] - y[0])) {
    if (b <= p) continue;
    if (a >= hi) break;
    if (a > p) out.push([p, Math.min(a, hi)]);
    p = Math.max(p, b);
  }
  if (p < hi) out.push([p, hi]);
  return out;
}

export function buildShell(layout: GalleryLayout, index: number, theme: GalleryTheme, opts: { relief?: boolean } = {}): ShellGeometry {
  const plan = layout.plan!;
  const sh = plan.shells[index];
  const H = sh.height;
  const room = theme.room;
  const classical = room.classical;
  const rounded = new Map<string, THREE.BufferGeometry>();
  const walls = new GeoBatch(rounded);
  const ceiling = new GeoBatch(rounded);
  const trim = new GeoBatch(rounded);
  const gilt = new GeoBatch(rounded);
  const marble = new GeoBatch(rounded, true);
  const paint = new GeoBatch(rounded, true);
  const art = new GeoBatch();
  const seat = new GeoBatch(rounded, true);
  const frame = new GeoBatch(rounded, true);
  const accent = new GeoBatch(rounded, true);
  const floor = new GeoBatch();
  const glass = new GeoBatch();

  const cx = (sh.x0 + sh.x1) / 2;
  const cz = (sh.z0 + sh.z1) / 2;
  const turn = sh.alongX ? Math.PI / 2 : 0;
  const W = sh.alongX ? sh.z1 - sh.z0 : sh.x1 - sh.x0;
  const L = sh.alongX ? sh.x1 - sh.x0 : sh.z1 - sh.z0;
  const toWorld = new THREE.Matrix4().makeRotationY(turn).setPosition(cx, 0, cz);
  // (above its cornice a room may be wider than between its walls: an attic set back behind a gallery; the
  // ceiling is then built over that wider box)
  const back = room.attic?.setback ?? 0;
  const spec = roomCeilingSpec(W + 2 * back, H, -L / 2 - back, L / 2 + back, theme, TRACK_INSET);
  const skins = plan.photos.filter((p) => p.shell === index);
  const skinned = (part: PhotoPatch["part"]) => skins.some((p) => p.on.some((o) => o.part === part));
  const barrel = room.ceiling === "vault" && room.vault === "barrel";
  const cloister = room.ceiling === "vault" && room.vault === "cloister";
  const top = spec.kind === "vault" ? spec.yCeil : H;
  const hw = W / 2 + back;

  const col = (c: string) => new THREE.Color(c);
  const dado = room.dado;
  const frieze = room.frieze;
  const dadoColor = dado ? col(dado.color) : null;
  const friezeColor = frieze ? col(frieze.color) : null;
  const pedestal = room.pedestal;
  const pedColor = col(pedestal?.color ?? dado?.color ?? "#8a8279");
  const caseColor = room.doorCase ? col(room.doorCase) : null;
  const leafColor = room.doorLeaf ? col(room.doorLeaf) : null;
  const steel = col("#9c9d9b");
  const stucco = col("#e9e5dc");
  const cbox = (b: GeoBatch, w: number, h: number, d: number, p: THREE.Vector3, rotY: number, color?: THREE.Color) =>
    b.add(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().makeRotationY(rotY).setPosition(p), color);
  /** A box in the room's own frame (w across, d along). */
  const lbox = (b: GeoBatch, w: number, h: number, d: number, x: number, y: number, z: number, color?: THREE.Color) =>
    b.add(new THREE.BoxGeometry(w, h, d), toWorld.clone().multiply(T(x, y, z)), color);
  /** A geometry modelled in the room's own frame. */
  const local = (b: GeoBatch, g: THREE.BufferGeometry, m?: THREE.Matrix4, color?: THREE.Color) =>
    b.add(g, m ? toWorld.clone().multiply(m) : toWorld.clone(), color);
  const floorQuad = (x0: number, x1: number, z0: number, z1: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([x0, z0, x1, z0, x1, z1, x0, z1], 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    floor.add(g);
  };
  floorQuad(sh.x0, sh.x1, sh.z0, sh.z1);

  // ---- the four walls
  const guard = room.guard;
  for (const side of ["n", "e", "s", "w"] as Side[]) {
    const f = wallFrame(sh, side);
    const openings: Opening[] = [];
    for (const d of plan.doors) {
      if (d.bay) continue;
      const mine = plan.zones[d.a].shell === index && d.side === side;
      const theirs = d.b >= 0 && plan.zones[d.b].shell === index && OPPOSITE[d.side] === side;
      if (!mine && !theirs) continue;
      const depth = side === "n" || side === "s" ? d.box.z1 - d.box.z0 : d.box.x1 - d.box.x0;
      openings.push({ door: d, u: f.u(d.at), owner: mine, depth });
    }
    openings.sort((p, q) => p.u - q.u);

    // the wall between its doors, and above each
    let cursor = 0;
    const solid: [number, number][] = [];
    for (const op of openings) {
      const { door: d, u } = op;
      const dw = d.half;
      if (u - dw > cursor) solid.push([cursor, u - dw]);
      const js = d.height - d.arch;
      if (d.arch > 0) walls.add(archSpandrel(dw, js, d.arch, H), onWall(f, u));
      else walls.quad(at(f, u - dw, d.height), f.t.clone().multiplyScalar(2 * dw), V(0, H - d.height, 0), [u - dw, d.height]);
      cursor = u + dw;
      if (op.owner) doorReveal(f, op, js);
      doorCase(f, op, js);
    }
    if (cursor < f.len) solid.push([cursor, f.len]);
    for (const [a, b] of solid) walls.quad(at(f, a, 0), f.t.clone().multiplyScalar(b - a), V(0, H, 0), [a, 0]);

    // what stands against this wall: a bay of marble with its niche, the block an arch's columns stand on, a
    // free-standing wall that meets it (the plinth and the barrier stop at each)
    const against: [number, number][] = [];
    for (const n of plan.niches) {
      if (n.shell !== index || n.side !== side) continue;
      nicheBay(f, f.u(n.at), n.half, n.height);
      against.push([f.u(n.at) - n.half - 0.12, f.u(n.at) + n.half + 0.12]);
    }
    const blocks: [number, number][] = [];
    for (const p of plan.partitions) {
      if (p.shell !== index) continue;
      const gap = side === "n" ? p.z0 - sh.z0 : side === "s" ? sh.z1 - p.z1 : side === "w" ? p.x0 - sh.x0 : sh.x1 - p.x1;
      if (gap > (guard?.out ?? 0) + 0.25) continue;
      const [a, b] = side === "n" || side === "s" ? [f.u(p.x0), f.u(p.x1)] : [f.u(p.z0), f.u(p.z1)];
      blocks.push([Math.min(a, b), Math.max(a, b)]);
    }

    // the foot of the wall: a plinth of marble, or a skirting; a frieze under the cornice
    for (const [a, b] of solid) {
      for (const [p, q] of cut(a, b, [...against, ...blocks.filter(([x, y]) => y - x > 1.2)])) {
        const u0 = p + (p === a && a > 0 ? 0.24 : 0);
        const u1 = q - (q === b && b < f.len ? 0.24 : 0);
        if (u1 - u0 < 0.05) continue;
        if (dado && dadoColor) {
          cbox(marble, u1 - u0, dado.height, 0.035, at(f, (u0 + u1) / 2, dado.height / 2, 0.0175), f.rotY, dadoColor);
          cbox(marble, u1 - u0, 0.05, 0.055, at(f, (u0 + u1) / 2, dado.height + 0.025, 0.0275), f.rotY, dadoColor);
        } else if (classical) trim.sweep(SKIRTING, at(f, u0, 0), at(f, u1, 0), f.n);
      }
      // a cord on slim posts, or a steel rail, before the wall
      if (guard) {
        const lo = a === 0 ? guard.out : a + 0.3;
        const hi = b === f.len ? f.len - guard.out : b - 0.3;
        for (const [p, q] of cut(lo, hi, blocks.map(([x, y]): [number, number] => [x - 0.35, y + 0.35]))) guardRun(f, p, q);
      }
    }
    // a lighting beam round the room, held out from the wall on slim arms
    if (room.lightBeam) {
      const lb = room.lightBeam;
      const c = col(lb.color);
      cbox(paint, f.len - 2 * lb.out + 0.34, 0.26, 0.34, at(f, f.len / 2, lb.height, lb.out), f.rotY, c);
      const n = Math.max(2, Math.round(f.len / 3.2));
      for (let i = 0; i <= n; i++) {
        const u = lb.out + ((f.len - 2 * lb.out) * i) / n;
        cbox(paint, 0.05, 0.05, lb.out, at(f, u, lb.height + 0.06, lb.out / 2), f.rotY, c);
        // a pair of small lamps under it, turned to the wall
        if (i < n) cbox(paint, 0.3, 0.16, 0.12, at(f, u + (f.len - 2 * lb.out) / n / 2, lb.height - 0.2, lb.out - 0.08), f.rotY, col("#e9e9e6"));
      }
    }
    if (frieze && friezeColor) {
      const y1 = H - 0.4;
      const y0 = y1 - frieze.height;
      cbox(marble, f.len, frieze.height, 0.03, at(f, f.len / 2, (y0 + y1) / 2, 0.015), f.rotY, friezeColor);
      for (const y of [y0, y1]) cbox(trim, f.len, 0.1, 0.07, at(f, f.len / 2, y, 0.035), f.rotY);
      if (room.gilt) {
        cbox(gilt, f.len, 0.024, 0.08, at(f, f.len / 2, y0 - 0.065, 0.04), f.rotY);
        cbox(gilt, f.len, 0.03, 0.09, at(f, f.len / 2, y1 + 0.075, 0.045), f.rotY);
      }
    }
  }

  /** A cord on slim posts (or a flat steel rail on flat posts) along a wall, out from it. */
  function guardRun(f: WallFrame, u0: number, u1: number) {
    if (!guard || u1 - u0 < 0.9) return;
    const n = Math.max(1, Math.round((u1 - u0) / (guard.kind === "cord" ? 2.7 : 1.9)));
    const h = guard.height;
    for (let i = 0; i <= n; i++) {
      const p = at(f, u0 + ((u1 - u0) * i) / n, 0, guard.out);
      if (guard.kind === "cord") {
        paint.add(new THREE.CylinderGeometry(0.105, 0.115, 0.016, 14), T(p.x, 0.008, p.z), steel);
        paint.add(new THREE.CylinderGeometry(0.011, 0.011, h, 6), T(p.x, h / 2, p.z), steel);
      } else cbox(paint, 0.045, h, 0.012, p.clone().setY(h / 2), f.rotY, steel);
    }
    const mid = at(f, (u0 + u1) / 2, guard.kind === "cord" ? h - 0.04 : h, guard.out);
    if (guard.kind === "cord") cbox(paint, u1 - u0, 0.012, 0.012, mid, f.rotY, col("#3b3936"));
    else cbox(paint, u1 - u0 + 0.045, 0.012, 0.05, mid, f.rotY, steel);
  }

  /** A bay of pale marble against a long wall: a base, two pilasters with gilt capitals, a round-headed niche. */
  function nicheBay(f: WallFrame, u: number, half: number, topY: number) {
    const pale = col(room.nicheBays ?? "#d9d5cc");
    const ph = pedestal?.height ?? dado?.height ?? 0.8;
    const y1 = frieze ? H - 0.4 - frieze.height - 0.05 : topY;
    cbox(marble, 2 * half + 0.24, ph - 0.1, 0.32, at(f, u, (ph - 0.1) / 2, 0.16), f.rotY, pedColor);
    cbox(trim, 2 * half + 0.34, 0.1, 0.38, at(f, u, ph - 0.05, 0.19), f.rotY);
    cbox(marble, 2 * half, y1 - ph, 0.07, at(f, u, (y1 + ph) / 2, 0.035), f.rotY, pale);
    for (const s of [-1, 1]) {
      const pu = u + s * (half - 0.24);
      cbox(marble, 0.4, y1 - ph - 0.55, 0.13, at(f, pu, ph + (y1 - ph - 0.55) / 2, 0.135), f.rotY, pale);
      cbox(gilt, 0.46, 0.09, 0.19, at(f, pu, ph + 0.045, 0.14), f.rotY);
      cbox(gilt, 0.44, 0.42, 0.17, at(f, pu, y1 - 0.26, 0.14), f.rotY);
      cbox(trim, 0.52, 0.07, 0.22, at(f, pu, y1 - 0.035, 0.16), f.rotY);
    }
    // the niche: a shadowed recess with a round head, a band round it
    const nw = 2 * half - 1.5;
    const ny = ph + 0.55;
    const nh = Math.min(2.5, y1 - ny - 1.4);
    const dark = pale.clone().multiplyScalar(0.5);
    cbox(paint, nw, nh, 0.012, at(f, u, ny + nh / 2, 0.076), f.rotY, dark);
    const head = new THREE.Shape();
    head.absarc(0, 0, nw / 2, 0, Math.PI, false);
    paint.add(new THREE.ShapeGeometry(head, 16), onWall(f, u, 0.082).multiply(T(0, ny + nh, 0)), dark);
    for (const s of [-1, 1]) cbox(trim, 0.07, nh, 0.03, at(f, u + s * (nw / 2 + 0.035), ny + nh / 2, 0.085), f.rotY);
    trim.add(new THREE.TorusGeometry(nw / 2 + 0.035, 0.035, 5, 20, Math.PI), onWall(f, u, 0.085).multiply(T(0, ny + nh, 0)));
    cbox(trim, nw + 0.3, 0.08, 0.16, at(f, u, ny - 0.04, 0.11), f.rotY);
  }

  /** The jambs and head of an opening through the wall, and what stands in a door that stays shut. */
  function doorReveal(f: WallFrame, op: Opening, js: number) {
    const { door: d, u, depth: D } = op;
    const dw = d.half;
    const lining = caseColor ? paint.setColor(caseColor) : classical ? trim : walls;
    const out = f.n.clone().multiplyScalar(-D);
    lining.quad(at(f, u - dw, 0), out, V(0, js, 0)); // faces along the wall, toward the opening
    lining.quad(at(f, u + dw, 0, -D), f.n.clone().multiplyScalar(D), V(0, js, 0));
    if (d.arch > 0) lining.add(archSoffit(dw, js, d.arch, -D, 0), onWall(f, u));
    else lining.quad(at(f, u - dw, d.height, -D), f.t.clone().multiplyScalar(2 * dw), f.n.clone().multiplyScalar(D));
    // the threshold
    const p0 = at(f, u - dw, 0, -D);
    const p1 = at(f, u + dw, 0, 0);
    floorQuad(Math.min(p0.x, p1.x), Math.max(p0.x, p1.x), Math.min(p0.z, p1.z), Math.max(p0.z, p1.z));
    if (d.b >= 0) return;
    if (d.window) {
      // a window: daylight behind small panes (the room's glass), a dark frame, a low panel at its foot
      const zw = -Math.min(D * 0.5, D - 0.1);
      const sill = 0.5;
      const dark = col("#1f1d1c");
      const g = new THREE.PlaneGeometry(2 * dw, d.height - sill);
      glass.add(g, onWall(f, u, zw).multiply(T(0, sill + (d.height - sill) / 2, 0)));
      paint.add(new THREE.BoxGeometry(2 * dw, sill, 0.08), onWall(f, u, zw + 0.02).multiply(T(0, sill / 2, 0)), dark);
      for (const s of [-1, 0, 1]) paint.add(new THREE.BoxGeometry(s === 0 ? 0.09 : 0.07, d.height - sill, 0.06), onWall(f, u + s * (dw - 0.035), zw + 0.03).multiply(T(0, sill + (d.height - sill) / 2, 0)), dark);
      for (const y of [sill, sill + (d.height - sill) * 0.72, d.height - 0.035]) paint.add(new THREE.BoxGeometry(2 * dw, 0.07, 0.06), onWall(f, u, zw + 0.03).multiply(T(0, y, 0)), dark);
      return;
    }
    // shut: a pair of panelled leaves set back in the reveal, the wall behind them
    const leaf = leafColor ? paint.setColor(leafColor) : trim;
    const zLeaf = -Math.min(D * 0.55, D - 0.08);
    const leafW = dw - 0.004;
    const leafH = js - 0.01;
    walls.quad(at(f, u - dw, 0, -D + 0.01), f.t.clone().multiplyScalar(2 * dw), V(0, d.height, 0));
    for (const s of [-1, 1]) {
      const c = u + s * (leafW / 2 + 0.002);
      leaf.roundedBox(leafW, leafH, 0.06, ...xyz(at(f, c, leafH / 2, zLeaf)), 0.004, 1, f.rotY);
      const pw = leafW - 0.22;
      // three panels a leaf where it is tall, two otherwise
      const rows = leafH > 4.4 ? [0.3, 0.42, 0.28] : [0.6, 0.4];
      let y = leafH - 0.14;
      for (const share of rows) {
        const ph = (leafH - 0.28 - 0.1 * (rows.length - 1)) * share;
        leaf.roundedBox(pw, ph, 0.024, ...xyz(at(f, c, y - ph / 2, zLeaf + 0.036)), 0.006, 1, f.rotY);
        y -= ph + 0.1;
      }
      gilt.roundedBox(0.03, 0.3, 0.035, ...xyz(at(f, u + s * 0.07, 1.12, zLeaf + 0.05)), 0.01, 1, f.rotY);
    }
    // an arched head: a fixed panel over the leaves
    if (d.arch > 0) {
      const head = new THREE.Shape();
      head.moveTo(-dw, js);
      for (let i = 1; i <= 24; i++) {
        const a = Math.PI - (Math.PI * i) / 24;
        head.lineTo(dw * Math.cos(a), js + d.arch * Math.sin(a));
      }
      head.closePath();
      leaf.add(new THREE.ShapeGeometry(head, 1), onWall(f, u, zLeaf), leafColor ?? undefined);
    }
    paint.setColor(null);
  }

  /** The surround on the room's face of an opening: jambs, a head and a cornice (an arch: a band round its head). */
  function doorCase(f: WallFrame, op: Opening, js: number) {
    const { door: d, u } = op;
    const dw = d.half;
    const jw = classical || caseColor ? Math.min(0.34, 0.2 + d.height * 0.02) : 0.06;
    const proud = classical || caseColor ? 0.06 : 0.014;
    const part = caseColor ? paint.setColor(caseColor) : trim;
    for (const s of [-1, 1]) {
      part.roundedBox(jw, js + (d.arch > 0 ? 0 : jw), proud, ...xyz(at(f, u + s * (dw + jw / 2), (js + (d.arch > 0 ? 0 : jw)) / 2, proud / 2)), 0.008, 1, f.rotY);
      if (classical) part.roundedBox(jw + 0.05, 0.3, proud + 0.02, ...xyz(at(f, u + s * (dw + jw / 2), 0.15, (proud + 0.02) / 2)), 0.006, 1, f.rotY);
    }
    if (d.arch > 0) {
      const ring = (grow: number, out: number) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = Math.PI - (Math.PI * i) / 32;
          pts.push(V((dw + grow) * Math.cos(a), js + (d.arch + grow) * Math.sin(a), out));
        }
        return new THREE.CatmullRomCurve3(pts);
      };
      part.add(new THREE.TubeGeometry(ring(jw / 2, 0.01), 48, jw / 2, 8, false), onWall(f, u), caseColor ?? undefined);
      if (room.gilt) gilt.add(new THREE.TubeGeometry(ring(0.03, 0.045), 48, 0.022, 6, false), onWall(f, u));
      for (const s of [-1, 1]) part.roundedBox(jw + 0.1, 0.16, proud + 0.04, ...xyz(at(f, u + s * (dw + jw / 2), js - 0.06, (proud + 0.04) / 2)), 0.02, 2, f.rotY);
      paint.setColor(null);
      return;
    }
    part.roundedBox(2 * dw, jw, proud, ...xyz(at(f, u, d.height + jw / 2, proud / 2)), 0.008, 1, f.rotY);
    if (classical) {
      part.roundedBox(2 * dw + 2 * jw + 0.2, 0.08, proud + 0.07, ...xyz(at(f, u, d.height + jw + 0.1, (proud + 0.07) / 2)), 0.012, 2, f.rotY);
      part.roundedBox(2 * dw + 2 * jw + 0.08, 0.05, proud + 0.03, ...xyz(at(f, u, d.height + jw + 0.03, (proud + 0.03) / 2)), 0.008, 1, f.rotY);
    }
    paint.setColor(null);
  }

  // ---- free-standing walls: four faces and a top; in a surround of stone (two posts and a lintel, a little
  // proud of both faces), or a plain panel
  for (const w of plan.partitions) {
    if (w.shell !== index || w.plinth) continue;
    const h = w.height;
    walls.quad(V(w.x0, 0, w.z1), V(w.x1 - w.x0, 0, 0), V(0, h, 0)); // faces +z
    walls.quad(V(w.x1, 0, w.z0), V(-(w.x1 - w.x0), 0, 0), V(0, h, 0)); // faces -z
    walls.quad(V(w.x1, 0, w.z1), V(0, 0, -(w.z1 - w.z0)), V(0, h, 0)); // faces +x
    walls.quad(V(w.x0, 0, w.z0), V(0, 0, w.z1 - w.z0), V(0, h, 0)); // faces -x
    walls.quad(V(w.x0, h, w.z0), V(0, 0, w.z1 - w.z0), V(w.x1 - w.x0, 0, 0)); // top
    const alongX = w.x1 - w.x0 >= w.z1 - w.z0;
    const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
    const thick = alongX ? w.z1 - w.z0 : w.x1 - w.x0;
    const mx = (w.x0 + w.x1) / 2;
    const mz = (w.z0 + w.z1) / 2;
    const rot = alongX ? 0 : Math.PI / 2;
    if (!w.portal) {
      // a slim shadow line at the foot
      paint.setColor(col("#6f6a62")).box(len, 0.06, thick + 0.012, mx, 0.03, mz, rot);
      paint.setColor(null);
      continue;
    }
    const post = 0.34;
    for (const s of [-1, 1]) {
      const off = s * (len / 2 - post / 2 + 0.02);
      trim.box(post, h + 0.04, thick + 0.1, alongX ? mx + off : mx, (h + 0.04) / 2, alongX ? mz : mz + off, rot);
    }
    trim.box(len + 0.04, post, thick + 0.1, mx, h - post / 2 + 0.04, mz, rot);
    trim.box(len - 2 * post, 0.12, thick + 0.06, mx, 0.06, mz, rot);
  }

  // ---- a work behind glass: a frame set in its wall, a shelf of oak below it
  for (const s of plan.shrines) {
    if (s.shell !== index) continue;
    const m = new THREE.Matrix4().makeRotationY(s.rotationY).setPosition(s.x, 0, s.z);
    const gw = Math.max(2.2, s.w + 1.5);
    const y0 = Math.max(0.9, s.y - 0.9 - s.h / 2);
    const y1 = s.y + s.h / 2 + 1.9;
    const pale = col("#d9d7d0");
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color) =>
      paint.add(new THREE.BoxGeometry(w, h, d), m.clone().multiply(T(x, y, z)), c);
    for (const sx of [-1, 1]) part(0.05, y1 - y0, 0.09, sx * (gw / 2), (y0 + y1) / 2, 0.02, pale);
    for (const y of [y0, y1]) part(gw + 0.05, 0.05, 0.09, 0, y, 0.02, pale);
    // the shelf, and the wall dark behind the glass
    part(gw + 1.1, 0.13, 0.78, 0, y0 - 0.13, 0.39, col("#b78a52"));
    part(gw + 1.1, 0.5, 0.06, 0, y0 - 0.44, 0.03, col("#a87c48"));
  }

  // ---- the ceiling's section across the room: its height at x (an arch's faces fill what is above it)
  const r = spec.coveR;
  const b = spec.coveBase;
  const rise = spec.yCeil - b;
  const section = (x: number): number => {
    const d = hw - Math.abs(x);
    if (r <= 0 || d >= r) return spec.yCeil;
    return b + rise * Math.sqrt(Math.max(0, 1 - ((r - d) / r) ** 2));
  };
  /** The cove's profile from the wall: [how far in, how high], from t0 to t1 of its quarter turn, moved `off`
   *  out from its surface into the room. */
  const coveArc = (t0: number, t1: number, off = 0, steps = 24): [number, number][] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const th = (t0 + ((t1 - t0) * i) / steps) * (Math.PI / 2);
      const nd = rise * Math.cos(th);
      const ny = -r * Math.sin(th);
      const nl = Math.hypot(nd, ny) || 1;
      return [r - r * Math.cos(th) + (off * nd) / nl, b + rise * Math.sin(th) + (off * ny) / nl] as [number, number];
    });
  const arcLength = (pts: [number, number][]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  // the four walls' runs in the room's own frame: from a to b along the foot of the wall, n into the room
  const runs = [
    { a: V(-hw, 0, spec.z0), b: V(-hw, 0, spec.z1), n: V(1, 0, 0), long: true },
    { a: V(hw, 0, spec.z0), b: V(hw, 0, spec.z1), n: V(-1, 0, 0), long: true },
    { a: V(-hw, 0, spec.z0), b: V(hw, 0, spec.z0), n: V(0, 0, 1), long: false },
    { a: V(-hw, 0, spec.z1), b: V(hw, 0, spec.z1), n: V(0, 0, -1), long: false },
  ];
  type CoveRun = (typeof runs)[number];
  // the same at the walls' own faces (where an attic is set back, the cornice and its gallery stay on the walls)
  const wallRuns: CoveRun[] = back
    ? [
        { a: V(-hw + back, 0, spec.z0 + back), b: V(-hw + back, 0, spec.z1 - back), n: V(1, 0, 0), long: true },
        { a: V(hw - back, 0, spec.z0 + back), b: V(hw - back, 0, spec.z1 - back), n: V(-1, 0, 0), long: true },
        { a: V(-hw + back, 0, spec.z0 + back), b: V(hw - back, 0, spec.z0 + back), n: V(0, 0, 1), long: false },
        { a: V(-hw + back, 0, spec.z1 - back), b: V(hw - back, 0, spec.z1 - back), n: V(0, 0, -1), long: false },
      ]
    : runs;
  /** A place on a cove: s metres along its run, t (0..1) up its quarter turn: the point, the way the surface
   *  faces, and the matrix that sets a part modelled facing +z (x along the run, y up the cove) there, `off`
   *  out from the surface. */
  const coveAt = (q: CoveRun, s: number, t: number, off = 0) => {
    const th = t * (Math.PI / 2);
    const dir = q.b.clone().sub(q.a).normalize();
    const nrm = q.n.clone().multiplyScalar(rise * Math.cos(th)).add(V(0, -r * Math.sin(th), 0)).normalize();
    const p = q.a.clone().addScaledVector(dir, s).addScaledVector(q.n, r - r * Math.cos(th));
    p.y = b + rise * Math.sin(th);
    p.addScaledVector(nrm, off);
    // x along the run so that it reads left to right from inside the room
    const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
    const y = new THREE.Vector3().crossVectors(nrm, x).normalize();
    return { p, nrm, m: new THREE.Matrix4().makeBasis(x, y, nrm).setPosition(p) };
  };
  const runLength = (q: CoveRun) => q.a.distanceTo(q.b);
  /** A strip of a cove, from s0 to s1 along its run and t0 to t1 up it, `off` out from its surface. */
  const coveStrip = (batch: GeoBatch, q: CoveRun, s0: number, s1: number, t0: number, t1: number, off: number, color?: THREE.Color) => {
    const dir = q.b.clone().sub(q.a).normalize();
    const tmp = new GeoBatch();
    tmp.sweep(coveArc(t0, t1, off, Math.max(4, Math.round((t1 - t0) * 20))), q.a.clone().addScaledVector(dir, s0), q.a.clone().addScaledVector(dir, s1), q.n, 60);
    local(batch, tmp.build(false), undefined, color);
  };

  if (barrel) barrelVault();
  else coveCeiling();

  /** One round vault from wall to wall, glazed along its crown between ribs; a cornice at its springing. */
  function barrelVault() {
    const gx = spec.wellX;
    const tg = Math.acos(gx / hw) / (Math.PI / 2); // the glass's edge, as a share of the quarter turn
    const cut0: [number, number][] = plan.arches
      .filter((a) => a.shell === index)
      .map((a): [number, number] => {
        const lz = a.at - (sh.alongX ? cx : cz);
        return [lz - a.depth, lz + a.depth];
      });
    for (const q of runs.filter((x) => x.long)) {
      const tmp = new GeoBatch();
      tmp.sweep(coveArc(0, tg, 0, 14), q.a, q.b, q.n, 60);
      local(ceiling, tmp.build(false));
      const cor = new GeoBatch();
      cor.sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, b + hh + 0.02] as [number, number]), q.a, q.b, q.n);
      local(trim, cor.build(false));
      if (room.gilt) {
        const bead = new GeoBatch();
        bead.sweep(GILT_BEAD.map(([dd, hh]) => [dd + 0.1, b - 0.1 + hh] as [number, number]), q.a, q.b, q.n);
        local(gilt, bead.build(false));
      }
    }
    // the curb the glass sits on, either side: a moulding, a gilt line under it
    const edge = coveArc(tg, tg, 0, 1)[0];
    for (const s of [-1, 1]) {
      const x = s * (hw - edge[0]);
      lbox(trim, 0.26, 0.2, L, x + s * 0.06, edge[1] - 0.04, 0);
      if (room.gilt) lbox(gilt, 0.05, 0.05, L, x + s * 0.2, edge[1] - 0.16, 0);
    }
    // the glass, bay by bay between the arches, a rib across it at each bay line; over an arch the vault is
    // plaster from side to side
    const strip = (batch: GeoBatch, za: number, zb: number) => {
      const steps = 10;
      const a0 = Math.acos(gx / hw);
      const pos: number[] = [];
      const nor: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((Math.PI - 2 * a0) * k) / steps;
        for (const [z, vv] of [[za, 0], [zb, 1]] as const) {
          pos.push(-hw * Math.cos(a), b + rise * Math.sin(a), z);
          nor.push(Math.cos(a), -Math.sin(a), 0);
          uv.push(k / steps, vv);
        }
        if (k > 0) {
          const o = (k - 1) * 2;
          idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      local(batch, g);
    };
    for (const [z0, z1] of cut0) strip(ceiling, Math.max(-L / 2, z0), Math.min(L / 2, z1));
    for (const [z0, z1] of cut(-L / 2, L / 2, cut0)) {
      const n = Math.max(1, Math.round((z1 - z0) / 3.3));
      for (let i = 0; i < n; i++) {
        const za = z0 + ((z1 - z0) * i) / n;
        strip(glass, za, z0 + ((z1 - z0) * (i + 1)) / n);
        if (i > 0) rib(za, 0.07);
      }
      rib(z0 + 0.06, 0.1);
      rib(z1 - 0.06, 0.1);
    }
    function rib(z: number, rad: number) {
      const pts: THREE.Vector3[] = [];
      const a0 = Math.acos(gx / hw);
      for (let k = 0; k <= 12; k++) {
        const a = a0 + ((Math.PI - 2 * a0) * k) / 12;
        pts.push(V(-hw * Math.cos(a), b + rise * Math.sin(a) - rad * 0.4, z));
      }
      local(trim, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, rad, 5, false));
    }
    // the end walls above the cornice: a round-headed field
    for (const [z, flip] of [[-L / 2, false], [L / 2, true]] as const) {
      const lun = new THREE.Shape();
      lun.moveTo(-hw, b);
      for (let k = 1; k <= 32; k++) {
        const a = Math.PI - (Math.PI * k) / 32;
        lun.lineTo(hw * Math.cos(a), b + rise * Math.sin(a));
      }
      lun.closePath();
      local(ceiling, new THREE.ShapeGeometry(lun, 1), flip ? new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, z) : T(0, 0, z));
      const cor = new GeoBatch();
      cor.sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, b + hh + 0.02] as [number, number]), V(-hw, 0, z), V(hw, 0, z), V(0, 0, flip ? -1 : 1));
      local(trim, cor.build(false));
    }
  }

  /** Coves on all four sides round a flat skylight (or, a cloister vault, round a painted panel): an attic under
   *  them where the room has one, a cornice at their springing, the well and its frame, the beams. */
  function coveCeiling() {
    const yC = spec.yCeil;
    const lc = { ceiling: new GeoBatch(rounded), trim: new GeoBatch(rounded), gilt: new GeoBatch(rounded) };
    // an attic between the walls' cornice and the coves: panels of gilt between small pilasters, a tablet in each
    const attic = room.attic;
    if (attic) {
      const gold = col(attic.color);
      const tablet = col("#3c4a45");
      for (const q of runs) {
        const len = runLength(q);
        const dir = q.b.clone().sub(q.a).normalize();
        const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
        const place = (s: number, y: number, off: number) => new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(q.a.clone().addScaledVector(dir, s).addScaledVector(q.n, off).setY(y));
        local(paint, new THREE.BoxGeometry(len, attic.height, 0.04), place(len / 2, H + attic.height / 2, 0.02), gold);
        // (the real attic, photographed, lies over this)
        if (skinned("attic")) continue;
        const n = Math.max(2, Math.round((len - 2.4) / (attic.panel ?? 2)));
        const w = (len - 2.4) / n;
        for (let i = 0; i <= n; i++) {
          const s = 1.2 + w * i;
          local(paint, new THREE.BoxGeometry(0.22, attic.height - 0.5, 0.07), place(s, H + attic.height / 2 + 0.03, 0.055), stucco);
          if (i === n) break;
          // the middle panel: an oval cartouche; the others a tablet hung from a knot
          if (i === Math.floor(n / 2) && n % 2 === 1) {
            local(gilt, new THREE.TorusGeometry(0.52, 0.07, 6, 24), place(s + w / 2, H + attic.height / 2 + 0.03, 0.08).scale(V(0.72, 1, 1)));
            local(paint, new THREE.CylinderGeometry(0.5, 0.5, 0.03, 24), place(s + w / 2, H + attic.height / 2 + 0.03, 0.07).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).scale(V(0.72, 1, 1)), stucco);
            continue;
          }
          local(gilt, new THREE.BoxGeometry(Math.min(1.25, w - 0.5) + 0.1, 0.42, 0.03), place(s + w / 2, H + attic.height * 0.46, 0.055));
          local(paint, new THREE.BoxGeometry(Math.min(1.25, w - 0.5), 0.32, 0.03), place(s + w / 2, H + attic.height * 0.46, 0.065), tablet);
          local(gilt, new THREE.SphereGeometry(0.06, 8, 6), place(s + w / 2, H + attic.height * 0.46 + 0.5, 0.07));
        }
        // a great oval at each end of the run, by the corner
        for (const s of [0.62, len - 0.62]) {
          local(gilt, new THREE.TorusGeometry(0.6, 0.08, 6, 24), place(s, H + attic.height / 2, 0.09).scale(V(0.7, 1, 1)));
          local(paint, new THREE.CylinderGeometry(0.58, 0.58, 0.03, 24), place(s, H + attic.height / 2, 0.08).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).scale(V(0.7, 1, 1)), col("#b9a79a"));
        }
        // the walls' own cornice under it
        if (!back) lc.gilt.sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, H + hh] as [number, number]), q.a, q.b, q.n);
      }
      if (back) {
        // the gallery on the cornice: its floor from the walls back to the attic, a rail of slim bars at its edge
        const dark = col("#1c1a19");
        for (const q of wallRuns) {
          const len = runLength(q);
          const dir = q.b.clone().sub(q.a).normalize();
          const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
          const place = (s: number, y: number, off: number) => new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(q.a.clone().addScaledVector(dir, s).addScaledVector(q.n, off).setY(y));
          local(paint, new THREE.BoxGeometry(len + 2 * back, 0.14, back + 0.5), place(len / 2, H + 0.05, -back / 2 + 0.25), col(attic.color));
          for (const y of [0.55, 1.05]) local(paint, new THREE.BoxGeometry(len, 0.035, 0.035), place(len / 2, H + 0.12 + y, 0.36), dark);
          const n = Math.max(2, Math.round(len / 1.6));
          for (let i = 0; i <= n; i++) local(paint, new THREE.BoxGeometry(0.03, 1.05, 0.03), place((len * i) / n, H + 0.12 + 0.525, 0.36), dark);
        }
      }
    }
    if (r > 0) {
      // a quarter circle, or (a vault that rises more than it reaches in) a quarter ellipse
      const round = Math.abs(rise - r) < 0.01;
      const cove: [number, number][] = round ? coveProfile(r, b, spec.kind === "vault" ? 20 : 8) : coveArc(0, 1);
      const bed: [number, number][] = [[0, b - 0.07], [0.025, b - 0.07], [0.032, b - 0.055], [0.032, b - 0.035], [0.045, b - 0.02], [0.045, b], [0, b + 0.001]];
      for (const q of runs) {
        lc.ceiling.sweep(cove, q.a, q.b, q.n, 50);
        if (spec.kind === "vault" && skinned("attic")) continue;
        if (spec.kind === "vault") {
          (room.giltCornice ? lc.gilt : lc.trim).sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, b + hh] as [number, number]), q.a, q.b, q.n);
          if (room.giltCornice) lc.gilt.sweep(VAULT_CORNICE.map(([dd, hh]) => [dd * 1.5 + 0.02, b - 0.34 + hh * 0.5] as [number, number]), q.a, q.b, q.n);
          if (room.gilt && !room.giltCornice) lc.gilt.sweep(GILT_BEAD.map(([dd, hh]) => [dd, b - 0.2 + hh] as [number, number]), q.a, q.b, q.n);
        } else lc.ceiling.sweep(bed, q.a, q.b, q.n);
      }
    } else {
      // a flat ceiling meets the wall at a slim cornice
      for (const q of runs) lc.trim.sweep([[0, H - 0.16], [0.05, H - 0.16], [0.09, H - 0.06], [0.09, H], [0, H + 0.001]], q.a, q.b, q.n);
    }
    // a cornice carried on brackets: a console every metre or so under it, a gilt lion's mask between
    if (room.brackets) {
      const bronze = col("#4a3a22");
      for (const q of wallRuns) {
        const len = runLength(q);
        const dir = q.b.clone().sub(q.a).normalize();
        const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
        const n = Math.max(2, Math.round(len / 1.15));
        local(paint, new THREE.BoxGeometry(len, 0.9, 0.1), new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(q.a.clone().addScaledVector(dir, len / 2).addScaledVector(q.n, 0.05).setY(H - 0.75)), bronze);
        for (let i = 0; i <= n; i++) {
          const p = q.a.clone().addScaledVector(dir, (len * i) / n).addScaledVector(q.n, 0.22).setY(H - 0.68);
          local(paint, new THREE.BoxGeometry(0.22, 0.72, 0.44), new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(p), col("#6b5330"));
          local(gilt, new THREE.BoxGeometry(0.24, 0.07, 0.46), new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(p.clone().setY(H - 0.3)));
          if (i < n) local(gilt, new THREE.SphereGeometry(0.1, 8, 6), T(p.x + dir.x * (len / n / 2) + q.n.x * -0.08, H - 0.7, p.z + dir.z * (len / n / 2) + q.n.z * -0.08));
        }
      }
    }
    const wx = spec.wellX;
    const face = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 1e-4 || bz - az < 1e-4) return;
      lc.ceiling.quad(V(ax, yC, az), V(bx - ax, 0, 0), V(0, 0, bz - az), [ax, az]);
    };
    if (cloister) {
      // no glass: the vault closes on a painted panel in a gilt frame
      const ground = col(room.coveArt?.ground ?? "#4a4640");
      local(paint, new THREE.BoxGeometry(2 * (hw - r), 0.04, spec.z1 - spec.z0 - 2 * r), T(0, yC + 0.02, (spec.z0 + spec.z1) / 2), ground);
      for (const s of skinned("top") ? [] : [-1, 1]) {
        lc.gilt.box(0.3, 0.2, spec.z1 - spec.z0 - 2 * r + 0.3, s * (hw - r), yC - 0.08, (spec.z0 + spec.z1) / 2);
        lc.gilt.box(2 * (hw - r) + 0.3, 0.2, 0.3, 0, yC - 0.08, s < 0 ? spec.z0 + r : spec.z1 - r);
      }
      if (!skinned("top")) lc.gilt.add(new THREE.TorusGeometry(Math.min(hw - r, 2.2) * 0.7, 0.12, 6, 28), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, yC - 0.05, (spec.z0 + spec.z1) / 2));
    } else {
      face(-hw + r, -wx, spec.z0 + r, spec.z1 - r);
      face(wx, hw - r, spec.z0 + r, spec.z1 - r);
      face(-wx, wx, spec.z0 + r, spec.wellZ0);
      face(-wx, wx, spec.wellZ1, spec.z1 - r);
      const dy = spec.yGlass - yC;
      lc.ceiling.quad(V(-wx, yC, spec.wellZ1), V(0, 0, spec.wellZ0 - spec.wellZ1), V(0, dy, 0));
      lc.ceiling.quad(V(wx, yC, spec.wellZ0), V(0, 0, spec.wellZ1 - spec.wellZ0), V(0, dy, 0));
      lc.ceiling.quad(V(-wx, yC, spec.wellZ0), V(2 * wx, 0, 0), V(0, dy, 0));
      lc.ceiling.quad(V(wx, yC, spec.wellZ1), V(-2 * wx, 0, 0), V(0, dy, 0));
      // a moulded frame round the glass: heavy and gilt in a gilded room, a dark band inside it
      // (photographed: the real frame lies on the band round the glass)
      const heavy = !!room.giltCornice && !skinned("frame");
      const fw = heavy ? 0.42 : spec.kind === "lightbox" ? 0.06 : 0.14;
      const fd = heavy ? 0.3 : spec.kind === "lightbox" ? 0.03 : 0.09;
      const edge = heavy ? lc.gilt : spec.kind === "lightbox" ? lc.trim : lc.ceiling;
      const wl = spec.wellZ1 - spec.wellZ0;
      const zm = (spec.wellZ0 + spec.wellZ1) / 2;
      for (const s of [-1, 1]) {
        if (skinned("frame")) {
          // only the well's own sides, dark above the band
          const dark = col("#1d1a17");
          lbox(paint, 0.05, spec.yGlass - yC, wl, s * (wx - 0.025), (spec.yGlass + yC) / 2, zm, dark);
          lbox(paint, 2 * wx, spec.yGlass - yC, 0.05, 0, (spec.yGlass + yC) / 2, s < 0 ? spec.wellZ0 + 0.025 : spec.wellZ1 - 0.025, dark);
          continue;
        }
        edge.roundedBox(fw, fd, wl + 2 * fw, s * (wx + fw / 2), yC - fd / 2 + 0.002, zm, 0.03, 2);
        edge.roundedBox(2 * wx, fd, fw, 0, yC - fd / 2 + 0.002, s < 0 ? spec.wellZ0 - fw / 2 : spec.wellZ1 + fw / 2, 0.03, 2);
        if (heavy) {
          const dark = col("#1d1a17");
          lbox(paint, 0.12, 0.2, wl, s * (wx - 0.06), yC + 0.06, zm, dark);
          lbox(paint, 2 * wx, 0.2, 0.12, 0, yC + 0.06, s < 0 ? spec.wellZ0 + 0.06 : spec.wellZ1 - 0.06, dark);
          // an ornament at every bay line along the frame
          for (let i = 0; i <= spec.bays.length; i++) {
            const z = i === spec.bays.length ? spec.wellZ1 : spec.bays[i].z0;
            lc.gilt.add(new THREE.SphereGeometry(0.2, 8, 6), new THREE.Matrix4().makeScale(1.2, 0.8, 1.6).setPosition(s * (wx + fw * 0.45), yC - fd, z));
          }
        }
      }
      if (spec.beamW > 0) {
        const bars = room.glazing?.bars ? col(room.glazing.bars) : null;
        for (let i = 1; i < spec.bays.length; i++) {
          if (bars) lbox(paint, 2 * wx, spec.beamDepth, spec.beamW, 0, spec.yGlass - spec.beamDepth / 2, spec.bays[i].z0, bars);
          else (heavy ? lc.gilt : lc.ceiling).box(2 * wx, spec.beamDepth, spec.beamW, 0, spec.yGlass - spec.beamDepth / 2, spec.bays[i].z0);
        }
      }
      // the glass: one quad per bay, facing down
      const halfBeam = spec.beamW / 2;
      spec.bays.forEach((bay, i) => {
        const z0 = bay.z0 + (i === 0 ? 0 : halfBeam);
        const z1 = bay.z1 - (i === spec.bays.length - 1 ? 0 : halfBeam);
        const g = new THREE.BufferGeometry();
        const y = spec.yGlass;
        g.setAttribute("position", new THREE.Float32BufferAttribute([-wx, y, z0, wx, y, z0, wx, y, z1, -wx, y, z1], 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        local(glass, g);
      });
    }
    for (const [from, to] of [[lc.ceiling, ceiling], [lc.trim, trim], [lc.gilt, gilt]] as const) {
      if (!from.empty) to.add(from.build(false), toWorld.clone());
    }
    if (r > 0 && room.coveArt && !skinned("cove")) coveOrnament();
  }

  /** What is painted or modelled on the coves. */
  function coveOrnament() {
    const a = room.coveArt!;
    const gold = col(a.color);
    if (a.kind === "arabesque") {
      // gilt scrollwork, a repeat every so many metres along each cove, centred on it; clear of the corners
      const every = a.every ?? 4;
      const arc = coveArc(0.06, 0.97, 0.014);
      const height = arcLength(arc);
      for (const q of runs) {
        const len = runLength(q) - 2 * r;
        if (len < 2) continue;
        const dir = q.b.clone().sub(q.a).normalize();
        const tmp = new GeoBatch();
        tmp.sweep(arc, q.a.clone().addScaledVector(dir, r), q.b.clone().addScaledVector(dir, -r), q.n, 60);
        const g = tmp.build(false);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        const n = Math.max(1, Math.round(len / every));
        // (sweep: u runs 0..len from the run's start; the canvas reads left to right from inside the room)
        const flip = new THREE.Vector3().crossVectors(UP, q.n).dot(dir) < 0 ? -1 : 1;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (flip * (uv.getX(i) - len / 2) * n) / len + 0.5, uv.getY(i) / height);
        local(art, g);
      }
      return;
    }
    if (a.kind === "stucco") {
      // the Salon Carré's: panels of blue in gilt frames, a round relief over a seated figure in the middle of
      // each side, a figure bearing a shield in each corner, garlands along the foot
      const ground = col(a.ground ?? "#3d4a5c");
      for (const q of runs) {
        const len = runLength(q);
        const s0 = r * 0.72;
        const s1 = len - r * 0.72;
        const mid = len / 2;
        const gap = 1.9;
        coveStrip(paint, q, s0 - 0.1, s1 + 0.1, 0.1, 0.96, 0.02, gold);
        // two rows of panels either side of the middle, stepped in toward the top as the corners close
        for (const side of [-1, 1]) {
          const from = side < 0 ? s0 : mid + gap;
          const to = side < 0 ? mid - gap : s1;
          const n = Math.max(1, Math.round((to - from) / 2.3));
          const w = (to - from) / n;
          for (let i = 0; i < n; i++) {
            const pa = from + w * i + 0.2;
            const pb = from + w * (i + 1) - 0.2;
            // each panel in a moulded frame of gilt, a rosette where four frames meet
            coveStrip(gilt, q, pa - 0.07, pb + 0.07, 0.2, 0.5, 0.04);
            coveStrip(paint, q, pa, pb, 0.215, 0.485, 0.06, ground);
            coveStrip(gilt, q, pa + 0.18, pb - 0.18, 0.585, 0.9, 0.04);
            coveStrip(paint, q, pa + 0.25, pb - 0.25, 0.6, 0.885, 0.06, ground);
            local(gilt, new THREE.SphereGeometry(0.16, 8, 6), coveAt(q, from + w * i, 0.54, 0.08).m.clone().scale(V(1, 1, 0.5)));
          }
        }
        // the round relief in its wreath, the seated figure under it between two children
        const med = coveAt(q, mid, 0.6, 0.09);
        local(gilt, new THREE.TorusGeometry(0.95, 0.14, 6, 28), med.m);
        local(paint, new THREE.CylinderGeometry(0.9, 0.9, 0.08, 28), med.m.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), stucco);
        local(paint, new THREE.SphereGeometry(0.42, 10, 8), med.m.clone().multiply(new THREE.Matrix4().makeScale(1, 1.25, 0.35).setPosition(0, -0.05, 0.05)), stucco);
        figure(coveAt(q, mid, 0.2, 0.3).m, 1.15);
        for (const s of [-1, 1]) figure(coveAt(q, mid + s * 0.95, 0.17, 0.22).m, 0.55);
        // garlands along the foot, hung from a shell at each panel line
        const swags = Math.max(2, Math.round((s1 - s0) / 3.2));
        for (let i = 0; i < swags; i++) {
          const pa = s0 + ((s1 - s0) * i) / swags;
          const pb = s0 + ((s1 - s0) * (i + 1)) / swags;
          if (pa < mid + 1.2 && pb > mid - 1.2) continue;
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 8; k++) {
            const t = k / 8;
            pts.push(coveAt(q, pa + (pb - pa) * t, 0.13 - 0.05 * 4 * t * (1 - t), 0.1).p);
          }
          local(gilt, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.085, 6, false));
          local(gilt, new THREE.SphereGeometry(0.18, 8, 6), T(pts[0].x, pts[0].y, pts[0].z));
        }
      }
      // the corners: a figure rising up the groin, arms raised to a shield, two winged children below
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const at = (t: number, off: number) => {
            const th = t * (Math.PI / 2);
            const d = r - r * Math.cos(th) + off * 0.7;
            return V(sx * (hw - d), b + rise * Math.sin(th) - off * 0.5, (sz < 0 ? spec.z0 + d : spec.z1 - d));
          };
          const facing = Math.atan2(-sx, -sz);
          const m = (t: number, off: number) => new THREE.Matrix4().makeRotationY(facing).multiply(new THREE.Matrix4().makeRotationX(-0.6)).setPosition(at(t, off));
          figure(m(0.42, 0.25), 1.5, true);
          local(gilt, new THREE.CylinderGeometry(0.62, 0.62, 0.12, 20), m(0.74, 0.2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
          local(paint, new THREE.CylinderGeometry(0.5, 0.5, 0.14, 20), m(0.74, 0.22).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), col("#6e5a4c"));
          for (const s of [-1, 1]) figure(m(0.2, 0.2).multiply(T(s * 0.85, 0, 0)), 0.7);
        }
      return;
    }
    // mural: painted compartments in gilt frames between round-headed windows; an eagle over a shield in each
    // corner (the Salon Denon)
    const ground = col(a.ground ?? "#4a4640");
    for (const q of runs) {
      const len = runLength(q);
      const s0 = r * 0.8;
      const s1 = len - r * 0.8;
      const n = Math.max(1, Math.round((s1 - s0) / 5.2));
      const w = (s1 - s0) / n;
      coveStrip(gilt, q, s0 - 0.15, s1 + 0.15, 0.55, 0.97, 0.02);
      for (let i = 0; i < n; i++) {
        coveStrip(paint, q, s0 + w * i + 0.2, s0 + w * (i + 1) - 0.2, 0.6, 0.94, 0.05, ground.clone().lerp(col(i % 2 ? "#6a5a48" : "#4c5560"), 0.45));
        lunette(q, s0 + w * (i + 0.5), Math.min(2.5, w - 1.6));
      }
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const th = 0.5 * (Math.PI / 2);
        const d = r - r * Math.cos(th) + 0.3;
        const p = V(sx * (hw - d), b + rise * Math.sin(th) - 0.1, sz < 0 ? spec.z0 + d : spec.z1 - d);
        const m = new THREE.Matrix4().makeRotationY(Math.atan2(-sx, -sz)).multiply(new THREE.Matrix4().makeRotationX(-0.7)).setPosition(p);
        // a shield in a wreath of palms, the eagle above it, wings spread
        local(paint, new THREE.SphereGeometry(0.6, 10, 8), m.clone().multiply(new THREE.Matrix4().makeScale(1, 1.2, 0.25)), col("#2c3038"));
        local(gilt, new THREE.TorusGeometry(0.72, 0.12, 6, 20), m.clone().multiply(new THREE.Matrix4().makeScale(1, 1.2, 1)));
        local(gilt, new THREE.SphereGeometry(0.34, 8, 6), m.clone().multiply(new THREE.Matrix4().makeScale(0.8, 1.3, 0.8).setPosition(0, 1.45, 0.2)));
        local(gilt, new THREE.SphereGeometry(0.17, 8, 6), m.clone().multiply(T(0, 1.98, 0.3)));
        for (const s of [-1, 1]) {
          local(gilt, new THREE.SphereGeometry(0.5, 8, 6), m.clone().multiply(new THREE.Matrix4().makeRotationZ(s * 0.55).scale(V(1.9, 0.5, 0.16)).setPosition(s * 0.95, 1.75, 0.15)));
          local(paint, new THREE.SphereGeometry(0.5, 8, 6), m.clone().multiply(new THREE.Matrix4().makeRotationZ(-s * 0.9).scale(V(0.3, 2.3, 0.2)).setPosition(s * 1.05, -0.5, 0.1)), col("#3a4038"));
        }
      }
  }

  /** A round-headed window in a cove: an upright pane a little in from the wall, in a hood that meets the cove. */
  function lunette(q: CoveRun, s: number, w: number) {
    const tw = 0.34;
    const th = tw * (Math.PI / 2);
    const d = r - r * Math.cos(th);
    const yTop = b + rise * Math.sin(th);
    const y0 = b + 0.55;
    const hh = yTop - y0;
    const dir = q.b.clone().sub(q.a).normalize();
    const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
    const base = q.a.clone().addScaledVector(dir, s);
    const m = new THREE.Matrix4().makeBasis(x, UP, q.n).setPosition(base.clone().addScaledVector(q.n, d).setY(0));
    const shape = new THREE.Shape();
    const rr = w / 2;
    shape.moveTo(-rr, y0);
    shape.lineTo(rr, y0);
    shape.lineTo(rr, y0 + hh - rr * 0.8);
    for (let k = 1; k <= 12; k++) {
      const a = (Math.PI * k) / 12;
      shape.lineTo(rr * Math.cos(a), y0 + hh - rr * 0.8 + rr * 0.8 * Math.sin(a));
    }
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape, 8);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + rr) / w, (pos.getY(i) - y0) / hh);
    local(glass, g, m);
    // the hood: cheeks, a sill and a head, pale as the vault's stone
    const pale = col("#8f8a80");
    for (const sx of [-1, 1]) local(paint, new THREE.BoxGeometry(0.16, hh + 0.3, d + 0.3), m.clone().multiply(T(sx * (rr + 0.08), y0 + hh / 2 + 0.1, -d / 2 + 0.1)), pale);
    local(paint, new THREE.BoxGeometry(w + 0.5, 0.16, d + 0.34), m.clone().multiply(T(0, y0 - 0.08, -d / 2 + 0.12)), pale);
    local(paint, new THREE.BoxGeometry(w + 0.32, 0.3, d + 0.3), m.clone().multiply(T(0, y0 + hh + 0.18, -d / 2 + 0.1)), pale);
  }

  /** A figure of white stucco, roughly: a body, a head, a lap (seated) or raised arms; `size` its height. */
  function figure(m: THREE.Matrix4, size: number, arms = false) {
    const part = (rx: number, ry: number, rz: number, x: number, y: number, z: number, tilt = 0) =>
      local(paint, new THREE.SphereGeometry(1, 9, 7), m.clone().multiply(new THREE.Matrix4().makeRotationZ(tilt).scale(V(rx * size, ry * size, rz * size)).setPosition(x * size, y * size, z * size)), stucco);
    part(0.2, 0.3, 0.16, 0, 0.1, 0.08);
    part(0.11, 0.12, 0.11, 0, 0.5, 0.1);
    if (arms) {
      for (const s of [-1, 1]) part(0.07, 0.3, 0.07, s * 0.27, 0.48, 0.08, -s * 0.5);
      part(0.17, 0.32, 0.14, 0, -0.4, 0.05);
    } else {
      part(0.26, 0.16, 0.24, 0, -0.22, 0.16);
      for (const s of [-1, 1]) part(0.08, 0.2, 0.08, s * 0.2, -0.42, 0.2);
    }
  }

  // ---- photographs of the real ceiling: each laid on the surfaces it was taken of, a little out from them (a
  // later one over an earlier), every point given the place it has on the picture; where a patch is to be raised
  // (plan-relief.ts, once the picture has come), a fine grid and, for each point, the way its surface faces
  const photos = skins.map((ph, layer) => {
    const lift = 0.07 + 0.014 * layer;
    const pos: number[] = [];
    const uv: number[] = [];
    const outs: number[] = [];
    const depths: number[] = [];
    const turns: number[] = [];
    const idx: number[] = [];
    interface Row { d: number; y: number; reach: number; nd: number; ny: number }
    const halfOf = (side: Side) => (side === "n" || side === "s" ? (sh.x1 - sh.x0) / 2 : (sh.z1 - sh.z0) / 2);
    /** A point of a side's surface: s along the wall from the room's middle, d in from the wall, y up. */
    const point = (side: Side, s: number, d: number, y: number): [number, number, number] =>
      side === "n" ? [cx + s, y, sh.z0 + d] : side === "s" ? [cx + s, y, sh.z1 - d] : side === "w" ? [sh.x0 + d, y, cz + s] : [sh.x1 - d, y, cz + s];
    const inward = (side: Side): [number, number] => (side === "n" ? [0, 1] : side === "s" ? [0, -1] : side === "w" ? [1, 0] : [-1, 0]);
    /** How far in from a side's wall a point of the plan is. */
    const inFrom = (side: Side, x: number, z: number) => (side === "n" ? z - sh.z0 : side === "s" ? sh.z1 - z : side === "w" ? x - sh.x0 : sh.x1 - x);
    /** A grid of rows (each: its [d, y], how far along the wall it may reach, the way it faces) from s0 to s1: each
     *  row as far along the wall as the photograph shows it (its edge is then the picture's own, not a staircase
     *  of cells). */
    const grid = (o: PhotoPatch, rows: Row[], s0: number, s1: number, taperTop: boolean) => {
      const raised = opts.relief && o.relief ? o.relief : 0;
      const cell = raised ? 0.12 : 0.45;
      const n = Math.max(1, Math.ceil((s1 - s0) / cell));
      const base = pos.length / 3;
      const ok: boolean[] = [];
      const [ix, iz] = inward(o.side);
      const look = (s: number, row: Row) => {
        const p = point(o.side, s, row.d, row.y);
        // behind the walls' faces (an attic set back) the camera saw only what stands above the cornice's edge:
        // below that, what it saw lowest is carried down (a window's jambs and glass run on to the gallery's
        // floor)
        let yLook = p[1];
        if (row.d < -0.05) {
          const eye = o.turned ? [2 * cx - ph.eye[0], ph.eye[1], 2 * cz - ph.eye[2]] : ph.eye;
          const de = inFrom(o.side, eye[0], eye[2]);
          yLook = Math.max(yLook, eye[1] + ((H + 0.2 - eye[1]) * (de - row.d)) / de);
        }
        // (the other end's photograph: looked up as there, turned about the room's middle)
        const q = o.turned ? [2 * cx - p[0], yLook, 2 * cz - p[2]] : [p[0], yLook, p[2]];
        const t = photoUV(ph, q[0], q[1], q[2]);
        const inside = !!t && t[0] > 0.006 && t[0] < 0.994 && t[1] > 0.006 && t[1] < 0.994;
        return { p, t, inside };
      };
      rows.forEach((row, j) => {
        let a = Math.max(s0, -row.reach);
        let c = Math.min(s1, row.reach);
        // the stretch of this row the picture holds
        let first = NaN;
        let last = NaN;
        for (let s = a; s <= c + 1e-6; s += 0.05) {
          if (!look(s, row).inside) continue;
          if (Number.isNaN(first)) first = s;
          last = s;
        }
        const has = !Number.isNaN(first) && last - first > 0.2;
        if (has) {
          a = first;
          c = last;
        }
        // raised less toward the patch's ends and its top, so its edges stay where the flat surface is
        const rowTaper = taperTop ? Math.min(1, ((rows.length - 1 - j) * 0.12) / 0.4) : 1;
        for (let i = 0; i <= n; i++) {
          const { p, t } = look(a + ((c - a) * i) / n, row);
          pos.push(...p);
          uv.push(t ? t[0] : 0, t ? t[1] : 0);
          outs.push(ix * row.nd, row.ny, iz * row.nd);
          depths.push(raised * rowTaper * Math.min(1, (Math.min(i, n - i) * cell) / 0.4));
          turns.push(o.turned ? 1 : 0);
          ok.push(has && c > a);
        }
      });
      for (let j = 0; j < rows.length - 1; j++)
        for (let i = 0; i < n; i++) {
          const a = j * (n + 1) + i;
          const c = a + n + 1;
          if (!(ok[a] && ok[a + 1] && ok[c] && ok[c + 1])) continue;
          idx.push(base + a, base + a + 1, base + c + 1, base + a, base + c + 1, base + c);
        }
    };
    for (const o of ph.on) {
      const half = halfOf(o.side);
      const spans: [number, number][] = o.ends ? [[-half - back, -half + o.ends], [half - o.ends, half + back]] : [o.s ?? [-half - back, half + back]];
      const fine = !!(opts.relief && o.relief);
      let rows: Row[];
      if (o.part === "cove") {
        // (r: the cove's own reach, from the attic's face where that is set back)
        const [t0, t1] = o.t ?? [0, 1];
        const arc = (Math.PI / 2) * Math.hypot(r, rise) * 0.72 * (t1 - t0);
        const steps = fine ? Math.max(4, Math.ceil(arc / 0.12)) : Math.max(2, Math.round((t1 - t0) * 18));
        rows = Array.from({ length: steps + 1 }, (_, i) => {
          const th = (t0 + ((t1 - t0) * i) / steps) * (Math.PI / 2);
          const nd = rise * Math.cos(th);
          const ny = -r * Math.sin(th);
          const nl = Math.hypot(nd, ny) || 1;
          const d = r - r * Math.cos(th) - back;
          // (the coves meet on the diagonals: each row stops there)
          return { d: d + (lift * nd) / nl, y: b + rise * Math.sin(th) + (lift * ny) / nl, reach: half - d, nd: nd / nl, ny: ny / nl };
        });
      } else if (o.part === "top") {
        // the flat top of a vault, from this side's cove to the one across
        const deep = o.side === "n" || o.side === "s" ? sh.z1 - sh.z0 : sh.x1 - sh.x0;
        const in0 = r - back;
        const k = Math.max(2, Math.ceil((deep - 2 * in0) / (fine ? 0.12 : 0.6)));
        rows = Array.from({ length: k + 1 }, (_, i) => ({ d: in0 - 0.05 + ((deep - 2 * in0 + 0.1) * i) / k, y: spec.yCeil - lift, reach: half - in0 + 0.05, nd: 0, ny: -1 }));
      } else if (o.part === "frame") {
        // the flat band between the cove's top and the glass
        const band = (sh.alongX === (o.side === "n" || o.side === "s") ? hw - spec.wellX : spec.wellZ0 - spec.z0) - r;
        rows = [r - 0.06, r + band * 0.5, r + band + 0.03].map((d) => ({ d: d - back, y: spec.yCeil - lift, reach: half - d + back, nd: 0, ny: -1 }));
      } else {
        // the attic and its cornice: upright from the wall's top, then out and back under the cove's foot
        const ah = b - H;
        const c = Math.min(1.05, ah * 0.32);
        const k = fine ? Math.max(6, Math.ceil(ah / 0.14)) : 6;
        const upright: [number, number][] = Array.from({ length: k + 1 }, (_, i) => [0, (ah * i) / k]);
        const kl = fine ? Math.ceil((ah - c) / 0.14) : 2;
        const lower: [number, number][] = Array.from({ length: kl + 1 }, (_, i) => [0, ((ah - c) * i) / kl]);
        rows = (o.plain ? upright : [...lower, [0.1, ah - c * 0.9], [0.36, ah - c * 0.45], [0.42, ah - c * 0.2], [0.3, ah - c * 0.1], [0.3, ah]]).map(
          ([d, y]) => ({ d: d + lift - back, y: H + y, reach: half + back, nd: 1, ny: 0 })
        );
      }
      for (const [s0, s1] of spans) grid(o, rows, s0, s1, o.part === "cove");
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (depths.some((v) => v > 0)) {
      g.setAttribute("aFlat", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aOut", new THREE.Float32BufferAttribute(outs, 3));
      g.setAttribute("aRelief", new THREE.Float32BufferAttribute(depths, 1));
      g.setAttribute("aTurn", new THREE.Float32BufferAttribute(turns, 1));
    }
    g.setIndex(idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, photo: ph };
  });

  // ---- arches across the gallery: each side, a block of marble from the wall, two columns on it one behind the
  // other, two pilasters on the wall behind them, an entablature from the wall out over the columns; the arch
  // springs from it, its two faces filling the vault above, a coffered barrel between them
  for (const arch of plan.arches) {
    if (arch.shell !== index) continue;
    const lz = arch.at - (sh.alongX ? cx : cz);
    const { half: a, spring: y0, rise: ar, depth: dz } = arch;
    const stone = col(room.archStone ?? room.frieze?.color ?? "#a8a6a2");
    const shaft = col(arch.marble ?? room.marble ?? "#8a7f86");
    const pale = col(room.nicheBays ?? "#d9d5cc");
    const ph = pedestal?.height ?? 0;
    const capTop = y0 - COLUMN.entablature;
    const out = COLUMN.out + COLUMN.plinth;
    const plen = COLUMN.apart + 2 * COLUMN.plinth;
    for (const s of [-1, 1]) {
      // the block
      if (ph > 0) {
        lbox(marble, out, ph - 0.12, plen, s * (hw - out / 2), (ph - 0.12) / 2, lz, pedColor);
        lbox(marble, out + 0.06, 0.16, plen + 0.12, s * (hw - out / 2 - 0.03), 0.08, lz, pedColor);
        lbox(trim, out + 0.08, 0.12, plen + 0.16, s * (hw - out / 2 - 0.04), ph - 0.06, lz);
      }
      // the columns and the pilasters behind them
      for (const k of [-1, 1]) {
        const z = lz + (k * COLUMN.apart) / 2;
        const x = s * (hw - COLUMN.out);
        const cr = COLUMN.r;
        const capH = 0.66;
        const shaftTop = capTop - capH;
        local(gilt, new THREE.BoxGeometry(2.5 * cr, 0.1, 2.5 * cr), T(x, ph + 0.05, z));
        local(gilt, new THREE.TorusGeometry(cr * 1.12, cr * 0.16, 6, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, ph + 0.16, z));
        local(gilt, new THREE.TorusGeometry(cr * 1.04, cr * 0.1, 5, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, ph + 0.25, z));
        local(marble, new THREE.CylinderGeometry(cr * 0.86, cr, shaftTop - ph - 0.28, 20, 1, true), T(x, (shaftTop + ph + 0.28) / 2, z), shaft);
        local(gilt, new THREE.TorusGeometry(cr * 0.9, cr * 0.08, 5, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, shaftTop + 0.02, z));
        // a Corinthian capital: a flaring bell, two rings of leaves, an abacus
        local(gilt, new THREE.CylinderGeometry(cr * 1.5, cr * 0.88, capH - 0.1, 16), T(x, shaftTop + (capH - 0.1) / 2, z));
        for (const [ring, lift, size] of [[1.0, 0.25, 0.3], [1.22, 0.55, 0.26]] as const) {
          for (let i = 0; i < 8; i++) {
            const an = ((i + (ring > 1.1 ? 0.5 : 0)) / 8) * Math.PI * 2;
            local(gilt, new THREE.SphereGeometry(cr * size, 6, 4), new THREE.Matrix4().makeScale(1, 1.7, 1).setPosition(x + Math.cos(an) * cr * ring, shaftTop + capH * lift, z + Math.sin(an) * cr * ring));
          }
        }
        local(gilt, new THREE.BoxGeometry(3.3 * cr, 0.1, 3.3 * cr), T(x, capTop - 0.05, z));
        // the pilaster on the wall
        lbox(marble, 0.14, capTop - ph - 0.6, 0.56, s * (hw - 0.07), ph + (capTop - ph - 0.6) / 2, z, pale);
        lbox(gilt, 0.2, 0.56, 0.66, s * (hw - 0.1), capTop - 0.3, z);
        lbox(gilt, 0.18, 0.1, 0.62, s * (hw - 0.09), ph + 0.05, z);
      }
      // the wall between the pilasters: pale marble
      lbox(marble, 0.05, capTop - ph, COLUMN.apart - 0.56, s * (hw - 0.025), (capTop + ph) / 2, lz, pale);
      // the entablature: architrave, a frieze of the arch's marble, a cornice with a gilt line
      const x0 = s * hw;
      const x1 = s * a;
      const mid = (x0 + x1) / 2;
      const wide = Math.abs(x1 - x0);
      const eh = COLUMN.entablature;
      lbox(trim, wide, 0.4, 2 * dz, mid, capTop + 0.2, lz);
      lbox(marble, wide - 0.06, eh - 0.85, 2 * dz - 0.06, mid + s * 0.03, capTop + 0.4 + (eh - 0.85) / 2, lz, shaft.clone().lerp(stone, 0.35));
      lbox(trim, wide + 0.14, 0.45, 2 * dz + 0.28, mid - s * 0.07, y0 - 0.225, lz);
      if (room.gilt) {
        lbox(gilt, wide + 0.18, 0.05, 2 * dz + 0.32, mid - s * 0.09, y0 - 0.32, lz);
        lbox(gilt, wide + 0.04, 0.04, 2 * dz + 0.06, mid - s * 0.02, capTop + 0.42, lz);
      }
      // its coffered underside between the columns and the wall
      lbox(paint, wide - 0.5, 0.03, 2 * dz - 0.5, mid, capTop - 0.012, lz, stone.clone().multiplyScalar(0.8));
    }
    // the vault's section above the springing, less the arch: one face each way
    const crown = Math.min(ar, section(0) - y0 - 0.5);
    const faceShape = new THREE.Shape();
    faceShape.moveTo(-hw, y0);
    // (a band as deep at the crown as the arch stands in from the walls: under a round vault it stops short of
    // the crown, the vault passing over it)
    const band = hw - a;
    for (let i = 0; i <= 48; i++) {
      const x = -hw + (2 * hw * i) / 48;
      const outer = y0 + (crown + band) * Math.sqrt(Math.max(0, 1 - (x / hw) ** 2));
      faceShape.lineTo(x, Math.max(y0, Math.min(section(x), barrel ? outer : Infinity)));
    }
    faceShape.lineTo(hw, y0);
    faceShape.lineTo(a, y0);
    for (let i = 1; i <= 32; i++) {
      const t = (Math.PI * i) / 32;
      faceShape.lineTo(a * Math.cos(t), y0 + crown * Math.sin(t));
    }
    faceShape.closePath();
    local(marble, new THREE.ShapeGeometry(faceShape, 1), T(0, 0, lz + dz), stone);
    local(marble, new THREE.ShapeGeometry(faceShape, 1), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, lz - dz), stone);
    local(paint, archSoffit(a, y0, crown, lz - dz, lz + dz), undefined, col("#d9d4c8"));
    // mouldings round the arch on each face: a broad white band at its edge, a gilt line, a slimmer band near
    // the vault; ribs across the underside (its coffers)
    const ringAt = (grow: number, z: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 32; i++) {
        const t = Math.PI - (Math.PI * i) / 32;
        pts.push(V((a + grow) * Math.cos(t), y0 + (crown + grow) * Math.sin(t), z));
      }
      return new THREE.CatmullRomCurve3(pts);
    };
    for (const s of [-1, 1]) {
      local(trim, new THREE.TubeGeometry(ringAt(0.14, lz + s * dz), 32, 0.17, 6, false));
      local(trim, new THREE.TubeGeometry(ringAt(0.9, lz + s * (dz + 0.01)), 32, 0.07, 5, false));
      if (room.gilt) {
        local(gilt, new THREE.TubeGeometry(ringAt(0.38, lz + s * (dz + 0.04)), 32, 0.035, 4, false));
        local(gilt, new THREE.TubeGeometry(ringAt(0.78, lz + s * (dz + 0.04)), 32, 0.025, 4, false));
      }
    }
    for (const z of [lz - dz * 0.45, lz + dz * 0.45]) local(trim, new THREE.TubeGeometry(ringAt(-0.03, z), 32, 0.06, 4, false));
    for (let i = 1; i < 9; i++) {
      const t = (Math.PI * i) / 9;
      const p = V(a * Math.cos(t), y0 + crown * Math.sin(t), lz);
      const tilt = Math.atan2(crown * Math.cos(t), -a * Math.sin(t));
      local(trim, new THREE.BoxGeometry(0.1, 0.09, 2 * dz - 0.3), new THREE.Matrix4().makeRotationZ(tilt).setPosition(p.x, p.y - 0.03, p.z));
    }
  }

  // ---- barriers before the most famous works: a rope on brass posts; or a rail of oak on slim legs
  const rope = col("#6e1418");
  for (const bar of layout.barriers) {
    if (plan.zones[bar.room]?.shell !== index) continue;
    if (bar.rail) {
      const oak = col("#b78a52");
      bar.posts.forEach(([x, z], i) => {
        if (i % 3 === 0) paint.add(new THREE.CylinderGeometry(0.018, 0.018, 0.92, 8), T(x, 0.46, z), steel);
        const next = bar.posts[i + 1];
        if (!next) return;
        const len = Math.hypot(next[0] - x, next[1] - z);
        const m = new THREE.Matrix4().makeRotationY(Math.atan2(next[0] - x, next[1] - z)).setPosition((x + next[0]) / 2, 0.95, (z + next[1]) / 2);
        paint.add(new THREE.BoxGeometry(0.34, 0.07, len + 0.03), m, oak);
      });
      continue;
    }
    bar.posts.forEach(([x, z], i) => {
      gilt.cylinder(0.16, 0.17, 0.035, x, 0, z, 24);
      gilt.cylinder(0.02, 0.026, 0.9, x, 0.035, z, 12);
      gilt.add(new THREE.SphereGeometry(0.04, 12, 8), T(x, 0.95, z));
      const next = bar.posts[i + 1];
      if (!next) return;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const s = k / 8;
        pts.push(V(x + (next[0] - x) * s, 0.9 - 0.16 * 4 * s * (1 - s), z + (next[1] - z) * s));
      }
      seat.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 6, false), undefined, rope);
    });
  }

  // ---- seating
  const set = furnitureOf(room.furniture ? { era: room.furniture } : theme);
  const pieces = layout.furniture.filter((p) => plan.zones[p.room]?.shell === index);
  for (const p of pieces) buildFurnishing(set, { up: seat, wood: frame, metal: accent }, p);
  const benchShadow = buildBenchShadows(pieces);

  const out: ShellGeometry = {
    walls: walls.build(),
    ceiling: ceiling.build(),
    trim: trim.build(),
    gilt: gilt.build(),
    marble: marble.build(),
    paint: paint.build(),
    art: art.build(),
    benchSeat: seat.build(),
    benchFrame: frame.build(),
    benchAccent: accent.build(),
    benchShadow,
    floor: floor.build(),
    glass: glass.build(),
    photos,
    spec,
    cx,
    cz,
    turn,
    half: new THREE.Vector3(W / 2, top, L / 2),
  };
  rounded.forEach((g) => g.dispose());
  return out;
}

const xyz = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];

export const SHELL_PARTS = ["walls", "ceiling", "trim", "gilt", "marble", "paint", "art", "benchSeat", "benchFrame", "benchAccent", "benchShadow", "floor", "glass"] as const;

export function disposeShell(s: ShellGeometry): void {
  for (const k of SHELL_PARTS) s[k].dispose();
  s.photos.forEach((p) => p.geometry.dispose());
}

/** Where a room's spots hang: by the edge of a vault's skylight or on a flat ceiling (no rails below it), else on
 *  the usual track. */
export function shellRail(sh: Pick<PlanShell, "x0" | "x1" | "z0" | "z1" | "height" | "alongX">, theme: GalleryTheme): { inset: number; y: number } {
  const W = sh.alongX ? sh.z1 - sh.z0 : sh.x1 - sh.x0;
  const L = sh.alongX ? sh.x1 - sh.x0 : sh.z1 - sh.z0;
  const spec = roomCeilingSpec(W, sh.height, -L / 2, L / 2, theme, TRACK_INSET);
  if (!theme.room.noTrack) return { inset: TRACK_INSET, y: sh.height - 0.32 };
  if (spec.kind === "vault" && theme.room.vault === "barrel") {
    // on the curb of the vault's glass
    const inset = Math.max(0.6, W / 2 - spec.wellX - 0.15);
    const rise = spec.yCeil - spec.coveBase;
    return { inset, y: spec.coveBase + rise * Math.sqrt(Math.max(0, 1 - ((W / 2 - inset) / (W / 2)) ** 2)) - 0.12 };
  }
  if (spec.kind === "vault") return { inset: Math.min(W / 2 - 0.4, spec.coveR + 0.2), y: spec.yCeil - 0.05 };
  return { inset: Math.min(W / 2 - 0.4, Math.max(1.8, sh.height * 0.3)), y: sh.height - 0.05 };
}
