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
    artists: [
      "Giotto",
      "Cimabue",
      "Duccio",
      "Simone Martini",
      "Gentile da Fabriano"
    ]
  },
  {
    slug: "early-renaissance",
    name: "Early Renaissance",
    wikiTitle: "Renaissance art",
    startYear: 1400,
    endYear: 1495,
    color: "#9c6b30",
    artists: [
      "Sandro Botticelli",
      "Fra Angelico",
      "Masaccio",
      "Filippo Lippi",
      "Piero della Francesca",
      "Andrea Mantegna",
      "Giovanni Bellini",
      "Pietro Perugino",
      "Paolo Uccello",
      "Andrea del Castagno",
      "Antonio del Pollaiuolo",
      "Antonello da Messina",
      "Gentile Bellini",
      "Filippino Lippi",
      "Pinturicchio",
      "Luca Signorelli",
      "Vittore Carpaccio",
      "Piero di Cosimo"
    ]
  },
  {
    slug: "northern-renaissance",
    name: "Northern Renaissance",
    wikiTitle: "Northern Renaissance",
    startYear: 1420,
    endYear: 1580,
    color: "#56704f",
    artists: [
      "Jan van Eyck",
      "Rogier van der Weyden",
      "Hans Memling",
      "Hieronymus Bosch",
      "Albrecht Dürer",
      "Lucas Cranach the Elder",
      "Hans Holbein the Younger",
      "Pieter Bruegel the Elder",
      "Petrus Christus",
      "Gerard David",
      "Quentin Matsys",
      "Albrecht Altdorfer",
      "Hans Baldung",
      "Matthias Grünewald"
    ]
  },
  {
    slug: "high-renaissance",
    name: "High Renaissance",
    wikiTitle: "High Renaissance",
    startYear: 1495,
    endYear: 1530,
    color: "#b08020",
    artists: [
      "Leonardo da Vinci",
      "Michelangelo",
      "Raphael",
      "Titian",
      "Giorgione",
      "Antonio da Correggio",
      "Andrea del Sarto",
      "Lorenzo Lotto",
      "Sebastiano del Piombo",
      "Giulio Romano"
    ]
  },
  {
    slug: "mannerism",
    name: "Mannerism",
    wikiTitle: "Mannerism",
    startYear: 1520,
    endYear: 1600,
    color: "#8e7c4a",
    artists: [
      "Pontormo",
      "Parmigianino",
      "Bronzino",
      "Sofonisba Anguissola",
      "Giuseppe Arcimboldo",
      "Tintoretto",
      "Paolo Veronese",
      "El Greco",
      "Rosso Fiorentino"
    ]
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
      "Peter Paul Rubens",
      "Artemisia Gentileschi",
      "Diego Velázquez",
      "Anthony van Dyck",
      "Nicolas Poussin",
      "Claude Lorrain",
      "Georges de La Tour",
      "Francisco de Zurbarán",
      "Bartolomé Esteban Murillo",
      "Annibale Carracci",
      "Guido Reni",
      "Guercino",
      "Jusepe de Ribera",
      "Simon Vouet",
      "Philippe de Champaigne",
      "Jacob Jordaens",
      "Jan Brueghel the Elder",
      "Luca Giordano",
      "Godfrey Kneller"
    ]
  },
  {
    slug: "dutch-golden-age",
    name: "Dutch Golden Age",
    wikiTitle: "Dutch Golden Age painting",
    startYear: 1588,
    endYear: 1720,
    color: "#3f5f78",
    artists: [
      "Rembrandt",
      "Johannes Vermeer",
      "Frans Hals",
      "Judith Leyster",
      "Jan Steen",
      "Pieter de Hooch",
      "Jacob van Ruisdael",
      "Gerard ter Borch",
      "Gerrit Dou"
    ]
  },
  {
    slug: "rococo",
    name: "Rococo",
    wikiTitle: "Rococo",
    startYear: 1700,
    endYear: 1780,
    color: "#c98da4",
    artists: [
      "Antoine Watteau",
      "François Boucher",
      "Jean-Honoré Fragonard",
      "Giovanni Battista Tiepolo",
      "Canaletto",
      "Jean Siméon Chardin",
      "William Hogarth",
      "Thomas Gainsborough",
      "Joseph Wright of Derby",
      "Joshua Reynolds",
      "Bernardo Bellotto",
      "Claude-Joseph Vernet",
      "John Singleton Copley"
    ]
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
      "Angelica Kauffman",
      "Antoine-Jean Gros"
    ]
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
      "Henry Fuseli",
      "William Blake",
      "Eugène Delacroix",
      "J. M. W. Turner",
      "John Constable",
      "Caspar David Friedrich",
      "Théodore Géricault",
      "Francesco Hayez",
      "Ivan Aivazovsky",
      "Emanuel Leutze",
      "Thomas Lawrence",
      "Paul Delaroche",
      "Horace Vernet",
      "William Etty",
      "Gustave Doré",
      "Carl Spitzweg"
    ]
  },
  {
    slug: "hudson-river-school",
    name: "Hudson River School",
    wikiTitle: "Hudson River School",
    startYear: 1825,
    endYear: 1880,
    color: "#6f7d43",
    artists: [
      "Thomas Cole",
      "Frederic Edwin Church",
      "Albert Bierstadt"
    ]
  },
  {
    slug: "academic-art",
    name: "Academic Art",
    wikiTitle: "Academic art",
    startYear: 1830,
    endYear: 1900,
    color: "#94705a",
    artists: [
      "Karl Bryullov",
      "Jean-Léon Gérôme",
      "Alexandre Cabanel",
      "William-Adolphe Bouguereau",
      "Frederic Leighton",
      "Jan Matejko",
      "Raja Ravi Varma",
      "Franz Xaver Winterhalter",
      "Ernest Meissonier",
      "Lawrence Alma-Tadema",
      "James Tissot",
      "Osman Hamdi Bey"
    ]
  },
  {
    slug: "realism",
    name: "Realism",
    wikiTitle: "Realism (art movement)",
    startYear: 1840,
    endYear: 1880,
    color: "#5c6b4f",
    artists: [
      "Jean-Baptiste-Camille Corot",
      "Honoré Daumier",
      "Gustave Courbet",
      "Jean-François Millet",
      "Ivan Shishkin",
      "Ivan Kramskoi",
      "Ilya Repin",
      "James McNeill Whistler",
      "Winslow Homer",
      "Thomas Eakins",
      "John Singer Sargent",
      "Adolph Menzel",
      "Isaac Levitan",
      "Albert Edelfelt"
    ]
  },
  {
    slug: "pre-raphaelites",
    name: "Pre-Raphaelites",
    wikiTitle: "Pre-Raphaelite Brotherhood",
    startYear: 1848,
    endYear: 1900,
    color: "#8a4f5c",
    artists: [
      "Dante Gabriel Rossetti",
      "John Everett Millais",
      "Edward Burne-Jones",
      "John William Waterhouse",
      "Ford Madox Brown",
      "William Holman Hunt"
    ]
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
      "Camille Pissarro",
      "Alfred Sisley",
      "Berthe Morisot",
      "Mary Cassatt",
      "Gustave Caillebotte",
      "Frédéric Bazille",
      "Henri Fantin-Latour",
      "Giovanni Boldini",
      "Peder Severin Krøyer",
      "Joaquín Sorolla"
    ]
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
      "Paul Signac",
      "Henri de Toulouse-Lautrec",
      "Henri Rousseau",
      "Pierre Bonnard"
    ]
  },
  {
    slug: "symbolism",
    name: "Symbolism & Art Nouveau",
    wikiTitle: "Symbolism (movement)",
    startYear: 1880,
    endYear: 1915,
    color: "#b39235",
    artists: [
      "Gustave Moreau",
      "Arnold Böcklin",
      "Mikhail Vrubel",
      "Gustav Klimt"
    ]
  },
  {
    slug: "fauvism",
    name: "Fauvism",
    wikiTitle: "Fauvism",
    startYear: 1904,
    endYear: 1910,
    color: "#d0603a",
    artists: [
      "Henri Matisse",
      "André Derain"
    ]
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
      "Amedeo Modigliani",
      "Marc Chagall",
      "Otto Dix",
      "Max Beckmann",
      "Lovis Corinth",
      "August Macke",
      "George Grosz",
      "Amrita Sher-Gil"
    ]
  },
  {
    slug: "cubism",
    name: "Cubism",
    wikiTitle: "Cubism",
    startYear: 1907,
    endYear: 1925,
    color: "#4f6b6b",
    artists: [
      "Pablo Picasso",
      "Georges Braque",
      "Juan Gris",
      "Fernand Léger",
      "Marcel Duchamp",
      "Robert Delaunay",
      "Umberto Boccioni"
    ]
  },
  {
    slug: "abstract-art",
    name: "Abstract Art",
    wikiTitle: "Abstract art",
    startYear: 1910,
    endYear: 1945,
    color: "#2f5d8a",
    artists: [
      "Wassily Kandinsky",
      "Kazimir Malevich",
      "Piet Mondrian",
      "Paul Klee"
    ]
  },
  {
    slug: "surrealism",
    name: "Surrealism",
    wikiTitle: "Surrealism",
    startYear: 1924,
    endYear: 1955,
    color: "#4a5a8a",
    artists: [
      "Giorgio de Chirico",
      "Salvador Dalí",
      "René Magritte",
      "Max Ernst",
      "Joan Miró",
      "Frida Kahlo",
      "Paul Delvaux"
    ]
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
      "Andrew Wyeth",
      "Grandma Moses"
    ]
  },
  {
    slug: "abstract-expressionism",
    name: "Abstract Expressionism",
    wikiTitle: "Abstract expressionism",
    startYear: 1943,
    endYear: 1965,
    color: "#8a3a3a",
    artists: [
      "Jackson Pollock",
      "Mark Rothko",
      "Willem de Kooning",
      "Barnett Newman"
    ]
  },
  {
    slug: "pop-art",
    name: "Pop Art",
    wikiTitle: "Pop art",
    startYear: 1955,
    endYear: 1975,
    color: "#c94f7c",
    artists: [
      "Andy Warhol",
      "Roy Lichtenstein",
      "David Hockney",
      "Jasper Johns"
    ]
  },
  {
    slug: "contemporary",
    name: "Contemporary",
    wikiTitle: "Contemporary art",
    startYear: 1945,
    endYear: 2026,
    color: "#3f7d6e",
    artists: [
      "Francis Bacon (artist)",
      "Lucian Freud",
      "Jean-Michel Basquiat",
      "Keith Haring",
      "Banksy",
      "Gerhard Richter"
    ]
  }
];

// Specific painting articles to include for artists whose Wikidata/category
// coverage misses works that do have illustrated Wikipedia articles.
export const EXTRA_PAINTINGS: Record<string, string[]> = {
  // Famous works whose Wikidata items aren't linked to the artist (or carry
  // another class) and that aren't in the artist's "Paintings by" category.
  "Francisco Goya": ["La maja desnuda"],
  "Pieter Bruegel the Elder": ["Landscape with the Fall of Icarus"],
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
