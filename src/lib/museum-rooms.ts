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
  from: null, to: null, style: null, wall: null, works: null, intro: null, who: [], ...f,
});

// The National Gallery – Alexandros Soutsos Museum, Athens, as rehung in its new wing (2021): floor 1 the
// post-Byzantine and 19th-century collection, floor 2 the 20th century; grey-blue walls, marble floors, light
// from the ceiling. nationalgallery.gr (floor plan, permanent exhibition), lifo.gr (interiors).
const ATHENS: Partial<Selection> = {
  title: "National Gallery of Greece",
  museums: ["national-gallery-of-greece"],
  style: "museum",
  wall: "#8e9ba5",
  max: 96,
  firstFloor: 1,
  floors: "plan",
  intro:
    "The National Gallery – Alexandros Soutsos Museum in Athens, as rehung in 2021 in its new wing: grey-blue " +
    "walls, marble floors, daylight from the ceiling. Its works in this collection, floor by floor.",
  plan: [
    floor({
      label: "From El Greco to 1900",
      to: 1909,
      works: 66,
      intro:
        "Post-Byzantine art and the Cretan School, Domenicos Theotokopoulos, the Ionian School, the painting of the " +
        "free Greek state under King Othon, the bourgeois class and its painters, and the years around 1900.",
    }),
    floor({
      label: "The 20th century",
      from: 1910,
      to: 1960,
      works: 30,
      intro: "From the Omada Techni of 1917 to the Generation of the Thirties.",
    }),
  ],
  include: [
    "el-greco/concert-of-angels",
    "el-greco/the-entombment-of-christ-el-greco",
    "stephanos-tzangarolas/adoration-of-the-shepherds-tzangarolas",
    "nikolaos-doxaras/kimisis-tis-theotokou-doxaras-q135687053@1",
    "theodoros-vryzakis/the-reception-of-lord-byron-at-missolonghi",
    "theodoros-vryzakis/wikiart-the-old-patras-germanos-blesses-the-flag-of-the-revolution-1865",
    "theodoros-vryzakis/grateful-hellas-q19597999",
    "nikiforos-lytras/the-dirge-in-psara",
    "nikolaos-gyzis/the-betrothal-of-the-children-q12885237",
    "nikolaos-gyzis/wikiart-carnival-in-athens-1892",
    "nikolaos-gyzis/wikiart-the-slave-market-1875",
    "nikolaos-gyzis/behold-the-bridegroom-arriving",
    "nikolaos-gyzis/after-the-destruction-of-psara-q112669163@1",
    "nikolaos-gyzis/the-spider-q24259028",
    "nikolaos-gyzis/spring-symphony-q24083094",
    "georgios-jakobides/children-s-concert-q56706738",
    "georgios-jakobides/grandma-s-favorite-q56706785",
    "georgios-jakobides/cold-shower-q56706798",
    "konstantinos-volanakis/wikiart-1883-1885",
    "pericles-pantazis/wikiart-lady-in-the-mirror-with-a-fan-1882",
    "ioannis-altamouras/caique-at-spetses-q22671102",
    "theodore-ralli/vespers-ralli-q136341765@1",
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
    floor({ label: "1600–1700 · Gallery of Honour", from: 1600, to: 1699, wall: "#5f605d", works: 60,
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
].map((w) => `peter-paul-rubens/${w}@6`);

// The Louvre's paintings: Denon's first floor (Italian painting in the Salon Carré and the Grande Galerie, the
// Mona Lisa in the Salle des États, large French painting in the red rooms), Richelieu's second floor (French
// painting to the 17th century, the Northern schools, Rubens' Medici gallery), Sully's second floor (French
// painting from the 17th century). louvre.fr, presse.louvre.fr (Salle des États 2019, Salon Carré 2021),
// wilmotte.com (Richelieu).
const ITALIANS = ["Italians", "Dominicans", "Republic of Venice", "Duchy of Urbino", "Duchy of Milan"];
const FRENCH = ["French", "France"];
const LOUVRE: Partial<Selection> = {
  title: "The Louvre: paintings",
  museums: ["louvre"],
  max: 240,
  firstFloor: 1,
  floors: "plan",
  intro:
    "The Louvre's paintings, gallery by gallery: Italian painting under the Grande Galerie's skylights, the " +
    "Mona Lisa on midnight blue, David and Delacroix in the red rooms, the Northern schools and Rubens' Medici " +
    "cycle in Richelieu, French painting in Sully.",
  plan: [
    floor({ label: "Denon · Salon Carré and Grande Galerie", from: 1250, to: 1800, who: ITALIANS, style: "impressionist",
      wall: "#b8b0a2", works: 48, intro: "Italian painting from Cimabue and Giotto to the 18th century, under skylights." }),
    floor({ label: "Denon · Salle des États", from: 1500, to: 1600, who: ["Italians"], style: "impressionist",
      wall: "#1c2433", works: 12,
      intro: "The Mona Lisa and, across the room, Veronese's Wedding at Cana: Venice in the 16th century, on midnight blue." }),
    floor({ label: "Denon · The red rooms", from: 1780, to: 1850, who: FRENCH, style: "old-master", wall: "#8a2b27",
      works: 30, intro: "The Salles Daru, Denon and Mollien: French painting on the grand scale, from David to Delacroix." }),
    floor({ label: "Richelieu · French painting to 1660", from: 1300, to: 1660, who: FRENCH, style: "museum",
      wall: "#b9b3a8", works: 30, intro: "From the court portraits of the 14th century to Poussin and Claude." }),
    floor({ label: "Richelieu · Flemish, Dutch and German painting", from: 1400, to: 1850,
      who: ["Flemish", "Dutch", "Netherlands", "Germans", "Holy Roman Empire"], style: "northern", wall: "#bdb6aa",
      works: 48, intro: "Van Eyck, Bosch, Metsys, Rembrandt and Vermeer, in muted, matt rooms with stone floors." }),
    floor({ label: "Richelieu · Galerie Médicis", from: 1620, to: 1626, who: ["Flemish"], style: "old-master",
      wall: "#6e2a26", works: 24,
      intro: "Rubens' life of Marie de' Medici, painted for the Luxembourg Palace in 1622–1625. In Paris the gallery " +
        "closes in 2026 for four years of restoration; here it stays open." }),
    floor({ label: "Sully · French painting from 1620", from: 1600, to: 1870, who: FRENCH, style: "impressionist",
      wall: "#a9a59c", works: 48, intro: "La Tour, Champaigne, Watteau, Chardin, Fragonard and Ingres." }),
  ],
  include: [
    "cimabue/maesta-cimabue",
    "giotto/saint-francis-receiving-the-stigmata-giotto",
    "fra-angelico/coronation-of-the-virgin-fra-angelico-louvre",
    "paolo-uccello/the-decisive-attack-of-micheletto-attendolo-at-san-romano-q18564226@1",
    "leonardo-da-vinci/virgin-of-the-rocks-q11935346",
    "leonardo-da-vinci/the-virgin-and-child-with-saint-anne-leonardo",
    "leonardo-da-vinci/saint-john-the-baptist-leonardo",
    "leonardo-da-vinci/la-belle-ferronniere",
    "raphael/la-belle-jardiniere",
    "raphael/portrait-of-baldassare-castiglione",
    "andrea-mantegna/st-sebastian-q18565594@1",
    "antonello-da-messina/portrait-of-a-man-called-condottiere-q15935001",
    "domenico-ghirlandaio/an-old-man-and-his-grandson",
    "caravaggio/death-of-the-virgin-caravaggio",
    "caravaggio/the-fortune-teller-caravaggio",
    "giuseppe-arcimboldo/the-four-seasons-arcimboldo",
    "leonardo-da-vinci/mona-lisa@2",
    "paolo-veronese/the-wedding-at-cana-veronese@2",
    "titian/pastoral-concert@2",
    "titian/man-with-a-glove@2",
    "titian/the-crowning-with-thorns-titian-paris@2",
    "tintoretto/self-portrait-tintoretto@2",
    "jacques-louis-david/oath-of-the-horatii",
    "jacques-louis-david/the-intervention-of-the-sabine-women",
    "jacques-louis-david/portrait-of-madame-recamier",
    "jacques-louis-david/the-coronation-of-napoleon",
    "anne-louis-girodet-de-roussy-trioson/the-burial-of-atala",
    "jean-auguste-dominique-ingres/grande-odalisque",
    "theodore-gericault/the-raft-of-the-medusa",
    "eugene-delacroix/the-death-of-sardanapalus",
    "eugene-delacroix/liberty-leading-the-people",
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
    "georges-de-la-tour/the-card-sharp-with-the-ace-of-diamonds@7",
    "georges-de-la-tour/magdalene-with-the-smoking-flame@7",
    "philippe-de-champaigne/ex-voto-de-1662@7",
    "antoine-watteau/the-embarkation-for-cythera@7",
    "antoine-watteau/pierrot-watteau@7",
    "jean-simeon-chardin/the-ray-chardin@7",
    "francois-boucher/diana-bathing-boucher@7",
    "jean-honore-fragonard/the-bolt-fragonard@7",
    "jean-auguste-dominique-ingres/the-valpincon-bather@7",
    "jean-auguste-dominique-ingres/the-turkish-bath@7",
  ],
};

const room = (sel: Partial<Selection>) => selectionQuery({ ...EMPTY_SELECTION, ...sel });

export const MUSEUM_ROOMS: MuseumRoom[] = [
  {
    slug: "national-gallery-of-greece",
    name: "National Gallery of Greece",
    city: "Athens",
    note: "El Greco, the Ionian School, Gyzis, Lytras and Iakovidis on floor 1, the 20th century on floor 2, in the new wing's grey-blue and marble.",
    query: room(ATHENS),
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
    note: "Seven galleries: the Grande Galerie, the Mona Lisa's Salle des États, the red rooms, the Northern schools, Rubens' Medici cycle, Sully's French painting.",
    query: room(LOUVRE),
  },
];

export const museumRoom = (slug: string) => MUSEUM_ROOMS.find((m) => m.slug === slug) ?? null;
