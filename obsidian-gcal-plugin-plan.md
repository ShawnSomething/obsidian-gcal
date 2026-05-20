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
│   │   ├── MiniMonth.tsx         ← Mini month navigation widget
│   │   ├── EventModal.tsx        ← Edit + Create modal (discriminated union Props) ✓ DONE
│   │   └── RecurringModal.tsx    ← "This / This & Following" choice ✓ DONE
│   ├── settings/
│   │   └── SettingsTab.ts        ← Obsidian PluginSettingTab (account management)
│   ├── auth/
│   │   ├── OAuthManager.ts       ← OAuth PKCE flow per account ✓ DONE
│   │   └── TokenStore.ts         ← Read/write tokens via plugin.saveData() ✓ DONE
│   ├── api/
│   │   ├── GoogleCalendarAPI.ts  ← All API calls with auto-refresh ✓ DONE (getEvent + splitRecurringSeries + postEvent + deleteWithAuth + deleteRecurringAndFollowing added)
│   │   └── types.ts              ← TypeScript types for all Google API shapes ✓ DONE
│   └── utils/
│       ├── dedup.ts              ← Event deduplication by iCalUID ✓ DONE
│       └── rrule.ts              ← RRULE builder — buildRRule(options) → string ✓ DONE
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
- `dispatch` — actions: `SET_EVENTS`, `SET_CALENDARS`, `TOGGLE_CALENDAR`, `SET_VIEW`, `SET_DATE`, `SET_LOADING`, `SET_ERROR`

Note: `accounts` is NOT in context — read directly from `plugin.data.accounts` at fetch time.

### 5.4 Data Model

**Persisted to disk (`plugin.saveData()`):**
```typescript
interface PluginData {
  accounts: AccountConfig[];
  calendarVisibility: Record<string, boolean>;
  clientId: string;
  clientSecret: string;
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

**Calendar visibility toggle** does NOT trigger a refetch. Events are already in memory — `fcEvents` filters client-side on render.

**Event color** — Google hex color + `CC` suffix for ~80% opacity (full saturation is too bright):
```tsx
backgroundColor: (calendars.find(c => c.id === e.calendarId)?.backgroundColor ?? "#4285F4") + "CC"
```

### 5.7 Write Operations

**Drag-to-move:** `PATCH` with `sendUpdates=none`. Call `revert()` on error.
**Edit event:** `PUT` full event body, `sendUpdates=all`.
**Create event:** `POST`, `sendUpdates=all`. Accepts optional `recurrence?: string[]`.
**Accept/Decline:** `PATCH` attendees array (must send full array).
**Delete event (non-recurring):** `DELETE` the event URL directly via `deleteWithAuth()`.
**Delete recurring — this event:** `DELETE` the instance ID.
**Delete recurring — this and following:** `deleteRecurringAndFollowing()` — PATCH master UNTIL to 1 second before `instance.start`, then DELETE the instance. Rollback RRULE if DELETE fails. No POST (unlike splitRecurringSeries).

**Timezone handling in EventModal:**
- `datetime-local` inputs have no timezone awareness — always work in local time
- `toLocalInput(isoString)` converts UTC ISO string to local time for display
- On save: `new Date(localString).toISOString()` converts back correctly — do NOT manually reattach timezone offset

```typescript
function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
```

### 5.8 Recurring Event Write Patterns

- **This event only** — PATCH/PUT the instance ID directly
- **This and following** — Split series: modify master RRULE + POST new series
- **All events** — PATCH/PUT the master event via `recurringEventId`

Recurring instance IDs have a `_YYYYMMDDTHHMMSSZ` suffix (e.g. `bd8d1298a0d94760_20260522T214500Z`). Check for `calEvent.recurringEventId` to detect recurring instances before writing.

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

### 5.10 RRULE Builder (`utils/rrule.ts`)

Pure function, no side effects, no imports. Used only in EventModal create mode.

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

**EventModal recurrence state (create mode only):**
```typescript
const [repeat, setRepeat] = useState(false);
const [frequency, setFrequency] = useState<RRuleFrequency>("WEEKLY");
const [interval, setInterval] = useState(1);
const [days, setDays] = useState<RRuleDay[]>([getStartDay(start)]);
const [endType, setEndType] = useState<"never" | "until" | "count">("never");
const [untilDate, setUntilDate] = useState("");
const [countNum, setCountNum] = useState(1);
```

Import: `import { RRuleFrequency, RRuleDay, buildRRule } from "../utils/rrule"` — static import, not dynamic.

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
| `--interactive-accent` | Today highlight |
| `--background-modifier-border` | Grid lines, dropdown border |
| `--text-error` | Error messages |
| `--text-on-accent` | Text on accent-coloured buttons (e.g. active day-of-week pill) |

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

### Phase 4 — Write Operations 🔄 IN PROGRESS
- [x] Drag-to-move → `patchEventTimes()` PATCH `sendUpdates=none`, revert on error — DONE
- [x] Edit modal (`EventModal.tsx`) → `putEvent()` PUT `sendUpdates=all` — DONE
- [x] Timezone fix in EventModal — `toLocalInput()` for display, `new Date(str).toISOString()` on save
- [x] Locale fix — `locale={enAU}` for DD/MM date format
- [x] All inline styles moved to `styles.css` — EventModal and RecurringModal use shared gcal- classes
- [x] RecurringModal.tsx built — "This event" and "This and following" only (no "All events" — UX decision)
- [x] RecurringModal wired into `eventDrop` and `EventModal` save via Promise-based `askRecurring` pattern
- [x] `splitRecurringSeries()` added to `GoogleCalendarAPI.ts` — fetches master RRULE, sets UNTIL, POSTs new series, rollback on partial failure
- [x] **BUG FIXED: splitRecurringSeries duplicate on split date** — Two bugs: (1) UNTIL was calculated from `updates.start` instead of `instance.start`. (2) Google stores existing instance overrides independently of RRULE — truncating the master doesn't delete them. Fix: added Step 1.5 — explicitly DELETE the original instance by ID after patching the master, before POSTing the new series. Added `deleteWithAuth()` to `GoogleCalendarAPI.ts`. Rollback on delete failure restores original RRULE.
- [x] `getEvent()` added to `GoogleCalendarAPI.ts`
- [x] `UPDATE_EVENT` action added to CalendarContext reducer — optimistic update without refetch
- [x] **BUG FIXED: EventModal save duplicates event** — Root cause: `fcEvents` computed inline on every render produces new array reference. FullCalendar v6 treats new `events` prop reference as a new event source. Fix: wrap `fcEvents` in `useMemo` keyed on `[state.events, state.calendars]`. Use `calendarRef` to mutate FC event directly via `getApi().getEventById(id)` + `setProp/setStart/setEnd/setAllDay` after save.
- [x] **BUG FIXED: Resize snaps back** — added `eventResize` handler to `CalendarPanel`. Identical structure to `eventDrop`.
- [x] **PENDING: EventModal save still uses optimistic update** — drop `calendarRef` mutation + `UPDATE_EVENT` dispatch in edit mode, replace with `fetchAllRef.current?.()`. Deferred until core functionality is complete.
- [x] Create event — `dateClick` on empty slot → EventModal (create mode) → `postEvent()` POST `sendUpdates=all` → refetch. EventModal uses discriminated union Props (`mode: "edit" | "create"`). Create mode shows calendar picker filtered to `accessRole === "owner" || "writer"`. `postEvent()` added to `GoogleCalendarAPI.ts`. `accessRole` added to `CalendarMeta`.
- [x] Delete event — `onDelete` prop on EditProps → `window.confirm` → if recurring, `askRecurring` → "this" DELETEs instance, "following" calls `deleteRecurringAndFollowing()` → refetch.
- [x] `deleteRecurringAndFollowing()` added to `GoogleCalendarAPI.ts` — fetch master RRULE, PATCH UNTIL to 1s before `instance.start`, DELETE instance, rollback RRULE on DELETE failure.
- [x] **Create recurring event — all steps DONE**
  - [x] **Step 1** — Extended `CreateProps.onSave` to accept `recurrence?: string[]`
  - [x] **Step 2** — Built `utils/rrule.ts` — pure `buildRRule(options) → string`. Handles frequency, interval, BYDAY (weekly day picker), end condition (never / until / count)
  - [x] **Step 3** — Added recurrence UI to `EventModal` create mode — repeat toggle, frequency dropdown, interval input, day-of-week picker (weekly only), end condition picker. Default day pre-populated from event start date.
  - [x] **Step 4** — Wired `buildRRule` into `EventModal.handleSave` via static import
  - [x] **Step 5** — Updated `postEvent` to accept and send `recurrence?: string[]`
  - [x] **Step 6** — Threaded `recurrence` through `CalendarPanel` dateClick → onSave → postEvent chain

### Phase 5 — Accept / Reject
- [ ] Show response buttons when `selfResponseStatus === "needsAction"`
- [ ] PATCH `responseStatus` with full attendees array

### Phase 6 — UI Polish
- [ ] Mini month navigation widget
- [ ] View toggle (Day / 3D / Week) using FullCalendar API
- [ ] Open in browser button (`htmlLink`)
- [ ] Obsidian CSS variable mapping for dark/light theme
- [ ] Update `EventModal.tsx` with full event capabilities: title, date, start, end, recurring, all day, add guest, location, description, what calendar to add to
- [ ] Click to view existing event details
- [ ] Click video call link to launch url in browser
- [ ] Add main timezone picker

### Phase 7 — Publish Prep
- [ ] Error handling + user-facing messages for all failure cases
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
| Google API stale reads after write | Immediate GET after PATCH/PUT can return old data — mitigated by short delay or relying on 5-min poll. Decision: always refetch after writes for state accuracy; flash is acceptable trade-off over stale UI. |
| FullCalendar controlled/uncontrolled conflict | Feeding `events` prop after FC has internally moved an event causes duplicates — RESOLVED: memoize `fcEvents` with useMemo + use calendarRef.getApi() to mutate FC events directly on save instead of relying on prop re-render |
| Read-only calendars in create dropdown | Filter dropdown by `accessRole === "owner" \|\| "writer"` — `minAccessRole=reader` includes calendars the user cannot write to (e.g. AU holidays calendar) |
| splitRecurringSeries instance override ghost | Google stores instance overrides independently of RRULE — truncating master RRULE does not delete existing overrides. RESOLVED: explicitly DELETE the original instance (Step 1.5) before POSTing new series. UNTIL must be calculated from `instance.start`, not `updates.start`. |
| deleteRecurringAndFollowing UNTIL source | Same rule as splitRecurringSeries — use `instance.start`, not any edited time. UNTIL format: ISO string with dashes/colons stripped via `.replace(/[-:]/g, "").replace(".000", "")`. |
| RRULE BYDAY empty on weekly | Default to event start date's weekday — `DAY_MAP[new Date(startStr).getDay()] ?? "MO"`. Prevents UI showing no days selected (looks broken) and avoids Google inference round-trip. |
| Array index in strict TS | `DAY_MAP[n]` returns `string \| undefined` in strict mode — always add `?? "MO"` fallback. Same applies to `.split("T")[0]` — use `.slice(0, 10)` instead. |

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
| Recurring modal options | "This event" + "This and following" only — no "All events" | "All events" is the destructive option users avoid; "this and following" is the natural UX choice |
| RecurringModal state pattern | Promise-based askRecurring in CalendarPanel | Single state location, clean callers — both eventDrop and EventModal await the same function |
| Styles | All styles in styles.css using gcal- prefixed classes | No inline styles — shared classes (gcal-modal-backdrop, gcal-input, etc.) reused across components |
| Post-write state sync | Full refetch via `fetchAllRef.current?.()` after every write | Google API can return stale data on immediate GET — optimistic updates risk UI drifting from actual Google state. Flash on refetch is acceptable. Targeted single-calendar refetch is a future optimisation (deferred). |
| FullCalendar event updates | calendarRef mutation (getEventById + setProp/setStart/setEnd) + UPDATE_EVENT dispatch | events prop re-render causes duplicates — ref mutation is the only safe way to visually update a FC event without remounting the event source |
| fcEvents memoization | useMemo keyed on [state.events, state.calendars] | Inline computation produces new array reference every render — FC treats each new reference as a new event source |
| splitRecurringSeries UNTIL source | Use `instance.start`, not `updates.start` | UNTIL must reflect the original occurrence time the master series knows about, not the user's edited time |
| EventModal modes | Discriminated union `type Props = EditProps | CreateProps` | Clean separation — create mode drops askRecurring/onSplitSeries entirely. TypeScript only narrows discriminated unions via direct `props.mode === "x"` checks — derived booleans (`isCreate`) and `as` casts do NOT narrow |
| Calendar write filter | Filter by `accessRole === "owner" \|\| "writer"` in create modal dropdown | `minAccessRole=reader` returns all visible calendars including read-only — must filter for write operations. Default calendar selection must also use this filter, not just visibility |
| accessRole storage | Added to `CalendarMeta`, mapped in `getCalendarList()` from `item.accessRole ?? "reader"` | Needed to gate write operations in UI without extra API calls |
| allDay date handling in create | Pass full ISO string from `dateClick`, slice to `YYYY-MM-DD` on save if allDay | Keeps `toLocalInput()` working uniformly; `.slice(0, 10)` used instead of `.split("T")[0]` — array index access returns `string \| undefined` in strict TS |
| Delete confirmation | `window.confirm` | Simplest option; works in Obsidian/Electron; no extra modal state needed |
| Delete button position | `gcal-btn-danger` with `margin-right: auto` in flex footer | Pushes delete to the left while cancel/save stay right — standard destructive action pattern |
| deleteRecurringAndFollowing vs splitRecurringSeries | No POST step | Delete "this and following" is the first half of splitRecurringSeries only — truncate master + delete instance, no new series |
| RRULE scope | Full (Option C) — frequency, interval, day-of-week picker, end condition | Daily/Weekly/Monthly/Yearly all used; "every weekday except Wednesday" = weekly with specific days selected |
| RRULE import style | Static import at top of EventModal | Dynamic import adds async complexity for no benefit — rrule.ts is ~30 lines with no dependencies |
| RRULE default day (weekly) | Pre-populate from event start date | Google infers start day anyway; pre-populating avoids empty day picker looking broken |
| "Every weekday except Wednesday" UX | Weekly frequency + uncheck Wednesday in day picker | RRULE has no "except" modifier — BYDAY=MO,TU,TH,FR is the correct encoding |

---

## 12. Current State

**Last updated:** May 2026

- GCP setup: DONE
- Phase 1: DONE
- Phase 2: DONE
- Phase 3: DONE
- Phase 4: IN PROGRESS — create recurring DONE; EventModal save refetch pending

### Immediate Next Steps

1. **Phase 5** — Accept/Reject: show response buttons when `selfResponseStatus === "needsAction"`, PATCH `responseStatus` with full attendees array.

### Deferred Optimisations (do not start until core functionality complete)
- **Targeted single-calendar refetch** — instead of full `fetchAllRef` after a write, only refetch events for the specific `calendarId` that changed. Cuts N requests down to 1-2. Reduces flash. Requires pulling `getEvents` into a standalone function that merges results back into `state.events` by `calendarId`.