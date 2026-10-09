"use client";

// Make a room: pick what hangs in it (eras, schools, genres, countries, museums, artists, years, title words),
// design it (style, wall, order, floors: one per era, all on one, or a floor plan of one's own), see what will
// hang and change it (add artists and paintings, leave works out, keep others, drag works to their places and
// floors, drag the floors), walk it, save it, share the link. Everything is in the room's URL (/room?...,
// src/lib/room-query.ts), so the link is the room; it records only what the visitor changed. Saved rooms are kept
// in this browser ("My rooms"); the recreated museums (src/lib/museum-rooms.ts) are rooms made the same way.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  EMPTY_SELECTION,
  MAX_WORKS,
  parsePin,
  parseSelection,
  pinText,
  reorderPlan,
  selectionQuery,
  workFloor,
  workKey,
  type FloorSpec,
  type Pin,
  type Selection,
} from "@/lib/room-query";
import { MUSEUM_ROOMS } from "@/lib/museum-rooms";
import { GROUNDS, ROOM_STYLES, styleSwatch } from "@/components/museum/theme";
import { findNames, nameEntry } from "@/components/timeline/artist-search";
import { AddWorks, type ArtistOption, type FoundWork } from "./AddWorks";
import { useDragSort, type DragPlace } from "./drag";
import styles from "./RoomPicker.module.css";

interface Term {
  id: string;
  kind: string;
  name: string;
  parent: string | null;
  start: number | null;
  end: number | null;
  works: number;
  ancestors: string[];
}
interface MuseumOption {
  id: string;
  name: string;
  works: number;
}
type PreviewWork = FoundWork;
interface Preview {
  /** The room it shows (its query): until the next one arrives, the last stays. */
  query?: string;
  works: number;
  artists: number;
  /** As they hang; `plan`: the floor's place in the visitor's plan (0-based), null for an era's floor. */
  floors: { label: string; works: PreviewWork[]; plan: number | null }[];
}
interface SavedRoom {
  title: string;
  query: string;
  savedAt: string;
}
interface Props {
  terms: Term[];
  nationalities: { name: string; works: number }[];
  artists: ArtistOption[];
  museums: MuseumOption[];
  initial: Selection;
}

const MY_ROOMS = "timeline-museum:my-rooms";
const GROUPS: { key: string; label: string; kinds: string[]; hint: string }[] = [
  { key: "time", label: "Era or period", kinds: ["era", "tradition", "period"], hint: "Baroque, Ukiyo-e …" },
  { key: "movement", label: "Movement or style", kinds: ["movement", "umbrella", "historical-period"], hint: "Tenebrism, Fauvism …" },
  { key: "school", label: "School or group", kinds: ["school", "group", "academy", "exhibition"], hint: "Venetian School, Peredvizhniki …" },
  { key: "genre", label: "Genre", kinds: ["genre"], hint: "Portrait, Marine painting …" },
];

const PRESETS: { label: string; sel: Partial<Selection> }[] = [
  { label: "The Sea", sel: { terms: ["genre:marina"], title: "The Sea" } },
  { label: "Self-portraits through time", sel: { terms: ["genre:self-portrait"], max: 80, title: "Self-portraits" } },
  { label: "Baroque portraits", sel: { terms: ["era:baroque", "genre:portrait"], title: "Baroque portraits", style: "old-master" } },
  { label: "Impressionist landscapes", sel: { terms: ["movement:impressionism", "genre:landscape"], title: "Impressionist landscapes" } },
  { label: "Still life, 500 years", sel: { terms: ["genre:still-life"], max: 90, title: "Still life over 500 years" } },
  { label: "Greek painters", sel: { nationalities: ["Greeks"], max: 90, title: "Greek painting" } },
  { label: "Night", sel: { words: ["night"], title: "Night", style: "secession" } },
  { label: "Myths", sel: { terms: ["genre:mythological-painting"], title: "Gods and heroes" } },
];

const NEW_PLAN: FloorSpec[] = [
  { label: "Before 1800", from: null, to: 1799, style: null, wall: null, works: null, intro: null, who: [], ground: null, number: null },
  { label: "From 1800", from: 1800, to: null, style: null, wall: null, works: null, intro: null, who: [], ground: null, number: null },
];

function readSaved(): SavedRoom[] {
  try {
    return JSON.parse(localStorage.getItem(MY_ROOMS) ?? "[]") as SavedRoom[];
  } catch {
    return [];
  }
}
function writeSaved(rooms: SavedRoom[]) {
  try {
    localStorage.setItem(MY_ROOMS, JSON.stringify(rooms.slice(0, 60)));
  } catch {}
}

/** "vincent-van-gogh/the-starry-night" as words, for a work whose title has not been seen yet. */
const keyTitle = (key: string) => {
  const t = key.split("/")[1]?.replace(/-/g, " ") ?? key;
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function Swatch({ k }: { k: (typeof ROOM_STYLES)[number]["key"] }) {
  const c = styleSwatch(k);
  return (
    <span className={styles.swatch} aria-hidden>
      <span style={{ background: c.ceiling, flex: "0 0 14%" }} />
      <span style={{ background: c.wall, flex: "1 1 auto", boxShadow: `inset 0 -3px 0 ${c.trim}` }}>
        <i style={{ borderColor: c.frame }} />
      </span>
      <span style={{ background: c.floor, flex: "0 0 22%" }} />
    </span>
  );
}

export function RoomPicker({ terms, nationalities, artists, museums, initial }: Props) {
  const [sel, setSel] = useState<Selection>(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [museumQuery, setMuseumQuery] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedRoom[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(terms.map((t) => [t.id, t])), [terms]);
  const artistBySlug = useMemo(() => new Map(artists.map((a) => [a.slug, a])), [artists]);
  const museumById = useMemo(() => new Map(museums.map((m) => [m.id, m])), [museums]);
  const query = selectionQuery(sel);

  useEffect(() => setSaved(readSaved()), []);

  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/room?preview=1&${query}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((p: Preview) => {
          setPreview({ ...p, query });
          setTitles((had) => {
            const next = { ...had };
            for (const f of p.floors) for (const w of f.works) next[w.key] = w.title;
            return next;
          });
        })
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const update = (patch: Partial<Selection>) => setSel((s) => ({ ...s, ...patch }));
  const addTerm = (id: string) => id && !sel.terms.includes(id) && update({ terms: [...sel.terms, id] });
  /** Keep works (add them to the room): on a plan floor (1-based) when given, a kept work moving there. */
  const keep = (ws: PreviewWork[], floor: number | null = null) => {
    setTitles((t) => ({ ...t, ...Object.fromEntries(ws.map((w) => [w.key, w.title])) }));
    const pins = new Map(sel.include.map((k) => [workKey(k), parsePin(k)]));
    for (const w of ws) {
      const had = pins.get(w.key);
      // a work moved to another floor gives up its place on the last
      if (!had) pins.set(w.key, { key: w.key, floor, place: null });
      else if (floor && floor !== had.floor) pins.set(w.key, { ...had, floor, place: null });
    }
    update({ include: [...pins.values()].map(pinText), exclude: sel.exclude.filter((x) => !ws.some((w) => w.key === x)) });
  };
  const pin = (w: PreviewWork) => keep([w]);
  const unpin = (key: string) => update({ include: sel.include.filter((x) => workKey(x) !== key) });
  const leaveOut = (key: string) =>
    update({ exclude: [...sel.exclude, key], include: sel.include.filter((x) => workKey(x) !== key) });
  const setFloor = (i: number, patch: Partial<FloorSpec>) =>
    update({ plan: sel.plan.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const floorNo = (i: number) => {
    const n = sel.plan[i]?.number ?? sel.firstFloor + i;
    return n < 0 ? `−${-n}` : String(n);
  };
  const plan = sel.floors === "plan";

  // a work dragged to a new place, or to another floor of the plan: it is kept there, and every work placed by
  // hand on the floors it touched takes its new place (the rest hang in the room's order around them)
  const moveWork = (from: DragPlace, to: DragPlace) => {
    if (!preview) return;
    const floors = preview.floors.map((f) => ({ ...f, works: [...f.works] }));
    const [w] = floors[from.list].works.splice(from.index, 1);
    if (!w) return;
    floors[to.list].works.splice(to.index, 0, w);
    const pins = new Map(sel.include.map((k) => [workKey(k), parsePin(k)]));
    const moved: Pin = { ...(pins.get(w.key) ?? { key: w.key, floor: null, place: null }) };
    if (from.list !== to.list) moved.floor = (floors[to.list].plan ?? 0) + 1;
    pins.set(w.key, moved);
    for (const l of new Set([from.list, to.list]))
      floors[l].works.forEach((x, i) => {
        const p = pins.get(x.key);
        if (p && (x.key === w.key || p.place != null)) pins.set(x.key, { ...p, place: i + 1 });
      });
    setPreview({ ...preview, floors });
    setTitles((t) => ({ ...t, [w.key]: w.title }));
    update({ include: [...pins.values()].map(pinText), exclude: sel.exclude.filter((x) => x !== w.key) });
  };
  const dragWork = useDragSort({
    scope: "works",
    axis: "x",
    // between floors only on floors of one's own (an era's floor holds its era's works)
    accepts: () => plan,
    onDrop: moveWork,
    classes: { source: styles.dragSource, ghost: styles.dragGhost, before: styles.dropBefore, after: styles.dropAfter,
      into: styles.dropInto },
  });
  const dragFloor = useDragSort({
    scope: "floors",
    axis: "y",
    handle: true,
    onDrop: (from, to) => {
      const order = sel.plan.map((_, i) => i);
      order.splice(to.index, 0, ...order.splice(from.index, 1));
      update(reorderPlan(sel, order));
    },
    classes: { source: styles.dragSource, ghost: styles.dragGhost, before: styles.rowBefore, after: styles.rowAfter,
      into: styles.dropInto },
  });
  const chosenTime = sel.terms.filter((id) => ["era", "tradition", "period"].includes(byId.get(id)?.kind ?? ""));
  const optionsFor = (kinds: string[], key: string) =>
    terms
      .filter((t) => kinds.includes(t.kind) && !sel.terms.includes(t.id))
      .filter((t) => key !== "movement" || !chosenTime.length || t.ancestors.some((a) => chosenTime.includes(a)))
      .filter((t) => t.works > 0 || key === "school")
      .sort((a, b) =>
        key === "genre" || key === "school" ? a.name.localeCompare(b.name) : (a.start ?? 9999) - (b.start ?? 9999)
      );
  const artistEntries = useMemo(() => artists.map((a) => nameEntry(a.name)), [artists]);
  const artistMatches = useMemo(() => {
    if (artistQuery.trim().length < 2) return [];
    const { exact, close } = findNames(artists, artistEntries, artistQuery, (a, b) => a.name.localeCompare(b.name));
    return [...exact, ...close].filter((a) => !sel.artists.includes(a.slug)).slice(0, 8);
  }, [artistQuery, artists, artistEntries, sel.artists]);
  const museumMatches = museumQuery.trim().length >= 2
    ? museums.filter((m) => m.name.toLowerCase().includes(museumQuery.toLowerCase()) && !sel.museums.includes(m.id)).slice(0, 8)
    : [];
  const enterHref = `/room?${query}`;
  const titleOf = (s: Selection) =>
    s.title ??
    ([...s.museums.map((id) => museumById.get(id)?.name), ...s.terms.map((id) => byId.get(id)?.name), ...s.nationalities]
      .filter(Boolean)
      .join(" · ") || "My room");

  const remember = () => {
    const room = { title: titleOf(sel), query, savedAt: new Date().toISOString() };
    const next = [room, ...readSaved().filter((r) => r.query !== query)];
    writeSaved(next);
    setSaved(next);
  };
  const save = () => {
    if (!sel.title) {
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    remember();
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2200);
  };
  const copy = async (q: string, label: string) => {
    const url = `${window.location.origin}/room?${q}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };
  const forget = (q: string) => {
    const next = readSaved().filter((r) => r.query !== q);
    writeSaved(next);
    setSaved(next);
  };
  const load = (q: string) => {
    setSel(parseSelection(Object.fromEntries(new URLSearchParams(q))));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const years = (t: Term) => (t.start != null ? ` (${t.start}–${t.end ?? ""})` : "");
  const count = preview;
  const pinned = new Set(sel.include.map(workKey));
  const hanging = new Set(preview?.floors.flatMap((f) => f.works.map((w) => w.key)) ?? []);
  // kept works no floor of the plan holds (nor one asked for): they wait here for a floor
  const waiting = plan && preview?.query === query ? sel.include.filter((k) => !hanging.has(workKey(k))) : [];
  const fullFloors = preview?.floors.filter((f) => f.works.length).length ?? 0;
  const anything =
    sel.terms.length || sel.nationalities.length || sel.artists.length || sel.museums.length || sel.from != null ||
    sel.to != null || sel.words.length || sel.include.length;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <Link href="/" className={styles.back}>← Timeline</Link>
        <h1>Make a room</h1>
        <p>
          Hang your own room, the way a museum curator would: choose what hangs, design the room, leave out what
          you do not want and keep what you do. A room that spans eras gets a floor for each, joined by an
          elevator, or plan the floors yourself. Everything is in the link: save it, share it, and others walk the
          same room.
        </p>
      </header>

      {MUSEUM_ROOMS.length > 0 && (
        <>
          <h2 className={styles.section} id="museums">Recreate a museum</h2>
          <p className={styles.note}>
            Real museums made with these same tools: their works, their floors, their colours. Open one, or load it
            here to change it.
          </p>
          <ul className={styles.museums}>
            {MUSEUM_ROOMS.map((m) => (
              <li key={m.slug}>
                <b>{m.name}</b>
                <small>{m.city}</small>
                <span>{m.note}</span>
                <span className={styles.museumActions}>
                  <Link href={`/room?${m.query}`} className={styles.enter}>Walk it</Link>
                  <button type="button" onClick={() => load(m.query)}>Load it here</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className={styles.presets} aria-label="Ready-made rooms">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setSel({ ...EMPTY_SELECTION, ...p.sel })}>
            {p.label}
          </button>
        ))}
      </section>

      <h2 className={styles.section}>What hangs</h2>
      <section className={styles.form}>
        <label className={styles.wide}>
          <span>Room name</span>
          <input ref={nameRef} value={sel.title ?? ""} placeholder="Named after what you choose" maxLength={80}
            onChange={(e) => update({ title: e.target.value || null })} />
        </label>
        {GROUPS.map((g) => (
          <label key={g.key}>
            <span>{g.label}</span>
            <select value="" onChange={(e) => addTerm(e.target.value)}>
              <option value="">Add … ({g.hint})</option>
              {optionsFor(g.kinds, g.key).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{g.key === "genre" ? "" : years(t)}{t.works ? ` · ${t.works}` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <span>Country</span>
          <select value="" onChange={(e) => e.target.value && !sel.nationalities.includes(e.target.value) &&
            update({ nationalities: [...sel.nationalities, e.target.value] })}>
            <option value="">Add … (Greeks, Dutch …)</option>
            {nationalities.filter((n) => !sel.nationalities.includes(n.name)).map((n) => (
              <option key={n.name} value={n.name}>{n.name} · {n.works}</option>
            ))}
          </select>
        </label>
        <label className={styles.artistPick}>
          <span>Held by a museum</span>
          <input value={museumQuery} placeholder="Rijksmuseum, National Gallery of Greece …"
            onChange={(e) => setMuseumQuery(e.target.value)} />
          {museumMatches.length > 0 && (
            <ul>
              {museumMatches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => { update({ museums: [...sel.museums, m.id] }); setMuseumQuery(""); }}>
                    {m.name} · {m.works}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <label className={styles.artistPick}>
          <span>Artists</span>
          <input value={artistQuery} placeholder="Type a name …" onChange={(e) => setArtistQuery(e.target.value)} />
          {artistMatches.length > 0 && (
            <ul>
              {artistMatches.map((a) => (
                <li key={a.slug}>
                  <button type="button" onClick={() => { update({ artists: [...sel.artists, a.slug] }); setArtistQuery(""); }}>
                    {a.name} {a.birthYear != null ? `(${a.birthYear}–${a.deathYear ?? ""})` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <label>
          <span>From year</span>
          <input type="number" value={sel.from ?? ""} placeholder="any"
            onChange={(e) => update({ from: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
        <label>
          <span>To year</span>
          <input type="number" value={sel.to ?? ""} placeholder="any"
            onChange={(e) => update({ to: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
        <label>
          <span>Words in the title</span>
          <input value={sel.words.join(" ")} placeholder="night, venus, harbour …"
            onChange={(e) => update({ words: e.target.value.toLowerCase().split(/\s+/).filter(Boolean) })} />
        </label>
        <label>
          <span>Works: {sel.max}</span>
          <input type="range" min={12} max={MAX_WORKS} step={6} value={sel.max}
            onChange={(e) => update({ max: Number(e.target.value) })} />
        </label>
      </section>

      <section className={styles.chips} aria-label="Your selection">
        {sel.museums.map((id) => (
          <button key={id} type="button" onClick={() => update({ museums: sel.museums.filter((x) => x !== id) })}>
            {museumById.get(id)?.name ?? id} ×
          </button>
        ))}
        {sel.terms.map((id) => (
          <button key={id} type="button" onClick={() => update({ terms: sel.terms.filter((x) => x !== id) })}>
            {byId.get(id)?.name ?? id} ×
          </button>
        ))}
        {sel.nationalities.map((n) => (
          <button key={n} type="button" onClick={() => update({ nationalities: sel.nationalities.filter((x) => x !== n) })}>
            {n} ×
          </button>
        ))}
        {sel.artists.map((slug) => (
          <button key={slug} type="button" onClick={() => update({ artists: sel.artists.filter((x) => x !== slug) })}>
            {artistBySlug.get(slug)?.name ?? slug} ×
          </button>
        ))}
        {sel.include.map((k) => (
          <button key={k} type="button" className={styles.pinChip} onClick={() => unpin(workKey(k))}>
            ★ {titles[workKey(k)] ?? keyTitle(workKey(k))}
            {workFloor(k) && plan ? ` · floor ${floorNo(workFloor(k)! - 1)}` : ""} ×
          </button>
        ))}
        {anything ? (
          <button type="button" className={styles.clear} onClick={() => setSel(EMPTY_SELECTION)}>Clear all</button>
        ) : (
          <span className={styles.none}>Nothing chosen: the collection&apos;s highlights</span>
        )}
      </section>

      <h2 className={styles.section}>The room</h2>
      <p className={styles.note}>The style sets the walls, floor, frames, lighting, seating and music.</p>
      <div className={styles.styles} role="radiogroup" aria-label="Room style">
        <button type="button" role="radio" aria-checked={!sel.style} className={!sel.style ? styles.on : ""}
          onClick={() => update({ style: null })}>
          <span className={`${styles.swatch} ${styles.swatchAuto}`} aria-hidden>Era</span>
          Each floor in its era&apos;s style
        </button>
        {ROOM_STYLES.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={sel.style === s.key}
            className={sel.style === s.key ? styles.on : ""} onClick={() => update({ style: s.key })}>
            <Swatch k={s.key} />
            {s.label}
          </button>
        ))}
      </div>
      <section className={styles.form}>
        <label>
          <span>Wall colour</span>
          <span className={styles.wallRow}>
            <input type="checkbox" checked={!!sel.wall} aria-label="Own wall colour"
              onChange={(e) => update({ wall: e.target.checked ? "#5d6a70" : null })} />
            <input type="color" value={sel.wall ?? "#5d6a70"} disabled={!sel.wall}
              onChange={(e) => update({ wall: e.target.value })} />
            <small>{sel.wall ? sel.wall : "the style's own"}</small>
          </span>
        </label>
        <label>
          <span>Floor</span>
          <select value={sel.ground ?? ""} onChange={(e) => update({ ground: e.target.value || null })}>
            <option value="">The style&apos;s own</option>
            {GROUNDS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label>
          <span>Hang the works</span>
          <select value={sel.order} onChange={(e) => update({ order: e.target.value as Selection["order"] })}>
            <option value="year">By year</option>
            <option value="artist">By artist</option>
            <option value="fame">Best known first</option>
          </select>
        </label>
        <label>
          <span>Floors</span>
          <select value={sel.floors} onChange={(e) => {
            const floors = e.target.value as Selection["floors"];
            update({ floors, plan: floors === "plan" && !sel.plan.length ? NEW_PLAN : sel.plan });
          }}>
            <option value="era">A floor for each era</option>
            <option value="one">Everything on one floor</option>
            <option value="plan">My own floors</option>
          </select>
        </label>
        <label className={styles.wide}>
          <span>Introduction (shown at the doors)</span>
          <textarea rows={2} maxLength={400} value={sel.intro ?? ""} placeholder="A few words on why these works hang together"
            onChange={(e) => update({ intro: e.target.value || null })} />
        </label>
      </section>

      {plan && (
        <section className={styles.plan} aria-label="Floor plan" data-drag-root>
          <h3>
            Floor plan
            <label className={styles.firstFloor}>
              first floor is number
              <input type="number" min={-2} max={9} value={sel.firstFloor}
                onChange={(e) => update({ firstFloor: Math.min(9, Math.max(-2, Number(e.target.value) || 0)) })} />
            </label>
          </h3>
          <p className={styles.note}>
            A work hangs on the first floor whose years (and, if you name any, whose artists&apos; nationalities) hold
            it. Each floor can have its own style, wall colour, size and wall text; empty fields follow the room&apos;s.
            Drag a floor by its number to move it up or down.
          </p>
          <ol data-drag-list="floors" data-list={0} {...dragFloor}>
            {sel.plan.map((f, i) => (
              <li key={i} data-drag-item="floors" data-index={i}>
                <span className={styles.floorNo} data-drag-handle title="Drag to move this floor">
                  <i aria-hidden>⠿</i>
                  <b>{floorNo(i)}</b>
                </span>
                <input className={styles.floorWide} value={f.label} placeholder="Floor name" maxLength={60}
                  onChange={(e) => setFloor(i, { label: e.target.value })} aria-label="Floor name" />
                <input type="number" value={f.from ?? ""} placeholder="from" aria-label="From year"
                  onChange={(e) => setFloor(i, { from: e.target.value === "" ? null : Number(e.target.value) })} />
                <input type="number" value={f.to ?? ""} placeholder="to" aria-label="To year"
                  onChange={(e) => setFloor(i, { to: e.target.value === "" ? null : Number(e.target.value) })} />
                <select className={styles.floorWide} value={f.style ?? ""} aria-label="Floor style"
                  onChange={(e) => setFloor(i, { style: e.target.value || null })}>
                  <option value="">Room&apos;s style</option>
                  {ROOM_STYLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select className={styles.floorWide} value={f.ground ?? ""} aria-label="Floor material"
                  onChange={(e) => setFloor(i, { ground: e.target.value || null })}>
                  <option value="">Room&apos;s floor</option>
                  {GROUNDS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
                <span className={styles.wallRow}>
                  <input type="checkbox" checked={!!f.wall} aria-label="Own wall colour for this floor"
                    onChange={(e) => setFloor(i, { wall: e.target.checked ? "#4a4f55" : null })} />
                  <input type="color" value={f.wall ?? "#4a4f55"} disabled={!f.wall} aria-label="Floor wall colour"
                    onChange={(e) => setFloor(i, { wall: e.target.value })} />
                </span>
                <input type="number" min={4} max={120} value={f.works ?? ""} placeholder="works" aria-label="Works on this floor"
                  onChange={(e) => setFloor(i, { works: e.target.value === "" ? null : Number(e.target.value) })} />
                <button type="button" className={styles.floorRemove}
                  onClick={() => update(reorderPlan(sel, sel.plan.map((_, j) => j).filter((j) => j !== i)))}
                  aria-label={`Remove floor ${floorNo(i)}`}>×</button>
                <input className={`${styles.floorWho} ${styles.floorWide}`} value={f.who.join(", ")} list="nationality-names"
                  placeholder="Only artists from … (optional: Italians, French …)" aria-label="Only artists of these nationalities"
                  onChange={(e) => setFloor(i, { who: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                <textarea rows={1} maxLength={300} value={f.intro ?? ""} placeholder="Wall text at this floor's doors (optional)"
                  onChange={(e) => setFloor(i, { intro: e.target.value || null })} aria-label="Floor wall text" />
              </li>
            ))}
          </ol>
          <datalist id="nationality-names">
            {nationalities.map((n) => <option key={n.name} value={n.name} />)}
          </datalist>
          {sel.plan.length < 8 && (
            <button type="button" className={styles.restore} onClick={() => {
              const last = sel.plan[sel.plan.length - 1];
              const from = last?.to != null ? last.to + 1 : null;
              update({ plan: [...sel.plan, { label: `Floor ${sel.firstFloor + sel.plan.length}`, from, to: null, style: null,
                wall: null, works: null, intro: null, who: [], ground: null, number: null }] });
            }}>
              Add a floor
            </button>
          )}
        </section>
      )}

      <h2 className={styles.section}>
        What will hang
        {sel.exclude.length > 0 && (
          <button type="button" className={styles.restore} onClick={() => update({ exclude: [] })}>
            {sel.exclude.length} left out · restore all
          </button>
        )}
      </h2>
      <p className={styles.note}>
        Add an artist or a painting, then drag a work to its place{plan ? " or to another floor" : ""}. Leave a work
        out with ×: the next best takes its place. Keep one with ★: it hangs whatever else you change.
        {!plan && (preview?.floors.length ?? 0) > 1 && " To move works between floors, choose My own floors."}
      </p>
      <AddWorks
        artists={artists}
        floors={plan ? sel.plan.map((f, i) => `Floor ${floorNo(i)} · ${f.label || "unnamed"}`) : null}
        inRoom={(key) => pinned.has(key) || hanging.has(key)}
        onAdd={keep}
      />
      {waiting.length > 0 && (
        <section className={styles.waiting} aria-label="Kept works not hanging">
          <p className={styles.note}>Kept, but no floor holds them: choose one, or change the floors&apos; years.</p>
          <ul>
            {waiting.map((k) => (
              <li key={k}>
                <span>{titles[workKey(k)] ?? keyTitle(workKey(k))}</span>
                <select value="" aria-label="Hang it on" onChange={(e) => e.target.value &&
                  keep([{ key: workKey(k), title: titles[workKey(k)] ?? keyTitle(workKey(k)), year: null, artist: "", thumb: null }],
                    Number(e.target.value))}>
                  <option value="">Hang it on …</option>
                  {sel.plan.map((f, i) => <option key={i} value={i + 1}>Floor {floorNo(i)} · {f.label}</option>)}
                </select>
                <button type="button" onClick={() => unpin(workKey(k))} aria-label="Remove it">×</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview?.floors.map((f, fi) => (
        <section key={`${fi}:${f.label}`} className={styles.preview} data-drag-root data-drag-list="works" data-list={fi}
          {...dragWork}>
          {preview.floors.length > 1 && <h3>{f.label} · {f.works.length} works</h3>}
          {!f.works.length && <p className={styles.emptyFloor}>Nothing hangs here yet: drag works here, or add them above.</p>}
          <ul>
            {f.works.map((w, i) => (
              <li key={w.key} className={pinned.has(w.key) ? styles.kept : undefined} data-drag-item="works" data-index={i}>
                {w.thumb ? <img src={w.thumb} alt="" loading="lazy" draggable={false} /> : <span className={styles.noImage} />}
                <span className={styles.caption}>
                  <b>{w.title}</b>
                  <small>{w.artist}{w.year != null ? `, ${w.year}` : ""}</small>
                </span>
                <button type="button" aria-label={`Leave out ${w.title}`} title="Leave out" onClick={() => leaveOut(w.key)}>×</button>
                <button type="button" className={styles.keep} aria-pressed={pinned.has(w.key)}
                  aria-label={pinned.has(w.key) ? `Stop keeping ${w.title}` : `Keep ${w.title}`}
                  title={pinned.has(w.key) ? "Kept: hangs whatever you change" : "Keep"}
                  onClick={() => (pinned.has(w.key) ? unpin(w.key) : pin(w))}>★</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2 className={styles.section}>My rooms</h2>
      {saved.length > 0 ? (
        <>
          <p className={styles.note}>Saved in this browser. The link is the room: copy it to share, or to open it elsewhere.</p>
          <ul className={styles.saved}>
            {saved.map((r) => (
              <li key={r.query}>
                <Link href={`/room?${r.query}`} className={styles.savedTitle}>{r.title}</Link>
                <small>{new Date(r.savedAt).toLocaleDateString()}</small>
                <button type="button" onClick={() => load(r.query)}>Edit</button>
                <button type="button" onClick={() => copy(r.query, r.query)}>{copied === r.query ? "Copied" : "Copy link"}</button>
                <button type="button" onClick={() => forget(r.query)} aria-label={`Delete ${r.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.note}>Rooms you save, enter or share are kept here, in this browser.</p>
      )}

      <footer className={styles.go}>
        <p aria-live="polite">
          {count == null
            ? "…"
            : count.works === 0
              ? "No works match: remove something"
              : `${count.works} works by ${count.artists} artist${count.artists === 1 ? "" : "s"}${
                  fullFloors > 1 ? ` · ${fullFloors} floors` : ""}`}
        </p>
        {count && count.works > 0 ? (
          <Link href={enterHref} className={styles.enter} onClick={remember}>Enter the room</Link>
        ) : (
          <span className={`${styles.enter} ${styles.disabled}`}>Enter the room</span>
        )}
        <button type="button" onClick={save} disabled={!count?.works} title={sel.title ? "" : "Name the room first"}>
          {savedNote ? "Saved" : sel.title ? "Save room" : "Name it to save"}
        </button>
        <button type="button" onClick={() => { remember(); copy(query, "this"); }} disabled={!count?.works}>
          {copied === "this" ? "Link copied" : "Share link"}
        </button>
      </footer>
    </main>
  );
}
