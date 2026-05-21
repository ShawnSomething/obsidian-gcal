import { useState } from "react";
import { CalEvent, useCalendar } from "../context/CalendarContext";
import { RRuleFrequency, RRuleDay, buildRRule } from "../utils/rrule";

type EditProps = {
  mode: "edit";
  event: CalEvent;
  askRecurring: (event: CalEvent, opts?: { title?: string; hideFollowing?: boolean; showAll?: boolean }) => Promise<"this" | "following" | "all" | null>;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string }) => void;
  onSplitSeries: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string }) => void;
  onDelete: () => void;
  onRespond?: (status: "accepted" | "declined" | "tentative") => void;
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
    recurrence?: string[];
    location?: string;
    description?: string;
  }) => void;
  onClose: () => void;
};

type Props = EditProps | CreateProps;

function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const DAY_MAP: RRuleDay[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const getStartDay = (startStr: string): RRuleDay => DAY_MAP[new Date(startStr).getDay()] ?? "MO";

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
  const [location, setLocation] = useState(
    isCreate ? "" : ((props as EditProps).event.location ?? "")
  );
  const [description, setDescription] = useState(
    isCreate ? "" : ((props as EditProps).event.description ?? "")
  );

  const hangoutLink = isCreate ? undefined : (props as EditProps).event.hangoutLink;

  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<RRuleFrequency>("WEEKLY");
  const [interval, setInterval] = useState(1);
  const [days, setDays] = useState<RRuleDay[]>([getStartDay(start)]);
  const [endType, setEndType] = useState<"never" | "until" | "count">("never");
  const [untilDate, setUntilDate] = useState("");
  const [countNum, setCountNum] = useState(1);

  const ALL_DAYS: RRuleDay[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const DAY_LABELS: Record<RRuleDay, string> = {
    MO: "Mo", TU: "Tu", WE: "We", TH: "Th", FR: "Fr", SA: "Sa", SU: "Su"
  };

  const toggleDay = (day: RRuleDay) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const defaultCal = state.calendars.find((c) => c.visible && (c.accessRole === "owner" || c.accessRole === "writer")) ?? state.calendars[0];
  const [selectedCalendarId, setSelectedCalendarId] = useState(defaultCal?.id ?? "");

  const handleSave = async () => {
    const startISO = new Date(start).toISOString();
    const endISO = new Date(end).toISOString();
    const finalStart = allDay ? startISO.slice(0, 10) : startISO;
    const finalEnd = allDay ? endISO.slice(0, 10) : endISO;

    if (isCreate) {
      const cal = state.calendars.find((c) => c.id === selectedCalendarId);

      let recurrence: string[] | undefined;
      if (repeat) {
        const rrule = buildRRule({
          frequency,
          interval,
          days: frequency === "WEEKLY" ? days : undefined,
          end:
            endType === "until"
              ? { type: "until", date: untilDate }
              : endType === "count"
                ? { type: "count", count: countNum }
                : { type: "never" },
        });
        recurrence = [rrule];
      }

      (props as CreateProps).onSave({
        title,
        start: finalStart,
        end: finalEnd,
        allDay,
        calendarId: selectedCalendarId,
        accountId: cal?.accountId ?? "",
        recurrence,
        location: location || undefined,
        description: description || undefined,
      });
      return;
    }

    const editProps = props as EditProps;
    const updates = {
      title,
      start: finalStart,
      end: finalEnd,
      allDay,
      location: location || undefined,
      description: description || undefined,
    };

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

        {hangoutLink && (
          <button
            className="gcal-btn-meet"
            onClick={() => window.open(hangoutLink, "_blank")}
          >
            📹 Join Google Meet
          </button>
        )}

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

        <label className="gcal-field-label">
          Location
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add location"
            className="gcal-input"
          />
        </label>

        <label className="gcal-field-label">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description"
            className="gcal-input gcal-textarea"
            rows={3}
          />
        </label>

        {props.mode === "edit" && (props as EditProps).event.attendees.length > 0 && (
          <div className="gcal-field-label">
            Guests
            <div className="gcal-attendee-list">
              {(props as EditProps).event.attendees.map((a) => (
                <div key={a.email} className="gcal-attendee-row">
                  <span className="gcal-attendee-email">{a.email}</span>
                  <span className={`gcal-attendee-status--${a.responseStatus}`}>
                    {a.responseStatus === "accepted" ? "✓"
                      : a.responseStatus === "declined" ? "✗"
                        : a.responseStatus === "tentative" ? "?"
                          : "–"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {props.mode === "create" && (
          <>
            <label className="gcal-checkbox-label">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
              />
              Repeat
            </label>

            {repeat && (
              <div className="gcal-recurrence-block">
                <label className="gcal-field-label">
                  Frequency
                  <select
                    value={frequency}
                    onChange={(e) => {
                      const freq = e.target.value as RRuleFrequency;
                      setFrequency(freq);
                      if (freq === "WEEKLY" && days.length === 0) {
                        setDays([getStartDay(start)]);
                      }
                    }}
                    className="gcal-input"
                  >
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </label>

                <label className="gcal-field-label">
                  Every
                  <input
                    type="number"
                    min={1}
                    value={interval}
                    onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    className="gcal-input"
                  />
                </label>

                {frequency === "WEEKLY" && (
                  <div className="gcal-day-picker">
                    {ALL_DAYS.map(day => (
                      <button
                        key={day}
                        className={`gcal-day-btn${days.includes(day) ? " gcal-day-btn--active" : ""}`}
                        onClick={() => toggleDay(day)}
                      >
                        {DAY_LABELS[day]}
                      </button>
                    ))}
                  </div>
                )}

                <label className="gcal-field-label">
                  Ends
                  <select
                    value={endType}
                    onChange={(e) => setEndType(e.target.value as "never" | "until" | "count")}
                    className="gcal-input"
                  >
                    <option value="never">Never</option>
                    <option value="until">On date</option>
                    <option value="count">After N occurrences</option>
                  </select>
                </label>

                {endType === "until" && (
                  <label className="gcal-field-label">
                    End date
                    <input
                      type="date"
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className="gcal-input"
                    />
                  </label>
                )}

                {endType === "count" && (
                  <label className="gcal-field-label">
                    Occurrences
                    <input
                      type="number"
                      min={1}
                      value={countNum}
                      onChange={(e) => setCountNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="gcal-input"
                    />
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {props.mode === "edit" && (
          <div className="gcal-response-row">
            <span className="gcal-field-label">Going?</span>
            <div className="gcal-response-buttons">
              {(["accepted", "tentative", "declined"] as const).map((status) => (
                <button
                  key={status}
                  className={`gcal-btn-response gcal-btn-response--${status}${(props as EditProps).event.selfResponseStatus === status ? " gcal-btn-response--active" : ""}`}
                  onClick={() => (props as EditProps).onRespond?.(status)}
                >
                  {status === "accepted" ? "Yes" : status === "tentative" ? "Maybe" : "No"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="gcal-modal-footer">
          {!isCreate && (
            <button className="gcal-btn-danger" onClick={(props as EditProps).onDelete}>
              Delete
            </button>
          )}
          <button className="gcal-modal-cancel" onClick={props.onClose}>Cancel</button>
          <button className="gcal-btn-primary" onClick={handleSave}>
            {isCreate ? "Create" : "Save"}
          </button>
        </div>

      </div>
    </div>
  );
}