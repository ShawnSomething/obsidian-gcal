import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
} from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarMeta {
  id: string;
  accountId: string;
  summary: string;
  backgroundColor: string;
  visible: boolean;
  accessRole: string;
}

export interface Attendee {
  email: string;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  self?: boolean;
}

export interface CalEvent {
  id: string;
  iCalUID: string;
  calendarId: string;
  accountId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string;
  color: string;
  attendees: Attendee[];
  selfResponseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  recurrence?: string[];
  recurringEventId?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
}

type ViewType = "day" | "3day" | "week";

// ─── State ───────────────────────────────────────────────────────────────────

interface CalendarState {
  calendars: CalendarMeta[];
  windowEvents: { prev: CalEvent[]; current: CalEvent[]; next: CalEvent[] };
  activeView: ViewType;
  selectedDate: Date;
  isLoading: boolean;
  error: string | null;
}

const initialState: CalendarState = {
  calendars: [],
  windowEvents: { prev: [], current: [], next: [] },
  activeView: "week",
  selectedDate: new Date(),
  isLoading: false,
  error: null,
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_CALENDARS"; payload: CalendarMeta[] }
  | { type: "SET_CURRENT_WINDOW"; payload: CalEvent[] }
  | { type: "SET_PREV_WINDOW"; payload: CalEvent[] }
  | { type: "SET_NEXT_WINDOW"; payload: CalEvent[] }
  | { type: "SHIFT_FORWARD" }
  | { type: "SHIFT_BACK" }
  | { type: "TOGGLE_CALENDAR"; payload: string } // calendar id
  | { type: "SET_VIEW"; payload: ViewType }
  | { type: "SET_DATE"; payload: Date }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "UPDATE_EVENT"; payload: { id: string; changes: Partial<CalEvent> } }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "ADD_EVENT"; payload: CalEvent }
  | { type: "REMOVE_EVENT"; payload: string }
  | { type: "MERGE_EVENTS"; payload: { calendarId: string; events: CalEvent[] } };

// ─── Reducer ─────────────────────────────────────────────────────────────────

function calendarReducer(state: CalendarState, action: Action): CalendarState {
  switch (action.type) {
    case "SET_CALENDARS":
      return { ...state, calendars: action.payload };

    case "SET_CURRENT_WINDOW":
      return { ...state, windowEvents: { ...state.windowEvents, current: action.payload } };

    case "SET_PREV_WINDOW":
      return { ...state, windowEvents: { ...state.windowEvents, prev: action.payload } };

    case "SET_NEXT_WINDOW":
      return { ...state, windowEvents: { ...state.windowEvents, next: action.payload } };

    case "SHIFT_FORWARD":
      return {
        ...state,
        windowEvents: {
          prev: state.windowEvents.current,
          current: state.windowEvents.next,
          next: [],
        },
      };

    case "SHIFT_BACK":
      return {
        ...state,
        windowEvents: {
          prev: [],
          current: state.windowEvents.prev,
          next: state.windowEvents.current,
        },
      };

    case "TOGGLE_CALENDAR":
      return {
        ...state,
        calendars: state.calendars.map((cal) =>
          cal.id === action.payload
            ? { ...cal, visible: !cal.visible }
            : cal
        ),
      };

    case "SET_VIEW":
      return { ...state, activeView: action.payload };

    case "SET_DATE":
      return { ...state, selectedDate: action.payload };

    case "UPDATE_EVENT":
      return {
        ...state,
        windowEvents: {
          ...state.windowEvents,
          current: state.windowEvents.current.map((e) =>
            e.id === action.payload.id ? { ...e, ...action.payload.changes } : e
          ),
        },
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload };

    case "ADD_EVENT":
      return {
        ...state,
        windowEvents: {
          ...state.windowEvents,
          current: [
            ...state.windowEvents.current.filter((e) => e.id !== action.payload.id),
            action.payload,
          ],
        },
      };

    case "REMOVE_EVENT":
      return {
        ...state,
        windowEvents: {
          ...state.windowEvents,
          current: state.windowEvents.current.filter((e) => e.id !== action.payload),
        },
      };

    case "MERGE_EVENTS":
      return {
        ...state,
        windowEvents: {
          ...state.windowEvents,
          current: [
            ...state.windowEvents.current.filter((e) => e.calendarId !== action.payload.calendarId),
            ...action.payload.events,
          ],
        },
      };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface CalendarContextValue {
  state: CalendarState;
  dispatch: React.Dispatch<Action>;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(calendarReducer, initialState);

  return (
    <CalendarContext.Provider value={{ state, dispatch }}>
      {children}
    </CalendarContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCalendar(): CalendarContextValue {
  const ctx = useContext(CalendarContext);
  if (!ctx) {
    throw new Error("useCalendar must be used inside <CalendarProvider>");
  }
  return ctx;
}
