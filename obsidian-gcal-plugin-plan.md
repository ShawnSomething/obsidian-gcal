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
@fullcalendar/core
@fullcalendar/react
@fullcalendar/timegrid      ← day + week time-grid
@fullcalendar/daygrid       ← month grid
@fullcalendar/interaction   ← drag-drop + click-to-create

### esbuild config for React + CSS
The default Obsidian template needs these additions to `esbuild.config.mjs`:
```js
// Add to the build options:
jsx: "automatic",           // enables React 18 JSX transform (no import React needed)
loader: { ".css": "css" },  // bundles FullCalendar CSS
```
Also add to `package.json` devDependencies:
@types/react, @types/react-dom, react, react-dom

---

## 5. Architecture

### 5.1 File Structure
obsidian-gcal-plugin/
├── src/
│   ├── main.ts                   ← Plugin entry point, registers ItemView + settings tab
│   ├── CalendarView.tsx          ← ItemView shell, mounts React root
│   ├── context/
│   │   └── CalendarContext.tsx   ← React Context + useReducer (global state)
│   ├── components/
│   │   ├── CalendarPanel.tsx     ← FullCalendar config + view logic
│   │   ├── MiniMonth.tsx         ← Mini month navigation widget
│   │   ├── EventModal.tsx        ← Create / edit modal
│   │   ├── RecurringModal.tsx    ← "This / Following / All" choice
│   │   └── CalendarToggle.tsx    ← Show/hide individual calendars
│   ├── settings/
│   │   └── SettingsTab.ts        ← Obsidian PluginSettingTab (account management)
│   ├── auth/
│   │   ├── OAuthManager.ts       ← OAuth PKCE flow per account
│   │   └── TokenStore.ts         ← Read/write tokens via plugin.saveData()
│   ├── api/
│   │   ├── GoogleCalendarAPI.ts  ← All API calls with auto-refresh
│   │   └── types.ts              ← TypeScript types for all Google API shapes
│   └── utils/
│       └── dedup.ts              ← Event deduplication by iCalUID
├── styles.css                    ← FullCalendar CSS imports + Obsidian theme overrides
├── manifest.json
├── package.json
└── esbuild.config.mjs

### 5.2 React Mounting Pattern (Critical for Obsidian)

Obsidian's `ItemView` is not a React component. You must manually mount/unmount React.
**This is the pattern — do not deviate from it:**

```typescript
// CalendarView.tsx
import { ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import CalendarPanel from "./components/CalendarPanel";
import GCalPlugin from "./main";

export const VIEW_TYPE = "gcal-view";

export class CalendarView extends ItemView {
  private root: Root | null = null;
  plugin: GCalPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: GCalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Google Calendar"; }

  async onOpen() {
    // containerEl.children[1] is the content area (children[0] is the header)
    this.root = createRoot(this.containerEl.children[1]);
    this.root.render(<CalendarPanel plugin={this.plugin} />);
  }

  async onClose() {
    this.root?.unmount();
  }
}
```

Missing `onClose` unmount = memory leak on every sidebar close.

### 5.3 State Management

Use **React Context + useReducer**. No external state library needed.

`CalendarContext.tsx` provides:
- `accounts: AccountConfig[]`
- `calendars: CalendarMeta[]`
- `events: CalEvent[]`
- `activeView: "day" | "3day" | "week"`
- `selectedDate: Date`
- `dispatch` — actions: `SET_EVENTS`, `SET_CALENDARS`, `TOGGLE_CALENDAR`, `SET_VIEW`, `SET_DATE`

`CalendarPanel` wraps everything in `<CalendarProvider plugin={plugin}>`.
All child components consume via `useCalendar()` hook.

### 5.4 Data Model

**Persisted to disk (`plugin.saveData()`):**
```typescript
interface PluginData {
  accounts: AccountConfig[];
  calendarVisibility: Record<string, boolean>; // calendarId → visible
  clientId: string;     // from GCP project
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

**In-memory (rebuilt on load):**
```typescript
interface CalendarMeta {
  id: string;
  accountId: string;
  summary: string;
  backgroundColor: string;  // hex color from Google API
  visible: boolean;
}

interface CalEvent {
  id: string;             // Google event ID (instance ID for recurring)
  iCalUID: string;        // used for deduplication across accounts
  calendarId: string;
  accountId: string;      // determines which token to use for writes
  title: string;
  start: string;          // ISO datetime string
  end: string;
  allDay: boolean;
  htmlLink: string;
  color: string;          // resolved color (event override or calendar color)
  attendees: Attendee[];
  selfResponseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  recurrence?: string[];          // iCal RRULE strings
  recurringEventId?: string;      // present on recurring instances
}
```

**Event color resolution:**
```typescript
// In GoogleCalendarAPI.ts when mapping events
const color = event.colorId
  ? GOOGLE_COLOR_MAP[event.colorId]   // event-level override
  : calendar.backgroundColor;          // fall back to calendar color
```

### 5.5 OAuth Flow (per account)

1. User enters Client ID + Secret in plugin settings
2. Clicks "Add Account"
3. Plugin generates PKCE `code_verifier` + `code_challenge` (SHA-256)
4. Plugin generates random `state` token (CSRF protection)
5. Starts local HTTP server on `localhost:42813`
6. Opens browser to Google OAuth URL with all params
7. User approves → browser redirects to `localhost:42813/callback?code=...&state=...`
8. Plugin verifies `state` matches, exchanges `code` for tokens
9. Tokens saved, server shuts down

**Token refresh — with race condition protection:**
```typescript
// In GoogleCalendarAPI.ts
private refreshPromise: Promise<void> | null = null;

private async ensureFreshToken(account: AccountConfig): Promise<string> {
  if (Date.now() < account.tokenExpiry - 60000) return account.accessToken;

  // Lock: if a refresh is already in flight, wait for it
  if (!this.refreshPromise) {
    this.refreshPromise = this.doRefresh(account).finally(() => {
      this.refreshPromise = null;
    });
  }
  await this.refreshPromise;
  return account.accessToken;
}
```

**Port conflict handling:**
Try `42813` first. If `EADDRINUSE`, try `42814`, `42815` (scan up to 5 ports).
Log which port was used — the GCP project must have all candidate ports registered
as redirect URIs.

### 5.6 Event Fetching

On load + every 5 minutes (use `plugin.registerInterval`):
1. For each account → `GET /calendar/v3/users/me/calendarList`
2. Filter to visible calendars
3. Per calendar → `GET /calendar/v3/calendars/{id}/events`
   - `timeMin` = start of current view window (ISO string)
   - `timeMax` = end of current view window (ISO string)
   - `singleEvents=true` — expands recurring events into instances
   - `maxResults=250`
4. Merge all events from all accounts
5. **Deduplicate by `iCalUID`** — shared calendars appear in multiple accounts
6. Dispatch `SET_EVENTS` to context
7. On view date change → refetch immediately for new window

### 5.7 Write Operations

#### Drag-to-move

FullCalendar fires eventDrop({ event, delta, revert })
If event.extendedProps.recurringEventId → show RecurringModal
User picks scope → resolve correct eventId + endpoint (see Recurring section)
PATCH /calendar/v3/calendars/{calId}/events/{eventId}
Body: { start: { dateTime }, end: { dateTime } }
Query: sendUpdates=none   ← CRITICAL: prevents emailing all attendees on drag
On success → refetch events for current window
On error → call revert() to snap event back


#### Edit event

eventClick → open EventModal pre-filled
User edits + saves
If recurring → show RecurringModal
PUT /calendar/v3/calendars/{calId}/events/{eventId} (full event body)
Query: sendUpdates=all   ← user explicitly edited, so notify attendees
On success → refetch


#### Create event

dateClick / drag-select on empty slot → open EventModal with start/end pre-filled
User fills title (minimum), optional: description, calendar picker, guests
POST /calendar/v3/calendars/{calId}/events
Query: sendUpdates=all
On success → refetch


#### Accept / Decline

In EventModal, show response buttons if selfResponseStatus === "needsAction"
PATCH /calendar/v3/calendars/{calId}/events/{eventId}
Body: { attendees: [...original, { email: selfEmail, responseStatus: "accepted" }] }
Note: must send full attendees array — PATCH on arrays replaces the whole array
On success → refetch


### 5.8 Recurring Event Write Patterns

Three choices map to completely different API calls:

**"This event only"**
- The `eventId` in the URL is already the instance ID (format: `baseId_YYYYMMDDTHHmmssZ`)
- PATCH or PUT that instance ID directly
- Google creates an override for just that instance

**"This and following"**
- GET the master event via `recurringEventId`
- Modify the master event's RRULE to add `UNTIL=<date before this instance>`
- POST a new recurring event starting from this instance with the new times/data
- This effectively splits the series into two

**"All events"**
- GET the master event using `event.recurringEventId` as the event ID
- PATCH or PUT the master event
- All future instances reflect the change

### 5.9 FullCalendar Configuration Notes

**Height fix (critical for sidebar):**
```tsx
// Parent div must have explicit height
<div style={{ height: "100%", overflow: "hidden" }}>
  <FullCalendar height="100%" ... />
</div>
// Plus in CSS: .view-content { height: 100%; }
```

**3-day view (not a named built-in):**
```tsx
views={{
  threeDays: {
    type: "timeGrid",
    duration: { days: 3 },
    buttonText: "3D",
  }
}}
customButtons={{
  threeDaysButton: {
    text: "3D",
    click: () => calendarRef.current.getApi().changeView("threeDays"),
  }
}}
```

**View toggle buttons** live outside FullCalendar's own header (for more control).
Use `calendarRef.current.getApi()` to imperatively change views and navigate.

---

## 6. Obsidian-Specific Patterns

### 6.1 Settings Tab
Account management lives in Obsidian's native settings panel (not inside the sidebar view).
Create `SettingsTab.ts` extending `PluginSettingTab`.
Register it in `main.ts` via `this.addSettingTab(new SettingsTab(this.app, this))`.

### 6.2 Theming (CSS Variables)
FullCalendar's colors must map to Obsidian's CSS variables:

| Obsidian variable | Used for |
|---|---|
| `--background-primary` | Calendar background |
| `--background-secondary` | Time slot background |
| `--text-normal` | Event text, time labels |
| `--text-muted` | Faint labels, borders |
| `--interactive-accent` | Today highlight, selected state |
| `--background-modifier-border` | Grid lines |

Override FullCalendar's default CSS by targeting `.fc` in `styles.css`.

### 6.3 manifest.json Requirements (for store submission)
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
`isDesktopOnly: true` is required — this plugin uses Node.js HTTP server for OAuth.

---

## 7. Dev Environment Setup

1. Clone: `https://github.com/obsidianmd/obsidian-sample-plugin`
2. `npm install`
3. Modify `esbuild.config.mjs` for JSX + CSS (see section 4)
4. Install `react react-dom @types/react @types/react-dom`
5. Create a test vault in Obsidian
6. Symlink built output to vault:
ln -s /path/to/plugin/.obsidian/plugins/gcal-obsidian /path/to/repo
   OR: set `outdir` in esbuild config to point directly to vault's plugin folder
7. Install the `hot-reload` community plugin in the test vault
   (auto-reloads the plugin when `main.js` changes — saves constant manual reload)
8. `npm run dev` — watches and rebuilds on save

---

## 8. Google Cloud Setup (Required Before Phase 1)

1. Create project at console.cloud.google.com
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials → Desktop App type
4. Add authorised redirect URIs:
   - `http://localhost:42813`
   - `http://localhost:42814`
   - `http://localhost:42815`
   (multiple in case of port conflicts)
5. Copy Client ID + Secret → enter in plugin settings

For community store: guide users through the same GCP setup.
Publishing with a shared client ID requires Google OAuth app verification
(privacy policy, domain verification, Google review). Handle post-v1.

---

## 9. Build Phases

### Phase 1 — Scaffolding
- [ ] Clone Obsidian sample plugin template
- [ ] Configure esbuild for TSX + CSS
- [ ] Register `ItemView`, mount React root, confirm sidebar renders
- [ ] Install FullCalendar, render static test event with correct height

### Phase 2 — Auth
- [ ] Build OAuth PKCE flow (single account)
- [ ] Local HTTP server for callback
- [ ] Token store + retrieval via `plugin.saveData()`
- [ ] Auto-refresh with race condition lock
- [ ] Multi-account support (accounts array)
- [ ] Settings tab UI for adding/removing accounts

### Phase 3 — Read Data
- [ ] Fetch calendar list per account
- [ ] Fetch + merge events for view window
- [ ] Deduplication by `iCalUID`
- [ ] Render in FullCalendar with resolved colors
- [ ] Calendar show/hide toggles
- [ ] 5-min polling via `plugin.registerInterval`

### Phase 4 — Write Operations
- [ ] Drag-to-move → PATCH (`sendUpdates=none`)
- [ ] Revert on API error
- [ ] Edit modal → PUT
- [ ] Create modal → POST
- [ ] RecurringModal with correct API pattern per scope choice

### Phase 5 — Accept / Reject
- [ ] Show response buttons when `selfResponseStatus === "needsAction"`
- [ ] PATCH `responseStatus` with full attendees array

### Phase 6 — UI Polish
- [ ] Mini month navigation widget
- [ ] View toggle (Day / 3D / Week) using FullCalendar API
- [ ] Open in browser button (`htmlLink`)
- [ ] Obsidian CSS variable mapping for dark/light theme

### Phase 7 — Publish Prep
- [ ] Error handling + user-facing messages for all failure cases
- [ ] README with GCP setup guide
- [ ] GitHub repo with releases (must include `main.js`, `manifest.json`, `styles.css`)
- [ ] PR to `obsidian/obsidian-releases` repo to list in community store

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
| FullCalendar 0-height render | Explicit `height="100%"` + parent CSS required |
| Plugin store review | `isDesktopOnly: true`, no remote code, no data collection |

---

## 11. Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Mobile | Desktop only (v1) | Mobile OAuth is a separate complexity |
| State management | React Context + useReducer | Right scale for this app, no extra dependencies |
| Recurring edits | Standard 3-way modal | Matches Google Calendar UX |
| Calendar visibility default | All active calendars visible | Matches Google Calendar default |
| Event creation | Click empty slot | Akiflow-style, least friction |
| Default new event calendar | First account's primary | Overridable in create modal |
| `sendUpdates` on drag | `none` | Dragging should not spam attendees |
| `sendUpdates` on explicit edit | `all` | User is intentionally changing the event |

---

## 12. Current State

**Last updated:** May 2026

- Research complete
- PRD + tech design written
- GCP setup: DONE
  - Project: obsidian-gcal
  - Calendar API enabled
  - OAuth client created (Desktop app type)
  - Client ID + Secret saved
  - Test user(s) added
- Phase 1: not started — starting next

## Next Steps

1. Confirm Node.js + npm versions installed
2. Clone Obsidian sample plugin template
3. Configure esbuild for TSX + CSS
4. Register ItemView, confirm sidebar renders
5. Install FullCalendar, render static test event