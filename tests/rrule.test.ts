import { describe, it, expect } from "vitest";
import {
  buildRRule,
  parseRRule,
  getStartDay,
  DAY_MAP,
} from "../src/utils/rrule";

describe("buildRRule", () => {
  it("emits FREQ alone for the simplest rule", () => {
    expect(buildRRule({ frequency: "DAILY", interval: 1, end: { type: "never" } }))
      .toBe("RRULE:FREQ=DAILY");
  });

  it("omits INTERVAL when it is 1", () => {
    // Google treats INTERVAL=1 as the default; emitting it is noise.
    const r = buildRRule({ frequency: "WEEKLY", interval: 1, end: { type: "never" } });
    expect(r).not.toContain("INTERVAL");
  });

  it("includes INTERVAL above 1", () => {
    expect(buildRRule({ frequency: "WEEKLY", interval: 3, end: { type: "never" } }))
      .toContain("INTERVAL=3");
  });

  it("emits BYDAY only for WEEKLY", () => {
    const weekly = buildRRule({
      frequency: "WEEKLY", interval: 1,
      days: ["MO", "WE"], end: { type: "never" },
    });
    expect(weekly).toContain("BYDAY=MO,WE");

    const monthly = buildRRule({
      frequency: "MONTHLY", interval: 1,
      days: ["MO", "WE"], end: { type: "never" },
    });
    expect(monthly).not.toContain("BYDAY");
  });

  it("omits BYDAY when the day list is empty", () => {
    expect(buildRRule({
      frequency: "WEEKLY", interval: 1, days: [], end: { type: "never" },
    })).not.toContain("BYDAY");
  });

  it("encodes 'every weekday except Wednesday' as an explicit BYDAY list", () => {
    // RRULE has no "except" operator — the encoding is the remaining days.
    expect(buildRRule({
      frequency: "WEEKLY", interval: 1,
      days: ["MO", "TU", "TH", "FR"], end: { type: "never" },
    })).toContain("BYDAY=MO,TU,TH,FR");
  });

  it("strips dashes and colons from UNTIL", () => {
    const r = buildRRule({
      frequency: "DAILY", interval: 1,
      end: { type: "until", date: "2026-03-15" },
    });
    const until = r.split("UNTIL=")[1];
    expect(until).toBeDefined();
    expect(until).not.toMatch(/[-:]/);
    expect(until).toContain("20260315");
  });

  it("emits COUNT and never both COUNT and UNTIL", () => {
    const r = buildRRule({
      frequency: "DAILY", interval: 1, end: { type: "count", count: 5 },
    });
    expect(r).toContain("COUNT=5");
    expect(r).not.toContain("UNTIL");
  });
});

describe("parseRRule", () => {
  it("defaults a bare rule to interval 1 and no end", () => {
    expect(parseRRule("RRULE:FREQ=DAILY")).toMatchObject({
      frequency: "DAILY", interval: 1, days: [], endType: "never",
    });
  });

  it("parses with or without the RRULE: prefix", () => {
    expect(parseRRule("FREQ=WEEKLY").frequency).toBe("WEEKLY");
    expect(parseRRule("RRULE:FREQ=WEEKLY").frequency).toBe("WEEKLY");
  });

  it("reformats UNTIL back to YYYY-MM-DD for a date input", () => {
    expect(parseRRule("RRULE:FREQ=DAILY;UNTIL=20260315T000000Z"))
      .toMatchObject({ endType: "until", untilDate: "2026-03-15" });
  });

  it("reads COUNT as the end condition", () => {
    expect(parseRRule("RRULE:FREQ=DAILY;COUNT=4"))
      .toMatchObject({ endType: "count", countNum: 4 });
  });

  it("ignores malformed segments rather than throwing", () => {
    expect(() => parseRRule("RRULE:FREQ=WEEKLY;;GARBAGE;BYDAY=")).not.toThrow();
    expect(parseRRule("RRULE:FREQ=WEEKLY;;GARBAGE").frequency).toBe("WEEKLY");
  });
});

describe("buildRRule / parseRRule round-trip", () => {
  // These two are inverses in the UI: parse to populate the form,
  // build to save. Drift between them silently loses a user's settings.
  it("survives a weekly rule with days and an interval", () => {
    const original = {
      frequency: "WEEKLY" as const, interval: 2,
      days: ["MO" as const, "TH" as const], end: { type: "never" as const },
    };
    const parsed = parseRRule(buildRRule(original));
    expect(parsed.frequency).toBe("WEEKLY");
    expect(parsed.interval).toBe(2);
    expect(parsed.days).toEqual(["MO", "TH"]);
    expect(parsed.endType).toBe("never");
  });

  it("survives a COUNT rule", () => {
    const parsed = parseRRule(buildRRule({
      frequency: "MONTHLY", interval: 1, end: { type: "count", count: 12 },
    }));
    expect(parsed).toMatchObject({
      frequency: "MONTHLY", endType: "count", countNum: 12,
    });
  });

  it("survives an UNTIL rule to the same calendar day", () => {
    const parsed = parseRRule(buildRRule({
      frequency: "DAILY", interval: 1,
      end: { type: "until", date: "2026-06-30" },
    }));
    expect(parsed.endType).toBe("until");
    expect(parsed.untilDate).toBe("2026-06-30");
  });
});

describe("getStartDay", () => {
  it("maps a date onto its RRULE day code", () => {
    // 2026-03-16 is a Monday.
    expect(getStartDay("2026-03-16T09:00:00.000Z")).toBe("MO");
  });

  it("is indexed by getDay(), so Sunday is first", () => {
    expect(DAY_MAP[0]).toBe("SU");
    expect(DAY_MAP).toHaveLength(7);
  });

  it("falls back to MO for an unparseable date instead of undefined", () => {
    // noUncheckedIndexedAccess makes DAY_MAP[NaN] `undefined`; the ?? guard
    // is what stops an invalid date producing "BYDAY=undefined".
    expect(getStartDay("not-a-date")).toBe("MO");
  });
});
