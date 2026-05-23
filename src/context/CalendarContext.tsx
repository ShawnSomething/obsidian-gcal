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
  events: CalEvent[];
  activeView: ViewType;
  selectedDate: Date;
  isLoading: boolean;
  error: string | null;
}

const initialState: CalendarState = {
  calendars: [],
  events: [],
  activeView: "week",
  selectedDate: new Date(),
  isLoading: false,
  error: null,
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_CALENDARS"; payload: CalendarMeta[] }
  | { type: "SET_EVENTS"; payload: CalEvent[] }
  | { type: "TOGGLE_CALENDAR"; payload: string } // calendar id
  | { type: "SET_VIEW"; payload: ViewType }
  | { type: "SET_DATE"; payload: Date }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "UPDATE_EVENT"; payload: { id: string; changes: Partial<CalEvent> } }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "ADD_EVENT"; payload: CalEvent }
  | { type: "REMOVE_EVENT"; payload: string };

// ─── Reducer ─────────────────────────────────────────────────────────────────

function calendarReducer(state: CalendarState, action: Action): CalendarState {
  switch (action.type) {
    case "SET_CALENDARS":
      return { ...state, calendars: action.payload };

    case "SET_EVENTS":
      return { ...state, events: action.payload };

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
        events: state.events.map((e) =>
          e.id === action.payload.id ? { ...e, ...action.payload.changes } : e
        ),
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload };

    case "ADD_EVENT":
      return {
        ...state,
        events: [...state.events.filter((e) => e.id !== action.payload.id), action.payload],
      };

    case "REMOVE_EVENT":
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.payload),
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