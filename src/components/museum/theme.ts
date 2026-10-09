// Period-appropriate curation for each artist's gallery. Real museums don't
// hang a Pollock in a gilded Baroque frame on cream plaster: Old Masters get
// saturated silk-damask walls under a laylight, the 19th century deep greens
// and greys, early modernism off-white rooms with plain wood frames, and
// post-war work the white cube with unframed canvases on polished concrete.
// Beyond Europe: East Asian painting in dark-wood rooms with paper-toned
// walls and silk mounts (the Met's Asian Art galleries, the Tokyo National
// Museum), Japanese prints in a dim print room, matted and thinly framed,
// and Indian and Persian court miniatures on jewel-toned walls, small works
// in wide mats with thin gilt slips under focused light.

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
  | "postwar"
  | "east-asian"
  | "print-room"
  | "court-miniature"
  | "museum"
  | "palace"
  | "salon";

/**
 * tabernacle — wide flat gilded frame with a raised outer bead (pre-1500)
 * baroque     — deep carved gilt: outer bead, cove, ogee, sight-edge lip
 * gilt-simple — slimmer 19th-century gilt moulding
 * wood        — plain hardwood moulding, no gilding
 * floater     — no frame: canvas edge visible with a dark shadow-gap tray
 * mount       — East Asian mounting: a silk border round the work, edged
 *               with a thin dark-wood strip (hanging scrolls, screens)
 * print       — a print room's: a wide off-white mat with a bevelled window
 *               in a thin black-lacquer frame
 * miniature   — a thin gilt slip at the window, a wide cream mat and a
 *               slim gilt outer moulding (court miniatures)
 */
export type FrameStyle = "tabernacle" | "baroque" | "gilt-simple" | "wood" | "floater" | "mount" | "print" | "miniature";

/** parquet: oak strips laid in herringbone (point de Hongrie), as in the Louvre's galleries; marble: polished
 *  white slabs with grey veins in running bond (the National Gallery in Athens); concrete: stone or concrete slabs. */
export type FloorKind = "oak-dark" | "oak-light" | "concrete" | "parquet" | "marble";

/**
 * laylight — 19th-century top-lit gallery: coved cornice, flat ceiling band
 *            and a recessed well of frosted glass panes between beams.
 * lightbox — modern flat white ceiling with one long recessed diffuser.
 * vault    — a palace's: deep coves springing from the cornice above the
 *            walls (a cloister vault), coffered with gilt ribs, round a
 *            great skylight (the Louvre's Grande Galerie and red rooms).
 */
export type CeilingKind = "laylight" | "lightbox" | "vault";

/**
 * plaster — lime plaster / distemper with a visible trowel texture
 * damask  — silk damask wall covering (figure reads through sheen)
 * paint   — smooth modern emulsion on board
 */
export type WallFinish = "plaster" | "damask" | "paint";


/**
 * What kind of object the room mostly hangs, for sizing works whose
 * dimensions are unknown and for how densely a room is hung:
 * painting  — easel paintings (the default heuristics)
 * scroll    — hanging scrolls, handscrolls and screens on silk or paper
 * print     — woodblock prints (an oban sheet is about 26 x 38 cm), hung close
 * miniature — album and manuscript paintings (about 20 x 30 cm)
 * icon      — devotional panels (Greek icons: mostly 30 x 40 to 80 x 100 cm)
 */
export type WorkScale = "painting" | "scroll" | "print" | "miniature" | "icon";

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
  /** Floor finish roughness (lower = glossier, stronger reflections). */
  floorRoughness: number;
  /** Board width in metres (wood floors) / slab size (concrete). */
  plankWidth: number;
  /** Track-mounted wall-washer level (modern rooms; 0 = the laylight does it). */
  wallWash: number;
  /** Lightbox diffuser half-width (default 0.75 m); a cabinet has a slim slot. */
  diffuserHalfWidth?: number;
  /** Wide arches between the rooms instead of doorways: on marble columns (a palace gallery), or plain. */
  arches?: "columns" | "plain";
  /** Gilding: a vault's coffer ribs and cornice, the columns' bases and capitals. */
  gilt?: string;
  /** The columns' marble. */
  marble?: string;
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
    /** Mat / silk mount colour (mount, print and miniature styles). */
    mat?: string;
  };
  /** The kind of work the room hangs (sizes and hanging density). */
  works: WorkScale;
  /** Gallery lighting: spot colour temperature as sRGB hex. */
  light: { spot: string; ambient: string };
  room: RoomStyle;
}

const THEMES: Record<EraKey, GalleryTheme> = {
  // Early Italian gold grounds: cool stone-grey walls with pietra serena
  // trim, as in the National Gallery's Sainsbury Wing.
  sacred: {
    era: "sacred",
    works: "painting",
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
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // Baroque: crimson silk damask, dark oak, carved gilt — Galleria Borghese,
  // the National Gallery's Rubens and Caravaggio rooms.
  "old-master": {
    era: "old-master",
    works: "painting",
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
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // Dutch Golden Age: the Rijksmuseum's slate-blue galleries and the black
  // ebonised mouldings Rembrandt's and Vermeer's contemporaries framed in.
  northern: {
    era: "northern",
    works: "painting",
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
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // 18th century: sage-green silk and cream boiserie trim (Wallace Collection).
  eighteenth: {
    era: "eighteenth",
    works: "painting",
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
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // 19th century: deep green distemper (Alte Nationalgalerie's Friedrich room).
  nineteenth: {
    era: "nineteenth",
    works: "painting",
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
      floorRoughness: 0.32,
      plankWidth: 0.18,
      wallWash: 0,
    },
  },
  // Victorian: peacock-blue silk and carved gilt — the Aesthetic interiors
  // (Leighton House) the Pre-Raphaelites and Salon painters were hung in.
  victorian: {
    era: "victorian",
    works: "painting",
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
      floorRoughness: 0.3,
      plankWidth: 0.17,
      wallWash: 0,
    },
  },
  // Impressionists: Orsay-style warm grey under a glazed skylight, pale oak.
  impressionist: {
    era: "impressionist",
    works: "painting",
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
      floorRoughness: 0.34,
      plankWidth: 0.2,
      wallWash: 0,
    },
  },
  // Vienna Secession: deep charcoal walls so the gold reads (the Belvedere's
  // Klimt room), flat gilt frames, gilded bands for trim.
  secession: {
    era: "secession",
    works: "painting",
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
      floorRoughness: 0.32,
      plankWidth: 0.2,
      wallWash: 0,
    },
  },
  // Early modernism: off-white walls, pale oak boards, flat ceiling (MoMA, Whitney).
  "early-modern": {
    era: "early-modern",
    works: "painting",
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
      floorRoughness: 0.36,
      plankWidth: 0.24,
      wallWash: 0.26,
    },
  },
  // A museum of today, as the renovated galleries hang old art: painted grey-blue walls, a pale stone floor in
  // large slabs, gilt frames under a luminous ceiling, no mouldings (the National Gallery of Greece since 2021,
  // the Louvre's Richelieu wing). Not any period's own room: a custom room's style.
  museum: {
    era: "museum",
    works: "painting",
    wall: { color: "#8e9ba5", roughness: 0.9 },
    trim: "#7c8790",
    ceiling: "#eef0f1",
    floor: { kind: "concrete", tint: "#d8d2c6" },
    frame: { style: "gilt-simple", color: "#d2ae62", metalness: 1, roughness: 0.34, width: 0.08 },
    light: { spot: "#fff0dc", ambient: "#eef0f2" },
    room: {
      ceiling: "lightbox",
      wallFinish: "paint",
      classical: false,
      pictureRail: false,
      daylight: "#f3f5f7",
      daylightLevel: 1.3,
      track: "#d4d6d8",
      floorRoughness: 0.22,
      // stone slabs (a concrete floor's joint spacing when under 2 m)
      plankWidth: 1.2,
      wallWash: 0.22,
    },
  },
  // A palace gallery: the Louvre's Grande Galerie (Percier and Fontaine's bays on marble columns under
  // arches, Lefuel's skylights in the vault, an oak parquet in herringbone) and the Rijksmuseum's Gallery of
  // Honour. Warm stone walls, white and gold above, gilt frames.
  palace: {
    era: "palace",
    works: "painting",
    wall: { color: "#b6a993", roughness: 0.93 },
    trim: "#ebe4d5",
    ceiling: "#f1ebdf",
    floor: { kind: "parquet", tint: "#a07c55" },
    frame: { style: "baroque", color: "#d3a64e", metalness: 1, roughness: 0.3, width: 0.12 },
    light: { spot: "#ffe2bc", ambient: "#efe6d4" },
    room: {
      ceiling: "vault",
      wallFinish: "plaster",
      classical: true,
      pictureRail: false,
      daylight: "#fbf6ec",
      daylightLevel: 1.75,
      track: "#2a2620",
      floorRoughness: 0.26,
      // the parquet's strips
      plankWidth: 0.1,
      wallWash: 0,
      arches: "columns",
      gilt: "#d0a24c",
      marble: "#8a5442",
    },
  },
  // A grand salon: the Louvre's red rooms (Denuelle's red and gold, 1863, the red Soulages chose in 1969), the
  // Salon Carré: a coved ceiling ribbed in gilt round a great skylight, Pompeian-red walls, herringbone parquet.
  salon: {
    era: "salon",
    works: "painting",
    wall: { color: "#8c2b25", roughness: 0.93 },
    trim: "#2c211b",
    ceiling: "#efe5d0",
    floor: { kind: "parquet", tint: "#93714d" },
    frame: { style: "baroque", color: "#d6a84f", metalness: 1, roughness: 0.3, width: 0.13 },
    light: { spot: "#ffdcb0", ambient: "#efe2c9" },
    room: {
      ceiling: "vault",
      wallFinish: "plaster",
      classical: true,
      pictureRail: true,
      daylight: "#fff6ea",
      daylightLevel: 1.75,
      track: "#1d1b18",
      floorRoughness: 0.26,
      plankWidth: 0.1,
      wallWash: 0,
      arches: "plain",
      gilt: "#d4a64e",
    },
  },
  // Post-war: the white cube — polished concrete, unframed canvases.
  postwar: {
    era: "postwar",
    works: "painting",
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
      floorRoughness: 0.28,
      plankWidth: 3.0,
      wallWash: 0.28,
    },
  },
  // East Asian painting: warm dark wood, paper-toned plaster, low warm
  // light, no gilding (the Met's Chinese and Japanese galleries, the Tokyo
  // National Museum). Works hang in silk mounts edged with thin dark wood.
  "east-asian": {
    era: "east-asian",
    works: "scroll",
    wall: { color: "#d2cab9", roughness: 0.95 },
    trim: "#3a2a1e",
    ceiling: "#d8cebd",
    floor: { kind: "oak-dark", tint: "#5a4130" },
    frame: { style: "mount", color: "#2a1d15", metalness: 0, roughness: 0.5, width: 0.07, mat: "#c9bc9c" },
    light: { spot: "#ffdbb4", ambient: "#e6dccb" },
    room: {
      ceiling: "lightbox",
      wallFinish: "plaster",
      classical: false,
      pictureRail: false,
      daylight: "#f6e9d6",
      daylightLevel: 1.0,
      track: "#2a2420",
      floorRoughness: 0.38,
      plankWidth: 0.16,
      wallWash: 0.12,
    },
  },
  // Ukiyo-e: a print room (the British Museum's, the Art Institute of
  // Chicago's): light-sensitive paper under low light, warm grey walls, the
  // prints matted in thin black-lacquer frames and hung close together.
  "print-room": {
    era: "print-room",
    works: "print",
    wall: { color: "#aaa59b", roughness: 0.93 },
    trim: "#2e2b27",
    ceiling: "#e4e0d8",
    floor: { kind: "oak-light", tint: "#a48a68" },
    frame: { style: "print", color: "#141210", metalness: 0, roughness: 0.32, width: 0.06, mat: "#f1efe9" },
    light: { spot: "#ffdcb4", ambient: "#e9e4da" },
    room: {
      ceiling: "lightbox",
      wallFinish: "paint",
      classical: false,
      pictureRail: false,
      daylight: "#f2eee6",
      daylightLevel: 0.85,
      track: "#232323",
      floorRoughness: 0.4,
      plankWidth: 0.2,
      wallWash: 0.06,
      diffuserHalfWidth: 0.3,
    },
  },
  // Indian and Persian court painting: jewel-toned walls (the V&A's and the
  // Met's Islamic and South Asian galleries, the Chester Beatty), small works
  // in wide cream mats with thin gilt slips, in a low cabinet (layout.ts):
  // a dim ceiling with a slim diffuser, focused spots, the room receding. Deep teal by default; a period can
  // set its own wall (lapis for Persian miniatures).
  "court-miniature": {
    era: "court-miniature",
    works: "miniature",
    wall: { color: "#2a6365", roughness: 0.94 },
    trim: "#1a2223",
    ceiling: "#5a5650",
    floor: { kind: "oak-dark", tint: "#5e4632" },
    frame: { style: "miniature", color: "#d6ad5c", metalness: 1, roughness: 0.3, width: 0.07, mat: "#f4efe4" },
    light: { spot: "#ffd9aa", ambient: "#e6dcc8" },
    room: {
      ceiling: "lightbox",
      wallFinish: "plaster",
      classical: true,
      pictureRail: false,
      daylight: "#f5ece0",
      daylightLevel: 0.85,
      track: "#1d1c1a",
      floorRoughness: 0.34,
      plankWidth: 0.17,
      wallWash: 0.07,
      // a cabinet: a slim, dim slot; the works glow in their spots
      diffuserHalfWidth: 0.16,
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
  "mexican-muralism": "early-modern",
  "abstract-expressionism": "postwar",
  "pop-art": "postwar",
  contemporary: "postwar",
  "group-of-seven": "early-modern",
  "chinese-painting": "east-asian",
  "japanese-painting": "east-asian",
  "ukiyo-e": "print-room",
  "indian-painting": "court-miniature",
  "persian-miniature": "court-miniature",
  // Greek icons: tempera and gold on panel, as the early Italian rooms
  "cretan-school": "sacred",
  // colonial Baroque: carved gilt on crimson, as Madrid and Lima hang it
  "cusco-school": "old-master",
};

/** A period's own touches on its era's room (the same room otherwise). */
const PERIOD_TWEAKS: Record<string, (t: GalleryTheme) => GalleryTheme> = {
  // Persian miniatures: lapis walls, a paler mat
  "persian-miniature": (t) => ({
    ...t,
    wall: { ...t.wall, color: "#2e4577" },
    trim: "#161d30",
    frame: { ...t.frame, mat: "#f5f0e6" },
  }),
  // Cretan icons: the early Italian room, hung as panels of icon size
  "cretan-school": (t) => ({ ...t, works: "icon" }),
  // Japanese painting: a cooler paper tone and a celadon-grey mount silk
  "japanese-painting": (t) => ({
    ...t,
    wall: { ...t.wall, color: "#d5d0c2" },
    frame: { ...t.frame, mat: "#b8b49c" },
  }),
};

/** The room styles a custom room can choose (src/lib/rooms.ts `style`), named for what the visitor sees. */
export const ROOM_STYLES: { key: EraKey; label: string }[] = [
  { key: "sacred", label: "Stone chapel (early Italian)" },
  { key: "old-master", label: "Crimson damask (Baroque)" },
  { key: "northern", label: "Slate blue (Dutch Golden Age)" },
  { key: "eighteenth", label: "Sage silk (18th century)" },
  { key: "nineteenth", label: "Deep green (19th century)" },
  { key: "victorian", label: "Peacock blue (Victorian)" },
  { key: "impressionist", label: "Skylit grey (Impressionists)" },
  { key: "secession", label: "Charcoal and gold (Vienna 1900)" },
  { key: "early-modern", label: "White walls, oak floor (Modern)" },
  { key: "postwar", label: "White cube (Contemporary)" },
  { key: "east-asian", label: "Dark wood and paper (East Asian)" },
  { key: "print-room", label: "Print room" },
  { key: "court-miniature", label: "Jewel cabinet (court miniatures)" },
  { key: "museum", label: "Grey-blue and stone (a museum of today)" },
  { key: "palace", label: "Palace gallery: skylit vault, arches, parquet (the Louvre)" },
  { key: "salon", label: "Grand salon: red and gold under a skylight (the Louvre)" },
];
const STYLE_KEYS = new Set<string>(ROOM_STYLES.map((s) => s.key));
export const isRoomStyle = (s: string | null | undefined): s is EraKey => !!s && STYLE_KEYS.has(s);

const custom = new Map<string, GalleryTheme>();

/** A custom room's theme: its period's, or a chosen room style, with an optional wall colour (#rrggbb). The
 *  works scale (how unknown sizes are hung) stays the period's: it follows what hangs, not the decoration. */
export function roomTheme(periodSlug: string, style?: string | null, wall?: string | null, ground?: string | null): GalleryTheme {
  const key = `${periodSlug}|${style ?? ""}|${wall ?? ""}|${ground ?? ""}`;
  const hit = custom.get(key);
  if (hit) return hit;
  const period = galleryTheme(periodSlug);
  let t = isRoomStyle(style) ? { ...THEMES[style], works: period.works } : period;
  if (wall && /^#[0-9a-f]{6}$/i.test(wall)) t = { ...t, wall: { ...t.wall, color: wall } };
  // another floor than the style's own, laid as the style that has it lays it
  if (isGround(ground) && ground !== t.floor.kind) {
    const g = GROUND_LOOK[ground];
    t = { ...t, floor: { kind: ground, tint: g.tint }, room: { ...t.room, floorRoughness: g.roughness, plankWidth: g.plank } };
  }
  custom.set(key, t);
  return t;
}

/** The floors a room may have instead of its style's own (the room picker's "Floor"). */
export const GROUNDS: { key: FloorKind; label: string }[] = [
  { key: "marble", label: "White marble" },
  { key: "concrete", label: "Stone slabs" },
  { key: "oak-light", label: "Light oak boards" },
  { key: "oak-dark", label: "Dark oak boards" },
  { key: "parquet", label: "Oak parquet, herringbone" },
];
export const isGround = (k: string | null | undefined): k is FloorKind => GROUNDS.some((g) => g.key === k);
/** Each floor's colour, sheen and slab or board width: marble polished; the others as a style has them. */
const GROUND_LOOK: Record<FloorKind, { tint: string; roughness: number; plank: number }> = {
  marble: { tint: "#e8e6e1", roughness: 0.1, plank: 1.2 },
  concrete: { tint: THEMES.museum.floor.tint, roughness: THEMES.museum.room.floorRoughness, plank: THEMES.museum.room.plankWidth },
  "oak-light": { tint: THEMES.impressionist.floor.tint, roughness: THEMES.impressionist.room.floorRoughness, plank: THEMES.impressionist.room.plankWidth },
  "oak-dark": { tint: THEMES.nineteenth.floor.tint, roughness: THEMES.nineteenth.room.floorRoughness, plank: THEMES.nineteenth.room.plankWidth },
  parquet: { tint: THEMES.palace.floor.tint, roughness: THEMES.palace.room.floorRoughness, plank: THEMES.palace.room.plankWidth },
};

const byPeriod = new Map<string, GalleryTheme>();

/** The gallery theme of a period (one stable object per period). */
export function galleryTheme(periodSlug: string): GalleryTheme {
  const hit = byPeriod.get(periodSlug);
  if (hit) return hit;
  const base = THEMES[ERA_BY_PERIOD[periodSlug] ?? "nineteenth"];
  const t = PERIOD_TWEAKS[periodSlug]?.(base) ?? base;
  byPeriod.set(periodSlug, t);
  return t;
}

/** A room style's colours for the room picker's swatches: wall, trim, floor, frame and ceiling. */
export function styleSwatch(key: EraKey): { wall: string; trim: string; floor: string; frame: string; ceiling: string } {
  const t = THEMES[key];
  return { wall: t.wall.color, trim: t.trim, floor: t.floor.tint, frame: t.frame.color, ceiling: t.ceiling };
}
