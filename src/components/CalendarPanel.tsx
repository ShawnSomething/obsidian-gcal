import { useEffect, useRef, useState, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import GCalPlugin, { CommandBridge } from "../main";
import { useCalendar, CalEvent, CalendarMeta } from "../context/CalendarContext";
import { deduplicateEvents } from "../utils/dedup";
import CalendarToggle from "./CalendarToggle";
import EventModal from "./EventModal";
import { RecurringModal } from "./RecurringModal";
import enAU from "@fullcalendar/core/locales/en-au";
import { ViewDensity } from "../api/types";
import { desaturateHex } from "../utils/color";
import MiniMonth from "./MiniMonth";
import ContextMenu from "./ContextMenu";

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

// Returns the timeMin of the window immediately before and after the given date/view.
// Both dates are window-aligned (Monday-snapped for week view, etc.).
function getAdjacentDates(date: Date, view: "day" | "3day" | "week"): { prevDate: Date; nextDate: Date } {
  const { timeMin: windowStart } = getViewWindow(date, view);
  const prevDate = new Date(windowStart);
  const nextDate = new Date(windowStart);

  if (view === "day") {
    prevDate.setDate(prevDate.getDate() - 1);
    nextDate.setDate(nextDate.getDate() + 1);
  } else if (view === "3day") {
    prevDate.setDate(prevDate.getDate() - 3);
    nextDate.setDate(nextDate.getDate() + 3);
  } else {
    prevDate.setDate(prevDate.getDate() - 7);
    nextDate.setDate(nextDate.getDate() + 7);
  }

  return { prevDate, nextDate };
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
  const [contextMenu, setContextMenu] = useState<{ calEvent: CalEvent; x: number; y: number } | null>(null);
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

  const handleDuplicate = (calEvent: CalEvent) => {
    const account = plugin.data.accounts.find((a) => a.accountId === calEvent.accountId);
    if (!account) return;
    showToast("Duplicating...", "loading");
    plugin.api
      .postEvent(account, calEvent.calendarId, {
        title: calEvent.title,
        start: calEvent.start,
        end: calEvent.end,
        allDay: calEvent.allDay,
        location: calEvent.location,
        description: calEvent.description,
        attendees: calEvent.attendees.length
          ? calEvent.attendees.map((a) => ({ email: a.email }))
          : undefined,
      })
      .then((created) => {
        dispatch({ type: "ADD_EVENT", payload: created });
        showToast("Event duplicated", "success", 2000);
      })
      .catch((err) => {
        showToast(`Failed to duplicate event: ${(err as Error).message}`, "error");
      });
  };

  const handleDelete = async (calEvent: CalEvent) => {
    if (!window.confirm(`Delete "${calEvent.title}"?`)) return;
    const account = plugin.data.accounts.find((a) => a.accountId === calEvent.accountId);
    if (!account) return;
    showToast("Deleting...", "loading");
    try {
      if (calEvent.recurringEventId) {
        const choice = await askRecurring(calEvent);
        if (!choice) { setToast(null); return; }
        if (choice === "this") {
          const res = await plugin.api.deleteWithAuth(
            account,
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calEvent.calendarId)}/events/${calEvent.id}`
          );
          if (!res.ok) throw new Error("Failed to delete event");
          dispatch({ type: "REMOVE_EVENT", payload: calEvent.id });
        } else {
          await plugin.api.deleteRecurringAndFollowing(account, calEvent.calendarId, calEvent);
          await fetchCalendarRef.current?.(calEvent.calendarId, calEvent.accountId);
        }
      } else {
        const res = await plugin.api.deleteWithAuth(
          account,
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calEvent.calendarId)}/events/${calEvent.id}`
        );
        if (!res.ok) throw new Error("Failed to delete event");
        dispatch({ type: "REMOVE_EVENT", payload: calEvent.id });
      }
      setEditingEvent(null);
      showToast("Event deleted", "success", 2000);
    } catch (err) {
      showToast(`Failed to delete event: ${(err as Error).message}`, "error");
    }
  };

  const handleRespond = async (calEvent: CalEvent, status: "accepted" | "declined" | "tentative") => {
    const account = plugin.data.accounts.find((a) => a.accountId === calEvent.accountId);
    if (!account) return;
    try {
      let eventId = calEvent.id;
      if (calEvent.recurringEventId) {
        const choice = await askRecurring(calEvent, {
          title: "RSVP to recurring event",
          hideFollowing: true,
          showAll: true,
        });
        if (!choice) return;
        if (choice === "all") eventId = calEvent.recurringEventId;
      }
      showToast("Updating response...", "loading");
      const updated = await plugin.api.patchAttendeeResponse(
        account, calEvent.calendarId, eventId, calEvent.attendees, status
      );
      dispatch({ type: "UPDATE_EVENT", payload: { id: updated.id, changes: updated } });
      setEditingEvent(null);
      showToast("Response updated", "success", 2000);
    } catch (err) {
      showToast(`Failed to update response: ${(err as Error).message}`, "error");
    }
  };

  const hasFetchedInitial = useRef(false);
  const selectedDateRef = useRef(state.selectedDate);
  const activeViewRef = useRef(activeView);

  // Fetches calendar list, dispatches SET_CALENDARS, returns merged CalendarMeta[].
  const fetchCalendarsRef = useRef<(() => Promise<CalendarMeta[]>) | undefined>(undefined);

  // Generic event fetcher for any date/view. Returns CalEvent[], no dispatch.
  const fetchWindowRef = useRef<
    ((date: Date, view: "day" | "3day" | "week", calendars?: CalendarMeta[]) => Promise<CalEvent[]>) | undefined
  >(undefined);

  // Fetches all 3 windows (prev, current, next) for a given date and dispatches each.
  const fetchAllWindowsRef = useRef<((date: Date, calendars?: CalendarMeta[]) => Promise<void>) | undefined>(undefined);

  // Full refresh: calendar list + all 3 windows. Used by poll and manual refresh.
  const runFullRefreshRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Single-calendar targeted refetch. Operates on windowEvents.current via MERGE_EVENTS.
  const fetchCalendarRef = useRef<((calendarId: string, accountId: string) => Promise<void>) | undefined>(undefined);

  // Navigation refs — always use latest activeView closure via re-assignment each render.
  const navigateNextRef = useRef<(() => void) | undefined>(undefined);
  const navigatePrevRef = useRef<(() => void) | undefined>(undefined);
  const duplicateRef = useRef<(() => void) | undefined>(undefined);
  const fetchIdRef = useRef(0);

  const calendarRef = useRef<FullCalendar>(null);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);

  const eventElementMap = useRef<Map<HTMLElement, CalEvent>>(new Map());

  // ─── Ref assignments (re-run every render, always latest closure) ───────────

  fetchCalendarsRef.current = async (): Promise<CalendarMeta[]> => {
    const accounts = plugin.data.accounts;
    if (!accounts.length) return [];
    const allCalendars = (await Promise.all(
      accounts.map((account) => plugin.api.getCalendarList(account))
    )).flat();
    const merged = allCalendars.map((cal) => {
      const existing = state.calendars.find((c) => c.id === cal.id);
      if (existing) return { ...cal, visible: existing.visible };
      const persisted = plugin.data.calendarVisibility?.[cal.id];
      return { ...cal, visible: persisted !== undefined ? persisted : cal.visible };
    });
    dispatch({ type: "SET_CALENDARS", payload: merged });
    return merged;
  };

  fetchWindowRef.current = async (
    date: Date,
    view: "day" | "3day" | "week",
    calendars?: CalendarMeta[]
  ): Promise<CalEvent[]> => {
    const cals = calendars ?? state.calendars;
    const accounts = plugin.data.accounts;
    const { timeMin, timeMax } = getViewWindow(date, view);
    const allEvents = (await Promise.all(
      cals
        .filter((cal) => cal.visible)
        .map((cal) => {
          const account = accounts.find((a) => a.accountId === cal.accountId);
          if (!account) return Promise.resolve([]);
          return plugin.api.getEvents(account, cal.id, timeMin, timeMax);
        })
    )).flat();
    return deduplicateEvents(allEvents);
  };

  fetchAllWindowsRef.current = async (date: Date, calendars?: CalendarMeta[]): Promise<void> => {
    const id = ++fetchIdRef.current;
    const { prevDate, nextDate } = getAdjacentDates(date, activeView);
    const [prevEvents, currentEvents, nextEvents] = await Promise.all([
      fetchWindowRef.current?.(prevDate, activeView, calendars) ?? Promise.resolve([]),
      fetchWindowRef.current?.(date, activeView, calendars) ?? Promise.resolve([]),
      fetchWindowRef.current?.(nextDate, activeView, calendars) ?? Promise.resolve([]),
    ]);
    if (fetchIdRef.current !== id) return;
    dispatch({ type: "SET_PREV_WINDOW", payload: prevEvents });
    dispatch({ type: "SET_CURRENT_WINDOW", payload: currentEvents });
    dispatch({ type: "SET_NEXT_WINDOW", payload: nextEvents });
  };

  runFullRefreshRef.current = async () => {
    showToast("Loading calendars...", "loading");
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const calendars = await fetchCalendarsRef.current?.() ?? [];
      await fetchAllWindowsRef.current?.(state.selectedDate, calendars);
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

  navigateNextRef.current = () => {
    calendarRef.current?.getApi().next();
    const newDate = calendarRef.current?.getApi().getDate();
    if (!newDate) return;
    dispatch({ type: "SET_DATE", payload: newDate });

    if (state.windowEvents.next.length > 0) {
      // Pre-loaded — instant shift, then prefetch new next in background.
      const id = ++fetchIdRef.current;
      dispatch({ type: "SHIFT_FORWARD" });
      const { nextDate } = getAdjacentDates(newDate, activeView);
      fetchWindowRef.current?.(nextDate, activeView).then((events) => {
        if (fetchIdRef.current === id) dispatch({ type: "SET_NEXT_WINDOW", payload: events });
      });
    } else {
      // Next window wasn't ready yet — fetch all 3 fresh.
      fetchAllWindowsRef.current?.(newDate);
    }
  };

  navigatePrevRef.current = () => {
    calendarRef.current?.getApi().prev();
    const newDate = calendarRef.current?.getApi().getDate();
    if (!newDate) return;
    dispatch({ type: "SET_DATE", payload: newDate });

    if (state.windowEvents.prev.length > 0) {
      // Pre-loaded — instant shift, then prefetch new prev in background.
      const id = ++fetchIdRef.current;
      dispatch({ type: "SHIFT_BACK" });
      const { prevDate } = getAdjacentDates(newDate, activeView);
      fetchWindowRef.current?.(prevDate, activeView).then((events) => {
        if (fetchIdRef.current === id) dispatch({ type: "SET_PREV_WINDOW", payload: events });
      });
    } else {
      // Prev window wasn't ready yet — fetch all 3 fresh.
      fetchAllWindowsRef.current?.(newDate);
    }
  };

  duplicateRef.current = () => {
    if (!editingEvent) return;
    const snapshot = editingEvent;
    setEditingEvent(null);
    handleDuplicate(snapshot);
  };

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Initial load — fetch calendar list + all 3 windows in parallel.
  useEffect(() => {
    (async () => {
      showToast("Loading calendars...", "loading");
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });
      try {
        const calendars = await fetchCalendarsRef.current?.() ?? [];
        await fetchAllWindowsRef.current?.(state.selectedDate, calendars);
        setToast(null);
      } catch (err) {
        showToast((err as Error).message, "error");
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
        hasFetchedInitial.current = true;
      }
    })();
  }, []);

  // View change — fetch all 3 windows fresh. Date navigation is handled at call sites.
  useEffect(() => {
    if (!hasFetchedInitial.current) return;
    fetchAllWindowsRef.current?.(state.selectedDate);
  }, [activeView]);

  // 5-minute poll — full refresh (calendar list + all 3 windows).
  useEffect(() => {
    const interval = setInterval(() => runFullRefreshRef.current?.(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Persist calendar visibility on every calendars change.
  useEffect(() => {
    if (state.calendars.length === 0) return;
    const visibility: Record<string, boolean> = {};
    state.calendars.forEach((cal) => { visibility[cal.id] = cal.visible; });
    plugin.data.calendarVisibility = visibility;
    plugin.saveData(plugin.data);
  }, [state.calendars]);

  // ResizeObserver — tell FullCalendar to remeasure when the panel resizes.
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
    const el = calendarWrapperRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      let target = e.target as HTMLElement | null;
      while (target && target !== el) {
        if (eventElementMap.current.has(target)) {
          setContextMenu({ calEvent: eventElementMap.current.get(target)!, x: e.clientX, y: e.clientY });
          return;
        }
        target = target.parentElement;
      }
    };
    el.addEventListener("contextmenu", handler);
    return () => el.removeEventListener("contextmenu", handler);
  }, []);

  // Persist density.
  useEffect(() => {
    plugin.data.viewDensity = density;
    plugin.saveData(plugin.data);
  }, [density]);


  // Wire commandBridge — empty deps so it registers once.
  // nav refs are re-assigned every render so they always use the latest closure.
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
        fetchAllWindowsRef.current?.(today);
      },
      refresh: () => { runFullRefreshRef.current?.(); },
      next: () => navigateNextRef.current?.(),
      prev: () => navigatePrevRef.current?.(),
      duplicate: () => duplicateRef.current?.(),
    };
    return () => {
      plugin.commandBridge = null;
    };
  }, []);

  // Persist active view.
  useEffect(() => {
    plugin.data.activeView = activeView;
    plugin.saveData(plugin.data);
  }, [activeView]);

  useEffect(() => {
    selectedDateRef.current = state.selectedDate;
  }, [state.selectedDate]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  // Close view popover on outside click.
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

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timerId = setTimeout(() => {
        const newToday = new Date();
        const newTodayStart = new Date(newToday);
        newTodayStart.setHours(0, 0, 0, 0);
        const view = activeViewRef.current;
        const shouldAdvance = view === "week"
          ? newTodayStart.getTime() >= getViewWindow(selectedDateRef.current, view).timeMax.getTime()
          : true;
        if (shouldAdvance) {
          dispatch({ type: "SET_DATE", payload: newToday });
          calendarRef.current?.getApi().today();
          fetchAllWindowsRef.current?.(newToday);
        }
        schedule();
      }, midnight.getTime() - now.getTime());
    };
    schedule();
    return () => clearTimeout(timerId);
  }, []);

  // ─── MiniMonth date selection ─────────────────────────────────────────────

  const handleDateSelect = (date: Date) => {
    const { prevDate, nextDate } = getAdjacentDates(state.selectedDate, activeView);
    const currentWindowStart = getViewWindow(state.selectedDate, activeView).timeMin;
    const targetWindowStart = getViewWindow(date, activeView).timeMin;

    dispatch({ type: "SET_DATE", payload: date });
    calendarRef.current?.getApi().gotoDate(date);

    if (targetWindowStart.getTime() === currentWindowStart.getTime()) {
      // Same window — no data change needed.
    } else if (targetWindowStart.getTime() === nextDate.getTime()) {
      // One step forward.
      if (state.windowEvents.next.length > 0) {
        dispatch({ type: "SHIFT_FORWARD" });
        const { nextDate: newNextDate } = getAdjacentDates(date, activeView);
        fetchWindowRef.current?.(newNextDate, activeView).then((events) => {
          dispatch({ type: "SET_NEXT_WINDOW", payload: events });
        });
      } else {
        fetchAllWindowsRef.current?.(date);
      }
    } else if (targetWindowStart.getTime() === prevDate.getTime()) {
      // One step back.
      if (state.windowEvents.prev.length > 0) {
        dispatch({ type: "SHIFT_BACK" });
        const { prevDate: newPrevDate } = getAdjacentDates(date, activeView);
        fetchWindowRef.current?.(newPrevDate, activeView).then((events) => {
          dispatch({ type: "SET_PREV_WINDOW", payload: events });
        });
      } else {
        fetchAllWindowsRef.current?.(date);
      }
    } else {
      // Arbitrary jump — fetch all 3 fresh.
      fetchAllWindowsRef.current?.(date);
    }
  };

  // ─── FC events — filter from current window only ─────────────────────────

  const fcEvents = useMemo(
    () =>
      state.windowEvents.current
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
    [state.windowEvents.current, state.calendars]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

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
              fetchAllWindowsRef.current?.(today);
            }}
            className="gcal-panel-btn-icon"
            title="Go to today"
          >
            T
          </button>
          <button
            onClick={() => navigatePrevRef.current?.()}
            className="gcal-panel-btn-icon"
            title="Previous"
          >
            ‹
          </button>
          <button
            onClick={() => navigateNextRef.current?.()}
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
            onClick={() => runFullRefreshRef.current?.()}
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

          eventDidMount={(info) => {
            const calEvent = info.event.extendedProps.calEvent as CalEvent;
            eventElementMap.current.set(info.el, calEvent);
          }}
          eventWillUnmount={(info) => {
            eventElementMap.current.delete(info.el);
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
              const { targetEventId, ...putUpdates } = updates;
              const targetId = targetEventId ?? editingEvent.id;
              const updated = await plugin.api.putEvent(account, editingEvent.calendarId, targetId, putUpdates);
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

      {contextMenu && (
        <ContextMenu
          calEvent={contextMenu.calEvent}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onJoinMeeting={
            contextMenu.calEvent.hangoutLink
              ? () => window.open(contextMenu.calEvent.hangoutLink!, "_blank")
              : undefined
          }
          onDuplicate={() => handleDuplicate(contextMenu.calEvent)}
          onRespond={(status) => handleRespond(contextMenu.calEvent, status)}
          onDelete={() => handleDelete(contextMenu.calEvent)}
        />
      )}
    </div>
  );
}
