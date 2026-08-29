# Obsidian Google Calendar Plugin — PRD + Tech Design

## Status
`Phases 1–14 shipped. Tests + lint green. Phase 15 (buffers) designed, not started.` — Updated 29 Aug 2026

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
| 11 | Duplicate event | Keyboard shortcut while modal open — silent create, same details, no recurrence |
| 12 | Right-click context menu | Quick actions: Join meeting, Duplicate, Going?, Delete |
| 13 | Modifier-drag to duplicate | Hold Cmd (configurable) while dragging — copy lands at the drop position, original stays |
| 14 | Copy-drag ghost | Faded ghost at origin + dashed `+` preview at target, both tracking the key live |

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
| Build | esbuild | Obsidian plugin standard |

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
│   │   ├── RecurringModal.tsx    ← "This / This & Following / All events" choice ✓ DONE
│   │   └── ContextMenu.tsx       ← Right-click context menu ✓ DONE
│   ├── settings/
│   │   └── SettingsTab.ts        ← Obsidian PluginSettingTab (account management)
│   ├── auth/
│   │   ├── OAuthManager.ts       ← OAuth PKCE flow per account ✓ DONE
│   │   └── TokenStore.ts         ← Read/write tokens via plugin.saveData() ✓ DONE
│   ├── api/
│   │   ├── GoogleCalendarAPI.ts  ← All API calls with auto-refresh ✓ DONE
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
- `windowEvents: { prev: CalEvent[], current: CalEvent[], next: CalEvent[] }` ← UPDATED in Phase 10 Step 2 (was `events: CalEvent[]`)
- `activeView: "day" | "3day" | "week"`
- `selectedDate: Date`
- `isLoading: boolean`
- `error: string | null`
- `dispatch` — actions: `SET_CURRENT_WINDOW`, `SET_PREV_WINDOW`, `SET_NEXT_WINDOW`, `SHIFT_FORWARD`, `SHIFT_BACK`, `SET_CALENDARS`, `TOGGLE_CALENDAR`, `SET_VIEW`, `SET_DATE`, `SET_LOADING`, `SET_ERROR`, `UPDATE_EVENT`, `ADD_EVENT`, `REMOVE_EVENT`, `MERGE_EVENTS`

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
  hangoutLink?: string;   // Google Meet link — present when event has a video call
  color: string;
  attendees: Attendee[];
  selfResponseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  recurrence?: string[];
  recurringEventId?: string;
  location?: string;
  description?: string;
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
5. Dispatch `SET_CURRENT_WINDOW`
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

`MERGE_EVENTS` reducer replaces all events for that `calendarId` with the fresh list in `windowEvents.current`, leaving all other calendars' events untouched.

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

**Recurring instance RRULE on modal open:**
Instances don't carry the `recurrence` array — only the master event does. On `eventClick`, if `calEvent.recurringEventId` is set, fetch the master with `getEvent()` and merge its `recurrence` onto the instance before calling `setEditingEvent`. Show a "Loading event..." toast while in-flight. Fall through gracefully on error (modal opens without recurrence data).

```typescript
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
        // fall through
      }
    }
  }
  setEditingEvent(calEvent);
}}
```

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

### 5.9 Context Menu

**File:** `src/components/ContextMenu.tsx`

Right-click on any event opens a floating context menu with quick actions. Replaces the need to open the full EventModal for common operations.

**Actions available:**
- Join meeting (only shown when `calEvent.hangoutLink` is present)
- Duplicate
- Going? (inline RSVP — Yes / ? / No)
- Delete

**Implementation pattern:**

The shared handlers `handleDelete`, `handleDuplicate`, and `handleRespond` are extracted to CalendarPanel so both EventModal props and the context menu call the same functions — no logic duplication.

```typescript
// CalendarPanel — shared handlers take calEvent as param
const handleDuplicate = (calEvent: CalEvent) => { ... };
const handleDelete = async (calEvent: CalEvent) => { ... };
const handleRespond = async (calEvent: CalEvent, status: "accepted" | "declined" | "tentative") => { ... };
```

`duplicateRef.current` now delegates to `handleDuplicate`:
```typescript
duplicateRef.current = () => {
  if (!editingEvent) return;
  const snapshot = editingEvent;
  setEditingEvent(null);
  handleDuplicate(snapshot);
};
```

**Right-click detection — event element map pattern:**
FC intercepts `contextmenu` events on individual event elements. The fix is a single listener on the wrapper div that walks up the DOM to find the registered event element.

```typescript
const eventElementMap = useRef<Map<HTMLElement, CalEvent>>(new Map());

// On FullCalendar:
eventDidMount={(info) => {
  eventElementMap.current.set(info.el, info.event.extendedProps.calEvent as CalEvent);
}}
eventWillUnmount={(info) => {
  eventElementMap.current.delete(info.el);
}}

// Separate useEffect on the wrapper div:
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
```

**Portal rendering — required:**
`ContextMenu` must render via `createPortal(…, document.body)` to escape `gcal-panel-container`'s `overflow: hidden` and Obsidian's own context menu layering. Without the portal, the menu either clips or is hidden entirely.

```typescript
import { createPortal } from "react-dom";

return createPortal(
  <div ref={ref} className="gcal-context-menu" style={{ left, top }}>
    ...
  </div>,
  document.body
);
```

**Position clamping** — prevents menu going off-screen:
```typescript
const left = Math.min(x, window.innerWidth - 220);
const top = Math.min(y, window.innerHeight - 200);
```

**Outside click closes menu:**
```typescript
useEffect(() => {
  const handler = (e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) onClose();
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);
```

**RSVP buttons in context menu** use the same `gcal-btn-response` classes as EventModal — no new button variants needed. Size overridden via `.gcal-context-rsvp-btns .gcal-btn-response { padding: 3px 10px; font-size: 12px; }`.

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

**Repeat UI in edit mode** — shown for all events in edit mode. For events already in a series (`recurringEventId` or `recurrence?.length`), the existing RRULE is parsed and pre-populated via `parseRRule()`. For non-recurring events, defaults are used. Use inline cast in JSX condition — do not hoist to a component-level variable (causes TypeScript narrowing errors throughout).

**`parseRRule` helper in EventModal** — reads a raw RRULE string back into UI state:
```typescript
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
```

**Recurrence state initialisation in EventModal** — pre-populates from existing RRULE if present:
```typescript
const existingRRule = !isCreate ? (props as EditProps).event.recurrence?.[0] : undefined;
const parsedRRule = existingRRule ? parseRRule(existingRRule) : null;

const [repeat, setRepeat] = useState(!!existingRRule);
const [frequency, setFrequency] = useState<RRuleFrequency>(parsedRRule?.frequency ?? "WEEKLY");
const [interval, setIntervalVal] = useState(parsedRRule?.interval ?? 1);
const [days, setDays] = useState<RRuleDay[]>(parsedRRule?.days.length ? parsedRRule.days : [getStartDay(start)]);
const [endType, setEndType] = useState<"never" | "until" | "count">(parsedRRule?.endType ?? "never");
const [untilDate, setUntilDate] = useState(parsedRRule?.untilDate ?? "");
const [countNum, setCountNum] = useState(parsedRRule?.countNum ?? 1);
```

**Recurring instance limitation** — instances (`recurringEventId` set) don't carry the `recurrence` array — that lives on the master event only. So `existingRRule` is undefined for instances and `repeat` initialises `false`. Two options to fix (deferred — choose in next thread): (1) set `repeat=true` when `recurringEventId` is set but show default RRULE values, or (2) fetch master event on modal open to get the real RRULE. Option 2 is accurate but costs an extra API call.

**Editing RRULE on recurring events routes through RecurringModal with `hideThis: true`** — "This event" is hidden since you can't give one instance a different repeat rule. Only "This and following" and "All events" are shown.

**EventModal field order:**
1. Title
2. Datetime row (start, end, all-day checkbox)
3. Repeat checkbox + recurrence block (both edit and create modes)
4. Calendar selector (create mode only)
5. Divider
6. Description
7. Location
8. Guests list (edit mode only)
9. RSVP buttons — Yes / Maybe / No (edit mode only, when `onRespond` is provided)
10. Footer — Delete (edit), Cancel, Save/Create

**RSVP buttons placement** — below guests, above footer. Shown in edit mode when `onRespond` prop is provided. Active state highlighted per current `selfResponseStatus`. CSS classes: `gcal-btn-response`, `gcal-btn-response--{status}`, `gcal-btn-response--active`.

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
  hideThis?: boolean;      // hides "This event" option
  hideFollowing?: boolean; // hides "This and following events" option
  showAll?: boolean;       // shows "All events" option
  onChoice: (choice: "this" | "following" | "all" | null) => void;
}
```

**`askRecurring` signature in CalendarPanel:**
```typescript
const askRecurring = (
  event: CalEvent,
  opts?: { title?: string; hideThis?: boolean; hideFollowing?: boolean; showAll?: boolean }
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
| Duplicate | "Duplicating..." | "Event duplicated" |

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

### 5.18 Keyboard Shortcuts

**Registration:** Use Obsidian's `this.addCommand()` API in `main.ts`. Each command gets an `id`, `name`, and `callback`. Hotkeys are user-configurable in Obsidian's hotkey settings — the plugin only defines the default.

**Commands registered:**
- Open calendar leaf
- Toggle view: Day → 3-day → Week (cycles, dispatches `SET_VIEW` + calls FC `changeView`)
- Jump to today (dispatches `SET_DATE` + `gotoDate(new Date())`)
- Refresh (calls `fetchAllRef.current?.()`)
- Duplicate event (`gcal-duplicate-event` — wired to `commandBridge?.duplicate()`)

**State bridge:** Commands registered in `main.ts` can't directly call React state. Pattern: expose methods on the plugin class via `commandBridge` object registered by CalendarPanel on mount.

### 5.19 Plugin Identity + Custom Icon

**Plugin ID:** `gcal-sidebar` (set in `manifest.json`)
**Display name:** `GCal Sidebar` (manifest + `CalendarView.getDisplayText()` + `SettingsTab` heading)

**Custom icon — registered in `main.ts` via `addIcon()`:**
```typescript
import { Plugin, WorkspaceLeaf, addIcon } from "obsidian";

const GCAL_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="22" width="80" height="68" rx="9" fill="none" stroke="currentColor" stroke-width="6"/>
  <rect x="28" y="10" width="13" height="24" rx="6.5" fill="none" stroke="currentColor" stroke-width="5"/>
  <rect x="59" y="10" width="13" height="24" rx="6.5" fill="none" stroke="currentColor" stroke-width="5"/>
  <text x="10" y="91" font-size="33" font-weight="bold" fill="currentColor" font-family="Arial, sans-serif" letter-spacing="-1">GC</text>
</svg>`;
addIcon("gcal-icon", GCAL_ICON);
```

Call `addIcon()` at the top of `onload()`, before `addRibbonIcon`. Then reference `"gcal-icon"` in both:
- `this.addRibbonIcon("gcal-icon", "GCal Sidebar", ...)`
- `CalendarView.getIcon()` returning `"gcal-icon"`

**`CalendarView.tsx` additions:**
```typescript
getDisplayText() { return "GCal Sidebar"; }
getIcon() { return "gcal-icon"; }  // tab icon in sidebar
```

**Plugin folder name must match manifest `id`** — Obsidian uses the folder name as the plugin ID. Symlink folder must be named `gcal-sidebar`, not the old name.

### 5.20 Auth Distribution — Decision & Rationale

**Current approach: user-supplied GCP credentials. This is intentional and stays as-is for v1.**

**How it works:**
- Each user creates their own GCP project, OAuth Desktop App credentials, and enters their Client ID + Secret in plugin settings
- Their tokens are stored locally in their Obsidian vault's `data.json`
- All API calls go directly from their machine to Google — no third-party infrastructure involved
- Multiple Google accounts are fully supported — each goes through the same consent flow and gets its own tokens

**Why not bundle credentials:**
- `main.js` is always public (required for Obsidian store). Any bundled Client ID or Secret is extractable from the minified JS regardless of repo visibility
- PKCE protects the auth handshake — someone extracting the Client ID can't steal another user's tokens — but they can abuse your GCP quota
- Google Calendar API quota: ~1M queries/day per GCP project. At ~1,150 calls/user/day (3 calendars, 5-min polling), quota exhausts at ~870 concurrent users
- Abuse risk: bad actors could extract the Client ID and use your GCP quota for their own apps, or trigger revocation

**Why not a proxy server:**
- Requires permanent infrastructure (Cloudflare Worker, Vercel, etc.) that must stay online
- Adds a new failure point — if server goes down, new auth and token refresh break for all users
- Adds ongoing maintenance burden
- Only justified at meaningful scale

**Migration cost if approach changes later:**
- Refresh tokens are tied to the Client ID they were issued for
- Switching to bundled credentials would force all existing users to re-auth
- Pain scales with user count — easiest to change before any users exist

**Future path (post-publish, if traction warrants it):**
- Apply for Google OAuth verification — eliminates the warning screen, no code change required
- If scale demands it, build a minimal proxy (one Cloudflare Worker endpoint, ~50 lines) — but only if quota exhaustion becomes real

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
  "id": "gcal-sidebar",
  "name": "GCal Sidebar",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "Interactive Google Calendar sidebar for Obsidian with multi-account support.",
  "author": "ShawnSomething",
  "authorUrl": "https://github.com/ShawnSomething",
  "isDesktopOnly": true
}
```

---

## 7. Dev Environment

- Repo: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/obsidian-gcal`
- Test vault: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/gcal-test`
- Plugin symlinked into vault's `.obsidian/plugins/gcal-sidebar/`
- `npm run dev` — watches and rebuilds on save
- `npm run build` — one-shot production build
- `npm test` — Vitest, one-shot (`vitest run`)
- `npm run test:watch` — Vitest in watch mode
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

  6.6 Misc ✅ DONE
  - [x] Active view button restyling

### Phase 7 — Publish Prep

  7.1 Performance ✅ DONE
  7.2 Robustness ✅ DONE
  7.3 Keyboard Shortcuts ✅ DONE
  7.4 Plugin Identity ✅ DONE
  7.5 Auth Simplification ✅ DECIDED — DEFERRED INDEFINITELY

### Phase 8 — Release ✅ DONE
  - [x] README with GCP setup guide
  - [x] GitHub release created — tag `1.0.0` on `master`
  - [x] Submitted to Obsidian Community via `community.obsidian.md` — automated review in progress
  - [x] Repo made public before submission
  - [x] Default branch switched from `main` to `master`

### Phase 9 — Post Release ✅ DONE
  - [x] Add optional donation payment method at the top and bottom of the readme
  - [x] Add optional donation payment method at the bottom of the settings panel

### Phase 10 — Performance ✅ DONE

  **Step 1 — Split fetchCalendars and fetchEvents ✅ DONE**

  Split `fetchAllRef` into three refs in `CalendarPanel.tsx`:
  - `fetchCalendarsRef` — fetches calendarList only, dispatches `SET_CALENDARS`, returns merged `CalendarMeta[]`
  - `fetchEventsRef` — fetches events only. Takes optional `calendars?: CalendarMeta[]` arg
  - `runFullRefreshRef` — orchestrates both. Used by poll, manual refresh, commandBridge

  Call sites:
  - Initial load: dedicated mount `useEffect` → `fetchCalendarsRef` → `fetchEventsRef(calendars)`, sets `hasFetchedInitial.current = true` in finally
  - Navigation: `useEffect([state.selectedDate, activeView])` calls `fetchEventsRef()` only — guarded with `if (!hasFetchedInitial.current) return`
  - Poll: `setInterval` → `runFullRefreshRef`
  - Manual refresh + `commandBridge.refresh` → `runFullRefreshRef`

  Key win: navigation skips calendarList. ~35ms eliminated per nav press.

  Files affected: `CalendarPanel.tsx` only.

  **Step 2 — Sliding Window Prefetch ✅ DONE**

  **Problem being solved:** Navigation takes ~500–900ms because events fetch happens on demand. Users frequently toggle between today and tomorrow — the previous window loads cold every time.

  **Design:**

  Context state shape changes:
  - `events: CalEvent[]` → `windowEvents: { prev: CalEvent[], current: CalEvent[], next: CalEvent[] }`

  New actions in `CalendarContext.tsx`:
  - `SET_CURRENT_WINDOW` — sets `windowEvents.current`
  - `SET_PREV_WINDOW` — sets `windowEvents.prev`
  - `SET_NEXT_WINDOW` — sets `windowEvents.next`
  - `SHIFT_FORWARD` — atomically: `prev = current`, `current = next`, `next = []`
  - `SHIFT_BACK` — atomically: `next = current`, `current = prev`, `prev = []`

  Existing actions `UPDATE_EVENT`, `ADD_EVENT`, `REMOVE_EVENT`, `MERGE_EVENTS` operate on `windowEvents.current` only.

  New helper in `CalendarPanel.tsx`:
  - `getAdjacentDates(date, view)` → `{ prevDate: Date, nextDate: Date }` — returns the date for the prev and next windows

  New ref in `CalendarPanel.tsx`:
  - `fetchWindowRef` — fetches events for any given date/view, returns `CalEvent[]`, no dispatch. Used by prefetch logic.

  Navigation flow (forward):
  1. `SHIFT_FORWARD` — `next` becomes `current` instantly (render is immediate, no loading state)
  2. Fetch new `next` window in background (fire-and-forget, dispatch `SET_NEXT_WINDOW` when done)
  3. Old `prev` is dropped

  Navigation flow (back):
  1. `SHIFT_BACK` — `prev` becomes `current` instantly
  2. Fetch new `prev` window in background
  3. Old `next` is dropped

  Initial load:
  - Fetch all 3 windows in parallel (Promise.all) → dispatch `SET_PREV_WINDOW`, `SET_CURRENT_WINDOW`, `SET_NEXT_WINDOW`

  Poll/manual refresh:
  - Re-fetch all 3 windows. Stale adjacent windows are not acceptable.

  `fcEvents` useMemo:
  - Filters from `windowEvents.current` only — FC never sees prev/next data

  `fetchCalendarRef` (single-calendar refetch after write ops):
  - Operates on `current` only. Updates `windowEvents.current` via `MERGE_EVENTS`.
  - Adjacent windows become stale after a write — acceptable. They'll refresh on next nav or poll.

  **Why keep `prev`:** Users toggle between today and tomorrow constantly. Once you navigate forward, `prev` (today) is already loaded — back-navigation is instant.

  **Files affected:** `CalendarContext.tsx` and `CalendarPanel.tsx`.

  `CalendarMeta` must be exported from `CalendarContext.tsx`.

---


### Phase 12 — Context Menu ✅ DONE

**New file:** `src/components/ContextMenu.tsx`

**Behaviour:**
- Right-click any event → floating context menu appears at mouse position
- Menu options: Join meeting (if `hangoutLink` present), Duplicate, Going? (inline RSVP), Delete
- All actions delegate to shared handlers in CalendarPanel — no logic duplication
- Menu closes on outside click or after any action

**Files changed:**
- `src/components/ContextMenu.tsx` — new file
- `CalendarPanel.tsx`:
  - Added `contextMenu` state
  - Added `eventElementMap` ref
  - Added `handleDuplicate`, `handleDelete`, `handleRespond` shared handlers
  - `duplicateRef.current` simplified to delegate to `handleDuplicate`
  - Added `eventDidMount` / `eventWillUnmount` on FullCalendar to populate element map
  - Added `contextmenu` listener `useEffect` on wrapper div
  - Added `<ContextMenu />` to render output
- `styles.css` — added context menu styles

**Key learnings:**
- FC swallows `contextmenu` events on individual event elements — attaching the listener directly to `info.el` in `eventDidMount` does not work
- Fix: maintain an `eventElementMap` (ref → CalEvent), attach one `contextmenu` listener to the wrapper div, walk up DOM from `e.target` to find the registered element
- `createPortal(…, document.body)` is required — without it the menu is clipped by `overflow: hidden` on the panel container or buried under Obsidian's own context menu
- `e.stopPropagation()` prevents Obsidian's native context menu from appearing on top
- Shared handlers (`handleDelete`, `handleDuplicate`, `handleRespond`) take `calEvent` as a param — both EventModal props and context menu call the same functions
- RSVP buttons reuse `gcal-btn-response` classes from EventModal — size overridden with a scoped CSS rule, no new button variants needed

---


### Phase 13 — Modifier-Drag Duplicate ✅ DONE

Hold a configured modifier while dragging an event to create a copy at the drop
position, leaving the original in place. Replaces duplicate-then-drag with one gesture.

**Files changed:**
- `api/types.ts` — `DuplicateModifier` type; optional `duplicateModifier` on `PluginData`
- `auth/TokenStore.ts` — defaults to `"meta"`
- `api/GoogleCalendarAPI.ts` — `postEvent` gained `sendUpdates: "all" | "none" = "all"`
- `CalendarPanel.tsx` — `MODIFIER_KEY` lookup; `handleDuplicate` widened; `eventDrop` branch
- `settings/SettingsTab.ts` — "Duplicate on drag" dropdown (Off / Cmd / Alt / Shift)

**The branch, at the top of `eventDrop` before the recurring check:**
```tsx
const calEvent = info.event.extendedProps.calEvent as CalEvent;
const mod = plugin.data.duplicateModifier ?? "meta";
if (mod !== "off" && info.jsEvent[MODIFIER_KEY[mod]]) {
  info.revert();
  handleDuplicate(calEvent, {
    start: info.event.startStr,
    end: info.event.endStr,
  }, "none");
  return;
}
```
`calEvent` was hoisted out of the async IIFE and its inner declaration deleted —
the closure picks up the outer one. `info.revert()` runs synchronously before any await.

**`handleDuplicate` signature — three params, two optional:**
```ts
const handleDuplicate = (
  calEvent: CalEvent,
  overrides?: { start: string; end: string },
  sendUpdates: "all" | "none" = "all"
) => { ... }
```
It has three callers. Only the drag path passes arguments 2 and 3; the
`gcal-duplicate-event` command and the context-menu Duplicate both call it with one
argument and are therefore byte-identical in behaviour to before.

### Phase 14 — Copy-Drag Ghost ✅ DONE

During a copy-drag, both halves of the outcome are shown: a faded ghost where the event
will stay, and a dashed `+` preview where the copy will land. Both track the modifier
**live** — press or release mid-drag and the visuals follow, because the duplicate
decision is made at mouse-release.

**Files changed:** `CalendarPanel.tsx` (two handlers, two refs, two helpers), `styles.css`
(three new classes).

**Mechanism:**
- `eventDragStart` — clone `info.el` at its `getBoundingClientRect()`, strip FC's
  `fc-event-mirror` / `fc-event-dragging` classes, add `gcal-drag-ghost`, set only the
  dynamic `left/top/width/height`, append to `activeDocument.body`. Register
  `keydown`/`keyup` on the same document; store the remover in a ref.
- `setCopyVisual(on)` — toggles the ghost's `display` and `gcal-copy-drag` on the wrapper
  via `classList.toggle`, not via JSX `className`.
- `eventDragStop` — removes the node, runs the listener cleanup, clears the wrapper class.

**Target preview is CSS only.** FullCalendar already renders the dragged event at the
drop position with class `fc-event-mirror`, so `.gcal-copy-drag .fc-event-mirror` styles
it without creating anything.

### Phase 15 — Automatic Task Prep Buffers ⏳ PLANNED

Not started. Full design below — this is the next feature.

**Goal:** stop hand-creating a 15-minute "Task Prep" event before every meeting. Scan a
chosen calendar and create one automatically wherever there is a free slot in front of a
meeting.

**The rule.** For a meeting starting at `T`, the buffer slot is `[T - 15min, T)`. Create
it only if no busy event overlaps: `eventStart < T && eventEnd > T - 15min`.

Worked example — a 1pm meeting running to 2pm, and another at 2pm. The slot before 2pm
collides with the 1pm meeting, so nothing is created. The slot before 1pm is free, so a
12:45 buffer appears. This is self-limiting: an existing buffer occupies its own slot, so
the next scan will not create a second one.

**A meeting qualifies only if** it has at least one attendee other than you (skips focus
blocks and solo time-blocking), is not all-day, is not declined, is not itself a buffer,
and its buffer slot starts in the future.

**An event counts as busy if** it is on one of the user-selected busy calendars, is not
all-day, and is not declined. Buffers count as busy — that is what prevents duplicates.

**Tag every buffer** with `extendedProperties.private.gcalBuffer = "1"` and
`gcalBufferFor = <meeting event id>`. This ships in v1 even though nothing reads
`gcalBufferFor` yet: without a tag there is no reliable way to identify a buffer later,
and adding one afterwards leaves every existing buffer unidentifiable. Title matching is
not a substitute because the user can rename an event.

**Settings** — new `bufferSettings` on `PluginData`, defaults in `TokenStore.defaultData()`:

| Setting | Default |
|---|---|
| `enabled` (auto-run on the 5-min poll) | `false` |
| `sourceCalendarId` | `""` |
| `targetCalendarId` | falls back to source |
| `busyCalendarIds: string[]` | all cached calendars |
| `durationMinutes` | `15` |
| `title` | `"Task Prep"` |
| `horizonDays` | `2` |
| `maxPerRun` | `10` |

Horizon is 2 days, not a week: v1 has no orphan cleanup, so every meeting that moves after
its buffer is created leaves a stray event. Two days covers the realistic prep window.

**Calendar pickers.** `SettingsTab` cannot reach the React context holding
`state.calendars`. Extend the existing effect in `CalendarPanel.tsx` that already writes
`plugin.data.calendarVisibility` on every calendar change to also write
`plugin.data.calendarCache`. No new API calls. Filter the target dropdown to
`accessRole === "owner" || "writer"`, the same filter EventModal's create selector uses.

**New pure module — `src/utils/buffers.ts`:**

```ts
export function computeBufferCandidates(
  meetings: CalEvent[],
  busy: CalEvent[],
  config: BufferSettings,
  now: Date,
): BufferCandidate[]
```

No I/O, mirroring `utils/rrule.ts`. Being pure is what makes it testable before a line of
it is written — see section 15. Must dedupe candidates by start time: two meetings
double-booked at 10am would otherwise both request a 9:45 buffer.

**API layer.** Add optional `extendedProperties` and `colorId` to `postEvent`; carry
`extendedProperties` through `mapItem` and onto `CalEvent`. Reuse `getEvents` unchanged
for the horizon fetch — it already takes arbitrary `timeMin`/`timeMax`. Note `postEvent`
now takes `sendUpdates` as its third parameter; buffers have no attendees so either value
is harmless, but pass `"none"`.

**Scan flow** — a `runBufferScanRef` in `CalendarPanel.tsx`, assigned each render like the
existing fetch refs:

1. Bail if no `sourceCalendarId`.
2. Fetch `now → now + horizonDays` for the source and every busy calendar via `Promise.all`.
3. Call `computeBufferCandidates`.
4. Empty → toast "No buffers needed", stop.
5. Slice to `maxPerRun`, POST **sequentially** — predictable request volume, clean partial
   state if one fails.
6. `ADD_EVENT` for each buffer landing inside the current window.
7. Toast the count, or the error.

Wire a `gcal-create-buffers` command through `CommandBridge` following the existing
`duplicate` pattern. For auto-run, call the scan after `runFullRefreshRef` resolves in the
poll effect, guarded by `enabled`.

Do **not** trigger the scan from a `useEffect` on `state.windowEvents.current` — that
fires after every write operation and would run it constantly.

**Safety:** `enabled` defaults off, so the command works immediately but unattended
running is opt-in. `maxPerRun` caps a runaway at 10. Sequential POSTs. Every buffer tagged
so a bad batch can be found and removed.

**Out of scope for v1:** orphan cleanup (deletion is higher-stakes and should not ship
alongside the thing that creates the events; the `gcalBufferFor` tag makes it easy to add
later), shrink-to-fit for gaps under 15 minutes, and a distinct in-plugin colour.

**Verification order.** Configure a source calendar with `enabled` off. Run the command,
check the toast count. Verify the 1pm/2pm case. **Run the command a second time
immediately — it must report zero created.** That idempotency check is the most important
one. Then confirm nothing is created before an all-day event, a solo event, a declined
meeting, or a meeting under 15 minutes away. Only then enable the toggle.

---

## 10. Known Risks

| Risk | Mitigation |
|---|---|
| OAuth community distribution | User-supplied GCP credentials — no bundled credentials, no quota sharing, no abuse risk. See section 5.20 for full rationale. |
| Unverified OAuth warning screen | Warn users in README — "You'll see a Google warning screen, click Advanced → Continue. This is expected." Apply for Google verification post-publish. |
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
| Attendee PATCH ownership concern | `organizer` and `creator` are immutable — sending full attendees array via PATCH never changes event ownership or creates new events. |
| Recurring attendee response scope | Google API does NOT support "this and following" for response status — confirmed. Options are instance ID (this event) or master ID (all events) only. |
| TypeScript discriminated union narrowing | `props.mode === "x"` is the only safe narrowing pattern — derived booleans (`isCreate`) and `as` casts do NOT narrow |
| RecurringModal choice type widening | When adding new choice values (e.g. `"all"`), update the type in RecurringModalProps, askRecurring signature, EditProps.askRecurring, and CalendarPanel state — all four must stay in sync |
| Calendar visibility on reload | `state.calendars` is `[]` on init — merge logic must fall back to `plugin.data.calendarVisibility` before defaulting to API value. Guard `length === 0` in save effect prevents wiping record before data loads. |
| FullCalendar width on panel resize | FC doesn't listen for container resizes — use ResizeObserver + 50ms setTimeout before calling `updateSize()`. Do NOT use `calendarRef.current.el` — type doesn't expose it. Observe the wrapper div via a separate `calendarWrapperRef` instead. |
| FC slot height | Controlled via CSS on `.fc-timegrid-slot`, not a FC prop. Apply density class to wrapper div and target via `.gcal-density-{mode} .fc-timegrid-slot`. |
| FC drag-to-create ghost persisting | Do NOT use `selectMirror={true}` — it renders a ghost on first FC interaction that never clears. Use `selectable={true}` only, and call `calendarRef.current?.getApi().unselect()` at top of `select` callback. |
| Google POST propagation delay | No longer relevant — postEvent now returns the created CalEvent from the response body. Non-recurring: ADD_EVENT dispatch used directly. Recurring: fetchCalendarRef used to pull all instances. |
| MiniMonth day cell sizing | Do NOT use `aspect-ratio: 1` on day cells — unreliable in Electron/Obsidian. Use explicit `width: 28px; height: 28px` instead. |
| MiniMonth popover width | Must be at least 240px — 220px clips the Sunday column due to 7 × 28px cells + gaps. |
| Editing outer container class | Never change the root return div's className when adding a child feature. Changing `gcal-panel-container` to `gcal-panel-header` broke the entire layout. Only touch what the task requires. |
| Toast cancel path on delete | When user cancels recurring modal during delete, call `setToast(null)` to clear the "Deleting..." loading toast — otherwise it hangs indefinitely. |
| EventModal onSave Promise type | `onSave` and `onSplitSeries` must be typed as `Promise<void>`, not `void` — otherwise `await` in `handleSave` silently does nothing and `isSaving` never resets. |
| fetchCalendarRef has no toast | Caller already has a toast running — do not add a toast inside fetchCalendarRef. It would conflict with the caller's loading/success toast sequence. |
| fetchEventsRef on mount with empty calendars | Guard navigation useEffect with `if (!hasFetchedInitial.current) return` — without guard, navigation useEffect fires on mount before initial load completes and fetches nothing — silently broken |
| CalendarMeta not exported | Add `export` to CalendarMeta interface in CalendarContext.tsx — fetchCalendarsRef return type requires it |
| putEvent with recurrence — missing timeZone | Google returns 400 "Missing timeZone" when recurrence is added via PUT without timeZone in start/end. Always include `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` in start/end fields when recurrence is present. |
| EventModal repeat UI in edit mode — TypeScript narrowing | Do NOT hoist `(props as EditProps)` to a component-level variable to use in JSX conditions — it causes narrowing errors throughout the component. Use inline cast `(props as EditProps).event.recurringEventId` directly in the JSX condition. |
| putEvent recurrence post-write state | PUT response only returns master event, not instances. Branch in CalendarPanel onSave: if `updates.recurrence?.length` → fetchCalendarRef; else → UPDATE_EVENT dispatch. |
| Keyboard shortcut state bridge | Commands in `main.ts` cannot directly access React state. Use a `commandBridge` object registered on the plugin class by CalendarPanel on mount. |
| Plugin folder name must match manifest id | Obsidian uses the plugin folder name as the plugin ID. If manifest `id` changes, rename the symlink folder to match. Mismatch = plugin silently fails to load. |
| TokenStore.saveAccount() not updating plugin.data | `saveAccount()` and `removeAccount()` write to disk but must also update `plugin.data` in memory. Without this, CalendarPanel's visibility `useEffect` can write stale `plugin.data` back to disk and clobber newly added accounts. Fix: add `this.plugin.data = data` after `saveData()` in both methods. |
| GCP consent screen not published | Tell users to publish in README — Testing mode blocks all accounts except project owner |
| Future auth migration forcing re-auth | Refresh tokens are tied to the Client ID they were issued for. Changing auth approach later forces all existing users to re-auth. Easiest to change before any users exist. |
| obsidian-releases PR no longer accepted | Submit via `community.obsidian.md` developer dashboard instead |
| Default branch must contain manifest.json | Obsidian validator reads default branch only — if code is on `master` but default is `main` (empty), validator fails with "Could not find manifest.json". Fix: switch default branch in GitHub Settings → General. |
| Old template tag blocks release tagging | Delete old `1.0.0` tag before retagging: `git tag -d 1.0.0` then `git push origin --delete 1.0.0` |
| RecurringModal flag sync | hideThis, hideFollowing, showAll must be kept in sync across RecurringModalProps, recurringModalState type, askRecurring opts type, and EditProps.askRecurring type |
| Recurring instance RRULE missing | Instances don't carry recurrence array — it lives on the master only. Fixed: eventClick fetches master on recurring instance click, merges recurrence onto instance before opening modal. |
| splitRecurringSeries recurrence not passed through | `updates` shape in `splitRecurringSeries` was missing `recurrence?` field — new series always inherited original RRULE regardless of what user configured. Fix: add `recurrence?: string[]` to updates type in both `splitRecurringSeries` and `EditProps.onSplitSeries`, use `updates.recurrence ?? originalRecurrence` in POST step. |
| Sliding window — write ops stale adjacent windows | `fetchCalendarRef` only updates `windowEvents.current`. Adjacent windows go stale after a write. Acceptable — they refresh on next nav or poll. |
| Sliding window — MiniMonth arbitrary jump | If user jumps more than one window via MiniMonth, `prev`/`next` are no longer adjacent. On arbitrary jump: skip shift, fetch all 3 windows fresh. |
| Duplicate event — stale editingEvent in ref | Capture `editingEvent` into a `snapshot` local var before calling `setEditingEvent(null)`, otherwise the ref may read null by the time the async resolves. |
| Duplicate event — attendees responseStatus | Only send `{ email: string }[]` for attendees on duplicate POST — do not forward `responseStatus`. |
| Context menu — FC swallows contextmenu events | Do NOT attach contextmenu listener to `info.el` in `eventDidMount` — FC intercepts it. Use `eventElementMap` ref + single listener on wrapper div instead. |
| Context menu — overflow: hidden clips menu | Must use `createPortal(…, document.body)` to escape panel container's overflow. Without portal, menu is clipped or invisible. |
| Context menu — Obsidian native menu overlays | Add `e.stopPropagation()` in the contextmenu handler to prevent Obsidian's own context menu appearing on top. |
| Context menu — shared handler vs inline closures | Shared handlers take `calEvent` as param — both EventModal props and context menu call them. Without extraction, the same delete/respond logic would be written twice (once closing over `editingEvent`, once over `contextMenu.calEvent`). |
| FC rejects Ctrl-held drags | `isPrimaryMouseButton` is `ev.button === 0 && !ev.ctrlKey` (`interaction/index.js:244`) — a Ctrl-held mousedown never starts a drag. Ctrl is structurally unusable as a drag modifier; it was removed from the dropdown, not merely warned about. |
| Origin slot empties during drag | FC's `displayDrag()` marks the original as an affected event and re-renders it at the target. A ghost must therefore be our own cloned node — there is nothing left behind to style. |
| Cloning must happen at dragStart | `eventDragStart` fires from `handleDragStart` *before* the first `handleHitUpdate`, so the element is still in the DOM at its original position. Clone there or the rect is wrong. |
| Ghost cleanup hook | Use `eventDragStop`, not `eventDrop` — it fires for every drag end including reverts and invalid drops, and before `eventDrop`. Cleaning up only in `eventDrop` strands a fixed-position node on screen after a cancelled drag. |
| Ghost must escape `overflow: hidden` | Append to `activeDocument.body` with `position: fixed`, the same escape hatch `ContextMenu.tsx` uses. Do NOT add `position: relative` to `.gcal-calendar-wrapper` — that is the container-editing mistake section 2.5 warns about. |
| Google Drive vault serves stale builds | The real vault under `~/Library/CloudStorage/GoogleDrive-.../` holds a static copy of `main.js` and kept serving cached bytes across several reloads. Test in `gcal-test`, which is symlinked to the build and updates on the first reload. |
| `console.debug` is invisible in Obsidian | It maps to Chromium's Verbose level, hidden by default in devtools. Use `console.warn` when debugging, or a `Notice` when the console itself is in doubt. |
| eslint `no-static-styles-assignment` | Setting `element.style.position` / `.margin` from JS is flagged — static values belong in a CSS class. Only computed values (`left`, `top`, `width`, `height`) should be assigned in JS. |
| `activeDocument` is `no-undef` | Obsidian's global is not in the eslint config; the codebase already carries ~9 of these. Capture it once into a local `const doc` per handler rather than referencing it repeatedly. |
| `postEvent` notified on every duplicate | The URL hardcoded `sendUpdates=all`, so duplicating a meeting emailed every attendee instantly. Now a parameter defaulting to `"all"`; only the drag path passes `"none"`. |
| Changing a shared handler's default is a regression | `handleDuplicate` has three callers. Passing `"none"` inside the function body silently changed the shipped command and context-menu duplicate. Add an optional parameter and pass it from the new call site only. |
| Google Drive vault serves stale builds | The real vault holds a static copy of `main.js` on Drive's virtual filesystem. A copy reads back byte-identical from the shell while Obsidian keeps loading cached bytes — it cost four debugging rounds on 29 Aug. Test in `gcal-test`, which is symlinked. If a change seems not to apply, prove the build is loading at all with a `Notice` in `onload` before debugging the feature. |
| `console.debug` is invisible in Obsidian | It maps to Chromium's Verbose level, hidden by default in devtools. Instrument with `console.warn`, or a `Notice` when the console itself is in doubt. |
| Never log token or account objects | `AccountConfig` and the token exchange response both contain `accessToken` and `refreshToken` in plaintext. Logging either exposes long-lived calendar access via devtools, screen shares, or pasted issue output. |
| Renaming a command is not cosmetic if the ID moves | Hotkeys bind to `addCommand` IDs, not names, and `VIEW_TYPE` binds workspace layout. Renaming display text is safe; changing an ID silently breaks user bindings. Nothing tests this yet. |
| eslint `brands` replaces rather than extends | Configuring `obsidianmd/ui/sentence-case` with `brands` discards all 46 plugin defaults. `eslint.config.mts` repeats them; re-sync if the plugin updates its list. |
| A test that cannot fail protects nothing | Confirm each regression test goes red when its bug is reintroduced. One mutation check on 29 Aug silently hit a doc comment rather than the code and falsely reported the suite as green. |

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
| Post-write state sync | Response body for single-event ops; fetchCalendarRef for multi-step ops | Single-event PATCH/PUT/POST return the updated event — use it directly. splitRecurringSeries and deleteRecurringAndFollowing are multi-step; use fetchCalendarRef instead of full refetch. |
| Deduplication key | `iCalUID + start` | `iCalUID` alone drops recurring instances — all share the same iCalUID, only start differs per occurrence |
| Week start | firstDay=1 | Monday start matches AU/EU convention |
| Locale | enAU from @fullcalendar/core/locales/en-au | DD/MM date format, non-US |
| EventModal timezone | toLocalInput() + new Date().toISOString() | datetime-local has no tz awareness; manual offset reattachment causes double-shift bug |
| Auth distribution approach | User-supplied GCP credentials — no bundled credentials | main.js is always public; bundled credentials are always extractable. See section 5.20. |
| Auth simplification (Phase 7.5) | Cancelled — deferred indefinitely | Was predicated on bundling credentials, which was decided against. |
| Keyboard shortcut state bridge | `commandBridge` object on plugin class, registered by CalendarPanel on mount | Commands in main.ts can't access React state directly. |
| Plugin identity | id: `gcal-sidebar`, name: `GCal Sidebar` | Renamed from sample plugin template. Folder name must match manifest id exactly. |
| Obsidian plugin submission method | `community.obsidian.md` developer dashboard (not PR to obsidian-releases) | Obsidian replaced the manual PR process in 2026. |
| Sliding window state shape | `windowEvents: { prev, current, next }` replaces `events: CalEvent[]` | Enables instant nav by pre-loading adjacent windows |
| Poll scope | All 3 windows refreshed on poll | Stale adjacent windows not acceptable |
| Write op scope | fetchCalendarRef operates on current only | Adjacent windows stale after write is acceptable |
| Duplicate — open modal or silent create | Silent create | Faster; user can click into the duplicate if they need to edit |
| Duplicate — recurrence | Always strip recurrence | A duplicate is a one-off copy |
| Duplicate — attendees | Copy as email-only array | responseStatus stripped — irrelevant on a new event |
| Duplicate — ref pattern | `duplicateRef` re-assigned each render, `.then/.catch` not async | Consistent with other nav refs; snapshot pattern handles async state clear safely |
| Context menu trigger | Right-click on event | Non-destructive, discoverable, doesn't conflict with left-click (open modal) |
| Context menu actions | Join meeting, Duplicate, Going?, Delete | Common quick actions that don't need the full modal |
| Context menu RSVP | Inline in menu — same gcal-btn-response classes | Keeps menu self-contained; reuses existing button styles |
| Context menu rendering | createPortal to document.body | Escapes overflow:hidden on panel container |
| Context menu event detection | eventElementMap ref + wrapper div listener | FC intercepts contextmenu on individual elements; wrapper listener + DOM walk is reliable |
| Context menu shared handlers | Extract handleDelete/handleDuplicate/handleRespond to CalendarPanel | Both EventModal and context menu call same logic — no duplication |
| Duplicate — "modal in focus" gate | `editingEvent !== null` check | Simpler and more reliable than DOM focus detection in Electron |
| Duplicate — modal close timing | Close modal before postEvent resolves | User sees the new event land on the calendar; toast confirms success |
| Duplicate — ref pattern | `duplicateRef` re-assigned each render, `.then/.catch` not async | Consistent with other nav refs; snapshot pattern handles async state clear safely |
| postEvent attendees param | Added as optional `{ email: string }[]` | Needed for duplicate feature; other callers unaffected (field is optional) |
| Drag-duplicate modifier | Configurable via settings, default Cmd | Obsidian hotkeys bind commands only — there is no API for a key held during a mouse drag, so it must be a plugin setting. Alt is the macOS convention (Finder, Figma) but Cmd was chosen; the dropdown lets anyone switch. |
| "Off" option in the modifier dropdown | Included | An accidental modifier press during a normal drag silently creates a real event on a real calendar. Cheap opt-out. |
| Ctrl as a drag modifier | Removed from the dropdown | FC's `isPrimaryMouseButton` excludes `ctrlKey`, so a Ctrl-drag never begins. Not a warning case — it cannot work. |
| When the modifier is read | At mouse release, not at grab | Matches Finder and Figma: start a normal drag and decide to copy before letting go. |
| Attendees on a duplicate | Kept, but notifications suppressed | The gesture works on any event, so the guest list is worth carrying. `sendUpdates=none` on the drag path stops the invite emails; send them manually from Google Calendar when ready. |
| Pre-existing duplicate paths | Left on `sendUpdates=all` | The command and context-menu duplicate are shipped behaviour. The feature had to be purely additive. |
| Ghost placement | Both — faded at origin AND dashed preview at target | Origin ghost is what makes it read as "duplicate" rather than "move"; the target preview shows where the copy lands. |
| Ghost live-tracks the modifier | Yes, via `keydown`/`keyup` during the drag | The decision happens at release, so a visual frozen at drag start could show no ghost while still producing a duplicate. |
| Ghost DOM location | `activeDocument.body`, `position: fixed` | Escapes the wrapper's `overflow: hidden` without touching any container's CSS. Same approach as `ContextMenu`. |
| Wrapper class toggling | `classList.toggle`, not JSX `className` | Avoids a React re-render on every keypress mid-drag, and leaves the container's declared class untouched. |
| Test runner | Vitest | Native ESM + TypeScript with no transform config, matching `"type": "module"` and esbuild. Aliasing the types-only `obsidian` package to a stub is one line. |
| Test location | Top-level `tests/`, included in tsconfig | Keeps `src/` shippable while still getting test files typechecked by `npm run build` and parseable by eslint's typed rules. |
| What gets tested | Pure logic only | React components need jsdom plus mocks for Obsidian, FullCalendar and the plugin object — brittle and prone to asserting implementation detail. `OAuthManager` opens a real HTTP server. The logic they depend on is covered instead. |
| Making code testable | Extract pure helpers to `src/utils/` | `getViewWindow`, `getAdjacentDates`, `toLocalInput`, `parseRRule` were trapped inside components. Pure moves, no behaviour change. New logic should start in `utils/` for the same reason. |
| Regression tests must be mutation-tested | Reintroduce the bug, confirm red | A test that cannot fail protects nothing. All three of the session's real bugs were verified this way. |
| `@types/node` bump ^16 → ^22 | Required by Vitest 4 | Peer requires >=20; repo runs Node 24 locally, CI on 20/22. Build and lint verified unchanged after. |
| CI step order | `npm test` before `npm run lint` | Chosen while lint was still failing on 36 errors — a test step after it would never execute. Retained so a broken test still reports if a lint rule regresses. |
| Deprecated `setWarning` / `display` | Suppressed with documented reasons, not migrated | Both are the sanctioned path for `minAppVersion` below 1.13.0. Obsidian's own types say `display()` is "only implemented as a fallback for plugins that need to support Obsidian versions older than 1.13.0". Migrating means rewriting SettingsTab and dropping every user under 1.13. |
| sentence-case false positives | Configured `brands` / `ignoreRegex`, not `eslint-disable` | The rule has no proper-noun awareness and flags any capitalised word mid-string. Configuring keeps it live for genuine mistakes. Note `brands` REPLACES the default list, so all 46 defaults are repeated in `eslint.config.mts`. |
| Command names | Dropped the `"Google Calendar: "` prefix | Obsidian prefixes commands with the plugin name itself, so they rendered as "GCal Sidebar: Google Calendar: Day view". IDs were left untouched — hotkeys bind to IDs, not names. |
| Obsidian globals | Declared in eslint config, not worked around in code | `activeDocument`, `activeWindow` and `Buffer` are legitimate; the config only loaded `globals.browser`. |
| Token logging | Deleted outright | `console.log` of the token exchange response and of `AccountConfig` printed `accessToken` and `refreshToken` in plaintext. |

---

## 12. Current State

**Last updated:** 29 Aug 2026

### Done

- Phases 1–14 complete. Plugin published to the Obsidian Community store.
- `manifest.json` at `1.0.18`, `minAppVersion` `1.7.2`.
- Test suite: 71 Vitest tests, 6 files, wired into CI (section 15).
- `eslint .` exits 0. It had been failing on 36 errors, so the CI lint job was red (section 16).
- Full gate verified green: `tsc`, `npm test`, `eslint .`, production build.

### Open items — start here next session

1. **Ship a release carrying the lint fixes.** The removed token-logging `console.log`
   calls are in the repo but not in any published build. Shawn is handling this via a
   normal release rather than hand-copying builds into vaults.
2. **Phase 15 — automatic Task Prep buffers.** Designed in full below, not started.

### Next session start

Paste this doc plus current `CalendarPanel.tsx` and `CalendarContext.tsx`. The doc is
self-contained — no verbal history needed.

### Testing
Use the **`gcal-test`** vault. It is symlinked to the build and updates on the first reload.
The real vault under Google Drive holds a static copy and serves stale bytes for several
reloads after a rebuild — that cost four debugging rounds on 29 Aug.


### Release notes
- GitHub release tag: `1.0.0` on `master` branch
- Release assets: `main.js`, `manifest.json`, `styles.css`
- Obsidian submission: via `community.obsidian.md` developer dashboard
- Repo: `https://github.com/ShawnSomething/obsidian-gcal`
- Default branch: `master`

---

## 13. Post-Release Session — Recurring Edit Fixes (May 2026)

### What was done

**Repeat UI layout redesign (EventModal.tsx + styles.css)**
- Changed recurrence block from stacked label/field layout to inline rows matching iOS Calendar UX
- Row 1: `Every [n] [frequency dropdown]` — number + dropdown side by side
- Row 2: `On [M][T][W][T][F][S][S]` — label + day buttons inline (weekly only)
- Row 3: `End [Never dropdown]` — label + dropdown inline
- Conditional date/count inputs appear as a 4th row when needed
- Frequency option labels changed from "Daily/Weekly/Monthly/Yearly" → "Day/Week/Month/Year"
- New CSS classes added to styles.css: `gcal-recurrence-row`, `gcal-recurrence-label`, `gcal-recurrence-interval`, `gcal-recurrence-freq`

**Bug fix — "All events" 410 error (FIXED)**
- Root cause: `handleSave` in EventModal when choice is "all" was falling through to `onSave(updates)` without a `return`. CalendarPanel's `onSave` always used `editingEvent.id` (instance ID). PUT to an instance ID with recurrence = 400. PUT to a deleted/stale instance = 410.
- Fix 1: Added `targetEventId?: string` to `onSave` updates type in `EditProps`
- Fix 2: In `EventModal.tsx` `handleSave`, added explicit `if (choice === "all")` branch that passes `targetEventId: editProps.event.recurringEventId` and returns
- Fix 3: In `CalendarPanel.tsx` `onSave` handler, destructure `targetEventId` from updates and use `targetId = targetEventId ?? editingEvent.id` for the `putEvent` call

**Bug fix — "This and following" not updating Google Calendar (FIXED)**
- Symptom: "Series split" success toast appeared, all network requests returned 200, but Google Calendar was completely unchanged
- Root cause: `splitRecurringSeries` `updates` type was missing `recurrence?: string[]`. The new series POST was always using `recurrence: originalRecurrence` (the master's RRULE), ignoring whatever the user configured in EventModal. Additionally, `EditProps.onSplitSeries` type also lacked the `recurrence` field, so even though EventModal was building and passing it, the type prevented it reaching `splitRecurringSeries`.
- Fix 1: Added `recurrence?: string[]` to the `updates` parameter type in `splitRecurringSeries` in `GoogleCalendarAPI.ts`
- Fix 2: Changed POST step from `recurrence: originalRecurrence` to `recurrence: updates.recurrence ?? originalRecurrence`
- Fix 3: Added `recurrence?: string[]` to `EditProps.onSplitSeries` type in `EventModal.tsx`

**Debugging approach used:**
- Added `console.log` instrumentation to all steps of `splitRecurringSeries` to log request bodies and response bodies
- Key insight: all steps returned 200 but POST body showed wrong RRULE — confirmed bug was in what was being sent, not the network
- Always log the full request body (not just status) when debugging API calls that return 200 but don't produce the expected result

---

### Phase 11 — Duplicate Event ✅ DONE

**Behaviour:**
- Shortcut only fires when the event modal is open (`editingEvent !== null` — no DOM focus detection needed)
- Closes the modal immediately so the user sees the new event appear on the calendar
- Silent create — no modal for the duplicate; user clicks in to edit if needed
- Duplicate is always a single event (no recurrence), regardless of whether source was recurring or not
- All other fields copied: title, start, end, allDay, location, description, attendees
- Attendees copied as `{ email: string }[]` — only email sent, no responseStatus

**Files changed:**

`GoogleCalendarAPI.ts`:
- Added `attendees?: { email: string }[]` to `postEvent` event param type
- Added `...(event.attendees?.length ? { attendees: event.attendees } : {})` to POST body

`main.ts`:
- Added `duplicate: () => void` to `CommandBridge` interface
- Added `gcal-duplicate-event` command wired to `commandBridge?.duplicate()`

`CalendarPanel.tsx`:
- Added `duplicateRef = useRef<(() => void) | undefined>(undefined)`
- Assigned `duplicateRef.current` each render — captures `editingEvent` into a `snapshot` local var before `setEditingEvent(null)`, then calls `postEvent` with snapshot data
- Wired `duplicate: () => duplicateRef.current?.()` into `commandBridge` useEffect

**Key pattern — snapshot before state clear:**
```typescript
duplicateRef.current = () => {
  if (!editingEvent) return;
  const snapshot = editingEvent;      // capture before state clears
  setEditingEvent(null);              // close modal immediately
  showToast("Duplicating...", "loading");
  plugin.api.postEvent(account, snapshot.calendarId, { ... })
    .then((created) => {
      dispatch({ type: "ADD_EVENT", payload: created });
      showToast("Event duplicated", "success", 2000);
    })
    .catch((err) => {
      showToast(`Failed to duplicate event: ${(err as Error).message}`, "error");
    });
};
```
`.then/.catch` used instead of `async` — keeps ref assignment pattern consistent with other nav refs.

**Toasts:** "Duplicating..." (loading) → "Event duplicated" (success, 2000ms) or error toast on failure.

---

## 14. Phase 10 — Performance (historical — both steps complete)

### Problem
Navigation between days/weeks takes ~2 seconds. Confirmed via network tab:
- `calendarList` calls: ~35ms — not the problem
- `events` calls: 500–919ms each — Google API latency, unavoidable
- CORS preflights (~300ms) on every request — caused by `Authorization` header, cannot be eliminated
- 6 calendars across 2 accounts tested

### Root Cause
`fetchAllRef` fetches calendarList then events sequentially on every navigation. CalendarList almost never changes — fetching it on every date/view change is wasteful.

### Step 1 — Split fetchCalendars and fetchEvents ✅ DONE

Split `fetchAllRef` into three refs in `CalendarPanel.tsx`:
- `fetchCalendarsRef` — fetches calendarList only, dispatches `SET_CALENDARS`, returns `CalendarMeta[]`
- `fetchEventsRef` — fetches events for current window only. Optional `calendars?: CalendarMeta[]` arg.
- `runFullRefreshRef` — composes both. Used by poll, manual refresh, commandBridge.

`hasFetchedInitial` ref guards the navigation `useEffect` from firing on mount before initial load.

### Step 2 — Sliding Window Prefetch ✅ DONE

**Goal:** Hide Google API latency behind user think time. Navigation renders instantly from pre-loaded data.

**Context changes (`CalendarContext.tsx`):**
- `events: CalEvent[]` → `windowEvents: { prev: CalEvent[], current: CalEvent[], next: CalEvent[] }`
- New actions: `SET_CURRENT_WINDOW`, `SET_PREV_WINDOW`, `SET_NEXT_WINDOW`, `SHIFT_FORWARD`, `SHIFT_BACK`
- `UPDATE_EVENT`, `ADD_EVENT`, `REMOVE_EVENT`, `MERGE_EVENTS` all operate on `windowEvents.current` only

**CalendarPanel changes:**
- New helper: `getAdjacentDates(date, view)` → `{ prevDate: Date, nextDate: Date }`
- New ref: `fetchWindowRef` — fetches events for arbitrary date/view, returns `CalEvent[]`, no dispatch
- Initial load: fetch all 3 windows in parallel → dispatch each window
- Navigation forward (next button / commandBridge.next): `SHIFT_FORWARD` (instant) → fetch new `next` in background
- Navigation back (prev button / commandBridge.prev): `SHIFT_BACK` (instant) → fetch new `prev` in background
- MiniMonth arbitrary jump (> 1 window): skip shift, fetch all 3 fresh
- Poll/refresh: re-fetch all 3 windows
- `fcEvents` useMemo: filters from `windowEvents.current` only

**Files affected:** `CalendarContext.tsx` and `CalendarPanel.tsx`

### Decisions

| Decision | Choice | Reason |
|---|---|---|
| CORS preflights | Accept as-is | Caused by Authorization header — unavoidable |
| calendarList on navigation | Remove | Calendars don't change on nav — wasteful |
| calendarList + events parallel | Not possible | Events fetch requires calendar list |
| Poll scope | All 3 windows | Accuracy is priority — stale adjacent windows not acceptable |
| Keep prev window | Yes | Users toggle today/tomorrow constantly — back-nav must be instant too |
| Write op scope | current only | Adjacent windows stale after write is acceptable — refreshes on next nav or poll |
| MiniMonth arbitrary jump | Fetch all 3 fresh | Shift logic only valid for adjacent windows |
| Duplicate — open modal or silent create | Silent create | Faster; user can click into the duplicate if they need to edit |
| Duplicate — recurrence | Always strip recurrence | A duplicate is a one-off copy — carrying over recurrence would create an unintended new series |
| Duplicate — attendees | Copy as email-only array | Attendees are part of "same details"; responseStatus stripped — irrelevant on a new event |

---

## 15. Testing

Added 29 Aug 2026. Vitest, 79 tests across 7 files in `tests/`.

### Running

```
npm test          # one-shot
npm run test:watch
```

CI (`.github/workflows/lint.yml`) runs `npm test` **before** `npm run lint`. That
order matters: `eslint .` currently exits non-zero on 36 pre-existing errors, so a
test step placed after it would never execute.

### Why the `obsidian` stub exists

The `obsidian` npm package ships types only — its `package.json` has `main: ""` and the
directory contains nothing but `.d.ts` files. Any module importing it fails to load under
a test runner. `vitest.config.ts` aliases the bare specifier to `tests/stubs/obsidian.ts`,
which implements only the surface the source actually uses and exposes `requestUrl` as a
`vi.fn()` so tests can drive the HTTP layer.

This split bites twice, and will again. Vitest rewrites `"obsidian"` to the stub at
runtime; `tsc` always resolves it to the real types-only package. So anything the stub
adds — its `makeResponse` helper, the `Plugin` recording fields, its zero-argument
constructor — exists at runtime but not to the compiler. Two consequences:

**Test files import the stub by path (`./stubs/obsidian`), not as `"obsidian"`.** The
vitest alias applies at runtime; `tsc` still resolves the bare specifier to the real
types-only package and would reject the stub's test helpers. Same file either way, so it
is the same module instance the API under test holds.

**Tests that exercise a stubbed base class declare a local interface for what they
need and cast to it**, rather than intersecting with the real Obsidian type. See
`RecordingPlugin` in `commandIds.test.ts`.

### What is covered

| File | Covers |
|---|---|
| `rrule.test.ts` | `buildRRule`, `parseRRule`, and their round-trip. Drift between the two silently loses a user's recurrence settings |
| `viewWindow.test.ts` | `getViewWindow` / `getAdjacentDates`, including the Sunday Monday-snap and that adjacent windows abut with no gap or overlap |
| `dedup.test.ts` | The `iCalUID + start` key — that recurring instances survive deduplication |
| `datetime.test.ts` | `toLocalInput` round-tripping to the same instant |
| `color.test.ts` | `desaturateHex` clamping and hue handling |
| `googleCalendarApi.test.ts` | URL construction, `sendUpdates` policy per operation, request bodies, and Google→`CalEvent` mapping |
| `commandIds.test.ts` | The 9 `addCommand` ids and `VIEW_TYPE` — the strings persisted in a user's vault that hotkeys and workspace layout bind to. Also guards against the double-prefixed command names fixed in Phase 13/14 |

### Extractions this required

Four pure helpers were moved out of components so they could be imported without
React or FullCalendar. Pure moves, no behaviour change:

- `getViewWindow`, `getAdjacentDates` — `CalendarPanel.tsx` → `src/utils/viewWindow.ts`
- `toLocalInput` — `EventModal.tsx` → `src/utils/datetime.ts`
- `parseRRule`, `DAY_MAP`, `getStartDay` — `EventModal.tsx` → `src/utils/rrule.ts`,
  which is where `buildRRule` already lived

`tsconfig.json` now includes `tests/**/*.ts` and `vitest.config.ts`, so test files are
both typechecked by `npm run build` and parseable by eslint's typed rules. Without that
include, eslint reports a parsing error per test file.

`@types/node` was bumped `^16` → `^22`. Vitest 4 requires `>=20` as a peer, the repo runs
Node 24 locally and CI uses 20/22. Build and lint were verified unchanged after the bump.

### The suite was mutation-tested

Each regression test was confirmed to fail when its bug is reintroduced:

| Mutation | Result |
|---|---|
| `/events?sendUpdates=${sendUpdates}` → `/event${sendUpdates}` | 3 tests fail |
| `postEvent` default `"all"` → `"none"` | 1 test fails |
| `(dayOfWeek + 6) % 7` → `dayOfWeek - 1` | 1 test fails |
| Renaming a command id | 1 test fails |
| Changing `VIEW_TYPE` | 2 tests fail |
| Restoring a `"Google Calendar: "` command name prefix | 2 tests fail |

A test that cannot fail is not protecting anything. Re-run this check when adding
regression tests.

### Not covered, deliberately

React components (`CalendarPanel`, `EventModal`, `ContextMenu`) have no tests. Rendering
them needs jsdom plus mocks for Obsidian, FullCalendar and the plugin object; the result
is brittle and tends to assert implementation detail. The pure logic they depend on is
covered instead. `OAuthManager` is also untested — it opens a real HTTP server and a
browser.

### When adding a feature

Put new logic in a pure function under `src/utils/` and test it there. That is what made
the buffer scan design (`computeBufferCandidates`) testable before it is written.

---

## 16. Lint Cleanup — 29 Aug 2026

`eslint .` had been failing on 36 errors, so the CI lint job was red. All 36 are now
resolved and `eslint .` exits 0. The rule still fires on genuine mistakes — verified by
temporarily introducing bad casing.

### Two credential leaks removed

`OAuthManager.ts` logged the full token exchange response, and `SettingsTab.ts` logged
the whole `AccountConfig`. Both objects contain `accessToken` **and** `refreshToken` in
plaintext. For a published plugin that is a real exposure path: devtools, a screen share
during debugging, or console output pasted into a GitHub issue all leak a long-lived
refresh token with full calendar access. Deleted. The `console.error` on auth failure is
allowed by the rule and stays.

### Globals declared instead of code changed (11 errors)

`activeDocument`, `activeWindow` and `Buffer` were flagged `no-undef` because
`eslint.config.mts` only loaded `globals.browser`. They are legitimate — Obsidian injects
the first two for pop-out window support, and `OAuthManager` runs in Electron's node
context. Declared in the config; no source touched.

### Command names de-duplicated (9 strings)

Obsidian prefixes command names with the plugin name automatically, so
`"Google Calendar: Day view"` was rendering as **"GCal Sidebar: Google Calendar: Day view"**.
The prefix was dropped from all 9 commands. **Command IDs were not changed**, so existing
hotkey bindings are unaffected.

### Deprecations suppressed with reasons, not migrated

| API | Why it stays |
|---|---|
| `setWarning()` | Purely cosmetic — both it and `setDestructive()` render a red button. `setDestructive` needs Obsidian 1.13.0. Commit `b776c4d` already tried it and reverted, because it forced `minAppVersion` from 1.0.0 up to 1.13.1. |
| `display()` ×2 | Obsidian's own type definitions state display() is *"only implemented as a fallback for plugins that need to support Obsidian versions older than 1.13.0"* — exactly this plugin at 1.7.2. The replacement, `getSettingDefinitions()`, is a declarative rewrite of the whole tab, not a swap. |

Both carry inline comments naming the version constraint. Revisit only if `minAppVersion`
is raised to 1.13.0, which would drop every user below it.

### sentence-case configured rather than suppressed (19 errors)

Five were genuine ("Client Secret" → "Client secret", "Connected Accounts" →
"Connected accounts", and so on). The remaining seven were false positives: the rule has
no proper-noun awareness and flags any capitalised word mid-string, including "Google",
the plugin's own name, and two literal credential placeholders.

Rather than scatter seven `eslint-disable` comments, the rule is configured in
`eslint.config.mts` with `brands` and `ignoreRegex`. **`brands` replaces the plugin's
default list rather than extending it**, so all 46 defaults are repeated in the config
with our additions appended — re-sync that list if the plugin ever updates it.

### CI

`.github/workflows/lint.yml` runs `npm test` **before** `npm run lint`. That order was
chosen while lint was still failing; now that both pass it matters less, but tests-first
means a broken test is reported even if a lint rule regresses.
