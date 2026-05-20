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