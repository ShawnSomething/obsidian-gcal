import { describe, it, expect } from "vitest";
import { deduplicateEvents } from "../src/utils/dedup";
import type { CalEvent } from "../src/context/CalendarContext";

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: "id-1", iCalUID: "uid-1", calendarId: "cal-a", accountId: "acc-a",
  title: "Event", start: "2026-03-18T09:00:00.000Z", end: "2026-03-18T10:00:00.000Z",
  allDay: false, htmlLink: "", color: "", attendees: [],
  selfResponseStatus: "accepted", ...over,
});

describe("deduplicateEvents", () => {
  it("collapses the same event seen twice", () => {
    // A calendar shared across two connected accounts returns the same
    // event once per account.
    expect(deduplicateEvents([ev({}), ev({ calendarId: "cal-b" })])).toHaveLength(1);
  });

  it("keeps recurring instances that share an iCalUID", () => {
    // The key is `iCalUID + start`, not iCalUID alone. Every instance of a
    // series carries the same iCalUID; keying on it alone collapses a
    // weekly meeting down to a single occurrence.
    const series = [
      ev({ id: "a_20260316", start: "2026-03-16T09:00:00.000Z" }),
      ev({ id: "a_20260317", start: "2026-03-17T09:00:00.000Z" }),
      ev({ id: "a_20260318", start: "2026-03-18T09:00:00.000Z" }),
    ];
    expect(deduplicateEvents(series)).toHaveLength(3);
  });

  it("keeps distinct events apart", () => {
    expect(deduplicateEvents([ev({}), ev({ iCalUID: "uid-2" })])).toHaveLength(2);
  });

  it("keeps the first occurrence when duplicates differ", () => {
    const out = deduplicateEvents([
      ev({ title: "First" }),
      ev({ title: "Second" }),
    ]);
    expect(out[0]?.title).toBe("First");
  });

  it("returns an empty array unchanged", () => {
    expect(deduplicateEvents([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [ev({}), ev({})];
    deduplicateEvents(input);
    expect(input).toHaveLength(2);
  });
});
