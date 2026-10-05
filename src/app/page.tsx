import { getTimeline } from "@/lib/data";
import { Timeline } from "@/components/timeline/Timeline";

export const revalidate = 3600;

export default async function Home() {
  const data = await getTimeline();
  return <Timeline data={data} />;
}
