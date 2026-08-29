import { describe, it, expect } from "vitest";
import { desaturateHex } from "../src/utils/color";

describe("desaturateHex", () => {
  it("returns a 7-character hex string", () => {
    expect(desaturateHex("#4285F4", 0.2)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("leaves the colour unchanged at amount 0", () => {
    expect(desaturateHex("#4285F4", 0)).toBe("#4285f4");
  });

  it("moves a saturated colour toward grey", () => {
    const spread = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
    };
    // Lower channel spread means less saturation.
    expect(spread(desaturateHex("#4285F4", 0.3))).toBeLessThan(spread("#4285F4"));
  });

  it("handles greys, which have no hue to preserve", () => {
    expect(desaturateHex("#808080", 0.2)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("clamps rather than inverting when over-desaturated", () => {
    // Saturation floors at 0; a large amount must not wrap around.
    const out = desaturateHex("#4285F4", 5);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(1);
  });

  it("handles pure black and white", () => {
    expect(desaturateHex("#000000", 0.2)).toBe("#000000");
    expect(desaturateHex("#ffffff", 0.2)).toBe("#ffffff");
  });
});
