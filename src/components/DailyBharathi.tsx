import { dailyBharathiForDate } from "@/lib/daily-bharathi";
import { BharathiPoster } from "@/components/BharathiPoster";

export function DailyBharathi({ date }: { date: string }) {
  const item = dailyBharathiForDate(date);
  return <BharathiPoster item={item} />;
}
