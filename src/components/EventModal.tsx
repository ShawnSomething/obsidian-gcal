import { useState } from "react";
import { CalEvent, useCalendar } from "../context/CalendarContext";
import { RRuleFrequency, RRuleDay, buildRRule } from "../utils/rrule";

type EditProps = {
  mode: "edit";
  event: CalEvent;
  askRecurring: (event: CalEvent, opts?: { title?: string; hideThis?: boolean; hideFollowing?: boolean; showAll?: boolean }) => Promise<"this" | "following" | "all" | null>;
  onSave: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; recurrence?: string[]; targetEventId?: string }) => Promise<void>;
  onSplitSeries: (updates: { title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; recurrence?: string[] }) => Promise<void>;
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

function parseRRule(rruleStr: string) {
  const str = rruleStr.replace(/^RRULE:/, "");
  const parts: Record<string, string> = {};
  str.split(";").forEach(part => {
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
  const existingRRule = !isCreate
    ? (props as EditProps).event.recurrence?.[0]
    : undefined;
  const parsedRRule = existingRRule ? parseRRule(existingRRule) : null;

  const [repeat, setRepeat] = useState(!!existingRRule);
  const [frequency, setFrequency] = useState<RRuleFrequency>(parsedRRule?.frequency ?? "WEEKLY");
  const [interval, setIntervalVal] = useState(parsedRRule?.interval ?? 1);
  const [days, setDays] = useState<RRuleDay[]>(parsedRRule?.days.length ? parsedRRule.days : [getStartDay(start)]);
  const [endType, setEndType] = useState<"never" | "until" | "count">(parsedRRule?.endType ?? "never");
  const [untilDate, setUntilDate] = useState(parsedRRule?.untilDate ?? "");
  const [countNum, setCountNum] = useState(parsedRRule?.countNum ?? 1);

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
        const choice = await editProps.askRecurring(editProps.event, { hideThis: true, showAll: true });
        if (!choice) return;
        if (choice === "following") {
          await editProps.onSplitSeries(updates);
          return;
        }
        if (choice === "all") {
          await editProps.onSave({ ...updates, targetEventId: editProps.event.recurringEventId });
          return;
        }
      } else if (editProps.event.recurrence?.length && updates.recurrence) {
        // editing RRULE on master event — ask all vs following
        const choice = await editProps.askRecurring(editProps.event, { hideThis: true, showAll: true });
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
        <div className="gcal-modal-body">
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
              {Object.entries(
                state.calendars
                  .filter(c => c.accessRole === "owner" || c.accessRole === "writer")
                  .reduce((groups, cal) => {
                    (groups[cal.accountId] ??= []).push(cal);
                    return groups;
                  }, {} as Record<string, typeof state.calendars>)
              ).map(([accountEmail, cals]) => (
                <optgroup key={accountEmail} label={accountEmail}>
                  {cals.map(cal => (
                    <option key={cal.id} value={cal.id}>{cal.summary}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {/* Repeat (edit mode) */}
        {props.mode === "edit" && (
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
                <div className="gcal-recurrence-row">
                  <span className="gcal-recurrence-label">Every</span>
                  <input
                    type="number"
                    min={1}
                    value={interval}
                    onChange={e => setIntervalVal(Math.max(1, parseInt(e.target.value) || 1))}
                    className="gcal-recurrence-interval"
                  />
                  <select
                    value={frequency}
                    onChange={e => {
                      const freq = e.target.value as RRuleFrequency;
                      setFrequency(freq);
                      if (freq === "WEEKLY" && days.length === 0) {
                        setDays([getStartDay(start)]);
                      }
                    }}
                    className="gcal-input gcal-recurrence-freq"
                  >
                    <option value="DAILY">Day</option>
                    <option value="WEEKLY">Week</option>
                    <option value="MONTHLY">Month</option>
                    <option value="YEARLY">Year</option>
                  </select>
                </div>

                {frequency === "WEEKLY" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label">On</span>
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
                  </div>
                )}

                <div className="gcal-recurrence-row">
                  <span className="gcal-recurrence-label">End</span>
                  <select
                    value={endType}
                    onChange={e => setEndType(e.target.value as "never" | "until" | "count")}
                    className="gcal-input gcal-recurrence-freq"
                  >
                    <option value="never">Never</option>
                    <option value="until">On date</option>
                    <option value="count">After N occurrences</option>
                  </select>
                </div>

                {endType === "until" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label" />
                    <input
                      type="date"
                      value={untilDate}
                      onChange={e => setUntilDate(e.target.value)}
                      className="gcal-input gcal-recurrence-freq"
                    />
                  </div>
                )}

                {endType === "count" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label" />
                    <input
                      type="number"
                      min={1}
                      value={countNum}
                      onChange={e => setCountNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="gcal-input gcal-recurrence-freq"
                    />
                  </div>
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
                <div className="gcal-recurrence-row">
                  <span className="gcal-recurrence-label">Every</span>
                  <input
                    type="number"
                    min={1}
                    value={interval}
                    onChange={e => setIntervalVal(Math.max(1, parseInt(e.target.value) || 1))}
                    className="gcal-recurrence-interval"
                  />
                  <select
                    value={frequency}
                    onChange={e => {
                      const freq = e.target.value as RRuleFrequency;
                      setFrequency(freq);
                      if (freq === "WEEKLY" && days.length === 0) {
                        setDays([getStartDay(start)]);
                      }
                    }}
                    className="gcal-input gcal-recurrence-freq"
                  >
                    <option value="DAILY">Day</option>
                    <option value="WEEKLY">Week</option>
                    <option value="MONTHLY">Month</option>
                    <option value="YEARLY">Year</option>
                  </select>
                </div>

                {frequency === "WEEKLY" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label">On</span>
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
                  </div>
                )}

                <div className="gcal-recurrence-row">
                  <span className="gcal-recurrence-label">End</span>
                  <select
                    value={endType}
                    onChange={e => setEndType(e.target.value as "never" | "until" | "count")}
                    className="gcal-input gcal-recurrence-freq"
                  >
                    <option value="never">Never</option>
                    <option value="until">On date</option>
                    <option value="count">After N occurrences</option>
                  </select>
                </div>

                {endType === "until" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label" />
                    <input
                      type="date"
                      value={untilDate}
                      onChange={e => setUntilDate(e.target.value)}
                      className="gcal-input gcal-recurrence-freq"
                    />
                  </div>
                )}

                {endType === "count" && (
                  <div className="gcal-recurrence-row">
                    <span className="gcal-recurrence-label" />
                    <input
                      type="number"
                      min={1}
                      value={countNum}
                      onChange={e => setCountNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="gcal-input gcal-recurrence-freq"
                    />
                  </div>
                )}
              </div>
            )}
          </>
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

        {/* RSVP (edit mode, when onRespond is provided) */}
        {props.mode === "edit" && (props as EditProps).onRespond && (
          <>
            <div className="gcal-modal-divider" />
            <div className="gcal-rsvp-row">
              <span className="gcal-field-sublabel">Going?</span>
              <div className="gcal-rsvp-buttons">
                {(["accepted", "tentative", "declined"] as const).map(status => (
                  <button
                    key={status}
                    className={[
                      "gcal-btn-response",
                      `gcal-btn-response--${status}`,
                      (props as EditProps).event.selfResponseStatus === status ? "gcal-btn-response--active" : "",
                    ].join(" ").trim()}
                    onClick={() => (props as EditProps).onRespond!(status)}
                  >
                    {status === "accepted" ? "Yes" : status === "tentative" ? "Maybe" : "No"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        </div>

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
