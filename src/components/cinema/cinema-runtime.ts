// What every part of the cinema reads each frame: the deck, and the light it makes, eased like a real room's
// (the house lights dim over a few seconds when a film starts; the lamp comes on at once).

import * as THREE from "three";
import type { FilmDeck } from "./film-deck";
import { pictureRect } from "./cinema-layout";

export interface CinemaRuntime {
  deck: FilmDeck;
  /** The projector's lamp, 0..1. */
  level: number;
  /** The house lights, 0..1. */
  house: number;
  /** The picture's place on the screen (metres). */
  rect: { w: number; h: number; cx: number; cy: number };
  /** The light the screen throws back into the room (linear RGB) and how bright it is. */
  color: THREE.Color;
  lum: number;
  /** Projected (the beam and the dust carry the picture) or embedded (a neutral flicker). */
  textured: boolean;
  /** The reels' turn this frame (radians). */
  reel: number;
  time: number;
}

export function createRuntime(deck: FilmDeck): CinemaRuntime {
  return {
    deck, level: 0, house: 1, rect: pictureRect(16 / 9), color: new THREE.Color(0, 0, 0), lum: 0,
    textured: false, reel: 0, time: 0,
  };
}

const HOUSE_DOWN = 0.05;
const HOUSE_PAUSED = 0.4;
const _neutral = new THREE.Color();

/** Advance the room's light by dt seconds from the deck's state. */
export function stepRuntime(rt: CinemaRuntime, dt: number, now: number): void {
  const { status, film, mode } = rt.deck.state;
  rt.time += dt;
  const lampOn = film !== null && (status === "playing" || status === "paused" || status === "loading");
  const houseTarget = status === "playing" ? HOUSE_DOWN : status === "paused" || status === "loading" ? HOUSE_PAUSED : 1;
  // the dimmer: about 3 s down, 2 s up
  const kh = 1 - Math.exp(-dt / (houseTarget < rt.house ? 1.1 : 0.7));
  rt.house += (houseTarget - rt.house) * kh;
  const kl = 1 - Math.exp(-dt / 0.18);
  rt.level += ((lampOn ? 1 : 0) - rt.level) * kl;
  rt.textured = mode === "texture";
  if (film) {
    // a projected film's own shape once its first frame is known (4:3 television, 16:9); a player is 16:9
    const v = rt.deck.video;
    const natural = v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0;
    const aspect = mode === "texture" ? natural || film.aspect || 16 / 9 : 16 / 9;
    if (Math.abs(rt.rect.w / rt.rect.h - aspect) > 0.01) rt.rect = pictureRect(aspect);
  }
  if (rt.textured) {
    rt.deck.sample(now);
    // the sampled colour, eased a little (a cut changes the room at once, but not in one frame)
    const k = 1 - Math.exp(-dt / 0.08);
    rt.color.lerp(rt.deck.light, k);
    rt.lum += (rt.deck.lum - rt.lum) * k;
  } else if (film && status === "playing") {
    // an embedded player's picture cannot be read: a cool, gently changing light with the odd cut
    const t = rt.time;
    const cut = Math.floor(t / 3.7) + Math.floor(t / 5.3);
    const shot = 0.5 + 0.5 * Math.sin(cut * 12.9898);
    const flicker = 0.9 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const v = (0.28 + 0.32 * shot) * flicker;
    _neutral.setRGB(v * 0.92, v * 0.95, v);
    rt.color.lerp(_neutral, 1 - Math.exp(-dt / 0.12));
    rt.lum = rt.color.g;
  } else {
    // a paused embed, the leader before a projected film's first frame: the lamp's own white
    const w = status === "paused" || status === "loading" ? 0.35 : 0;
    _neutral.setRGB(w, w, w * 0.97);
    rt.color.lerp(_neutral, 1 - Math.exp(-dt / 0.2));
    rt.lum = rt.color.g;
  }
  if (status === "playing") rt.reel += dt * 2.4;
}
