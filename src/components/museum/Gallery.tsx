"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { ArtistWithPaintings } from "@/lib/types";
import type { GalleryLayout, Placement } from "./layout";
import { PaintingExhibit } from "./PaintingExhibit";
import { EnvSetup, Lighting, Room } from "./Room";
import { EntryDolly, InspectCamera, Player } from "./Controls";

export interface GalleryProps {
  artist: ArtistWithPaintings;
  layout: GalleryLayout;
  inspect: Placement | null;
  onSelect: (pl: Placement) => void;
  onAim: (aimed: boolean) => void;
  onLockChange: (locked: boolean) => void;
  walkEnabled: boolean;
  entering: boolean;
}

export function Gallery(props: GalleryProps) {
  const { artist, layout } = props;
  const meshRegistry = useRef(new Map<string, THREE.Mesh>());

  return (
    <>
      <EnvSetup />
      <Lighting layout={layout} focused={!!props.inspect} />
      <Room layout={layout} />
      {layout.placements.map((pl, i) => (
        <PaintingExhibit
          key={pl.painting.slug}
          placement={pl}
          artistName={artist.name}
          focusSlug={props.inspect?.painting.slug ?? null}
          registry={meshRegistry.current}
          // Each shadow map costs a texture unit in every shader (and the
          // rect-area light's LTC tables take two more); GPUs commonly cap
          // fragment samplers at 16, so only 6 spots get real shadows.
          castShadows={i < 6}
        />
      ))}
      <Player {...props} registry={meshRegistry.current} />
      <InspectCamera inspect={props.inspect} layout={layout} />
      <EntryDolly entering={props.entering} layout={layout} />
    </>
  );
}
