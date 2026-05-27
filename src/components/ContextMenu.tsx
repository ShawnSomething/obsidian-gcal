import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CalEvent } from "../context/CalendarContext";

interface Props {
  calEvent: CalEvent;
  x: number;
  y: number;
  onClose: () => void;
  onJoinMeeting?: () => void;
  onDuplicate: () => void;
  onRespond: (status: "accepted" | "declined" | "tentative") => void;
  onDelete: () => void;
}

export default function ContextMenu({
  calEvent, x, y, onClose, onJoinMeeting, onDuplicate, onRespond, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 180);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return createPortal(
    <div ref={ref} className="gcal-context-menu" style={{ left, top }}>
      {onJoinMeeting && (
        <button className="gcal-context-item" onClick={() => { onClose(); onJoinMeeting(); }}>
          <span className="gcal-context-icon">📹</span>
          Join meeting
        </button>
      )}
      <button className="gcal-context-item" onClick={() => { onClose(); onDuplicate(); }}>
        <span className="gcal-context-icon">⎘</span>
        Duplicate
      </button>
      <div className="gcal-context-rsvp">
        <span className="gcal-context-rsvp-label">Going?</span>
        <div className="gcal-context-rsvp-btns">
          {(["accepted", "tentative", "declined"] as const).map((status) => (
            <button
              key={status}
              className={[
                "gcal-btn-response",
                `gcal-btn-response--${status}`,
                calEvent.selfResponseStatus === status ? "gcal-btn-response--active" : "",
              ].join(" ").trim()}
              onClick={() => { onClose(); onRespond(status); }}
            >
              {status === "accepted" ? "Yes" : status === "tentative" ? "?" : "No"}
            </button>
          ))}
        </div>
      </div>
      <div className="gcal-context-divider" />
      <button
        className="gcal-context-item gcal-context-item--danger"
        onClick={() => { onClose(); onDelete(); }}
      >
        <span className="gcal-context-icon">🗑</span>
        Delete
      </button>
    </div>,
    document.body
  );
}