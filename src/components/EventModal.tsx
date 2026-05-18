import { useState } from "react";
import { CalEvent } from "../context/CalendarContext";

interface Props {
  event: CalEvent;
  askRecurring: (event: CalEvent) => Promise<"this" | "following" | null>;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean }) => void;
  onSplitSeries: (updates: { title: string; start: string; end: string; allDay: boolean }) => void;
  onClose: () => void;
}

function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function EventModal({ event, askRecurring, onSave, onSplitSeries, onClose }: Props) {
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(toLocalInput(event.start));
  const [end, setEnd] = useState(toLocalInput(event.end));
  const [allDay, setAllDay] = useState(event.allDay);

  const handleSave = async () => {
    const updates = {
      title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      allDay,
    };

    if (event.recurringEventId) {
      const choice = await askRecurring(event);
      if (!choice) return;

      if (choice === "following") {
        onSplitSeries(updates);
        return;
      }
    }

    onSave(updates);
  };

  return (
    <div className="gcal-modal-backdrop" onClick={onClose}>
      <div className="gcal-modal" onClick={(e) => e.stopPropagation()}>

        <div className="gcal-modal-header">
          <span className="gcal-modal-title">Edit Event</span>
          <button className="gcal-modal-close" onClick={onClose}>✕</button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title"
          className="gcal-input"
        />

        <label className="gcal-checkbox-label">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>

        {!allDay && (
          <>
            <label className="gcal-field-label">
              Start
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="gcal-input"
              />
            </label>

            <label className="gcal-field-label">
              End
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="gcal-input"
              />
            </label>
          </>
        )}

        <div className="gcal-modal-footer">
          <button className="gcal-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="gcal-btn-primary" onClick={handleSave}>Save</button>
        </div>

      </div>
    </div>
  );
}