// Period-appropriate curation for each artist's gallery. Real museums don't
// hang a Pollock in a gilded Baroque frame on cream plaster: Old Masters get
// saturated walls and carved gilt, the 19th century deep greens and greys,
// early modernism off-white rooms with plain wood frames, and post-war work
// the white cube with unframed canvases on concrete.

export type EraKey =
  | "sacred"
  | "old-master"
  | "eighteenth"
  | "nineteenth"
  | "impressionist"
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
}

const THEMES: Record<EraKey, GalleryTheme> = {
  sacred: {
    era: "sacred",
    wall: { color: "#3c4a52", roughness: 0.94 },
    trim: "#262a2c",
    ceiling: "#d9d4c8",
    floor: { kind: "oak-dark", tint: "#8a7558" },
    frame: { style: "tabernacle", color: "#d4a94f", metalness: 1, roughness: 0.32, width: 0.12 },
    light: { spot: "#ffd7a3", ambient: "#e8dcc4" },
  },
  "old-master": {
    era: "old-master",
    wall: { color: "#6b2a26", roughness: 0.93 },
    trim: "#2e1d16",
    ceiling: "#e6dccb",
    floor: { kind: "oak-dark", tint: "#9a8568" },
    frame: { style: "baroque", color: "#d1a04a", metalness: 1, roughness: 0.3, width: 0.13 },
    light: { spot: "#ffd9a8", ambient: "#efe2c9" },
  },
  eighteenth: {
    era: "eighteenth",
    wall: { color: "#7f8f7a", roughness: 0.92 },
    trim: "#e4ddcd",
    ceiling: "#f1ebdf",
    floor: { kind: "oak-dark", tint: "#a38d6d" },
    frame: { style: "baroque", color: "#ddb35e", metalness: 1, roughness: 0.28, width: 0.11 },
    light: { spot: "#ffdcb0", ambient: "#f1e7d2" },
  },
  nineteenth: {
    era: "nineteenth",
    wall: { color: "#2f4a3e", roughness: 0.93 },
    trim: "#1f2420",
    ceiling: "#e3ddd0",
    floor: { kind: "oak-dark", tint: "#9a8568" },
    frame: { style: "gilt-simple", color: "#cfa456", metalness: 1, roughness: 0.33, width: 0.1 },
    light: { spot: "#ffdcb0", ambient: "#ebe2cf" },
  },
  impressionist: {
    era: "impressionist",
    wall: { color: "#8c8a85", roughness: 0.92 },
    trim: "#3b3936",
    ceiling: "#ece8df",
    floor: { kind: "oak-light", tint: "#b39c7c" },
    frame: { style: "gilt-simple", color: "#d8b46a", metalness: 1, roughness: 0.36, width: 0.085 },
    light: { spot: "#ffe2bf", ambient: "#efe9dc" },
  },
  "early-modern": {
    era: "early-modern",
    wall: { color: "#e8e4dc", roughness: 0.9 },
    trim: "#cfc8bb",
    ceiling: "#f2f0eb",
    floor: { kind: "oak-light", tint: "#c2ad8e" },
    frame: { style: "wood", color: "#3b2a1d", metalness: 0, roughness: 0.55, width: 0.05 },
    light: { spot: "#ffe8cc", ambient: "#f2eee6" },
  },
  postwar: {
    era: "postwar",
    wall: { color: "#f2f1ee", roughness: 0.9 },
    trim: "#e6e4df",
    ceiling: "#f5f5f3",
    floor: { kind: "concrete", tint: "#a9a6a0" },
    frame: { style: "floater", color: "#1d1c1b", metalness: 0, roughness: 0.6, width: 0 },
    light: { spot: "#fff0dc", ambient: "#f4f2ee" },
  },
};

const ERA_BY_PERIOD: Record<string, EraKey> = {
  "medieval-gothic": "sacred",
  "early-renaissance": "sacred",
  "high-renaissance": "old-master",
  mannerism: "old-master",
  baroque: "old-master",
  rococo: "eighteenth",
  neoclassicism: "eighteenth",
  romanticism: "nineteenth",
  realism: "nineteenth",
  impressionism: "impressionist",
  "post-impressionism": "impressionist",
  expressionism: "early-modern",
  cubism: "early-modern",
  surrealism: "early-modern",
  "american-modernism": "early-modern",
  "abstract-expressionism": "postwar",
  "pop-art": "postwar",
  contemporary: "postwar",
};

export function galleryTheme(periodSlug: string): GalleryTheme {
  return THEMES[ERA_BY_PERIOD[periodSlug] ?? "nineteenth"];
}
