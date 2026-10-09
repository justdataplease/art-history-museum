"use client";

// The picker's search for what to add to a room: an artist (then their best known works, to add one by one or
// all), or a painting by its title and artist ("vermeer pearl", "starry night"). A work added is kept: it hangs
// whatever else is chosen, on the floor picked here or where its year belongs.

import { useEffect, useMemo, useState } from "react";
import { findNames, nameEntry } from "@/components/timeline/artist-search";
import styles from "./RoomPicker.module.css";

export interface FoundWork {
  key: string;
  title: string;
  year: number | null;
  artist: string;
  thumb: string | null;
}
export interface ArtistOption {
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
}
interface Props {
  artists: ArtistOption[];
  /** The plan's floors a work can be added to, by name (none: the room places it). */
  floors: string[] | null;
  /** Is the work already in the room (kept, or hanging)? */
  inRoom: (key: string) => boolean;
  /** `floor`: the plan floor (1-based), or null for where its year belongs. */
  onAdd: (works: FoundWork[], floor: number | null) => void;
}

const lifespan = (a: ArtistOption) => (a.birthYear != null ? ` ${a.birthYear}–${a.deathYear ?? ""}` : "");

export function AddWorks({ artists, floors, inRoom, onAdd }: Props) {
  const [q, setQ] = useState("");
  const [artist, setArtist] = useState<ArtistOption | null>(null);
  // the works found, and the search they answer ("artist|words")
  const [result, setResult] = useState<{ asked: string; works: FoundWork[] }>({ asked: "", works: [] });
  const [floor, setFloor] = useState<number | null>(null);
  const entries = useMemo(() => artists.map((a) => nameEntry(a.name)), [artists]);
  const text = q.trim();
  const found = useMemo(() => {
    if (artist || text.length < 2) return [];
    const { exact, close } = findNames(artists, entries, text, (a, b) => a.name.localeCompare(b.name));
    return [...exact, ...close].slice(0, 6);
  }, [artist, artists, entries, text]);

  const asked = `${artist?.slug ?? ""}|${text}`;
  useEffect(() => {
    if (!artist && text.length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const by = artist ? `&a=${artist.slug}&n=24` : "&n=12";
      fetch(`/api/room/works?q=${encodeURIComponent(text)}${by}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((r: { works: FoundWork[] }) => setResult({ asked, works: r.works }))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [artist, text, asked]);

  // while the next search runs the last one's works stay, unless they were another artist's
  const sameArtist = result.asked.split("|")[0] === (artist?.slug ?? "");
  const shown = (artist || text.length >= 3) && sameArtist ? result.works : [];
  const fresh = shown.filter((w) => !inRoom(w.key));
  const clear = () => {
    setQ("");
    setArtist(null);
  };

  return (
    <section className={styles.add} aria-label="Add artists or paintings">
      <div className={styles.addBar}>
        {artist && (
          <button type="button" className={styles.addArtist} onClick={() => setArtist(null)}
            aria-label={`Stop showing ${artist.name}'s works`}>
            {artist.name} ×
          </button>
        )}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && clear()}
          placeholder={artist ? `Search ${artist.name}'s works …` : "Add an artist or a painting: Vermeer, The Night Watch, monet lilies …"}
          aria-label="Search an artist or a painting to add" />
        {floors && floors.length > 1 && (
          <label className={styles.addTo}>
            <span>Add to</span>
            <select value={floor ?? ""} onChange={(e) => setFloor(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Where its year belongs</option>
              {floors.map((f, i) => <option key={i} value={i + 1}>{f}</option>)}
            </select>
          </label>
        )}
      </div>
      {found.length > 0 && (
        <ul className={styles.addArtists} aria-label="Artists">
          {found.map((a) => (
            <li key={a.slug}>
              <button type="button" onClick={() => { setArtist(a); setQ(""); }}>
                {a.name}<small>{lifespan(a)}</small> <span aria-hidden>›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <>
          {artist && fresh.length > 1 && (
            <button type="button" className={styles.restore} onClick={() => onAdd(fresh, floor)}>
              Add all {fresh.length} shown
            </button>
          )}
          <ul className={styles.addWorks} aria-label="Paintings">
            {shown.map((w) => {
              const had = inRoom(w.key);
              return (
                <li key={w.key}>
                  <button type="button" disabled={had} onClick={() => onAdd([w], floor)}
                    aria-label={had ? `${w.title} is in the room` : `Add ${w.title}`}>
                    {w.thumb ? <img src={w.thumb} alt="" loading="lazy" draggable={false} /> : <span className={styles.noImage} />}
                    <span>
                      <b>{w.title}</b>
                      <small>{w.artist}{w.year != null ? `, ${w.year}` : ""}</small>
                    </span>
                    <i aria-hidden>{had ? "✓" : "+"}</i>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!artist && text.length >= 3 && result.asked === asked && !shown.length && !found.length && (
        <p className={styles.note}>Nothing by that name or title in the collection.</p>
      )}
    </section>
  );
}
