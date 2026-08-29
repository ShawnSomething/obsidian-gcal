export type ViewType = "day" | "3day" | "week";

// The fetch window for a given date and view.
// Week view snaps back to Monday so events earlier in the week are inside timeMin.
export function getViewWindow(
  date: Date,
  view: ViewType
): { timeMin: Date; timeMax: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  if (view === "week") {
    const dayOfWeek = start.getDay();
    // (dayOfWeek + 6) % 7 maps Sun→6, Mon→0, Tue→1 …
    // Without the +6 offset Sunday yields -1 and jumps forward a week.
    const daysFromMonday = (dayOfWeek + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
  }

  const end = new Date(start);
  if (view === "day") end.setDate(end.getDate() + 1);
  else if (view === "3day") end.setDate(end.getDate() + 3);
  else end.setDate(end.getDate() + 7);

  return { timeMin: start, timeMax: end };
}

// Returns the timeMin of the window immediately before and after the given date/view.
// Both dates are window-aligned (Monday-snapped for week view, etc.).
export function getAdjacentDates(
  date: Date,
  view: ViewType
): { prevDate: Date; nextDate: Date } {
  const { timeMin: windowStart } = getViewWindow(date, view);
  const prevDate = new Date(windowStart);
  const nextDate = new Date(windowStart);

  const span = view === "day" ? 1 : view === "3day" ? 3 : 7;
  prevDate.setDate(prevDate.getDate() - span);
  nextDate.setDate(nextDate.getDate() + span);

  return { prevDate, nextDate };
}
