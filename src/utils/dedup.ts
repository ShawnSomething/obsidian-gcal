import { CalEvent } from "../context/CalendarContext";

export function deduplicateEvents(events: CalEvent[]): CalEvent[] {
    const seen = new Map<string, CalEvent>();

    for (const event of events) {
        if (!seen.has(event.iCalUID)) {
            seen.set(event.iCalUID, event);
        }
    }

    return Array.from(seen.values());
}