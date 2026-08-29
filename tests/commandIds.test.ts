import { describe, it, expect, beforeEach } from "vitest";
import GCalPlugin from "../src/main";
import { VIEW_TYPE } from "../src/CalendarView";
import type { CommandSpec } from "./stubs/obsidian";

// ─────────────────────────────────────────────────────────────────────
// These strings are persisted in the USER'S vault, not just in our code.
//
//   - Obsidian saves hotkey assignments against a command's `id`.
//   - The workspace layout remembers which view is in which sidebar slot
//     by its view type string.
//
// Renaming either silently breaks a user's setup: the hotkey stops doing
// anything and the panel vanishes from its saved position, with no error.
// Display names (`name`) are safe to change; ids are not.
//
// If a test here fails because you renamed an id, that is the test doing
// its job. Restore the id and change the name instead.
// ─────────────────────────────────────────────────────────────────────

const EXPECTED_COMMAND_IDS = [
  "open-gcal-view",
  "gcal-view-day",
  "gcal-view-3day",
  "gcal-view-week",
  "gcal-today",
  "gcal-refresh",
  "gcal-next",
  "gcal-prev",
  "gcal-duplicate-event",
] as const;

const EXPECTED_VIEW_TYPE = "gcal-view";

// At runtime vitest aliases "obsidian" to tests/stubs/obsidian.ts, so GCalPlugin
// extends the recording stub and gains `commands` / `views` / `ribbonIcons`, and
// its constructor takes no arguments. tsc still resolves "obsidian" to the real
// types-only package, where none of that is true — hence the cast. Describe only
// what the test needs rather than intersecting with the real Plugin type.
interface RecordingPlugin {
  onload(): Promise<void>;
  commands: CommandSpec[];
  views: string[];
  ribbonIcons: { icon: string; title: string }[];
}

const PluginCtor = GCalPlugin as unknown as new () => RecordingPlugin;

let plugin: RecordingPlugin;

beforeEach(async () => {
  plugin = new PluginCtor();
  await plugin.onload();
});

describe("command ids (user hotkeys bind to these)", () => {
  it("registers exactly the expected ids", () => {
    expect(plugin.commands.map((c) => c.id)).toEqual([...EXPECTED_COMMAND_IDS]);
  });

  it("registers no duplicate ids", () => {
    const ids = plugin.commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every command a non-empty name", () => {
    for (const c of plugin.commands) {
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("view type (workspace layout binds to this)", () => {
  it("is unchanged", () => {
    expect(VIEW_TYPE).toBe(EXPECTED_VIEW_TYPE);
  });

  it("is the type actually registered on load", () => {
    expect(plugin.views).toContain(EXPECTED_VIEW_TYPE);
  });
});

describe("command names", () => {
  it("does not repeat the plugin name", () => {
    // Obsidian prefixes commands with the plugin name in the palette, so a
    // name of "Google Calendar: Day view" rendered as
    // "GCal Sidebar: Google Calendar: Day view". Fixed in Phase 13/14.
    for (const c of plugin.commands) {
      expect(c.name.toLowerCase()).not.toContain("gcal sidebar");
      expect(c.name.toLowerCase()).not.toContain("google calendar:");
    }
  });

  it("uses sentence case", () => {
    // Matches the obsidianmd/ui/sentence-case lint rule so a bad name is
    // caught even if the linter is not run.
    for (const c of plugin.commands) {
      const words = c.name.split(" ").slice(1);
      const offenders = words.filter(
        (w) => /^[A-Z]/.test(w) && !["Google", "Calendar"].includes(w)
      );
      expect(offenders).toEqual([]);
    }
  });
});

describe("ribbon icon", () => {
  it("registers one, using the custom icon", () => {
    expect(plugin.ribbonIcons).toHaveLength(1);
    expect(plugin.ribbonIcons[0]?.icon).toBe("gcal-icon");
  });
});
