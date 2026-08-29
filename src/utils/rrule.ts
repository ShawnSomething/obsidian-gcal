export type RRuleFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RRuleDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RRuleEnd =
  | { type: "never" }
  | { type: "until"; date: string }  // YYYY-MM-DD
  | { type: "count"; count: number };

export interface RRuleOptions {
  frequency: RRuleFrequency;
  interval: number;        // always >= 1
  days?: RRuleDay[];       // only relevant when frequency === "WEEKLY"
  end: RRuleEnd;
}

export function buildRRule(options: RRuleOptions): string {
  const parts: string[] = [];

  parts.push(`FREQ=${options.frequency}`);

  if (options.interval > 1) {
    parts.push(`INTERVAL=${options.interval}`);
  }

  if (options.frequency === "WEEKLY" && options.days && options.days.length > 0) {
    parts.push(`BYDAY=${options.days.join(",")}`);
  }

  if (options.end.type === "until") {
    const until = new Date(options.end.date)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(".000", "");
    parts.push(`UNTIL=${until}`);
  } else if (options.end.type === "count") {
    parts.push(`COUNT=${options.end.count}`);
  }

  return `RRULE:${parts.join(";")}`;
}
export interface ParsedRRule {
  frequency: RRuleFrequency;
  interval: number;
  days: RRuleDay[];
  endType: "never" | "until" | "count";
  untilDate: string;   // YYYY-MM-DD, "" when endType !== "until"
  countNum: number;
}

// Reads a raw RRULE string back into the shape EventModal's form state uses.
// Inverse of buildRRule for every field buildRRule emits.
export function parseRRule(rruleStr: string): ParsedRRule {
  const str = rruleStr.replace(/^RRULE:/, "");
  const parts: Record<string, string> = {};
  str.split(";").forEach((part) => {
    const [key, val] = part.split("=");
    if (key && val) parts[key] = val;
  });
  const frequency = (parts["FREQ"] as RRuleFrequency) ?? "WEEKLY";
  const interval = parts["INTERVAL"] ? parseInt(parts["INTERVAL"]) : 1;
  const days = parts["BYDAY"] ? (parts["BYDAY"].split(",") as RRuleDay[]) : [];
  let endType: "never" | "until" | "count" = "never";
  let untilDate = "";
  let countNum = 1;
  if (parts["UNTIL"]) {
    endType = "until";
    const u = parts["UNTIL"];
    untilDate = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  } else if (parts["COUNT"]) {
    endType = "count";
    countNum = parseInt(parts["COUNT"]);
  }
  return { frequency, interval, days, endType, untilDate, countNum };
}

// Index by Date.getDay() (0 = Sunday). Array access is checked under
// noUncheckedIndexedAccess, hence the ?? fallback.
export const DAY_MAP: RRuleDay[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function getStartDay(startStr: string): RRuleDay {
  return DAY_MAP[new Date(startStr).getDay()] ?? "MO";
}
