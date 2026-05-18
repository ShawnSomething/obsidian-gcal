import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import GCalPlugin from "../main";
import { useCalendar, CalEvent } from "../context/CalendarContext";
import { deduplicateEvents } from "../utils/dedup";
import CalendarToggle from "./CalendarToggle";
import EventModal from "./EventModal";
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

  // Ref pattern — interval always calls the latest version of fetchAll
  // without needing to reset the interval when state changes
  const fetchAllRef = useRef<(() => Promise<void>) | undefined>(undefined);

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

      // Preserve existing visibility when re-fetching
      const merged = allCalendars.map((cal) => {
        const existing = state.calendars.find((c) => c.id === cal.id);
        return existing ? { ...cal, visible: existing.visible } : cal;
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

  // Refetch when date or view changes
  useEffect(() => {
    fetchAllRef.current?.();
  }, [state.selectedDate, state.activeView]);

  // 5-min polling — empty deps so interval never resets
  // fetchAllRef.current always points to latest closure
  useEffect(() => {
    const interval = setInterval(() => fetchAllRef.current?.(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Map context events to FullCalendar format
  // Visibility filtering happens here, not in fetch — no refetch needed on toggle
  const fcEvents = state.events
    .filter((e) => state.calendars.find((c) => c.id === e.calendarId)?.visible ?? false)
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
    }));

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
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

            try {
              await plugin.api.patchEventTimes(
                account,
                calEvent.calendarId,
                calEvent.id,
                info.event.startStr,
                info.event.endStr
              );
            } catch (err) {
              info.revert();
              dispatch({
                type: "SET_ERROR",
                payload: `Failed to move event: ${(err as Error).message}`,
              });
            }
          }}

          eventClick={(info) => {
            setEditingEvent(info.event.extendedProps.calEvent as CalEvent);
          }}
        />
      </div>

      {editingEvent && (
        <EventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
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
        />
      )}
    </div>
  );
}