"use client";

// The rooms of a real building's plan (plan-layout.ts): each room its own architecture and materials (one room
// red under a gilt cove, the next midnight blue under glass), drawn for the rooms around the visitor; their
// floors, sharing one reflection; and their ceilings' glass with the area lights that are its light, which
// follow the visitor from bay to bay as a suite's do from room to room.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import type { SuiteRuntime } from "./suite-runtime";
import { buildShell, disposeShell, type ShellGeometry } from "./plan-geometry";
import { createRoomMaterials } from "./Room";
import { crossWalls } from "./room-shading";
import { PlanFloors, type FloorPiece } from "./room-floor";
import { ENV_INTENSITY, roomDimmers, roomState } from "./room-env";
import { laylightTexture, subscribeProceduralTextures } from "./textures";

/** Environment strength while a painting is focused (dim = 0) vs at rest (1), as Room.tsx's. */
const envDimFactor = (dim: number) => 0.3 + 0.7 * dim;

/** The glass a suite's room has, more or less (m2): a room with more gives less light per square metre. */
const GLASS_AREA = 80;

/** How bright a room's glass is as a light, by its ceiling (Room.tsx Lighting). */
const areaLevel = (t: GalleryTheme) => t.room.daylightLevel * (t.room.ceiling === "lightbox" ? 1.25 : t.room.ceiling === "vault" ? 1.15 : 1.0);

export function PlanRooms({
  layout,
  themes,
  runtime,
  focused,
}: {
  layout: GalleryLayout;
  /** Each room's theme, by its place in the plan. */
  themes: GalleryTheme[];
  runtime: SuiteRuntime;
  /** A painting is being inspected: the rooms dim. */
  focused: boolean;
}) {
  const plan = layout.plan!;
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  const shells = useMemo(() => plan.shells.map((_, i) => buildShell(layout, i, themes[i])), [layout, plan, themes]);
  useEffect(() => () => shells.forEach(disposeShell), [shells]);

  const rooms = useMemo(
    () =>
      shells.map((g: ShellGeometry, i) => {
        const frame = new THREE.Vector4(g.cx, g.cz, Math.cos(g.turn), Math.sin(g.turn));
        const cross = crossWalls({ doorways: [], rooms: [], hallWidth: 2 * g.half.x, nook: null });
        const mats = createRoomMaterials(themes[i], g.half, cross, frame);
        const t = themes[i];
        const glassBase = new THREE.Color(t.room.daylight).multiplyScalar(t.room.daylightLevel);
        const glassMap = laylightTexture(g.spec.panes[0], g.spec.panes[1]);
        const glass = new THREE.MeshBasicMaterial({ color: glassBase.clone(), map: glassMap });
        return { frame, mats, glass, glassBase, glassMap };
      }),
    [shells, themes]
  );
  useEffect(() => {
    rooms.forEach((r) => r.mats.dimmers.forEach((d) => roomDimmers.add(d)));
    return () => {
      rooms.forEach((r) => {
        r.mats.dimmers.forEach((d) => roomDimmers.delete(d));
        r.mats.dispose();
        r.glass.dispose();
        r.glassMap.dispose();
      });
    };
  }, [rooms]);
  useEffect(() => subscribeProceduralTextures(() => invalidate()), [invalidate]);

  // the rooms around the visitor
  const [shown, setShown] = useState(() => runtime.shellsShown());
  useEffect(() => {
    const apply = () => {
      setShown(runtime.shellsShown());
      invalidate();
    };
    apply();
    return runtime.onWindowChange(apply);
  }, [runtime, invalidate]);

  const floors = useMemo<FloorPiece[]>(
    () =>
      shells.map((g, i) => ({
        geometry: g.floor,
        theme: themes[i],
        grain: rooms[i].mats.floorGrain ?? undefined,
        frame: rooms[i].frame,
        half: g.half,
      })),
    [shells, themes, rooms]
  );

  // ---- the glass's light: a pool of area lights over the bays nearest the visitor; all dim while a work is
  // inspected (with the environment and the ceilings' own glow)
  const areas = useRef<(THREE.RectAreaLight | null)[]>([]);
  const level = useRef(roomState.dim);
  const placeAreas = (k: number) => {
    runtime.areaSlots.forEach((slot, i) => {
      const a = areas.current[i];
      const zone = plan.zones[slot.room];
      if (!a || !zone) return;
      const sh = plan.shells[zone.shell];
      const g = shells[zone.shell];
      const t = themes[zone.shell];
      // over the bay's stretch of glass: the glass runs down the room's long axis
      const wx = g.spec.wellX;
      const along = sh.alongX ? zone.x1 - zone.x0 : zone.z1 - zone.z0;
      const x = (zone.x0 + zone.x1) / 2;
      const z = (zone.z0 + zone.z1) / 2;
      if (a.position.x !== x || a.position.z !== z) {
        a.position.set(x, g.spec.yGlass - 0.04, z);
        a.width = sh.alongX ? along : 2 * wx;
        a.height = sh.alongX ? 2 * wx : along;
        a.color.set(t.room.daylight);
      }
      const f = slot.level >= 1 ? 1 : slot.level * slot.level * (3 - 2 * slot.level);
      // a great skylight is no brighter a sky: the wider the glass, the less each square metre of it gives (the
      // eye, and a camera's exposure, settle to the room)
      const wide = Math.min(1, Math.pow(GLASS_AREA / (a.width * a.height), 0.75));
      a.intensity = areaLevel(t) * wide * (0.1 + 0.9 * k) * f;
    });
  };
  const apply = (k: number) => {
    placeAreas(k);
    rooms.forEach((r) => r.glass.color.copy(r.glassBase).multiplyScalar(0.22 + 0.78 * k));
    scene.environmentIntensity = ENV_INTENSITY * envDimFactor(k);
    roomDimmers.forEach((d) => d.uniform.value.copy(d.base).multiplyScalar(0.25 + 0.75 * k));
    roomState.dim = k;
  };
  useEffect(() => {
    invalidate();
  }, [focused, invalidate]);
  useEffect(
    () => () => {
      roomState.dim = 1;
      const lib = THREE.UniformsLib as unknown as Record<string, THREE.Texture | undefined>;
      for (const k of ["LTC_FLOAT_1", "LTC_FLOAT_2", "LTC_HALF_1", "LTC_HALF_2"]) lib[k]?.dispose();
    },
    []
  );
  useFrame((state, dt) => {
    const target = focused ? 0 : 1;
    const cur = level.current;
    if (Math.abs(cur - target) < 0.001) {
      if (cur !== target) {
        level.current = target;
        apply(target);
      } else placeAreas(cur);
      return;
    }
    level.current = THREE.MathUtils.damp(cur, target, 4, Math.min(dt, 0.1));
    apply(level.current);
    state.invalidate();
  });

  return (
    <group>
      <PlanFloors pieces={floors} shown={shown} />
      {shells.map((g, i) => {
        const m = rooms[i].mats;
        return (
          <group key={plan.shells[i].id} visible={shown[i] ?? true}>
            <mesh geometry={g.walls} material={m.wall} matrixAutoUpdate={false} />
            <mesh geometry={g.ceiling} material={m.ceiling} matrixAutoUpdate={false} />
            <mesh geometry={g.trim} material={m.trim} matrixAutoUpdate={false} />
            <mesh geometry={g.gilt} material={m.gilt} matrixAutoUpdate={false} />
            <mesh geometry={g.marble} material={m.marble} matrixAutoUpdate={false} />
            <mesh geometry={g.benchSeat} material={m.benchSeat} matrixAutoUpdate={false} />
            <mesh geometry={g.benchFrame} material={m.benchFrame} matrixAutoUpdate={false} />
            <mesh geometry={g.benchAccent} material={m.benchAccent} matrixAutoUpdate={false} />
            <mesh geometry={g.benchShadow} material={m.benchShadow} matrixAutoUpdate={false} layers={1} renderOrder={1} />
            <mesh geometry={g.glass} material={rooms[i].glass} matrixAutoUpdate={false} />
          </group>
        );
      })}
      {runtime.areaSlots.map((_, i) => (
        <rectAreaLight
          key={i}
          ref={(el: THREE.RectAreaLight | null) => {
            areas.current[i] = el;
          }}
          args={["#ffffff", 0, 4, 4]}
          position={[0, 8, 0]}
          rotation-x={-Math.PI / 2}
        />
      ))}
    </group>
  );
}
