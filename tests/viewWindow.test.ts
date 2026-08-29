import { describe, it, expect } from "vitest";
import { getViewWindow, getAdjacentDates } from "../src/utils/viewWindow";

// Local dates — getViewWindow works in device-local time via setHours(0,0,0,0).
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const ymd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

describe("getViewWindow", () => {
  it("day view spans exactly one day from midnight", () => {
    const { timeMin, timeMax } = getViewWindow(at(2026, 3, 18), "day");
    expect(ymd(timeMin)).toBe("2026-03-18");
    expect(ymd(timeMax)).toBe("2026-03-19");
    expect(timeMin.getHours()).toBe(0);
  });

  it("3day view spans three days from the selected date", () => {
    const { timeMin, timeMax } = getViewWindow(at(2026, 3, 18), "3day");
    expect(ymd(timeMin)).toBe("2026-03-18");
    expect(ymd(timeMax)).toBe("2026-03-21");
  });

  it("week view snaps back to Monday", () => {
    // 2026-03-18 is a Wednesday; the window must start Monday the 16th,
    // otherwise Mon/Tue events fall outside timeMin and are never fetched.
    const { timeMin, timeMax } = getViewWindow(at(2026, 3, 18), "week");
    expect(timeMin.getDay()).toBe(1);
    expect(ymd(timeMin)).toBe("2026-03-16");
    expect(ymd(timeMax)).toBe("2026-03-23");
  });

  it("week view treats Sunday as the END of its week, not the start", () => {
    // The (dayOfWeek + 6) % 7 offset exists for this case. Sunday is
    // getDay() === 0; a naive `dayOfWeek - 1` gives -1 and skips a week
    // forward, losing the six days the user is looking at.
    const { timeMin } = getViewWindow(at(2026, 3, 22), "week"); // a Sunday
    expect(timeMin.getDay()).toBe(1);
    expect(ymd(timeMin)).toBe("2026-03-16");
  });

  it("week view is idempotent when already on a Monday", () => {
    const { timeMin } = getViewWindow(at(2026, 3, 16), "week");
    expect(ymd(timeMin)).toBe("2026-03-16");
  });

  it("does not mutate the date passed in", () => {
    const input = at(2026, 3, 18);
    const before = input.getTime();
    getViewWindow(input, "week");
    expect(input.getTime()).toBe(before);
  });

  it("handles a month boundary", () => {
    const { timeMin, timeMax } = getViewWindow(at(2026, 3, 31), "day");
    expect(ymd(timeMin)).toBe("2026-03-31");
    expect(ymd(timeMax)).toBe("2026-04-01");
  });
});

describe("getAdjacentDates", () => {
  it("steps one day either side in day view", () => {
    const { prevDate, nextDate } = getAdjacentDates(at(2026, 3, 18), "day");
    expect(ymd(prevDate)).toBe("2026-03-17");
    expect(ymd(nextDate)).toBe("2026-03-19");
  });

  it("steps three days either side in 3day view", () => {
    const { prevDate, nextDate } = getAdjacentDates(at(2026, 3, 18), "3day");
    expect(ymd(prevDate)).toBe("2026-03-15");
    expect(ymd(nextDate)).toBe("2026-03-21");
  });

  it("steps a full week from the Monday-aligned start, not from the given date", () => {
    // Called with a Wednesday; adjacent windows must still be Mondays,
    // or SHIFT_FORWARD/SHIFT_BACK swap in data for the wrong range.
    const { prevDate, nextDate } = getAdjacentDates(at(2026, 3, 18), "week");
    expect(ymd(prevDate)).toBe("2026-03-09");
    expect(ymd(nextDate)).toBe("2026-03-23");
    expect(prevDate.getDay()).toBe(1);
    expect(nextDate.getDay()).toBe(1);
  });

  it("produces windows that abut the current one exactly", () => {
    // The sliding-window shift assumes no gap and no overlap between
    // prev | current | next.
    for (const view of ["day", "3day", "week"] as const) {
      const date = at(2026, 3, 18);
      const current = getViewWindow(date, view);
      const { prevDate, nextDate } = getAdjacentDates(date, view);
      expect(getViewWindow(prevDate, view).timeMax.getTime()).toBe(current.timeMin.getTime());
      expect(getViewWindow(nextDate, view).timeMin.getTime()).toBe(current.timeMax.getTime());
    }
  });
});
