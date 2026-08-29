import { describe, it, expect } from "vitest";
import { toLocalInput } from "../src/utils/datetime";

describe("toLocalInput", () => {
  it("produces the exact shape a datetime-local input requires", () => {
    expect(toLocalInput("2026-03-18T09:00:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
    );
  });

  it("has no seconds or timezone suffix", () => {
    const out = toLocalInput("2026-03-18T09:00:00.000Z");
    expect(out).toHaveLength(16);
    expect(out).not.toContain("Z");
  });

  it("round-trips back to the original instant", () => {
    // This is the contract with EventModal's save path, which does
    // `new Date(localString).toISOString()`. Manually reattaching the
    // offset instead would double-shift the time.
    const original = "2026-03-18T09:30:00.000Z";
    const restored = new Date(toLocalInput(original)).toISOString();
    expect(new Date(restored).getTime()).toBe(new Date(original).getTime());
  });

  it("round-trips across a date boundary", () => {
    const original = "2026-03-18T23:45:00.000Z";
    const restored = new Date(toLocalInput(original)).toISOString();
    expect(new Date(restored).getTime()).toBe(new Date(original).getTime());
  });

  it("renders the local wall-clock time, not the UTC one", () => {
    const iso = "2026-03-18T09:00:00.000Z";
    const expected = new Date(iso).getHours();
    expect(Number(toLocalInput(iso).slice(11, 13))).toBe(expected);
  });
});
