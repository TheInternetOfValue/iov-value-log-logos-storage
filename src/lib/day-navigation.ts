export type DayNavigation = {
  dates: string[];
  previous: string;
  next: string | null;
  today: string;
  isToday: boolean;
  isFuture: boolean;
};

export function dayNavigation(selected: string, today: string): DayNavigation {
  const isToday = selected === today;
  const isFuture = selected > today;
  let start = addDays(selected, -3);

  if (!isFuture && addDays(start, 6) > today) {
    start = addDays(today, -6);
  }

  return {
    dates: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    previous: addDays(selected, -1),
    next: isToday ? null : addDays(selected, 1),
    today,
    isToday,
    isFuture,
  };
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
