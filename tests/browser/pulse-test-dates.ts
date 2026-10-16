/** Browser fixtures and expectations use the history's zone, not the runner's. */
export function pulseDayKey(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

/** Pick an instant inside the requested fixture day, even at UTC+14/UTC-12. */
export function pulseFixtureInstant(day: string, timeZone: string): number {
  const noon = Date.parse(`${day}T12:00:00Z`);
  const observedDay = pulseDayKey(noon, timeZone);
  return noon + Date.parse(day) - Date.parse(observedDay);
}
