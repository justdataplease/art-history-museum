import type { Metadata } from "next";
import Link from "next/link";
import { getFilmPainters } from "@/lib/films";
import styles from "./cinema-index.module.css";

// Painters on film: everyone whose Wikipedia articles hold films (archive/films.py), each a door into their
// cinema. The painters with a gallery first, then the Greek painters who have none (most are in copyright: the
// films are about them, the works stay out).
export const metadata: Metadata = {
  title: "Painters on film · A Walkable History of Art",
  description:
    "Documentaries, television portraits and archive footage of painters, linked from their Wikipedia articles in every language, shown on a projector in a 3D cinema.",
};

export default function CinemaIndex() {
  const painters = getFilmPainters();
  const withGallery = painters.filter((p) => p.gallery);
  const others = painters.filter((p) => !p.gallery);
  const films = painters.reduce((n, p) => n + p.films.length, 0);
  const list = (ps: typeof painters) => (
    <ul className={styles.list}>
      {ps.map((p) => (
        <li key={p.slug}>
          <Link href={`/cinema/${p.slug}`} className={styles.card}>
            <b>{p.name}</b>
            <small>
              {p.years ? `${p.years} · ` : ""}
              {p.films.length} film{p.films.length === 1 ? "" : "s"}
            </small>
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <Link href="/" className="mus-back">
          ← Timeline
        </Link>
        <h1>Painters on film</h1>
        <p>
          {`${films} films about ${painters.length} painters: documentaries, television portraits and archive footage ` +
            "that their Wikipedia articles link, in every language. Each plays in a small cinema, on a projector, from " +
            "where it lives (Wikimedia Commons, ERT's archive, YouTube, Vimeo…)."}
        </p>
      </header>
      <section>
        <h2>Painters with a gallery here</h2>
        {list(withGallery)}
      </section>
      {others.length > 0 && (
        <section>
          <h2>Greek painters on film</h2>
          <p className={styles.note}>No gallery here (most are still in copyright): their films only.</p>
          {list(others)}
        </section>
      )}
    </main>
  );
}
