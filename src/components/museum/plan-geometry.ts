// The architecture of one room of a real building's plan (plan-layout.ts): its four walls with their doors, its
// plinth, frieze and cornice, its ceiling, its floor, its free-standing walls and columns, its seating. One merged
// geometry per material, in world space, as room-geometry.ts builds a suite's.
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
  vaultRibs,
  type CeilingSpec,
} from "./room-geometry";
import { TRACK_INSET, type GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import { buildFurnishing, furnitureOf } from "./furniture";
import type { PlanDoor, PlanShell, Side } from "./plan-nav";

const UP = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const OPPOSITE: Record<Side, Side> = { n: "s", s: "n", w: "e", e: "w" };

export interface ShellGeometry {
  walls: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  gilt: THREE.BufferGeometry;
  /** Marble and stone, each part in its own colour (vertex colours): plinth, frieze, columns, an arch's piers. */
  marble: THREE.BufferGeometry;
  benchSeat: THREE.BufferGeometry;
  benchFrame: THREE.BufferGeometry;
  benchAccent: THREE.BufferGeometry;
  benchShadow: THREE.BufferGeometry;
  /** The floor: the room's, and its doors' thresholds. */
  floor: THREE.BufferGeometry;
  /** The ceiling's glass, one quad per bay (UVs 0..1 over each). */
  glass: THREE.BufferGeometry;
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

export function buildShell(layout: GalleryLayout, index: number, theme: GalleryTheme): ShellGeometry {
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
  const seat = new GeoBatch(rounded, true);
  const frame = new GeoBatch(rounded, true);
  const accent = new GeoBatch(rounded, true);
  const floor = new GeoBatch();

  const cx = (sh.x0 + sh.x1) / 2;
  const cz = (sh.z0 + sh.z1) / 2;
  const turn = sh.alongX ? Math.PI / 2 : 0;
  const W = sh.alongX ? sh.z1 - sh.z0 : sh.x1 - sh.x0;
  const L = sh.alongX ? sh.x1 - sh.x0 : sh.z1 - sh.z0;
  const toWorld = new THREE.Matrix4().makeRotationY(turn).setPosition(cx, 0, cz);
  const spec = roomCeilingSpec(W, H, -L / 2, L / 2, theme, TRACK_INSET);
  const top = spec.kind === "vault" ? spec.yCeil : H;

  const dado = room.dado;
  const frieze = room.frieze;
  const dadoColor = dado ? new THREE.Color(dado.color) : null;
  const friezeColor = frieze ? new THREE.Color(frieze.color) : null;
  const cbox = (b: GeoBatch, w: number, h: number, d: number, p: THREE.Vector3, rotY: number, color?: THREE.Color) =>
    b.add(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().makeRotationY(rotY).setPosition(p), color);
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
      const hw = d.half;
      if (u - hw > cursor) solid.push([cursor, u - hw]);
      const js = d.height - d.arch;
      if (d.arch > 0) walls.add(archSpandrel(hw, js, d.arch, H), onWall(f, u));
      else walls.quad(at(f, u - hw, d.height), f.t.clone().multiplyScalar(2 * hw), V(0, H - d.height, 0), [u - hw, d.height]);
      cursor = u + hw;
      if (op.owner) doorReveal(f, op, js);
      doorCase(f, op, js);
    }
    if (cursor < f.len) solid.push([cursor, f.len]);
    for (const [a, b] of solid) walls.quad(at(f, a, 0), f.t.clone().multiplyScalar(b - a), V(0, H, 0), [a, 0]);

    // the foot of the wall: a plinth of marble, or a skirting; a frieze under the cornice
    for (const [a, b] of solid) {
      const edgeA = a > 0 ? 0.24 : 0;
      const edgeB = b < f.len ? 0.24 : 0;
      const u0 = a + edgeA;
      const u1 = b - edgeB;
      if (u1 - u0 < 0.05) continue;
      if (dado && dadoColor) {
        cbox(marble, u1 - u0, dado.height, 0.035, at(f, (u0 + u1) / 2, dado.height / 2, 0.0175), f.rotY, dadoColor);
        cbox(marble, u1 - u0, 0.05, 0.055, at(f, (u0 + u1) / 2, dado.height + 0.025, 0.0275), f.rotY, dadoColor);
      } else if (classical) trim.sweep(SKIRTING, at(f, u0, 0), at(f, u1, 0), f.n);
    }
    if (frieze && friezeColor) {
      const y1 = H - 0.34;
      const y0 = y1 - frieze.height;
      cbox(marble, f.len, frieze.height, 0.03, at(f, f.len / 2, (y0 + y1) / 2, 0.015), f.rotY, friezeColor);
      for (const y of [y0, y1]) cbox(trim, f.len, 0.09, 0.06, at(f, f.len / 2, y, 0.03), f.rotY);
      if (room.gilt) cbox(gilt, f.len, 0.022, 0.07, at(f, f.len / 2, y0 - 0.06, 0.035), f.rotY);
    }
  }

  /** The jambs and head of an opening through the wall, and what stands in a door that stays shut. */
  function doorReveal(f: WallFrame, op: Opening, js: number) {
    const { door: d, u, depth: D } = op;
    const hw = d.half;
    const lining = classical ? trim : walls;
    const out = f.n.clone().multiplyScalar(-D);
    lining.quad(at(f, u - hw, 0), out, V(0, js, 0)); // faces along the wall, toward the opening
    lining.quad(at(f, u + hw, 0, -D), f.n.clone().multiplyScalar(D), V(0, js, 0));
    if (d.arch > 0) lining.add(archSoffit(hw, js, d.arch, -D, 0), onWall(f, u));
    else lining.quad(at(f, u - hw, d.height, -D), f.t.clone().multiplyScalar(2 * hw), f.n.clone().multiplyScalar(D));
    // the threshold
    const p0 = at(f, u - hw, 0, -D);
    const p1 = at(f, u + hw, 0, 0);
    floorQuad(Math.min(p0.x, p1.x), Math.max(p0.x, p1.x), Math.min(p0.z, p1.z), Math.max(p0.z, p1.z));
    if (d.b >= 0) return;
    // shut: a pair of panelled leaves set back in the reveal, the wall behind them
    const zLeaf = -Math.min(D * 0.55, D - 0.08);
    const leafW = hw - 0.004;
    const leafH = js - 0.01;
    walls.quad(at(f, u - hw, 0, -D + 0.01), f.t.clone().multiplyScalar(2 * hw), V(0, d.height, 0));
    for (const s of [-1, 1]) {
      const c = u + s * (leafW / 2 + 0.002);
      trim.roundedBox(leafW, leafH, 0.06, ...xyz(at(f, c, leafH / 2, zLeaf)), 0.004, 1, f.rotY);
      const pw = leafW - 0.22;
      const upper = (leafH - 0.44) * 0.6;
      const lower = leafH - 0.44 - upper;
      trim.roundedBox(pw, upper, 0.024, ...xyz(at(f, c, leafH - 0.14 - upper / 2, zLeaf + 0.036)), 0.006, 1, f.rotY);
      trim.roundedBox(pw, lower, 0.024, ...xyz(at(f, c, 0.16 + lower / 2, zLeaf + 0.036)), 0.006, 1, f.rotY);
      gilt.roundedBox(0.03, 0.3, 0.035, ...xyz(at(f, u + s * 0.07, 1.12, zLeaf + 0.05)), 0.01, 1, f.rotY);
    }
    // an arched head: a fixed panel over the leaves
    if (d.arch > 0) {
      const head = new THREE.Shape();
      head.moveTo(-hw, js);
      for (let i = 1; i <= 24; i++) {
        const a = Math.PI - (Math.PI * i) / 24;
        head.lineTo(hw * Math.cos(a), js + d.arch * Math.sin(a));
      }
      head.closePath();
      trim.add(new THREE.ShapeGeometry(head, 1), onWall(f, u, zLeaf));
    }
  }

  /** The surround on the room's face of an opening: jambs, a head and a cornice (an arch: a band round its head). */
  function doorCase(f: WallFrame, op: Opening, js: number) {
    const { door: d, u } = op;
    const hw = d.half;
    const jw = classical ? 0.24 : 0.06;
    const proud = classical ? 0.055 : 0.014;
    for (const s of [-1, 1]) {
      trim.roundedBox(jw, js + (d.arch > 0 ? 0 : jw), proud, ...xyz(at(f, u + s * (hw + jw / 2), (js + (d.arch > 0 ? 0 : jw)) / 2, proud / 2)), 0.008, 1, f.rotY);
      if (classical) trim.roundedBox(jw + 0.05, 0.3, proud + 0.02, ...xyz(at(f, u + s * (hw + jw / 2), 0.15, (proud + 0.02) / 2)), 0.006, 1, f.rotY);
    }
    if (d.arch > 0) {
      const ring = (grow: number, out: number) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = Math.PI - (Math.PI * i) / 32;
          pts.push(V((hw + grow) * Math.cos(a), js + (d.arch + grow) * Math.sin(a), out));
        }
        return new THREE.CatmullRomCurve3(pts);
      };
      trim.add(new THREE.TubeGeometry(ring(jw / 2, 0.01), 48, jw / 2, 8, false), onWall(f, u));
      if (room.gilt) gilt.add(new THREE.TubeGeometry(ring(0.03, 0.045), 48, 0.022, 6, false), onWall(f, u));
      for (const s of [-1, 1]) trim.roundedBox(jw + 0.1, 0.16, proud + 0.04, ...xyz(at(f, u + s * (hw + jw / 2), js - 0.06, (proud + 0.04) / 2)), 0.02, 2, f.rotY);
      return;
    }
    trim.roundedBox(2 * hw, jw, proud, ...xyz(at(f, u, d.height + jw / 2, proud / 2)), 0.008, 1, f.rotY);
    if (classical) {
      trim.roundedBox(2 * hw + 2 * jw + 0.2, 0.08, proud + 0.07, ...xyz(at(f, u, d.height + jw + 0.1, (proud + 0.07) / 2)), 0.012, 2, f.rotY);
      trim.roundedBox(2 * hw + 2 * jw + 0.08, 0.05, proud + 0.03, ...xyz(at(f, u, d.height + jw + 0.03, (proud + 0.03) / 2)), 0.008, 1, f.rotY);
    }
  }

  // ---- free-standing walls: four faces and a top, a capping, and a surround of the room's trim on each long face
  for (const w of plan.partitions) {
    if (w.shell !== index) continue;
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
    const post = 0.34;
    // a portal of stone round it: two posts and a lintel, a little proud of both faces
    for (const s of [-1, 1]) {
      const off = s * (len / 2 - post / 2 + 0.02);
      trim.box(post, h + 0.04, thick + 0.1, alongX ? mx + off : mx, (h + 0.04) / 2, alongX ? mz : mz + off, rot);
    }
    trim.box(len + 0.04, post, thick + 0.1, mx, h - post / 2 + 0.04, mz, rot);
    trim.box(len - 2 * post, 0.12, thick + 0.06, mx, 0.06, mz, rot);
  }

  // ---- columns under an arch across the gallery: a pedestal, a marble shaft, gilt base and capital
  const marbleColor = new THREE.Color(room.marble ?? "#8a7f86");
  const pedestal = room.pedestal;
  for (const c of plan.columns) {
    if (c.shell !== index) continue;
    const y0 = pedestal?.height ?? 0;
    const y1 = c.height;
    if (pedestal) {
      const pc = new THREE.Color(pedestal.color);
      cbox(marble, 3.1 * c.r, y0 - 0.1, 3.1 * c.r, V(c.x, (y0 - 0.1) / 2, c.z), 0, pc);
      cbox(marble, 3.4 * c.r, 0.1, 3.4 * c.r, V(c.x, y0 - 0.05, c.z), 0, pc);
      cbox(marble, 3.4 * c.r, 0.16, 3.4 * c.r, V(c.x, 0.08, c.z), 0, pc);
    }
    const r = c.r;
    const capH = 0.62;
    const shaftTop = y1 - capH;
    gilt.add(new THREE.TorusGeometry(r * 1.14, r * 0.15, 6, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(c.x, y0 + 0.05, c.z));
    gilt.add(new THREE.TorusGeometry(r * 1.05, r * 0.1, 5, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(c.x, y0 + 0.13, c.z));
    marble.add(new THREE.CylinderGeometry(r * 0.86, r, shaftTop - y0 - 0.16, 18, 1, true), new THREE.Matrix4().makeTranslation(c.x, (shaftTop + y0 + 0.16) / 2, c.z), marbleColor);
    gilt.add(new THREE.TorusGeometry(r * 0.9, r * 0.08, 5, 18), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(c.x, shaftTop + 0.02, c.z));
    // a Corinthian capital: a flaring bell, two rings of leaves, an abacus
    gilt.cylinder(r * 1.5, r * 0.88, capH - 0.1, c.x, shaftTop, c.z, 16);
    for (const [ring, lift, size] of [[1.0, 0.25, 0.3], [1.22, 0.55, 0.26]] as const) {
      for (let i = 0; i < 8; i++) {
        const a = ((i + (ring > 1.1 ? 0.5 : 0)) / 8) * Math.PI * 2;
        gilt.add(
          new THREE.SphereGeometry(r * size, 6, 4),
          new THREE.Matrix4().compose(
            V(c.x + Math.cos(a) * r * ring, shaftTop + capH * lift, c.z + Math.sin(a) * r * ring),
            new THREE.Quaternion(),
            V(1, 1.7, 1)
          )
        );
      }
    }
    gilt.roundedBox(3.3 * r, 0.1, 3.3 * r, c.x, y1 - 0.05, c.z, 0.01, 1);
  }

  // ---- the ceiling, in the room's own frame, then set in place
  {
    const local = { ceiling: new GeoBatch(rounded), trim: new GeoBatch(rounded), gilt: new GeoBatch(rounded) };
    const hw = W / 2;
    const r = spec.coveR;
    const b = spec.coveBase;
    const runs = [
      { a: V(-hw, 0, spec.z0), b: V(-hw, 0, spec.z1), n: V(1, 0, 0) },
      { a: V(hw, 0, spec.z0), b: V(hw, 0, spec.z1), n: V(-1, 0, 0) },
      { a: V(-hw, 0, spec.z0), b: V(hw, 0, spec.z0), n: V(0, 0, 1) },
      { a: V(-hw, 0, spec.z1), b: V(hw, 0, spec.z1), n: V(0, 0, -1) },
    ];
    if (r > 0) {
      // a quarter circle, or (a barrel vault cut by its skylight) a quarter ellipse that rises more than it reaches in
      const rise = spec.yCeil - b;
      const round = Math.abs(rise - r) < 0.01;
      const cove: [number, number][] = round
        ? coveProfile(r, b, spec.kind === "vault" ? 20 : 8)
        : Array.from({ length: 25 }, (_, i) => {
            const a = (i / 24) * (Math.PI / 2);
            return [r - r * Math.cos(a), b + rise * Math.sin(a)] as [number, number];
          });
      const bed: [number, number][] = [[0, b - 0.07], [0.025, b - 0.07], [0.032, b - 0.055], [0.032, b - 0.035], [0.045, b - 0.02], [0.045, b], [0, b + 0.001]];
      for (const q of runs) {
        local.ceiling.sweep(cove, q.a, q.b, q.n, 50);
        if (spec.kind === "vault") {
          (room.giltCornice ? local.gilt : local.trim).sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, b + hh] as [number, number]), q.a, q.b, q.n);
          if (room.gilt && !room.giltCornice) local.gilt.sweep(GILT_BEAD.map(([dd, hh]) => [dd, b - 0.2 + hh] as [number, number]), q.a, q.b, q.n);
        } else local.ceiling.sweep(bed, q.a, q.b, q.n);
      }
      if (spec.kind === "vault" && room.gilt && round && !frieze) vaultRibs(local.gilt, spec, W);
    } else {
      // a flat ceiling meets the wall at a slim cornice
      for (const q of runs) local.trim.sweep([[0, H - 0.16], [0.05, H - 0.16], [0.09, H - 0.06], [0.09, H], [0, H + 0.001]], q.a, q.b, q.n);
    }
    const yC = spec.yCeil;
    const wx = spec.wellX;
    const face = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 1e-4 || bz - az < 1e-4) return;
      local.ceiling.quad(V(ax, yC, az), V(bx - ax, 0, 0), V(0, 0, bz - az), [ax, az]);
    };
    face(-hw + r, -wx, spec.z0 + r, spec.z1 - r);
    face(wx, hw - r, spec.z0 + r, spec.z1 - r);
    face(-wx, wx, spec.z0 + r, spec.wellZ0);
    face(-wx, wx, spec.wellZ1, spec.z1 - r);
    const dy = spec.yGlass - yC;
    local.ceiling.quad(V(-wx, yC, spec.wellZ1), V(0, 0, spec.wellZ0 - spec.wellZ1), V(0, dy, 0));
    local.ceiling.quad(V(wx, yC, spec.wellZ0), V(0, 0, spec.wellZ1 - spec.wellZ0), V(0, dy, 0));
    local.ceiling.quad(V(-wx, yC, spec.wellZ0), V(2 * wx, 0, 0), V(0, dy, 0));
    local.ceiling.quad(V(wx, yC, spec.wellZ1), V(-2 * wx, 0, 0), V(0, dy, 0));
    // a moulded frame round the glass (gilt in a gilded room), beams between its bays
    const fw = spec.kind === "lightbox" ? 0.06 : 0.14;
    const fd = spec.kind === "lightbox" ? 0.03 : 0.09;
    // (gilt where the cornice is: a gilded salon's)
    const edge = room.giltCornice ? local.gilt : spec.kind === "lightbox" ? local.trim : local.ceiling;
    for (const s of [-1, 1]) {
      edge.roundedBox(fw, fd, spec.wellZ1 - spec.wellZ0 + 2 * fw, s * (wx + fw / 2), yC - fd / 2 + 0.002, (spec.wellZ0 + spec.wellZ1) / 2, 0.012, 2);
      edge.roundedBox(2 * wx, fd, fw, 0, yC - fd / 2 + 0.002, s < 0 ? spec.wellZ0 - fw / 2 : spec.wellZ1 + fw / 2, 0.012, 2);
    }
    if (spec.beamW > 0) {
      const beams = room.giltCornice ? local.gilt : local.ceiling;
      for (let i = 1; i < spec.bays.length; i++) beams.box(2 * wx, spec.beamDepth, spec.beamW, 0, spec.yGlass - spec.beamDepth / 2, spec.bays[i].z0);
    }
    for (const [from, to] of [[local.ceiling, ceiling], [local.trim, trim], [local.gilt, gilt]] as const) {
      if (from.empty) continue;
      to.add(from.build(false), toWorld.clone());
    }

    // ---- arches across the gallery (the Grande Galerie's): over each pair of columns an entablature, from
    // which the arch springs; its two faces fill the vault above it, a lower barrel runs between them
    const stone = new THREE.Color(room.archStone ?? room.frieze?.color ?? "#a8a6a2");
    const localMarble = new GeoBatch(rounded);
    const localTrim = new GeoBatch(rounded);
    const localGilt = new GeoBatch(rounded);
    for (const arch of plan.arches) {
      if (arch.shell !== index) continue;
      const lz = arch.at - (sh.alongX ? cx : cz);
      const { half: a, spring: y0, rise: ar, depth: dz } = arch;
      const ent = 0.9;
      // the vault's section above the springing, less the arch
      const face = new THREE.Shape();
      const rise = spec.yCeil - b;
      face.moveTo(-hw, y0);
      if (H > y0) face.lineTo(-hw, H);
      for (let i = 1; i <= 16; i++) {
        const t = (i / 16) * (Math.PI / 2);
        face.lineTo(-hw + r - r * Math.cos(t), b + rise * Math.sin(t));
      }
      for (let i = 15; i >= 0; i--) {
        const t = (i / 16) * (Math.PI / 2);
        face.lineTo(hw - r + r * Math.cos(t), b + rise * Math.sin(t));
      }
      if (H > y0) face.lineTo(hw, y0);
      face.lineTo(a, y0);
      for (let i = 1; i <= 32; i++) {
        const t = (Math.PI * i) / 32;
        face.lineTo(a * Math.cos(t), y0 + ar * Math.sin(t));
      }
      face.closePath();
      localMarble.add(new THREE.ShapeGeometry(face, 1), new THREE.Matrix4().makeTranslation(0, 0, lz + dz));
      localMarble.add(new THREE.ShapeGeometry(face, 1), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, lz - dz));
      localMarble.add(archSoffit(a, y0, ar, lz - dz, lz + dz));
      // a moulded band round the arch on each face, a gilt bead inside it
      for (const s of [-1, 1]) {
        const ring = (grow: number, out: number) => {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 32; i++) {
            const t = Math.PI - (Math.PI * i) / 32;
            pts.push(V((a + grow) * Math.cos(t), y0 + (ar + grow) * Math.sin(t), lz + s * (dz + out)));
          }
          return new THREE.CatmullRomCurve3(pts);
        };
        localTrim.add(new THREE.TubeGeometry(ring(0.16, 0.0), 32, 0.16, 6, false));
        localTrim.add(new THREE.TubeGeometry(ring(0.62, 0.0), 32, 0.07, 5, false));
        if (room.gilt) localGilt.add(new THREE.TubeGeometry(ring(0.36, 0.05), 32, 0.03, 4, false));
      }
      // the entablatures: from the wall out over the columns, the length of the arch
      for (const s of [-1, 1]) {
        const x0 = s * hw;
        const x1 = s * a;
        const mid = (x0 + x1) / 2;
        const wide = Math.abs(x1 - x0);
        localMarble.add(new THREE.BoxGeometry(wide, ent - 0.24, 2 * dz), new THREE.Matrix4().makeTranslation(mid, y0 - ent / 2, lz));
        for (const y of [y0 - 0.06, y0 - ent + 0.06]) {
          localTrim.box(wide + 0.1, 0.12, 2 * dz + 0.16, mid - s * 0.05, y, lz);
        }
        if (room.gilt) localGilt.box(wide + 0.14, 0.03, 2 * dz + 0.2, mid - s * 0.07, y0 - 0.14, lz);
        // the coffered underside between the columns and the wall
        localTrim.box(wide - 0.3, 0.04, 2 * dz - 0.5, mid, y0 - ent - 0.02, lz);
      }
    }
    if (!localMarble.empty) marble.add(localMarble.build(false), toWorld.clone(), stone);
    if (!localTrim.empty) trim.add(localTrim.build(false), toWorld.clone());
    if (!localGilt.empty) gilt.add(localGilt.build(false), toWorld.clone());
  }

  // ---- the glass: one quad per bay, facing down
  const glass = new GeoBatch();
  {
    const halfBeam = spec.beamW / 2;
    spec.bays.forEach((bay, i) => {
      const z0 = bay.z0 + (i === 0 ? 0 : halfBeam);
      const z1 = bay.z1 - (i === spec.bays.length - 1 ? 0 : halfBeam);
      const g = new THREE.BufferGeometry();
      const y = spec.yGlass;
      g.setAttribute("position", new THREE.Float32BufferAttribute([-spec.wellX, y, z0, spec.wellX, y, z0, spec.wellX, y, z1, -spec.wellX, y, z1], 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      glass.add(g, toWorld.clone());
    });
  }

  // ---- rope barriers before the most famous works
  const rope = new THREE.Color("#6e1418");
  for (const bar of layout.barriers) {
    if (plan.zones[bar.room]?.shell !== index) continue;
    bar.posts.forEach(([x, z], i) => {
      gilt.cylinder(0.16, 0.17, 0.035, x, 0, z, 24);
      gilt.cylinder(0.02, 0.026, 0.9, x, 0.035, z, 12);
      gilt.add(new THREE.SphereGeometry(0.04, 12, 8), new THREE.Matrix4().makeTranslation(x, 0.95, z));
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
    benchSeat: seat.build(),
    benchFrame: frame.build(),
    benchAccent: accent.build(),
    benchShadow,
    floor: floor.build(),
    glass: glass.build(),
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

export const SHELL_PARTS = ["walls", "ceiling", "trim", "gilt", "marble", "benchSeat", "benchFrame", "benchAccent", "benchShadow", "floor", "glass"] as const;

export function disposeShell(s: ShellGeometry): void {
  for (const k of SHELL_PARTS) s[k].dispose();
}

/** Where a room's spots hang: by the edge of a vault's skylight or on a flat ceiling (no rails below it), else on
 *  the usual track. */
export function shellRail(sh: Pick<PlanShell, "x0" | "x1" | "z0" | "z1" | "height" | "alongX">, theme: GalleryTheme): { inset: number; y: number } {
  const W = sh.alongX ? sh.z1 - sh.z0 : sh.x1 - sh.x0;
  const L = sh.alongX ? sh.x1 - sh.x0 : sh.z1 - sh.z0;
  const spec = roomCeilingSpec(W, sh.height, -L / 2, L / 2, theme, TRACK_INSET);
  if (!theme.room.noTrack) return { inset: TRACK_INSET, y: sh.height - 0.32 };
  if (spec.kind === "vault") return { inset: Math.min(W / 2 - 0.4, spec.coveR + 0.2), y: spec.yCeil - 0.05 };
  return { inset: Math.min(W / 2 - 0.4, Math.max(1.8, sh.height * 0.3)), y: sh.height - 0.05 };
}
