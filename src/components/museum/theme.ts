// Period-appropriate curation for each artist's gallery. Real museums don't
// hang a Pollock in a gilded Baroque frame on cream plaster: Old Masters get
// saturated silk-damask walls under a laylight, the 19th century deep greens
// and greys, early modernism off-white rooms with plain wood frames, and
// post-war work the white cube with unframed canvases on polished concrete.

export type EraKey =
  | "sacred"
  | "old-master"
  | "northern"
  | "eighteenth"
  | "nineteenth"
  | "victorian"
  | "impressionist"
  | "secession"
  | "early-modern"
  | "postwar";

/**
 * tabernacle — wide flat gilded frame with a raised outer bead (pre-1500)
 * baroque     — deep carved gilt: outer bead, cove, ogee, sight-edge lip
 * gilt-simple — slimmer 19th-century gilt moulding
 * wood        — plain hardwood moulding, no gilding
 * floater     — no frame: canvas edge visible with a dark shadow-gap tray
 */
export type FrameStyle = "tabernacle" | "baroque" | "gilt-simple" | "wood" | "floater";

export type FloorKind = "oak-dark" | "oak-light" | "concrete";

/**
 * laylight — 19th-century top-lit gallery: coved cornice, flat ceiling band
 *            and a recessed well of frosted glass panes between beams.
 * lightbox — modern flat white ceiling with one long recessed diffuser.
 */
export type CeilingKind = "laylight" | "lightbox";

/**
 * plaster — lime plaster / distemper with a visible trowel texture
 * damask  — silk damask wall covering (figure reads through sheen)
 * paint   — smooth modern emulsion on board
 */
export type WallFinish = "plaster" | "damask" | "paint";

export type BenchStyle = "leather" | "modern-leather" | "oak-block";

/** Architectural details of the room (owned by Room.tsx). */
export interface RoomStyle {
  ceiling: CeilingKind;
  wallFinish: WallFinish;
  /** Classical mouldings: coved cornice, moulded skirting, panelled doors.
   *  Off = white-cube detailing (shadow-gap skirting, flush doors). */
  classical: boolean;
  /** Moulded picture rail below the cornice. */
  pictureRail: boolean;
  /** Daylight colour of the laylight / lightbox glass and its area light. */
  daylight: string;
  /** Radiance of the ceiling glass (and intensity of the matching area light). */
  daylightLevel: number;
  /** Lighting-track rail colour. */
  track: string;
  bench: BenchStyle;
  benchSeat: string;
  benchFrame: string;
  /** Floor finish roughness (lower = glossier, stronger reflections). */
  floorRoughness: number;
  /** Board width in metres (wood floors) / slab size (concrete). */
  plankWidth: number;
  /** Track-mounted wall-washer level (modern rooms; 0 = the laylight does it). */
  wallWash: number;
}

export interface GalleryTheme {
  era: EraKey;
  /** Wall paint (sRGB hex) and how matte it is. */
  wall: { color: string; roughness: number };
  /** Baseboard / picture-rail / door trim. */
  trim: string;
  ceiling: string;
  floor: { kind: FloorKind; tint: string };
  frame: {
    style: FrameStyle;
    color: string; // gilt / wood / tray base colour
    metalness: number;
    roughness: number;
    /** Frame moulding width in metres (0 for floater: tray reveal only). */
    width: number;
  };
  /** Gallery lighting: spot colour temperature as sRGB hex. */
  light: { spot: string; ambient: string };
  room: RoomStyle;
}

const THEMES: Record<EraKey, GalleryTheme> = {
  // Early Italian gold grounds: cool stone-grey walls with pietra serena
  // trim, as in the National Gallery's Sainsbury Wing.
  sacred: {
    era: "sacred",
    wall: { color: "#5d6a70", roughness: 0.95 },
    trim: "#4d504f",
    ceiling: "#e2ddd2",
    floor: { kind: "oak-dark", tint: "#7a5e44" },
    frame: { style: "tabernacle", color: "#d4a94f", metalness: 1, roughness: 0.32, width: 0.12 },
    light: { spot: "#ffd7a3", ambient: "#e8dcc4" },
    room: {
      ceiling: "laylight",
      wallFinish: "plaster",
      classical: true,
      pictureRail: false,
      daylight: "#fff4e4",
      daylightLevel: 1.6,
      track: "#1d1c1a",
      bench: "leather",
      benchSeat: "#3a2a20",
      benchFrame: "#2e2219",
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // Baroque: crimson silk damask, dark oak, carved gilt — Galleria Borghese,
  // the National Gallery's Rubens and Caravaggio rooms.
  "old-master": {
    era: "old-master",
    wall: { color: "#6b2a26", roughness: 0.93 },
    trim: "#2e1d16",
    ceiling: "#e8dfcf",
    floor: { kind: "oak-dark", tint: "#73563c" },
    frame: { style: "baroque", color: "#d1a04a", metalness: 1, roughness: 0.3, width: 0.13 },
    light: { spot: "#ffd9a8", ambient: "#efe2c9" },
    room: {
      ceiling: "laylight",
      wallFinish: "damask",
      classical: true,
      pictureRail: true,
      daylight: "#fff2e0",
      daylightLevel: 1.6,
      track: "#1d1b18",
      bench: "leather",
      benchSeat: "#3b2219",
      benchFrame: "#2a1a12",
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // Dutch Golden Age: the Rijksmuseum's slate-blue galleries and the black
  // ebonised mouldings Rembrandt's and Vermeer's contemporaries framed in.
  northern: {
    era: "northern",
    wall: { color: "#3e4951", roughness: 0.94 },
    trim: "#252a2d",
    ceiling: "#e4e0d8",
    floor: { kind: "oak-dark", tint: "#6a523a" },
    frame: { style: "wood", color: "#15110e", metalness: 0, roughness: 0.32, width: 0.1 },
    light: { spot: "#ffdcb0", ambient: "#e9e2d4" },
    room: {
      ceiling: "laylight",
      wallFinish: "plaster",
      classical: true,
      pictureRail: true,
      daylight: "#f7f3ec",
      daylightLevel: 1.6,
      track: "#1b1c1d",
      bench: "leather",
      benchSeat: "#2a2522",
      benchFrame: "#1d1916",
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // 18th century: sage-green silk and cream boiserie trim (Wallace Collection).
  eighteenth: {
    era: "eighteenth",
    wall: { color: "#7f8f7a", roughness: 0.92 },
    trim: "#e4ddcd",
    ceiling: "#f1ebdf",
    floor: { kind: "oak-dark", tint: "#8a6a48" },
    frame: { style: "baroque", color: "#ddb35e", metalness: 1, roughness: 0.28, width: 0.11 },
    light: { spot: "#ffdcb0", ambient: "#f1e7d2" },
    room: {
      ceiling: "laylight",
      wallFinish: "damask",
      classical: true,
      pictureRail: true,
      daylight: "#fff4e6",
      daylightLevel: 1.6,
      track: "#1d1c1a",
      bench: "leather",
      benchSeat: "#4c3a2a",
      benchFrame: "#e0d8c6",
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // 19th century: deep green distemper (Alte Nationalgalerie's Friedrich room).
  nineteenth: {
    era: "nineteenth",
    wall: { color: "#34503f", roughness: 0.93 },
    trim: "#1f2420",
    ceiling: "#e3ddd0",
    floor: { kind: "oak-dark", tint: "#6e5238" },
    frame: { style: "gilt-simple", color: "#cfa456", metalness: 1, roughness: 0.33, width: 0.1 },
    light: { spot: "#ffdcb0", ambient: "#ebe2cf" },
    room: {
      ceiling: "laylight",
      wallFinish: "plaster",
      classical: true,
      pictureRail: true,
      daylight: "#fff5e8",
      daylightLevel: 1.6,
      track: "#1d1c1a",
      bench: "leather",
      benchSeat: "#2f2a22",
      benchFrame: "#241c15",
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // Victorian: peacock-blue silk and carved gilt — the Aesthetic interiors
  // (Leighton House) the Pre-Raphaelites and Salon painters were hung in.
  victorian: {
    era: "victorian",
    wall: { color: "#26474f", roughness: 0.92 },
    trim: "#1c2224",
    ceiling: "#e6e0d3",
    floor: { kind: "oak-dark", tint: "#6c4f36" },
    frame: { style: "baroque", color: "#d6ad5c", metalness: 1, roughness: 0.3, width: 0.12 },
    light: { spot: "#ffdab0", ambient: "#ebe2cf" },
    room: {
      ceiling: "laylight",
      wallFinish: "damask",
      classical: true,
      pictureRail: true,
      daylight: "#fff4e6",
      daylightLevel: 1.6,
      track: "#1d1c1a",
      bench: "leather",
      benchSeat: "#3a2a24",
      benchFrame: "#241a14",
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // Impressionists: Orsay-style warm grey under a glazed skylight, pale oak.
  impressionist: {
    era: "impressionist",
    wall: { color: "#8c8a85", roughness: 0.92 },
    trim: "#3b3936",
    ceiling: "#ece8df",
    floor: { kind: "oak-light", tint: "#b8996f" },
    frame: { style: "gilt-simple", color: "#d8b46a", metalness: 1, roughness: 0.36, width: 0.085 },
    light: { spot: "#ffe2bf", ambient: "#efe9dc" },
    room: {
      ceiling: "laylight",
      wallFinish: "plaster",
      classical: true,
      pictureRail: false,
      daylight: "#f8f6f0",
      daylightLevel: 1.7,
      track: "#1d1c1a",
      bench: "leather",
      benchSeat: "#3a3632",
      benchFrame: "#5a4632",
      floorRoughness: 0.34,
      plankWidth: 0.2,
      wallWash: 0,
    },
  },
  // Vienna Secession: deep charcoal walls so the gold reads (the Belvedere's
  // Klimt room), flat gilt frames, gilded bands for trim.
  secession: {
    era: "secession",
    wall: { color: "#2f2d2b", roughness: 0.9 },
    trim: "#a8864a",
    ceiling: "#ecebe7",
    floor: { kind: "oak-light", tint: "#a58a66" },
    frame: { style: "tabernacle", color: "#d9b25a", metalness: 1, roughness: 0.3, width: 0.08 },
    light: { spot: "#ffe0b8", ambient: "#ece6da" },
    room: {
      ceiling: "laylight",
      wallFinish: "paint",
      classical: false,
      pictureRail: true,
      daylight: "#f8f6f0",
      daylightLevel: 1.6,
      track: "#1d1c1a",
      bench: "modern-leather",
      benchSeat: "#1c1a18",
      benchFrame: "#a8864a",
      floorRoughness: 0.32,
      plankWidth: 0.2,
      wallWash: 0,
    },
  },
  // Early modernism: off-white walls, pale oak boards, flat ceiling (MoMA, Whitney).
  "early-modern": {
    era: "early-modern",
    wall: { color: "#e8e4dc", roughness: 0.9 },
    trim: "#cfc8bb",
    ceiling: "#f2f0eb",
    floor: { kind: "oak-light", tint: "#c9ad85" },
    frame: { style: "wood", color: "#3b2a1d", metalness: 0, roughness: 0.55, width: 0.05 },
    light: { spot: "#ffe8cc", ambient: "#f2eee6" },
    room: {
      ceiling: "lightbox",
      wallFinish: "paint",
      classical: false,
      pictureRail: false,
      daylight: "#f6f5f2",
      daylightLevel: 1.5,
      track: "#232323",
      bench: "modern-leather",
      benchSeat: "#1e1c1a",
      benchFrame: "#b9bcbf",
      floorRoughness: 0.36,
      plankWidth: 0.24,
      wallWash: 0.26,
    },
  },
  // Post-war: the white cube — polished concrete, unframed canvases.
  postwar: {
    era: "postwar",
    wall: { color: "#f2f1ee", roughness: 0.9 },
    trim: "#e6e4df",
    ceiling: "#f5f5f3",
    floor: { kind: "concrete", tint: "#a9a6a0" },
    frame: { style: "floater", color: "#1d1c1b", metalness: 0, roughness: 0.6, width: 0 },
    light: { spot: "#fff0dc", ambient: "#f4f2ee" },
    room: {
      ceiling: "lightbox",
      wallFinish: "paint",
      classical: false,
      pictureRail: false,
      daylight: "#f4f6f8",
      daylightLevel: 1.5,
      track: "#e8e7e4",
      bench: "oak-block",
      benchSeat: "#b49a78",
      benchFrame: "#a58b69",
      floorRoughness: 0.28,
      plankWidth: 3.0,
      wallWash: 0.28,
    },
  },
};

const ERA_BY_PERIOD: Record<string, EraKey> = {
  "medieval-gothic": "sacred",
  "early-renaissance": "sacred",
  "northern-renaissance": "sacred",
  "high-renaissance": "old-master",
  mannerism: "old-master",
  baroque: "old-master",
  "dutch-golden-age": "northern",
  rococo: "eighteenth",
  neoclassicism: "eighteenth",
  romanticism: "nineteenth",
  "hudson-river-school": "nineteenth",
  "academic-art": "victorian",
  realism: "nineteenth",
  "pre-raphaelites": "victorian",
  impressionism: "impressionist",
  "post-impressionism": "impressionist",
  symbolism: "secession",
  fauvism: "early-modern",
  expressionism: "early-modern",
  cubism: "early-modern",
  "abstract-art": "early-modern",
  surrealism: "early-modern",
  "american-modernism": "early-modern",
  "abstract-expressionism": "postwar",
  "pop-art": "postwar",
  contemporary: "postwar",
};

export function galleryTheme(periodSlug: string): GalleryTheme {
  return THEMES[ERA_BY_PERIOD[periodSlug] ?? "nineteenth"];
}
