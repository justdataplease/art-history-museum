// Museums recreated with the room tools (src/lib/room-query.ts): each is an ordinary room, the works that museum
// holds (Wikidata's collection, WikiArt's gallery) hung on its own floors in its own colours, its best-known works
// kept (★, some on the floor they hang on), so the room picker can open one, change it and save it like any other
// room. /museums/<slug> opens one. Floors, wall colours and key works follow each museum's floor plan and
// descriptions of its galleries (sources below); colours are estimates from those, the hanging is ours.

import { EMPTY_SELECTION, selectionQuery, type FloorSpec, type Selection } from "./room-query";

export interface MuseumRoom {
  slug: string;
  name: string;
  city: string;
  /** One line on what is recreated. */
  note: string;
  query: string;
}

const floor = (f: Partial<FloorSpec> & { label: string }): FloorSpec => ({
  from: null, to: null, style: null, wall: null, works: null, intro: null, who: [], ground: null, number: null, ...f,
});

// The National Gallery – Alexandros Soutsos Museum, Athens, as reopened in 2021 (its own floor numbers): −2 the
// Western European room (2022, 14th to 20th century, by school) beside the temporary hall; 1 the post-Byzantine
// icons, El Greco, the Ionian School and the 19th century; 2 the 20th century (Omada Techni, the Generation of
// the '30s, abstraction); 3 the post-war wing, closed since September 2025 (and nearly all of it still in
// copyright here). Floors 1 and 2: long halls of pale blue-grey walls broken by free-standing partitions, polished
// white marble with grey veins underfoot, a flat white ceiling with recessed light strips, a band of high windows,
// gilt frames in a single row, low black curved benches. nationalgallery.gr (permanent exhibition, the building),
// the lobby's floor directory and gallery photos on Wikimedia Commons (Category:National Gallery of Greece -
// Interior), lifo.gr, iefimerida.gr and travel.gr on the 2021 rehang.
const ATHENS: Partial<Selection> = {
  title: "National Gallery of Greece",
  museums: ["national-gallery-of-greece"],
  style: "museum",
  wall: "#d2d6d5",
  ground: "marble",
  max: 160,
  floors: "plan",
  intro:
    "The National Gallery – Alexandros Soutsos Museum in Athens, as reopened in 2021: long pale halls with " +
    "free-standing walls, white marble underfoot. Its works in this collection, on its own floors.",
  plan: [
    floor({
      label: "European painting",
      number: -2,
      who: ["Flemish", "French", "Dutch", "Russians", "Italians", "Germans", "British", "Austrians"],
      works: 16,
      intro: "The Western European room, opened in 2022: Flemish, French and Dutch painting beside the Greek collection.",
    }),
    floor({
      label: "From El Greco to 1900",
      number: 1,
      to: 1909,
      works: 120,
      intro:
        "Post-Byzantine icons and the Cretan School, Domenicos Theotokopoulos, the Ionian School, painting under " +
        "King Othon, the bourgeoisie and its painters, and the years around 1900.",
    }),
    floor({
      label: "The 20th century",
      number: 2,
      from: 1910,
      wall: "#d9dbd9",
      works: 36,
      intro: "From the Omada Techni of 1917 to the Generation of the Thirties and the first abstraction.",
    }),
  ],
  include: [
    "el-greco/concert-of-angels",
    "el-greco/the-entombment-of-christ-el-greco",
    "stephanos-tzangarolas/adoration-of-the-shepherds-tzangarolas",
    "nikolaos-doxaras/kimisis-tis-theotokou-doxaras-q135687053@2",
    "theodoros-vryzakis/the-reception-of-lord-byron-at-missolonghi",
    "theodoros-vryzakis/wikiart-the-old-patras-germanos-blesses-the-flag-of-the-revolution-1865",
    "theodoros-vryzakis/grateful-hellas-q19597999",
    "nikiforos-lytras/the-dirge-in-psara",
    "nikolaos-gyzis/the-betrothal-of-the-children-q12885237",
    "nikolaos-gyzis/wikiart-carnival-in-athens-1892",
    "nikolaos-gyzis/wikiart-the-slave-market-1875",
    "nikolaos-gyzis/behold-the-bridegroom-arriving",
    "nikolaos-gyzis/after-the-destruction-of-psara-q112669163@2",
    "nikolaos-gyzis/the-spider-q24259028",
    "nikolaos-gyzis/spring-symphony-q24083094",
    "georgios-jakobides/children-s-concert-q56706738",
    "georgios-jakobides/grandma-s-favorite-q56706785",
    "georgios-jakobides/cold-shower-q56706798",
    "konstantinos-volanakis/wikiart-1883-1885",
    "pericles-pantazis/wikiart-lady-in-the-mirror-with-a-fan-1882",
    "ioannis-altamouras/caique-at-spetses-q22671102",
    "theodore-ralli/vespers-ralli-q136341765@2",
    "konstantinos-maleas/wikiart-santorini-1928",
  ],
};

// The Rijksmuseum, Amsterdam: floor 0 1100–1600, floor 1 1700–1900, floor 2 1600–1700 with the Gallery of
// Honour and the Night Watch, floor 3 1900–2000; walls in Cuypers' greys, darkest for the medieval rooms.
// rijksmuseum.nl (floor plan, Gallery of Honour), Sikkens RIJKS colours.
const RIJKS: Partial<Selection> = {
  title: "Rijksmuseum",
  museums: ["rijksmuseum"],
  style: "northern",
  max: 136,
  firstFloor: 0,
  floors: "plan",
  intro:
    "The Rijksmuseum in Amsterdam, a century to a wing: the Middle Ages on the ground floor, the Golden Age and " +
    "the Gallery of Honour on the second, ending at The Night Watch. Its works in this collection.",
  plan: [
    floor({ label: "1100–1600", to: 1599, style: "sacred", wall: "#3e4549", works: 24,
      intro: "The Middle Ages and the Renaissance, on the museum's darkest, bluest walls." }),
    floor({ label: "1700–1900", from: 1700, to: 1899, style: "nineteenth", wall: "#777371", works: 36,
      who: ["Dutch", "Netherlands", "Flemish", "Belgian", "French", "Spanish", "Germans", "British", "Italians"],
      intro: "The 18th and 19th centuries: from Troost's conversation pieces to Breitner's Amsterdam." }),
    floor({ label: "1600–1700 · Gallery of Honour", from: 1600, to: 1699, style: "palace", wall: "#5f605d", works: 60,
      intro: "The Golden Age: Hals, Vermeer, Steen and Rembrandt. At the end of the Gallery of Honour, The Night Watch." }),
    floor({ label: "1900–2000", from: 1900, style: "early-modern", wall: "#d2d0c9", works: 16 }),
  ],
  include: [
    "geertgen-tot-sint-jans/the-holy-kinship-geertgen-tot-sint-jans@1",
    "fra-angelico/madonna-of-humility-q17331378",
    "piero-di-cosimo/portraits-of-giuliano-and-francesco-giamberti-da-sangallo-q17343150",
    "francisco-goya/portrait-of-don-ramon-satue",
    "george-hendrik-breitner/girl-in-a-white-kimono",
    "rembrandt/the-night-watch",
    "rembrandt/the-jewish-bride",
    "johannes-vermeer/the-milkmaid-vermeer",
    "johannes-vermeer/the-little-street",
    "johannes-vermeer/woman-reading-a-letter-vermeer",
    "johannes-vermeer/the-love-letter-vermeer",
    "frans-hals/the-merry-drinker",
    "frans-hals/marriage-portrait-of-isaac-massa-and-beatrix-van-der-laen",
    "jan-steen/the-happy-family-painting",
    "pieter-de-hooch/a-mother-s-duty",
    "hendrick-avercamp/winter-landscape-with-skaters",
  ],
};

const MEDICI = [
  "the-arrival-of-marie-de-medici-at-marseille",
  "the-wedding-by-proxy-of-marie-de-medici-to-king-henry-iv-q29655360",
  "the-triumph-of-truth-q29655317",
  "the-presentation-of-marie-de-medici-s-portrait-to-henry-iv-q29655363",
  "the-meeting-of-marie-de-medici-and-henry-iv-at-lyons-q29655356",
  "the-majority-of-louis-xiii-20-october-1614-q29655331",
  "the-happiness-of-the-regency-q29655334",
  "the-gathering-of-the-gods-on-olympus-chasing-the-vices-1622-1625-q29655343",
  "the-final-reconciliation-between-maria-de-medici-and-her-son-louis-xiii-of-france-1622-1625-q29655319",
  "the-education-of-marie-de-medici-q29655368",
  "the-destiny-of-marie-de-medici-q29655375",
  "the-coronation-of-marie-de-medici-in-saint-denis-q29655346",
  "the-consignment-of-the-regency-q29655350",
  "the-conclusion-of-peace-in-angers-10-august-1620-q29655322",
  "the-birth-of-the-dauphin-at-fontainebleau-27-september-1601-q29655353",
  "the-birth-of-marie-de-medici-q29655371",
  "the-apotheosis-of-henri-iv-and-the-proclamation-of-the-regency-of-marie-de-medicis-q27089307",
  "portrait-of-johanna-of-austria-mother-of-maria-de-medici-q29647898",
  "portrait-of-francesco-i-de-medici-1541-1587-q29647902",
  "portrait-de-marie-de-medicis-q29647894",
  "maria-de-medici-s-flight-to-blois-21-22-february-1619-1622-1625-q29655328",
  "maria-de-medici-meets-her-son-with-cardinal-de-la-rochefoucauld-as-mediator-q29655326",
  "exchange-of-the-princesses-between-spain-and-france-on-9-november-1615-at-hendaye-q29655337",
  "equestrian-portrait-of-mary-de-medici-1575-1642-and-the-triumph-at-juliers-ca-1622-1625-q29655340",
].map((w) => `peter-paul-rubens/${w}@3`);

const ITALIANS = ["Italians", "Dominicans", "Republic of Venice", "Duchy of Urbino", "Duchy of Milan"];
const FRENCH = ["French", "France"];

// The Louvre, Denon wing, first floor, as the building stands (src/lib/spaces.ts "louvre-denon": the rooms'
// plan from OpenStreetMap's indoor survey, their look from photographs of them on Wikimedia Commons, 2018–2024):
// the Salon Carré (Italian painting to the middle of the 15th century: Cimabue, Giotto, Fra Angelico, Uccello),
// the Grande Galerie (Italian painting from Leonardo to the 18th century), the Salle des Sept-Mètres (the later
// 15th century), the Salle des États (Venice: the Mona Lisa facing the Wedding at Cana), the Salon Denon, and the
// two red rooms of large French canvases: Mollien (Géricault, Delacroix) and Daru (David, Gros, Ingres). The
// floors below are the space's rooms, in its order; a work whose room is known is kept there (@room).
const LOUVRE: Partial<Selection> = {
  title: "The Louvre · Denon wing",
  museums: ["louvre"],
  max: 240,
  floors: "plan",
  space: "louvre-denon",
  intro:
    "The Louvre's Denon wing as it stands: from the Salon Carré down the Grande Galerie, through the Salle des " +
    "États past the Mona Lisa, to the red rooms of David and Delacroix. Its rooms to plan, its works in this collection.",
  plan: [
    floor({ label: "Salon Carré", to: 1459, who: ITALIANS, works: 14,
      intro: "Italian painting from Cimabue and Giotto to Fra Angelico and Uccello." }),
    floor({ label: "Grande Galerie", from: 1490, to: 1800, who: ITALIANS, works: 120,
      intro: "Italian painting from Leonardo, Raphael and Mantegna to Caravaggio and the 18th century." }),
    floor({ label: "Salle des Sept-Mètres", from: 1460, to: 1489, who: ITALIANS, works: 16,
      intro: "The later 15th century in Italy." }),
    floor({ label: "Salle des États", from: 1500, to: 1600, who: ["Italians"], works: 30,
      intro: "Venice in the 16th century: Titian, Tintoretto, Veronese. The Mona Lisa faces the Wedding at Cana." }),
    floor({ label: "Salon Denon", from: 1835, to: 1865, who: FRENCH, works: 6 }),
    floor({ label: "Salle Mollien", from: 1819, to: 1870, who: FRENCH, works: 24,
      intro: "French Romanticism on the grand scale: Géricault and Delacroix." }),
    floor({ label: "Salle Daru", from: 1770, to: 1818, who: FRENCH, works: 22,
      intro: "French Neoclassicism: David, Gros, Girodet, Ingres." }),
  ],
  exclude: ["giorgione/pastoral-concert"],
  include: [
    "cimabue/maesta-cimabue@1",
    "giotto/saint-francis-receiving-the-stigmata-giotto@1",
    "fra-angelico/coronation-of-the-virgin-fra-angelico-louvre@1",
    "paolo-uccello/the-decisive-attack-of-micheletto-attendolo-at-san-romano-q18564226@1",
    "leonardo-da-vinci/virgin-of-the-rocks-q11935346@2",
    "leonardo-da-vinci/the-virgin-and-child-with-saint-anne-leonardo@2",
    "leonardo-da-vinci/saint-john-the-baptist-leonardo@2",
    "leonardo-da-vinci/la-belle-ferronniere@2",
    "raphael/la-belle-jardiniere@2",
    "raphael/portrait-of-baldassare-castiglione@2",
    "andrea-mantegna/st-sebastian-q18565594@2",
    "antonello-da-messina/portrait-of-a-man-called-condottiere-q15935001@2",
    "domenico-ghirlandaio/an-old-man-and-his-grandson@2",
    "caravaggio/death-of-the-virgin-caravaggio@2",
    "caravaggio/the-fortune-teller-caravaggio@2",
    "giuseppe-arcimboldo/the-four-seasons-arcimboldo@2",
    "leonardo-da-vinci/mona-lisa@4",
    "paolo-veronese/the-wedding-at-cana-veronese@4",
    "titian/pastoral-concert@4",
    "titian/man-with-a-glove@4",
    "titian/woman-with-a-mirror@4",
    "titian/madonna-of-the-rabbit@4",
    "titian/pardo-venus@4",
    "titian/the-crowning-with-thorns-titian-paris@4",
    "titian/allegory-of-marriage@4",
    "titian/the-entombment-of-christ-titian@4",
    "titian/pilgrims-at-emmaus@4",
    "titian/portrait-of-francis-i-q18573255@4",
    "paolo-veronese/supper-at-emmaus-veronese@4",
    "paolo-veronese/la-bella-nani@4",
    "paolo-veronese/jupiter-hurling-thunderbolts-at-the-vices-q18573249@4",
    "paolo-veronese/esther-and-ahasuerus-q18573215@4",
    "paolo-veronese/susannah-and-the-elders-q18573218@4",
    "paolo-veronese/christ-meeting-the-wife-and-the-sons-of-zebedee-q106575202@4",
    "tintoretto/self-portrait-tintoretto@4",
    "tintoretto/susannah-bathing-q18573260@4",
    "tintoretto/the-coronation-of-the-virgin-q18573257@4",
    "tintoretto/madonna-and-child-with-saints-tintoretto@4",
    "lorenzo-lotto/holy-family-with-the-family-of-st-john-the-baptist@4",
    "lorenzo-lotto/christ-carrying-the-cross-lotto@4",
    "palma-vecchio/adoration-of-the-shepherds-with-a-donor@4",
    "theodore-gericault/the-raft-of-the-medusa@6",
    "theodore-gericault/the-charging-chasseur@6",
    "theodore-gericault/the-wounded-cuirassier@6",
    "eugene-delacroix/liberty-leading-the-people@6",
    "eugene-delacroix/the-death-of-sardanapalus@6",
    "eugene-delacroix/the-massacre-at-chios@6",
    "eugene-delacroix/the-barque-of-dante@6",
    "eugene-delacroix/entry-of-the-crusaders-in-constantinople@6",
    "jacques-louis-david/the-coronation-of-napoleon@7",
    "jacques-louis-david/oath-of-the-horatii@7",
    "jacques-louis-david/the-intervention-of-the-sabine-women@7",
    "jacques-louis-david/leonidas-at-thermopylae@7",
    "jacques-louis-david/portrait-of-madame-recamier@7",
    "antoine-jean-gros/bonaparte-visiting-the-plague-victims-of-jaffa@7",
    "antoine-jean-gros/napoleon-on-the-battlefield-of-eylau@7",
    "anne-louis-girodet-de-roussy-trioson/the-burial-of-atala@7",
    "jean-auguste-dominique-ingres/grande-odalisque@7",
  ],
};

// The Louvre's other paintings, not yet to plan (a suite of rooms a floor, joined by the elevator): Richelieu's
// second floor (French painting to the 17th century, the Northern schools, Rubens' Medici gallery) and Sully's
// (French painting from the 17th century). louvre.fr, wilmotte.com (Richelieu).
const LOUVRE_NORTH: Partial<Selection> = {
  title: "The Louvre: Richelieu and Sully",
  museums: ["louvre"],
  max: 160,
  firstFloor: 2,
  floors: "plan",
  intro:
    "The Louvre's second floor: French painting to Poussin, the Northern schools and Rubens' Medici cycle in " +
    "Richelieu, French painting from La Tour to Ingres in Sully.",
  plan: [
    floor({ label: "Richelieu · French painting to 1660", from: 1300, to: 1660, who: FRENCH, style: "museum",
      wall: "#b9b3a8", works: 30, number: 2, intro: "From the court portraits of the 14th century to Poussin and Claude." }),
    floor({ label: "Richelieu · Flemish, Dutch and German painting", from: 1400, to: 1850,
      who: ["Flemish", "Dutch", "Netherlands", "Germans", "Holy Roman Empire"], style: "northern", wall: "#bdb6aa",
      works: 48, number: 2, intro: "Van Eyck, Bosch, Metsys, Rembrandt and Vermeer, in muted, matt rooms with stone floors." }),
    floor({ label: "Richelieu · Galerie Médicis", from: 1620, to: 1626, who: ["Flemish"], style: "palace",
      wall: "#6e2a26", works: 24, number: 2,
      intro: "Rubens' life of Marie de' Medici, painted for the Luxembourg Palace in 1622–1625. In Paris the gallery " +
        "closes in 2026 for four years of restoration; here it stays open." }),
    floor({ label: "Sully · French painting from 1620", from: 1600, to: 1870, who: FRENCH, style: "impressionist",
      wall: "#a9a59c", works: 48, number: 2, intro: "La Tour, Champaigne, Watteau, Chardin, Fragonard and Ingres." }),
  ],
  include: [
    "nicolas-poussin/spring-q26251915",
    "claude-lorrain/sea-port-at-sunset-q24939883",
    "jan-van-eyck/madonna-of-chancellor-rolin",
    "hieronymus-bosch/ship-of-fools-painting",
    "quentin-matsys/the-money-changer-and-his-wife",
    "anthony-van-dyck/charles-i-at-the-hunt",
    "rembrandt/bathsheba-at-her-bath-rembrandt",
    "rembrandt/self-portrait-with-easel-q5712851",
    "rembrandt/slaughtered-ox",
    "johannes-vermeer/the-astronomer",
    "johannes-vermeer/the-lacemaker-vermeer",
    ...MEDICI,
    "georges-de-la-tour/the-card-sharp-with-the-ace-of-diamonds@4",
    "georges-de-la-tour/magdalene-with-the-smoking-flame@4",
    "philippe-de-champaigne/ex-voto-de-1662@4",
    "antoine-watteau/the-embarkation-for-cythera@4",
    "antoine-watteau/pierrot-watteau@4",
    "jean-simeon-chardin/the-ray-chardin@4",
    "francois-boucher/diana-bathing-boucher@4",
    "jean-honore-fragonard/the-bolt-fragonard@4",
    "jean-auguste-dominique-ingres/the-valpincon-bather@4",
    "jean-auguste-dominique-ingres/the-turkish-bath@4",
  ],
};

/** A museum's link; `floor`: the plan floor it opens on (the museum's entrance floor). */
const room = (sel: Partial<Selection>, floor?: number) => selectionQuery({ ...EMPTY_SELECTION, ...sel }, floor);

export const MUSEUM_ROOMS: MuseumRoom[] = [
  {
    slug: "national-gallery-of-greece",
    name: "National Gallery of Greece",
    city: "Athens",
    note: "El Greco, the Ionian School, Gyzis, Lytras and Iakovidis on floor 1, the 20th century on floor 2, European painting on −2, in pale grey halls on white marble.",
    query: room(ATHENS, 2),
  },
  {
    slug: "rijksmuseum",
    name: "Rijksmuseum",
    city: "Amsterdam",
    note: "Four floors by century, from the Middle Ages to 1900, the Golden Age in the Gallery of Honour, in Cuypers' greys.",
    query: room(RIJKS),
  },
  {
    slug: "louvre",
    name: "The Louvre",
    city: "Paris",
    note: "The Denon wing to plan: the Salon Carré, the Grande Galerie, the Mona Lisa's Salle des États, the red rooms of David and Delacroix, walked room to room as the building stands.",
    query: room(LOUVRE),
  },
  {
    slug: "louvre-richelieu-sully",
    name: "The Louvre: Richelieu and Sully",
    city: "Paris",
    note: "The second floor, not yet to plan: French painting to Poussin, the Northern schools, Rubens' Medici cycle, French painting from La Tour to Ingres.",
    query: room(LOUVRE_NORTH),
  },
];

export const museumRoom = (slug: string) => MUSEUM_ROOMS.find((m) => m.slug === slug) ?? null;
