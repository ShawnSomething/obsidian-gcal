import { useState } from "react";
import { CalEvent } from "../context/CalendarContext";

interface Props {
  event: CalEvent;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean }) => void;
  onClose: () => void;
}

function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function getTimezoneOffset(isoString: string): string {
  const match = isoString.match(/(Z|[+-]\d{2}:\d{2})$/);
  return match?.[1] ?? "Z";
}

export default function EventModal({ event, onSave, onClose }: Props) {
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(toLocalInput(event.start));
  const [end, setEnd] = useState(toLocalInput(event.end));
  const [allDay, setAllDay] = useState(event.allDay);

  const tzOffset = getTimezoneOffset(event.start);

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--background-primary)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "8px",
        padding: "20px",
        width: "360px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>Edit Event</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
          >✕</button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title"
          style={{
            background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "4px",
            padding: "6px 8px",
            color: "var(--text-normal)",
            width: "100%",
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-normal)" }}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>

        {!allDay && (
          <>
            <label style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Start
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={{
                  display: "block",
                  marginTop: "4px",
                  background: "var(--background-secondary)",
                  border: "1px solid var(--background-modifier-border)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  color: "var(--text-normal)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <label style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              End
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={{
                  display: "block",
                  marginTop: "4px",
                  background: "var(--background-secondary)",
                  border: "1px solid var(--background-modifier-border)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  color: "var(--text-normal)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid var(--background-modifier-border)",
              borderRadius: "4px",
              padding: "6px 12px",
              cursor: "pointer",
              color: "var(--text-normal)",
            }}
          >Cancel</button>
          <button
            onClick={() => onSave({
              title,
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              allDay,
            })}
            style={{
              background: "var(--interactive-accent)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              cursor: "pointer",
              color: "white",
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}