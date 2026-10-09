// The phases of an artist's life their gallery follows (data/site/phases.json, archive/phases.py): from WikiArt's
// per-painting periods, e.g. Picasso's Blue and Rose periods. Each work takes the index of its phase.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ArtistPhase, ArtistWithPaintings } from "./types";

interface PhaseFile {
  artists: Record<string, { phases: ArtistPhase[]; works: Record<string, number> }>;
}

let data: PhaseFile | null | undefined;
function read(): PhaseFile | null {
  if (data !== undefined) return data;
  const file = path.join(process.cwd(), "data", "site", "phases.json");
  data = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as PhaseFile) : null;
  return data;
}

/** The artist with their phases and each work's phase; unchanged when none are known. */
export function withPhases(artist: ArtistWithPaintings): ArtistWithPaintings {
  const a = read()?.artists[artist.slug];
  if (!a) return artist;
  return {
    ...artist,
    phases: a.phases,
    paintings: artist.paintings.map((p) => (a.works[p.slug] != null ? { ...p, phase: a.works[p.slug] } : p)),
  };
}
