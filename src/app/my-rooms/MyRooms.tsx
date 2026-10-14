"use client";

// My rooms: the recreated museums shown in beta (src/lib/museum-rooms.ts) on one line, the rooms saved in this
// browser (../rooms/saved.ts) on the next. Each is a room link: walk it (/room?...), or change it in Make a room
// (/rooms?..., which opens with that room loaded).

import { useEffect, useState } from "react";
import Link from "next/link";
import { MUSEUM_ROOMS } from "@/lib/museum-rooms";
import { readSaved, writeSaved, type SavedRoom } from "../rooms/saved";
import styles from "../rooms/RoomPicker.module.css";

/** The museums shown (beta); the others' links (/museums/<slug>) still work. */
const BETA_MUSEUMS = MUSEUM_ROOMS.filter((m) => m.slug === "national-gallery-of-greece" || m.slug === "louvre");

export function MyRooms() {
  const [saved, setSaved] = useState<SavedRoom[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => setSaved(readSaved()), []);

  const copy = async (q: string) => {
    const url = `${window.location.origin}/room?${q}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
      setCopied(q);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };
  const forget = (q: string) => {
    const next = readSaved().filter((r) => r.query !== q);
    writeSaved(next);
    setSaved(next);
  };

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <nav className={styles.headLinks}>
          <Link href="/" className={styles.back}>← Timeline</Link>
          <Link href="/rooms" className={styles.back}>Make a room</Link>
        </nav>
        <h1>My rooms</h1>
      </header>

      <h2 className={styles.section} id="museums">Museums (beta)</h2>
      <p className={styles.note}>
        Real museums made with the same tools as your rooms: their works, their floors, their colours. Walk one, or
        change it into a room of your own.
      </p>
      <ul className={styles.museums}>
        {BETA_MUSEUMS.map((m) => (
          <li key={m.slug}>
            <b>{m.name}</b>
            <small>{m.city}</small>
            <span>{m.note}</span>
            <span className={styles.museumActions}>
              <Link href={`/room?${m.query}`} className={styles.enter}>Walk it</Link>
              <Link href={`/rooms?${m.query}`} className={styles.back}>Change it</Link>
            </span>
          </li>
        ))}
      </ul>

      <h2 className={styles.section}>My rooms</h2>
      {saved == null ? null : saved.length > 0 ? (
        <>
          <p className={styles.note}>Saved in this browser. The link is the room: copy it to share, or to open it elsewhere.</p>
          <ul className={styles.saved}>
            {saved.map((r) => (
              <li key={r.query}>
                <Link href={`/room?${r.query}`} className={styles.savedTitle}>{r.title}</Link>
                <small>{new Date(r.savedAt).toLocaleDateString()}</small>
                <Link href={`/rooms?${r.query}`}>Edit</Link>
                <button type="button" onClick={() => copy(r.query)}>{copied === r.query ? "Copied" : "Copy link"}</button>
                <button type="button" onClick={() => forget(r.query)} aria-label={`Delete ${r.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.note}>
          Rooms you save, enter or share are kept here, in this browser. <Link href="/rooms">Make a room</Link>.
        </p>
      )}
    </main>
  );
}
