# Obsidian Google Calendar Plugin — PRD + Tech Design

## Status
`In Progress` — Started May 2026

---

## 1. Goal

Build an Obsidian sidebar plugin with a fully interactive Google Calendar view.
Multiple Google accounts, bi-directional sync, drag-to-move, accept/reject.
Modelled on Akiflow's calendar UX.

Personal use first. Publish to Obsidian community plugin store once stable.

---

## 2. About the Developer

Junior-level developer. Has built TSX apps but no full products.
First Obsidian plugin. Needs principal-engineer-level guidance throughout.
Comfortable with React/TSX. Needs Obsidian-specific patterns explained.

## 2.5. Rule to follow under all circumstances
Read the plan, identify what files needed, ask for them, then write code.
### Bug fixes
Read the exact error message and line number before doing anything.
Fix only what the error points to. Do not rewrite surrounding code.
If the fix is one line, write one line.

### Scope discipline
Only change what the task requires. Do not touch surrounding code, outer divs, or class names that are not part of the feature being built. A mistake was made changing `gcal-panel-container` to `gcal-panel-header` on the root return div while adding MiniMonth — this broke the entire layout. Never touch the outer container when adding something inside a child.

---

## 3. Features (Priority Order)

| # | Feature | Notes |
|---|---|---|
| 1 | Multiple Google account auth | OAuth 2.0 with PKCE, one-time setup per account |
| 2 | Unified calendar view | All active calendars merged into one view |
| 3 | Accept / Reject invites | Per calendar, per account |
| 4 | Drag to move events → gCal sync | Standard 3-way modal for recurring |
| 5 | Edit events → gCal sync | Same 3-way modal for recurring |
| 6 | Create events → gCal sync | Click empty time slot to start |
| 7 | Day / 3-day / Week view toggle | Buttons in panel header |
| 8 | Mini month view | Navigation only — click date jumps main view |
| 9 | Open in browser button | `htmlLink` field from Google API |
| 10 | Obsidian sidebar panel | `ItemView`, user-draggable width |

### Out of Scope (v1)
- Mobile
- Outlook / non-Google calendars
- Task management / time-blocking
- Natural language event creation

---

## 4. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Obsidian standard |
| UI | React 18 (TSX) | Dev has TSX experience |
| Calendar UI | FullCalendar.js v6 | MIT, drag-drop built in, proven in Obsidian |
| Calendar API | Google Calendar REST API v3 | Direct HTTP, no SDK bloat |
| Auth | OAuth 2.0 with PKCE | Desktop flow via local HTTP server |
| Token storage | `plugin.saveData()` | Local only, never leaves device |
| Build | esbuild | Obsidian plugin template standard |

### FullCalendar packages
- @fullcalendar/core
- @fullcalendar/react
- @fullcalendar/timegrid
- @fullcalendar/daygrid
- @fullcalendar/interaction

### esbuild config additions (already applied)
```js
jsx: "automatic",
loader: { ".css": "css" },
```

---

## 5. Architecture

### 5.1 File Structure
```
obsidian-gcal/
├── src/
│   ├── main.ts                   ← Plugin entry point, registers ItemView + settings tab
│   ├── CalendarView.tsx          ← ItemView shell, mounts React root, wraps CalendarProvider
│   ├── context/
│   │   └── CalendarContext.tsx   ← React Context + useReducer (global state) ✓ DONE
│   ├── components/
│   │   ├── CalendarPanel.tsx     ← FullCalendar config + fetch logic + header ✓ DONE
│   │   ├── CalendarToggle.tsx    ← Show/hide individual calendars, grouped by account ✓ DONE
│   │   ├── MiniMonth.tsx         ← Mini month navigation widget ✓ DONE
│   │   ├── EventModal.tsx        ← Edit + Create modal (discriminated union Props) ✓ DONE
│   │   └── RecurringModal.tsx    ← "This / This & Following / All events" choice ✓ DONE
│   ├── settings/
│   │   └── SettingsTab.ts        ← Obsidian PluginSettingTab (account management)
│   ├── auth/
│   │   ├── OAuthManager.ts       ← OAuth PKCE flow per account ✓ DONE
│   │   └── TokenStore.ts         ← Read/write tokens via plugin.saveData() ✓ DONE
│   ├── api/
│   │   ├── GoogleCalendarAPI.ts  ← All API calls with auto-refresh ✓ DONE (patchAttendeeResponse added)
│   │   └── types.ts              ← TypeScript types for all Google API shapes ✓ DONE
│   └── utils/
│       ├── dedup.ts              ← Event deduplication by iCalUID ✓ DONE
│       └── rrule.ts              ← RRULE builder — buildRRule(options) → string ✓ DONE
│       └── color.ts              ← desaturateHex() — reduces color saturation for event chips
├── styles.css
├── manifest.json
├── package.json
└── esbuild.config.mjs
```

### 5.2 React Mounting Pattern (Critical for Obsidian)

Obsidian's `ItemView` is not a React component. Mount/unmount manually.
`CalendarProvider` wraps the entire React tree at this level.

```typescript
// CalendarView.tsx
async onOpen() {
  const container = this.containerEl.children[1];
  if (!container) throw new Error("CalendarView: container not found");
  this.root = createRoot(container);
  this.root.render(
    <CalendarProvider>
      <CalendarPanel plugin={this.plugin} />
    </CalendarProvider>
  );
}

async onClose() {
  this.root?.unmount();
}
```

Missing `onClose` unmount = memory leak on every sidebar close.

### 5.3 State Management

React Context + useReducer. No external state library.

`CalendarContext.tsx` provides:
- `calendars: CalendarMeta[]`
- `events: CalEvent[]`
- `activeView: "day" | "3day" | "week"`
- `selectedDate: Date`
- `isLoading: boolean`
- `error: string | null`
- `dispatch` — actions: `SET_EVENTS`, `SET_CALENDARS`, `TOGGLE_CALENDAR`, `SET_VIEW`, `SET_DATE`, `SET_LOADING`, `SET_ERROR`, `UPDATE_EVENT`, `ADD_EVENT`, `REMOVE_EVENT`, `MERGE_EVENTS`

Note: `accounts` is NOT in context — read directly from `plugin.data.accounts` at fetch time.

### 5.4 Data Model

**Persisted to disk (`plugin.saveData()`):**
```typescript
interface PluginData {
  accounts: AccountConfig[];
  calendarVisibility: Record<string, boolean>;
  clientId: string;
  clientSecret: string;
  viewDensity: ViewDensity;  // "compact" | "medium" | "large"
}

interface AccountConfig {
  accountId: string;    // email as unique key
  displayName: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;  // unix ms timestamp
}
```

**In-memory (CalendarContext):**
```typescript
interface CalendarMeta {
  id: string;
  accountId: string;
  summary: string;
  backgroundColor: string;
  visible: boolean;
  accessRole: string;   // "owner" | "writer" | "reader" — gates write operations
}

interface Attendee {
  email: string;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  self?: boolean;
}

interface CalEvent {
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
}
```

### 5.5 OAuth Flow (per account)

1. User enters Client ID + Secret in plugin settings
2. Clicks "Add Account"
3. Plugin generates PKCE `code_verifier` + `code_challenge` (SHA-256)
4. Plugin generates random `state` token (CSRF protection)
5. Starts local HTTP server on `localhost:42813`
6. Opens browser to Google OAuth URL
7. User approves → browser redirects to `localhost:42813/callback`
8. Plugin verifies `state`, exchanges `code` for tokens
9. Tokens saved, server shuts down

**Token refresh — with race condition protection:**
```typescript
private refreshPromises: Map<string, Promise<void>> = new Map();

private async ensureFreshToken(account: AccountConfig): Promise<string> {
  if (Date.now() < account.tokenExpiry - 60000) return account.accessToken;
  const existing = this.refreshPromises.get(account.accountId);
  if (existing) {
    await existing;
    const updated = await this.tokenStore.load();
    const fresh = updated.accounts.find(a => a.accountId === account.accountId);
    return fresh?.accessToken ?? account.accessToken;
  }
  const promise = this.doRefresh(account).finally(() => {
    this.refreshPromises.delete(account.accountId);
  });
  this.refreshPromises.set(account.accountId, promise);
  await promise;
  const updated = await this.tokenStore.load();
  const fresh = updated.accounts.find(a => a.accountId === account.accountId);
  return fresh?.accessToken ?? account.accessToken;
}
```

Note: `refreshPromises` is a `Map` keyed by `accountId` — not a single Promise — so multiple accounts refresh independently.

**Port conflict handling:**
Try 42813 first. If `EADDRINUSE`, scan up to 42817. All ports must be registered in GCP as redirect URIs.

### 5.6 Event Fetching

On load + every 5 minutes (setInterval in CalendarPanel useEffect):
1. Per account → `GET /calendar/v3/users/me/calendarList`
2. Preserve existing `visible` state when re-fetching calendar list
3. Per visible calendar → `GET /calendar/v3/calendars/{id}/events`
   - `timeMin/timeMax` = current view window
   - `singleEvents=true`
   - `maxResults=250`
4. Merge all events, deduplicate by `iCalUID + start` (not `iCalUID` alone — recurring instances share `iCalUID` but have different `start` values)
5. Dispatch `SET_EVENTS`
6. On view date change → refetch immediately

**fetchAllRef pattern** — interval uses a ref to avoid stale closures without resetting the polling interval on every state change:
```typescript
const fetchAllRef = useRef<(() => Promise<void>) | undefined>(undefined);
fetchAllRef.current = async () => { ... }; // always latest closure
useEffect(() => {
  const interval = setInterval(() => fetchAllRef.current?.(), 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []); // empty deps — interval never resets
```

**fetchCalendarRef pattern** — targeted single-calendar refetch. Used after splitRecurringSeries / deleteRecurringAndFollowing / recurring postEvent. Same ref pattern as fetchAllRef.
```typescript
const fetchCalendarRef = useRef<((calendarId: string, accountId: string) => Promise<void>) | undefined>(undefined);
fetchCalendarRef.current = async (calendarId: string, accountId: string) => {
  const account = plugin.data.accounts.find((a) => a.accountId === accountId);
  if (!account) return;
  const { timeMin, timeMax } = getViewWindow(state.selectedDate, activeView);
  const events = await plugin.api.getEvents(account, calendarId, timeMin, timeMax);
  dispatch({ type: "MERGE_EVENTS", payload: { calendarId, events } });
};
```

`MERGE_EVENTS` reducer replaces all events for that `calendarId` with the fresh list, leaving all other calendars' events untouched:
```typescript
case "MERGE_EVENTS":
  return {
    ...state,
    events: [
      ...state.events.filter((e) => e.calendarId !== action.payload.calendarId),
      ...action.payload.events,
    ],
  };
```

No toast inside `fetchCalendarRef` — the caller already has a toast running.

**Calendar visibility toggle** does NOT trigger a refetch. Events are already in memory — `fcEvents` filters client-side on render.

**Event color** — Google hex color desaturated by 0.2 via `desaturateHex()` + `CC` suffix for ~80% opacity:
```tsx
backgroundColor: desaturateHex(calendars.find(c => c.id === e.calendarId)?.backgroundColor ?? "#4285F4", 0.2) + "CC"
```

**Declined event filter** — `fcEvents` useMemo filters out events where `selfResponseStatus === "declined"`. Done client-side, no refetch needed.

**View window fetch range:**
- `day`: start of selectedDate → +1 day
- `3day`: start of selectedDate → +3 days
- `week`: Monday of selectedDate's week → +7 days

**Week view snap to Monday:**
```typescript
if (view === "week") {
  const dayOfWeek = start.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7; // Sun→6, Mon→0, Tue→1, etc.
  start.setDate(start.getDate() - daysFromMonday);
}
```
`(dayOfWeek + 6) % 7` handles Sunday (0) correctly — without it Sunday gives -1.

**Parallel fetches** — both calendar list and event fetches use `Promise.all`. Already implemented. No change needed.

### 5.7 Write Operations

**Drag-to-move:** `PATCH` with `sendUpdates=none`. Call `revert()` on error.
**Edit event:** `PUT` full event body, `sendUpdates=all`.
**Create event:** `POST`, `sendUpdates=all`. Accepts optional `recurrence?: string[]`.
**Accept/Decline/Tentative:** `PATCH` attendees array (must send full array), `sendUpdates=all`. `organizer` and `creator` fields are immutable — patching attendees never changes event ownership.
**Delete event (non-recurring):** `DELETE` the event URL directly via `deleteWithAuth()`.
**Delete recurring — this event:** `DELETE` the instance ID.
**Delete recurring — this and following:** `deleteRecurringAndFollowing()` — PATCH master UNTIL to 1 second before `instance.start`, then DELETE the instance. Rollback RRULE if DELETE fails. No POST (unlike splitRecurringSeries).

**Add recurrence to existing non-recurring event:** PUT the event with `recurrence` field added. Google requires `timeZone` in `start`/`end` objects when `recurrence` is present. Use `Intl.DateTimeFormat().resolvedOptions().timeZone` for device timezone. PUT response only returns master event — use `fetchCalendarRef` (not `UPDATE_EVENT`) so all instances appear. CalendarPanel `onSave` handler branches on `updates.recurrence?.length`.

**Timezone handling in EventModal:**
- `datetime-local` inputs have no timezone awareness — always work in local time
- `toLocalInput(isoString)` converts UTC ISO string to local time for display
- On save: `new Date(localString).toISOString()` converts back correctly — do NOT manually reattach timezone offset
- All timezone handling anchors to device time — no timezone picker needed; device timezone IS the calendar timezone

```typescript
function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
```

**Post-write state sync:**
- Single-event ops (PATCH/PUT/POST non-recurring): use response body directly — `UPDATE_EVENT` or `ADD_EVENT`, no refetch
- Recurring create (`postEvent` with `recurrence`): use `fetchCalendarRef` — POST response only returns the master, not all instances
- Adding recurrence to existing event (`putEvent` with `recurrence`): use `fetchCalendarRef` — PUT response only returns master, not all instances
- Multi-step ops (`splitRecurringSeries`, `deleteRecurringAndFollowing`): use `fetchCalendarRef` — response from step 1 doesn't represent final state

### 5.8 Recurring Event Write Patterns

- **This event only** — PATCH/PUT the instance ID directly
- **This and following** — Split series: modify master RRULE + POST new series
- **All events** — PATCH/PUT the master event via `recurringEventId`

Recurring instance IDs have a `_YYYYMMDDTHHMMSSZ` suffix (e.g. `bd8d1298a0d94760_20260522T214500Z`). Check for `calEvent.recurringEventId` to detect recurring instances before writing.

**Attendee response on recurring events:**
- "This event" → PATCH the instance ID
- "All events" → PATCH the master ID (`recurringEventId`)
- "This and following" does NOT exist in the Google Calendar API for attendee responses — confirmed via API docs and Google Calendar's own UI (which only shows "This event" / "All events" for RSVP).

### 5.9 FullCalendar Config Notes

**Height fix — CalendarPanel uses flex column layout:**
```tsx
<div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
  <div style={{ flexShrink: 0 }}> {/* header */} </div>
  <div style={{ flex: 1, overflow: "hidden" }}>
    <FullCalendar height="100%" ... />
  </div>
</div>
```

**3-day view:**
```tsx
views={{ threeDays: { type: "timeGrid", duration: { days: 3 } } }}
```

**First day of week:** `firstDay={1}` (Monday)

**Locale:** `locale={enAU}` — import from `@fullcalendar/core/locales/en-au`. Gives DD/MM date format.

**Now indicator:** `nowIndicator={true}` — renders a red horizontal line + time label at the current time. Built-in FC prop, no extra code needed.

**Responsive width — ResizeObserver pattern:**
FullCalendar calculates its width on mount and does not listen for container resizes. Wire a `ResizeObserver` to the wrapper div and call `updateSize()` with a 50ms delay (gives DOM time to settle before FC measures):
```typescript
const calendarWrapperRef = useRef<HTMLDivElement>(null);

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
```
Attach `ref={calendarWrapperRef}` to the wrapper div. Do NOT observe `calendarRef.current.el` — that type doesn't expose `el`.

**Calendar density — slot height via CSS class:**
Three density modes controlled by a class on the wrapper div + CSS in `styles.css`:
```tsx
<div ref={calendarWrapperRef} className={`gcal-density-${density}`} style={{ flex: 1, overflow: "hidden" }}>
  <FullCalendar
    slotDuration={density === "large" ? "00:15:00" : "00:30:00"}
    slotLabelInterval={density === "large" ? "00:30:00" : "01:00:00"}
    ...
```
CSS:
```css
.gcal-density-medium .fc-timegrid-slot { height: 40px; }
.gcal-density-large .fc-timegrid-slot { height: 40px; }
```
Density state initialised from `plugin.data.viewDensity`, persisted on change via `useEffect`. Toggle button in header cycles compact → medium → large → compact, showing S/M/L label.

**Drag-to-create — `select` callback:**
Use `selectable={true}` + `select` callback. Do NOT use `dateClick` — `select` handles both single click and click-drag, replacing `dateClick` entirely.
Do NOT use `selectMirror={true}` — it renders a persistent ghost on the first interaction that never clears.
Call `calendarRef.current?.getApi().unselect()` at the top of the `select` callback to clear FC's selection state immediately.
`select` provides `startStr` and `endStr` directly as ISO strings — no manual `+1hr` calculation needed. On single click, FC sets end = start + 30min by default.

```tsx
selectable={true}
select={(info) => {
  calendarRef.current?.getApi().unselect();
  setCreatingEvent({
    start: info.startStr,
    end: info.endStr,
    allDay: info.allDay,
  });
}}
```

**Recurring event create — fetch all instances after POST:**
`postEvent` response only returns the master event, not all instances. If `recurrence` is set, use `fetchCalendarRef` instead of `ADD_EVENT`:
```typescript
const created = await plugin.api.postEvent(account, calendarId, { title, start, end, allDay, recurrence, location, description });
if (recurrence?.length) {
  await fetchCalendarRef.current?.(calendarId, accountId);
} else {
  dispatch({ type: "ADD_EVENT", payload: created });
}
```

### 5.10 RRULE Builder (`utils/rrule.ts`)

Pure function, no side effects, no imports. Used in EventModal for both create mode and adding recurrence to existing events.

```typescript
export type RRuleFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RRuleDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RRuleEnd =
  | { type: "never" }
  | { type: "until"; date: string }  // YYYY-MM-DD
  | { type: "count"; count: number };

export interface RRuleOptions {
  frequency: RRuleFrequency;
  interval: number;        // always >= 1
  days?: RRuleDay[];       // only relevant when frequency === "WEEKLY"
  end: RRuleEnd;
}

export function buildRRule(options: RRuleOptions): string
```

**Key rules:**
- `INTERVAL=1` is omitted (default, Google doesn't need it)
- `BYDAY` only sent when `frequency === "WEEKLY"` and days array is non-empty
- `UNTIL` format: ISO string with dashes/colons stripped — `.replace(/[-:]/g, "").replace(".000", "")`
- Default day when switching to weekly with empty selection: derive from event start date using `DAY_MAP[new Date(startStr).getDay()] ?? "MO"` where `DAY_MAP = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]`
- "Every weekday except Wednesday" = weekly with BYDAY=MO,TU,TH,FR (Wednesday simply unchecked)

**EventModal recurrence state (create mode and edit mode for non-recurring events):**
```typescript
const [repeat, setRepeat] = useState(false);
const [frequency, setFrequency] = useState<RRuleFrequency>("WEEKLY");
const [interval, setInterval] = useState(1);
const [days, setDays] = useState<RRuleDay[]>([getStartDay(start)]);
const [endType, setEndType] = useState<"never" | "until" | "count">("never");
const [untilDate, setUntilDate] = useState("");
const [countNum, setCountNum] = useState(1);
```

**Repeat UI in edit mode** — only shown when `!(props as EditProps).event.recurringEventId && !(props as EditProps).event.recurrence?.length`. Do not show for events that are already part of a series. Use inline cast in JSX condition — do not hoist to a component-level variable (causes TypeScript narrowing errors throughout).

Import: `import { RRuleFrequency, RRuleDay, buildRRule } from "../utils/rrule"` — static import, not dynamic.

### 5.11 Accept / Decline / Tentative Pattern

`patchAttendeeResponse()` in `GoogleCalendarAPI.ts`:
- Takes `attendees: Attendee[]`, finds `self: true` entry, updates its `responseStatus`
- Sends full attendees array back — required, Google drops unlisted attendees otherwise
- `sendUpdates=all` — organiser needs to know you responded
- `responseStatus` type: `"accepted" | "declined" | "tentative"`
- `organizer` and `creator` fields are immutable — this PATCH cannot change event ownership

**Response buttons in `EventModal` edit mode:**
- Always shown in edit mode (not conditional on `needsAction`)
- Three buttons: Yes (accepted), Maybe (tentative), No (declined)
- Active state highlighted per status — green/amber/red via `gcal-btn-response--{status}` + `gcal-btn-response--active` CSS classes
- Styled via `gcal-btn-response` base class in `styles.css`
- Modelled on Akiflow UX — all options always visible, current selection highlighted

**Recurring attendee response in `CalendarPanel`:**
- `onRespond` checks `editingEvent.recurringEventId`
- If recurring: calls `askRecurring` with `{ title: "RSVP to recurring event", hideFollowing: true, showAll: true }`
- "This event" → patch instance ID; "All events" → patch `recurringEventId`
- "This and following" is hidden — not supported by Google API for attendee responses

**RecurringModal props for context-aware display:**
```typescript
interface RecurringModalProps {
  eventTitle: string;
  title?: string;          // defaults to "Edit recurring event"
  hideFollowing?: boolean; // hides "This and following events" option
  showAll?: boolean;       // shows "All events" option
  onChoice: (choice: "this" | "following" | "all" | null) => void;
}
```

**`askRecurring` signature in CalendarPanel:**
```typescript
const askRecurring = (
  event: CalEvent,
  opts?: { title?: string; hideFollowing?: boolean; showAll?: boolean }
): Promise<"this" | "following" | "all" | null>
```

Declined events filtered out of `fcEvents` useMemo — `selfResponseStatus !== "declined"`. Events with `accepted`, `tentative`, or `needsAction` are shown.

### 5.12 Calendar Visibility Persistence

**Problem:** On reload, `state.calendars` is `[]` (initialState). The merge logic in `fetchAllRef` falls through to the raw API response which has `visible: true` — persisted visibility is never read.

**Fix — two changes in `CalendarPanel.tsx`:**

1. Save visibility to disk on every `state.calendars` change:
```typescript
useEffect(() => {
  if (state.calendars.length === 0) return;
  const visibility: Record<string, boolean> = {};
  state.calendars.forEach((cal) => { visibility[cal.id] = cal.visible; });
  plugin.data.calendarVisibility = visibility;
  plugin.saveData(plugin.data);
}, [state.calendars]);
```
Guard `length === 0` prevents wiping the record before data loads on init.

2. Read persisted visibility in the merge logic:
```typescript
const existing = state.calendars.find((c) => c.id === cal.id);
if (existing) return { ...cal, visible: existing.visible };
const persisted = plugin.data.calendarVisibility?.[cal.id];
return { ...cal, visible: persisted !== undefined ? persisted : cal.visible };
```

**Why save in CalendarPanel, not CalendarToggle:** CalendarToggle is a presentational component — it should only dispatch actions, not own side effects. CalendarPanel owns all side effects (fetching, writing, error handling). Saving visibility belongs there too. Passing `plugin` into CalendarToggle would couple a display component to the entire plugin god-object.

### 5.13 View Density

Three density modes persisted to `plugin.data.viewDensity`:

| Mode | Slot duration | Slot label interval | Row height |
|---|---|---|---|
| compact | 30min | 1hr | default (FC default) |
| medium | 30min | 1hr | 40px via CSS |
| large | 15min | 30min | 40px via CSS |

- `ViewDensity = "compact" | "medium" | "large"` exported from `types.ts`
- Default in `TokenStore.defaultData()`: `viewDensity: "compact"`
- State in `CalendarPanel`: `useState<ViewDensity>(plugin.data.viewDensity ?? "compact")`
- Persisted via `useEffect` watching `density`
- Toggle button in header (after CalendarToggle) cycles S → M → L → S
- CSS targets `.gcal-density-{mode} .fc-timegrid-slot` for row height

### 5.14 RecurringModal Styling

Modal is centred, options have generous vertical padding, cancel button centred. Key CSS values:

```css
.gcal-modal {
  padding: 32px 28px 24px;
  border-radius: 10px;
  gap: 16px;
}
.gcal-modal-title { text-align: center; }
.gcal-modal-subtitle { text-align: center; }
.gcal-modal-option {
  align-items: center;
  text-align: center;
  padding: 22px 12px;   /* 22px vertical — enough breathing room */
}
.gcal-modal-footer { justify-content: center; }
.gcal-modal-cancel { padding: 7px 24px; }
```

### 5.15 MiniMonth Component

**File:** `src/components/MiniMonth.tsx`

Popover-based date picker. Trigger button sits top-left of header showing current month/year (e.g. "May 2026"). Clicking opens a popover grid. Clicking a date dispatches `SET_DATE` and calls `calendarRef.current?.getApi().gotoDate(date)` — both required (context drives fetch, FC API moves the visual).

**Props:**
```typescript
interface Props {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}
```

**Key implementation details:**
- `viewDate` state tracks which month the popover is showing — initialised from `selectedDate`, synced via `useEffect` when `selectedDate` changes
- Week starts Monday — offset calculated via `(dayOfWeek + 6) % 7`
- Outside click closes popover via `mousedown` listener on `document`, cleaned up on close
- Day cells: `width: 28px; height: 28px` — do NOT use `aspect-ratio: 1`, it is unreliable in Electron/Obsidian
- Past days rendered at `opacity: 0.4`
- Today rendered with accent color + bold
- Selected date rendered with accent background

**CalendarPanel wiring:**
```typescript
const handleDateSelect = (date: Date) => {
  dispatch({ type: "SET_DATE", payload: date });
  calendarRef.current?.getApi().gotoDate(date);
};
```

**Header layout:**
```tsx
<div className="gcal-panel-header">
  <MiniMonth selectedDate={state.selectedDate} onDateSelect={handleDateSelect} />
  <div className="gcal-panel-header-left">
    <button>↻</button>
    <CalendarToggle />
    <button>{density}</button>
  </div>
</div>
```

`gcal-panel-header` uses CSS grid (`1fr auto 1fr`) — left group column 1, toast column 2, right group column 3. `gcal-panel-header-left` has `justify-self: end`.

**Popover width:** `240px` — 220px clips the Sunday column. Do not go narrower.

### 5.16 Toast Notification System

**Location:** `CalendarPanel.tsx` — `toast` state + `showToast` helper.

**Pattern:**
```typescript
const [toast, setToast] = useState<{ message: string; type: "loading" | "success" | "error" } | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const showToast = (message: string, type: "loading" | "success" | "error", autoDismissMs?: number) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  setToast({ message, type });
  if (autoDismissMs) {
    toastTimerRef.current = setTimeout(() => setToast(null), autoDismissMs);
  }
};
```

**Placement:** Centre column of the header grid — between the left nav group and right toolbar group.

**Behaviour:**
- `loading` — shown while API call in flight, no auto-dismiss
- `success` — auto-dismisses after 2000ms
- `error` — stays until user clicks ×
- On delete → recurring modal cancel path: call `setToast(null)` explicitly to clear the "Deleting..." loading toast

**Messages used:**
| Operation | Loading | Success |
|---|---|---|
| Fetch | "Loading calendars..." | clears silently (setToast(null)) |
| Save | "Saving..." | "Event saved" |
| Create | "Creating event..." | "Event created" |
| Delete | "Deleting..." | "Event deleted" |
| Move (drag) | "Moving event..." | "Event moved" |
| Resize | "Resizing event..." | "Event resized" |
| Split series | "Splitting series..." | "Series split" |
| RSVP | "Updating response..." | "Response updated" |

**CSS classes:** `gcal-toast`, `gcal-toast--loading`, `gcal-toast--success`, `gcal-toast--error`, `gcal-toast-dismiss`

**Old `state.error` banner and `state.isLoading` loading div removed** — toast replaces both. `dispatch SET_ERROR` calls replaced with `showToast(..., "error")` throughout.

**EventModal `isSaving` state:**
- `onSave` and `onSplitSeries` prop types changed to `Promise<void>` (were `void`)
- `isSaving` state in EventModal disables the save button and changes label to "Saving..." while in-flight
- `handleSave` wrapped in `setIsSaving(true)` / `finally { setIsSaving(false) }`
- All `onSave` / `onSplitSeries` call sites inside `handleSave` use `await`

### 5.17 Timezone Handling

All timezone handling anchors to device local time — no timezone picker needed or built.
- `toLocalInput()` shifts UTC → local for `datetime-local` display
- `new Date(str).toISOString()` on save converts local → UTC correctly
- FullCalendar defaults to browser local timezone for event positioning
- If device timezone matches user's intended calendar timezone (the normal case), everything just works
- When adding `recurrence` to a PUT request, Google requires `timeZone` in `start`/`end` objects. Use `Intl.DateTimeFormat().resolvedOptions().timeZone`.

---

## 6. Obsidian-Specific Patterns

### Settings Tab
Extend `PluginSettingTab`. Register in `main.ts` via `this.addSettingTab(...)`.

### Theming (CSS Variables)
| Obsidian variable | Used for |
|---|---|
| `--background-primary` | Calendar background, dropdown background |
| `--background-secondary` | Time slot background, hover state |
| `--text-normal` | Event text, time labels |
| `--text-muted` | Faint labels, borders, disabled states |
| `--interactive-accent` | Today highlight, accept button |
| `--background-modifier-border` | Grid lines, dropdown border |
| `--text-error` | Error messages |
| `--text-on-accent` | Text on accent-coloured buttons |

### manifest.json
```json
{
  "id": "gcal-obsidian",
  "name": "Google Calendar",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Interactive Google Calendar sidebar with multi-account support.",
  "author": "Your Name",
  "authorUrl": "https://github.com/yourhandle",
  "isDesktopOnly": true
}
```

---

## 7. Dev Environment

- Repo: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/obsidian-gcal`
- Test vault: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/gcal-test`
- Plugin symlinked into vault's `.obsidian/plugins/obsidian-gcal/`
- `npm run dev` — watches and rebuilds on save
- `npm run build` — one-shot production build
- Hot-reload: not working due to symlink issue. Use `Cmd+P` → "Reload app without saving" manually.

---

## 8. Google Cloud Setup — DONE

- Project created
- Calendar API enabled
- OAuth 2.0 credentials created (Desktop App type)
- Redirect URIs registered: `http://localhost:42813` through `42817`
- Client ID + Secret saved

---

## 9. Build Phases

### Phase 1 — Scaffolding ✅ DONE
- [x] Clone Obsidian sample plugin template
- [x] Configure esbuild for TSX + CSS
- [x] Register `ItemView`, mount React root, confirm sidebar renders
- [x] Install FullCalendar, render static test event with correct height

### Phase 2 — Auth ✅ DONE
- [x] OAuthManager.ts — PKCE flow, bug fixed (codeChallenge was regenerated inside waitForCallback instead of passed through)
- [x] OAuth scope fix — must include both `calendar` and `userinfo.email`
- [x] TokenStore.ts — read/write via `plugin.saveData()`, lives in `auth/`
- [x] Auto-refresh with race condition lock (`Map<string, Promise<void>>` keyed by accountId)
- [x] Settings tab UI — enter Client ID/Secret, add/remove accounts
- [x] Stale closure fix — onChange handlers reload fresh data before saving credentials
- [x] `reloadCredentials()` on main.ts — called after credential changes so API instance stays current
- [x] Multi-account support — confirmed working, accounts stack correctly in data.json

### Phase 3 — Read Data ✅ DONE
- [x] Build `CalendarContext.tsx` — useReducer with SET_EVENTS, SET_CALENDARS, TOGGLE_CALENDAR, SET_VIEW, SET_DATE, SET_LOADING, SET_ERROR
- [x] Add `getCalendarList()` to `GoogleCalendarAPI.ts`
- [x] Add `getEvents()` to `GoogleCalendarAPI.ts` — encodeURIComponent on calendarId, filter cancelled events
- [x] Build `utils/dedup.ts` — deduplicate by `iCalUID + start` (bug fix: `iCalUID` alone drops recurring instances)
- [x] Wire fetching into `CalendarPanel.tsx` via context — fetchAllRef pattern for stale closure safety
- [x] Render events in FullCalendar with resolved colors (hex + CC opacity)
- [x] Calendar show/hide toggles (`CalendarToggle.tsx`) — grouped by account, colored dots, dropdown
- [x] 5-min polling via setInterval in CalendarPanel
- [x] Manual refresh button in CalendarPanel header
- [x] firstDay=1 (Monday) set on FullCalendar

### Phase 4 — Write Operations ✅ DONE
- [x] Drag-to-move → `patchEventTimes()` PATCH `sendUpdates=none`, revert on error
- [x] Edit modal (`EventModal.tsx`) → `putEvent()` PUT `sendUpdates=all`
- [x] Timezone fix in EventModal — `toLocalInput()` for display, `new Date(str).toISOString()` on save
- [x] Locale fix — `locale={enAU}` for DD/MM date format
- [x] All inline styles moved to `styles.css` — EventModal and RecurringModal use shared gcal- classes
- [x] RecurringModal.tsx built — "This event" and "This and following" only
- [x] RecurringModal wired into `eventDrop` and `EventModal` save via Promise-based `askRecurring` pattern
- [x] `splitRecurringSeries()` added to `GoogleCalendarAPI.ts`
- [x] BUG FIXED: splitRecurringSeries duplicate on split date
- [x] `getEvent()` added to `GoogleCalendarAPI.ts`
- [x] `UPDATE_EVENT` action added to CalendarContext reducer
- [x] BUG FIXED: EventModal save duplicates event — fcEvents wrapped in useMemo
- [x] BUG FIXED: Resize snaps back — added `eventResize` handler
- [x] Create event — `select` callback → EventModal (create mode) → `postEvent()` → ADD_EVENT or fetchCalendarRef
- [x] Delete event — `onDelete` prop → `window.confirm` → if recurring, `askRecurring` → refetch
- [x] `deleteRecurringAndFollowing()` added to `GoogleCalendarAPI.ts`
- [x] Create recurring event — full RRULE UI in EventModal create mode, wired end-to-end

### Phase 5 — Accept / Reject ✅ DONE
- [x] `patchAttendeeResponse()` added to `GoogleCalendarAPI.ts` — patches full attendees array, `sendUpdates=all`
- [x] `onRespond` prop added to `EditProps` in `EventModal.tsx`
- [x] Accept/Decline buttons shown in modal — wired in `CalendarPanel`
- [x] Declined events filtered from `fcEvents` — `selfResponseStatus !== "declined"`
- [x] Recurring event response — RecurringModal surfaces with "This event" / "All events" only (no "This and following" — not supported by Google API for attendee responses, confirmed via API docs + Google Calendar UI)
- [x] RecurringModal extended with `title`, `hideFollowing`, `showAll` props for context-aware display
- [x] `askRecurring` extended with optional `opts` param — passes config to RecurringModal
- [x] Response buttons always shown in edit mode (not just needsAction) — Yes / Maybe / No, active state highlighted
- [x] `patchAttendeeResponse` widened to accept `"tentative"` — all three response statuses supported

### Phase 6 — UI Polish ✅ DONE
  6.1 Calendar Toggle ✅ DONE
  - [x] Open in browser button — `↗` button next to account email in CalendarToggle dropdown
  - [x] Remember which calendars were turned off — persisted via `plugin.data.calendarVisibility`

  6.2 Calendar View ✅ DONE
  - [x] Show events from all days in the current view — fixed `getViewWindow` to snap to Monday for week view
  - [x] Calendar width scales responsively with panel size — ResizeObserver on wrapper div, 50ms delay before `updateSize()`
  - [x] Calendar density toggle — compact (default) / medium / large, persisted to `plugin.data.viewDensity`

  6.3 Events ✅ DONE
  - [x] needsAction events render with crosshatch background (CSS repeating-linear-gradient via eventClassNames)
  - [x] All inline styles moved from CalendarPanel.tsx to styles.css (gcal-panel-* classes)
  - [x] Event chip border set to rgba(0,0,0,0.4)
  - [x] Event chip colors desaturated via desaturateHex() in utils/color.ts (amount: 0.2)
  - [x] Update `EventModal.tsx` with full event capabilities: title, date, start, end, recurring, all day, add guest, location, description, what calendar to add to
  - [x] Click video call link to launch URL in browser
  - [x] Show attending guests, name and response status
  - [x] Styling the Event modal for better UI
  - [x] Styling the recurring modal for better UI — centred layout, 22px vertical padding on option buttons, centred cancel
  - [x] Drag to create — `select` callback replaces `dateClick`, targeted fetch for recurring creates

  6.4 Calendar Navigation ✅ DONE
  - [x] Add horizontal line on current time across calendar — `nowIndicator={true}` on FullCalendar, one prop, done
  - [x] Mini month navigation widget — `MiniMonth.tsx` popover, trigger top-left, dispatches SET_DATE + gotoDate
  - [x] View toggle (Day / 3D / Week) using FullCalendar API
  - [x] `T` button at the top left to jump to Today/This Week
  - [x] Left and right buttons at the top left to navigate between days/weeks

  6.5 Loading / Error / Success States ✅ DONE
  - [x] Toast notification system in CalendarPanel header (centre column of CSS grid header)
  - [x] Loading toasts for all write operations and initial fetch
  - [x] Success toasts auto-dismiss after 2000ms
  - [x] Error toasts stay until dismissed (× button)
  - [x] `isSaving` state in EventModal — disables save button, shows "Saving..." label
  - [x] `onSave` / `onSplitSeries` prop types changed to `Promise<void>`
  - [x] Old `state.error` banner and `state.isLoading` loading div removed
  - [x] Timezone picker decided against — device timezone is sufficient, all code already anchors to device time

  6.6 Misc
  - [x] Active view button restyling

### Phase 7 — Publish Prep

  7.1 Performance ✅ DONE
  - [x] **Grid line opacity** — reduce calendar grid line opacity via CSS
  - [x] **Optimistic updates** — single-event write ops return `Promise<CalEvent>`, dispatch UPDATE_EVENT/ADD_EVENT/REMOVE_EVENT directly
  - [x] **Parallel fetches** — confirmed already implemented via `Promise.all`. No change needed.
  - [x] **Targeted single-calendar refetch** — `fetchCalendarRef` pattern added. `MERGE_EVENTS` action in reducer. Used after splitRecurringSeries, deleteRecurringAndFollowing, and recurring postEvent. Cuts N-calendar refetch to 1.
  - [x] **Recurring create instances** — `postEvent` with recurrence uses `fetchCalendarRef` instead of `ADD_EVENT` so all instances appear immediately without a manual refresh.
  - [x] **Add repeat to existing event** — Repeat UI shown in edit mode for non-recurring events. `putEvent` signature extended with `recurrence?: string[]`. Google requires `timeZone` in start/end when recurrence is present — use `Intl.DateTimeFormat().resolvedOptions().timeZone`. CalendarPanel `onSave` branches on `updates.recurrence?.length`: fetchCalendarRef if set, UPDATE_EVENT dispatch if not.

  7.2 Robustness
  - [ ] Error handling + user-facing messages for all failure cases

  7.3 Auth
  - [ ] Easier authentication method for multiple accounts, do not require GCP setup

  7.5 Keyboard shortcuts
  - [ ] to Open Leaf
  - [ ] to toggle between active view (D, 3d, w)
  - [ ] to jump to today
  - [ ] to refresh

### Phase 8 Release
  - [ ] README with GCP setup guide
  - [ ] GitHub releases (`main.js`, `manifest.json`, `styles.css`)
  - [ ] PR to `obsidian/obsidian-releases`

---

## 10. Known Risks

| Risk | Mitigation |
|---|---|
| OAuth community distribution | Require users to bring own GCP credentials |
| API rate limits | 5-min polling is safe; exponential backoff on 429 |
| `sendUpdates` defaulting to notify | Always pass `sendUpdates=none` on drags |
| Recurring event complexity | Three cases mapped explicitly in section 5.8 |
| Port 42813 in use | Scan 42813–42817, register all in GCP |
| Shared calendar dedup | Deduplicate by `iCalUID` before render |
| Token refresh race | Refresh lock pattern in `GoogleCalendarAPI.ts` |
| FullCalendar 0-height render | Flex column layout — header flexShrink:0, FC wrapper flex:1 |
| Plugin store review | `isDesktopOnly: true`, no remote code, no data collection |
| Timezone in EventModal | datetime-local has no tz awareness — use toLocalInput() for display, new Date().toISOString() on save |
| Google API stale reads after write | Single-event writes use response body directly (no GET). Multi-step ops (splitRecurringSeries, deleteRecurringAndFollowing) use fetchCalendarRef — targeted single-calendar refetch. |
| FullCalendar controlled/uncontrolled conflict | Memoize `fcEvents` with useMemo + use calendarRef.getApi() to mutate FC events directly |
| Read-only calendars in create dropdown | Filter by `accessRole === "owner" \|\| "writer"` |
| splitRecurringSeries instance override ghost | Explicitly DELETE original instance (Step 1.5) before POSTing new series |
| deleteRecurringAndFollowing UNTIL source | Use `instance.start`, not any edited time |
| RRULE BYDAY empty on weekly | Default to event start date's weekday — `DAY_MAP[new Date(startStr).getDay()] ?? "MO"` |
| Array index in strict TS | `DAY_MAP[n]` returns `string \| undefined` — always add `?? "MO"` fallback. Use `.slice(0, 10)` not `.split("T")[0]` |
| Attendee PATCH ownership concern | `organizer` and `creator` are immutable — sending full attendees array via PATCH never changes event ownership or creates new events. Akiflow's bug was a POST, not a PATCH. |
| Recurring attendee response scope | Google API does NOT support "this and following" for response status — confirmed. Options are instance ID (this event) or master ID (all events) only. |
| TypeScript discriminated union narrowing | `props.mode === "x"` is the only safe narrowing pattern — derived booleans (`isCreate`) and `as` casts do NOT narrow |
| RecurringModal choice type widening | When adding new choice values (e.g. `"all"`), update the type in RecurringModalProps, askRecurring signature, EditProps.askRecurring, and CalendarPanel state — all four must stay in sync |
| Calendar visibility on reload | `state.calendars` is `[]` on init — merge logic must fall back to `plugin.data.calendarVisibility` before defaulting to API value. Guard `length === 0` in save effect prevents wiping record before data loads. |
| FullCalendar width on panel resize | FC doesn't listen for container resizes — use ResizeObserver + 50ms setTimeout before calling `updateSize()`. Do NOT use `calendarRef.current.el` — type doesn't expose it. Observe the wrapper div via a separate `calendarWrapperRef` instead. |
| FC slot height | Controlled via CSS on `.fc-timegrid-slot`, not a FC prop. Apply density class to wrapper div and target via `.gcal-density-{mode} .fc-timegrid-slot`. |
| FC drag-to-create ghost persisting | Do NOT use `selectMirror={true}` — it renders a ghost on first interaction that never clears. Use `selectable={true}` only, and call `calendarRef.current?.getApi().unselect()` at top of `select` callback. |
| Google POST propagation delay | No longer relevant — postEvent now returns the created CalEvent from the response body. Non-recurring: ADD_EVENT dispatch used directly. Recurring: fetchCalendarRef used to pull all instances. |
| MiniMonth day cell sizing | Do NOT use `aspect-ratio: 1` on day cells — unreliable in Electron/Obsidian. Use explicit `width: 28px; height: 28px` instead. |
| MiniMonth popover width | Must be at least 240px — 220px clips the Sunday column due to 7 × 28px cells + gaps. |
| Editing outer container class | Never change the root return div's className when adding a child feature. Changing `gcal-panel-container` to `gcal-panel-header` broke the entire layout. Only touch what the task requires. |
| Toast cancel path on delete | When user cancels recurring modal during delete, call `setToast(null)` to clear the "Deleting..." loading toast — otherwise it hangs indefinitely. |
| EventModal onSave Promise type | `onSave` and `onSplitSeries` must be typed as `Promise<void>`, not `void` — otherwise `await` in `handleSave` silently does nothing and `isSaving` never resets. |
| fetchCalendarRef has no toast | Caller already has a toast running — do not add a toast inside fetchCalendarRef. It would conflict with the caller's loading/success toast sequence. |
| Recurring create missing instances | `postEvent` only returns the master event. Use `fetchCalendarRef` when `recurrence?.length` is set — not `ADD_EVENT` — so all instances appear immediately. |
| putEvent with recurrence — missing timeZone | Google returns 400 "Missing timeZone" when recurrence is added via PUT without timeZone in start/end. Always include `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` in start/end fields when recurrence is present. |
| EventModal repeat UI in edit mode — TypeScript narrowing | Do NOT hoist `(props as EditProps)` to a component-level variable to use in JSX conditions — it causes narrowing errors throughout the component. Use inline cast `(props as EditProps).event.recurringEventId` directly in the JSX condition. |
| putEvent recurrence post-write state | PUT response only returns master event, not instances. Branch in CalendarPanel onSave: if `updates.recurrence?.length` → fetchCalendarRef; else → UPDATE_EVENT dispatch. |

---

## 11. Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Mobile | Desktop only (v1) | Mobile OAuth is a separate complexity |
| State management | React Context + useReducer | Right scale, no extra dependencies |
| Recurring edits | Standard 3-way modal | Matches Google Calendar UX |
| Calendar visibility default | All active calendars visible | Matches Google Calendar default |
| Event creation | Click empty slot | Akiflow-style, least friction |
| Default new event calendar | First account's primary | Overridable in create modal |
| `sendUpdates` on drag | `none` | Dragging should not spam attendees |
| `sendUpdates` on explicit edit | `all` | User is intentionally changing the event |
| `sendUpdates` on accept/decline | `all` | Organiser needs to know you responded |
| `baseUrl` in tsconfig | Removed | esbuild handles resolution, not needed |
| `moduleResolution` in tsconfig | Changed to `bundler` | Correct setting when esbuild is bundling |
| TokenStore location | `auth/` folder | Manages auth credentials, not API calls |
| OAuth scope | `calendar` + `userinfo.email` | userinfo.email needed to fetch account email after token exchange |
| refreshPromises type | `Map<string, Promise<void>>` | Independent refresh locks per account |
| accounts in context | Not included — read from plugin.data directly | Accounts only needed at fetch time, not reactive UI state |
| Interval stale closure | fetchAllRef pattern | Avoids resetting interval on state change while always using latest closure |
| Event color opacity | Hex + "CC" suffix | Google colors at full saturation are too bright against Obsidian UI |
| Calendar toggle refetch | No refetch on toggle | Events already in memory, filter client-side |
| Deduplication key | `iCalUID + start` | `iCalUID` alone drops recurring instances — all share the same iCalUID, only start differs per occurrence |
| Week start | firstDay=1 | Monday start matches AU/EU convention |
| Locale | enAU from @fullcalendar/core/locales/en-au | DD/MM date format, non-US |
| EventModal timezone | toLocalInput() + new Date().toISOString() | datetime-local has no tz awareness; manual offset reattachment causes double-shift bug |
| EventModal fields (v1) | Title, start, end, all-day only | Guests/location/description require full event fetch — deferred to later phase |
| Recurring modal options (edit/drag) | "This event" + "This and following" only — no "All events" | "All events" is the destructive option users avoid; "this and following" is the natural UX choice |
| Recurring modal options (RSVP) | "This event" + "All events" only — no "This and following" | Google API does not support "this and following" for attendee response PATCH |
| RecurringModal state pattern | Promise-based askRecurring in CalendarPanel | Single state location, clean callers — both eventDrop and EventModal await the same function |
| askRecurring opts param | Optional second arg `{ title?, hideFollowing?, showAll? }` | Allows same function to serve both edit and RSVP contexts without duplicating modal state |
| Styles | All styles in styles.css using gcal- prefixed classes | No inline styles — shared classes (gcal-modal-backdrop, gcal-input, etc.) reused across components |
| Post-write state sync | Response body for single-event ops; fetchCalendarRef for multi-step ops | Single-event PATCH/PUT/POST return the updated event — use it directly. splitRecurringSeries and deleteRecurringAndFollowing are multi-step; use fetchCalendarRef (targeted single-calendar refetch) instead of full refetch. |
| MERGE_EVENTS action | Added to CalendarContext reducer | Replaces all events for one calendarId, leaves others untouched. Used by fetchCalendarRef. |
| Targeted refetch scope | fetchCalendarRef — one calendar only | splitRecurringSeries and deleteRecurringAndFollowing are confined to a single calendarId. Targeted fetch is accurate and cuts N requests to 1. |
| Recurring create post-write | fetchCalendarRef instead of ADD_EVENT when recurrence is set | postEvent only returns master event. All instances need a fetch to appear. Non-recurring creates still use ADD_EVENT (faster). |
| ADD_EVENT / REMOVE_EVENT actions | Added to CalendarContext reducer | CREATE uses ADD_EVENT with response body. DELETE uses REMOVE_EVENT by ID. No refetch needed for either. |
| mapItem helper | Private method in GoogleCalendarAPI.ts | Removes duplicated Google API → CalEvent mapping across getEvents, postEvent, putEvent, patchEventTimes, patchAttendeeResponse. |
| API method return types | postEvent, patchEventTimes, putEvent, patchAttendeeResponse return `Promise<CalEvent>` | Required to use response body for state update without a second GET call. |
| FullCalendar event updates | calendarRef mutation (getEventById + setProp/setStart/setEnd) + UPDATE_EVENT dispatch | events prop re-render causes duplicates — ref mutation is the only safe way to visually update a FC event without remounting the event source |
| fcEvents memoization | useMemo keyed on [state.events, state.calendars] | Inline computation produces new array reference every render — FC treats each new reference as a new event source |
| splitRecurringSeries UNTIL source | Use `instance.start`, not `updates.start` | UNTIL must reflect the original occurrence time the master series knows about, not the user's edited time |
| EventModal modes | Discriminated union `type Props = EditProps | CreateProps` | Clean separation — create mode drops askRecurring/onSplitSeries entirely. TypeScript only narrows discriminated unions via direct `props.mode === "x"` checks — derived booleans (`isCreate`) and `as` casts do NOT narrow |
| Calendar write filter | Filter by `accessRole === "owner" \|\| "writer"` in create modal dropdown | `minAccessRole=reader` returns all visible calendars including read-only — must filter for write operations |
| accessRole storage | Added to `CalendarMeta`, mapped in `getCalendarList()` from `item.accessRole ?? "reader"` | Needed to gate write operations in UI without extra API calls |
| allDay date handling in create | Pass full ISO string from `dateClick`, slice to `YYYY-MM-DD` on save if allDay | Keeps `toLocalInput()` working uniformly; `.slice(0, 10)` used instead of `.split("T")[0]` |
| Delete confirmation | `window.confirm` | Simplest option; works in Obsidian/Electron; no extra modal state needed |
| Delete button position | `gcal-btn-danger` with `margin-right: auto` in flex footer | Pushes delete to the left while cancel/save stay right — standard destructive action pattern |
| deleteRecurringAndFollowing vs splitRecurringSeries | No POST step | Delete "this and following" is the first half of splitRecurringSeries only — truncate master + delete instance, no new series |
| RRULE scope | Full (Option C) — frequency, interval, day-of-week picker, end condition | Daily/Weekly/Monthly/Yearly all used; "every weekday except Wednesday" = weekly with specific days selected |
| RRULE import style | Static import at top of EventModal | Dynamic import adds async complexity for no benefit — rrule.ts is ~30 lines with no dependencies |
| RRULE default day (weekly) | Pre-populate from event start date | Google infers start day anyway; pre-populating avoids empty day picker looking broken |
| "Every weekday except Wednesday" UX | Weekly frequency + uncheck Wednesday in day picker | RRULE has no "except" modifier — BYDAY=MO,TU,TH,FR is the correct encoding |
| Response button placement | Inside EventModal, always visible in edit mode | Event chips have limited real estate; always-visible matches Akiflow UX where current selection is highlighted |
| Response button states | Active state highlighted per status — green/amber/red | Inactive buttons muted; user can see current status at a glance and change it in one click |
| Tentative support | Added "Maybe" as third response option | Google API supports "tentative"; omitting it would require going to Google Calendar just to set it |
| Declined event visibility | Filter out from fcEvents | User doesn't want to see events they've rejected; accepted/tentative/needsAction remain visible |
| Attendee response — full array required | Send all attendees, update only self entry | Google drops unlisted attendees if you send a partial array |
| Calendar visibility persistence | useEffect in CalendarPanel watching state.calendars | CalendarToggle is presentational — side effects belong in CalendarPanel. Guard length === 0 prevents wiping on init. |
| Open in browser URL | AccountChooser URL with email param | `/u/0` index unknown at runtime — AccountChooser selects correct account by email |
| Week view fetch window | Snap to Monday using `(dayOfWeek + 6) % 7` | Without snap, events from days before selectedDate are outside timeMin and never fetched |
| FC resize responsiveness | ResizeObserver on wrapper div + 50ms delay before updateSize() | FC measures width on mount only; observer fires on panel drag; delay lets DOM settle before measurement |
| Calendar density | CSS class on wrapper div + slotDuration/slotLabelInterval props | Slot height is not a FC prop — CSS is the only way. Persisted to plugin.data.viewDensity. |
| needsAction visual | CSS crosshatch via `background-image` + `!important` | FC sets `background` as inline style — `background-image` layers on top without overriding the base color |
| Event border | `rgba(0,0,0,0.4)` | Fully opaque black is too harsh against coloured chips |
| Event color saturation | `desaturateHex()` at `0.2` in `utils/color.ts` | Google calendar colors at full saturation are too bright; 0.2 takes the edge off without washing out calendar distinction |
| Saturation helper location | `utils/color.ts` | Keeps CalendarPanel clean; color transforms are reusable utility logic |
| RecurringModal layout | Centred text + centred footer | Matches the visual weight of a dialog — option buttons read as choices, not left-aligned list items |
| RecurringModal option padding | 22px vertical | 12px was too cramped; 22px gives each option enough breathing room to feel tappable |
| Drag-to-create callback | `select` replaces `dateClick` entirely | `select` handles both click and drag in one callback; `dateClick` only fires on single click |
| selectMirror | Do NOT use | Renders a ghost on first FC interaction that never clears — FC acquires focus on first interaction and `select` doesn't fire, so nothing calls `unselect()` |
| FC selection clearing | `calendarRef.current?.getApi().unselect()` at top of `select` callback | FC does not auto-clear selection when the callback fires |
| Now indicator | `nowIndicator={true}` on FullCalendar | Built-in FC prop — renders red line + time label at current time. One prop, no extra code. |
| MiniMonth trigger placement | Top-left of header | Matches Google Calendar / Akiflow convention — date context on the left, actions on the right |
| MiniMonth popover | Popover on click, not always-visible | Always-visible takes too much vertical space in a sidebar panel |
| MiniMonth date select | Dispatch SET_DATE + calendarRef.getApi().gotoDate() | Both needed — context drives fetch window, FC API moves the visual |
| MiniMonth day cell sizing | Explicit width/height (28px) not aspect-ratio | aspect-ratio unreliable in Electron/Obsidian |
| MiniMonth popover width | 240px | 220px clips Sunday column |
| Timezone picker | Not built — device timezone used throughout | toLocalInput() and new Date().toISOString() both anchor to device time; FullCalendar also uses browser timezone. No mismatch to resolve unless device tz is wrong. |
| Toast placement | Centre column of CSS grid header | Between nav buttons (left) and toolbar buttons (right) — visible without crowding either group |
| Header layout | CSS grid (1fr auto 1fr) replacing flex space-between | Allows true centring of toast column regardless of left/right group widths |
| Toast for write ops | CalendarPanel-level toast, not Obsidian Notice | Allows loading → success/error state transitions; Notice can't update in-place |
| EventModal save button state | `isSaving` disables button + changes label | Prevents double-submit; gives user feedback that something is happening |
| onSave prop type | `Promise<void>` not `void` | Required for `await` in handleSave to work — void return type silently skips the await |
| Repeat UI in edit mode — JSX narrowing | Inline cast `(props as EditProps).event.x` in JSX condition | Hoisting to a component-level variable breaks TypeScript narrowing throughout the rest of the component. Keep the local `const editProps = props as EditProps` inside handleSave only. |
| putEvent recurrence — timeZone required | Include `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` in start/end when recurrence present | Google returns 400 "Missing timeZone" otherwise. Non-recurrence PUTs do not need it. |
| putEvent recurrence — state sync | fetchCalendarRef when `updates.recurrence?.length`, else UPDATE_EVENT | PUT with recurrence only returns master. fetchCalendarRef pulls all instances. Same pattern as postEvent with recurrence. |

---

## 12. Current State

**Last updated:** May 2026

- GCP setup: DONE
- Phase 1: DONE
- Phase 2: DONE
- Phase 3: DONE
- Phase 4: DONE
- Phase 5: DONE
- Phase 6: DONE (6.1, 6.2, 6.3, 6.4, 6.5 all complete)
- Phase 7.1: DONE (grid line opacity, optimistic updates, parallel fetches confirmed, targeted single-calendar refetch, recurring create instances fix, add repeat to existing event)

### Immediate Next Steps

Phase 7 remaining:
- [ ] 7.2 Error handling + user-facing messages for all failure cases
- [ ] 7.3 Easier authentication — no GCP setup required