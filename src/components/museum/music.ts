// Background music for the galleries, one short playlist per era.
//
// Sourcing rule (same as the rest of the museum): every recording is a real
// human performance hosted on Wikimedia Commons, never AI-generated or
// MIDI-synthesised, and freely licensed — Public domain, CC0, CC BY or
// CC BY-SA. Nothing NC/ND or of unclear status. For CC BY(-SA) recordings,
// attribution is a licence condition, so MuseumAudio always shows the credit
// (composer, title, performer, licence, link to the Commons file page).
//
// `license` is the licence of the *recording* as stated on its Commons file
// page. Where Commons' metadata reports only the composition's status (e.g.
// "Public domain" for Debussy) but the performance itself is CC-licensed, the
// performance licence is what is recorded here.
//
// All URLs were checked against the Commons API (imageinfo / videoinfo
// derivatives) and with HEAD requests (200, audio/mpeg or application/ogg /
// audio/flac). The MP3s are Commons' own transcodes of the original uploads.

import type { EraKey } from "./theme";

export type TrackLicense =
  | "Public domain"
  | "CC0"
  | `CC BY ${string}`
  | `CC BY-SA ${string}`;

export interface Track {
  /** Work title as shown in the credit. */
  title: string;
  composer: string;
  /** Performer(s) of this recording, when known. */
  performer?: string;
  /** Licence of the recording (see header). */
  license: TrackLicense;
  /** Commons file description page — the attribution / source link. */
  page: string;
  /** Original upload on upload.wikimedia.org. */
  original: string;
  /** MIME type of the original, for canPlayType(). */
  originalType: "audio/ogg" | "audio/flac";
  /** Commons-generated MP3 transcode (plays everywhere, incl. Safari). */
  mp3?: string;
  /** Duration in seconds. */
  duration: number;
}

const C = "https://commons.wikimedia.org/wiki/File:";
const U = "https://upload.wikimedia.org/wikipedia/commons/";
const T = "https://upload.wikimedia.org/wikipedia/commons/transcoded/";

const PLAYLISTS: Record<Exclude<EraKey, "northern" | "victorian" | "secession">, Track[]> = {
  // Medieval / Gothic, Early + Northern Renaissance
  sacred: [
    {
      title: "Salve Regina",
      composer: "Hermannus Contractus",
      performer: "Les Petits Chanteurs de Passy",
      license: "CC BY-SA 3.0",
      page: C + "Petits_Chanteurs_de_Passy_-_Salve_Regina_de_Hermann_Contract.ogg",
      original: U + "4/46/Petits_Chanteurs_de_Passy_-_Salve_Regina_de_Hermann_Contract.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "4/46/Petits_Chanteurs_de_Passy_-_Salve_Regina_de_Hermann_Contract.ogg/Petits_Chanteurs_de_Passy_-_Salve_Regina_de_Hermann_Contract.ogg.mp3",
      duration: 190,
    },
    {
      title: "Se la face ay pale",
      composer: "Guillaume Du Fay",
      performer: "Asteria",
      license: "CC BY-SA 2.5",
      page: C + "Guillaume_Dufay_-_Se_La_Face_Ay_Pale.ogg",
      original: U + "3/38/Guillaume_Dufay_-_Se_La_Face_Ay_Pale.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "3/38/Guillaume_Dufay_-_Se_La_Face_Ay_Pale.ogg/Guillaume_Dufay_-_Se_La_Face_Ay_Pale.ogg.mp3",
      duration: 164,
    },
    {
      // Performance: GFDL, relicensed to CC BY-SA 3.0 under the 2009 licence
      // migration (Commons metadata shows only the composition's PD status).
      title: "O frondens virga",
      composer: "Hildegard of Bingen",
      performer: "Makemi",
      license: "CC BY-SA 3.0",
      page: C + "O_frondens_2.ogg",
      original: U + "a/ad/O_frondens_2.ogg",
      originalType: "audio/ogg",
      mp3: T + "a/ad/O_frondens_2.ogg/O_frondens_2.ogg.mp3",
      duration: 96,
    },
  ],

  // High Renaissance, Mannerism, Baroque (and the Dutch rooms)
  "old-master": [
    {
      title: "Kyrie, Missa Sicut lilium inter spinas",
      composer: "Giovanni Pierluigi da Palestrina",
      performer: "The Tudor Consort",
      license: "CC BY 3.0",
      page: C + "The_Tudor_Consort_-_02_-_Palestrina_-_Kyrie_-_Missa_Sicut_lilium_inter_spinas.ogg",
      original:
        U + "e/ed/The_Tudor_Consort_-_02_-_Palestrina_-_Kyrie_-_Missa_Sicut_lilium_inter_spinas.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "e/ed/The_Tudor_Consort_-_02_-_Palestrina_-_Kyrie_-_Missa_Sicut_lilium_inter_spinas.ogg/The_Tudor_Consort_-_02_-_Palestrina_-_Kyrie_-_Missa_Sicut_lilium_inter_spinas.ogg.mp3",
      duration: 219,
    },
    {
      title: "Goldberg Variations: Aria",
      composer: "Johann Sebastian Bach",
      performer: "Kimiko Ishizaka",
      license: "CC0",
      page: C + "Goldberg_Variations_01_Aria.ogg",
      original: U + "4/42/Goldberg_Variations_01_Aria.ogg",
      originalType: "audio/ogg",
      mp3: T + "4/42/Goldberg_Variations_01_Aria.ogg/Goldberg_Variations_01_Aria.ogg.mp3",
      duration: 300,
    },
    {
      title: "Cello Suite No. 3: Sarabande",
      composer: "Johann Sebastian Bach",
      performer: "John Michel",
      license: "CC BY-SA 3.0",
      page: C + "JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_3_in_C_Sarabande.ogg",
      original: U + "c/c0/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_3_in_C_Sarabande.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "c/c0/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_3_in_C_Sarabande.ogg/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_3_in_C_Sarabande.ogg.mp3",
      duration: 184,
    },
  ],

  // Rococo + Neoclassicism
  eighteenth: [
    {
      title: "Clarinet Quintet in A, K. 581: Larghetto",
      composer: "Wolfgang Amadeus Mozart",
      performer: "William McColl & the Philadelphia String Quartet",
      license: "CC BY-SA 2.0",
      page: C + "Wolfgang_Amadeus_Mozart_-_Clarinet_Quintet_-_2._Larghetto.ogg",
      original: U + "6/60/Wolfgang_Amadeus_Mozart_-_Clarinet_Quintet_-_2._Larghetto.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "6/60/Wolfgang_Amadeus_Mozart_-_Clarinet_Quintet_-_2._Larghetto.ogg/Wolfgang_Amadeus_Mozart_-_Clarinet_Quintet_-_2._Larghetto.ogg.mp3",
      duration: 489,
    },
    {
      title: "String Quartet Op. 64 No. 5 “The Lark”: Adagio cantabile",
      composer: "Joseph Haydn",
      performer: "Musopen String Quartet",
      license: "Public domain",
      page:
        C +
        "Haydn_-_String_Quartet,_Op._64_No._5_in_D_major_%27The_Lark%27_-_II._Adagio._Cantabile_(Musopen_String_Quartet).flac",
      original:
        U +
        "4/45/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_II._Adagio._Cantabile_%28Musopen_String_Quartet%29.flac",
      originalType: "audio/flac",
      mp3:
        T +
        "4/45/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_II._Adagio._Cantabile_%28Musopen_String_Quartet%29.flac/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_II._Adagio._Cantabile_%28Musopen_String_Quartet%29.flac.mp3",
      duration: 292,
    },
    {
      title: "Piano Sonata No. 12 in F, K. 332: Adagio",
      composer: "Wolfgang Amadeus Mozart",
      performer: "La Pianista",
      license: "CC BY-SA 3.0",
      page: C + "Mozart_-_Piano_Sonata_No._12_in_F_Major,_K.332_-_II._Adagio.ogg",
      original: U + "d/d0/Mozart_-_Piano_Sonata_No._12_in_F_Major%2C_K.332_-_II._Adagio.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "d/d0/Mozart_-_Piano_Sonata_No._12_in_F_Major%2C_K.332_-_II._Adagio.ogg/Mozart_-_Piano_Sonata_No._12_in_F_Major%2C_K.332_-_II._Adagio.ogg.mp3",
      duration: 294,
    },
  ],

  // Romanticism, Hudson River School, Realism (and the Victorian rooms)
  nineteenth: [
    {
      title: "Nocturne in E-flat, Op. 9 No. 2",
      composer: "Frédéric Chopin",
      performer: "Frank Lévy",
      license: "Public domain",
      page: C + "Chopin_-_Nocturne_No._2_in_E-flat_major,_Op._9_No._2_(Frank_Levy).flac",
      original:
        U + "8/89/Chopin_-_Nocturne_No._2_in_E-flat_major%2C_Op._9_No._2_%28Frank_Levy%29.flac",
      originalType: "audio/flac",
      mp3:
        T +
        "8/89/Chopin_-_Nocturne_No._2_in_E-flat_major%2C_Op._9_No._2_%28Frank_Levy%29.flac/Chopin_-_Nocturne_No._2_in_E-flat_major%2C_Op._9_No._2_%28Frank_Levy%29.flac.mp3",
      duration: 271,
    },
    {
      title: "Piano Sonata No. 8 “Pathétique”: Adagio cantabile",
      composer: "Ludwig van Beethoven",
      performer: "Paul Pitman",
      license: "CC0",
      page: C + "Beethoven,_Sonata_No._8_in_C_Minor_Pathetique,_Op._13_-_II._Adagio_cantabile.ogg",
      original:
        U + "6/63/Beethoven%2C_Sonata_No._8_in_C_Minor_Pathetique%2C_Op._13_-_II._Adagio_cantabile.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "6/63/Beethoven%2C_Sonata_No._8_in_C_Minor_Pathetique%2C_Op._13_-_II._Adagio_cantabile.ogg/Beethoven%2C_Sonata_No._8_in_C_Minor_Pathetique%2C_Op._13_-_II._Adagio_cantabile.ogg.mp3",
      duration: 298,
    },
    {
      // Musopen recording; the performer is not credited on Commons.
      title: "Kinderszenen: Träumerei",
      composer: "Robert Schumann",
      license: "Public domain",
      page: C + "Robert_Schumann_-_scenes_from_childhood,_op._15_-_vii._dreaming.ogg",
      original: U + "0/06/Robert_Schumann_-_scenes_from_childhood%2C_op._15_-_vii._dreaming.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "0/06/Robert_Schumann_-_scenes_from_childhood%2C_op._15_-_vii._dreaming.ogg/Robert_Schumann_-_scenes_from_childhood%2C_op._15_-_vii._dreaming.ogg.mp3",
      duration: 203,
    },
  ],

  // Impressionism, Post-Impressionism (and Symbolism / the Secession room)
  impressionist: [
    {
      // Recording is CC BY 3.0 (Commons metadata shows the composition's PD).
      title: "Suite bergamasque: Clair de lune",
      composer: "Claude Debussy",
      performer: "Laurens Goedhart",
      license: "CC BY 3.0",
      page: C + "Clair_de_lune_(Claude_Debussy)_Suite_bergamasque.ogg",
      original: U + "b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg.mp3",
      duration: 304,
    },
    {
      title: "Gymnopédie No. 1",
      composer: "Erik Satie",
      performer: "Robin Alciatore",
      license: "Public domain",
      page: C + "Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg",
      original: U + "9/90/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "9/90/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg.mp3",
      duration: 184,
    },
    {
      title: "Arabesque No. 1",
      composer: "Claude Debussy",
      performer: "Patrizia Prati",
      license: "CC BY-SA 4.0",
      page: C + "Claude_Debussy_-_Premi%C3%A8re_Arabesque_-_Patrizia_Prati.ogg",
      original: U + "0/0f/Claude_Debussy_-_Premi%C3%A8re_Arabesque_-_Patrizia_Prati.ogg",
      originalType: "audio/ogg",
      mp3:
        T +
        "0/0f/Claude_Debussy_-_Premi%C3%A8re_Arabesque_-_Patrizia_Prati.ogg/Claude_Debussy_-_Premi%C3%A8re_Arabesque_-_Patrizia_Prati.ogg.mp3",
      duration: 293,
    },
  ],

  // Fauvism, Expressionism, Cubism, Abstract Art, Surrealism, American Modernism
  "early-modern": [
    {
      // Performance is CC BY-SA 3.0 (Commons metadata shows the composition's PD).
      title: "Gnossienne No. 1",
      composer: "Erik Satie",
      performer: "La Pianista",
      license: "CC BY-SA 3.0",
      page: C + "Satie_-_Gnossienne_1.ogg",
      original: U + "9/91/Satie_-_Gnossienne_1.ogg",
      originalType: "audio/ogg",
      mp3: T + "9/91/Satie_-_Gnossienne_1.ogg/Satie_-_Gnossienne_1.ogg.mp3",
      duration: 218,
    },
    {
      title: "Préludes, Book I: La fille aux cheveux de lin",
      composer: "Claude Debussy",
      performer: "Marcelle Meyer (1956)",
      license: "Public domain",
      page:
        C +
        "Claude_Debussy_-_Pr%C3%A9ludes_(Livre_I)_-_VIII._La_Fille_aux_cheveux_de_lin_(Marcelle_Meyer,_1956).flac",
      original:
        U +
        "6/62/Claude_Debussy_-_Pr%C3%A9ludes_%28Livre_I%29_-_VIII._La_Fille_aux_cheveux_de_lin_%28Marcelle_Meyer%2C_1956%29.flac",
      originalType: "audio/flac",
      mp3:
        T +
        "6/62/Claude_Debussy_-_Pr%C3%A9ludes_%28Livre_I%29_-_VIII._La_Fille_aux_cheveux_de_lin_%28Marcelle_Meyer%2C_1956%29.flac/Claude_Debussy_-_Pr%C3%A9ludes_%28Livre_I%29_-_VIII._La_Fille_aux_cheveux_de_lin_%28Marcelle_Meyer%2C_1956%29.flac.mp3",
      duration: 120,
    },
    {
      title: "Gnossienne No. 3",
      composer: "Erik Satie",
      performer: "La Pianista",
      license: "CC BY-SA 3.0",
      page: C + "Gnossienne_3_(Satie).ogg",
      original: U + "1/10/Gnossienne_3_%28Satie%29.ogg",
      originalType: "audio/ogg",
      mp3: T + "1/10/Gnossienne_3_%28Satie%29.ogg/Gnossienne_3_%28Satie%29.ogg.mp3",
      duration: 163,
    },
  ],

  // Abstract Expressionism, Pop Art, Contemporary. Post-war repertoire is
  // almost all still in copyright, so this room gets genuinely contemporary
  // minimal piano that its composer released under CC BY (Preludes, 2011,
  // via the Free Music Archive).
  postwar: [
    {
      title: "Prelude No. 10",
      composer: "Chris Zabriskie",
      performer: "Chris Zabriskie",
      license: "CC BY 4.0",
      page: C + "Chris_Zabriskie_-_10_-_Prelude_No_10.ogg",
      original: U + "5/54/Chris_Zabriskie_-_10_-_Prelude_No_10.ogg",
      originalType: "audio/ogg",
      mp3: T + "5/54/Chris_Zabriskie_-_10_-_Prelude_No_10.ogg/Chris_Zabriskie_-_10_-_Prelude_No_10.ogg.mp3",
      duration: 116,
    },
    {
      title: "Prelude No. 23",
      composer: "Chris Zabriskie",
      performer: "Chris Zabriskie",
      license: "CC BY 4.0",
      page: C + "Chris_Zabriskie_-_23_-_Prelude_No_23.ogg",
      original: U + "9/90/Chris_Zabriskie_-_23_-_Prelude_No_23.ogg",
      originalType: "audio/ogg",
      mp3: T + "9/90/Chris_Zabriskie_-_23_-_Prelude_No_23.ogg/Chris_Zabriskie_-_23_-_Prelude_No_23.ogg.mp3",
      duration: 104,
    },
    {
      title: "Prelude No. 7",
      composer: "Chris Zabriskie",
      performer: "Chris Zabriskie",
      license: "CC BY 4.0",
      page: C + "Chris_Zabriskie_-_07_-_Prelude_No_7.ogg",
      original: U + "3/3b/Chris_Zabriskie_-_07_-_Prelude_No_7.ogg",
      originalType: "audio/ogg",
      mp3: T + "3/3b/Chris_Zabriskie_-_07_-_Prelude_No_7.ogg/Chris_Zabriskie_-_07_-_Prelude_No_7.ogg.mp3",
      duration: 101,
    },
    {
      title: "Prelude No. 8",
      composer: "Chris Zabriskie",
      performer: "Chris Zabriskie",
      license: "CC BY 4.0",
      page: C + "Chris_Zabriskie_-_08_-_Prelude_No_8.ogg",
      original: U + "9/94/Chris_Zabriskie_-_08_-_Prelude_No_8.ogg",
      originalType: "audio/ogg",
      mp3: T + "9/94/Chris_Zabriskie_-_08_-_Prelude_No_8.ogg/Chris_Zabriskie_-_08_-_Prelude_No_8.ogg.mp3",
      duration: 102,
    },
  ],
};

// Rooms with their own decor share the playlist of the musical era they
// belong to: the Dutch Golden Age is Baroque music, the Pre-Raphaelites and
// the academic Salon are the Romantic century, fin-de-siècle Vienna and the
// Symbolists are Debussy's world.
export const ERA_MUSIC: Record<EraKey, Track[]> = {
  ...PLAYLISTS,
  northern: PLAYLISTS["old-master"],
  victorian: PLAYLISTS.nineteenth,
  secession: PLAYLISTS.impressionist,
};

/** File name of the local mirror in public/audio/ (scripts/fetch-music.ts):
 *  the Commons file name, slugified, as AAC. */
export function localAudioFile(t: Track): string {
  const base = decodeURIComponent(t.original.split("/").pop() ?? "track")
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return `${base}.m4a`;
}

/** Same-origin URL of the local mirror (served from public/audio). */
export function localAudioUrl(t: Track): string {
  return `/audio/${localAudioFile(t)}`;
}

/** One-line attribution, e.g. for a title attribute. */
export function trackCredit(t: Track): string {
  const by = t.performer && t.performer !== t.composer ? ` · performed by ${t.performer}` : "";
  return `${t.composer} — ${t.title}${by} · Wikimedia Commons, ${t.license}`;
}

/** Creative Commons deed for a licence short name; null for public domain. */
export function licenseUrl(license: TrackLicense): string | null {
  if (license === "CC0") return "https://creativecommons.org/publicdomain/zero/1.0/";
  const m = /^CC (BY(?:-SA)?) (\d\.\d)$/.exec(license);
  if (!m) return null;
  return `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/`;
}
