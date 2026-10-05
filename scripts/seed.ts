// Curated index of periods and artists. Only names/date-ranges/colors live here —
// every bio, image, story and fact is fetched from Wikipedia/Wikimedia at ingest time.

export interface SeedPeriod {
  slug: string;
  name: string;
  wikiTitle: string; // English Wikipedia article describing the period
  startYear: number;
  endYear: number;
  color: string; // accent used across timeline views
  artists: string[]; // English Wikipedia article titles
}

export const PERIODS: SeedPeriod[] = [
  {
    slug: "medieval-gothic",
    name: "Medieval & Gothic",
    wikiTitle: "Gothic art",
    startYear: 1200,
    endYear: 1400,
    color: "#7a5c3e",
    artists: ["Giotto", "Cimabue", "Duccio", "Simone Martini"],
  },
  {
    slug: "early-renaissance",
    name: "Early Renaissance",
    wikiTitle: "Renaissance art",
    startYear: 1400,
    endYear: 1495,
    color: "#9c6b30",
    artists: ["Jan van Eyck", "Sandro Botticelli", "Fra Angelico", "Masaccio"],
  },
  {
    slug: "high-renaissance",
    name: "High Renaissance",
    wikiTitle: "High Renaissance",
    startYear: 1495,
    endYear: 1530,
    color: "#b08020",
    artists: ["Leonardo da Vinci", "Michelangelo", "Raphael", "Titian"],
  },
  {
    slug: "mannerism",
    name: "Mannerism",
    wikiTitle: "Mannerism",
    startYear: 1520,
    endYear: 1600,
    color: "#8e7c4a",
    artists: ["El Greco", "Tintoretto", "Paolo Veronese"],
  },
  {
    slug: "baroque",
    name: "Baroque",
    wikiTitle: "Baroque painting",
    startYear: 1600,
    endYear: 1725,
    color: "#6e3b23",
    artists: [
      "Caravaggio",
      "Rembrandt",
      "Johannes Vermeer",
      "Peter Paul Rubens",
      "Diego Velázquez",
      "Artemisia Gentileschi",
    ],
  },
  {
    slug: "rococo",
    name: "Rococo",
    wikiTitle: "Rococo",
    startYear: 1700,
    endYear: 1780,
    color: "#c98da4",
    artists: ["Antoine Watteau", "François Boucher", "Jean-Honoré Fragonard"],
  },
  {
    slug: "neoclassicism",
    name: "Neoclassicism",
    wikiTitle: "Neoclassicism",
    startYear: 1760,
    endYear: 1830,
    color: "#5f7d8c",
    artists: [
      "Jacques-Louis David",
      "Jean-Auguste-Dominique Ingres",
      "Élisabeth Vigée Le Brun",
    ],
  },
  {
    slug: "romanticism",
    name: "Romanticism",
    wikiTitle: "Romanticism",
    startYear: 1780,
    endYear: 1850,
    color: "#7d4b66",
    artists: [
      "Francisco Goya",
      "Eugène Delacroix",
      "J. M. W. Turner",
      "Caspar David Friedrich",
      "Théodore Géricault",
    ],
  },
  {
    slug: "realism",
    name: "Realism",
    wikiTitle: "Realism (art movement)",
    startYear: 1840,
    endYear: 1880,
    color: "#5c6b4f",
    artists: ["Gustave Courbet", "Jean-François Millet", "Ilya Repin"],
  },
  {
    slug: "impressionism",
    name: "Impressionism",
    wikiTitle: "Impressionism",
    startYear: 1860,
    endYear: 1895,
    color: "#6f8fc9",
    artists: [
      "Claude Monet",
      "Pierre-Auguste Renoir",
      "Edgar Degas",
      "Édouard Manet",
      "Berthe Morisot",
      "Mary Cassatt",
    ],
  },
  {
    slug: "post-impressionism",
    name: "Post-Impressionism",
    wikiTitle: "Post-Impressionism",
    startYear: 1885,
    endYear: 1910,
    color: "#d9913d",
    artists: [
      "Vincent van Gogh",
      "Paul Cézanne",
      "Paul Gauguin",
      "Georges Seurat",
      "Henri de Toulouse-Lautrec",
    ],
  },
  {
    slug: "expressionism",
    name: "Expressionism",
    wikiTitle: "Expressionism",
    startYear: 1905,
    endYear: 1935,
    color: "#b3452f",
    artists: [
      "Edvard Munch",
      "Ernst Ludwig Kirchner",
      "Egon Schiele",
      "Franz Marc",
    ],
  },
  {
    slug: "cubism",
    name: "Cubism",
    wikiTitle: "Cubism",
    startYear: 1907,
    endYear: 1925,
    color: "#4f6b6b",
    artists: ["Pablo Picasso", "Georges Braque", "Juan Gris", "Fernand Léger"],
  },
  {
    slug: "surrealism",
    name: "Surrealism",
    wikiTitle: "Surrealism",
    startYear: 1924,
    endYear: 1955,
    color: "#4a5a8a",
    artists: [
      "Salvador Dalí",
      "René Magritte",
      "Max Ernst",
      "Joan Miró",
      "Frida Kahlo",
    ],
  },
  {
    slug: "american-modernism",
    name: "American Modernism",
    wikiTitle: "American modernism",
    startYear: 1913,
    endYear: 1960,
    color: "#7592b8",
    artists: [
      "Edward Hopper",
      "Georgia O'Keeffe",
      "Norman Rockwell",
      "Grant Wood",
    ],
  },
  {
    slug: "abstract-expressionism",
    name: "Abstract Expressionism",
    wikiTitle: "Abstract expressionism",
    startYear: 1943,
    endYear: 1965,
    color: "#8a3a3a",
    artists: ["Jackson Pollock", "Mark Rothko", "Willem de Kooning"],
  },
  {
    slug: "pop-art",
    name: "Pop Art",
    wikiTitle: "Pop art",
    startYear: 1955,
    endYear: 1975,
    color: "#c94f7c",
    artists: ["Andy Warhol", "Roy Lichtenstein", "David Hockney"],
  },
  {
    slug: "contemporary",
    name: "Contemporary",
    wikiTitle: "Contemporary art",
    startYear: 1945,
    endYear: 2026,
    color: "#3f7d6e",
    artists: [
      "Jean-Michel Basquiat",
      "Francis Bacon (artist)",
      "Keith Haring",
    ],
  },
];

// Specific painting articles to include for artists whose Wikidata/category
// coverage misses works that do have illustrated Wikipedia articles.
export const EXTRA_PAINTINGS: Record<string, string[]> = {
  "Willem de Kooning": [
    "Police Gazette (painting)",
    "Woman VI",
    "Woman I",
    "Woman III",
  ],
  "David Hockney": [
    "A Bigger Splash",
    "Mr and Mrs Clark and Percy",
    "Bigger Trees Near Warter",
    "Portrait of an Artist (Pool with Two Figures)",
    "Peter Getting Out of Nick's Pool",
  ],
};
