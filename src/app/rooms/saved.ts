// The rooms a visitor saved, entered or shared, kept in this browser (Make a room adds them, My rooms lists them;
// the gallery adds a room on entering it, src/components/museum/MuseumApp.tsx).

export interface SavedRoom {
  title: string;
  query: string;
  savedAt: string;
}

const MY_ROOMS = "timeline-museum:my-rooms";

export function readSaved(): SavedRoom[] {
  try {
    return JSON.parse(localStorage.getItem(MY_ROOMS) ?? "[]") as SavedRoom[];
  } catch {
    return [];
  }
}
export function writeSaved(rooms: SavedRoom[]) {
  try {
    localStorage.setItem(MY_ROOMS, JSON.stringify(rooms.slice(0, 60)));
  } catch {}
}
