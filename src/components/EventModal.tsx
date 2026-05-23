import { useState } from "react";
import { CalEvent, useCalendar } from "../context/CalendarContext";
import { RRuleFrequency, RRuleDay, buildRRule } from "../utils/rrule";

type EditProps = {
  mode: "edit";
  event: CalEvent;
  askRecurring: (event: CalEvent, opts?: { title?: string; hideFollowing?: boolean; showAll?: boolean }) => Promise<"this" | "following" | "all" | null>;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; recurrence?: string[] }) => Promise<void>;
  onSplitSeries: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string }) => Promise<void>;
  onDelete: () => void;
  onRespond?: (status: "accepted" | "declined" | "tentative") => void;
  onClose: () => void;
};

type CreateProps = {
  mode: "create";
  initialStart: string;
  initialEnd: string;
  initialAllDay: boolean;
  onSave: (data: { title: string; start: string; end: string; allDay: boolean; calendarId: string; accountId: string; recurrence?: string[]; location?: string; description?: string; }) => Promise<void>;
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

const AVATAR_PALETTE = ["#4285F4", "#EA4335", "#34A853", "#FBBC04", "#9B59B6", "#E67E22", "#16A085"];
function getAvatarColor(email: string): string | undefined {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

const GUEST_PREVIEW_COUNT = 3;

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
  const [showAllGuests, setShowAllGuests] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const hangoutLink = isCreate ? undefined : (props as EditProps).event.hangoutLink;
  const attendees = isCreate ? [] : (props as EditProps).event.attendees;
  const visibleAttendees = showAllGuests ? attendees : attendees.slice(0, GUEST_PREVIEW_COUNT);

  // Recurrence state (create mode only)
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<RRuleFrequency>("WEEKLY");
  const [interval, setIntervalVal] = useState(1);
  const [days, setDays] = useState<RRuleDay[]>([getStartDay(start)]);
  const [endType, setEndType] = useState<"never" | "until" | "count">("never");
  const [untilDate, setUntilDate] = useState("");
  const [countNum, setCountNum] = useState(1);

  const ALL_DAYS: RRuleDay[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const DAY_LABELS: Record<RRuleDay, string> = {
    MO: "Mo", TU: "Tu", WE: "We", TH: "Th", FR: "Fr", SA: "Sa", SU: "Su",
  };

  const toggleDay = (day: RRuleDay) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const defaultCal =
    state.calendars.find(c => c.visible && (c.accessRole === "owner" || c.accessRole === "writer")) ??
    state.calendars[0];
  const [selectedCalendarId, setSelectedCalendarId] = useState(defaultCal?.id ?? "");

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const startISO = new Date(start).toISOString();
      const endISO = new Date(end).toISOString();
      const finalStart = allDay ? startISO.slice(0, 10) : startISO;
      const finalEnd = allDay ? endISO.slice(0, 10) : endISO;

      if (isCreate) {
        const cal = state.calendars.find(c => c.id === selectedCalendarId);
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
        await (props as CreateProps).onSave({
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
      const updates = {
        title,
        start: finalStart,
        end: finalEnd,
        allDay,
        location: location || undefined,
        description: description || undefined,
        recurrence,
      };

      if (editProps.event.recurringEventId) {
        const choice = await editProps.askRecurring(editProps.event);
        if (!choice) return;
        if (choice === "following") {
          await editProps.onSplitSeries(updates);
          return;
        }
      }
      await editProps.onSave(updates);
    } finally {
      setIsSaving(false)
    }
  };

  const selectedCal = state.calendars.find(c => c.id === selectedCalendarId);

  return (
    <div className="gcal-modal-backdrop" onClick={props.onClose}>
      <div className="gcal-modal" onClick={e => e.stopPropagation()}>

        {/* Title row */}
        <div className="gcal-modal-title-row">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            className="gcal-modal-title-input"
            autoFocus
          />
          {hangoutLink && (
            <button
              className="gcal-modal-meet-icon"
              onClick={() => window.open(hangoutLink, "_blank")}
              title="Join Google Meet"
            >
              📹
            </button>
          )}
        </div>

        {/* Datetime row */}
        <div className="gcal-datetime-row">
          {allDay ? (
            <>
              <input
                type="date"
                value={start.slice(0, 10)}
                onChange={e => setStart(e.target.value + "T00:00")}
                className="gcal-datetime-chip"
              />
              <span className="gcal-datetime-arrow">→</span>
              <input
                type="date"
                value={end.slice(0, 10)}
                onChange={e => setEnd(e.target.value + "T00:00")}
                className="gcal-datetime-chip"
              />
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="gcal-datetime-chip"
              />
              <span className="gcal-datetime-arrow">→</span>
              <input
                type="datetime-local"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="gcal-datetime-chip"
              />
            </>
          )}
          <label className="gcal-allday-label">
            <input
              type="checkbox"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
            />
            All day
          </label>
        </div>

        {/* Calendar row */}
        {isCreate && state.calendars.length > 0 && (
          <div className="gcal-calendar-row">
            <span
              className="gcal-calendar-dot"
              style={{ background: selectedCal?.backgroundColor ?? "#4285F4" }}
            />
            <select
              value={selectedCalendarId}
              onChange={e => setSelectedCalendarId(e.target.value)}
              className="gcal-calendar-select"
            >
              {state.calendars
                .filter(c => c.accessRole === "owner" || c.accessRole === "writer")
                .map(cal => (
                  <option key={cal.id} value={cal.id}>{cal.summary}</option>
                ))}
            </select>
          </div>
        )}

        <div className="gcal-modal-divider" />

        {/* Description */}
        <div className="gcal-field-row">
          <span className="gcal-field-icon">☰</span>
          <div className="gcal-field-body">
            <span className="gcal-field-sublabel">Description</span>
            {props.mode === "edit" ? (
              <div
                className="gcal-description-html"
                dangerouslySetInnerHTML={{ __html: description }}
              />
            ) : (
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Add description"
                className="gcal-textarea"
                rows={3}
              />
            )}
          </div>
        </div>

        {/* Location */}
        <div className="gcal-field-row">
          <span className="gcal-field-icon">📍</span>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Add location"
            className="gcal-field-input"
          />
        </div>

        {/* Guests (edit mode only) */}
        {props.mode === "edit" && attendees.length > 0 && (
          <>
            <div className="gcal-modal-divider" />
            <div className="gcal-guests-section">
              <span className="gcal-guests-count">
                {attendees.length} guest{attendees.length !== 1 ? "s" : ""}
              </span>
              <div className="gcal-attendee-list">
                {visibleAttendees.map(a => (
                  <div key={a.email} className="gcal-attendee-row">
                    <div
                      className="gcal-attendee-avatar"
                      style={{ background: getAvatarColor(a.email) }}
                    >
                      {a.email.charAt(0).toUpperCase()}
                    </div>
                    <span className="gcal-attendee-email">{a.email}</span>
                    <span className={`gcal-attendee-status gcal-attendee-status--${a.responseStatus}`}>
                      {a.responseStatus === "accepted" ? "✓"
                        : a.responseStatus === "declined" ? "✗"
                          : a.responseStatus === "tentative" ? "?"
                            : "–"}
                    </span>
                  </div>
                ))}
              </div>
              {attendees.length > GUEST_PREVIEW_COUNT && (
                <button
                  className="gcal-see-all-btn"
                  onClick={() => setShowAllGuests(v => !v)}
                >
                  {showAllGuests ? "Show less" : `See all ${attendees.length} guests`}
                </button>
              )}
            </div>
          </>
        )}

        {/* Going? (edit mode) */}
        {props.mode === "edit" && !(props as EditProps).event.recurringEventId && !(props as EditProps).event.recurrence?.length && (
          <>
            <div className="gcal-modal-divider" />
            <label className="gcal-checkbox-label">
              <input
                type="checkbox"
                checked={repeat}
                onChange={e => setRepeat(e.target.checked)}
              />
              Repeat
            </label>

            {repeat && (
              <div className="gcal-recurrence-block">
                <label className="gcal-field-label">
                  Frequency
                  <select
                    value={frequency}
                    onChange={e => {
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
                    onChange={e => setIntervalVal(Math.max(1, parseInt(e.target.value) || 1))}
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
                    onChange={e => setEndType(e.target.value as "never" | "until" | "count")}
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
                    <input type="date" value={untilDate} onChange={e => setUntilDate(e.target.value)} className="gcal-input" />
                  </label>
                )}

                {endType === "count" && (
                  <label className="gcal-field-label">
                    Occurrences
                    <input
                      type="number"
                      min={1}
                      value={countNum}
                      onChange={e => setCountNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="gcal-input"
                    />
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {/* Recurrence (create mode) */}
        {props.mode === "create" && (
          <>
            <div className="gcal-modal-divider" />
            <label className="gcal-checkbox-label">
              <input
                type="checkbox"
                checked={repeat}
                onChange={e => setRepeat(e.target.checked)}
              />
              Repeat
            </label>

            {repeat && (
              <div className="gcal-recurrence-block">
                <label className="gcal-field-label">
                  Frequency
                  <select
                    value={frequency}
                    onChange={e => {
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
                    onChange={e => setIntervalVal(Math.max(1, parseInt(e.target.value) || 1))}
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
                    onChange={e => setEndType(e.target.value as "never" | "until" | "count")}
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
                      onChange={e => setUntilDate(e.target.value)}
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
                      onChange={e => setCountNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="gcal-input"
                    />
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="gcal-modal-footer">
          {!isCreate && (
            <button className="gcal-btn-danger" onClick={(props as EditProps).onDelete}>
              Delete
            </button>
          )}
          <button className="gcal-modal-cancel" onClick={props.onClose}>Cancel</button>
          <button className="gcal-btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : isCreate ? "Create" : "Save"}
          </button>
        </div>

      </div>
    </div>
  );
}
