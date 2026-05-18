import { CalEvent } from "../context/CalendarContext";

export function deduplicateEvents(events: CalEvent[]): CalEvent[] {
    const seen = new Map<string, CalEvent>();

    for (const event of events) {
        const key = `${event.iCalUID}::${event.start}`;
        if (!seen.has(key)) {
            seen.set(key, event);
        }
    }

    return Array.from(seen.values());
}