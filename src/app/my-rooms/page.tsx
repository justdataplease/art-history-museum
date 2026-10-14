import type { Metadata } from "next";
import { MyRooms } from "./MyRooms";

export const metadata: Metadata = {
  title: "My rooms · A Walkable History of Art",
  description: "Real museums recreated room by room (beta), and the rooms you saved: walk one, change it, share the link.",
};

export default function MyRoomsPage() {
  return <MyRooms />;
}
