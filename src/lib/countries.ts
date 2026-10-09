// Where an artist is from, as one present-day country and its continent, for the Explore panel's filters.
//
// The facts come from data/site/rooms.json (archive/site.py): WikiArt's nationalities ("Russians", "Flemish") and
// Wikidata's countries of citizenship, many of them historical states ("Dutch Republic", "Qing dynasty"). Each maps
// to the country that holds the place today. Wikipedia's short description ("German-born British painter") breaks
// ties and covers the few artists with neither. Anything unknown maps to null: the artist is in no facet.

export type Continent = "Europe" | "Asia" | "Africa" | "North America" | "South America" | "Oceania";

/** The facet order. */
export const CONTINENTS: readonly Continent[] = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania"];

/** Present-day country → continent (UN geoscheme; Russia counts as Europe, Turkey and the Caucasus as Asia). */
export const CONTINENT_OF: Readonly<Record<string, Continent>> = {
  Albania: "Europe", Austria: "Europe", Belarus: "Europe", Belgium: "Europe", Bulgaria: "Europe",
  Croatia: "Europe", "Czech Republic": "Europe", Denmark: "Europe", Estonia: "Europe", Finland: "Europe",
  France: "Europe", Germany: "Europe", Greece: "Europe", Hungary: "Europe", Iceland: "Europe", Ireland: "Europe",
  Italy: "Europe", Latvia: "Europe", Lithuania: "Europe", Luxembourg: "Europe", Netherlands: "Europe",
  Norway: "Europe", Poland: "Europe", Portugal: "Europe", Romania: "Europe", Russia: "Europe", Serbia: "Europe",
  Slovakia: "Europe", Slovenia: "Europe", Spain: "Europe", Sweden: "Europe", Switzerland: "Europe",
  Ukraine: "Europe", "United Kingdom": "Europe",
  Armenia: "Asia", China: "Asia", Georgia: "Asia", India: "Asia", Indonesia: "Asia", Iran: "Asia", Iraq: "Asia",
  Israel: "Asia", Japan: "Asia", "South Korea": "Asia", Lebanon: "Asia", Pakistan: "Asia", Philippines: "Asia",
  Syria: "Asia", Turkey: "Asia", Vietnam: "Asia",
  Algeria: "Africa", Egypt: "Africa", Ethiopia: "Africa", Morocco: "Africa", Nigeria: "Africa",
  Senegal: "Africa", "South Africa": "Africa",
  Canada: "North America", Cuba: "North America", "Dominican Republic": "North America", Haiti: "North America",
  Mexico: "North America", "United States": "North America",
  Argentina: "South America", Brazil: "South America", Chile: "South America", Colombia: "South America",
  Peru: "South America", Uruguay: "South America", Venezuela: "South America",
  Australia: "Oceania", "New Zealand": "Oceania",
};

/**
 * Demonyms, lower case: WikiArt's plural nationalities ("italians", "japaneses", "irishes") and the adjectives
 * of Wikipedia's short descriptions. Faiths and peoples without a state of their own ("jewish") are left out.
 */
const DEMONYM: Readonly<Record<string, string>> = {
  american: "United States", americans: "United States",
  argentine: "Argentina", argentines: "Argentina", argentinian: "Argentina", argentinians: "Argentina",
  armenian: "Armenia", armenians: "Armenia",
  australian: "Australia", australians: "Australia",
  austrian: "Austria", austrians: "Austria",
  belarusian: "Belarus", belarusians: "Belarus",
  belgian: "Belgium", belgians: "Belgium", flemish: "Belgium",
  brazilian: "Brazil", brazilians: "Brazil",
  british: "United Kingdom", english: "United Kingdom", scottish: "United Kingdom", scots: "United Kingdom",
  welsh: "United Kingdom",
  bulgarian: "Bulgaria", bulgarians: "Bulgaria",
  canadian: "Canada", canadians: "Canada",
  chilean: "Chile", chileans: "Chile",
  chinese: "China",
  colombian: "Colombia", colombians: "Colombia",
  croatian: "Croatia", croatians: "Croatia",
  cuban: "Cuba", cubans: "Cuba",
  czech: "Czech Republic", czechs: "Czech Republic", bohemian: "Czech Republic",
  danish: "Denmark", danes: "Denmark",
  dominicans: "Dominican Republic", // the plural only: "Dominican" is also the friars' order
  dutch: "Netherlands",
  egyptian: "Egypt", egyptians: "Egypt",
  estonian: "Estonia", estonians: "Estonia",
  finnish: "Finland", finns: "Finland",
  french: "France",
  georgians: "Georgia", // the plural only: "Georgian" is also Britain's 18th century
  german: "Germany", germans: "Germany",
  greek: "Greece", greeks: "Greece",
  hungarian: "Hungary", hungarians: "Hungary",
  icelandic: "Iceland", icelanders: "Iceland",
  indian: "India", indians: "India",
  indonesian: "Indonesia", indonesians: "Indonesia",
  iranian: "Iran", iranians: "Iran", persian: "Iran", persians: "Iran",
  irish: "Ireland", irishes: "Ireland",
  israeli: "Israel", israelis: "Israel",
  italian: "Italy", italians: "Italy", venetian: "Italy", florentine: "Italy", sienese: "Italy",
  japanese: "Japan", japaneses: "Japan",
  korean: "South Korea", koreans: "South Korea",
  latvian: "Latvia", latvians: "Latvia",
  lithuanian: "Lithuania", lithuanians: "Lithuania",
  mexican: "Mexico", mexicans: "Mexico",
  norwegian: "Norway", norwegians: "Norway",
  pakistani: "Pakistan", pakistanis: "Pakistan",
  peruvian: "Peru", peruvians: "Peru",
  filipino: "Philippines", filipinos: "Philippines",
  polish: "Poland", poles: "Poland",
  portuguese: "Portugal",
  romanian: "Romania", romanians: "Romania",
  russian: "Russia", russians: "Russia",
  serbian: "Serbia", serbians: "Serbia", serbs: "Serbia",
  slovak: "Slovakia", slovaks: "Slovakia",
  slovenian: "Slovenia", slovenians: "Slovenia",
  spanish: "Spain", spaniards: "Spain",
  swedish: "Sweden", swedes: "Sweden",
  swiss: "Switzerland",
  turkish: "Turkey", turks: "Turkey",
  ukrainian: "Ukraine", ukrainians: "Ukraine",
  uruguayan: "Uruguay", uruguayans: "Uruguay",
};

/**
 * Wikidata's countries of citizenship → the country that holds the place today. Empires that spanned several of
 * today's countries map to their heartland (the Ottoman Empire to Turkey); the nationality, when known, outweighs
 * them. The Holy Roman Empire and statelessness say nothing.
 */
const STATE: Readonly<Record<string, string | null>> = {
  "Holy Roman Empire": null, statelessness: null,
  // the Low Countries
  "Dutch Republic": "Netherlands", "Kingdom of the Netherlands": "Netherlands", "Northern Low Countries": "Netherlands",
  "Habsburg Netherlands": "Belgium", "Southern Netherlands": "Belgium", "Spanish Netherlands": "Belgium",
  "Austrian Netherlands": "Belgium", "Burgundian Netherlands": "Belgium", "Duchy of Brabant": "Belgium",
  "County of Flanders": "Belgium",
  // Italy
  "Kingdom of Italy": "Italy", "Republic of Venice": "Italy", "Republic of Florence": "Italy",
  "Duchy of Florence": "Italy", "Grand Duchy of Tuscany": "Italy", "Republic of Siena": "Italy",
  "Republic of Pisa": "Italy", "Republic of Genoa": "Italy", "Duchy of Milan": "Italy", "Duchy of Urbino": "Italy",
  "Duchy of Mantua": "Italy", "Duchy of Ferrara": "Italy", "Duchy of Parma": "Italy", "Papal States": "Italy",
  "Kingdom of Naples": "Italy", "Kingdom of Sicily": "Italy", "Kingdom of the Two Sicilies": "Italy",
  "Kingdom of Sardinia": "Italy", "seigneurie de Pérouse": "Italy", "Signoria di Correggio": "Italy",
  // France
  "Kingdom of France": "France", "French constitutional monarchy": "France", "French First Republic": "France",
  "First French Empire": "France", "Second French Empire": "France", "French Third Republic": "France",
  "Duchy of Lorraine": "France", "Duchy of Burgundy": "France",
  // Britain and Ireland
  "Kingdom of England": "United Kingdom", "Kingdom of Scotland": "United Kingdom",
  "Kingdom of Great Britain": "United Kingdom", "United Kingdom of Great Britain and Ireland": "United Kingdom",
  "British Empire": "United Kingdom", "Irish Free State": "Ireland", "Kingdom of Ireland": "Ireland",
  // the German lands, Austria and Switzerland
  "German Empire": "Germany", "German Reich": "Germany", "Weimar Republic": "Germany", "Nazi Germany": "Germany",
  "West Germany": "Germany", "East Germany": "Germany", "German Confederation": "Germany",
  "Kingdom of Prussia": "Germany", "Kingdom of Bavaria": "Germany", "Duchy of Bavaria": "Germany",
  "Electorate of Bavaria": "Germany", "Kingdom of Saxony": "Germany", "Electorate of Saxony": "Germany",
  "Kingdom of Württemberg": "Germany", "Grand Duchy of Baden": "Germany", "Kingdom of Hanover": "Germany",
  "Austrian Empire": "Austria", "Austria–Hungary": "Austria", "Austria-Hungary": "Austria", Cisleithania: "Austria",
  "Archduchy of Austria": "Austria", "Habsburg monarchy": "Austria", "Three Leagues": "Switzerland",
  "Old Swiss Confederacy": "Switzerland",
  // Iberia
  "Crown of Castile": "Spain", "Crown of Aragon": "Spain", "Kingdom of Granada": "Spain",
  "Spanish Empire": "Spain", "Kingdom of Portugal": "Portugal",
  // central and eastern Europe
  "Russian Empire": "Russia", "Soviet Union": "Russia", "Russian Republic": "Russia",
  "Russian Soviet Federative Socialist Republic": "Russia", "Russian Socialist Federative Soviet Republic": "Russia",
  "Grand Principality of Moscow": "Russia", "Tsardom of Russia": "Russia",
  "Second Polish Republic": "Poland", "Polish–Lithuanian Commonwealth": "Poland", "Free City of Kraków": "Poland",
  "Congress Poland": "Poland", "Kingdom of Galicia and Lodomeria": "Poland",
  Czechoslovakia: "Czech Republic", "First Czechoslovak Republic": "Czech Republic",
  "Second Czechoslovak Republic": "Czech Republic", "Kingdom of Bohemia": "Czech Republic",
  "Kingdom of Hungary": "Hungary", "Grand Duchy of Finland": "Finland", "Kingdom of Romania": "Romania",
  "Kingdom of Denmark": "Denmark", "Denmark–Norway": "Denmark", "Swedish Empire": "Sweden",
  // Greece, Byzantium and the Ottomans
  "Kingdom of Greece": "Greece", "Septinsular Republic": "Greece", "United States of the Ionian Islands": "Greece",
  "Byzantine Empire": "Greece", "Ottoman Empire": "Turkey",
  // Asia
  "Empire of Japan": "Japan", "Edo period": "Japan", "Tokugawa shogunate": "Japan",
  "Song dynasty": "China", "Northern Song dynasty": "China", "Southern Song dynasty": "China",
  "Tang dynasty": "China", "Southern Tang": "China", "Later Han dynasty": "China", "Later Jin dynasty": "China",
  "Later Liang dynasty": "China", "Later Tang": "China", "Later Zhou dynasty": "China", "Yuan dynasty": "China",
  "Ming dynasty": "China", "Qing dynasty": "China", "Republic of China": "China",
  "People's Republic of China": "China",
  "Mughal Empire": "India", "British Raj": "India", "Kingdom of Thiruvithamkoor": "India",
  "Safavid Iran": "Iran", "Qajar Iran": "Iran", "Dutch East Indies": "Indonesia",
  // the Americas
  "New Spain": "Mexico", "Viceroyalty of Peru": "Peru", "Viceroyalty of New Granada": "Colombia",
  "Empire of Brazil": "Brazil", "Colonial Brazil": "Brazil", "Thirteen Colonies": "United States",
  "Province of Canada": "Canada",
};

/** Countries the citizenship names, in its order (unknown names count as none). */
function stateCountry(name: string): string | null {
  if (name in STATE) return STATE[name];
  return name in CONTINENT_OF ? name : null;
}

/**
 * Countries a short description names, in order. "German-born British painter" and "German-American painter" are
 * British and American: where someone was born, or came from, is dropped.
 */
function descriptionCountries(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/\b[a-z]+-born\b/g, " ")
    .replace(/\b[a-z]+-(?=[a-z])/g, " ");
  const out: string[] = [];
  for (const w of t.match(/[a-z]+/g) ?? []) {
    const c = w === "dominicans" || w === "georgians" ? undefined : DEMONYM[w];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Artists the rules above file differently from how their museums do. */
const ORIGIN_OVERRIDES: Readonly<Record<string, string>> = {
  // "Russian-Armenian marine painter": Armenian by family, a Russian painter
  "ivan-aivazovsky": "Russia",
  // "Russian-French artist": French only from 1938, long after the Russian avant-garde she led
  "natalia-goncharova": "Russia",
};

export interface ArtistOrigin {
  country: string | null;
  continent: Continent | null;
}

/**
 * One present-day country for an artist. Each candidate scores 3 for a nationality, 1 for a citizenship and 3 for
 * being the first country of the short description (1 for a later one); ties go to the earlier mention in the
 * description, then to more citizenships, then to the first nationality.
 */
export function artistOrigin(
  slug: string,
  facts: { nationalities?: string[] | null; citizenship?: string[] | null } | null | undefined,
  description?: string | null,
): ArtistOrigin {
  const fixed = ORIGIN_OVERRIDES[slug];
  if (fixed) return { country: fixed, continent: CONTINENT_OF[fixed] ?? null };

  interface Score { score: number; cit: number; nat: number; said: number }
  const by = new Map<string, Score>();
  const at = (c: string) => {
    let s = by.get(c);
    if (!s) by.set(c, (s = { score: 0, cit: 0, nat: Infinity, said: Infinity }));
    return s;
  };
  (facts?.nationalities ?? []).forEach((n, i) => {
    const c = DEMONYM[n.toLowerCase()];
    if (!c) return;
    const s = at(c);
    if (s.nat === Infinity) s.score += 3;
    s.nat = Math.min(s.nat, i);
  });
  const cited = new Set<string>();
  for (const name of facts?.citizenship ?? []) {
    const c = stateCountry(name);
    if (!c) continue;
    const s = at(c);
    if (!cited.has(c)) s.score += 1;
    cited.add(c);
    s.cit++;
  }
  descriptionCountries(description ?? "").forEach((c, i) => {
    const s = at(c);
    s.score += i === 0 ? 3 : 1;
    s.said = i;
  });

  let best: string | null = null;
  let b: Score | null = null;
  for (const [c, s] of by) {
    if (
      !b ||
      s.score > b.score ||
      (s.score === b.score &&
        (s.said < b.said || (s.said === b.said && (s.cit > b.cit || (s.cit === b.cit && s.nat < b.nat)))))
    ) {
      best = c;
      b = s;
    }
  }
  return { country: best, continent: best ? (CONTINENT_OF[best] ?? null) : null };
}
