import { useState } from "react";
import { CalEvent, useCalendar } from "../context/CalendarContext";

type EditProps = {
  mode: "edit";
  event: CalEvent;
  askRecurring: (event: CalEvent) => Promise<"this" | "following" | null>;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean }) => void;
  onSplitSeries: (updates: { title: string; start: string; end: string; allDay: boolean }) => void;
  onClose: () => void;
};

type CreateProps = {
  mode: "create";
  initialStart: string;
  initialEnd: string;
  initialAllDay: boolean;
  onSave: (data: {
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    calendarId: string;
    accountId: string;
  }) => void;
  onClose: () => void;
};

type Props = EditProps | CreateProps;

function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function EventModal(props: Props) {
  const { state } = useCalendar();
  const isCreate = props.mode === "create";

  const [title, setTitle] = useState(
    isCreate ? "" : (props as EditProps).event.title
  );
  const [allDay, setAllDay] = useState(
    isCreate ? (props as CreateProps).initialAllDay : (props as EditProps).event.allDay
  );
  const [start, setStart] = useState(
    toLocalInput(isCreate ? (props as CreateProps).initialStart : (props as EditProps).event.start)
  );
  const [end, setEnd] = useState(
    toLocalInput(isCreate ? (props as CreateProps).initialEnd : (props as EditProps).event.end)
  );

  const defaultCal = state.calendars.find((c) => c.visible && (c.accessRole === "owner" || c.accessRole === "writer")) ?? state.calendars[0];
  const [selectedCalendarId, setSelectedCalendarId] = useState(defaultCal?.id ?? "");

  const handleSave = async () => {
    const startISO = new Date(start).toISOString();
    const endISO = new Date(end).toISOString();
    const finalStart = allDay ? startISO.slice(0, 10) : startISO;
    const finalEnd = allDay ? endISO.slice(0, 10) : endISO;

    if (isCreate) {
      const cal = state.calendars.find((c) => c.id === selectedCalendarId);
      (props as CreateProps).onSave({
        title,
        start: finalStart,
        end: finalEnd,
        allDay,
        calendarId: selectedCalendarId,
        accountId: cal?.accountId ?? "",
      });
      return;
    }

    const editProps = props as EditProps;
    const updates = { title, start: finalStart, end: finalEnd, allDay };

    if (editProps.event.recurringEventId) {
      const choice = await editProps.askRecurring(editProps.event);
      if (!choice) return;
      if (choice === "following") {
        editProps.onSplitSeries(updates);
        return;
      }
    }

    editProps.onSave(updates);
  };

  return (
    <div className="gcal-modal-backdrop" onClick={props.onClose}>
      <div className="gcal-modal" onClick={(e) => e.stopPropagation()}>

        <div className="gcal-modal-header">
          <span className="gcal-modal-title">{isCreate ? "New Event" : "Edit Event"}</span>
          <button className="gcal-modal-close" onClick={props.onClose}>✕</button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title"
          className="gcal-input"
          autoFocus
        />

        {isCreate && state.calendars.length > 0 && (
          <label className="gcal-field-label">
            Calendar
            <select
              value={selectedCalendarId}
              onChange={(e) => setSelectedCalendarId(e.target.value)}
              className="gcal-input"
            >
              {state.calendars.filter(c => c.accessRole === "owner" || c.accessRole === "writer").map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                </option>
              ))}
            </select>
          </label>
        )}

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
          <button className="gcal-modal-cancel" onClick={props.onClose}>Cancel</button>
          <button className="gcal-btn-primary" onClick={handleSave}>
            {isCreate ? "Create" : "Save"}
          </button>
        </div>

      </div>
    </div>
  );
}