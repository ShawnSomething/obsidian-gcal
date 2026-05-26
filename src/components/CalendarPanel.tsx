import { useEffect, useRef, useState, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import GCalPlugin, { CommandBridge } from "../main";
import { useCalendar, CalEvent } from "../context/CalendarContext";
import { deduplicateEvents } from "../utils/dedup";
import CalendarToggle from "./CalendarToggle";
import EventModal from "./EventModal";
import { RecurringModal } from "./RecurringModal";
import enAU from "@fullcalendar/core/locales/en-au";
import { ViewDensity } from "../api/types";
import { desaturateHex } from "../utils/color";
import MiniMonth from "./MiniMonth";

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

  if (view === "week") {
    const dayOfWeek = start.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
  }

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
    hideThis?: boolean;
    hideFollowing?: boolean;
    showAll?: boolean;
    resolve: (choice: "this" | "following" | "all" | null) => void;
  } | null>(null);
  const [density, setDensity] = useState<ViewDensity>(
    plugin.data.viewDensity ?? "compact"
  );

  const [toast, setToast] = useState<{ message: string; type: "loading" | "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeView, setActiveView] = useState<"day" | "3day" | "week">(
    plugin.data.activeView ?? "week"
  );

  const [viewPopoverOpen, setViewPopoverOpen] = useState(false);
  const viewPopoverRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: "loading" | "success" | "error", autoDismissMs?: number) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    if (autoDismissMs) {
      toastTimerRef.current = setTimeout(() => setToast(null), autoDismissMs);
    }
  };

  const askRecurring = (
    event: CalEvent,
    opts?: { title?: string; hideThis?: boolean; hideFollowing?: boolean; showAll?: boolean }
  ): Promise<"this" | "following" | "all" | null> => {
    return new Promise((resolve) => {
      setRecurringModalState({ event, resolve, ...opts });
    });
  };

  const fetchAllRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const fetchCalendarRef = useRef<((calendarId: string, accountId: string) => Promise<void>) | undefined>(undefined);

  const calendarRef = useRef<FullCalendar>(null);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);

  fetchAllRef.current = async () => {
    const accounts = plugin.data.accounts;
    if (!accounts.length) return;

    showToast("Loading calendars...", "loading");
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

      const { timeMin, timeMax } = getViewWindow(state.selectedDate, activeView);

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
      setToast(null);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  fetchCalendarRef.current = async (calendarId: string, accountId: string) => {
    const account = plugin.data.accounts.find((a) => a.accountId === accountId);
    if (!account) return;
    const { timeMin, timeMax } = getViewWindow(state.selectedDate, activeView);
    const events = await plugin.api.getEvents(account, calendarId, timeMin, timeMax);
    dispatch({ type: "MERGE_EVENTS", payload: { calendarId, events } });
  };

  useEffect(() => {
    fetchAllRef.current?.();
  }, [state.selectedDate, activeView]);

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

  useEffect(() => {
    const el = calendarWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setTimeout(() => {
        calendarRef.current?.getApi().updateSize();
      }, 50);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    plugin.data.viewDensity = density;
    plugin.saveData(plugin.data);
  }, [density]);

  useEffect(() => {
    plugin.commandBridge = {
      setView: (view: "day" | "3day" | "week") => {
        setActiveView(view);
        calendarRef.current?.getApi().changeView(VIEW_MAP[view]);
      },
      goToToday: () => {
        const today = new Date();
        dispatch({ type: "SET_DATE", payload: today });
        calendarRef.current?.getApi().today();
      },
      refresh: () => {
        fetchAllRef.current?.();
      },
      next: () => {
        calendarRef.current?.getApi().next();
        const newDate = calendarRef.current?.getApi().getDate();
        if (newDate) dispatch({ type: "SET_DATE", payload: newDate });
      },
      prev: () => {
        calendarRef.current?.getApi().prev();
        const newDate = calendarRef.current?.getApi().getDate();
        if (newDate) dispatch({ type: "SET_DATE", payload: newDate });
      },
    };
    return () => {
      plugin.commandBridge = null;
    };
  }, []);

  useEffect(() => {
    plugin.data.activeView = activeView;
    plugin.saveData(plugin.data);
  }, [activeView]);

  useEffect(() => {
    if (!viewPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (viewPopoverRef.current && !viewPopoverRef.current.contains(e.target as Node)) {
        setViewPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewPopoverOpen]);

  const handleDateSelect = (date: Date) => {
    dispatch({ type: "SET_DATE", payload: date });
    calendarRef.current?.getApi().gotoDate(date);
  };

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
            desaturateHex(state.calendars.find((c) => c.id === e.calendarId)?.backgroundColor ?? "#4285F4", 0.2) + "CC",
          borderColor: "rgba(0, 0, 0, 0.4)",
          extendedProps: { calEvent: e },
        })),
    [state.events, state.calendars]
  );

  return (
    <div className="gcal-panel-container">
      <div className="gcal-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <MiniMonth selectedDate={state.selectedDate} onDateSelect={handleDateSelect} />
          <button
            onClick={() => {
              const today = new Date();
              dispatch({ type: "SET_DATE", payload: today });
              calendarRef.current?.getApi().today();
            }}
            className="gcal-panel-btn-icon"
            title="Go to today"
          >
            T
          </button>
          <button
            onClick={() => {
              calendarRef.current?.getApi().prev();
              const newDate = calendarRef.current?.getApi().getDate();
              if (newDate) dispatch({ type: "SET_DATE", payload: newDate });
            }}
            className="gcal-panel-btn-icon"
            title="Previous"
          >
            ‹
          </button>
          <button
            onClick={() => {
              calendarRef.current?.getApi().next();
              const newDate = calendarRef.current?.getApi().getDate();
              if (newDate) dispatch({ type: "SET_DATE", payload: newDate });
            }}
            className="gcal-panel-btn-icon"
            title="Next"
          >
            ›
          </button>
        </div>

        <div>
          {toast && (
            <div className={`gcal-toast gcal-toast--${toast.type}`}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{toast.message}</span>
              {toast.type === "error" && (
                <button className="gcal-toast-dismiss" onClick={() => setToast(null)}>×</button>
              )}
            </div>
          )}
        </div>

        <div className="gcal-panel-header-left">
          <button
            onClick={() => fetchAllRef.current?.()}
            disabled={state.isLoading}
            className="gcal-panel-btn-icon"
            title="Refresh calendars"
          >
            ↻
          </button>
          <CalendarToggle />
          <button
            onClick={() =>
              setDensity((d) =>
                d === "compact" ? "medium" : d === "medium" ? "large" : "compact"
              )
            }
            className="gcal-panel-btn-density"
            title="Calendar density"
          >
            {density === "compact" ? "S" : density === "medium" ? "M" : "L"}
          </button>
          <div ref={viewPopoverRef} style={{ position: "relative" }}>
            <button
              className="gcal-panel-btn-icon"
              onClick={() => setViewPopoverOpen((o) => !o)}
              title="Change view"
            >
              View
            </button>
            {viewPopoverOpen && (
              <div className="gcal-view-popover">
                {(["day", "3day", "week"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      setActiveView(v);
                      calendarRef.current?.getApi().changeView(VIEW_MAP[v]);
                      setViewPopoverOpen(false);
                    }}
                    className={`gcal-panel-btn-view${activeView === v ? " gcal-panel-btn-view--active" : ""}`}
                  >
                    {v === "day" ? "D" : v === "3day" ? "3D" : "W"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={calendarWrapperRef} className={`gcal-density-${density} gcal-calendar-wrapper`}>
        <FullCalendar
          slotDuration={density === "large" ? "00:15:00" : "00:30:00"}
          slotLabelInterval={density === "large" ? "00:30:00" : "01:00:00"}
          ref={calendarRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={VIEW_MAP[activeView]}
          height="100%"
          events={fcEvents}
          locale={enAU}
          views={{
            threeDays: { type: "timeGrid", duration: { days: 3 } },
          }}
          headerToolbar={false}
          firstDay={1}
          nowIndicator={true}
          editable={true}
          selectable={true}
          snapDuration="00:15:00"
          eventClassNames={(arg) => {
            const calEvent = arg.event.extendedProps.calEvent as CalEvent;
            return calEvent.selfResponseStatus === "needsAction"
              ? ["gcal-event-needs-action"]
              : [];
          }}
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
                showToast("Moving event...", "loading");
                try {
                  const updated = await plugin.api.patchEventTimes(
                    account,
                    calEvent.calendarId,
                    calEvent.id,
                    info.event.startStr,
                    info.event.endStr
                  );
                  dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
                  showToast("Event moved", "success", 2000);
                } catch (err) {
                  info.revert();
                  showToast(`Failed to move event: ${(err as Error).message}`, "error");
                }
              } else if (choice === "following") {
                showToast("Splitting series...", "loading");
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
                  await fetchCalendarRef.current?.(calEvent.calendarId, calEvent.accountId);
                  showToast("Series split", "success", 2000);
                } catch (err) {
                  info.revert();
                  showToast(`Failed to split series: ${(err as Error).message}`, "error");
                }
              }

              return;
            }

            showToast("Moving event...", "loading");
            try {
              const updated = await plugin.api.patchEventTimes(
                account,
                calEvent.calendarId,
                calEvent.id,
                info.event.startStr,
                info.event.endStr
              );
              dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
              showToast("Event moved", "success", 2000);
            } catch (err) {
              info.revert();
              showToast(`Failed to move event: ${(err as Error).message}`, "error");
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
                showToast("Resizing event...", "loading");
                try {
                  const updated = await plugin.api.patchEventTimes(
                    account,
                    calEvent.calendarId,
                    calEvent.id,
                    info.event.startStr,
                    info.event.endStr
                  );
                  dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
                  showToast("Event resized", "success", 2000);
                } catch (err) {
                  info.revert();
                  showToast(`Failed to resize event: ${(err as Error).message}`, "error");
                }
              } else if (choice === "following") {
                showToast("Splitting series...", "loading");
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
                  await fetchCalendarRef.current?.(calEvent.calendarId, calEvent.accountId);
                  showToast("Series split", "success", 2000);
                } catch (err) {
                  info.revert();
                  showToast(`Failed to split series: ${(err as Error).message}`, "error");
                }
              }

              return;
            }

            showToast("Resizing event...", "loading");
            try {
              const updated = await plugin.api.patchEventTimes(
                account,
                calEvent.calendarId,
                calEvent.id,
                info.event.startStr,
                info.event.endStr
              );
              dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
              showToast("Event resized", "success", 2000);
            } catch (err) {
              info.revert();
              showToast(`Failed to resize event: ${(err as Error).message}`, "error");
            }
          }}

          eventClick={async (info) => {
            const calEvent = info.event.extendedProps.calEvent as CalEvent;
            if (calEvent.recurringEventId) {
              const account = plugin.data.accounts.find(a => a.accountId === calEvent.accountId);
              if (account) {
                showToast("Loading event...", "loading");
                try {
                  const master = await plugin.api.getEvent(account, calEvent.calendarId, calEvent.recurringEventId);
                  setToast(null);
                  setEditingEvent({ ...calEvent, recurrence: master.recurrence });
                  return;
                } catch {
                  setToast(null);
                  // fall through — open modal without recurrence data rather than blocking
                }
              }
            }
            setEditingEvent(calEvent);
          }}

          select={(info) => {
            calendarRef.current?.getApi().unselect();
            setCreatingEvent({
              start: info.startStr,
              end: info.endStr,
              allDay: info.allDay,
            });
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
              showToast("Updating response...", "loading");
              const updated = await plugin.api.patchAttendeeResponse(account, editingEvent.calendarId, eventId, editingEvent.attendees, status);
              dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
              setEditingEvent(null);
              showToast("Response updated", "success", 2000);
            } catch (err) {
              showToast(`Failed to update response: ${(err as Error).message}`, "error");
            }
          }}
          onSave={async (updates) => {
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent.accountId
            );
            if (!account) return;
            showToast("Saving...", "loading");
            try {
              const updated = await plugin.api.putEvent(account, editingEvent.calendarId, editingEvent.id, updates);
              if (updates.recurrence?.length) {
                await fetchCalendarRef.current?.(editingEvent.calendarId, editingEvent.accountId);
              } else {
                dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
              }
              setEditingEvent(null);
              showToast("Event saved", "success", 2000);
            } catch (err) {
              showToast(`Failed to save event: ${(err as Error).message}`, "error");
            }
          }}
          onSplitSeries={async (updates) => {
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent!.accountId
            );
            if (!account) return;
            showToast("Splitting series...", "loading");
            try {
              await plugin.api.splitRecurringSeries(
                account,
                editingEvent!.calendarId,
                editingEvent!,
                updates
              );
              setEditingEvent(null);
              await fetchCalendarRef.current?.(editingEvent!.calendarId, editingEvent!.accountId);
              showToast("Series split", "success", 2000);
            } catch (err) {
              showToast(`Failed to split series: ${(err as Error).message}`, "error");
            }
          }}

          onDelete={async () => {
            if (!window.confirm(`Delete "${editingEvent.title}"?`)) return;
            const account = plugin.data.accounts.find(
              (a) => a.accountId === editingEvent.accountId
            );
            if (!account) return;
            showToast("Deleting...", "loading");
            try {
              if (editingEvent.recurringEventId) {
                const choice = await askRecurring(editingEvent);
                if (!choice) { setToast(null); return; }
                if (choice === "this") {
                  const res = await plugin.api.deleteWithAuth(
                    account,
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(editingEvent.calendarId)}/events/${editingEvent.id}`
                  );
                  if (!res.ok) throw new Error("Failed to delete event");
                  dispatch({ type: "REMOVE_EVENT", payload: editingEvent.id });
                } else {
                  await plugin.api.deleteRecurringAndFollowing(
                    account,
                    editingEvent.calendarId,
                    editingEvent
                  );
                  await fetchCalendarRef.current?.(editingEvent.calendarId, editingEvent.accountId);
                }
              } else {
                const res = await plugin.api.deleteWithAuth(
                  account,
                  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(editingEvent.calendarId)}/events/${editingEvent.id}`
                );
                if (!res.ok) throw new Error("Failed to delete event");
                dispatch({ type: "REMOVE_EVENT", payload: editingEvent.id });
              }
              setEditingEvent(null);
              showToast("Event deleted", "success", 2000);
            } catch (err) {
              showToast(`Failed to delete event: ${(err as Error).message}`, "error");
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
          onSave={async ({ title, start, end, allDay, calendarId, accountId, recurrence, location, description }) => {
            const account = plugin.data.accounts.find((a) => a.accountId === accountId);
            if (!account) return;
            showToast("Creating event...", "loading");
            try {
              const created = await plugin.api.postEvent(account, calendarId, { title, start, end, allDay, recurrence, location, description });
              if (recurrence?.length) {
                await fetchCalendarRef.current?.(calendarId, accountId);
              } else {
                dispatch({ type: "ADD_EVENT", payload: created });
              }
              setCreatingEvent(null);
              showToast("Event created", "success", 2000);
            } catch (err) {
              showToast(`Failed to create event: ${(err as Error).message}`, "error");
            }
          }}
          onClose={() => setCreatingEvent(null)}
        />
      )}

      {recurringModalState && (
        <RecurringModal
          eventTitle={recurringModalState.event.title}
          title={recurringModalState.title}
          hideThis={recurringModalState.hideThis}
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