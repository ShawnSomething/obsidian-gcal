import { useEffect, useRef, useState, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import GCalPlugin from "../main";
import { useCalendar, CalEvent } from "../context/CalendarContext";
import { deduplicateEvents } from "../utils/dedup";
import CalendarToggle from "./CalendarToggle";
import EventModal from "./EventModal";
import { RecurringModal } from "./RecurringModal";
import enAU from "@fullcalendar/core/locales/en-au";

interface Props {
  plugin: GCalPlugin;
}

const VIEW_MAP = {
  day: "timeGridDay",
  "3day": "threeDays",
  week: "timeGridWeek",
} as const;

function getViewWindow(date: Date, view: "day" | "3day" | "week"): { timeMin: Date; timeMax: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (view === "day") end.setDate(end.getDate() + 1);
  else if (view === "3day") end.setDate(end.getDate() + 3);
  else end.setDate(end.getDate() + 7);
  return { timeMin: start, timeMax: end };
}

export default function CalendarPanel({ plugin }: Props) {
  const { state, dispatch } = useCalendar();
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [creatingEvent, setCreatingEvent] = useState<{
    start: string;
    end: string;
    allDay: boolean;
  } | null>(null);
  const [recurringModalState, setRecurringModalState] = useState<{
    event: CalEvent;
    title?: string;
    hideFollowing?: boolean;
    showAll?: boolean;
    resolve: (choice: "this" | "following" | "all" | null) => void;
  } | null>(null);

  const askRecurring = (
    event: CalEvent,
    opts?: { title?: string; hideFollowing?: boolean; showAll?: boolean }
  ): Promise<"this" | "following" | "all" | null> => {
    return new Promise((resolve) => {
      setRecurringModalState({ event, resolve, ...opts });
    });
  };

  const fetchAllRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const calendarRef = useRef<FullCalendar>(null);

  fetchAllRef.current = async () => {
    const accounts = plugin.data.accounts;
    if (!accounts.length) return;

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });

    try {
      const allCalendars = (
        await Promise.all(
          accounts.map((account) => plugin.api.getCalendarList(account))
        )
      ).flat();

      const merged = allCalendars.map((cal) => {
        const existing = state.calendars.find((c) => c.id === cal.id);
        if (existing) return { ...cal, visible: existing.visible };
        const persisted = plugin.data.calendarVisibility?.[cal.id];
        return { ...cal, visible: persisted !== undefined ? persisted : cal.visible }
      });

      dispatch({ type: "SET_CALENDARS", payload: merged });

      const { timeMin, timeMax } = getViewWindow(state.selectedDate, state.activeView);

      const allEvents = (
        await Promise.all(
          merged
            .filter((cal) => cal.visible)
            .map((cal) => {
              const account = accounts.find((a) => a.accountId === cal.accountId);
              if (!account) return Promise.resolve([]);
              return plugin.api.getEvents(account, cal.id, timeMin, timeMax);
            })
        )
      ).flat();

      dispatch({ type: "SET_EVENTS", payload: deduplicateEvents(allEvents) });
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: (err as Error).message });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  useEffect(() => {
    fetchAllRef.current?.();
  }, [state.selectedDate, state.activeView]);

  useEffect(() => {
    const interval = setInterval(() => fetchAllRef.current?.(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (state.calendars.length === 0) return;
    const visibility: Record<string, boolean> = {};
    state.calendars.forEach((cal) => { visibility[cal.id] = cal.visible; });
    plugin.data.calendarVisibility = visibility;
    plugin.saveData(plugin.data);
  }, [state.calendars]);

  const fcEvents = useMemo(
    () =>
      state.events
        .filter(
          (e) =>
            (state.calendars.find((c) => c.id === e.calendarId)?.visible ?? false) &&
            e.selfResponseStatus !== "declined"
        )
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          backgroundColor:
            (state.calendars.find((c) => c.id === e.calendarId)?.backgroundColor ?? "#4285F4") + "CC",
          borderColor: "transparent",
          extendedProps: { calEvent: e },
        })),
    [state.events, state.calendars]
  );

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "4px 8px",
        flexShrink: 0,
      }}>
        <button
          onClick={() => fetchAllRef.current?.()}
          disabled={state.isLoading}
          style={{
            background: "none",
            border: "none",
            cursor: state.isLoading ? "not-allowed" : "pointer",
            padding: "4px 6px",
            borderRadius: "4px",
            color: state.isLoading ? "var(--text-muted)" : "var(--text-normal)",
            fontSize: "14px",
          }}
          title="Refresh calendars"
        >
          ↻
        </button>
        <CalendarToggle />
      </div>

      {state.error && (
        <div style={{ color: "var(--text-error)", padding: "4px 8px", fontSize: "12px" }}>
          {state.error}
        </div>
      )}
      {state.isLoading && state.events.length === 0 && (
        <div style={{ padding: "4px 8px", fontSize: "12px", color: "var(--text-muted)" }}>
          Loading calendars...
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={VIEW_MAP[state.activeView]}
          height="100%"
          events={fcEvents}
          locale={enAU}
          views={{
            threeDays: { type: "timeGrid", duration: { days: 3 } },
          }}
          headerToolbar={false}
          firstDay={1}
          editable={true}
          eventDrop={async (info) => {
            const calEvent = info.event.extendedProps.calEvent as CalEvent;
            const account = plugin.data.accounts.find(
              (a) => a.accountId === calEvent.accountId
            );

            if (!account) {
              info.revert();
              return;
            }

            if (calEvent.recurringEventId) {
              const choice = await askRecurring(calEvent);
              if (!choice) {
                info.revert();
                return;
              }

              if (choice === "this") {
                try {
                  await plugin.api.patchEventTimes(
                    account,
                    calEvent.calendarId,
                    calEvent.id,
                    info.event.startStr,
                    info.event.endStr
                  );
                  await fetchAllRef.current?.();
                } catch (err) {
                  info.revert();
                  dispatch({ type: "SET_ERROR", payload: `Failed to move event: ${(err as Error).message}` });
                }
              } else if (choice === "following") {
                try {
                  await plugin.api.splitRecurringSeries(
                    account,
                    calEvent.calendarId,
                    calEvent,
                    {
                      start: info.event.startStr,
                      end: info.event.endStr,
                      title: calEvent.title,
                      allDay: calEvent.allDay,
                    }
                  );
                  await fetchAllRef.current?.();
                } catch (err) {
                  info.revert();
                  dispatch({ type: "SET_ERROR", payload: `Failed to split series: ${(err as Error).message}` });
                }
              }

              return;
            }

            try {
              await plugin.api.patchEventTimes(
                account,
                calEvent.calendarId,
                calEvent.id,
                info.event.startStr,
                info.event.endStr
              );
              await fetchAllRef.current?.();
            } catch (err) {
              info.revert();
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to move event: ${(err as Error).message}`,
              });
            }
          }}

          eventResize={async (info) => {
            const calEvent = info.event.extendedProps.calEvent as CalEvent;
            const account = plugin.data.accounts.find(
              (a) => a.accountId === calEvent.accountId
            );

            if (!account) {
              info.revert();
              return;
            }

            if (calEvent.recurringEventId) {
              const choice = await askRecurring(calEvent);
              if (!choice) {
                info.revert();
                return;
              }

              if (choice === "this") {
                try {
                  await plugin.api.patchEventTimes(
                    account,
                    calEvent.calendarId,
                    calEvent.id,
                    info.event.startStr,
                    info.event.endStr
                  );
                  await fetchAllRef.current?.();
                } catch (err) {
                  info.revert();
                  dispatch({ type: "SET_ERROR", payload: `Failed to resize event: ${(err as Error).message}` });
                }
              } else if (choice === "following") {
                try {
                  await plugin.api.splitRecurringSeries(
                    account,
                    calEvent.calendarId,
                    calEvent,
                    {
                      start: info.event.startStr,
                      end: info.event.endStr,
                      title: calEvent.title,
                      allDay: calEvent.allDay,
                    }
                  );
                  await fetchAllRef.current?.();
                } catch (err) {
                  info.revert();
                  dispatch({ type: "SET_ERROR", payload: `Failed to split series: ${(err as Error).message}` });
                }
              }

              return;
            }

            try {
              await plugin.api.patchEventTimes(
                account,
                calEvent.calendarId,
                calEvent.id,
                info.event.startStr,
                info.event.endStr
              );
              await fetchAllRef.current?.();
            } catch (err) {
              info.revert();
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to resize event: ${(err as Error).message}`,
              });
            }
          }}

          eventClick={(info) => {
            setEditingEvent(info.event.extendedProps.calEvent as CalEvent);
          }}

          dateClick={(info) => {
            const start = info.date.toISOString();
            const end = info.allDay
              ? info.date.toISOString()
              : new Date(info.date.getTime() + 60 * 60 * 1000).toISOString();
            setCreatingEvent({ start, end, allDay: info.allDay });
          }}
        />
      </div>

      {editingEvent && (
        <EventModal
          mode="edit"
          event={editingEvent}
          askRecurring={askRecurring}
          onClose={() => setEditingEvent(null)}
          onRespond={async (status) => {
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent.accountId
            );
            if (!account) return;
            try {
              let eventId = editingEvent.id;
              if (editingEvent.recurringEventId) {
                const choice = await askRecurring(editingEvent, {
                  title: "RSVP to recurring event",
                  hideFollowing: true,
                  showAll: true,
                });
                if (!choice) return;
                if (choice === "all") {
                  eventId = editingEvent.recurringEventId;
                }
              }
              await plugin.api.patchAttendeeResponse(
                account,
                editingEvent.calendarId,
                eventId,
                editingEvent.attendees,
                status
              );
              setEditingEvent(null);
              await fetchAllRef.current?.();
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to update response: ${(err as Error).message}`,
              });
            }
          }}
          onSave={async (updates) => {
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent.accountId
            );
            if (!account) return;
            try {
              await plugin.api.putEvent(
                account,
                editingEvent.calendarId,
                editingEvent.id,
                updates
              );
              setEditingEvent(null);
              await fetchAllRef.current?.();
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to save event: ${(err as Error).message}`,
              });
            }
          }}
          onSplitSeries={async (updates) => {
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent!.accountId
            );
            if (!account) return;
            try {
              await plugin.api.splitRecurringSeries(
                account,
                editingEvent!.calendarId,
                editingEvent!,
                updates
              );
              setEditingEvent(null);
              await fetchAllRef.current?.();
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to split series: ${(err as Error).message}`,
              });
            }
          }}

          onDelete={async () => {
            if (!window.confirm(`Delete "${editingEvent.title}"?`)) return;
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent.accountId
            );
            if (!account) return;
            try {
              if (editingEvent.recurringEventId) {
                const choice = await askRecurring(editingEvent);
                if (!choice) return;
                if (choice === "this") {
                  const res = await plugin.api.deleteWithAuth(
                    account,
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(editingEvent.calendarId)}/events/${editingEvent.id}`
                  );
                  if (!res.ok) throw new Error("Failed to delete event");
                } else {
                  await plugin.api.deleteRecurringAndFollowing(
                    account,
                    editingEvent.calendarId,
                    editingEvent
                  );
                }
              } else {
                const res = await plugin.api.deleteWithAuth(
                  account,
                  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(editingEvent.calendarId)}/events/${editingEvent.id}`
                );
                if (!res.ok) throw new Error("Failed to delete event");
              }
              setEditingEvent(null);
              await fetchAllRef.current?.();
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to delete event: ${(err as Error).message}`,
              });
            }
          }}
        />
      )}

      {creatingEvent && (
        <EventModal
          mode="create"
          initialStart={creatingEvent.start}
          initialEnd={creatingEvent.end}
          initialAllDay={creatingEvent.allDay}
          onSave={async ({ title, start, end, allDay, calendarId, accountId, recurrence }) => {
            const account = plugin.data.accounts.find((a) => a.accountId === accountId);
            if (!account) return;
            try {
              await plugin.api.postEvent(account, calendarId, { title, start, end, allDay, recurrence });
              setCreatingEvent(null);
              await fetchAllRef.current?.();
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to create event: ${(err as Error).message}`,
              });
            }
          }}
          onClose={() => setCreatingEvent(null)}
        />
      )}

      {recurringModalState && (
        <RecurringModal
          eventTitle={recurringModalState.event.title}
          title={recurringModalState.title}
          hideFollowing={recurringModalState.hideFollowing}
          showAll={recurringModalState.showAll}
          onChoice={(choice) => {
            recurringModalState.resolve(choice);
            setRecurringModalState(null);
          }}
        />
      )}
    </div>
  );
}